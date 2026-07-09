import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getAmigoFlowSupportName, isGreetingOrNoise, type Analysis } from "./whatsapp-parser";
import type { SatisfactionAnalysis } from "./satisfaction-analysis.functions";

// Paleta executiva — mesma identidade Amigo Flow (verde/navy)
const BRAND: [number, number, number] = [14, 106, 88];       // verde Amigo Flow
const BRAND_DARK: [number, number, number] = [8, 66, 55];
const NAVY: [number, number, number] = [26, 61, 110];
const TEXT: [number, number, number] = [38, 47, 60];
const MUTED: [number, number, number] = [110, 120, 132];
const SOFT: [number, number, number] = [237, 246, 243];      // fundo card
const RULE: [number, number, number] = [221, 228, 236];
const OK: [number, number, number] = [46, 139, 87];
const WARN: [number, number, number] = [200, 150, 30];
const ALERT: [number, number, number] = [192, 57, 43];

const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("pt-BR") : "—");

// ---------- TYPES ----------

export type ExecPriority = "Alta" | "Média" | "Baixa";
export type ExecTrend = "Melhorando" | "Estável" | "Piorando";

export type ExecOccurrence = {
  date: string;
  category: string;   // Bug / Configuração / Limitação / Melhoria / Dúvida
  problem: string;
  cause: string;
  solution: string;
  status: string;
};

export type ExecActionItem = {
  action: string;
  owner: string;
  priority: ExecPriority;
  status: string;
  nextStep: string;
};

export type ExecutiveDraft = {
  // Cabeçalho
  title: string;
  clientName: string;
  period: string;
  emissionDate: string;
  moduleAudited: string;
  accountStatus: string;

  // 1. Dashboard Executivo
  dashboard: {
    total: number;
    resolvidas: number;
    pendentes: number;
    emAnalise: number;
    taxaResolucao: number;   // 0-100
    bugs: number;
    configuracoes: number;
    melhorias: number;
    churnRisk: "Baixo" | "Médio" | "Alto";
    score: number;           // 0-100
    contaStatus: string;     // texto curto
  };

  // 2. Principais Ocorrências
  occurrences: ExecOccurrence[];

  // 3. Análise Inteligente
  intelligence: {
    bugs: string[];
    configuracoes: string[];
    limitacoes: string[];
    melhorias: string[];
    duvidas: string[];
    recorrentes: string[];
    causaRaiz: string;
  };

  // 4. Saúde da Conta
  health: {
    satisfacao: string;
    evolucao: string;
    churnRisk: string;
    confianca: string;
    reclamacoes: string[];
    elogios: string[];
    tendencia: ExecTrend;
  };

  // 5. Plano de Ação
  plan: ExecActionItem[];

  // 6. Conclusão Executiva (20-40 linhas)
  conclusion: string;
};

// ---------- SANITIZE (compacto, sem emojis) ----------

function sanitize(input: string): string {
  if (!input) return "";
  let s = input;
  s = s.replace(/clienta/gi, "cliente").replace(/Clienta/g, "Cliente");
  s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  s = s.replace(
    /[\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2900-\u29FF\u2B00-\u2BFF\u3000-\u303F\uFE00-\uFE0F\uFE30-\uFE4F]/g,
    "",
  );
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");
  s = s.replace(/[ØøÝý][=\-]?[A-Za-zÀ-ÿ0-9&áàâãéêíóôõúç]{0,8}/g, "");
  s = s.replace(/[^\x20-\x7EÀ-ÿ\s•°–—,.:;?!()""''\-]/g, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  // Flow (mesma regra do outro gerador)
  s = s
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(I\.?A\.?|Bot|Rob[oô])(?![A-Za-zÀ-ÿ0-9])/gi, "Flow")
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(intelig[eê]ncia\s+artificial)(?![A-Za-zÀ-ÿ0-9])/gi, "Flow")
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(chatbot|agente\s+flow|agente)(?![A-Za-zÀ-ÿ0-9])/gi, "Flow");
  s = s.replace(/\b(Flow)(\s+Flow)+\b/gi, "Flow");
  return s;
}

function stripMedia(s: string): string {
  return sanitize(s)
    .replace(/\[\s*(Imagem|Imagens|Foto|V[ií]deo|[ÁA]udio|Documento(?:\/PDF)?|PDF|Anexo)[^\]]*\]/gi, "")
    .replace(/<\s*[^>]{1,60}\s*>/g, "")
    .replace(/\b[\w.\-]+\.(jpe?g|png|webp|gif|mp4|mov|opus|ogg|mp3|m4a|pdf|docx?|xlsx?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- BUILD DRAFT (deriva de Analysis + SatisfactionAnalysis) ----------

function classifyCategory(text: string): "Bug" | "Configuração" | "Limitação" | "Melhoria" | "Dúvida" {
  const t = text.toLowerCase();
  if (/bug|erro|falha|n[aã]o funciona|quebrou|travou|fora do ar/.test(t)) return "Bug";
  if (/configur|parametriz|ajust|habilit|desabilit|liberar|acesso/.test(t)) return "Configuração";
  if (/n[aã]o (tem|existe|permite|suporta)|limita|impossibilit/.test(t)) return "Limitação";
  if (/sugiro|seria bom|poderia|melhoria|feature|solicit[oa] (que|inclus)|gostaria de/.test(t)) return "Melhoria";
  return "Dúvida";
}

function normalizeChurn(risk: string | undefined): "Baixo" | "Médio" | "Alto" {
  const r = (risk ?? "baixo").toLowerCase();
  if (r === "alto") return "Alto";
  if (r === "medio" || r === "médio") return "Médio";
  return "Baixo";
}

function normalizeTrend(evolution: string | undefined, pend: number, score: number): ExecTrend {
  const e = (evolution ?? "").toLowerCase();
  if (e === "melhorou") return "Melhorando";
  if (e === "piorou") return "Piorando";
  if (pend === 0 && score >= 70) return "Melhorando";
  if (pend >= 3 || score < 50) return "Piorando";
  return "Estável";
}

export function buildExecutiveDraft(
  a: Analysis,
  clientName: string,
  satisfaction: SatisfactionAnalysis | null,
): ExecutiveDraft {
  const ar = satisfaction?.auditReport;
  const total = a.demands.length;
  const resolvidas = a.demands.filter((d) => d.status === "resolvido").length;
  const pendentes = a.demands.filter((d) => d.status === "pendente").length;
  const taxa = total ? (resolvidas / total) * 100 : 0;
  const emAnalise = Math.max(0, total - resolvidas - pendentes);

  const score = satisfaction?.score ?? Math.round(taxa);
  const churn = normalizeChurn(satisfaction?.churnRisk);

  // Indicadores por categoria (deriva do auditReport quando disponível)
  const bugs = ar?.indicators?.bugs ?? a.demands.filter((d) => classifyCategory(d.message) === "Bug").length;
  const configuracoes =
    ar?.indicators?.ajustes ??
    a.demands.filter((d) => classifyCategory(d.message) === "Configuração").length;
  const melhoriasCount = a.demands.filter((d) => classifyCategory(d.message) === "Melhoria").length;

  // Ocorrências principais: usa timeline do LLM se houver; fallback = demandas com maior prioridade
  const occurrences: ExecOccurrence[] = ar?.timeline?.length
    ? ar.timeline.slice(0, 8).map((t) => ({
        date: sanitize(t.date),
        category: mapAuditCategoryToExec(t.category),
        problem: sanitize(t.summary),
        cause: "—",
        solution: sanitize(t.supportResponse),
        status: sanitize(t.status),
      }))
    : buildOccurrencesFromDemands(a).slice(0, 8);

  // Análise inteligente
  const intelligence = {
    bugs: uniq(ar?.indicators?.topErrors ?? []).slice(0, 6),
    configuracoes: uniq(ar?.supportBehavior?.resolutive ?? []).slice(0, 6),
    limitacoes: uniq(ar?.supportBehavior?.limitations ?? []).slice(0, 6),
    melhorias: uniq(ar?.diagnosis?.opportunities?.product ?? []).slice(0, 6),
    duvidas: [] as string[],
    recorrentes: uniq(ar?.supportBehavior?.silences ?? []).slice(0, 4),
    causaRaiz: buildRootCause(a, satisfaction),
  };

  // Saúde
  const reclamacoes = uniq(ar?.diagnosis?.attentionPoints ?? satisfaction?.mainReasons ?? []).slice(0, 5);
  const elogios = uniq(ar?.diagnosis?.strengths ?? []).slice(0, 5);
  const health = {
    satisfacao: labelSentiment(satisfaction?.sentiment, score),
    evolucao: ar?.humorEvolution?.justification
      ? sanitize(ar.humorEvolution.justification)
      : `Cliente com evolução ${satisfaction?.evolution ?? "estável"} ao longo do período.`,
    churnRisk: churn,
    confianca: ar?.effort?.label ? `Esforço percebido: ${sanitize(ar.effort.label)}` : "Confiança preservada.",
    reclamacoes,
    elogios,
    tendencia: normalizeTrend(satisfaction?.evolution, pendentes, score),
  };

  // Plano de ação
  const plan: ExecActionItem[] = (ar?.conclusion?.nextSteps ?? []).slice(0, 8).map((s) => ({
    action: sanitize(s.action),
    owner: sanitize(s.owner) || "Amigo Flow",
    priority: guessPriority(s.action),
    status: "A executar",
    nextStep: "Definir prazo com o cliente",
  }));
  if (plan.length === 0 && pendentes > 0) {
    plan.push({
      action: `Endereçar ${pendentes} pendência(s) aberta(s) com o cliente.`,
      owner: "Suporte Amigo Flow",
      priority: "Alta",
      status: "A executar",
      nextStep: "Contato ativo em até 48h",
    });
  }

  // Conclusão executiva (usa a do LLM se robusta; senão constrói)
  const llmConclusion = (satisfaction?.consolidatedSummary ?? "").trim();
  const conclusion = llmConclusion.length >= 600
    ? sanitize(llmConclusion)
    : buildExecConclusion(a, satisfaction, {
        total, resolvidas, pendentes, taxa, score, churn, trend: health.tendencia, clientName,
      });

  return {
    title: sanitize(clientName || a.groupName || "Relatório Executivo"),
    clientName: sanitize(clientName || a.groupName || "—"),
    period: `${fmtDate(a.firstDate)} a ${fmtDate(a.lastDate)}`,
    emissionDate: new Date().toLocaleDateString("pt-BR"),
    moduleAudited: "Agente Flow / WhatsApp",
    accountStatus: pendentes === 0 ? "Estável" : churn === "Alto" ? "Em risco" : "Em acompanhamento",
    dashboard: {
      total,
      resolvidas,
      pendentes,
      emAnalise,
      taxaResolucao: Math.round(taxa),
      bugs,
      configuracoes,
      melhorias: melhoriasCount,
      churnRisk: churn,
      score,
      contaStatus: pendentes === 0 ? "Estável" : churn === "Alto" ? "Em risco" : "Em acompanhamento",
    },
    occurrences,
    intelligence,
    health,
    plan,
    conclusion,
  };
}

function mapAuditCategoryToExec(c: string): string {
  const k = (c ?? "").toLowerCase();
  if (k.includes("bug") || k.includes("critico")) return "Bug";
  if (k.includes("config")) return "Configuração";
  if (k.includes("ajuste")) return "Configuração";
  if (k.includes("orient")) return "Orientação";
  if (k.includes("duvida") || k.includes("dúvida")) return "Dúvida";
  return "Informação";
}

function buildOccurrencesFromDemands(a: Analysis): ExecOccurrence[] {
  // Prioriza pendentes primeiro, depois resolvidas cronológicas
  const sorted = [...a.demands].sort((x, y) => {
    const rank = (s: string) => (s === "pendente" ? 0 : 1);
    const r = rank(x.status) - rank(y.status);
    if (r !== 0) return r;
    return x.date.getTime() - y.date.getTime();
  });
  return sorted.map((d) => ({
    date: fmtDate(d.date),
    category: classifyCategory(d.message),
    problem: stripMedia(d.message).slice(0, 180) || "—",
    cause: "Análise da equipe Amigo Flow",
    solution: d.resolutionMessage ? stripMedia(d.resolutionMessage).slice(0, 180) : "—",
    status: d.status === "resolvido" ? "Resolvido" : d.status === "pendente" ? "Pendente" : "Em análise",
  }));
}

function guessPriority(action: string): ExecPriority {
  const t = (action ?? "").toLowerCase();
  if (/urgent|imediat|prioriz|cr[íi]tic|48h|24h|hoje|hoje mesmo/.test(t)) return "Alta";
  if (/monitorar|documentar|revisar|acompanhar/.test(t)) return "Baixa";
  return "Média";
}

function labelSentiment(s: string | undefined, score: number): string {
  const map: Record<string, string> = {
    muito_satisfeito: "Muito satisfeito",
    satisfeito: "Satisfeito",
    neutro: "Neutro",
    insatisfeito: "Insatisfeito",
    muito_insatisfeito: "Muito insatisfeito",
  };
  if (s && map[s]) return `${map[s]} (${score}/100)`;
  return `${score >= 80 ? "Satisfeito" : score >= 60 ? "Neutro" : "Insatisfeito"} (${score}/100)`;
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const t = sanitize(s);
    if (!t) continue;
    const k = t.toLowerCase().slice(0, 80);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function buildRootCause(a: Analysis, sat: SatisfactionAnalysis | null): string {
  const reasons = sat?.mainReasons?.slice(0, 3).join("; ");
  if (reasons) return sanitize(reasons);
  const pend = a.demands.filter((d) => d.status === "pendente").length;
  if (pend > 0)
    return `Presença de ${pend} pendência(s) sem devolutiva formal indica gargalo em ciclo de resposta e/ou dependência de terceiros.`;
  return "Ajustes operacionais recorrentes de parametrização, sem indício de causa estrutural única.";
}

function buildExecConclusion(
  a: Analysis,
  sat: SatisfactionAnalysis | null,
  ctx: { total: number; resolvidas: number; pendentes: number; taxa: number; score: number; churn: string; trend: ExecTrend; clientName: string },
): string {
  const lastClient = [...a.messages]
    .reverse()
    .find((m) => !m.isSystem && !getAmigoFlowSupportName(m.author) && !isGreetingOrNoise(m.content));
  const reasons = sat?.mainReasons?.slice(0, 3).join("; ") || "ajustes operacionais e dúvidas de uso";
  const cliente = ctx.clientName || "a clínica contratante";

  return sanitize(
    [
      `No período analisado, ${cliente} registrou ${ctx.total} demanda(s) junto à equipe Amigo Flow, sendo ${ctx.resolvidas} resolvida(s) e ${ctx.pendentes} pendente(s), o que representa uma taxa objetiva de resolução de ${Math.round(ctx.taxa)}%.`,
      `Os principais motivadores das interações foram: ${reasons}. A leitura macro do atendimento aponta perfil operacional recorrente, com foco em parametrização, orientação de uso do Agente Flow e validações pontuais de fluxo.`,
      `Do ponto de vista da qualidade do suporte, a equipe atuou de forma técnica e resolutiva na maioria dos casos, aplicando correções rápidas e devolutivas objetivas. Não foram identificados sinais estruturais de falha operacional no ciclo de resposta.`,
      ctx.pendentes > 0
        ? `Ainda há ${ctx.pendentes} pendência(s) aberta(s) que exigem tratativa ativa em até 48h para preservar a percepção de valor do cliente.`
        : `Todas as pendências mapeadas foram encerradas, indicando ciclo saudável no período.`,
      `Sob a ótica de risco comercial, o cliente apresenta risco de churn ${ctx.churn.toLowerCase()} e tendência ${ctx.trend.toLowerCase()}. Não há manifestação explícita de intenção de cancelamento no histórico analisado.`,
      lastClient
        ? `A última interação relevante do cliente ocorreu em ${fmtDate(lastClient.date)}, reforçando o vínculo operacional ativo e o interesse contínuo em evoluir o uso da plataforma.`
        : "",
      `Recomendação executiva: manter cadência semanal de acompanhamento, priorizar as pendências mapeadas, reforçar treinamento nos temas recorrentes e documentar formalmente quaisquer limitações nativas do módulo. Com essas ações, o atendimento evolui de reativo para preditivo, reduzindo desgaste operacional e sustentando o Score atual (${ctx.score}/100).`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

// ---------- PDF RENDERING ----------

function ensureSpace(doc: jsPDF, y: number, needed: number, margin: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - margin - 20) {
    doc.addPage();
    return margin;
  }
  return y;
}

function sectionTitle(doc: jsPDF, text: string, x: number, y: number, contentW: number): number {
  y = ensureSpace(doc, y, 32, x);
  doc.setFillColor(...BRAND);
  doc.rect(x, y, 4, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_DARK);
  doc.text(sanitize(text), x + 10, y + 13);
  doc.setDrawColor(...RULE);
  doc.line(x, y + 22, x + contentW, y + 22);
  return y + 30;
}

function paragraph(doc: jsPDF, txt: string, x: number, y: number, w: number, size = 9.5, leading = 13): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  doc.setTextColor(...TEXT);
  const lines = doc.splitTextToSize(sanitize(txt), w) as string[];
  for (const ln of lines) {
    y = ensureSpace(doc, y, leading, x);
    doc.text(ln, x, y);
    y += leading;
  }
  return y + 2;
}

function kpiCards(doc: jsPDF, d: ExecutiveDraft, x: number, y: number, w: number): number {
  const items: { label: string; value: string; color: [number, number, number] }[] = [
    { label: "Total de demandas", value: String(d.dashboard.total), color: NAVY },
    { label: "Resolvidas", value: String(d.dashboard.resolvidas), color: OK },
    { label: "Pendentes", value: String(d.dashboard.pendentes), color: d.dashboard.pendentes > 0 ? WARN : OK },
    { label: "% de resolução", value: `${d.dashboard.taxaResolucao}%`, color: BRAND },
    { label: "Bugs", value: String(d.dashboard.bugs), color: d.dashboard.bugs > 0 ? ALERT : MUTED },
    { label: "Configurações", value: String(d.dashboard.configuracoes), color: NAVY },
    { label: "Melhorias", value: String(d.dashboard.melhorias), color: MUTED },
    { label: "Risco de churn", value: d.dashboard.churnRisk, color: d.dashboard.churnRisk === "Alto" ? ALERT : d.dashboard.churnRisk === "Médio" ? WARN : OK },
    { label: "Score da conta", value: `${d.dashboard.score}/100`, color: d.dashboard.score >= 70 ? OK : d.dashboard.score >= 50 ? WARN : ALERT },
    { label: "Status da conta", value: d.dashboard.contaStatus, color: BRAND_DARK },
  ];

  const cols = 5;
  const gap = 8;
  const cardW = (w - gap * (cols - 1)) / cols;
  const cardH = 52;
  const rows = Math.ceil(items.length / cols);

  y = ensureSpace(doc, y, rows * (cardH + gap), x);

  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = x + col * (cardW + gap);
    const cy = y + row * (cardH + gap);

    doc.setFillColor(...SOFT);
    doc.roundedRect(cx, cy, cardW, cardH, 4, 4, "F");
    doc.setFillColor(...it.color);
    doc.rect(cx, cy, 3, cardH, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...BRAND_DARK);
    doc.text(String(it.value), cx + 10, cy + 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    const labelLines = doc.splitTextToSize(sanitize(it.label), cardW - 14) as string[];
    let ly = cy + 34;
    for (const ln of labelLines.slice(0, 2)) {
      doc.text(ln, cx + 10, ly);
      ly += 9;
    }
  });

  return y + rows * (cardH + gap) + 4;
}

function renderList(doc: jsPDF, title: string, items: string[], x: number, y: number, w: number): number {
  if (!items?.length) return y;
  y = ensureSpace(doc, y, 22, x);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...BRAND_DARK);
  doc.text(sanitize(title), x, y);
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  for (const it of items) {
    const lines = doc.splitTextToSize(`• ${sanitize(it)}`, w - 8) as string[];
    for (const ln of lines) {
      y = ensureSpace(doc, y, 12, x);
      doc.text(ln, x + 4, y);
      y += 12;
    }
  }
  return y + 4;
}

export function generateExecutivePdf(draft: ExecutiveDraft): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ---- Cabeçalho ----
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageW, 6, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...BRAND_DARK);
  doc.text(sanitize(draft.title).toUpperCase(), margin, y + 14);
  y += 26;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("Relatório Executivo Inteligente — Amigo Flow", margin, y);
  y += 14;

  doc.setFontSize(8.5);
  doc.text(
    `Emissão: ${sanitize(draft.emissionDate)}   |   Período: ${sanitize(draft.period)}   |   Módulo: ${sanitize(draft.moduleAudited)}   |   Status: ${sanitize(draft.accountStatus)}`,
    margin,
    y,
  );
  y += 18;

  // ---- 1. Dashboard Executivo ----
  y = sectionTitle(doc, "1. Dashboard Executivo", margin, y, contentW);
  y = kpiCards(doc, draft, margin, y, contentW);

  // ---- 2. Principais Ocorrências ----
  if (draft.occurrences.length) {
    y = sectionTitle(doc, "2. Principais Ocorrências", margin, y, contentW);
    autoTable(doc, {
      startY: y,
      head: [["Data", "Categoria", "Problema", "Causa", "Solução aplicada", "Status"]],
      body: draft.occurrences.map((o) => [
        sanitize(o.date),
        sanitize(o.category),
        sanitize(o.problem),
        sanitize(o.cause),
        sanitize(o.solution),
        sanitize(o.status),
      ]),
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 9 },
      styles: { fontSize: 8.5, lineColor: RULE, textColor: TEXT, valign: "top", cellPadding: 4 },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 65 }, 5: { cellWidth: 60 } },
      margin: { left: margin, right: margin },
      rowPageBreak: "avoid",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }

  // ---- 3. Análise Inteligente ----
  y = sectionTitle(doc, "3. Análise Inteligente", margin, y, contentW);
  const i = draft.intelligence;
  const halfW = (contentW - 12) / 2;
  const leftStart = y;
  let leftY = y;
  let rightY = y;
  leftY = renderList(doc, "Bugs identificados", i.bugs, margin, leftY, halfW);
  leftY = renderList(doc, "Configurações incorretas", i.configuracoes, margin, leftY, halfW);
  leftY = renderList(doc, "Limitações do produto", i.limitacoes, margin, leftY, halfW);
  rightY = renderList(doc, "Solicitações de melhoria", i.melhorias, margin + halfW + 12, leftStart, halfW);
  rightY = renderList(doc, "Problemas recorrentes", i.recorrentes, margin + halfW + 12, rightY, halfW);
  y = Math.max(leftY, rightY);

  y = ensureSpace(doc, y, 40, margin);
  doc.setFillColor(...SOFT);
  doc.roundedRect(margin, y, contentW, 6, 2, 2, "F");
  y += 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_DARK);
  doc.text("Causa raiz identificada", margin, y);
  y += 6;
  y = paragraph(doc, i.causaRaiz, margin, y + 6, contentW, 9.5, 13);

  // ---- 4. Saúde da Conta ----
  y = sectionTitle(doc, "4. Saúde da Conta", margin, y, contentW);
  autoTable(doc, {
    startY: y,
    head: [["Dimensão", "Avaliação"]],
    body: [
      ["Satisfação do cliente", draft.health.satisfacao],
      ["Evolução do relacionamento", draft.health.evolucao],
      ["Risco de churn", draft.health.churnRisk],
      ["Grau de confiança", draft.health.confianca],
      ["Tendência", draft.health.tendencia],
    ].map((r) => [sanitize(r[0]), sanitize(r[1])]),
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 9.5 },
    styles: { fontSize: 9, lineColor: RULE, textColor: TEXT, cellPadding: 4, valign: "top" },
    columnStyles: { 0: { cellWidth: 170, fontStyle: "bold" } },
    margin: { left: margin, right: margin },
    rowPageBreak: "avoid",
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  const hStart = y;
  let hLeft = y;
  let hRight = y;
  hLeft = renderList(doc, "Principais reclamações", draft.health.reclamacoes, margin, hLeft, halfW);
  hRight = renderList(doc, "Principais elogios", draft.health.elogios, margin + halfW + 12, hStart, halfW);
  y = Math.max(hLeft, hRight);

  // ---- 5. Plano de Ação ----
  if (draft.plan.length) {
    y = sectionTitle(doc, "5. Plano de Ação", margin, y, contentW);
    autoTable(doc, {
      startY: y,
      head: [["Ação", "Responsável", "Prioridade", "Status", "Próximo passo"]],
      body: draft.plan.map((p) => [
        sanitize(p.action),
        sanitize(p.owner),
        sanitize(p.priority),
        sanitize(p.status),
        sanitize(p.nextStep),
      ]),
      headStyles: { fillColor: BRAND, textColor: 255, fontSize: 9.5 },
      styles: { fontSize: 9, lineColor: RULE, textColor: TEXT, cellPadding: 4, valign: "top" },
      columnStyles: {
        1: { cellWidth: 90 },
        2: { cellWidth: 60 },
        3: { cellWidth: 65 },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 2) {
          const v = String(data.cell.raw ?? "").toLowerCase();
          if (v.includes("alta")) data.cell.styles.fillColor = [253, 235, 235];
          else if (v.includes("média") || v.includes("media")) data.cell.styles.fillColor = [255, 249, 224];
          else if (v.includes("baixa")) data.cell.styles.fillColor = [235, 246, 240];
        }
      },
      margin: { left: margin, right: margin },
      rowPageBreak: "avoid",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  }

  // ---- 6. Conclusão Executiva ----
  y = sectionTitle(doc, "6. Conclusão Executiva", margin, y, contentW);
  const paragraphs = sanitize(draft.conclusion)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of paragraphs) {
    y = paragraph(doc, p, margin, y, contentW, 10, 14);
    y += 4;
  }

  // ---- Rodapé ----
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RULE);
    doc.line(margin, pageH - 28, pageW - margin, pageH - 28);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Relatório Executivo Amigo Flow  |  Documento confidencial", margin, pageH - 15);
    doc.text(`Página ${p} de ${pageCount}`, pageW - margin, pageH - 15, { align: "right" });
  }

  return doc;
}
