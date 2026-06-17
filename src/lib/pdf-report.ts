import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Analysis } from "./whatsapp-parser";

const BRAND: [number, number, number] = [20, 83, 45];

const fmtDateOnly = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("pt-BR") : "—";

export type ReportDraft = {
  title: string;            // group / report title
  clientName: string;       // shown in identification block
  groupCreatedAt: string;   // formatted date string
  period: string;           // "dd/mm/aaaa a dd/mm/aaaa"
  emissionDate: string;
  status: string;
  totalMessages: number;
  participantsCount: number;
  executiveSummary: string;     // multiline text
  verdictLabel: string;         // colored banner text
  verdictRecommendation: "pode_encerrar" | "manter_aberto" | "avaliar_manual";
  verdictBody: string;          // multiline narrative for the 2-week analysis
  envolvidos: { name: string; role: string }[];
  criticalDemands: { dateLabel: string; ocorrencia: string; resolucao: string }[];
  finalOpinion: string;         // multiline
};

export function buildDraft(a: Analysis, sourceName: string): ReportDraft {
  const title = (a.groupName && a.groupName.trim()) || sourceName.replace(/\.[^.]+$/, "");
  const ds = a.demandStats;
  const top = a.participants[0];
  const solver = [...a.participants].sort((x, z) => z.demandsResolved - x.demandsResolved)[0];
  const cv = a.closureVerdict;

  const period =
    a.firstDate && a.lastDate
      ? `${fmtDateOnly(a.firstDate)} a ${fmtDateOnly(a.lastDate)}`
      : "—";

  const status =
    cv?.recommendation === "manter_aberto"
      ? "Em acompanhamento"
      : cv?.recommendation === "pode_encerrar"
        ? "Apto a encerramento"
        : "Em avaliação";

  const executiveSummary = [
    `Foram registradas ${a.totalMessages} mensagens entre ${a.participants.length} participantes${
      a.firstDate && a.lastDate ? `, no período de ${period}` : ""
    }.`,
    top
      ? `Participante mais ativo: ${top.name} (${top.messageCount} mensagens, ${top.percentage.toFixed(1)}%).`
      : "",
    `Demandas: ${ds.total} solicitadas · ${ds.resolvidas} resolvidas · ${ds.pendentes} pendentes (taxa ${ds.taxaResolucao.toFixed(0)}%).`,
    solver && solver.demandsResolved > 0
      ? `Maior resolvedor: ${solver.name} (${solver.demandsResolved} demandas resolvidas).`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const verdictLabel =
    cv?.recommendation === "pode_encerrar"
      ? "PARECER: GRUPO PODE SER ENCERRADO"
      : cv?.recommendation === "manter_aberto"
        ? "PARECER: MANTER GRUPO ABERTO"
        : "PARECER: AVALIAR MANUALMENTE";

  const verdictBody = cv
    ? [
        `Janela analisada: ${fmtDateOnly(cv.windowStart)} a ${fmtDateOnly(cv.windowEnd)}.`,
        `${cv.totalMessages} mensagens · ${cv.activeParticipants} participante(s) ativo(s) · ${cv.openDemands} pendente(s) · ${cv.resolvedDemands} resolvida(s).`,
        ...cv.reasons.map((r) => `• ${r}`),
      ].join("\n")
    : "";

  // Critical demands: prefer pendentes; complete with resolvidas mais recentes
  const pend = a.demands.filter((d) => d.status === "pendente").slice(0, 6);
  const resv = a.demands.filter((d) => d.status === "resolvido").slice(-4);
  const picked = [...pend, ...resv].slice(0, 8);
  const criticalDemands = picked.map((d) => ({
    dateLabel: d.date.toLocaleDateString("pt-BR"),
    ocorrencia: `${d.requester}: ${d.message.replace(/\s+/g, " ").slice(0, 240)}`,
    resolucao:
      d.status === "resolvido" && d.resolvedBy
        ? `Resolvido por ${d.resolvedBy}${d.resolvedAt ? ` em ${d.resolvedAt.toLocaleDateString("pt-BR")}` : ""}.`
        : "Pendente — sem resolução clara identificada.",
  }));

  const envolvidos = a.participants.slice(0, 10).map((p) => ({
    name: p.name,
    role: `${p.messageCount} msg (${p.percentage.toFixed(1)}%) · pediu ${p.demandsRequested} · resolveu ${p.demandsResolved}`,
  }));

  const finalOpinion = [
    top ? `${top.name} concentra ${top.percentage.toFixed(1)}% das mensagens, sendo o principal ponto focal do grupo.` : "",
    solver && solver.demandsResolved > 0
      ? `Maior resolvedor identificado: ${solver.name} (${solver.demandsResolved} demandas).`
      : "",
    ds.tempoMedioResolucaoHoras !== null
      ? `Tempo médio de resolução: ${ds.tempoMedioResolucaoHoras.toFixed(1)} horas.`
      : "",
    ds.pendentes
      ? `Há ${ds.pendentes} demanda(s) sem resolução clara — recomenda-se acompanhamento individual.`
      : "Nenhuma demanda em aberto identificada.",
    cv?.recommendation === "pode_encerrar"
      ? "Conclusão: baixa atividade e ausência de pendências críticas nas últimas 2 semanas — grupo apto a encerramento."
      : cv?.recommendation === "manter_aberto"
        ? "Conclusão: atividade ou pendências relevantes nas últimas 2 semanas — manter o grupo aberto."
        : "Conclusão: indicadores ambíguos — recomenda-se avaliação manual.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title,
    clientName: title,
    groupCreatedAt: fmtDateOnly(a.groupCreatedAt ?? a.firstDate ?? null),
    period,
    emissionDate: new Date().toLocaleDateString("pt-BR"),
    status,
    totalMessages: a.totalMessages,
    participantsCount: a.participants.length,
    executiveSummary,
    verdictLabel,
    verdictRecommendation: cv?.recommendation ?? "avaliar_manual",
    verdictBody,
    envolvidos,
    criticalDemands,
    finalOpinion,
  };
}

export function generatePdf(draft: ReportDraft): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;

  // ===== Cabeçalho
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageW, 110, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("RELATÓRIO TÉCNICO DE AUDITORIA DE DEMANDAS", margin, 32);

  // título auto-encolhe pra caber em 2 linhas máx
  let titleSize = 20;
  doc.setFontSize(titleSize);
  let titleLines = doc.splitTextToSize(draft.title, contentW);
  while (titleLines.length > 2 && titleSize > 12) {
    titleSize -= 1;
    doc.setFontSize(titleSize);
    titleLines = doc.splitTextToSize(draft.title, contentW);
  }
  doc.text(titleLines.slice(0, 2), margin, 62);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Início do grupo: ${draft.groupCreatedAt}`, margin, 98);

  let y = 132;
  doc.setTextColor(20, 20, 20);

  // ===== Identificação (tabela limpa)
  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9.5, cellPadding: 6, valign: "middle" },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 110, fillColor: [245, 250, 247] },
      1: { cellWidth: (contentW - 220) / 2 },
      2: { fontStyle: "bold", cellWidth: 110, fillColor: [245, 250, 247] },
      3: { cellWidth: (contentW - 220) / 2 },
    },
    body: [
      ["Cliente / Grupo", draft.clientName, "Data de emissão", draft.emissionDate],
      ["Sistema auditado", "Agente Flow (WhatsApp)", "Período analisado", draft.period],
      [
        "Total de mensagens",
        String(draft.totalMessages),
        "Status do projeto",
        draft.status,
      ],
    ],
    margin: { left: margin, right: margin },
  });
  y = lastY(doc) + 18;

  // ===== Resumo Executivo
  y = sectionTitle(doc, "1. Resumo Executivo", margin, y, contentW);
  y = drawParagraph(doc, draft.executiveSummary, margin, y, contentW);
  y += 8;

  // ===== Parecer Crítico (últimas 2 semanas)
  if (draft.verdictBody.trim()) {
    y = ensureSpace(doc, y, 80, margin);
    const color: [number, number, number] =
      draft.verdictRecommendation === "pode_encerrar"
        ? [22, 163, 74]
        : draft.verdictRecommendation === "manter_aberto"
          ? [220, 38, 38]
          : [202, 138, 4];
    doc.setFillColor(...color);
    doc.rect(margin, y, contentW, 26, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(draft.verdictLabel, margin + 12, y + 17);
    y += 32;
    doc.setTextColor(20, 20, 20);
    y = drawParagraph(doc, draft.verdictBody, margin, y, contentW);
    y += 10;
  }

  // ===== Envolvidos
  if (draft.envolvidos.length) {
    y = ensureSpace(doc, y, 80, margin);
    y = sectionTitle(doc, "2. Envolvidos", margin, y, contentW);
    autoTable(doc, {
      startY: y,
      head: [["Nome", "Atuação no grupo"]],
      body: draft.envolvidos.map((p) => [p.name, p.role]),
      headStyles: { fillColor: BRAND, fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 4 },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 16;
  }

  // ===== Demandas Críticas (narrativa)
  if (draft.criticalDemands.length) {
    y = ensureSpace(doc, y, 60, margin);
    y = sectionTitle(doc, "3. Demandas Críticas", margin, y, contentW);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const d of draft.criticalDemands) {
      y = ensureSpace(doc, y, 60, margin);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...BRAND);
      doc.text(`[${d.dateLabel}]`, margin, y);
      y += 14;
      doc.setTextColor(20, 20, 20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("Ocorrência:", margin, y);
      doc.setFont("helvetica", "normal");
      y = drawParagraph(doc, d.ocorrencia, margin + 70, y, contentW - 70);
      y += 2;
      doc.setFont("helvetica", "bold");
      doc.text("Resolução:", margin, y);
      doc.setFont("helvetica", "normal");
      y = drawParagraph(doc, d.resolucao, margin + 70, y, contentW - 70);
      y += 10;
      doc.setFontSize(10);
    }
  }

  // ===== Parecer Final
  if (draft.finalOpinion.trim()) {
    y = ensureSpace(doc, y, 80, margin);
    y = sectionTitle(doc, "4. Parecer Técnico Final", margin, y, contentW);
    y = drawParagraph(doc, draft.finalOpinion, margin, y, contentW);
  }

  // ===== Rodapé
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`${draft.title} · Auditoria Agente Flow`, margin, pageH - 20);
    doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 20, { align: "right" });
  }

  return doc;
}

function sectionTitle(doc: jsPDF, t: string, x: number, y: number, w: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BRAND);
  doc.text(t, x, y);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.7);
  doc.line(x, y + 4, x + w, y + 4);
  doc.setTextColor(20, 20, 20);
  return y + 18;
}

function drawParagraph(doc: jsPDF, text: string, x: number, y: number, w: number): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  const blocks = text.split(/\n/);
  for (const b of blocks) {
    if (!b.trim()) {
      y += 6;
      continue;
    }
    const lines = doc.splitTextToSize(b, w);
    for (const line of lines) {
      y = ensureSpace(doc, y, 16, 48);
      doc.text(line, x, y);
      y += 13;
    }
  }
  return y;
}

function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, margin: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 40) {
    doc.addPage();
    return margin;
  }
  return y;
}
