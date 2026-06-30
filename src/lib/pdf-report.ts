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
  titleLabel: string;
  clientDemand: string;
  clientReports: string;
  relevantQuotes: string;
  supportActions: string;
  supportResults: string;
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
    metrics.satisfacao.churnRisk =
      pendentes === 0 ? 0 : satisfaction.churnRisk === "alto" || satisfaction.churnRisk === "medio" ? 1 : 0;
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

function buildOneBlock(key: string, items: Demand[], insightMap: InsightMap, isLast: boolean): DemandItem {
  const date = new Date(`${key}T12:00:00`);
  const cleanedItems = items.map((d) => {
    const r = stripMediaTokens(d.message);
    const rr = d.resolutionMessage ? stripMediaTokens(d.resolutionMessage) : { text: "", filenames: [], kinds: [] };
    return {
      ...d,
      cleanText: r.text,
      filenames: r.filenames,
      cleanResolution: rr.text,
      resolutionFilenames: rr.filenames,
    };
  });

  const seenDemand = new Set<string>();
  const demandSentences: string[] = [];
  for (const ci of cleanedItems) {
    if (ci.cleanText && !seenDemand.has(ci.cleanText.slice(0, 80))) {
      seenDemand.add(ci.cleanText.slice(0, 80));
      demandSentences.push(ci.cleanText);
    }
  }

  const dateLabel = isLast ? `No dia ${fmtDateOnly(date)} (recente):` : `No dia ${fmtDateOnly(date)}:`;
  const responses = cleanedItems
    .filter((d) => d.status === "resolvido")
    .map((r) => ({
      who: r.resolvedBy || "Suporte",
      text: r.cleanResolution || "Ajuste operacional concluído.",
    }));

  return {
    dateLabel,
    titleLabel: "",
    clientDemand: `No dia ${fmtDateOnly(date)} d${items[0]?.requester ? ` o cliente ${sanitize(items[0].requester)}` : "o contratante"} reportou: ${demandSentences.join(" ")}`,
    clientReports: "",
    relevantQuotes: "",
    supportActions: `Retorno: ${responses.map((r) => `[${r.who}] ${r.text}`).join(" ")}`,
    supportResults: "",
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

  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(sanitize(draft.title), margin, y + 18);
  y += 28;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(sanitize(draft.subtitle), margin, y);
  y += 16;

  const ar = draft.satisfaction?.auditReport;
  if (ar) {
    if (draft.metrics.pendentes === 0) {
      ar.health.label = "Estavel / Controlado";
      ar.health.justification =
        "Todas as demandas e pendencias operacionais abertas pela clinica foram completamente sanadas pelo suporte tecnico.";
      ar.csat.classification = "Satisfeito";
    }

    // Seção 2: Participantes (Higienizada com sanitize)
    y = sectionTitle(doc, "2. Mapeamento de Participantes da Jornada", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Nome / Cargo", "Organizacao", "Atribuicao Operacional"]],
      body: ar.participants.map((p) => [sanitize(p.name), sanitize(p.org), sanitize(p.role)]),
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.5 },
      styles: { fontSize: 9, lineColor: RULE, textColor: TEXT },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;

    // Seção 3: Linha do Tempo (Higienizada com sanitize em todas as células das colunas)
    y = sectionTitle(doc, "3. Linha do Tempo Operacional (Fatos Relevantes)", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Data", "Categoria", "Resumo do Fato", "Posicionamento do Suporte", "Status"]],
      body: ar.timeline.map((t) => {
        const c = categoryLabel(t.category);
        return [
          sanitize(t.date),
          sanitize(c.label),
          sanitize(t.summary),
          sanitize(t.supportResponse),
          sanitize(t.status),
        ];
      }),
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9 },
      styles: { fontSize: 8.5, lineColor: RULE, textColor: TEXT },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 100 }, 2: { cellWidth: 150 }, 3: { cellWidth: 130 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;

    // Seção 4: Comportamento do Suporte (FIXED: Removidos em definitivo os emojis que poluíam os cabeçalhos das sub-tabelas)
    y = sectionTitle(doc, "4. Auditoria Comportamental da Equipe de Suporte", margin, y);
    y = renderQuadrant(
      doc,
      "Acoes Resolutivas",
      ar.supportBehavior?.resolutive ?? [],
      [46, 139, 87],
      margin,
      y,
      contentW,
    );
    y = renderQuadrant(
      doc,
      "Defesas Tecnicas Legitimas",
      ar.supportBehavior?.defenses ?? [],
      [200, 150, 30],
      margin,
      y,
      contentW,
    );
    y = renderQuadrant(
      doc,
      "Limitacoes do Produto Declaradas",
      ar.supportBehavior?.limitations ?? [],
      BLUE,
      margin,
      y,
      contentW,
    );
    y = renderQuadrant(
      doc,
      "Silencios, Demoras e Gargalos",
      ar.supportBehavior?.silences ?? [],
      ALERT_BORDER,
      margin,
      y,
      contentW,
    );

    // Seção 5: Indicadores
    y = sectionTitle(doc, "5. Painel de Indicadores Executivos", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Indicador", "Quantidade"]],
      body: [
        ["Ajustes / Configuracoes realizadas", String(ar.indicators?.ajustes ?? draft.metrics.resolvidas)],
        ["Duvidas sanadas", String(ar.indicators?.duvidas ?? 0)],
        ["Bugs / Inconsistencias reais do sistema", String(ar.indicators?.bugs ?? 0)],
        ["Reaberturas / Problemas recorrentes", String(ar.indicators?.reaberturas ?? draft.metrics.pendentes)],
      ],
      headStyles: { fillColor: NAVY_DEEP },
      styles: { fontSize: 9 },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;

    // Seção 6: Saúde, Evolução e Esforço
    y = sectionTitle(doc, "6. Saude, Evolucao e Esforco", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Indicador", "Classificacao", "Justificativa"]],
      body: [
        ["Saude do Atendimento", sanitize(ar.health?.label), sanitize(ar.health?.justification)],
        ["Evolucao do Humor", sanitize(ar.humorEvolution?.label), sanitize(ar.humorEvolution?.justification)],
        ["Nivel de Esforco do Cliente", sanitize(ar.effort?.label), sanitize(ar.effort?.detail)],
      ],
      headStyles: { fillColor: NAVY_DEEP },
      styles: { fontSize: 9, valign: "top" },
      columnStyles: { 0: { cellWidth: 140 }, 1: { cellWidth: 100 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 16;

    // Seção 7: Mapeamento Emocional
    if (ar.emotionalMoments?.length) {
      y = sectionTitle(doc, "7. Mapeamento Emocional do Cliente", margin, y);
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
        headStyles: { fillColor: NAVY_DEEP },
        styles: { fontSize: 8.5 },
        columnStyles: { 3: { cellWidth: 180 } },
        margin: { left: margin, right: margin },
      });
      y = (doc as any).lastAutoTable.finalY + 16;
    }

    // TRADUÇÃO DE EMOJIS DA LINHA DO TEMPO: Converte ícones em tags textuais limpas legíveis pela biblioteca de PDF
    if (ar.humorTimeline?.length) {
      y = ensureSpace(doc, y, 32, margin);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...NAVY);
      doc.text("Linha do Tempo do Humor:", margin, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...TEXT);
      const emojiToText = (em: string) => {
        const cleanEm = em.trim();
        if (cleanEm === "😊" || cleanEm === "🙂") return "[Satisfeito]";
        if (cleanEm === "😐") return "[Neutro]";
        if (cleanEm === "😠" || cleanEm === "😡") return "[Frustrado]";
        if (cleanEm === "😟") return "[Preocupado]";
        return "";
      };
      const line = ar.humorTimeline
        .map((h) => `${sanitize(h.date)} ${emojiToText(h.emoji)}`)
        .filter((l) => l.trim().length > 5)
        .join("   ->   ");
      const wrapped = doc.splitTextToSize(line, contentW) as string[];
      for (const ln of wrapped) {
        y = ensureSpace(doc, y, 12, margin);
        doc.text(ln, margin, y);
        y += 12;
      }
      y += 6;
    }

    // Seção 8: CSAT Analítico
    y = sectionTitle(doc, "8. Score de Satisfacao do Cliente (CSAT Analitico)", margin, y);
    doc.setFillColor(...INFO_BG);
    doc.roundedRect(margin, y, contentW, 40, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(`Score Final: ${ar.csat?.score ?? draft.metrics.pctResolucao.toFixed(0)}/100`, margin + 15, y + 25);
    y += 55;

    // Seção 9: Churn
    y = sectionTitle(doc, "9. Deteccao e Evidenciacao do Alerta de Risco de Churn", margin, y);
    if (draft.metrics.pendentes === 0 || !ar.churnSignals?.length) {
      y = paragraph(
        doc,
        "Nenhum sinal ativo de risco de churn no encerramento deste período.",
        margin,
        y,
        contentW,
        9.5,
      );
    } else {
      ar.churnSignals.forEach((s, idx) => {
        y = ensureSpace(doc, y, 50, margin);
        doc.setFillColor(...ALERT_BG);
        doc.roundedRect(margin, y, contentW, 45, 3, 3, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(...ALERT_BORDER);
        doc.text(`Sinal #${idx + 1} [Peso ${sanitize(s.weight)}] — Data: ${sanitize(s.date)}`, margin + 10, y + 15);
        doc.setFont("helvetica", "normal");
        doc.text(`Mensagem: "${sanitize(s.quote)}"`, margin + 10, y + 30);
        y += 55;
      });
    }

    // Seção 10: Diagnóstico e Melhorias
    y = sectionTitle(doc, "10. Diagnostico Final e Oportunidades de Melhoria", margin, y);
    y = renderListBox(doc, "Pontos Positivos Identificados", ar.diagnosis?.strengths ?? [], margin, y, contentW);
    y = renderListBox(doc, "Pontos de Atencao Criticos", ar.diagnosis?.attentionPoints ?? [], margin, y, contentW);
    y = renderListBox(
      doc,
      "Melhorias Sugeridas para o Produto",
      ar.diagnosis?.opportunities?.product ?? [],
      margin,
      y,
      contentW,
    );

    // Seção 11: Resumo Executivo e Próximos Passos
    y = sectionTitle(doc, "11. Resumo Executivo e Conclusao", margin, y);
    y = renderListBox(
      doc,
      "Plano de Acao e Proximos Passos",
      ar.conclusion?.nextSteps?.map((s) => `${sanitize(s.action)} (Responsavel: ${sanitize(s.owner)})`) ?? [],
      margin,
      y,
      contentW,
    );
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`${i}/${pageCount}`, pageW - margin, pageH - 15, { align: "right" });
  }

  return doc;
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
    lines.forEach((ln) => {
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
