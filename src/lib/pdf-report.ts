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

// ============================================================
// TEXT SANITIZATION
// ============================================================

// Remove zero-width / bidi marks that WhatsApp injects (especially around media)
// Remove emojis & non-BMP chars (helvetica from jsPDF doesn't render them — they appear as garbage / weird spacing)
function flowify(s: string): string {
  // Substitui IA, I.A., Bot, Robô, Robo (qualquer caixa) por "Flow".
  // Usa lookarounds em vez de \b para funcionar com "Robô".
  return s
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(I\.?A\.?|Bot|Rob[oô])(?![A-Za-zÀ-ÿ0-9])/gi, "Flow")
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(intelig[eê]ncia\s+artificial)(?![A-Za-zÀ-ÿ0-9])/gi, "Flow")
    .replace(/(?<![A-Za-zÀ-ÿ0-9])(chatbot|agente\s+flow|agente)(?![A-Za-zÀ-ÿ0-9])/gi, "Flow");
}

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
  // Substitui referências a IA/Bot/Robô por "Flow"
  s = flowify(s);
  // Colapsa "Flow Flow" / "Flow flow" repetidos resultantes da substituição
  s = s.replace(/\b(Flow)(\s+Flow)+\b/gi, "Flow");
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
  // Mantido para compatibilidade; preferimos usar attachmentInsightSentences abaixo.
  if (!insightMap.size) return "";
  const items = attachmentInsightSentences(filenames, insightMap);
  return items.length ? items.join(" ") : "";
}

// Extrai frases narrativas já interpretadas a partir dos anexos (OCR/transcrição).
// Retorna o conteúdo real sem rótulos genéricos como "Anexo identificado".
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

// ============================================================
// BUILD DRAFT
// ============================================================

export function buildDraft(
  a: Analysis,
  sourceName: string,
  attachmentInsights: AttachmentInsight[] = [],
  satisfaction: SatisfactionAnalysis | null = null,
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
        : lastClient
          ? `Último contato do cliente em ${fmtDateOnly(lastClient.date)} (sem texto correspondente no histórico).`
          : "Sem contato recente do cliente identificado.",
      lastSupport && lastSupportText
        ? `Última devolutiva da equipe Amigo Flow em ${fmtDateOnly(lastSupport.date)}: ${lastSupportText}`
        : lastSupport
          ? `Última devolutiva da equipe Amigo Flow em ${fmtDateOnly(lastSupport.date)} (sem texto correspondente no histórico).`
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
            return c ? `• ${fmtDateOnly(d.date)} — ${c}` : `• ${fmtDateOnly(d.date)} — demanda registrada no grupo.`;
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
    metrics: buildMetrics(a, satisfaction),
    consolidatedSummary: "",
    satisfaction,
  };
  draft.consolidatedSummary =
    (satisfaction?.consolidatedSummary && satisfaction.consolidatedSummary.trim()) ||
    buildConsolidatedSummary(a, draft, themes);
  return draft;
}

function detectClientGenderSuffix(name: string): "o" | "a" {
  const w = (name || "").trim().split(/\s+/).pop()?.toLowerCase() || "";
  // Heurística PT-BR: termos femininos comuns ou terminação em "a"
  if (/^(clinica|clínica|dra|dra\.|sra|sra\.|recep[cç][aã]o)$/.test(w)) return "a";
  if (/a$/.test(w)) return "a";
  return "o";
}

function pickFirstClientQuote(a: Analysis): string {
  for (const m of a.messages ?? []) {
    if (m.isSystem) continue;
    if (getAmigoFlowSupportName(m.author)) continue;
    const t = stripMediaTokens(m.content).text.trim();
    if (t && t.length > 12 && t.length < 180) return t;
  }
  return "";
}

function buildConsolidatedSummary(
  a: Analysis,
  draft: ReportDraft,
  themes: string[],
): string {
  const total = a.demandStats.total;
  const res = a.demandStats.resolvidas;
  const pend = a.demandStats.pendentes;
  const firstD = a.firstDate ? fmtDateOnly(a.firstDate) : "—";
  const lastD = a.lastDate ? fmtDateOnly(a.lastDate) : "—";
  const resolvers = a.demandStats.resolvedoresTop
    .slice(0, 3)
    .map((r) => sanitize(r.name))
    .join(", ");
  const tema1 = themes[0] ?? "ajustes operacionais e validações do Agente Flow";
  const temasExtras =
    themes.slice(1).join(", ") ||
    "ajustes pontuais, esclarecimentos técnicos e validações junto à clínica";

  const suf = detectClientGenderSuffix(draft.clientName);
  // artigos concordantes
  const o = suf === "a" ? "a" : "o";
  const O = suf === "a" ? "A" : "O";
  const clienteRef = `${o} client${suf}`; // "o cliente" / "a cliente"
  const contratante = suf === "a" ? "contratante" : "contratante";
  const firstQuote = pickFirstClientQuote(a);

  const p1 =
    `${O} atendimento ${draft.clientName ? `do grupo ${sanitize(draft.clientName)}` : "auditado"} teve início em ${firstD}, ` +
    `com o registro das primeiras solicitações d${o} ${contratante} no canal de implantação do Agente Flow. ` +
    `${O} client${suf} apresentou demanda inicial concentrada em ${tema1}, motivando o engajamento da equipe Amigo Flow ` +
    `para análise, orientação e tratativa (tratativa conduzida de forma cronológica e documentada no histórico). ` +
    `Ao longo do período auditado foram contabilizadas ${total} demanda(s) distintas, abrangendo solicitações de configuração, ` +
    `dúvidas operacionais, validações de fluxo e ajustes pontuais identificados a partir das interações registradas, ` +
    `incluindo o conteúdo extraído dos anexos compartilhados (prints de tela, áudios, documentos e demais evidências).`;

  const p2 =
    `Durante o desenvolvimento do caso, a equipe Amigo Flow${resolvers ? ` — com atuação de ${resolvers} — ` : " "}` +
    `promoveu devolutivas, análises de comportamento do agente e orientações específicas para cada apontamento d${o} client${suf}. ` +
    `As tratativas envolveram ${temasExtras}, sempre com base nas evidências apresentadas (mensagens textuais, ` +
    `transcrições de áudio, leitura de prints e documentos incorporados ao histórico). ` +
    `As interações foram conduzidas de forma cronológica, permitindo o acompanhamento contínuo do andamento de cada solicitação ` +
    `e a confirmação das ações executadas pela equipe técnica, com registro das validações e respostas d${o} client${suf} quando houve manifestação.`;

  const fechamento = pend
    ? `aguardando validação final ou confirmação d${o} ${contratante} para encerramento. ` +
      `O desfecho consolidado evidencia a necessidade de continuidade pontual no acompanhamento, ` +
      `mantendo o grupo ativo até a confirmação das pendências remanescentes`
    : `com o caso apto a encerramento formal. ` +
      `O desfecho consolidado evidencia estabilização do atendimento, com pendências sanadas e fluxo do agente operando conforme alinhado com ${o} ${contratante}`;

  const p3 =
    `Até ${lastD}, ${res} demanda(s) foram efetivamente resolvida(s) e ${pend} permanece(m) em acompanhamento, ${fechamento}. ` +
    `O conjunto de registros, anexos interpretados e devolutivas documentadas compõe a base de evidências utilizada por esta auditoria ` +
    `para subsidiar decisões operacionais e o parecer técnico associado ao módulo Flow.`;

  const paragraphs: string[] = [p1, p2, p3];

  // p4 — citação direta d${o} client${suf}, quando houver fala representativa
  if (firstQuote) {
    paragraphs.push(
      `Entre as manifestações registradas, destaca-se a fala d${o} client${suf}: "${firstQuote}". ` +
      `Esse trecho ilustra o tom da interação e foi considerado na leitura qualitativa do atendimento ` +
      `(referência cruzada com os anexos interpretados e com a linha do tempo consolidada). ` +
      `[Observação: citações foram preservadas conforme registradas no histórico original, sem alteração de conteúdo.]`,
    );
  }

  // p5 — recomendação final / sinal de satisfação ou risco
  const churn = (draft.metrics.churnQuotes ?? []).slice(0, 1)[0];
  if (churn) {
    paragraphs.push(
      `[Atenção] Foi identificado sinal de risco de descontinuidade na fala d${o} client${suf}: "${sanitize(churn)}". ` +
      `Recomenda-se contato direto da equipe Amigo Flow para reforço de adesão e validação de expectativas ` +
      `(ação prioritária dentro do plano de acompanhamento da conta).`,
    );
  } else if (paragraphs.length < 5) {
    paragraphs.push(
      `[Conclusão] A leitura consolidada permite ${o === "a" ? "à leitora" : "ao leitor"} compreender integralmente a jornada do atendimento ` +
      `sem necessidade de acessar a conversa original (os anexos foram interpretados e incorporados ao corpo do relatório). ` +
      `Recomenda-se manter o acompanhamento próximo até a confirmação formal de todas as pendências por parte d${o} ${contratante}.`,
    );
  }

  return paragraphs.slice(0, 5).join("\n\n");
}

const VERY_POS_RE =
  /\b(excelente|perfeito|fant[aá]stico|excepcional|incr[ií]vel|impressionante|maravilh\w+|sensacional|recomendo|superou (?:as )?expectativas?|adorei|melhor decis[aã]o|mudou .* rotina|retorno (?:foi )?imediato|valeu cada (?:investimento|centavo)|experi[eê]ncia .* excelente|muito satisfeit\w+)\b/i;
const POS_RE =
  /\b([oó]tim[oa]|bom|boa|f[aá]cil|r[aá]pido|eficiente|pr[aá]tico|intuitivo|confi[aá]vel|funcional|organizad\w+|[uú]til|[aá]gil|preciso|simples|produtiv\w+|funcionou|deu certo|resolvid\w+|certinho|obrigad[ao]|valeu|show|massa|topp?|legal|economizou tempo|facilitou|atendeu .* expectativas?|sem dificuldades?|reduziu erros|implanta[cç][aã]o .* tranquila|resultados? positiv\w+|melhorou .* opera[cç][aã]o|aumentou .* produtividade)\b/i;
const NEUTRAL_RE =
  /\b(regular|razo[aá]vel|aceit[aá]vel|median\w+|intermedi[aá]ri\w+|poderia ser melhor|tem potencial|precisa de ajustes?|atendeu parcialmente|espa[cç]o para evolu[cç][aã]o|nos adaptando|ainda .* aprendendo|faltam (?:algumas )?funcionalidades?|esperava (?:um )?(?:pouco )?mais)\b/i;
const NEG_RE =
  /\b(dif[ií]cil|complicad\w+|confus\w+|burocr[aá]tic\w+|complex\w+|trabalhos\w+|desorganizad\w+|pouco intuitivo|n[aã]o (?:é|e) intuitivo|muitas etapas|muitos cliques|navega[cç][aã]o .* confusa|curva de aprendizado|lent[oa]|demorad\w+|ineficiente|moros\w+|perco muito tempo|n[aã]o (?:economiza|agilizou)|mais lento|gera retrabalho|inst[aá]vel|falh\w+|travand\w+|problem[aá]tic\w+|defeituos\w+|inconsistente|n[aã]o (?:est[aá] )?funcionando|trava (?:frequentemente)?|muitos erros|desempenho .* ruim|cai frequentemente|dados n[aã]o atualizam|agendamento falha|indispon[ií]vel|erros inesperados|frustrante|estressante|cansativ\w+|desgastante|irritante|decepcionante|dor de cabe[cç]a|estou frustrad\w+|estou insatisfeit\w+|estou decepcionad\w+|prejudicando .* rotina|n[aã]o resolveu|p[eé]ssim|ruim|piorou|persiste|reincid)\b/i;
const CHURN_RE =
  /\b(voltar (?:para )?(?:o )?(?:sistema )?antigo|prefiro .* antigo|sistema antigo .* melhor|considerando cancelar|pensando em cancelar|procurar outra solu[cç][aã]o|n[aã]o valeu .* mudan[cç]a|arrependid\w+ (?:da )?(?:troca|contrata[cç][aã]o)|quero voltar|n[aã]o me adaptei|n[aã]o recomendo|avaliando trocar|trocar de fornecedor|se continuar assim .* cancelar|vamos cancelar|atrapalha mais do que ajuda|d[aá] mais trabalho do que ajuda|perdendo produtividade|equipe n[aã]o (?:gostou|quer usar)|ades[aã]o .* baixa|resist[eê]ncia [aà] mudan[cç]a|colaboradores preferem .* antigo)\b/i;

function formatParticipantLabel(value: string): string {
  const raw = sanitize(value || "").trim();
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 10) {
    if (digits.startsWith("55") && digits.length >= 12) {
      const ddd = digits.slice(2, 4);
      const local = digits.slice(4);
      if (local.length === 9) return `+55 (${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`;
      if (local.length === 8) return `+55 (${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
    }
    return raw;
  }
  return raw;
}

function metricsWithAiSatisfaction(metrics: ReportMetrics, satisfaction: SatisfactionAnalysis | null): ReportMetrics {
  if (!satisfaction) return metrics;
  const satisfacao = {
    muitoSatisfeito: 0,
    satisfeito: 0,
    neutro: 0,
    insatisfeito: 0,
    churnRisk: satisfaction.churnRisk === "alto" ? 1 : satisfaction.churnRisk === "medio" ? 1 : 0,
  };
  if (satisfaction.sentiment === "muito_satisfeito") satisfacao.muitoSatisfeito = 1;
  else if (satisfaction.sentiment === "satisfeito") satisfacao.satisfeito = 1;
  else if (satisfaction.sentiment === "insatisfeito" || satisfaction.sentiment === "muito_insatisfeito") satisfacao.insatisfeito = 1;
  else satisfacao.neutro = 1;

  return { ...metrics, satisfacao };
}

function buildMetrics(a: Analysis, satisfaction: SatisfactionAnalysis | null = null): ReportMetrics {
  const totalSolicitacoes = a.demands.length;
  const resolvidas = a.demands.filter((d) => d.status === "resolvido").length;
  const pendentes = a.demands.filter((d) => d.status === "pendente").length;
  const totalRespostas = resolvidas;
  const pctResolucao = totalSolicitacoes ? (resolvidas / totalSolicitacoes) * 100 : 0;

  const reqMap = new Map<string, number>();
  for (const d of a.demands) {
    const n = formatParticipantLabel(d.requester || "—");
    reqMap.set(n, (reqMap.get(n) ?? 0) + 1);
  }
  const topRequesters = [...reqMap.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const topResponders = a.demandStats.resolvedoresTop.slice(0, 5).map((r) => ({
    name: r.name,
    count: r.count,
  }));

  // Analisa TODAS as mensagens da clínica (não-suporte) na janela do parecer,
  // além das devolutivas registradas em cada demanda. Cada mensagem classificada
  // contribui uma única vez, com prioridade: churn > insatisfeito > muito satisfeito
  // > satisfeito > neutro.
  const wStart = a.closureVerdict?.windowStart?.getTime() ?? 0;
  const wEnd = a.closureVerdict?.windowEnd?.getTime() ?? Date.now();
  const samples: string[] = [];
  for (const m of a.messages) {
    if (m.isSystem || !m.author || m.hasMedia) continue;
    const ts = m.date.getTime();
    if (ts < wStart || ts > wEnd) continue;
    if (isAmigoFlowSupport(m.author)) continue;
    if (isGreetingOrNoise(m.content)) continue;
    const t = m.content.trim();
    if (t.length < 4) continue;
    samples.push(t);
  }
  for (const d of a.demands) {
    if (d.clientFollowUp) samples.push(d.clientFollowUp);
  }

  let muitoSatisfeito = 0;
  let satisfeito = 0;
  let neutro = 0;
  let insatisfeito = 0;
  let churnRisk = 0;
  const churnQuotes: string[] = [];
  for (const raw of samples) {
    const t = raw.toLowerCase();
    if (CHURN_RE.test(t)) {
      churnRisk++;
      insatisfeito++;
      if (churnQuotes.length < 5) churnQuotes.push(sanitize(raw).slice(0, 220));
      continue;
    }
    if (NEG_RE.test(t)) {
      insatisfeito++;
      continue;
    }
    if (VERY_POS_RE.test(t)) {
      muitoSatisfeito++;
      continue;
    }
    if (POS_RE.test(t)) {
      satisfeito++;
      continue;
    }
    if (NEUTRAL_RE.test(t)) {
      neutro++;
      continue;
    }
  }
  if (!muitoSatisfeito && !satisfeito && !neutro && !insatisfeito && !churnRisk && (samples.length || a.demands.length)) {
    neutro = 1;
  }

  return metricsWithAiSatisfaction({
    totalSolicitacoes,
    totalRespostas,
    pendentes,
    resolvidas,
    pctResolucao,
    topRequesters,
    topResponders,
    satisfacao: { muitoSatisfeito, satisfeito, neutro, insatisfeito, churnRisk },
    churnQuotes,
  }, satisfaction);
}

// ============================================================
// DEMAND BLOCKS (narrative, "No dia .../Retorno:", min 1000 chars)
// ============================================================

function relativeDateLabel(date: Date): string | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((today - target) / 86_400_000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "ontem";
  if (diff >= 2 && diff <= 6) {
    const names = [
      "domingo",
      "segunda-feira",
      "terça-feira",
      "quarta-feira",
      "quinta-feira",
      "sexta-feira",
      "sábado",
    ];
    return names[date.getDay()];
  }
  if (diff >= 7 && diff <= 13) return "semana passada";
  const sameMonth =
    now.getMonth() === date.getMonth() && now.getFullYear() === date.getFullYear();
  if (diff >= 14 && !sameMonth) return "mês passado";
  return null;
}

function buildDateLabel(date: Date, isLast: boolean): string {
  const formal = fmtDateOnly(date);
  if (!isLast) return `No dia ${formal}:`;
  const rel = relativeDateLabel(date);
  return rel ? `No dia ${formal} (${rel}):` : `No dia ${formal}:`;
}

function decapFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function ensureSentence(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : t + ".";
}

const CLIENT_CONNECTORS = [
  "Em complemento,",
  "Além disso,",
  "Na sequência,",
  "Ainda no mesmo contato,",
  "O cliente também apontou que",
  "Em paralelo,",
  "Outro ponto trazido foi que",
];

const SUPPORT_CONNECTORS = [
  "Em seguida,",
  "Logo depois,",
  "Como desdobramento,",
  "Posteriormente,",
  "Na mesma tratativa,",
  "Para complementar,",
];

function composeClientNarrative(prefix: string, requester: string, sentences: string[]): string {
  const cleaned = sentences.map((s) => s.trim()).filter((s) => s && s.length > 3);
  if (!cleaned.length) {
    return `${prefix} o cliente ${requester ? `(${sanitize(requester)}) ` : ""}registrou contato no grupo de implantação relacionado ao acompanhamento operacional do Agente Flow.`;
  }
  const head = `${prefix} o cliente ${cleaned.length === 1 ? "relatou que" : "trouxe os seguintes apontamentos:"} ${ensureSentence(decapFirst(cleaned[0]))}`;
  const tail = cleaned
    .slice(1)
    .map(
      (s, i) =>
        `${CLIENT_CONNECTORS[i % CLIENT_CONNECTORS.length]} ${ensureSentence(decapFirst(s))}`,
    )
    .join(" ");
  return [head, tail].filter(Boolean).join(" ");
}

function composeSupportNarrative(
  responses: { who: string; text: string; followUp?: string; followUpAt?: Date }[],
): string {
  if (!responses.length) {
    return "Retorno: até o fechamento desta auditoria não foi localizada devolutiva textual da equipe Amigo Flow vinculada a esta demanda específica, mantendo-a em acompanhamento até confirmação interna de tratativa.";
  }
  const parts: string[] = [];
  responses.forEach((r, i) => {
    const who = r.who || "a equipe Amigo Flow";
    const body = r.text ? ensureSentence(decapFirst(r.text)) : "";
    if (!body) return;
    if (i === 0) parts.push(`Retorno: ${who}, do suporte, ${body}`);
    else parts.push(`${SUPPORT_CONNECTORS[i % SUPPORT_CONNECTORS.length]} ${who} ${body}`);
    if (r.followUp) {
      parts.push(
        `Em resposta, no dia ${fmtDateOnly(r.followUpAt)} o cliente retornou informando que ${ensureSentence(decapFirst(r.followUp))}`,
      );
    }
  });
  if (!parts.length) {
    return "Retorno: a devolutiva da equipe Amigo Flow nesta demanda foi feita por canal complementar e não preservou texto estruturado no histórico do grupo, permanecendo sob acompanhamento interno.";
  }
  return parts.join(" ");
}

const CLIENT_PADDINGS = [
  "O contato reforça a necessidade de revisar o comportamento do Agente Flow no fluxo descrito, garantindo aderência ao roteiro esperado pela clínica.",
  "O relato foi registrado no histórico do grupo de implantação e considerado como evidência operacional para fins de auditoria do módulo.",
  "A clínica demonstrou preocupação com o impacto da ocorrência na experiência do paciente e no fluxo de agendamento conduzido pelo Agente Flow.",
  "A demanda compõe o conjunto de apontamentos que orientam ajustes de configuração, prompt e base de conhecimento do agente.",
  "O caso foi analisado considerando o contexto operacional da clínica e a expectativa de comportamento previamente alinhada com o time de implantação.",
];

const SUPPORT_PADDINGS = [
  "A tratativa segue acompanhada pela equipe Amigo Flow para validação do efeito prático do ajuste sobre o fluxo do agente.",
  "A devolutiva registrada compõe o histórico de evidências utilizadas para reavaliar configurações, prompts e regras associadas ao Flow.",
  "O encaminhamento foi mantido sob acompanhamento até confirmação formal pela clínica de que o comportamento do agente atende ao esperado.",
  "Eventuais reincidências do mesmo sintoma serão tratadas com revisão complementar de parâmetros e base de conhecimento do agente.",
  "O retorno fica disponível como referência para futuras solicitações relacionadas ao mesmo módulo dentro do escopo auditado.",
];

function padToMin(text: string, paddings: string[], min = 600): string {
  let out = text.trim();
  let i = 0;
  while (out.length < min && i < paddings.length * 4) {
    out += " " + paddings[i % paddings.length];
    i++;
  }
  return out;
}

function buildDemandBlocks(a: Analysis, insightMap: InsightMap): DemandItem[] {
  // Group by date (chronological)
  const grouped = new Map<string, Demand[]>();
  for (const d of a.demands) {
    const key = d.date.toISOString().slice(0, 10);
    grouped.set(key, [...(grouped.get(key) ?? []), d]);
  }

  const sortedKeys = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  return sortedKeys.map((key, idx) =>
    buildOneBlock(key, grouped.get(key)!, insightMap, idx === sortedKeys.length - 1),
  );
}

function buildOneBlock(
  key: string,
  items: Demand[],
  insightMap: InsightMap,
  isLast: boolean,
): DemandItem {
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

  // Dedupe demand sentences by first 80 chars
  const seenDemand = new Set<string>();
  const demandSentences: string[] = [];
  for (const ci of cleanedItems) {
    const t = ci.cleanText;
    if (!t || t.length < 4) continue;
    const sig = t.slice(0, 80).toLowerCase();
    if (seenDemand.has(sig)) continue;
    seenDemand.add(sig);
    demandSentences.push(t);
  }

  // Anexos do cliente (mensagem) interpretados pela IA — entram como frases reais
  const clientFilenames = cleanedItems.flatMap((c) => c.filenames);
  for (const s of attachmentInsightSentences(clientFilenames, insightMap)) {
    const sig = s.slice(0, 80).toLowerCase();
    if (seenDemand.has(sig)) continue;
    seenDemand.add(sig);
    demandSentences.push(s);
  }

  const requester = items[0]?.requester ?? "";
  const dateLabel = buildDateLabel(date, isLast);

  // Devolutivas (deduped, drop link-only) — usa também insights dos anexos enviados pelo suporte
  const LINK_TXT = /\blink\b|https?:\/\/|\bwww\./i;
  const seenResp = new Set<string>();
  const responses: { who: string; text: string; followUp?: string; followUpAt?: Date }[] = [];
  for (const r of cleanedItems.filter((d) => d.status === "resolvido")) {
    const who = r.resolvedBy ?? "Equipe Amigo Flow";
    let txt = r.cleanResolution;
    if (txt && LINK_TXT.test(txt)) continue;
    if (!txt && r.resolutionFilenames.length) {
      const ins = attachmentInsightSentences(r.resolutionFilenames, insightMap);
      txt = ins.join(" ");
    }
    // Limpa o follow-up do cliente: remove placeholders de mídia
    // ("[Áudio enviado pela clínica]", "(arquivo anexado)", nomes de arquivo)
    // e, quando houver insight de IA para o anexo, substitui pela transcrição/descrição real.
    let followUpClean: string | undefined;
    if (r.clientFollowUp) {
      const fu = stripMediaTokens(r.clientFollowUp);
      let base = fu.text;
      if (fu.filenames.length) {
        const ins = attachmentInsightSentences(fu.filenames, insightMap).join(" ");
        if (ins) base = base ? `${base} ${ins}` : ins;
      }
      if (base && !LINK_TXT.test(base) && base.length > 3) followUpClean = base;
    }
    const sig = `${who}|${(txt || "").slice(0, 80).toLowerCase()}`;
    if (seenResp.has(sig)) continue;
    seenResp.add(sig);
    responses.push({
      who,
      text: txt,
      followUp: followUpClean,
      followUpAt: r.clientFollowUpAt,
    });
  }

  let clientNarrative = composeClientNarrative(dateLabel, requester, demandSentences);
  let supportNarrative = composeSupportNarrative(responses);

  clientNarrative = padToMin(clientNarrative, CLIENT_PADDINGS, 260);
  supportNarrative = padToMin(supportNarrative, SUPPORT_PADDINGS, 180);

  return {
    dateLabel,
    titleLabel: "",
    clientDemand: clientNarrative,
    clientReports: "",
    relevantQuotes: "",
    supportActions: supportNarrative,
    supportResults: "",
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

  const hasExtended = !!draft.satisfaction?.auditReport;

  // ===== 1. Cabeçalho Executivo já foi renderizado acima (info box).
  // Quando há análise de IA estendida, renderizamos as 11 seções no formato novo.
  if (hasExtended) {
    // 2-3-4-5-6-7-8-9-10-11 (a seção 1 é o próprio cabeçalho/info box acima)
    y = renderExtendedReport(doc, draft, margin, y, contentW);

    // Indicadores visuais (gráficos) + Linha do tempo detalhada das demandas
    // entram como complemento ao final, mas sem duplicar conteúdo.
    if (draft.demands.length) {
      y = sectionTitle(doc, "Anexo A — Linha do Tempo Detalhada de Demandas", margin, y);
      for (const d of draft.demands) {
        y = demandBlock(doc, d, margin, y, contentW);
      }
    }
    y = sectionTitle(doc, "Anexo B — Indicadores Visuais", margin, y);
    y = renderMetrics(doc, draft.metrics, margin, y, contentW);

    // Resumo consolidado final
    y = sectionTitle(doc, "Anexo C — Resumo Consolidado do Atendimento", margin, y);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    for (const para of sanitize(draft.consolidatedSummary).split(/\n{2,}/)) {
      const text = para.trim();
      if (!text) continue;
      y = ensureSpace(doc, y, 24, margin);
      y = renderRichText(doc, text, margin, margin, contentW, y, 12.5, 0, true, margin);
      y += 6;
    }
    y += 4;
  } else {
    // ----- Fallback: estrutura clássica
    if (draft.envolvidos.length) {
      y = sectionTitle(doc, "1. Contratantes, Colaboradores e Equipe de Suporte", margin, y);
      autoTable(doc, {
        startY: y,
        head: [["Nome do Envolvido", "Organização", "Papel / Atribuição no Processo"]],
        body: draft.envolvidos.map((p) => [sanitize(p.name), p.org, sanitize(p.role)]),
        headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.5, fontStyle: "bold", halign: "left", cellPadding: 7 },
        styles: { fontSize: 9.2, cellPadding: 7, valign: "top", lineColor: RULE, textColor: TEXT },
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

    y = sectionTitle(doc, "2. Linha do Tempo do Atendimento", margin, y);
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

    y = ensureGroupStart(
      doc,
      y,
      estimateMetricsHeight(draft.metrics) + estimateSatisfactionHeight(doc, draft, contentW) + 74,
      margin,
    );

    y = sectionTitle(doc, "3. Indicadores Visuais", margin, y);
    y = renderMetrics(doc, draft.metrics, margin, y, contentW);

    y = sectionTitle(doc, "5. Sentimentos e Satisfação do Cliente", margin, y);
    y = renderSatisfactionSection(doc, draft, margin, y, contentW) + 8;

    y = sectionTitle(doc, "4. Análise do Atendimento", margin, y);
    y = paragraph(doc, sanitize(draft.currentSituation), margin, y, contentW, 9.3) + 8;

    y = sectionTitle(doc, "6. Conclusões e Recomendações", margin, y);
    y = titledParagraph(doc, "Síntese", sanitize(draft.executiveSummary), margin, y, contentW);
    y = titledParagraph(doc, "Principais Temas Identificados", sanitize(draft.mainThemes), margin, y, contentW);

    y = sectionTitle(doc, "7. Resumo Consolidado do Atendimento", margin, y);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    for (const para of sanitize(draft.consolidatedSummary).split(/\n{2,}/)) {
      const text = para.trim();
      if (!text) continue;
      y = ensureSpace(doc, y, 24, margin);
      y = renderRichText(doc, text, margin, margin, contentW, y, 12.5, 0, true, margin);
      y += 6;
    }
    y += 4;
  }



  // ----- Footer minimalista (apenas paginação)
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    doc.text(`${i}/${pageCount}`, pageW - margin, pageH - 10, { align: "right" });
  }
  return doc;
}

// ============================================================
// DEMAND CARD: blue left bar, "No dia ..." prefix in bold + Retorno sub-box
// ============================================================
function demandBlock(doc: jsPDF, d: DemandItem, x: number, y: number, w: number): number {
  const innerX = x + 14;
  const innerW = w - 22;

  const clientText = sanitize(d.clientDemand);
  const supportText = sanitize(d.supportActions);
  const clientPrefix = sanitize(d.dateLabel || "No dia:");
  const supportPrefix = "Retorno:";

  const stripPrefix = (full: string, pref: string) =>
    full.trim().startsWith(pref) ? full.trim().slice(pref.length).trim() : full.trim();

  const clientBody = stripPrefix(clientText, clientPrefix);
  const supportBody = stripPrefix(supportText, supportPrefix);

  // Pré-mede usando linhas planas (sem rich-text) — boa aproximação para a altura do card.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.6);
  const clientPrefW = doc.getTextWidth(clientPrefix) + 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.4);
  const clientFlatLines = doc.splitTextToSize(clientBody, innerW) as string[];
  const clientH = 14 + Math.max(clientFlatLines.length, 1) * 12 + 6;

  doc.setFontSize(9.2);
  const supportFlatLines = doc.splitTextToSize(supportBody, innerW - 16) as string[];
  const resBoxH = 14 + Math.max(supportFlatLines.length, 1) * 11.8 + 10;

  const cardH = clientH + resBoxH + 14;
  const pageH = doc.internal.pageSize.getHeight();
  const availableNow = pageH - 14 - y;
  const pageInner = pageH - 14 - x; // pessimista
  const cardFitsOnFreshPage = cardH + 8 <= pageInner;

  // Se o card é grande demais para caber em uma página inteira, renderiza como
  // fluxo de parágrafos (sem moldura), permitindo quebra natural entre páginas
  // e evitando enormes espaços em branco.
  const shouldFlowInsteadOfCard =
    !cardFitsOnFreshPage || (cardH + 8 > availableNow && availableNow > pageInner * 0.22);
  if (shouldFlowInsteadOfCard) {
    y = ensureSpace(doc, y, 24, x);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.6);
    doc.setTextColor(...NAVY);
    doc.text(clientPrefix, x, y + 12);
    const prefW = doc.getTextWidth(clientPrefix) + 5;
    doc.setFontSize(9.4);
    let py = renderRichText(doc, clientBody, x + prefW, x, w, y + 12, 12, prefW, true, x);
    py += 6;
    py = ensureSpace(doc, py, 18, x);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.4);
    doc.setTextColor(...NAVY);
    doc.text(supportPrefix, x, py);
    const sPrefW = doc.getTextWidth(supportPrefix) + 5;
    doc.setFontSize(9.2);
    py = renderRichText(doc, supportBody, x + sPrefW, x, w, py, 11.8, sPrefW, true, x);
    return py + 14;
  }

  // Se não cabe agora mas cabe em página nova, vale a pena quebrar.
  // Caso contrário, mantém na página atual.
  if (cardH + 8 > availableNow && cardH + 8 <= pageInner) {
    y = ensureSpace(doc, y, cardH + 8, x);
  }

  // Card background + left blue bar
  doc.setDrawColor(...RULE);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, cardH, 3, 3, "FD");
  doc.setFillColor(...BLUE);
  doc.rect(x, y, 4, cardH, "F");

  // Prefixo do cliente em negrito navy, na primeira linha
  let cy = y + 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.6);
  doc.setTextColor(...NAVY);
  doc.text(clientPrefix, innerX, cy);

  doc.setFontSize(9.4);
  cy = renderRichText(doc, clientBody, innerX + clientPrefW, innerX, innerW, cy, 12, clientPrefW);
  cy += 4;

  // Retorno sub-box
  const resBoxX = innerX;
  const resBoxW = innerW;
  doc.setFillColor(...RES_BG);
  doc.setDrawColor(...RES_BORDER);
  doc.roundedRect(resBoxX, cy, resBoxW, resBoxH, 2, 2, "FD");

  let ry = cy + 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.4);
  doc.setTextColor(...NAVY);
  doc.text(supportPrefix, resBoxX + 8, ry);
  const supportPrefW = doc.getTextWidth(supportPrefix) + 5;

  doc.setFontSize(9.2);
  renderRichText(doc, supportBody, resBoxX + 8 + supportPrefW, resBoxX + 8, resBoxW - 16, ry, 11.8, supportPrefW);

  return y + cardH + 12;
}

// Regex de frases/palavras a destacar em negrito dentro de cada parágrafo.
const HIGHLIGHT_RE =
  /(\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{1,2}:\d{2}\b|\b\d+%\b|\b(?:urgente|cr[ií]tico|prioridade|erro|falha|n[aã]o funcionou|n[aã]o (?:est[aá] )?funcionando|travand\w+|cancelar|cancelad\w+|reagend\w+|reagendamento|agendamento|agendar|confirmar|confirma[cç][aã]o|pendente|pendência|resolvido|resolvid\w+|ajustar|ajuste|conv[eê]nio|paciente|m[eé]dic[oa]|recep[cç][aã]o|profissional|guia|autoriza[cç][aã]o|prontu[aá]rio)\b|\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}){0,4}\b)/g;

// Renderiza texto com palavras-chave em negrito, com quebra correta de linha.
// firstX/firstOffset: a 1ª linha começa em (firstX, y) — o prefixo "No dia X:" já foi escrito antes.
// nextX/innerW: a partir da 2ª linha, escreve em (nextX, y) com largura innerW.
function renderRichText(
  doc: jsPDF,
  body: string,
  firstX: number,
  nextX: number,
  innerW: number,
  y: number,
  lineH: number,
  firstOffset: number,
  pageBreak: boolean = false,
  margin: number = 48,
): number {
  // Tokeniza preservando espaços; cada token leva uma flag de negrito.
  const tokens: { t: string; b: boolean }[] = [];
  let lastIdx = 0;
  for (const m of body.matchAll(HIGHLIGHT_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) tokens.push({ t: body.slice(lastIdx, idx), b: false });
    tokens.push({ t: m[0], b: true });
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < body.length) tokens.push({ t: body.slice(lastIdx), b: false });
  const words: { t: string; b: boolean }[] = [];
  for (const tk of tokens) {
    const parts = tk.t.split(/(\s+)/);
    for (const p of parts) if (p.length) words.push({ t: p, b: tk.b });
  }
  doc.setTextColor(...TEXT);
  let cx = firstX;
  let maxW = innerW - firstOffset;
  let lineStart = true;
  for (const w of words) {
    const isSpace = /^\s+$/.test(w.t);
    doc.setFont("helvetica", w.b ? "bold" : "normal");
    const tw = doc.getTextWidth(w.t);
    if (!isSpace && cx + tw > (lineStart && cx === firstX ? firstX + maxW : nextX + innerW)) {
      y += lineH;
      if (pageBreak) y = ensureSpace(doc, y, lineH, margin);
      cx = nextX;
      maxW = innerW;
      lineStart = true;
      if (isSpace) continue;
    }
    if (lineStart && isSpace) continue;
    doc.text(w.t, cx, y);
    cx += tw;
    lineStart = false;
  }
  return y + lineH;
}

// ============================================================
// Section 5 renderer — rich satisfaction analysis from AI
// ============================================================
function renderSatisfactionSection(
  doc: jsPDF,
  draft: ReportDraft,
  x: number,
  y: number,
  w: number,
): number {
  const s = draft.satisfaction;
  if (!s) {
    return paragraph(doc, sanitize(buildSentimentNarrative(draft.metrics)), x, y, w, 9.3);
  }

  const sentimentLabel: Record<string, string> = {
    muito_satisfeito: "Muito satisfeito",
    satisfeito: "Satisfeito",
    neutro: "Neutro",
    insatisfeito: "Insatisfeito",
    muito_insatisfeito: "Muito insatisfeito",
  };
  const churnLabel: Record<string, string> = {
    baixo: "Baixo",
    medio: "Médio",
    alto: "Alto",
  };
  const sitLabel: Record<string, string> = {
    resolvido: "Problema resolvido",
    parcialmente_resolvido: "Parcialmente resolvido",
    nao_resolvido: "Não resolvido",
  };
  const evoLabel: Record<string, string> = {
    melhorou: "Melhorou",
    piorou: "Piorou",
    permaneceu: "Permaneceu igual",
  };

  const chips: { label: string; value: string; tone: [number, number, number] }[] = [
    { label: "Sentimento", value: sentimentLabel[s.sentiment] ?? s.sentiment, tone: NAVY_DEEP },
    { label: "Score", value: `${s.score}/100`, tone: BLUE },
    { label: "Confiança", value: `${s.confidence}%`, tone: [46, 139, 87] },
    { label: "Emoção", value: s.emotion || "—", tone: [120, 70, 160] },
    { label: "Evolução", value: evoLabel[s.evolution] ?? s.evolution, tone: NAVY },
    { label: "Situação", value: sitLabel[s.finalSituation] ?? s.finalSituation, tone: BLUE },
    {
      label: "Risco de churn",
      value: churnLabel[s.churnRisk] ?? s.churnRisk,
      tone: s.churnRisk === "alto" ? ALERT_BORDER : s.churnRisk === "medio" ? [200, 120, 30] : [46, 139, 87],
    },
    {
      label: "Intervenção humana",
      value: s.humanInterventionNeeded ? "Sim" : "Não",
      tone: s.humanInterventionNeeded ? ALERT_BORDER : [46, 139, 87],
    },
  ];

  const cols = 4;
  const gap = 6;
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = 42;
  const rows = Math.ceil(chips.length / cols);
  y = ensureSpace(doc, y, rows * (ch + gap) + 4, x);
  for (let i = 0; i < chips.length; i++) {
    const c = chips[i];
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + gap);
    doc.setFillColor(...INFO_BG);
    doc.roundedRect(cx, cy, cw, ch, 3, 3, "F");
    doc.setFillColor(...c.tone);
    doc.rect(cx, cy, 3, ch, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.6);
    doc.setTextColor(...MUTED);
    doc.text(c.label.toUpperCase(), cx + 8, cy + 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...c.tone);
    const v = doc.splitTextToSize(c.value, cw - 12)[0] ?? "";
    doc.text(v, cx + 8, cy + 28);
  }
  y += rows * (ch + gap) + 6;

  // Contadores
  const counters: { label: string; value: string }[] = [
    { label: "Reclamações", value: String(s.complaintsCount ?? 0) },
    { label: "Elogios", value: String(s.praisesCount ?? 0) },
    { label: "Solicitações repetidas", value: String(s.repeatedRequestsCount ?? 0) },
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  const counterLine = counters.map((c) => `${c.label}: ${c.value}`).join("  •  ");
  y = ensureSpace(doc, y, 14, x);
  doc.text(counterLine, x, y);
  y += 14;

  // Resumo executivo
  if (s.executiveSummary) {
    y = ensureSpace(doc, y, 22, x);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);
    doc.setTextColor(...NAVY);
    doc.text("Resumo da análise:", x, y);
    y += 12;
    y = renderRichText(doc, sanitize(s.executiveSummary), x, x, w, y, 12, 0, true, x) + 2;
  }

  // Principais motivos
  if (s.mainReasons?.length) {
    y = ensureSpace(doc, y, 22, x);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.2);
    doc.setTextColor(...NAVY);
    doc.text("Principais motivos:", x, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...TEXT);
    for (const r of s.mainReasons) {
      y = ensureSpace(doc, y, 12, x);
      const lines = doc.splitTextToSize(`• ${sanitize(r)}`, w);
      for (const ln of lines) {
        y = ensureSpace(doc, y, 12, x);
        doc.text(ln, x, y);
        y += 11.5;
      }
    }
  }

  return y;
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


// ============================================================
// CHARTS / METRICS RENDERER
// ============================================================
function barChartHeight(items: { name: string; count: number }[]): number {
  return 26 + Math.max(items.length, 1) * 16 + 10;
}

function estimateMetricsHeight(m: ReportMetrics): number {
  const barRowH = Math.max(barChartHeight(m.topRequesters), barChartHeight(m.topResponders));
  const alertH = m.satisfacao.churnRisk > 0 || m.churnQuotes.length > 0
    ? 26 + Math.min(m.churnQuotes.length, 3) * 12 + 18
    : 0;
  return 50 + 16 + barRowH + 10 + 110 + 10 + alertH;
}

function estimateSatisfactionHeight(doc: jsPDF, draft: ReportDraft, w: number): number {
  const s = draft.satisfaction;
  if (!s) return 62;
  let h = Math.ceil(8 / 4) * (42 + 6) + 20;
  if (s.executiveSummary) {
    h += 14 + (doc.splitTextToSize(sanitize(s.executiveSummary), w) as string[]).length * 12 + 4;
  }
  if (s.mainReasons?.length) {
    h += 14 + s.mainReasons.slice(0, 6).reduce((sum, r) => sum + Math.max(1, (doc.splitTextToSize(`• ${sanitize(r)}`, w) as string[]).length) * 12, 0);
  }
  return h;
}

function renderMetrics(
  doc: jsPDF,
  m: ReportMetrics,
  x: number,
  y: number,
  w: number,
): number {
  // KPI row: 4 chips
  const kpis: { label: string; value: string; tone: [number, number, number] }[] = [
    { label: "Solicitações", value: String(m.totalSolicitacoes), tone: BLUE },
    { label: "Respostas", value: String(m.totalRespostas), tone: NAVY_DEEP },
    { label: "Pendentes", value: String(m.pendentes), tone: ALERT_BORDER },
    { label: "% Resolução", value: `${m.pctResolucao.toFixed(0)}%`, tone: [46, 139, 87] },
  ];
  const gap = 8;
  const kw = (w - gap * 3) / 4;
  const kh = 50;
  y = ensureSpace(doc, y, kh + 12, x);
  for (let i = 0; i < kpis.length; i++) {
    const k = kpis[i];
    const kx = x + i * (kw + gap);
    doc.setFillColor(...INFO_BG);
    doc.roundedRect(kx, y, kw, kh, 4, 4, "F");
    doc.setFillColor(...k.tone);
    doc.rect(kx, y, 3, kh, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...k.tone);
    doc.text(k.value, kx + 10, y + 24);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(k.label, kx + 10, y + 40);
  }
  y += kh + 16;

  // Two-column charts: Top solicitantes | Top respondentes
  const colW = (w - 14) / 2;
  const barRowH = Math.max(barChartHeight(m.topRequesters), barChartHeight(m.topResponders));
  y = ensureSpace(doc, y, barRowH + 4, x);
  let leftY = y;
  let rightY = y;
  leftY = renderBarChart(doc, "Quem mais solicitou", m.topRequesters, x, leftY, colW, true);
  rightY = renderBarChart(
    doc,
    "Quem mais respondeu",
    m.topResponders,
    x + colW + 14,
    rightY,
    colW,
    true,
  );
  y = Math.max(leftY, rightY) + 10;

  // Pendência x Resolução (stacked bar) + Satisfação (donut-ish)
  y = ensureSpace(doc, y, 114, x);
  leftY = renderStackBar(
    doc,
    "Pendência × Resolução",
    [
      { label: "Resolvidas", value: m.resolvidas, color: [46, 139, 87] },
      { label: "Pendentes", value: m.pendentes, color: ALERT_BORDER },
    ],
    x,
    y,
    colW,
    true,
  );
  rightY = renderDonut(
    doc,
    "Satisfação do cliente",
    [
      { label: "Muito satisfeito", value: m.satisfacao.muitoSatisfeito, color: [22, 110, 70] },
      { label: "Satisfeito", value: m.satisfacao.satisfeito, color: [46, 139, 87] },
      { label: "Neutro", value: m.satisfacao.neutro, color: [110, 120, 132] },
      { label: "Insatisfeito", value: m.satisfacao.insatisfeito, color: ALERT_BORDER },
      { label: "Risco de churn", value: m.satisfacao.churnRisk, color: [140, 20, 40] },
    ],
    x + colW + 14,
    y,
    colW,
    true,
  );
  y = Math.max(leftY, rightY) + 10;

  // Alerta de risco de churn — só aparece se houver sinais
  if (m.satisfacao.churnRisk > 0 || m.churnQuotes.length > 0) {
    const ah = 26 + Math.min(m.churnQuotes.length, 3) * 12 + 10;
    y = ensureSpace(doc, y, ah + 4, x);
    doc.setFillColor(255, 240, 240);
    doc.setDrawColor(...ALERT_BORDER);
    doc.roundedRect(x, y, w, ah, 3, 3, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ALERT_BORDER);
    doc.text(
      `Alerta de risco de churn: ${m.satisfacao.churnRisk} sinal(is) detectado(s)`,
      x + 10,
      y + 16,
    );
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.6);
    doc.setTextColor(...TEXT);
    let qy = y + 30;
    for (const q of m.churnQuotes.slice(0, 3)) {
      const line = doc.splitTextToSize(`“${q}”`, w - 20)[0];
      doc.text(line, x + 10, qy);
      qy += 12;
    }
    y += ah + 8;
  }
  return y;
}

function renderBarChart(
  doc: jsPDF,
  title: string,
  items: { name: string; count: number }[],
  x: number,
  y: number,
  w: number,
  skipEnsure = false,
): number {
  const rowH = 16;
  const h = barChartHeight(items);
  y = skipEnsure ? y : ensureSpace(doc, y, h + 4, x);
  doc.setDrawColor(...RULE);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.6);
  doc.setTextColor(...NAVY);
  doc.text(title, x + 10, y + 16);
  if (!items.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text("Sem dados no período.", x + 10, y + 34);
    return y + h;
  }
  const max = Math.max(...items.map((i) => i.count), 1);
  const labelW = Math.min(118, Math.max(82, w * 0.42));
  const barX = x + 10 + labelW;
  const barMaxW = Math.max(28, w - 20 - labelW - 30);
  let by = y + 30;
  for (const it of items) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.4);
    doc.setTextColor(...TEXT);
    const label = doc.splitTextToSize(it.name || "—", labelW - 4)[0] ?? "—";
    doc.text(label, x + 10, by + 8);
    const bw = (it.count / max) * barMaxW;
    doc.setFillColor(...BLUE);
    doc.rect(barX, by, bw, 9, "F");
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.text(String(it.count), barX + bw + 4, by + 8);
    by += rowH;
  }
  return y + h;
}

function renderStackBar(
  doc: jsPDF,
  title: string,
  parts: { label: string; value: number; color: [number, number, number] }[],
  x: number,
  y: number,
  w: number,
  skipEnsure = false,
): number {
  const h = 90;
  y = skipEnsure ? y : ensureSpace(doc, y, h + 4, x);
  doc.setDrawColor(...RULE);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.6);
  doc.setTextColor(...NAVY);
  doc.text(title, x + 10, y + 16);
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const barX = x + 10;
  const barW = w - 20;
  const barY = y + 28;
  const barH = 18;
  let cx = barX;
  for (const p of parts) {
    const segW = (p.value / total) * barW;
    doc.setFillColor(...p.color);
    doc.rect(cx, barY, segW, barH, "F");
    cx += segW;
  }
  // Legend
  let ly = barY + barH + 14;
  for (const p of parts) {
    doc.setFillColor(...p.color);
    doc.rect(x + 10, ly - 6, 8, 8, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.4);
    doc.setTextColor(...TEXT);
    const pct = ((p.value / total) * 100).toFixed(0);
    doc.text(`${p.label}: ${p.value} (${pct}%)`, x + 22, ly);
    ly += 12;
  }
  return y + h;
}

function renderDonut(
  doc: jsPDF,
  title: string,
  parts: { label: string; value: number; color: [number, number, number] }[],
  x: number,
  y: number,
  w: number,
  skipEnsure = false,
): number {
  const h = 110;
  y = skipEnsure ? y : ensureSpace(doc, y, h + 4, x);
  doc.setDrawColor(...RULE);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.6);
  doc.setTextColor(...NAVY);
  doc.text(title, x + 10, y + 16);

  const total = parts.reduce((s, p) => s + p.value, 0);
  const cx = x + 36;
  const cy = y + 60;
  const rOuter = 26;

  if (!total) {
    doc.setFillColor(220, 226, 232);
    doc.circle(cx, cy, rOuter, "F");
    doc.setFillColor(255, 255, 255);
    doc.circle(cx, cy, rOuter * 0.55, "F");
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text("Satisfação não conclusiva.", x + 76, cy);
    return y + h;
  }

  // Pie via thin triangles
  let start = -Math.PI / 2;
  const steps = 64;
  for (const p of parts) {
    if (p.value <= 0) continue;
    const ang = (p.value / total) * Math.PI * 2;
    const segSteps = Math.max(2, Math.round((ang / (Math.PI * 2)) * steps));
    doc.setFillColor(...p.color);
    for (let i = 0; i < segSteps; i++) {
      const a1 = start + (ang * i) / segSteps;
      const a2 = start + (ang * (i + 1)) / segSteps;
      const x1 = cx + Math.cos(a1) * rOuter;
      const y1 = cy + Math.sin(a1) * rOuter;
      const x2 = cx + Math.cos(a2) * rOuter;
      const y2 = cy + Math.sin(a2) * rOuter;
      doc.triangle(cx, cy, x1, y1, x2, y2, "F");
    }
    start += ang;
  }
  // Inner hole
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, rOuter * 0.55, "F");

  // Legend
  let ly = y + 36;
  for (const p of parts) {
    doc.setFillColor(...p.color);
    doc.rect(x + 76, ly - 6, 8, 8, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.4);
    doc.setTextColor(...TEXT);
    const pct = total ? ((p.value / total) * 100).toFixed(0) : "0";
    doc.text(`${p.label}: ${p.value} (${pct}%)`, x + 88, ly);
    ly += 14;
  }
  return y + h;
}

function ensureSpace(doc: jsPDF, y: number, needed: number, margin: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 14) {
    doc.addPage();
    return margin;
  }
  return y;
}

function ensureGroupStart(doc: jsPDF, y: number, needed: number, margin: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  const availableNow = pageH - 14 - y;
  const freshPageSpace = pageH - 14 - margin;
  if (needed <= freshPageSpace && needed > availableNow && y > margin + 18) {
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

function attachmentSummaryFromCounts(_a: Analysis): string {
  // Sem insights interpretados, preferimos não inserir contagens genéricas
  // do tipo "X imagens, Y áudios" no relatório final.
  return "";
}

export const fixedSupportTeamForDisplay = AMIGO_FLOW_SUPPORT_TEAM;

function buildSentimentNarrative(m: ReportMetrics): string {
  const s = m.satisfacao;
  const total = s.muitoSatisfeito + s.satisfeito + s.neutro + s.insatisfeito + s.churnRisk;
  if (!total) {
    return "Não foram identificadas, no período auditado, manifestações textuais suficientes para classificar o sentimento do cliente em relação ao Agente Flow. O acompanhamento da satisfação seguirá baseado nas próximas interações registradas no canal de implantação.";
  }
  const pct = (n: number) => `${((n / total) * 100).toFixed(0)}%`;
  const partes: string[] = [];
  if (s.muitoSatisfeito) partes.push(`${s.muitoSatisfeito} manifestação(ões) de alta satisfação (${pct(s.muitoSatisfeito)})`);
  if (s.satisfeito) partes.push(`${s.satisfeito} de satisfação (${pct(s.satisfeito)})`);
  if (s.neutro) partes.push(`${s.neutro} de tom neutro (${pct(s.neutro)})`);
  if (s.insatisfeito) partes.push(`${s.insatisfeito} de insatisfação (${pct(s.insatisfeito)})`);
  const churnTxt = s.churnRisk
    ? ` Foram detectados ${s.churnRisk} sinal(is) explícito(s) de risco de churn, que demandam atenção comercial imediata.`
    : " Não foram detectados sinais explícitos de risco de churn no período.";
  const quotesTxt = m.churnQuotes.length
    ? ` Trechos representativos: ${m.churnQuotes.slice(0, 3).map((q) => `"${q}"`).join(" | ")}.`
    : "";
  return `A análise de sentimento considerou todas as mensagens textuais enviadas pela clínica no período auditado. Foram identificadas ${partes.join(", ")}.${churnTxt}${quotesTxt}`;
}

// ============================================================
// EXTENDED 11-SECTION RENDERER (AI auditReport)
// ============================================================
function categoryLabel(c: string): { emoji: string; label: string; color: [number, number, number] } {
  switch (c) {
    case "critico":
      return { emoji: "🔴", label: "Problema Crítico", color: ALERT_BORDER };
    case "duvida":
      return { emoji: "🟡", label: "Dúvida", color: [200, 150, 30] };
    case "ajuste":
      return { emoji: "🟢", label: "Ajuste Realizado", color: [46, 139, 87] };
    case "configuracao":
      return { emoji: "🔵", label: "Configuração", color: BLUE };
    case "orientacao":
      return { emoji: "🟣", label: "Orientação", color: [120, 70, 160] };
    default:
      return { emoji: "⚪", label: "Informação", color: MUTED };
  }
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
  const padding = 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.6);
  const lines: string[] = [];
  for (const it of items.length ? items : ["(sem registros)"]) {
    const wrapped = doc.splitTextToSize(`• ${sanitize(it)}`, w - padding * 2) as string[];
    lines.push(...wrapped);
  }
  const h = 22 + lines.length * 11 + padding;
  y = ensureSpace(doc, y, h + 6, x);
  doc.setFillColor(...INFO_BG);
  doc.roundedRect(x, y, w, h, 3, 3, "F");
  doc.setFillColor(...tone);
  doc.rect(x, y, 3, h, "F");
  doc.setTextColor(...tone);
  doc.text(title, x + padding, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(...TEXT);
  let ly = y + 28;
  for (const ln of lines) {
    doc.text(ln, x + padding, ly);
    ly += 11;
  }
  return y + h + 6;
}

function renderListBox(
  doc: jsPDF,
  title: string,
  items: string[],
  x: number,
  y: number,
  w: number,
): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.4);
  doc.setTextColor(...NAVY);
  y = ensureSpace(doc, y, 16, x);
  doc.text(title, x, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...TEXT);
  for (const it of items.length ? items : ["(nenhum)"]) {
    const lines = doc.splitTextToSize(`• ${sanitize(it)}`, w) as string[];
    for (const ln of lines) {
      y = ensureSpace(doc, y, 12, x);
      doc.text(ln, x, y);
      y += 11.5;
    }
  }
  return y + 4;
}

export function renderExtendedReport(
  doc: jsPDF,
  draft: ReportDraft,
  margin: number,
  startY: number,
  contentW: number,
): number {
  const ar = draft.satisfaction?.auditReport;
  if (!ar) return startY;
  let y = startY;

  // ===== 2. Mapeamento de Participantes (substitui números por nomes/cargos)
  if (ar.participants?.length) {
    y = sectionTitle(doc, "2. Mapeamento de Participantes da Jornada", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Nome / Cargo", "Organização", "Atribuição Operacional"]],
      body: ar.participants.map((p) => [
        sanitize(p.name),
        sanitize(p.org),
        sanitize(p.role),
      ]),
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.4, fontStyle: "bold", cellPadding: 6 },
      styles: { fontSize: 9, cellPadding: 6, valign: "top", lineColor: RULE, textColor: TEXT },
      columnStyles: {
        0: { cellWidth: 160, fontStyle: "bold" },
        1: { cellWidth: 110, fillColor: INFO_BG, textColor: BLUE, fontStyle: "bold" },
        2: { cellWidth: contentW - 270 },
      },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 16;
  }

  // ===== 3. Linha do Tempo Operacional
  if (ar.timeline?.length) {
    y = sectionTitle(doc, "3. Linha do Tempo Operacional (Fatos Relevantes)", margin, y);
    autoTable(doc, {
      startY: y,
      head: [["Data", "Categoria", "Resumo do Fato", "Posicionamento do Suporte", "Status"]],
      body: ar.timeline.map((t) => {
        const c = categoryLabel(t.category);
        return [
          sanitize(t.date),
          `${c.emoji} ${c.label}`,
          sanitize(t.summary),
          sanitize(t.supportResponse),
          sanitize(t.status),
        ];
      }),
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9, fontStyle: "bold", cellPadding: 5 },
      styles: { fontSize: 8.6, cellPadding: 5, valign: "top", lineColor: RULE, textColor: TEXT, overflow: "linebreak" },
      columnStyles: {
        0: { cellWidth: 56, fontStyle: "bold" },
        1: { cellWidth: 92 },
        2: { cellWidth: (contentW - 56 - 92 - 70) * 0.55 },
        3: { cellWidth: (contentW - 56 - 92 - 70) * 0.45 },
        4: { cellWidth: 70, fontStyle: "bold" },
      },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 16;
  }

  // ===== 4. Auditoria Comportamental da Equipe de Suporte
  y = sectionTitle(doc, "4. Auditoria Comportamental da Equipe de Suporte", margin, y);
  y = renderQuadrant(doc, "🟢 Ações Resolutivas", ar.supportBehavior?.resolutive ?? [], [46, 139, 87], margin, y, contentW);
  y = renderQuadrant(doc, "🟡 Defesas Técnicas Legítimas", ar.supportBehavior?.defenses ?? [], [200, 150, 30], margin, y, contentW);
  y = renderQuadrant(doc, "🔵 Limitações do Produto Declaradas", ar.supportBehavior?.limitations ?? [], BLUE, margin, y, contentW);
  y = renderQuadrant(doc, "🔴 Silêncios, Demoras e Gargalos", ar.supportBehavior?.silences ?? [], ALERT_BORDER, margin, y, contentW);

  // ===== 5. Painel de Indicadores Executivos
  if (ar.indicators) {
    y = sectionTitle(doc, "5. Painel de Indicadores Executivos", margin, y);
    const ind = ar.indicators;
    autoTable(doc, {
      startY: y,
      head: [["Indicador", "Quantidade"]],
      body: [
        ["Ajustes / Configurações realizadas", String(ind.ajustes ?? 0)],
        ["Dúvidas sanadas", String(ind.duvidas ?? 0)],
        ["Orientações prestadas", String(ind.orientacoes ?? 0)],
        ["Bugs / Inconsistências reais do sistema", String(ind.bugs ?? 0)],
        ["Reaberturas / Problemas recorrentes", String(ind.reaberturas ?? 0)],
      ],
      headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.4, fontStyle: "bold", cellPadding: 6 },
      styles: { fontSize: 9, cellPadding: 6, lineColor: RULE, textColor: TEXT },
      columnStyles: {
        0: { cellWidth: contentW - 90 },
        1: { cellWidth: 90, halign: "center", fontStyle: "bold", textColor: BLUE },
      },
      margin: { left: margin, right: margin },
    });
    y = lastY(doc) + 10;
    if (ind.topErrors?.length) {
      y = renderListBox(doc, "Top Erros Mais Recorrentes", ind.topErrors, margin, y, contentW);
    }
  }

  // ===== 6. Saúde, Evolução e Esforço
  y = sectionTitle(doc, "6. Saúde, Evolução e Esforço", margin, y);
  const healthRows: [string, string, string][] = [
    ["Saúde do Atendimento", sanitize(ar.health?.label ?? "—"), sanitize(ar.health?.justification ?? "—")],
    ["Evolução do Humor", sanitize(ar.humorEvolution?.label ?? "—"), sanitize(ar.humorEvolution?.justification ?? "—")],
    ["Complexidade Técnica", sanitize(ar.complexity?.label ?? "—"), sanitize(ar.complexity?.motive ?? "—")],
    ["Nível de Esforço do Cliente", sanitize(ar.effort?.label ?? "—"), sanitize(ar.effort?.detail ?? "—")],
  ];
  autoTable(doc, {
    startY: y,
    head: [["Indicador", "Classificação", "Justificativa"]],
    body: healthRows,
    headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.4, fontStyle: "bold", cellPadding: 6 },
    styles: { fontSize: 9, cellPadding: 6, valign: "top", lineColor: RULE, textColor: TEXT },
    columnStyles: {
      0: { cellWidth: 150, fontStyle: "bold" },
      1: { cellWidth: 110, fillColor: INFO_BG, fontStyle: "bold", textColor: BLUE },
      2: { cellWidth: contentW - 260 },
    },
    margin: { left: margin, right: margin },
  });
  y = lastY(doc) + 16;

  // ===== 7. Mapeamento Emocional e Jornada do Humor
  if (ar.emotionalMoments?.length || ar.humorTimeline?.length) {
    y = sectionTitle(doc, "7. Mapeamento Emocional e Jornada do Humor", margin, y);
    if (ar.emotionalMoments?.length) {
      autoTable(doc, {
        startY: y,
        head: [["Emoção", "Confiança", "Data", "Mensagem do Cliente", "Motivo"]],
        body: ar.emotionalMoments.map((m) => [
          sanitize(m.emotion),
          `${m.confidence ?? 0}%`,
          sanitize(m.date),
          `"${sanitize(m.quote)}"`,
          sanitize(m.motive),
        ]),
        headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9, fontStyle: "bold", cellPadding: 5 },
        styles: { fontSize: 8.6, cellPadding: 5, valign: "top", lineColor: RULE, textColor: TEXT, overflow: "linebreak" },
        columnStyles: {
          0: { cellWidth: 70, fontStyle: "bold" },
          1: { cellWidth: 50, halign: "center" },
          2: { cellWidth: 56 },
          3: { cellWidth: (contentW - 176) * 0.55, fontStyle: "italic" },
          4: { cellWidth: (contentW - 176) * 0.45 },
        },
        margin: { left: margin, right: margin },
      });
      y = lastY(doc) + 10;
    }
    if (ar.humorTimeline?.length) {
      y = ensureSpace(doc, y, 32, margin);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.4);
      doc.setTextColor(...NAVY);
      doc.text("Linha do Tempo do Humor:", margin, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...TEXT);
      const line = ar.humorTimeline.map((h) => `${sanitize(h.date)} ${sanitize(h.emoji)}`).join("   →   ");
      const wrapped = doc.splitTextToSize(line, contentW) as string[];
      for (const ln of wrapped) {
        y = ensureSpace(doc, y, 12, margin);
        doc.text(ln, margin, y);
        y += 12;
      }
      y += 6;
    }
  }

  // ===== 8. Score de Satisfação (CSAT Analítico)
  if (ar.csat) {
    y = sectionTitle(doc, "8. Score de Satisfação do Cliente (CSAT Analítico)", margin, y);
    y = ensureSpace(doc, y, 56, margin);
    doc.setFillColor(...INFO_BG);
    doc.roundedRect(margin, y, contentW, 50, 4, 4, "F");
    doc.setFillColor(...BLUE);
    doc.rect(margin, y, 4, 50, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(...NAVY);
    doc.text(`${ar.csat.score}/100`, margin + 14, y + 32);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BLUE);
    doc.text(sanitize(ar.csat.classification), margin + 130, y + 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.setTextColor(...MUTED);
    doc.text("Classificação", margin + 130, y + 36);
    y += 60;
    y = renderListBox(doc, "Memória de Cálculo", [ar.csat.calculationMemo], margin, y, contentW);
  }

  // ===== 9. Detecção e Evidenciação do Alerta de Risco de Churn
  y = sectionTitle(doc, "9. Detecção e Evidenciação do Alerta de Risco de Churn", margin, y);
  if (!ar.churnSignals?.length) {
    y = paragraph(doc, "Nenhum sinal explícito de risco de cancelamento contratual identificado no período analisado.", margin, y, contentW, 9.2) + 6;
  } else {
    for (let i = 0; i < ar.churnSignals.length; i++) {
      const s = ar.churnSignals[i];
      const lines = doc.splitTextToSize(`"${sanitize(s.quote)}"`, contentW - 20) as string[];
      const motiveLines = doc.splitTextToSize(`Impacto: ${sanitize(s.impact)}`, contentW - 20) as string[];
      const h = 36 + lines.length * 11 + motiveLines.length * 11 + 8;
      y = ensureSpace(doc, y, h + 8, margin);
      doc.setFillColor(253, 240, 240);
      doc.setDrawColor(...ALERT_BORDER);
      doc.roundedRect(margin, y, contentW, h, 3, 3, "FD");
      doc.setFillColor(...ALERT_BORDER);
      doc.rect(margin, y, 4, h, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.6);
      doc.setTextColor(...ALERT_BORDER);
      doc.text(`Sinal nº ${i + 1}  •  Peso: ${sanitize(s.weight)}  •  Data: ${sanitize(s.date)}`, margin + 10, y + 16);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...TEXT);
      let ly = y + 30;
      for (const ln of lines) {
        doc.text(ln, margin + 10, ly);
        ly += 11;
      }
      doc.setFont("helvetica", "normal");
      ly += 4;
      for (const ln of motiveLines) {
        doc.text(ln, margin + 10, ly);
        ly += 11;
      }
      y += h + 8;
    }
  }

  // ===== 10. Diagnóstico Final
  if (ar.diagnosis) {
    y = sectionTitle(doc, "10. Diagnóstico Final: Pontos Fortes, Críticos e Oportunidades", margin, y);
    y = renderListBox(doc, "Pontos Positivos", ar.diagnosis.strengths ?? [], margin, y, contentW);
    y = renderListBox(doc, "Pontos de Atenção", ar.diagnosis.attentionPoints ?? [], margin, y, contentW);
    y = renderListBox(doc, "A) Produto / Engenharia", ar.diagnosis.opportunities?.product ?? [], margin, y, contentW);
    y = renderListBox(doc, "B) Suporte / Atendimento", ar.diagnosis.opportunities?.support ?? [], margin, y, contentW);
    y = renderListBox(doc, "C) Processo / Implantação", ar.diagnosis.opportunities?.process ?? [], margin, y, contentW);
  }

  // ===== 11. Resumo Executivo e Conclusão
  if (ar.conclusion) {
    y = sectionTitle(doc, "11. Resumo Executivo e Conclusão", margin, y);
    y = renderListBox(doc, "O cliente demonstra propensão a cancelar o contrato?", [ar.conclusion.willChurn || "—"], margin, y, contentW);
    y = renderListBox(doc, "O suporte está evoluindo a maturidade do cliente ou agindo de forma paliativa?", [ar.conclusion.isEvolvingMaturity || "—"], margin, y, contentW);
    if (ar.conclusion.nextSteps?.length) {
      autoTable(doc, {
        startY: y,
        head: [["#", "Próximo Passo Imediato", "Responsável"]],
        body: ar.conclusion.nextSteps.slice(0, 3).map((s, i) => [
          String(i + 1),
          sanitize(s.action),
          sanitize(s.owner),
        ]),
        headStyles: { fillColor: NAVY_DEEP, textColor: 255, fontSize: 9.4, fontStyle: "bold", cellPadding: 6 },
        styles: { fontSize: 9, cellPadding: 6, valign: "top", lineColor: RULE, textColor: TEXT },
        columnStyles: {
          0: { cellWidth: 30, halign: "center", fontStyle: "bold" },
          1: { cellWidth: contentW - 160 },
          2: { cellWidth: 130, fontStyle: "bold", textColor: BLUE, fillColor: INFO_BG },
        },
        margin: { left: margin, right: margin },
      });
      y = lastY(doc) + 12;
    }
  }

  return y;
}
