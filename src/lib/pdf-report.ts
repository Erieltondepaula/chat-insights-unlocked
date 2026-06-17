import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Analysis } from "./whatsapp-parser";

const fmtDateOnly = (d: Date) => d.toLocaleDateString("pt-BR");
const fmtDate = (d: Date) =>
  d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

const BRAND: [number, number, number] = [20, 83, 45];

export function generatePdf(a: Analysis, sourceName: string): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;

  const title = (a.groupName && a.groupName.trim()) || sourceName.replace(/\.[^.]+$/, "");

  // ===== Cabeçalho compacto
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageW, 96, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("RELATÓRIO TÉCNICO DE AUDITORIA DE DEMANDAS", margin, 32);
  doc.setFontSize(18);
  const titleLines = doc.splitTextToSize(title, contentW);
  doc.text(titleLines.slice(0, 2), margin, 58);

  let y = 120;
  doc.setTextColor(20, 20, 20);

  // ===== 1. Identificação
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const period =
    a.firstDate && a.lastDate ? `${fmtDateOnly(a.firstDate)} a ${fmtDateOnly(a.lastDate)}` : "—";
  autoTable(doc, {
    startY: y,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 3 },
    body: [
      ["Cliente / Grupo:", title, "Data de emissão:", new Date().toLocaleDateString("pt-BR")],
      ["Sistema auditado:", "Agente Flow (WhatsApp)", "Período analisado:", period],
      [
        "Total de mensagens:",
        String(a.totalMessages),
        "Status do projeto:",
        a.closureVerdict?.recommendation === "manter_aberto"
          ? "Em acompanhamento"
          : a.closureVerdict?.recommendation === "pode_encerrar"
            ? "Apto a encerramento"
            : "Em avaliação",
      ],
    ],
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 95 },
      2: { fontStyle: "bold", cellWidth: 95 },
    },
    margin: { left: margin, right: margin },
  });
  y = lastY(doc) + 14;

  // ===== 2. Resumo Executivo
  sectionTitle(doc, "1. Resumo Executivo", margin, y);
  y += 18;
  const top = a.participants[0];
  const ds = a.demandStats;
  const summary = [
    `Foram registradas ${a.totalMessages} mensagens entre ${a.participants.length} participantes${
      a.firstDate && a.lastDate ? `, no período de ${fmtDateOnly(a.firstDate)} a ${fmtDateOnly(a.lastDate)}` : ""
    }.`,
    top
      ? `Participante mais ativo: ${top.name} (${top.messageCount} mensagens, ${top.percentage.toFixed(1)}%).`
      : "",
    `Demandas: ${ds.total} solicitadas · ${ds.resolvidas} resolvidas · ${ds.pendentes} pendentes (taxa ${ds.taxaResolucao.toFixed(0)}%).`,
  ].filter(Boolean);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const line of summary) {
    const w = doc.splitTextToSize(line, contentW);
    doc.text(w, margin, y);
    y += w.length * 13 + 2;
  }
  y += 8;

  // ===== KPIs
  const kpis = [
    { label: "Solicitadas", value: ds.total },
    { label: "Pendentes", value: ds.pendentes },
    { label: "Resolvidas", value: ds.resolvidas },
    { label: "Resolução", value: `${ds.taxaResolucao.toFixed(0)}%` },
  ];
  const cardW = (contentW - 18) / 4;
  kpis.forEach((k, i) => {
    const x = margin + i * (cardW + 6);
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(...BRAND);
    doc.roundedRect(x, y, cardW, 46, 5, 5, "FD");
    doc.setTextColor(...BRAND);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(String(k.value), x + 10, y + 24);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(60);
    doc.text(k.label, x + 10, y + 38);
  });
  y += 60;
  doc.setTextColor(20, 20, 20);

  // ===== 3. Caixa Parecer Crítico
  const cv = a.closureVerdict;
  if (cv) {
    const verdictColor: [number, number, number] =
      cv.recommendation === "pode_encerrar"
        ? [22, 163, 74]
        : cv.recommendation === "manter_aberto"
          ? [220, 38, 38]
          : [202, 138, 4];
    const verdictLabel =
      cv.recommendation === "pode_encerrar"
        ? "PARECER: GRUPO PODE SER ENCERRADO"
        : cv.recommendation === "manter_aberto"
          ? "PARECER: MANTER GRUPO ABERTO"
          : "PARECER: AVALIAR MANUALMENTE";
    y = ensureSpace(doc, y, 90, margin);
    doc.setFillColor(...verdictColor);
    doc.rect(margin, y, contentW, 26, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(verdictLabel, margin + 12, y + 17);
    y += 32;
    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const win = `Janela: ${fmtDateOnly(cv.windowStart)} → ${fmtDateOnly(cv.windowEnd)}  ·  ${cv.totalMessages} mensagens  ·  ${cv.activeParticipants} ativos  ·  ${cv.openDemands} pendentes  ·  ${cv.resolvedDemands} resolvidas`;
    const wl = doc.splitTextToSize(win, contentW);
    doc.text(wl, margin, y);
    y += wl.length * 12 + 4;
    for (const r of cv.reasons.slice(0, 4)) {
      const w = doc.splitTextToSize(`• ${r}`, contentW);
      doc.text(w, margin, y);
      y += w.length * 12 + 2;
    }
    y += 6;
  }

  // ===== 4. Envolvidos (top 10)
  const envolvidos = a.participants.slice(0, 10);
  if (envolvidos.length) {
    y = ensureSpace(doc, y, 80, margin);
    sectionTitle(doc, "2. Envolvidos", margin, y);
    autoTable(doc, {
      startY: y + 8,
      head: [["Nome", "Mensagens", "%", "Pediu", "Resolveu"]],
      body: envolvidos.map((p) => [
        p.name,
        p.messageCount,
        p.percentage.toFixed(1) + "%",
        p.demandsRequested,
        p.demandsResolved,
      ]),
      headStyles: { fillColor: BRAND, fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 14;
  }

  // ===== 5. Linha do tempo de demandas (até 15)
  const demands = a.demands.slice(0, 15);
  if (demands.length) {
    y = ensureSpace(doc, y, 80, margin);
    sectionTitle(doc, "3. Linha do Tempo de Demandas", margin, y);
    autoTable(doc, {
      startY: y + 8,
      head: [["Data", "Solicitante", "Demanda", "Status", "Resolvido por", "Quando"]],
      body: demands.map((d) => [
        fmtDate(d.date),
        d.requester,
        d.message.length > 110 ? d.message.slice(0, 110) + "…" : d.message,
        d.status === "resolvido" ? "✔ Resolvido" : "⏳ Pendente",
        d.resolvedBy ?? "—",
        d.resolvedAt ? fmtDate(d.resolvedAt) : "—",
      ]),
      headStyles: { fillColor: BRAND, fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
      columnStyles: { 2: { cellWidth: 170 } },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 8;
    if (a.demands.length > demands.length) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(
        `Exibindo ${demands.length} de ${a.demands.length} demandas (priorizadas por ordem cronológica).`,
        margin,
        y,
      );
      doc.setTextColor(20, 20, 20);
      y += 14;
    }
  }

  // ===== 6. Parecer técnico final (curto)
  y = ensureSpace(doc, y, 100, margin);
  sectionTitle(doc, "4. Parecer Técnico Final", margin, y);
  y += 16;
  const insights: string[] = [];
  if (top) insights.push(`${top.name} concentra ${top.percentage.toFixed(1)}% das mensagens — principal ponto focal.`);
  const solver = [...a.participants].sort((x, z) => z.demandsResolved - x.demandsResolved)[0];
  if (solver && solver.demandsResolved > 0)
    insights.push(`Maior resolvedor: ${solver.name} (${solver.demandsResolved} demandas).`);
  if (ds.tempoMedioResolucaoHoras !== null)
    insights.push(`Tempo médio de resolução: ${ds.tempoMedioResolucaoHoras.toFixed(1)} h.`);
  if (ds.pendentes)
    insights.push(`${ds.pendentes} demanda(s) sem resolução clara — recomenda-se acompanhamento.`);
  if (cv)
    insights.push(
      cv.recommendation === "pode_encerrar"
        ? "Conclusão: o grupo apresenta baixa atividade e nenhuma pendência crítica — apto a encerramento."
        : cv.recommendation === "manter_aberto"
          ? "Conclusão: existem pendências/atividade relevantes nas últimas 2 semanas — manter o grupo aberto."
          : "Conclusão: indicadores ambíguos — recomenda-se avaliação manual antes do encerramento.",
    );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const line of insights) {
    y = ensureSpace(doc, y, 30, margin);
    const w = doc.splitTextToSize(`• ${line}`, contentW);
    doc.text(w, margin, y);
    y += w.length * 13 + 3;
  }

  // ===== Rodapé
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `${title} · Auditoria Agente Flow`,
      margin,
      pageH - 18,
    );
    doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 18, { align: "right" });
  }

  return doc;
}

function sectionTitle(doc: jsPDF, t: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BRAND);
  doc.text(t, x, y);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(1);
  doc.line(x, y + 4, x + 40, y + 4);
  doc.setTextColor(20, 20, 20);
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
