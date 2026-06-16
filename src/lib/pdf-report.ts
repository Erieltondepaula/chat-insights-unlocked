import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Analysis } from "./whatsapp-parser";

const fmtDate = (d: Date) =>
  d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const fmtDateOnly = (d: Date) => d.toLocaleDateString("pt-BR");

export function generatePdf(a: Analysis, sourceName: string): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;

  // ===== Capa
  doc.setFillColor(20, 83, 45);
  doc.rect(0, 0, pageW, 220, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text("Relatório de Análise", margin, 110);
  doc.text("de Conversa – WhatsApp", margin, 142);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, margin, 180);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(11);
  let y = 260;
  doc.setFont("helvetica", "bold");
  doc.text("Arquivo analisado:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(sourceName, margin + 130, y);
  y += 20;

  if (a.groupCreatedAt) {
    doc.setFont("helvetica", "bold");
    doc.text("Criação do grupo:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(fmtDate(a.groupCreatedAt), margin + 130, y);
    y += 20;
  }
  if (a.firstDate && a.lastDate) {
    doc.setFont("helvetica", "bold");
    doc.text("Período da conversa:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(`${fmtDateOnly(a.firstDate)} → ${fmtDateOnly(a.lastDate)}`, margin + 130, y);
    y += 20;
  }
  doc.setFont("helvetica", "bold");
  doc.text("Total de mensagens:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(String(a.totalMessages), margin + 130, y);
  y += 20;
  doc.setFont("helvetica", "bold");
  doc.text("Participantes:", margin, y);
  doc.setFont("helvetica", "normal");
  doc.text(String(a.participants.length), margin + 130, y);

  // ===== Resumo Executivo
  doc.addPage();
  y = margin;
  sectionTitle(doc, "Resumo Executivo", margin, y);
  y += 30;
  const top = a.participants[0];
  const ds = a.demandStats;
  const summary = [
    `A conversa registrou ${a.totalMessages} mensagens entre ${a.participants.length} participantes${
      a.firstDate && a.lastDate
        ? `, de ${fmtDateOnly(a.firstDate)} a ${fmtDateOnly(a.lastDate)}`
        : ""
    }.`,
    top ? `O participante mais ativo foi ${top.name} com ${top.messageCount} mensagens (${top.percentage.toFixed(1)}%).` : "",
    `Demandas solicitadas: ${ds.total} · Resolvidas: ${ds.resolvidas} · Pendentes: ${ds.pendentes} · Taxa de resolução: ${ds.taxaResolucao.toFixed(1)}%.`,
    ds.tempoMedioResolucaoHoras !== null
      ? `Tempo médio de resolução: ${ds.tempoMedioResolucaoHoras.toFixed(1)} horas.`
      : "Tempo médio de resolução: não calculável (sem resoluções registradas).",
    `Mídias compartilhadas: ${a.mediaCount.image} imagens, ${a.mediaCount.video} vídeos, ${a.mediaCount.audio} áudios, ${a.mediaCount.document} documentos.`,
  ].filter(Boolean);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const line of summary) {
    const wrapped = doc.splitTextToSize(line, pageW - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 14 + 6;
  }

  // KPIs em cards
  y += 6;
  const kpis = [
    { label: "Solicitadas", value: ds.total },
    { label: "Pendentes", value: ds.pendentes },
    { label: "Resolvidas", value: ds.resolvidas },
    { label: "Resolução %", value: `${ds.taxaResolucao.toFixed(0)}%` },
  ];
  const cardW = (pageW - margin * 2 - 18) / 4;
  kpis.forEach((k, i) => {
    const x = margin + i * (cardW + 6);
    doc.setFillColor(240, 253, 244);
    doc.setDrawColor(20, 83, 45);
    doc.roundedRect(x, y, cardW, 56, 6, 6, "FD");
    doc.setTextColor(20, 83, 45);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(String(k.value), x + 10, y + 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60);
    doc.text(k.label, x + 10, y + 46);
  });
  y += 72;

  if (ds.resolvedoresTop.length) {
    sectionTitle(doc, "Quem mais resolveu", margin, y);
    autoTable(doc, {
      startY: y + 14,
      head: [["Resolvedor", "Demandas resolvidas"]],
      body: ds.resolvedoresTop.map((r) => [r.name, r.count]),
      headStyles: { fillColor: [20, 83, 45] },
      margin: { left: margin, right: margin },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18;
  }

  if (a.topWords.length) {
    sectionTitle(doc, "Principais Tópicos", margin, y);
    autoTable(doc, {
      startY: y + 14,
      head: [["Termo", "Ocorrências"]],
      body: a.topWords.map((w) => [w.word, w.count]),
      headStyles: { fillColor: [20, 83, 45] },
      margin: { left: margin, right: margin },
    });
  }

  // ===== Participantes
  doc.addPage();
  sectionTitle(doc, "Participantes e Perfil de Interação", margin, margin);
  autoTable(doc, {
    startY: margin + 20,
    head: [["Nome", "Mensagens", "%", "Mídias", "Demandas pediu", "Demandas resolveu"]],
    body: a.participants.map((p) => [
      p.name,
      p.messageCount,
      p.percentage.toFixed(1) + "%",
      p.mediaSent,
      p.demandsRequested,
      p.demandsResolved,
    ]),
    headStyles: { fillColor: [20, 83, 45] },
    margin: { left: margin, right: margin },
  });

  // ===== Linha do Tempo (resumo diário)
  doc.addPage();
  sectionTitle(doc, "Linha do Tempo", margin, margin);
  autoTable(doc, {
    startY: margin + 20,
    head: [["Data", "Mensagens", "Tópicos principais"]],
    body: a.dailySummary.map((d) => [
      new Date(d.date).toLocaleDateString("pt-BR"),
      d.count,
      d.topics.join(", "),
    ]),
    headStyles: { fillColor: [20, 83, 45] },
    margin: { left: margin, right: margin },
    columnStyles: { 2: { cellWidth: 280 } },
  });

  // ===== Demandas
  doc.addPage();
  sectionTitle(doc, "Demandas e Resoluções", margin, margin);
  autoTable(doc, {
    startY: margin + 20,
    head: [["Data abertura", "Solicitante", "Mensagem", "Status", "Resolvido por", "Quando resolveu"]],
    body: a.demands.map((d) => [
      fmtDate(d.date),
      d.requester,
      d.message,
      d.status,
      d.resolvedBy ?? "—",
      d.resolvedAt ? fmtDate(d.resolvedAt) : "—",
    ]),
    headStyles: { fillColor: [20, 83, 45] },
    margin: { left: margin, right: margin },
    columnStyles: { 2: { cellWidth: 180 } },
    styles: { fontSize: 8, cellPadding: 4 },
  });

  // ===== Mídias
  doc.addPage();
  sectionTitle(doc, "Análise de Mídias", margin, margin);
  autoTable(doc, {
    startY: margin + 20,
    head: [["Tipo", "Quantidade"]],
    body: [
      ["Imagens", a.mediaCount.image],
      ["Vídeos", a.mediaCount.video],
      ["Áudios", a.mediaCount.audio],
      ["Documentos", a.mediaCount.document],
      ["Figurinhas", a.mediaCount.sticker],
      ["GIFs", a.mediaCount.gif],
    ],
    headStyles: { fillColor: [20, 83, 45] },
    margin: { left: margin, right: margin },
  });
  let mediaY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
  doc.setFontSize(10);
  doc.setFont("helvetica", "italic");
  doc.text(
    "Observação: o conteúdo das mídias não é analisado nesta versão (apenas referências encontradas na conversa).",
    margin,
    mediaY,
    { maxWidth: pageW - margin * 2 },
  );

  // ===== Parecer das últimas 2 semanas
  doc.addPage();
  sectionTitle(doc, "Análise — Últimas 2 Semanas", margin, margin);
  const cv = a.closureVerdict;
  let py = margin + 30;
  if (cv) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(
      `Janela analisada: ${fmtDateOnly(cv.windowStart)} → ${fmtDateOnly(cv.windowEnd)}`,
      margin,
      py,
    );
    py += 18;
    autoTable(doc, {
      startY: py,
      head: [["Indicador", "Valor"]],
      body: [
        ["Mensagens no período", cv.totalMessages],
        ["Participantes ativos", cv.activeParticipants],
        ["Demandas resolvidas no período", cv.resolvedDemands],
        ["Demandas abertas no período", cv.openDemands],
        ["Dias desde a última mensagem", cv.daysSinceLastMessage >= 9999 ? "—" : cv.daysSinceLastMessage],
      ],
      headStyles: { fillColor: [20, 83, 45] },
      margin: { left: margin, right: margin },
    });
    py = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;

    const verdictLabel =
      cv.recommendation === "pode_encerrar"
        ? "PARECER: GRUPO PODE SER ENCERRADO"
        : cv.recommendation === "manter_aberto"
          ? "PARECER: MANTER GRUPO ABERTO"
          : "PARECER: AVALIAR MANUALMENTE";
    const verdictColor: [number, number, number] =
      cv.recommendation === "pode_encerrar"
        ? [22, 163, 74]
        : cv.recommendation === "manter_aberto"
          ? [220, 38, 38]
          : [202, 138, 4];
    doc.setFillColor(...verdictColor);
    doc.rect(margin, py, pageW - margin * 2, 32, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(verdictLabel, margin + 14, py + 21);
    py += 48;
    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Justificativas:", margin, py);
    py += 16;
    doc.setFont("helvetica", "normal");
    for (const r of cv.reasons) {
      const wrapped = doc.splitTextToSize(`• ${r}`, pageW - margin * 2);
      doc.text(wrapped, margin, py);
      py += wrapped.length * 14 + 4;
    }
  }

  // ===== Conclusão
  doc.addPage();
  sectionTitle(doc, "Conclusão e Insights", margin, margin);
  const insights: string[] = [];
  if (top) insights.push(`• ${top.name} concentra ${top.percentage.toFixed(1)}% das mensagens — possível ponto focal do grupo.`);
  const solver = [...a.participants].sort((p1, p2) => p2.demandsResolved - p1.demandsResolved)[0];
  if (solver && solver.demandsResolved > 0)
    insights.push(`• ${solver.name} é quem mais resolve demandas (${solver.demandsResolved}).`);
  const requester = [...a.participants].sort((p1, p2) => p2.demandsRequested - p1.demandsRequested)[0];
  if (requester && requester.demandsRequested > 0)
    insights.push(`• ${requester.name} é quem mais solicita (${requester.demandsRequested}).`);
  if (ds.pendentes) insights.push(`• Existem ${ds.pendentes} demandas sem resolução clara — recomenda-se acompanhamento.`);
  if (a.dailySummary.length) {
    const busiest = [...a.dailySummary].sort((d1, d2) => d2.count - d1.count)[0];
    insights.push(`• Dia mais ativo: ${new Date(busiest.date).toLocaleDateString("pt-BR")} (${busiest.count} mensagens).`);
  }
  insights.push("• Toda automação registrada como 'Agente Flow' (nunca referir como robô/bot).");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  let cy = margin + 30;
  for (const line of insights) {
    const wrapped = doc.splitTextToSize(line, pageW - margin * 2);
    doc.text(wrapped, margin, cy);
    cy += wrapped.length * 14 + 6;
  }

  // Footer page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 20, { align: "right" });
  }

  return doc;
}

function sectionTitle(doc: jsPDF, title: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 83, 45);
  doc.text(title, x, y);
  doc.setDrawColor(20, 83, 45);
  doc.setLineWidth(2);
  doc.line(x, y + 6, x + 60, y + 6);
  doc.setTextColor(20, 20, 20);
}
