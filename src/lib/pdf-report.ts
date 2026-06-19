import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AMIGO_FLOW_SUPPORT_TEAM,
  getAmigoFlowSupportName,
  isGreetingOrNoise,
  type Analysis,
  type Demand,
} from "./whatsapp-parser";

const BRAND: [number, number, number] = [20, 83, 45];
const TEXT: [number, number, number] = [32, 32, 32];
const MUTED: [number, number, number] = [100, 100, 100];
const SOFT: [number, number, number] = [245, 249, 246];

const fmtDateOnly = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR") : "—");

export type AttachmentInsight = {
  name: string;
  type: "image" | "audio" | "document" | "other";
  summary: string;
  demands?: string[];
  actions?: string[];
  pending?: string[];
};

export type Envolvido = { name: string; org: string; role: string };

export type DemandItem = {
  dateLabel: string;
  titleLabel: string;
  clientDemand: string;
  clientReports: string;
  relevantQuotes: string;
  supportActions: string;
  supportResults: string;
};

export type ReportDraft = {
  title: string;
  subtitle: string;
  periodSummary: string;
  clientName: string;
  moduleAudited: string;
  emissionDate: string;
  status: string;
  groupCreatedAt: string;
  envolvidos: Envolvido[];
  demands: DemandItem[];
  currentSituation: string;
  pendingItems: string;
  executiveSummary: string;
  mainThemes: string;
  actionsExecuted: string;
  currentPendencies: string;
  attachmentNotes: string;
};

const SUPPORT_ORG = "Amigo Flow";
const CLIENT_ORG = "Clínica Contratante";

// ============================================================
// TEXT SANITIZATION
// ============================================================

// Remove zero-width / bidi marks that WhatsApp injects (especially around media)
// Remove emojis & non-BMP chars (helvetica from jsPDF doesn't render them — they appear as garbage / weird spacing)
function sanitize(input: string): string {
  if (!input) return "";
  let s = input;
  // Bidi & zero-width
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  // Surrogate pairs (most emojis live in non-BMP range)
  s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  // Symbol / emoji-ish chars that ARE in BMP
  s = s.replace(/[\u2600-\u27BF\u2300-\u23FF\u2B00-\u2BFF\u3000-\u303F]/g, "");
  s = s.replace(/[\u{1F000}-\u{1FFFF}]/gu, "");
  // Replace any control chars
  s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
  return s;
}

const MEDIA_EXT_RE =
  "jpe?g|png|webp|gif|bmp|heic|heif|mp4|mov|3gp|webm|opus|ogg|mp3|m4a|wav|aac|flac|pdf|docx?|xlsx?|pptx?";

// Strip WhatsApp / app-generated media markers. Returns clean text plus
// any matched filenames (used to look up AI insights).
function stripMediaTokens(input: string): { text: string; filenames: string[]; kinds: string[] } {
  let s = sanitize(input);
  const filenames: string[] = [];
  const kinds: string[] = [];

  // Bracket prefix produced by our parser: "[Imagem enviado pela clínica] ..."
  s = s.replace(
    /\[\s*(Imagem|Imagens|Foto|V[ií]deo|[ÁA]udio|Documento(?:\/PDF)?|PDF|Anexo)[^\]]*\]/gi,
    (_m, k: string) => {
      kinds.push(k.toLowerCase());
      return "";
    },
  );

  // WhatsApp native placeholders
  s = s.replace(
    /<\s*(?:M[íi]dia oculta|arquivo de m[íi]dia oculto|Media omitted|image omitted|video omitted|audio omitted|sticker omitted|document omitted)\s*>/gi,
    "",
  );
  s = s.replace(/<[^>]{1,40}>/g, "");

  // Bare filenames
  s = s.replace(new RegExp(`\\b([\\w.\\-]+\\.(?:${MEDIA_EXT_RE}))\\b`, "gi"), (_m, fn: string) => {
    filenames.push(fn);
    return "";
  });

  // "(arquivo anexado)" / "(arquivo)"
  s = s.replace(/\(\s*arquivo(?:\s+anexado)?\s*\)/gi, "");

  return { text: s.replace(/\s+/g, " ").trim(), filenames, kinds };
}

function extKind(filename: string): "image" | "audio" | "video" | "document" {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif"].includes(ext)) return "image";
  if (["mp4", "mov", "3gp", "webm"].includes(ext)) return "video";
  if (["opus", "ogg", "mp3", "m4a", "wav", "aac", "flac"].includes(ext)) return "audio";
  return "document";
}

const KIND_LABEL: Record<string, string> = {
  image: "imagem",
  imagem: "imagem",
  imagens: "imagem",
  foto: "imagem",
  audio: "áudio",
  áudio: "áudio",
  video: "vídeo",
  vídeo: "vídeo",
  document: "documento",
  documento: "documento",
  "documento/pdf": "documento",
  pdf: "documento",
  anexo: "anexo",
};

function kindLabel(k: string): string {
  return KIND_LABEL[k.toLowerCase()] ?? "anexo";
}

// ============================================================
// INSIGHT MAP (AI-interpreted attachments)
// ============================================================

type InsightMap = Map<string, AttachmentInsight>;

function buildInsightMap(insights: AttachmentInsight[]): InsightMap {
  const map = new Map<string, AttachmentInsight>();
  for (const i of insights) {
    if (!i?.name) continue;
    const base = i.name.split(/[\\/]/).pop()?.toLowerCase();
    if (base) map.set(base, i);
    map.set(i.name.toLowerCase(), i);
  }
  return map;
}

// Build one short attachment-context line for a demand.
// If no AI insight was uploaded for a given file, we DO NOT invent generic
// "X imagens enviadas como contexto" — the report focuses only on the .txt
// when the user didn't import the media folder.
function buildAttachmentContext(
  filenames: string[],
  _kinds: string[],
  insightMap: InsightMap,
): string {
  if (!insightMap.size) return "";
  const items: string[] = [];
  for (const fn of filenames.slice(0, 6)) {
    const ins = insightMap.get(fn.toLowerCase());
    if (ins?.summary) {
      items.push(`${kindLabel(ins.type)}: ${sanitize(ins.summary).slice(0, 220)}`);
    }
  }
  if (!items.length) return "";
  return `Anexos interpretados pela IA — ${items.join(" | ")}`;
}

// ============================================================
// BUILD DRAFT
// ============================================================

export function buildDraft(
  a: Analysis,
  sourceName: string,
  attachmentInsights: AttachmentInsight[] = [],
): ReportDraft {
  const title = sanitize(
    (a.groupName && a.groupName.trim()) || sourceName.replace(/\.[^.]+$/, ""),
  );
  const cv = a.closureVerdict;
  const status =
    cv?.recommendation === "manter_aberto"
      ? "Em acompanhamento"
      : cv?.recommendation === "pode_encerrar"
        ? "Apto a encerramento"
        : "Em avaliação";

  const insightMap = buildInsightMap(attachmentInsights);

  // Envolvidos
  const supportSeen = new Map<string, Envolvido>();
  const clientSeen = new Map<string, Envolvido>();
  for (const p of a.participants) {
    const supportName = getAmigoFlowSupportName(p.name);
    if (supportName) {
      supportSeen.set(supportName, {
        name: supportName,
        org: SUPPORT_ORG,
        role: `Suporte/Implantação · ${p.demandsResolved} devolutiva(s)`,
      });
    } else if (p.messageCount > 0) {
      clientSeen.set(p.name, {
        name: sanitize(p.name),
        org: CLIENT_ORG,
        role: `Solicitante · ${p.demandsRequested} demanda(s)`,
      });
    }
  }
  const envolvidos = [...clientSeen.values()]
    .slice(0, 8)
    .concat([...supportSeen.values()].slice(0, 8));

  const demands = buildDemandBlocks(a, insightMap);

  // Last contact lines
  const lastClient = [...a.messages]
    .reverse()
    .find(
      (m) => !m.isSystem && !getAmigoFlowSupportName(m.author) && !isGreetingOrNoise(m.content),
    );
  const lastSupport = [...a.messages]
    .reverse()
    .find((m) => !m.isSystem && getAmigoFlowSupportName(m.author) && !isGreetingOrNoise(m.content));

  const cleanContent = (s: string) => stripMediaTokens(s).text.slice(0, 200);

  const pending = a.demands.filter((d) => d.status === "pendente");
  const resolved = a.demands.filter((d) => d.status === "resolvido");
  const themes = inferThemes(a);

  const resolverCounts = new Map<string, number>();
  for (const d of resolved) {
    if (!d.resolvedBy) continue;
    resolverCounts.set(d.resolvedBy, (resolverCounts.get(d.resolvedBy) ?? 0) + 1);
  }
  const actionsExecuted = [...resolverCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `• ${name} registrou ${n} devolutiva(s) ao longo do período.`)
    .join("\n");

  const attachmentNotes = attachmentInsights.length
    ? attachmentInsights
        .slice(0, 12)
        .map((i) => `• ${kindLabel(i.type)}: ${sanitize(i.summary).slice(0, 220)}`)
        .join("\n")
    : attachmentSummaryFromCounts(a);

  return {
    title,
    subtitle: "Mapeamento Sequencial de Chamados, Soluções Técnicas e Parecer de Auditoria",
    periodSummary: `Período analisado: ${fmtDateOnly(a.firstDate)} a ${fmtDateOnly(a.lastDate)}. Foram identificadas ${a.demandStats.total} demanda(s), sendo ${a.demandStats.resolvidas} resolvida(s) e ${a.demandStats.pendentes} pendente(s).`,
    clientName: title,
    moduleAudited: "Agente Flow / WhatsApp",
    emissionDate: new Date().toLocaleDateString("pt-BR"),
    status,
    groupCreatedAt: fmtDateOnly(a.groupCreatedAt ?? a.firstDate ?? null),
    envolvidos,
    demands,
    currentSituation: [
      lastClient
        ? `Último contato do cliente em ${fmtDateOnly(lastClient.date)}: ${cleanContent(lastClient.content) || "(mensagem com anexo)"}`
        : "Sem contato recente do cliente identificado.",
      lastSupport
        ? `Última devolutiva da equipe Amigo Flow em ${fmtDateOnly(lastSupport.date)}: ${cleanContent(lastSupport.content) || "(mensagem com anexo)"}`
        : "Sem devolutiva recente da equipe Amigo Flow identificada.",
      cv
        ? `Parecer das últimas duas semanas: ${sanitize(cv.reasons.join(" "))}`
        : "Janela insuficiente para parecer automatizado.",
    ].join("\n"),
    pendingItems: pending.length
      ? pending
          .slice(0, 8)
          .map((d) => {
            const c = cleanContent(d.message);
            return `• ${fmtDateOnly(d.date)} — ${c || "(demanda registrada apenas com anexo)"}`;
          })
          .join("\n")
      : "Não foram identificadas pendências críticas abertas no histórico analisado.",
    executiveSummary:
      "A auditoria consolidou as solicitações da clínica e as devolutivas registradas pela equipe Amigo Flow. O foco do relatório é evidenciar demandas relevantes, ações realizadas, validações e pendências atuais sem reproduzir mensagens de saudação ou interações sem valor operacional.",
    mainThemes: themes.length
      ? themes.map((t) => `• ${t}`).join("\n")
      : "• Não houve concentração temática suficiente para classificação automática.",
    actionsExecuted:
      actionsExecuted ||
      "• Não foram identificadas ações conclusivas registradas pela equipe Amigo Flow.",
    currentPendencies: [
      pending.length
        ? `• ${pending.length} demanda(s) aguardam retorno ou validação.`
        : "• Sem pendência crítica identificada.",
      cv?.recommendation === "pode_encerrar"
        ? "• Grupo com indícios de encerramento possível, sujeito à validação interna."
        : "• Recomenda-se manter acompanhamento até confirmação formal das pendências.",
    ].join("\n"),
    attachmentNotes,
  };
}

// ============================================================
// DEMAND BLOCKS (compact, deduplicated, one per day)
// ============================================================

function buildDemandBlocks(a: Analysis, insightMap: InsightMap): DemandItem[] {
  // Group by date
  const grouped = new Map<string, Demand[]>();
  for (const d of a.demands) {
    const key = d.date.toISOString().slice(0, 10);
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }

  // Take the 8 most recent active days
  return [...grouped.entries()]
    .sort(([aKey], [bKey]) => bKey.localeCompare(aKey))
    .slice(0, 8)
    .reverse()
    .map(([key, items]) => buildOneBlock(key, items, insightMap));
}

function buildOneBlock(key: string, items: Demand[], insightMap: InsightMap): DemandItem {
  const date = new Date(`${key}T12:00:00`);

  // Clean each demand: strip media tokens, collect attachment context
  const cleanedItems = items.map((d) => {
    const r = stripMediaTokens(d.message);
    return { ...d, cleanText: r.text, filenames: r.filenames, kinds: r.kinds };
  });

  // Dedupe textual bullets by first 60 chars (case-insensitive)
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const ci of cleanedItems) {
    const t = ci.cleanText;
    if (!t || t.length < 4) continue;
    const sig = t.slice(0, 60).toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    bullets.push(`• ${t.slice(0, 180)}`);
    if (bullets.length >= 6) break;
  }

  // Attachment context (one line)
  const allFilenames = cleanedItems.flatMap((c) => c.filenames);
  const allKinds = cleanedItems.flatMap((c) => c.kinds);
  const attachLine = buildAttachmentContext(allFilenames, allKinds, insightMap);

  // Compose client demands area
  const demandLines: string[] = [];
  if (bullets.length) demandLines.push(...bullets);
  else demandLines.push("• Solicitações registradas apenas por meio de anexos (sem texto).");
  if (attachLine) demandLines.push(`• ${attachLine}`);

  // Counts
  const pending = items.filter((d) => d.status === "pendente").length;
  const resolved = items.filter((d) => d.status === "resolvido");
  const reportLine = pending
    ? `${pending} item(ns) sem resolução explícita até o fechamento da auditoria.`
    : "Todas as solicitações do dia possuem devolutiva vinculada.";

  // Aggregate devolutivas (one line per resolver with count)
  const counts = new Map<string, number>();
  for (const r of resolved) {
    if (!r.resolvedBy) continue;
    counts.set(r.resolvedBy, (counts.get(r.resolvedBy) ?? 0) + 1);
  }
  const supportActions = counts.size
    ? [...counts.entries()]
        .map(([name, n]) => `• ${name} registrou ${n} devolutiva(s) neste dia.`)
        .join("\n")
    : "• Não foi identificada devolutiva da equipe Amigo Flow vinculada a este dia.";

  const supportResults = resolved.length
    ? "Resultado: atendimentos com registro de ação, orientação ou validação pela equipe Amigo Flow."
    : "Resultado: pendente de retorno, validação ou posicionamento interno.";

  // Title: first non-empty bullet
  const title = (bullets[0] ?? attachLine ?? "Demanda do cliente")
    .replace(/^•\s*/, "")
    .slice(0, 80);

  return {
    dateLabel: fmtDateOnly(date),
    titleLabel: title.charAt(0).toUpperCase() + title.slice(1),
    clientDemand: demandLines.join("\n"),
    clientReports: reportLine,
    relevantQuotes: "",
    supportActions,
    supportResults,
  };
}

// ============================================================
// PDF RENDERING
// ============================================================

export function generatePdf(draft: ReportDraft): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ----- Header
  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  y = centered(doc, sanitize(draft.title), y + 4, contentW, pageW / 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  y = centered(doc, sanitize(draft.subtitle), y + 6, contentW, pageW / 2) + 10;
  y = paragraph(doc, sanitize(draft.periodSummary), margin, y, contentW, 9.5, "normal") + 12;

  // ----- Identification table
  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 6, valign: "top", lineColor: [220, 220, 220] },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: SOFT, cellWidth: 125 },
      2: { fontStyle: "bold", fillColor: SOFT, cellWidth: 120 },
    },
    body: [
      ["Cliente Contratante", sanitize(draft.clientName), "Data de Emissão", draft.emissionDate],
      ["Módulo Auditado", draft.moduleAudited, "Status Atual", draft.status],
      ["Data de Início do Grupo", draft.groupCreatedAt, "", ""],
    ],
    margin: { left: margin, right: margin },
  });
  y = lastY(doc) + 20;

  // ----- Envolvidos
  if (draft.envolvidos.length) {
    y = sectionTitle(
      doc,
      "1. Contratantes, Colaboradores e Equipe de Suporte Cadastrados",
      margin,
      y,
      contentW,
    );
    autoTable(doc, {
      startY: y,
      head: [["Nome do Envolvido", "Organização", "Papel / Atribuição no Processo"]],
      body: draft.envolvidos.map((p) => [sanitize(p.name), p.org, sanitize(p.role)]),
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8.8, halign: "left" },
      styles: { fontSize: 8.8, cellPadding: 5, valign: "top" },
      columnStyles: {
        0: { cellWidth: 145, fontStyle: "bold" },
        1: { cellWidth: 105 },
        2: { cellWidth: contentW - 250 },
      },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 18;
  }

  // ----- Demands
  y = sectionTitle(doc, "2. Demandas do Cliente e Retorno/Ações Realizadas", margin, y, contentW);
  for (const d of draft.demands) {
    y = demandBlock(doc, d, margin, y, contentW);
  }

  // ----- Sections 3-5
  y = sectionTitle(doc, "3. Situação Atual", margin, y, contentW);
  y = paragraph(doc, sanitize(draft.currentSituation), margin, y, contentW, 9.3) + 10;

  y = sectionTitle(doc, "4. Pendências", margin, y, contentW);
  y = paragraph(doc, sanitize(draft.pendingItems), margin, y, contentW, 9.3) + 10;

  y = sectionTitle(doc, "5. Resumo Executivo", margin, y, contentW);
  y = titledParagraph(doc, "Síntese", sanitize(draft.executiveSummary), margin, y, contentW);
  y = titledParagraph(
    doc,
    "Principais Temas Identificados",
    sanitize(draft.mainThemes),
    margin,
    y,
    contentW,
  );
  y = titledParagraph(
    doc,
    "Ações Executadas",
    sanitize(draft.actionsExecuted),
    margin,
    y,
    contentW,
  );
  y = titledParagraph(
    doc,
    "Pendências Atuais",
    sanitize(draft.currentPendencies),
    margin,
    y,
    contentW,
  );
  if (draft.attachmentNotes.trim())
    titledParagraph(
      doc,
      "Imagens, Áudios e Documentos Considerados",
      sanitize(draft.attachmentNotes),
      margin,
      y,
      contentW,
    );

  // ----- Footer with page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.setFont("helvetica", "normal");
    doc.text("Auditoria Flow - Amigo - v1", margin, pageH - 20);
    doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 20, { align: "right" });
  }
  return doc;
}

function demandBlock(doc: jsPDF, d: DemandItem, x: number, y: number, w: number): number {
  y = ensureSpace(doc, y, 120, x);
  doc.setFillColor(...SOFT);
  doc.setDrawColor(220, 230, 222);
  doc.roundedRect(x, y, w, 22, 3, 3, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...BRAND);
  doc.text(`Data (${d.dateLabel})`, x + 10, y + 15);
  y += 32;

  const demandText = [d.clientDemand, d.clientReports].filter(Boolean).join("\n");
  y = titledParagraph(doc, "Demandas do Cliente", sanitize(demandText), x, y, w);

  const actionsText = [d.supportActions, d.supportResults].filter(Boolean).join("\n");
  y = titledParagraph(doc, "Retorno/Ações Realizadas", sanitize(actionsText), x, y, w);
  return y + 6;
}

function titledParagraph(
  doc: jsPDF,
  title: string,
  text: string,
  x: number,
  y: number,
  w: number,
): number {
  y = ensureSpace(doc, y, 38, x);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.6);
  doc.setTextColor(...TEXT);
  doc.text(title, x, y);
  return paragraph(doc, text || "—", x, y + 12, w, 9.2) + 8;
}

function paragraph(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  w: number,
  size: number,
  style: "normal" | "bold" = "normal",
): number {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...TEXT);
  for (const raw of text.split("\n")) {
    const lines = doc.splitTextToSize(raw || " ", w);
    for (const line of lines) {
      y = ensureSpace(doc, y, 14, x);
      doc.text(line, x, y);
      y += size + 3.2;
    }
  }
  return y;
}

function centered(doc: jsPDF, text: string, y: number, w: number, centerX: number): number {
  const lines = doc.splitTextToSize(text, w);
  for (const line of lines.slice(0, 3)) {
    doc.text(line, centerX, y, { align: "center" });
    y += 14;
  }
  return y;
}

function sectionTitle(doc: jsPDF, t: string, x: number, y: number, w: number): number {
  y = ensureSpace(doc, y, 36, x);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND);
  doc.text(t, x, y);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.6);
  doc.line(x, y + 4, x + w, y + 4);
  return y + 18;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, margin: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 42) {
    doc.addPage();
    return margin;
  }
  return y;
}

function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function inferThemes(a: Analysis): string[] {
  const corpus = a.messages.map((m) => m.content.toLowerCase()).join(" ");
  const themes = [
    [/agend|agenda|hor[aá]rio|marcação/, "Problemas ou ajustes de agendamento"],
    [/conv[eê]nio|plano|guia|autoriza/, "Regras de convênio e autorização"],
    [/flow|clinic|sincron|integra/, "Integração entre Flow e Amigo Clinic"],
    [
      /finance|boleto|pagamento|cobran|nota fiscal|contrato/,
      "Contestação financeira ou encaminhamento administrativo",
    ],
    [
      /implanta|treinamento|acompanhamento|valida/,
      "Acompanhamento de implantação e validação operacional",
    ],
    [
      /exame|procedimento|grade|exceção|profissional/,
      "Ajustes de exames, procedimentos, grades ou profissionais",
    ],
  ] as const;
  return themes.filter(([re]) => re.test(corpus)).map(([, label]) => label);
}

function attachmentSummaryFromCounts(a: Analysis): string {
  const parts = [
    a.mediaCount.image ? `${a.mediaCount.image} imagem(ns)` : "",
    a.mediaCount.audio ? `${a.mediaCount.audio} áudio(s)` : "",
    a.mediaCount.document ? `${a.mediaCount.document} documento(s)/PDF(s)` : "",
    a.mediaCount.video ? `${a.mediaCount.video} vídeo(s)` : "",
  ].filter(Boolean);
  return parts.length ? `Foram identificados anexos no histórico: ${parts.join(", ")}.` : "";
}

export const fixedSupportTeamForDisplay = AMIGO_FLOW_SUPPORT_TEAM;
