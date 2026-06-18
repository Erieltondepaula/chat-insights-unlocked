import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Analysis } from "./whatsapp-parser";

const BRAND: [number, number, number] = [20, 83, 45];
const WARN_BG: [number, number, number] = [254, 243, 199];
const WARN_BORDER: [number, number, number] = [202, 138, 4];

const fmtDateOnly = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("pt-BR") : "—";

export type Envolvido = { name: string; org: string; role: string };
export type DemandItem = {
  dateLabel: string;
  titleLabel: string;
  ocorrencia: string;
  resolucao: string;
};

export type ReportDraft = {
  title: string;
  subtitle: string;
  clientName: string;
  moduleAudited: string;
  emissionDate: string;
  status: string;
  groupCreatedAt: string;
  envolvidos: Envolvido[];
  criticalMotive: string;
  criticalQuote: string;
  criticalQuoteAuthor: string;
  demands: DemandItem[];
};

export function buildDraft(a: Analysis, sourceName: string): ReportDraft {
  const title = (a.groupName && a.groupName.trim()) || sourceName.replace(/\.[^.]+$/, "");
  const cv = a.closureVerdict;

  const status =
    cv?.recommendation === "manter_aberto"
      ? "Em acompanhamento"
      : cv?.recommendation === "pode_encerrar"
        ? "Apto a encerramento"
        : "Em avaliação";

  const envolvidos: Envolvido[] = a.participants.slice(0, 15).map((p) => ({
    name: p.name,
    org: "",
    role: `${p.demandsRequested} solicitação(ões) · ${p.demandsResolved} resolvida(s) · ${p.messageCount} msg`,
  }));

  // pendentes primeiro, depois resolvidas mais recentes
  const pend = a.demands.filter((d) => d.status === "pendente");
  const resv = a.demands.filter((d) => d.status === "resolvido");
  const all = [...pend, ...resv];
  const demands: DemandItem[] = all.slice(0, 18).map((d) => ({
    dateLabel: d.date.toLocaleDateString("pt-BR"),
    titleLabel: shortTitle(d.message),
    ocorrencia: `${d.requester}: ${cleanMsg(d.message)}`,
    resolucao:
      d.status === "resolvido" && d.resolvedBy
        ? `${d.resolvedBy}${d.resolvedAt ? ` (${d.resolvedAt.toLocaleDateString("pt-BR")})` : ""} concluiu o atendimento.`
        : "Pendente — sem resolução clara identificada na conversa.",
  }));

  const criticalMotive = cv
    ? [
        `Análise das últimas 2 semanas (${fmtDateOnly(cv.windowStart)} a ${fmtDateOnly(cv.windowEnd)}): ${cv.totalMessages} mensagens, ${cv.activeParticipants} participante(s) ativo(s), ${cv.openDemands} pendente(s) e ${cv.resolvedDemands} resolvida(s).`,
        ...cv.reasons.map((r) => `• ${r}`),
      ].join("\n")
    : "Sem janela suficiente para análise crítica.";

  return {
    title,
    subtitle: "Mapeamento Sequencial de Chamados, Soluções Técnicas e Parecer",
    clientName: title,
    moduleAudited: "Agente Flow (WhatsApp)",
    emissionDate: new Date().toLocaleDateString("pt-BR"),
    status,
    groupCreatedAt: fmtDateOnly(a.groupCreatedAt ?? a.firstDate ?? null),
    envolvidos,
    criticalMotive,
    criticalQuote: "",
    criticalQuoteAuthor: "",
    demands,
  };
}

function cleanMsg(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 320);
}
function shortTitle(s: string): string {
  const t = cleanMsg(s).slice(0, 70);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function generatePdf(draft: ReportDraft): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;

  // ===== TÍTULO (centralizado, sem barra colorida) ============
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  let titleSize = 19;
  doc.setFontSize(titleSize);
  let titleLines = doc.splitTextToSize(draft.title, contentW);
  while (titleLines.length > 2 && titleSize > 13) {
    titleSize -= 1;
    doc.setFontSize(titleSize);
    titleLines = doc.splitTextToSize(draft.title, contentW);
  }
  let y = margin + titleSize;
  for (const line of titleLines.slice(0, 2)) {
    doc.text(line, pageW / 2, y, { align: "center" });
    y += titleSize + 2;
  }

  // subtítulo
  if (draft.subtitle.trim()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(90, 90, 90);
    const subLines = doc.splitTextToSize(draft.subtitle, contentW);
    for (const line of subLines) {
      doc.text(line, pageW / 2, y + 4, { align: "center" });
      y += 14;
    }
  }
  y += 14;

  // ===== Identificação (caixa 2x2) ============
  doc.setDrawColor(220);
  doc.setLineWidth(0.5);
  doc.setTextColor(20, 20, 20);
  autoTable(doc, {
    startY: y,
    theme: "grid",
    styles: { fontSize: 9.5, cellPadding: 7, valign: "top", lineColor: [220, 220, 220] },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 130, fillColor: [248, 250, 249] },
      1: { cellWidth: (contentW - 260) / 2 + 130 - 130 },
      2: { fontStyle: "bold", cellWidth: 130, fillColor: [248, 250, 249] },
      3: { cellWidth: (contentW - 260) / 2 },
    },
    body: [
      ["Cliente Contratante", draft.clientName, "Data de Emissão", draft.emissionDate],
      ["Módulo Auditado", draft.moduleAudited, "Status Atual", draft.status],
      ["Início do Grupo", draft.groupCreatedAt, "", ""],
    ],
    margin: { left: margin, right: margin },
  });
  y = lastY(doc) + 22;

  // ===== 1. Envolvidos ============
  if (draft.envolvidos.length) {
    y = ensureSpace(doc, y, 80, margin);
    y = sectionTitle(doc, "1. Envolvidos no Processo", margin, y, contentW);
    autoTable(doc, {
      startY: y,
      head: [["Nome do Envolvido", "Organização", "Papel / Atribuição"]],
      body: draft.envolvidos.map((p) => [p.name, p.org, p.role]),
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 9, halign: "left" },
      styles: { fontSize: 9, cellPadding: 5, valign: "top" },
      columnStyles: {
        0: { cellWidth: 150, fontStyle: "bold" },
        1: { cellWidth: 110 },
        2: { cellWidth: contentW - 260 },
      },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 22;
  }

  // ===== 2. Fator Conclusivo / Parecer Crítico ============
  if (draft.criticalMotive.trim() || draft.criticalQuote.trim()) {
    y = ensureSpace(doc, y, 120, margin);
    y = sectionTitle(doc, "2. Fator Conclusivo da Auditoria", margin, y, contentW);

    // caixa amarela de aviso
    const motiveLines = doc.splitTextToSize(draft.criticalMotive, contentW - 24);
    const boxH = 30 + motiveLines.length * 12 + 14;
    y = ensureSpace(doc, y, boxH + 12, margin);
    doc.setFillColor(...WARN_BG);
    doc.setDrawColor(...WARN_BORDER);
    doc.setLineWidth(0.8);
    doc.roundedRect(margin, y, contentW, boxH, 4, 4, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(120, 80, 0);
    doc.text("⚠  PARECER CRÍTICO", margin + 12, y + 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(60, 45, 0);
    let ty = y + 34;
    for (const line of motiveLines) {
      doc.text(line, margin + 12, ty);
      ty += 12;
    }
    y += boxH + 14;

    if (draft.criticalQuote.trim()) {
      y = ensureSpace(doc, y, 60, margin);
      doc.setDrawColor(...BRAND);
      doc.setLineWidth(2);
      doc.line(margin, y, margin, y + 38);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(40, 40, 40);
      const qLines = doc.splitTextToSize(`"${draft.criticalQuote}"`, contentW - 20);
      let qy = y + 12;
      for (const ql of qLines) {
        doc.text(ql, margin + 10, qy);
        qy += 13;
      }
      if (draft.criticalQuoteAuthor.trim()) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(90, 90, 90);
        doc.text(`— ${draft.criticalQuoteAuthor}`, margin + 10, qy + 4);
        qy += 16;
      }
      y = qy + 14;
    }
  }

  // ===== 3. Relatório Detalhado de Demandas ============
  if (draft.demands.length) {
    y = ensureSpace(doc, y, 80, margin);
    y = sectionTitle(doc, "3. Relatório Detalhado de Demandas e Resoluções", margin, y, contentW);
    doc.setFontSize(9.5);
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "italic");
    doc.text(
      "Listagem sequencial de chamados, descrições e respectivas tratativas.",
      margin,
      y,
    );
    y += 16;

    for (const d of draft.demands) {
      y = ensureSpace(doc, y, 80, margin);

      // cabeçalho da demanda
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(...BRAND);
      const header = `[${d.dateLabel}] ${d.titleLabel}`;
      const hLines = doc.splitTextToSize(header, contentW);
      for (const h of hLines) {
        doc.text(h, margin, y);
        y += 13;
      }
      doc.setDrawColor(220);
      doc.setLineWidth(0.4);
      doc.line(margin, y, margin + contentW, y);
      y += 8;

      // Ocorrência
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(20, 20, 20);
      doc.text("Ocorrência:", margin, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(45, 45, 45);
      const oLines = doc.splitTextToSize(d.ocorrencia, contentW - 70);
      let oy = y;
      for (const ol of oLines) {
        oy = ensureSpace(doc, oy, 12, margin);
        doc.text(ol, margin + 68, oy);
        oy += 12;
      }
      y = oy + 4;

      // Resolução
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(20, 20, 20);
      doc.text("Resolução:", margin, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(45, 45, 45);
      const rLines = doc.splitTextToSize(d.resolucao, contentW - 70);
      let ry = y;
      for (const rl of rLines) {
        ry = ensureSpace(doc, ry, 12, margin);
        doc.text(rl, margin + 68, ry);
        ry += 12;
      }
      y = ry + 16;
    }
  }

  // ===== Rodapé ============
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.setFont("helvetica", "normal");
    doc.text(`Auditoria ${draft.title}`, margin, pageH - 20);
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
