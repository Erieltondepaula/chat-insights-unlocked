import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AMIGO_FLOW_SUPPORT_TEAM,
  getAmigoFlowSupportName,
  isGreetingOrNoise,
  type Analysis,
  type Demand,
} from "./whatsapp-parser";

// Palette tuned to the v2 reference layout
const NAVY: [number, number, number] = [14, 58, 95]; // #0E3A5F — titles, section headers
const NAVY_DEEP: [number, number, number] = [26, 61, 110]; // #1A3D6E — table header
const BLUE: [number, number, number] = [46, 111, 184]; // #2E6FB8 — accent bars, links
const TEXT: [number, number, number] = [38, 47, 60]; // body text
const MUTED: [number, number, number] = [110, 120, 132];
const INFO_BG: [number, number, number] = [238, 243, 248]; // #EEF3F8 — info / chip bg
const RES_BG: [number, number, number] = [234, 242, 251]; // #EAF2FB — resolution sub-box
const RES_BORDER: [number, number, number] = [185, 211, 235];
const ALERT_BG: [number, number, number] = [253, 235, 235];
const ALERT_BORDER: [number, number, number] = [192, 57, 43];
const DATE_RED: [number, number, number] = [192, 57, 43];
const RULE: [number, number, number] = [221, 228, 236];


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
  // Group by date (chronological)
  const grouped = new Map<string, Demand[]>();
  for (const d of a.demands) {
    const key = d.date.toISOString().slice(0, 10);
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }

  return [...grouped.entries()]
    .sort(([aKey], [bKey]) => aKey.localeCompare(bKey))
    .map(([key, items]) => buildOneBlock(key, items, insightMap));
}

function buildOneBlock(key: string, items: Demand[], insightMap: InsightMap): DemandItem {
  const date = new Date(`${key}T12:00:00`);

  // Clean each demand: strip media tokens, collect attachment context
  const cleanedItems = items.map((d) => {
    const r = stripMediaTokens(d.message);
    const rr = d.resolutionMessage
      ? stripMediaTokens(d.resolutionMessage)
      : { text: "", filenames: [] as string[], kinds: [] as string[] };
    return {
      ...d,
      cleanText: r.text,
      filenames: r.filenames,
      kinds: r.kinds,
      cleanResolution: rr.text,
      resolutionFilenames: rr.filenames,
    };
  });

  // Dedupe demand bullets by first 80 chars
  const seenDemand = new Set<string>();
  const demandBullets: string[] = [];
  for (const ci of cleanedItems) {
    const t = ci.cleanText;
    if (!t || t.length < 4) continue;
    const sig = t.slice(0, 80).toLowerCase();
    if (seenDemand.has(sig)) continue;
    seenDemand.add(sig);
    demandBullets.push(`• ${t.slice(0, 260)}`);
  }

  // Attachment context (only if AI insights exist for these files)
  const allFilenames = cleanedItems.flatMap((c) => [...c.filenames, ...c.resolutionFilenames]);
  const allKinds = cleanedItems.flatMap((c) => c.kinds);
  const attachLine = buildAttachmentContext(allFilenames, allKinds, insightMap);

  const demandLines: string[] = [];
  if (demandBullets.length) demandLines.push(...demandBullets);
  else demandLines.push("• Solicitações registradas apenas por anexo, sem texto correspondente.");
  if (attachLine) demandLines.push(`• ${attachLine}`);

  // Counts
  const pending = items.filter((d) => d.status === "pendente").length;
  const resolved = cleanedItems.filter((d) => d.status === "resolvido");
  const reportLine = pending
    ? `${pending} item(ns) sem resolução explícita até o fechamento da auditoria.`
    : "Todas as solicitações do dia possuem devolutiva vinculada.";

  // Regex local para descartar devolutivas/respostas que falem apenas de link
  const LINK_TXT = /\blink\b|https?:\/\/|\bwww\./i;

  // List EVERY devolutiva with its actual text (deduped by first 80 chars)
  const seenResp = new Set<string>();
  const responseLines: string[] = [];
  for (const r of resolved) {
    const who = r.resolvedBy ?? "Equipe Amigo Flow";
    const txt = r.cleanResolution;
    if (txt && LINK_TXT.test(txt)) continue; // ignora devolutivas sobre link
    if (txt) {
      const sig = `${who}|${txt.slice(0, 80).toLowerCase()}`;
      if (seenResp.has(sig)) continue;
      seenResp.add(sig);
      let line = `• ${who}: ${txt.slice(0, 320)}`;
      if (r.clientFollowUp && !LINK_TXT.test(r.clientFollowUp)) {
        line += `\n   ↳ Resposta do cliente (${fmtDateOnly(r.clientFollowUpAt)}): ${r.clientFollowUp.slice(0, 280)}`;
      }
      responseLines.push(line);
    } else {
      let line = `• ${who}: (devolutiva registrada via anexo)`;
      if (r.clientFollowUp && !LINK_TXT.test(r.clientFollowUp)) {
        line += `\n   ↳ Resposta do cliente (${fmtDateOnly(r.clientFollowUpAt)}): ${r.clientFollowUp.slice(0, 280)}`;
      }
      responseLines.push(line);
    }
  }
  const supportActions = responseLines.length
    ? responseLines.join("\n")
    : "• Sem devolutiva da equipe Amigo Flow vinculada a este dia.";

  const supportResults = responseLines.length
    ? `Resultado: ${responseLines.length} devolutiva(s) registrada(s) pela equipe Amigo Flow.`
    : "Resultado: pendente de retorno, validação ou posicionamento interno.";

  // Title: first non-empty bullet
  const title = (demandBullets[0] ?? attachLine ?? "Demanda do cliente")
    .replace(/^•\s*/, "")
    .slice(0, 90);

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

  // ----- Header: big bold navy title, left-aligned subtitle, info box
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  const titleLines = doc.splitTextToSize(sanitize(draft.title), contentW);
  for (const line of titleLines.slice(0, 3)) {
    doc.text(line, margin, y + 18);
    y += 24;
  }
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...MUTED);
  doc.text(sanitize(draft.subtitle), margin, y);
  y += 18;

  // Info box (light grey-blue bg, no borders, two columns)
  const infoRows: [string, string, string, string][] = [
    ["Cliente Contratante:", sanitize(draft.clientName), "Data de Emissão:", draft.emissionDate],
    ["Módulo Auditado:", draft.moduleAudited, "Status Atual:", draft.status],
    ["Data de Início do Grupo:", draft.groupCreatedAt, "", ""],
  ];
  const infoRowH = 26;
  const infoH = infoRows.length * infoRowH + 10;
  doc.setFillColor(...INFO_BG);
  doc.roundedRect(margin, y, contentW, infoH, 4, 4, "F");
  let infoY = y + 18;
  const colW = contentW / 2;
  for (const [l1, v1, l2, v2] of infoRows) {
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(l1, margin + 12, infoY);
    const l1W = doc.getTextWidth(l1) + 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT);
    const v1Lines = doc.splitTextToSize(sanitize(v1), colW - 24 - l1W);
    doc.text(v1Lines[0] ?? "", margin + 12 + l1W, infoY);
    if (l2) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...NAVY);
      doc.text(l2, margin + colW + 6, infoY);
      const l2W = doc.getTextWidth(l2) + 4;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TEXT);
      const v2Lines = doc.splitTextToSize(sanitize(v2), colW - 18 - l2W);
      doc.text(v2Lines[0] ?? "", margin + colW + 6 + l2W, infoY);
    }
    infoY += infoRowH;
  }
  y += infoH + 6;

  // thin blue rule like the reference
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.8);
  doc.line(margin, y, margin + contentW, y);
  y += 18;

  // Period summary (small, muted)
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  for (const ln of doc.splitTextToSize(sanitize(draft.periodSummary), contentW)) {
    doc.text(ln, margin, y);
    y += 12;
  }
  y += 8;

  // ----- Envolvidos
  if (draft.envolvidos.length) {
    y = sectionTitle(doc, "1. Contratantes, Colaboradores e Equipe de Suporte", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Nome do Envolvido", "Organização", "Papel / Atribuição no Processo"]],
      body: draft.envolvidos.map((p) => [sanitize(p.name), p.org, sanitize(p.role)]),
      headStyles: {
        fillColor: NAVY_DEEP,
        textColor: 255,
        fontSize: 9.5,
        fontStyle: "bold",
        halign: "left",
        cellPadding: 7,
      },
      styles: {
        fontSize: 9.2,
        cellPadding: 7,
        valign: "top",
        lineColor: RULE,
        textColor: TEXT,
      },
      columnStyles: {
        0: { cellWidth: 150, fontStyle: "bold" },
        1: { cellWidth: 110, fillColor: INFO_BG, textColor: BLUE, fontStyle: "bold" },
        2: { cellWidth: contentW - 260 },
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 22;
  }


  // ----- Demands
  y = sectionTitle(doc, "2. Relatório Detalhado de Demandas e Resoluções Técnicas", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.3);
  doc.setTextColor(...TEXT);
  const introLines = doc.splitTextToSize(
    "Abaixo constam, de forma sequencial, os principais incidentes reportados pela clínica, acompanhados de suas respectivas datas de abertura, descrições e devolutivas registradas pela equipe Amigo Flow.",
    contentW,
  );
  for (const ln of introLines) {
    doc.text(ln, margin, y);
    y += 12;
  }
  y += 6;
  for (const d of draft.demands) {
    y = demandBlock(doc, d, margin, y, contentW);
  }

  // ----- Sections 3-5
  y = sectionTitle(doc, "3. Situação Atual", margin, y);
  y = paragraph(doc, sanitize(draft.currentSituation), margin, y, contentW, 9.3) + 10;

  y = sectionTitle(doc, "4. Pendências", margin, y);
  y = paragraph(doc, sanitize(draft.pendingItems), margin, y, contentW, 9.3) + 10;

  y = sectionTitle(doc, "5. Resumo Executivo", margin, y);
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
  const footerLabel = `Auditoria Amigo Flow — ${sanitize(draft.title)}`.slice(0, 90);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.4);
    doc.line(margin, pageH - 30, pageW - margin, pageH - 30);
    doc.text(footerLabel, margin, pageH - 18);
    doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 18, { align: "right" });
  }
  return doc;
}

// ============================================================
// DEMAND CARD: blue left bar, date chip in red, ocorrência + resolução sub-box
// ============================================================
function demandBlock(doc: jsPDF, d: DemandItem, x: number, y: number, w: number): number {
  // Measure all content first to know card height
  const innerX = x + 14;
  const innerW = w - 22;

  const titleText = sanitize(d.titleLabel || "Demanda do cliente");
  const occText = sanitize(
    [d.clientDemand, d.clientReports].filter(Boolean).join("\n"),
  );
  const resText = sanitize([d.supportActions, d.supportResults].filter(Boolean).join("\n"));

  // pre-compute wrapped sizes
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  const titleLines = doc.splitTextToSize(titleText, innerW - 100);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.4);
  const occLines = wrapMultiline(doc, occText, innerW);

  doc.setFontSize(9.2);
  const resLines = wrapMultiline(doc, resText, innerW - 16);

  const headerH = 16 + titleLines.length * 13;
  const occH = 14 + occLines.length * 12 + 8;
  const resH = 14 + resLines.length * 11.5 + 12;
  const cardH = headerH + occH + resH + 10;

  y = ensureSpace(doc, y, cardH + 8, x);

  // Card background + left blue bar
  doc.setDrawColor(...RULE);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, cardH, 3, 3, "FD");
  doc.setFillColor(...BLUE);
  doc.rect(x, y, 4, cardH, "F");

  // Header line: [DATA] Title
  let cy = y + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...DATE_RED);
  const dateLabel = `[${d.dateLabel}]`;
  doc.text(dateLabel, innerX, cy);
  const dateW = doc.getTextWidth(dateLabel) + 8;

  doc.setTextColor(...NAVY);
  doc.setFontSize(10.5);
  let tx = innerX + dateW;
  let ty = cy;
  for (const tl of titleLines) {
    doc.text(tl, tx, ty);
    ty += 13;
    tx = innerX; // continuation lines align to inner left
  }
  cy = Math.max(cy + 13, ty);
  cy += 4;

  // Ocorrência paragraph
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.4);
  doc.setTextColor(...NAVY);
  doc.text("Ocorrência:", innerX, cy);
  const ocLabelW = doc.getTextWidth("Ocorrência:") + 5;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT);
  // first line shares row with the label
  const firstOcLine = occLines[0] ?? "";
  const firstSlice = doc.splitTextToSize(firstOcLine, innerW - ocLabelW)[0] ?? firstOcLine;
  doc.text(firstSlice, innerX + ocLabelW, cy);
  // remaining occLines render below
  const remaining = occLines.slice(1);
  if (firstSlice !== firstOcLine) {
    const leftover = firstOcLine.slice(firstSlice.length).trim();
    if (leftover) remaining.unshift(leftover);
  }
  cy += 13;
  for (const ln of remaining) {
    doc.text(ln, innerX, cy);
    cy += 12;
  }
  cy += 4;

  // Resolution sub-box
  const resBoxX = innerX;
  const resBoxW = innerW;
  const resBoxH = 12 + resLines.length * 11.5 + 8;
  doc.setFillColor(...RES_BG);
  doc.setDrawColor(...RES_BORDER);
  doc.roundedRect(resBoxX, cy, resBoxW, resBoxH, 2, 2, "FD");
  let ry = cy + 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.2);
  doc.setTextColor(...NAVY);
  doc.text("Resolução:", resBoxX + 8, ry);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT);
  const resLabelW = doc.getTextWidth("Resolução:") + 5;
  const firstRes = resLines[0] ?? "";
  const firstResSlice = doc.splitTextToSize(firstRes, resBoxW - resLabelW - 16)[0] ?? firstRes;
  doc.text(firstResSlice, resBoxX + 8 + resLabelW, ry);
  const restRes = resLines.slice(1);
  if (firstResSlice !== firstRes) {
    const leftover = firstRes.slice(firstResSlice.length).trim();
    if (leftover) restRes.unshift(leftover);
  }
  ry += 12;
  for (const ln of restRes) {
    doc.text(ln, resBoxX + 8, ry);
    ry += 11.5;
  }

  return y + cardH + 12;
}

function wrapMultiline(doc: jsPDF, text: string, w: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) continue;
    const lines = doc.splitTextToSize(para, w) as string[];
    out.push(...lines);
  }
  return out;
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

// Section title styled like the reference: blue left bar + navy bold heading
function sectionTitle(doc: jsPDF, t: string, x: number, y: number): number {
  y = ensureSpace(doc, y, 36, x);
  const h = 18;
  doc.setFillColor(...BLUE);
  doc.rect(x, y - 2, 4, h, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...NAVY);
  doc.text(sanitize(t), x + 12, y + 12);
  return y + h + 10;
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
