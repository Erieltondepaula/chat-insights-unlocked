import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AMIGO_FLOW_SUPPORT_TEAM,
  getAmigoFlowSupportName,
  isGreetingOrNoise,
  type Analysis,
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

export function buildDraft(
  a: Analysis,
  sourceName: string,
  attachmentInsights: AttachmentInsight[] = [],
): ReportDraft {
  const title = (a.groupName && a.groupName.trim()) || sourceName.replace(/\.[^.]+$/, "");
  const cv = a.closureVerdict;
  const status =
    cv?.recommendation === "manter_aberto"
      ? "Em acompanhamento"
      : cv?.recommendation === "pode_encerrar"
        ? "Apto a encerramento"
        : "Em avaliação";

  const supportSeen = new Map<string, Envolvido>();
  const clientSeen = new Map<string, Envolvido>();
  for (const p of a.participants) {
    const supportName = getAmigoFlowSupportName(p.name);
    if (supportName) {
      supportSeen.set(supportName, {
        name: supportName,
        org: SUPPORT_ORG,
        role: `Suporte/Implantação · ${p.demandsResolved} devolutiva(s) · ${p.messageCount} msg`,
      });
    } else if (p.messageCount > 0) {
      clientSeen.set(p.name, {
        name: p.name,
        org: CLIENT_ORG,
        role: `Solicitante · ${p.demandsRequested} demanda(s) · ${p.messageCount} msg`,
      });
    }
  }

  const envolvidos = [...clientSeen.values()]
    .slice(0, 10)
    .concat([...supportSeen.values()].slice(0, 8));
  const demands = buildDemandBlocks(a, attachmentInsights);

  const lastClient = [...a.messages]
    .reverse()
    .find(
      (m) => !m.isSystem && !getAmigoFlowSupportName(m.author) && !isGreetingOrNoise(m.content),
    );
  const lastSupport = [...a.messages]
    .reverse()
    .find((m) => !m.isSystem && getAmigoFlowSupportName(m.author) && !isGreetingOrNoise(m.content));
  const pending = a.demands.filter((d) => d.status === "pendente");
  const resolved = a.demands.filter((d) => d.status === "resolvido");
  const themes = inferThemes(a);
  const attachmentNotes = attachmentInsights.length
    ? attachmentInsights.map((i) => `• ${i.name}: ${i.summary}`).join("\n")
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
        ? `Último contato do cliente em ${fmtDateOnly(lastClient.date)}: ${cleanMsg(lastClient.content)}`
        : "Sem contato recente do cliente identificado.",
      lastSupport
        ? `Última devolutiva da equipe Amigo Flow em ${fmtDateOnly(lastSupport.date)}: ${cleanMsg(lastSupport.content)}`
        : "Sem devolutiva recente da equipe Amigo Flow identificada.",
      cv
        ? `Parecer das últimas duas semanas: ${cv.reasons.join(" ")}`
        : "Janela insuficiente para parecer automatizado.",
    ].join("\n"),
    pendingItems: pending.length
      ? pending
          .slice(0, 8)
          .map((d) => `• ${fmtDateOnly(d.date)} — ${cleanMsg(d.message)}`)
          .join("\n")
      : "Não foram identificadas pendências críticas abertas no histórico analisado.",
    executiveSummary: `A auditoria consolidou as solicitações da clínica e as devolutivas registradas pela equipe Amigo Flow. O foco do relatório é evidenciar demandas relevantes, ações realizadas, validações e pendências atuais sem reproduzir mensagens de saudação ou interações sem valor operacional.`,
    mainThemes: themes.length
      ? themes.map((t) => `• ${t}`).join("\n")
      : "• Não houve concentração temática suficiente para classificação automática.",
    actionsExecuted: resolved.length
      ? resolved
          .slice(0, 8)
          .map(
            (d) =>
              `• ${fmtDateOnly(d.resolvedAt)} — Devolutiva registrada por ${d.resolvedBy}: ${shortTitle(d.message)}`,
          )
          .join("\n")
      : "• Não foram identificadas ações conclusivas registradas pela equipe Amigo Flow.",
    currentPendencies: [
      pending.length
        ? `• ${pending.length} demanda(s) aguardam retorno ou validação.`
        : "• Sem pendência crítica identificada.",
      cv?.recommendation === "pode_encerrar"
        ? "• Grupo com indícios de encerramento possível, sujeito à validação interna."
        : "• Recomenda-se manter acompanhamento até confirmação formal das pendências.",
      ...attachmentInsights
        .flatMap((i) => i.pending ?? [])
        .slice(0, 4)
        .map((p) => `• ${p}`),
    ].join("\n"),
    attachmentNotes,
  };
}

function buildDemandBlocks(a: Analysis, attachmentInsights: AttachmentInsight[]): DemandItem[] {
  const grouped = new Map<string, typeof a.demands>();
  for (const d of a.demands) {
    const key = d.date.toISOString().slice(0, 10);
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }
  return [...grouped.entries()]
    .sort(([aKey], [bKey]) => aKey.localeCompare(bKey))
    .slice(-10)
    .map(([key, items]) => {
      const date = new Date(`${key}T12:00:00`);
      const pending = items.filter((d) => d.status === "pendente");
      const resolved = items.filter((d) => d.status === "resolvido");
      const relevant = items
        .slice(0, 3)
        .map((d) => `“${cleanMsg(d.message)}” — ${d.requester}`)
        .join("\n");
      const mediaForBlock = attachmentInsights
        .slice(0, 4)
        .filter((i) => keyFromName(i.name) === key);
      return {
        dateLabel: fmtDateOnly(date),
        titleLabel: shortTitle(items[0]?.message ?? "Demanda do cliente"),
        clientDemand: items.map((d) => `• ${cleanMsg(d.message)}`).join("\n"),
        clientReports: pending.length
          ? `${pending.length} item(ns) sem resolução explícita até o fechamento da auditoria.`
          : "As solicitações do dia possuem devolutiva vinculada no histórico analisado.",
        relevantQuotes: [
          relevant,
          ...mediaForBlock.map((m) => `Anexo interpretado — ${m.name}: ${m.summary}`),
        ]
          .filter(Boolean)
          .join("\n"),
        supportActions: resolved.length
          ? resolved
              .map(
                (d) =>
                  `• ${d.resolvedBy} registrou devolutiva${d.resolvedAt ? ` em ${fmtDateOnly(d.resolvedAt)}` : ""}.`,
              )
              .join("\n")
          : "• Não foi identificada devolutiva da equipe Amigo Flow vinculada a este bloco.",
        supportResults: resolved.length
          ? "Resultado: atendimento com registro de ação, orientação ou validação pela equipe Amigo Flow."
          : "Resultado: pendente de retorno, validação ou posicionamento interno.",
      };
    });
}

export function generatePdf(draft: ReportDraft): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  y = centered(doc, draft.title, y + 4, contentW, pageW / 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...MUTED);
  y = centered(doc, draft.subtitle, y + 8, contentW, pageW / 2) + 10;
  y = paragraph(doc, draft.periodSummary, margin, y, contentW, 10, "normal") + 10;

  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9.5, cellPadding: 7, valign: "top", lineColor: [220, 220, 220] },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: SOFT, cellWidth: 125 },
      2: { fontStyle: "bold", fillColor: SOFT, cellWidth: 120 },
    },
    body: [
      ["Cliente Contratante", draft.clientName, "Data de Emissão", draft.emissionDate],
      ["Módulo Auditado", draft.moduleAudited, "Status Atual", draft.status],
      ["Data de Início do Grupo", draft.groupCreatedAt, "", ""],
    ],
    margin: { left: margin, right: margin },
  });
  y = lastY(doc) + 22;

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
      body: draft.envolvidos.map((p) => [p.name, p.org, p.role]),
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8.8, halign: "left" },
      styles: { fontSize: 8.8, cellPadding: 5, valign: "top" },
      columnStyles: {
        0: { cellWidth: 145, fontStyle: "bold" },
        1: { cellWidth: 105 },
        2: { cellWidth: contentW - 250 },
      },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 22;
  }

  y = sectionTitle(doc, "2. Demandas do Cliente e Retorno/Ações Realizadas", margin, y, contentW);
  for (const d of draft.demands) {
    y = demandBlock(doc, d, margin, y, contentW);
  }

  y = sectionTitle(doc, "3. Situação Atual", margin, y, contentW);
  y = paragraph(doc, draft.currentSituation, margin, y, contentW, 9.5) + 12;

  y = sectionTitle(doc, "4. Pendências", margin, y, contentW);
  y = paragraph(doc, draft.pendingItems, margin, y, contentW, 9.5) + 12;

  y = sectionTitle(doc, "5. Resumo Executivo", margin, y, contentW);
  y = titledParagraph(doc, "Síntese", draft.executiveSummary, margin, y, contentW);
  y = titledParagraph(doc, "Principais Temas Identificados", draft.mainThemes, margin, y, contentW);
  y = titledParagraph(doc, "Ações Executadas", draft.actionsExecuted, margin, y, contentW);
  y = titledParagraph(doc, "Pendências Atuais", draft.currentPendencies, margin, y, contentW);
  if (draft.attachmentNotes.trim())
    y = titledParagraph(
      doc,
      "Imagens, Áudios e Documentos Considerados",
      draft.attachmentNotes,
      margin,
      y,
      contentW,
    );

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.setFont("helvetica", "normal");
    doc.text(`Auditoria Flow - Amigo - v1`, margin, pageH - 20);
    doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 20, { align: "right" });
  }
  return doc;
}

function demandBlock(doc: jsPDF, d: DemandItem, x: number, y: number, w: number): number {
  y = ensureSpace(doc, y, 150, x);
  doc.setFillColor(...SOFT);
  doc.setDrawColor(220, 230, 222);
  doc.roundedRect(x, y, w, 24, 3, 3, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND);
  doc.text(`Data (${d.dateLabel})`, x + 10, y + 16);
  y += 36;
  y = titledParagraph(
    doc,
    "Demandas do Cliente",
    [d.clientDemand, d.clientReports, d.relevantQuotes].filter(Boolean).join("\n"),
    x,
    y,
    w,
  );
  y = titledParagraph(
    doc,
    "Retorno/Ações Realizadas",
    [d.supportActions, d.supportResults].filter(Boolean).join("\n"),
    x,
    y,
    w,
  );
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
  y = ensureSpace(doc, y, 45, x);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.8);
  doc.setTextColor(...TEXT);
  doc.text(title, x, y);
  return paragraph(doc, text || "—", x, y + 13, w, 9.3) + 10;
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
      y += size + 3.5;
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
  y = ensureSpace(doc, y, 40, x);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(...BRAND);
  doc.text(t, x, y);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.7);
  doc.line(x, y + 4, x + w, y + 4);
  return y + 20;
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

function cleanMsg(s: string): string {
  return s
    .replace(/<[^>]+>/g, "[anexo]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
}

function shortTitle(s: string): string {
  const t = cleanMsg(s).slice(0, 74);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function keyFromName(name: string): string | null {
  const m = name.match(/(\d{4})[-_]?([01]\d)[-_]?([0-3]\d)|([0-3]\d)[-.]([01]\d)[-.](\d{4})/);
  if (!m) return null;
  if (m[1]) return `${m[1]}-${m[2]}-${m[3]}`;
  return `${m[6]}-${m[5]}-${m[4]}`;
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
