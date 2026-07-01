import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AMIGO_FLOW_SUPPORT_TEAM,
  getAmigoFlowSupportName,
  isAmigoFlowSupport,
  isGreetingOrNoise,
  type Analysis,
  type Demand,
} from "./whatsapp-parser";
import type { SatisfactionAnalysis } from "./satisfaction-analysis.functions";

const NAVY: [number, number, number] = [14, 58, 95];
const NAVY_DEEP: [number, number, number] = [26, 61, 110];
const BLUE: [number, number, number] = [46, 111, 184];
const TEXT: [number, number, number] = [38, 47, 60];
const MUTED: [number, number, number] = [110, 120, 132];
const INFO_BG: [number, number, number] = [238, 243, 248];
const RES_BG: [number, number, number] = [234, 242, 251];
const RES_BORDER: [number, number, number] = [185, 211, 235];
const ALERT_BG: [number, number, number] = [253, 235, 235];
const ALERT_BORDER: [number, number, number] = [192, 57, 43];
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
  requester: string;
  demandSummary: string;
  keyQuotes: string[];
  problem: string;
  responder: string;
  responseSummary: string;
  solution: string;
  status: string;
  nextSteps: string;
};

export type ReportMetrics = {
  totalSolicitacoes: number;
  totalRespostas: number;
  pendentes: number;
  resolvidas: number;
  pctResolucao: number;
  topRequesters: { name: string; count: number }[];
  topResponders: { name: string; count: number }[];
  satisfacao: {
    muitoSatisfeito: number;
    satisfeito: number;
    neutro: number;
    insatisfeito: number;
    churnRisk: number;
  };
  churnQuotes: string[];
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
  metrics: ReportMetrics;
  consolidatedSummary: string;
  satisfaction?: SatisfactionAnalysis | null;
};

const SUPPORT_ORG = "Amigo Flow";
const CLIENT_ORG = "Clínica Contratante";

function flowify(s: string): string {
  return s
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(I\.?A\.?|Bot|Rob[oô])(?![A-Za-zÀ-ÿ0-9])/gi, "Flow")
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(intelig[eê]ncia\s+artificial)(?![A-Za-zÀ-ÿ0-9])/gi, "Flow")
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(chatbot|agente\s+flow|agente)(?![A-Za-zÀ-ÿ0-9])/gi, "Flow");
}

function sanitize(input: string): string {
  if (!input) return "";
  let s = input;

  // Correção gramatical secundária
  s = s.replace(/clienta/gi, "cliente");
  s = s.replace(/Clienta/g, "Cliente");

  // 1) Remove emojis (surrogate pairs + BMP pictográficos) e marcas de variation/zwj
  s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  s = s.replace(
    /[\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2900-\u29FF\u2B00-\u2BFF\u3000-\u303F\uFE00-\uFE0F\uFE30-\uFE4F]/g,
    "",
  );
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");

  // 2) Remove sequências corrompidas do tipo "Ø=ßâ", "Ø=Ý4" e prefixos colados (com & opcionais)
  s = s.replace(/[ØøÝý][=\-]?[A-Za-zÀ-ÿ0-9&áàâãéêíóôõúç]{0,8}/g, "");
  s = s.replace(/\\?emptyset[^\s]*/gi, "");

  // 3) Colapsa padrão "&-spaced" gerado por encoding quebrado (ex: "A&ç&õ&e&s")
  s = s.replace(/([A-Za-zÀ-ÿ])(?:&\s?([A-Za-zÀ-ÿ]))+/g, (m) => m.replace(/&\s?/g, ""));
  s = s.replace(/\s&\s/g, " ");
  s = s.replace(/&{2,}/g, " ");

  // 4) Remove caracteres fora do conjunto suportado pelo Helvetica do jsPDF
  s = s.replace(/[^\x20-\x7EÀ-ÿ\s•°–—,.:;?!()""''\-]/g, "");
  s = s.replace(/\s{2,}/g, " ").trim();

  s = flowify(s);
  s = s.replace(/\b(Flow)(\s+Flow)+\b/gi, "Flow");
  return s;
}

const MEDIA_EXT_RE =
  "jpe?g|png|webp|gif|bmp|heic|heif|mp4|mov|3gp|webm|opus|ogg|mp3|m4a|wav|aac|flac|pdf|docx?|xlsx?|pptx?";

function stripMediaTokens(input: string): { text: string; filenames: string[]; kinds: string[] } {
  let s = sanitize(input);
  const filenames: string[] = [];
  const kinds: string[] = [];

  s = s.replace(
    /\[\s*(Imagem|Imagens|Foto|V[ií]deo|[ÁA]udio|Documento(?:\/PDF)?|PDF|Anexo)[^\]]*\]/gi,
    (_m, k: string) => {
      kinds.push(k.toLowerCase());
      return "";
    },
  );

  s = s.replace(
    /<\s*(?:M[íi]dia oculta|arquivo de m[íi]dia oculto|Media omitted|image omitted|video omitted|audio omitted|sticker omitted|document omitted)\s*>/gi,
    "",
  );
  s = s.replace(/<[^>]{1,40}>/g, "");
  s = s.replace(new RegExp(`\\b([\\w.\\-]+\\.(?:${MEDIA_EXT_RE}))\\b`, "gi"), (_m, fn: string) => {
    filenames.push(fn);
    return "";
  });
  s = s.replace(/\(\s*arquivo(?:\s+anexado)?\s*\)/gi, "");

  return { text: s.replace(/\s+/g, " ").trim(), filenames, kinds };
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

function attachmentInsightSentences(filenames: string[], insightMap: InsightMap): string[] {
  if (!insightMap.size) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const fn of filenames.slice(0, 8)) {
    const ins = insightMap.get(fn.toLowerCase());
    if (!ins?.summary) continue;
    const s = sanitize(ins.summary).trim();
    if (!s) continue;
    const sig = s.slice(0, 80).toLowerCase();
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(s);
  }
  return out;
}

export function buildDraft(
  a: Analysis,
  sourceName: string,
  attachmentInsights: AttachmentInsight[] = [],
  satisfaction: SatisfactionAnalysis | null = null,
): ReportDraft {
  const title = sanitize((a.groupName && a.groupName.trim()) || sourceName.replace(/\.[^.]+$/, ""));
  const cv = a.closureVerdict;
  const status =
    a.demandStats.pendentes === 0
      ? "Apto a encerramento"
      : cv?.recommendation === "manter_aberto"
        ? "Em acompanhamento"
        : "Em avaliação";

  const insightMap = buildInsightMap(attachmentInsights);

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
  const envolvidos = [...clientSeen.values()].slice(0, 8).concat([...supportSeen.values()].slice(0, 8));
  const demands = buildDemandBlocks(a, insightMap);

  const lastClient = [...a.messages]
    .reverse()
    .find((m) => !m.isSystem && !getAmigoFlowSupportName(m.author) && !isGreetingOrNoise(m.content));
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
    .sort((x, y) => y[1] - x[1])
    .map(([name, n]) => `• ${name} registrou ${n} devolutiva(s) ao longo do período.`)
    .join("\n");

  const attachmentNotes = attachmentInsights.length
    ? attachmentInsights
        .slice(0, 12)
        .map((i) => `• ${kindLabel(i.type)}: ${sanitize(i.summary).slice(0, 220)}`)
        .join("\n")
    : "";

  const lastClientText = lastClient ? cleanContent(lastClient.content) : "";
  const lastSupportText = lastSupport ? cleanContent(lastSupport.content) : "";

  const draft: ReportDraft = {
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
      lastClient && lastClientText
        ? `Último contato do cliente em ${fmtDateOnly(lastClient.date)}: ${lastClientText}`
        : "",
      lastSupport && lastSupportText
        ? `Última devolutiva da equipe Amigo Flow em ${fmtDateOnly(lastSupport.date)}: ${lastSupportText}`
        : "",
      a.demandStats.pendentes === 0
        ? "Parecer operacional: Todas as pendências mapeadas foram resolvidas com sucesso pelo suporte."
        : `Parecer operacional: Existem demandas ativas pendentes de homologação.`,
    ]
      .filter(Boolean)
      .join("\n"),
    pendingItems: pending.length
      ? pending
          .slice(0, 8)
          .map((d) => `• ${fmtDateOnly(d.date)} — ${cleanContent(d.message)}`)
          .join("\n")
      : "Não foram identificadas pendências críticas abertas no histórico analisado.",
    executiveSummary:
      "A auditoria consolidou as solicitações da clínica e as devolutivas registradas pela equipe Amigo Flow. O foco do relatório é evidenciar demandas relevantes, ações realizadas, validações e pendências atuais sem reproduzir mensagens de saudação ou interações sem valor operacional.",
    mainThemes: themes.length
      ? themes.map((t) => `• ${t}`).join("\n")
      : "• Ajustes operacionais e validações de fluxo.",
    actionsExecuted: actionsExecuted || "• Parametrizações executadas pela equipe Amigo Flow.",
    currentPendencies: pending.length
      ? `• ${pending.length} demanda(s) aguardam retorno.`
      : "• Sem pendência crítica identificada.",
    attachmentNotes,
    metrics: buildMetrics(a, satisfaction),
    consolidatedSummary: "",
    satisfaction,
  };

  draft.consolidatedSummary =
    (satisfaction?.consolidatedSummary && satisfaction.consolidatedSummary.trim()) ||
    "Análise consolidada executada pelo sistema.";
  return draft;
}

function buildMetrics(a: Analysis, satisfaction: SatisfactionAnalysis | null = null): ReportMetrics {
  const totalSolicitacoes = a.demands.length;
  const resolvidas = a.demands.filter((d) => d.status === "resolvido").length;
  const pendentes = a.demands.filter((d) => d.status === "pendente").length;
  const totalRespostas = resolvidas;
  const pctResolucao = totalSolicitacoes ? (resolvidas / totalSolicitacoes) * 100 : 0;

  const reqMap = new Map<string, number>();
  for (const d of a.demands) {
    const n = d.requester || "—";
    reqMap.set(n, (reqMap.get(n) ?? 0) + 1);
  }
  const topRequesters = [...reqMap.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  const topResponders = a.demandStats.resolvedoresTop.slice(0, 5).map((r) => ({ name: r.name, count: r.count }));

  const metrics: ReportMetrics = {
    totalSolicitacoes,
    totalRespostas,
    pendentes,
    resolvidas,
    pctResolucao,
    topRequesters,
    topResponders,
    satisfacao: { muitoSatisfeito: 0, satisfeito: 0, neutro: 1, insatisfeito: 0, churnRisk: 0 },
    churnQuotes: [],
  };

  if (satisfaction) {
    const churnSuppressMetric =
      pendentes === 0 || satisfaction.churnRisk === "baixo" || (totalSolicitacoes > 0 && pctResolucao >= 95);
    metrics.satisfacao.churnRisk = churnSuppressMetric
      ? 0
      : satisfaction.churnRisk === "alto" || satisfaction.churnRisk === "medio"
        ? 1
        : 0;
    metrics.satisfacao.insatisfeito =
      pendentes === 0
        ? 0
        : satisfaction.sentiment === "insatisfeito" || satisfaction.sentiment === "muito_insatisfeito"
          ? 1
          : 0;
    metrics.satisfacao.satisfeito = satisfaction.sentiment === "satisfeito" ? 1 : 0;
    metrics.satisfacao.muitoSatisfeito = satisfaction.sentiment === "muito_satisfeito" ? 1 : 0;
    metrics.satisfacao.neutro =
      metrics.satisfacao.insatisfeito || metrics.satisfacao.satisfeito || metrics.satisfacao.muitoSatisfeito ? 0 : 1;
  }

  return metrics;
}

function buildDemandBlocks(a: Analysis, insightMap: InsightMap): DemandItem[] {
  const grouped = new Map<string, Demand[]>();
  for (const d of a.demands) {
    const key = d.date.toISOString().slice(0, 10);
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }
  const sortedKeys = [...grouped.keys()].sort((x, y) => x.localeCompare(y));
  return sortedKeys.map((key, idx) => buildOneBlock(key, grouped.get(key)!, insightMap, idx === sortedKeys.length - 1));
}

function buildOneBlock(key: string, items: Demand[], _insightMap: InsightMap, _isLast: boolean): DemandItem {
  const date = new Date(`${key}T12:00:00`);
  const cleanedItems = items.map((d) => {
    const r = stripMediaTokens(d.message);
    const rr = d.resolutionMessage ? stripMediaTokens(d.resolutionMessage) : { text: "", filenames: [], kinds: [] };
    return { ...d, cleanText: r.text, cleanResolution: rr.text };
  });

  const requester = sanitize(items[0]?.requester ?? "Cliente");

  // Consolida solicitações repetidas
  const demandCounts = new Map<string, number>();
  for (const ci of cleanedItems) {
    const t = ci.cleanText.trim();
    if (!t) continue;
    demandCounts.set(t, (demandCounts.get(t) ?? 0) + 1);
  }
  const demandSummary = [...demandCounts.entries()]
    .map(([t, n]) => (n > 1 ? `${t} (reforçado em ${n} mensagens)` : t))
    .join(" ")
    .slice(0, 900);

  // Extrai frases-chave (urgência/reclamação/decisão)
  const keyQuotes: string[] = [];
  const quoteRe = /(urg[eê]ncia|urgente|preciso|est[aá] tudo errado|combinamos|prometeram?|j[aá] avis[ea]i|h[aá] mais de|n[aã]o funciona|erro|bug|cancelar|rescis[aã]o)/i;
  for (const ci of cleanedItems) {
    if (ci.cleanText && quoteRe.test(ci.cleanText) && keyQuotes.length < 3) {
      keyQuotes.push(ci.cleanText.slice(0, 220));
    }
  }

  // Consolida devolutivas repetidas
  const resItems = cleanedItems.filter((d) => d.status === "resolvido");
  const respCounts = new Map<string, { who: string; count: number }>();
  for (const r of resItems) {
    const text = r.cleanResolution || "Ajuste operacional concluído.";
    const who = r.resolvedBy || "Suporte";
    const kkey = `${who}::${text}`;
    const cur = respCounts.get(kkey);
    respCounts.set(kkey, { who, count: (cur?.count ?? 0) + 1 });
  }
  const respondersSet = new Set<string>();
  const responseParts: string[] = [];
  for (const [kk, meta] of respCounts.entries()) {
    respondersSet.add(meta.who);
    const text = kk.split("::").slice(1).join("::");
    responseParts.push(meta.count > 1 ? `${text} (informado em ${meta.count} mensagens)` : text);
  }
  const responder = respondersSet.size ? [...respondersSet].join(", ") : "—";
  const responseSummary = responseParts.join(" ").slice(0, 900) || "Sem devolutiva registrada.";

  const pendCount = cleanedItems.filter((d) => d.status === "pendente").length;
  const status = pendCount > 0 ? `Pendente (${pendCount})` : "Resolvido";
  const solution = resItems.length ? "Ajuste/parametrização aplicada pela equipe Amigo Flow." : "—";

  return {
    dateLabel: fmtDateOnly(date),
    requester,
    demandSummary: demandSummary || "Interação sem conteúdo operacional relevante.",
    keyQuotes,
    problem: demandSummary.slice(0, 160),
    responder,
    responseSummary,
    solution,
    status,
    nextSteps: pendCount > 0 ? "Aguardando retorno / homologação." : "",
  };
}

// CORREÇÃO DE ENCODING: Removidos completamente os emojis de texto dos labels para banir o lixo eletrônico (Ø=ßâ)
function categoryLabel(c: string): { emoji: string; label: string; color: [number, number, number] } {
  const clean = String(c).toLowerCase().trim();
  if (clean.includes("critico") || clean.includes("problema"))
    return { emoji: "", label: "Problema Critico", color: ALERT_BORDER };
  if (clean.includes("duvida")) return { emoji: "", label: "Duvida", color: [200, 150, 30] };
  if (clean.includes("ajuste")) return { emoji: "", label: "Ajuste Realizado", color: [46, 139, 87] };
  if (clean.includes("configurac") || clean.includes("configura"))
    return { emoji: "", label: "Configuracao", color: BLUE };
  if (clean.includes("orientac") || clean.includes("orienta"))
    return { emoji: "", label: "Orientacao", color: [120, 70, 160] };
  return { emoji: "", label: "Informacao", color: MUTED };
}

export function generatePdf(draft: ReportDraft): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ar = draft.satisfaction?.auditReport;

  // Normaliza health quando não há pendências
  if (ar && draft.metrics.pendentes === 0) {
    ar.health.label = "Estavel / Controlado";
    ar.health.justification =
      "Todas as demandas e pendencias operacionais abertas pela clinica foram completamente sanadas pelo suporte tecnico.";
    if (ar.csat) ar.csat.classification = "Satisfeito";
  }

  // ============ CABECALHO CENTRALIZADO ============
  doc.setFillColor(...NAVY_DEEP);
  doc.rect(0, 0, pageW, 90, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(sanitize(draft.title), pageW / 2, 40, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(sanitize(draft.subtitle), pageW / 2, 60, { align: "center" });
  doc.setFontSize(8.5);
  doc.setTextColor(210, 220, 235);
  doc.text(
    `Emissao: ${sanitize(draft.emissionDate)}   |   Modulo: ${sanitize(draft.moduleAudited)}   |   Status: ${sanitize(draft.status)}`,
    pageW / 2,
    78,
    { align: "center" },
  );
  y = 110;

  // ============ 1. PAINEL EXECUTIVO ============
  y = sectionTitle(doc, "1. Painel Executivo do Atendimento", margin, y);
  autoTable(doc, {
    startY: y,
    head: [["Indicador", "Valor"]],
    body: [
      ["Cliente", sanitize(draft.clientName)],
      ["Periodo analisado", sanitize(draft.periodSummary)],
      ["Total de solicitacoes", String(draft.metrics.totalSolicitacoes)],
      ["Devolutivas registradas", String(draft.metrics.totalRespostas)],
      ["Resolvidas", String(draft.metrics.resolvidas)],
      ["Pendentes", String(draft.metrics.pendentes)],
      ["% de Resolucao", `${draft.metrics.pctResolucao.toFixed(0)}%`],
      ["Status operacional", sanitize(draft.status)],
    ],
    headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.5 },
    styles: { fontSize: 9, lineColor: RULE, textColor: TEXT, valign: "top", cellPadding: 4 },
    columnStyles: { 0: { cellWidth: 170, fontStyle: "bold" } },
    margin: { left: margin, right: margin },
  });
  y = (doc as any).lastAutoTable.finalY + 14;

  // ============ 2. PARTICIPANTES ============
  const participants =
    ar?.participants?.length
      ? ar.participants.map((p) => [sanitize(p.name), sanitize(p.org), sanitize(p.role)])
      : draft.envolvidos.map((p) => [sanitize(p.name), sanitize(p.org), sanitize(p.role)]);
  if (participants.length) {
    y = sectionTitle(doc, "2. Mapeamento de Participantes", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Nome / Cargo", "Organizacao", "Atribuicao"]],
      body: participants,
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.5 },
      styles: { fontSize: 9, lineColor: RULE, textColor: TEXT, cellPadding: 4 },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // ============ 3. LINHA DO TEMPO OPERACIONAL ============
  if (ar?.timeline?.length) {
    y = sectionTitle(doc, "3. Linha do Tempo Operacional", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Data", "Categoria", "Fato", "Posicionamento do Suporte", "Status"]],
      body: ar.timeline.map((t) => {
        const c = categoryLabel(t.category);
        return [sanitize(t.date), sanitize(c.label), sanitize(t.summary), sanitize(t.supportResponse), sanitize(t.status)];
      }),
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9 },
      styles: { fontSize: 8.5, lineColor: RULE, textColor: TEXT, valign: "top", cellPadding: 3.5 },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 90 }, 4: { cellWidth: 65 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // ============ 4. DEMANDAS E DEVOLUTIVAS (blocos separados) ============
  if (draft.demands?.length) {
    y = sectionTitle(doc, "4. Demandas do Cliente e Devolutivas do Suporte", margin, y);
    for (const d of draft.demands) {
      y = renderDemandBlock(doc, d, margin, y, contentW);
    }
  }

  if (ar) {
    // ============ 5. AUDITORIA COMPORTAMENTAL ============
    y = sectionTitle(doc, "5. Auditoria Comportamental da Equipe de Suporte", margin, y);
    y = renderQuadrant(doc, "Acoes Resolutivas", ar.supportBehavior?.resolutive ?? [], [46, 139, 87], margin, y, contentW);
    y = renderQuadrant(doc, "Defesas Tecnicas Legitimas", ar.supportBehavior?.defenses ?? [], [200, 150, 30], margin, y, contentW);
    y = renderQuadrant(doc, "Limitacoes do Produto Declaradas", ar.supportBehavior?.limitations ?? [], BLUE, margin, y, contentW);
    y = renderQuadrant(doc, "Silencios, Demoras e Gargalos", ar.supportBehavior?.silences ?? [], ALERT_BORDER, margin, y, contentW);

    // ============ 6. INDICADORES EXECUTIVOS ============
    y = sectionTitle(doc, "6. Painel de Indicadores Executivos", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Indicador", "Quantidade"]],
      body: [
        ["Ajustes / Configuracoes realizadas", String(ar.indicators?.ajustes ?? draft.metrics.resolvidas)],
        ["Duvidas sanadas", String(ar.indicators?.duvidas ?? 0)],
        ["Orientacoes fornecidas", String(ar.indicators?.orientacoes ?? 0)],
        ["Bugs / Inconsistencias reais", String(ar.indicators?.bugs ?? 0)],
        ["Reaberturas / Problemas recorrentes", String(ar.indicators?.reaberturas ?? draft.metrics.pendentes)],
      ],
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.5 },
      styles: { fontSize: 9, lineColor: RULE, textColor: TEXT, cellPadding: 4 },
      columnStyles: { 0: { cellWidth: 300, fontStyle: "bold" } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    // ============ 7. SAUDE / EVOLUCAO / ESFORCO ============
    y = sectionTitle(doc, "7. Saude, Evolucao e Esforco", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Indicador", "Classificacao", "Justificativa"]],
      body: [
        ["Saude do Atendimento", sanitize(ar.health?.label ?? ""), sanitize(ar.health?.justification ?? "")],
        ["Evolucao do Humor", sanitize(ar.humorEvolution?.label ?? ""), sanitize(ar.humorEvolution?.justification ?? "")],
        ["Complexidade Tecnica", sanitize(ar.complexity?.label ?? ""), sanitize(ar.complexity?.motive ?? "")],
        ["Nivel de Esforco do Cliente", sanitize(ar.effort?.label ?? ""), sanitize(ar.effort?.detail ?? "")],
      ],
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.5 },
      styles: { fontSize: 9, lineColor: RULE, textColor: TEXT, valign: "top", cellPadding: 4 },
      columnStyles: { 0: { cellWidth: 150, fontStyle: "bold" }, 1: { cellWidth: 110 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 14;

    // ============ 8. MAPEAMENTO EMOCIONAL ============
    if (ar.emotionalMoments?.length) {
      y = sectionTitle(doc, "8. Mapeamento Emocional do Cliente", margin, y);
      autoTable(doc, {
        startY: y,
        head: [["Emocao", "Confianca", "Data", "Mensagem do Cliente", "Motivo"]],
        body: ar.emotionalMoments.map((m) => [
          sanitize(m.emotion),
          `${m.confidence}%`,
          sanitize(m.date),
          `"${sanitize(m.quote)}"`,
          sanitize(m.motive),
        ]),
        headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9 },
        styles: { fontSize: 8.5, lineColor: RULE, textColor: TEXT, valign: "top", cellPadding: 3.5 },
        columnStyles: { 1: { cellWidth: 55 }, 2: { cellWidth: 55 }, 3: { cellWidth: 160 } },
        margin: { left: margin, right: margin },
      });
      y = (doc as any).lastAutoTable.finalY + 14;
    }

    // ============ 9. LINHA DO TEMPO DO HUMOR ============
    if (ar.humorTimeline?.length) {
      y = sectionTitle(doc, "9. Linha do Tempo do Humor", margin, y);
      const humorLabel = (em: string) => {
        const cleanEm = String(em).trim();
        if (/😊|🙂|feliz|satisf/i.test(cleanEm)) return "Satisfeito";
        if (/😐|neutro/i.test(cleanEm)) return "Neutro";
        if (/😠|😡|frustr|raiv/i.test(cleanEm)) return "Frustrado";
        if (/😟|preocup|ansios/i.test(cleanEm)) return "Preocupado";
        return sanitize(cleanEm) || "Neutro";
      };
      autoTable(doc, {
        startY: y,
        head: [["Data", "Emocao Predominante"]],
        body: ar.humorTimeline.map((h) => [sanitize(h.date), humorLabel(h.emoji)]),
        headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9 },
        styles: { fontSize: 9, lineColor: RULE, textColor: TEXT, cellPadding: 4 },
        columnStyles: { 0: { cellWidth: 100 } },
        margin: { left: margin, right: margin },
      });
      y = (doc as any).lastAutoTable.finalY + 14;
    }

    // ============ 10. CSAT ANALITICO ============
    y = sectionTitle(doc, "10. Score de Satisfacao do Cliente (CSAT Analitico)", margin, y);
    const csatScore = ar.csat?.score ?? Math.round(draft.metrics.pctResolucao);
    y = ensureSpace(doc, y, 70, margin);
    doc.setFillColor(...INFO_BG);
    doc.roundedRect(margin, y, contentW, 60, 4, 4, "F");
    doc.setFillColor(...NAVY_DEEP);
    doc.roundedRect(margin, y, 6, 60, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(...NAVY);
    doc.text(`${csatScore}/100`, margin + 20, y + 30);
    doc.setFontSize(10);
    doc.setTextColor(...TEXT);
    doc.text(sanitize(ar.csat?.classification ?? "—"), margin + 20, y + 48);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const memo = doc.splitTextToSize(sanitize(ar.csat?.calculationMemo ?? ""), contentW - 180) as string[];
    let my = y + 18;
    for (const ln of memo.slice(0, 4)) {
      doc.text(ln, margin + 170, my);
      my += 11;
    }
    y += 74;

    // ============ 11. CHURN (so se houver) ============
    const churnSuppress =
      draft.metrics.pendentes === 0 ||
      draft.satisfaction?.churnRisk === "baixo" ||
      draft.metrics.pctResolucao >= 95;
    if (!churnSuppress && ar.churnSignals?.length) {
      y = sectionTitle(doc, "11. Alerta de Risco de Churn", margin, y);
      ar.churnSignals.forEach((s, idx) => {
        y = ensureSpace(doc, y, 60, margin);
        doc.setFillColor(...ALERT_BG);
        doc.roundedRect(margin, y, contentW, 55, 3, 3, "F");
        doc.setFillColor(...ALERT_BORDER);
        doc.rect(margin, y, 4, 55, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(...ALERT_BORDER);
        doc.text(`Sinal #${idx + 1}  |  Peso: ${sanitize(s.weight)}  |  Data: ${sanitize(s.date)}`, margin + 10, y + 15);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...TEXT);
        const qLines = doc.splitTextToSize(`"${sanitize(s.quote)}"`, contentW - 20) as string[];
        doc.text(qLines.slice(0, 2), margin + 10, y + 30);
        doc.setFontSize(8.5);
        doc.setTextColor(...MUTED);
        doc.text(`Impacto: ${sanitize(s.impact)}`, margin + 10, y + 50);
        y += 62;
      });
    } else {
      y = sectionTitle(doc, "11. Alerta de Risco de Churn", margin, y);
      y = paragraph(
        doc,
        "Nao foram encontrados indicios objetivos suficientes de risco de churn no periodo analisado.",
        margin,
        y,
        contentW,
        9.5,
      );
    }

    // ============ 12. DIAGNOSTICO FINAL ============
    y = sectionTitle(doc, "12. Diagnostico Final", margin, y);
    y = renderListBox(doc, "Pontos Positivos", ar.diagnosis?.strengths ?? [], margin, y, contentW);
    y = renderListBox(doc, "Pontos de Atencao", ar.diagnosis?.attentionPoints ?? [], margin, y, contentW);
    y = renderListBox(doc, "Oportunidades — Produto", ar.diagnosis?.opportunities?.product ?? [], margin, y, contentW);
    y = renderListBox(doc, "Oportunidades — Suporte", ar.diagnosis?.opportunities?.support ?? [], margin, y, contentW);
    y = renderListBox(doc, "Oportunidades — Processo", ar.diagnosis?.opportunities?.process ?? [], margin, y, contentW);

    // ============ 13. PLANO DE ACAO ============
    y = sectionTitle(doc, "13. Plano de Acao e Proximos Passos", margin, y);
    y = renderListBox(
      doc,
      "Proximos Passos Imediatos",
      ar.conclusion?.nextSteps?.map((s) => `${sanitize(s.action)} — Responsavel: ${sanitize(s.owner)}`) ?? [],
      margin,
      y,
      contentW,
    );
    if (ar.conclusion?.willChurn) {
      y = paragraph(doc, `Propensao a cancelamento: ${sanitize(ar.conclusion.willChurn)}`, margin, y, contentW, 9);
    }
    if (ar.conclusion?.isEvolvingMaturity) {
      y = paragraph(doc, `Maturidade do cliente: ${sanitize(ar.conclusion.isEvolvingMaturity)}`, margin, y, contentW, 9);
    }
  }

  // ============ 14. INDICADORES VISUAIS ============
  y = sectionTitle(doc, `${ar ? "14" : "5"}. Indicadores Visuais`, margin, y);
  y = renderVisualIndicators(doc, draft, margin, y, contentW);

  // ============ 15. RESUMO CONSOLIDADO (final, em paragrafos) ============
  y = sectionTitle(doc, `${ar ? "15" : "6"}. Resumo Consolidado do Atendimento`, margin, y);
  const consolidated = sanitize(draft.consolidatedSummary || "");
  const paragraphs = consolidated
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ])/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!paragraphs.length) {
    y = paragraph(doc, "Analise consolidada nao disponivel para este atendimento.", margin, y, contentW, 10);
  } else {
    for (const p of paragraphs) {
      y = paragraph(doc, p.slice(0, 2000), margin, y, contentW, 10);
      y += 4;
    }
  }

  // ============ RODAPE ============
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE);
    doc.line(margin, pageH - 28, pageW - margin, pageH - 28);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Auditoria Amigo Flow  |  Documento executivo confidencial", margin, pageH - 15);
    doc.text(`Pagina ${i} de ${pageCount}`, pageW - margin, pageH - 15, { align: "right" });
  }

  return doc;
}

function renderDemandBlock(doc: jsPDF, d: DemandItem, x: number, y: number, w: number): number {
  const halfW = (w - 10) / 2;

  // Compute needed heights
  const demandLines = doc.splitTextToSize(sanitize(d.demandSummary), halfW - 16) as string[];
  const responseLines = doc.splitTextToSize(sanitize(d.responseSummary), halfW - 16) as string[];
  const quoteLines: string[] = [];
  for (const q of d.keyQuotes ?? []) {
    quoteLines.push(...(doc.splitTextToSize(`"${sanitize(q)}"`, halfW - 20) as string[]));
  }
  const solLines = doc.splitTextToSize(`Solucao: ${sanitize(d.solution || "—")}`, halfW - 16) as string[];

  const leftH = 46 + demandLines.length * 11 + (quoteLines.length ? 8 + quoteLines.length * 10 : 0) + 8;
  const rightH = 46 + responseLines.length * 11 + solLines.length * 10 + 8;
  const boxH = Math.max(leftH, rightH, 90);

  y = ensureSpace(doc, y, boxH + 12, x);

  // ---- Left: Solicitação do Cliente ----
  doc.setFillColor(240, 246, 252);
  doc.roundedRect(x, y, halfW, boxH, 4, 4, "F");
  doc.setFillColor(...BLUE);
  doc.rect(x, y, 4, boxH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...NAVY);
  doc.text("Solicitacao do Cliente", x + 10, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`${sanitize(d.dateLabel)}   |   ${sanitize(d.requester)}`, x + 10, y + 26);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  let ly = y + 40;
  for (const ln of demandLines) {
    doc.text(ln, x + 10, ly);
    ly += 11;
  }
  if (quoteLines.length) {
    ly += 4;
    doc.setFillColor(255, 249, 224);
    doc.roundedRect(x + 8, ly - 8, halfW - 16, quoteLines.length * 10 + 8, 2, 2, "F");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(120, 80, 20);
    for (const ln of quoteLines) {
      doc.text(ln, x + 12, ly);
      ly += 10;
    }
  }

  // ---- Right: Devolutiva do Suporte ----
  const rx = x + halfW + 10;
  doc.setFillColor(...RES_BG);
  doc.roundedRect(rx, y, halfW, boxH, 4, 4, "F");
  doc.setFillColor(46, 139, 87);
  doc.rect(rx, y, 4, boxH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...NAVY);
  doc.text("Devolutiva do Suporte", rx + 10, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Analista: ${sanitize(d.responder)}   |   Status: ${sanitize(d.status)}`, rx + 10, y + 26);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  let ry = y + 40;
  for (const ln of responseLines) {
    doc.text(ln, rx + 10, ry);
    ry += 11;
  }
  ry += 3;
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  for (const ln of solLines) {
    doc.text(ln, rx + 10, ry);
    ry += 10;
  }
  if (d.nextSteps) {
    doc.setFontSize(8.5);
    doc.text(`Proximos passos: ${sanitize(d.nextSteps)}`, rx + 10, ry);
  }

  return y + boxH + 10;
}

function renderVisualIndicators(doc: jsPDF, draft: ReportDraft, x: number, y: number, w: number): number {
  const m = draft.metrics;
  y = ensureSpace(doc, y, 140, x);

  // Barras: Solicitações vs Respostas vs Pendências
  const maxV = Math.max(m.totalSolicitacoes, m.totalRespostas, m.pendentes, 1);
  const barLabels: [string, number, [number, number, number]][] = [
    ["Solicitacoes", m.totalSolicitacoes, BLUE],
    ["Respostas", m.totalRespostas, [46, 139, 87]],
    ["Pendencias", m.pendentes, ALERT_BORDER],
    ["% Resolucao", Math.round(m.pctResolucao), NAVY_DEEP],
  ];
  const barX = x;
  const barW = w * 0.55;
  let by = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text("Volume Operacional", barX, by);
  by += 12;
  for (const [label, value, color] of barLabels) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT);
    doc.text(label, barX, by + 8);
    const reference = label === "% Resolucao" ? 100 : maxV;
    const filled = Math.max(2, (value / reference) * (barW - 100));
    doc.setFillColor(...RULE);
    doc.roundedRect(barX + 80, by, barW - 100, 8, 2, 2, "F");
    doc.setFillColor(...color);
    doc.roundedRect(barX + 80, by, filled, 8, 2, 2, "F");
    doc.setFontSize(8.5);
    doc.setTextColor(...NAVY);
    doc.text(label === "% Resolucao" ? `${value}%` : String(value), barX + barW - 15, by + 8, { align: "right" });
    by += 16;
  }

  // Painel lateral: Top solicitantes / respondedores
  const sideX = x + barW + 10;
  const sideW = w - barW - 10;
  let sy = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text("Quem mais solicitou", sideX, sy);
  sy += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT);
  for (const r of m.topRequesters.slice(0, 3)) {
    doc.text(`• ${sanitize(r.name)} (${r.count})`, sideX, sy);
    sy += 11;
  }
  sy += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text("Quem mais respondeu", sideX, sy);
  sy += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT);
  for (const r of m.topResponders.slice(0, 3)) {
    doc.text(`• ${sanitize(r.name)} (${r.count})`, sideX, sy);
    sy += 11;
  }

  y = Math.max(by, sy) + 8;

  // Faixa de satisfação
  const sat = draft.satisfaction;
  if (sat) {
    y = ensureSpace(doc, y, 34, x);
    const emoji =
      sat.sentiment === "muito_satisfeito" || sat.sentiment === "satisfeito"
        ? "Satisfeito"
        : sat.sentiment === "neutro"
          ? "Neutro"
          : "Insatisfeito";
    doc.setFillColor(...INFO_BG);
    doc.roundedRect(x, y, w, 26, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text(
      `Satisfacao: ${emoji}   |   Score: ${sat.score}/100   |   Risco de Churn: ${sanitize(sat.churnRisk)}   |   Evolucao: ${sanitize(sat.evolution)}`,
      x + 10,
      y + 17,
    );
    y += 34;
  }

  return y;
}

function renderQuadrant(
  doc: jsPDF,
  title: string,
  items: string[],
  tone: [number, number, number],
  x: number,
  y: number,
  w: number,
): number {
  const lines: string[] = [];
  items.forEach((it) => lines.push(...doc.splitTextToSize(`• ${sanitize(it)}`, w - 16)));
  const h = 22 + (lines.length ? lines.length : 1) * 11 + 6;
  y = ensureSpace(doc, y, h + 6, x);
  doc.setFillColor(...INFO_BG);
  doc.roundedRect(x, y, w, h, 3, 3, "F");
  doc.setFillColor(...tone);
  doc.rect(x, y, 3, h, "F");
  doc.setTextColor(...tone);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(title, x + 8, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT);
  let ly = y + 26;
  if (!lines.length) doc.text("• Sem ocorrencias documentadas.", x + 8, ly);
  lines.forEach((ln) => {
    doc.text(ln, x + 8, ly);
    ly += 11;
  });
  return y + h + 6;
}

function renderListBox(doc: jsPDF, title: string, items: string[], x: number, y: number, w: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...NAVY);
  y = ensureSpace(doc, y, 16, x);
  doc.text(title, x, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  if (!items.length) {
    doc.text("• Nenhuma sugestao/registro mapeado.", x, y);
    y += 12;
  }
  items.forEach((it) => {
    const lines = doc.splitTextToSize(`• ${sanitize(it)}`, w);
    lines.forEach((ln: string) => {
      y = ensureSpace(doc, y, 12, x);
      doc.text(ln, x, y);
      y += 11.5;
    });
  });
  return y + 4;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, margin: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 20) {
    doc.addPage();
    return margin;
  }
  return y;
}

function paragraph(doc: jsPDF, text: string, x: number, y: number, w: number, size: number): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  doc.setTextColor(...TEXT);
  const lines = doc.splitTextToSize(text, w);
  lines.forEach((ln: any) => {
    y = ensureSpace(doc, y, 12, x);
    doc.text(ln, x, y);
    y += size + 3;
  });
  return y;
}

function sectionTitle(doc: jsPDF, t: string, x: number, y: number): number {
  y = ensureSpace(doc, y, 32, x);
  doc.setFillColor(...BLUE);
  doc.rect(x, y - 2, 4, 15, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(...NAVY);
  doc.text(sanitize(t), x + 10, y + 10);
  return y + 22;
}

function inferThemes(a: Analysis): string[] {
  return ["Ajustes de Fluxo e Validacao Operacional"];
}
