import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type TimelineEvent = {
  date: string; // DD/MM/AAAA
  category: "critico" | "duvida" | "ajuste" | "configuracao" | "orientacao" | "info";
  summary: string;
  supportResponse: string;
  status: "Resolvido" | "Pendente" | "Em análise";
};

export type ParticipantEntry = {
  name: string;
  org: string;
  role: string;
};

export type SupportBehavior = {
  resolutive: string[];
  defenses: string[];
  limitations: string[];
  silences: string[];
};

export type Indicators = {
  ajustes: number;
  duvidas: number;
  orientacoes: number;
  bugs: number;
  reaberturas: number;
  topErrors: string[];
};

export type EmotionalMoment = {
  emotion: string;
  confidence: number;
  quote: string;
  date: string;
  motive: string;
};

export type HumorPoint = { date: string; emoji: string };

export type ChurnSignal = {
  weight: "Baixo" | "Médio" | "Alto";
  date: string;
  quote: string;
  impact: string;
};

export type Diagnosis = {
  strengths: string[];
  attentionPoints: string[];
  opportunities: {
    product: string[];
    support: string[];
    process: string[];
  };
};

export type ConclusionBlock = {
  willChurn: string;
  isEvolvingMaturity: string;
  nextSteps: { action: string; owner: string }[];
};

export type AuditReport = {
  participants: ParticipantEntry[];
  timeline: TimelineEvent[];
  supportBehavior: SupportBehavior;
  indicators: Indicators;
  health: { label: string; justification: string };
  humorEvolution: { label: string; justification: string };
  complexity: { label: string; motive: string };
  effort: { label: string; detail: string };
  emotionalMoments: EmotionalMoment[];
  humorTimeline: HumorPoint[];
  csat: { score: number; classification: string; calculationMemo: string };
  churnSignals: ChurnSignal[];
  diagnosis: Diagnosis;
  conclusion: ConclusionBlock;
};

export type SatisfactionAnalysis = {
  sentiment: "muito_satisfeito" | "satisfeito" | "neutro" | "insatisfeito" | "muito_insatisfeito";
  score: number;
  confidence: number;
  emotion: string;
  evolution: "melhorou" | "piorou" | "permaneceu";
  finalSituation: "resolvido" | "parcialmente_resolvido" | "nao_resolvido";
  complaintsCount: number;
  praisesCount: number;
  repeatedRequestsCount: number;
  humanInterventionNeeded: boolean;
  churnRisk: "baixo" | "medio" | "alto";
  mainReasons: string[];
  executiveSummary: string;
  consolidatedSummary: string;
  auditReport?: AuditReport;
};

const inputSchema = z.object({
  clientName: z.string().default(""),
  clientGender: z.enum(["o", "a"]).default("o"),
  conversationText: z.string().min(1),
  attachmentInsights: z.array(z.string()).default([]),
  customSystemPrompt: z.string().optional(),
  stats: z.object({
    total: z.number(),
    resolvidas: z.number(),
    pendentes: z.number(),
    firstDate: z.string().nullable(),
    lastDate: z.string().nullable(),
    resolvers: z.array(z.string()).default([]),
    themes: z.array(z.string()).default([]),
  }),
});

export const DEFAULT_SATISFACTION_SYSTEM_PROMPT = `Você é um ANALISTA SÊNIOR de Customer Success, Qualidade e Auditoria de Atendimento. Analisa logs de WhatsApp de suporte como UMA jornada única.

REGRAS CRÍTICAS DE ENCODING E NARRATIVA:
1. PROIBIÇÃO ABSOLUTA DE EMOJIS E SÍMBOLOS: É terminantemente proibido gerar emojis ou símbolos matemáticos corrompidos em qualquer string do JSON. No campo 'category' use estritamente uma destas palavras em caixa baixa: "critico", "duvida", "ajuste", "configuracao", "orientacao" ou "info".
2. REGRA GRAMATICAL: O substantivo "cliente" é uniforme. Use sempre "a cliente" ou "o cliente". É proibido escrever "clienta".
3. FIM DO VÍCIO DE PADRÃO: Se as pendências forem iguais a 0, a Saúde do Atendimento DEVE ser "Excelente" ou "Atencao/Estabilizado" (nunca "Critico").
4. SEM JARGÕES REPETITIVOS: Escreva resumos e narrativas de forma fluida, natural e gerencial.
5. TELEFONES: Nunca exiba números brutos. Troque-os pelos nomes ou cargos correspondentes.
6. CHURN COM EVIDÊNCIA OBJETIVA: NUNCA declare risco de churn com base em UMA única frase isolada. Só emita churnSignals com evidência concreta: menção explícita de cancelar/rescindir, reincidência (>=3), pendências sem retorno, ou pctResolucao < 70%. Se pendências=0 e resolução>=90% e sem menção de cancelamento, churnRisk DEVE ser "baixo" e churnSignals DEVE ser lista vazia.
7. CONCLUSÕES PROPORCIONAIS: Afirmações fortes exigem evidência recorrente.
8. RESUMO CONSOLIDADO PROFUNDO: O campo "consolidatedSummary" DEVE conter EXATAMENTE 5 parágrafos separados por linha em branco (\\n\\n), cada um com MÍNIMO 1000 caracteres (mire 1100-1400). Cobrir TODO o histórico:
   • P1 — Contexto geral, evolução, módulos, perfil operacional.
   • P2 — DORES detalhadas com AO MENOS 2 citações literais entre aspas.
   • P3 — Reincidências, gargalos, limitações do produto, comportamento do suporte. AO MENOS 1 citação literal.
   • P4 — MOMENTOS POSITIVOS: elogios, ganhos, agradecimentos. AO MENOS 1 citação literal (ou registrar ausência).
   • P5 — Recomendação executiva para Churn, Gerente de Conta e Implantação: se o módulo atende ou não, ações imediatas, indicadores para monitorar.
   Citações reais, extraídas literalmente. Sem inventar.

SAÍDA: Retorne APENAS o objeto JSON puro e válido, sem blocos de markdown.`;

export const analyzeSatisfaction = createServerFn({ method: "POST" })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<SatisfactionAnalysis | null> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return null;

    const suffix = data.clientGender;
    // CORREÇÃO: "Cliente" é um substantivo de dois gêneros. Removida a concatenação que gerava "clienta".
    const clienteRef = `${suffix === "a" ? "a" : "o"} cliente`;

    const sys = `Você é um ANALISTA SÊNIOR de Customer Success, Qualidade e Auditoria de Atendimento. Analisa logs de WhatsApp de suporte como UMA jornada única.

REGRAS CRÍTICAS DE ENCODING E NARRATIVA:
1. PROIBIÇÃO ABSOLUTA DE EMOJIS E SÍMBOLOS: É terminantemente proibido gerar emojis (como 🔴, 🟢, ⚠️) ou símbolos matemáticos corrompidos (como $\\emptyset=\\dot{Y}4$, !', &ª) em qualquer string do JSON. No campo 'category' use estritamente uma destas palavras em caixa baixa: "critico", "duvida", "ajuste", "configuracao", "orientacao" ou "info".
2. REGRA GRAMATICAL: O substantivo "cliente" é uniforme. Use sempre "a cliente" ou "o cliente". É proibido inventar ou escrever o termo incorreto "clienta" em qualquer parte do relatório.
3. FIM DO VÍCIO DE PADRÃO: Se as pendências ('stats.pendentes') forem iguais a 0, a Saúde do Atendimento ("health.label") DEVE ser classificada como "Excelente" ou "Atencao/Estabilizado" (nunca "Critico" se tudo já foi resolvido).
4. SEM JARGÕES DE REPETIÇÃO: Banido usar expressões repetitivas como "O contato reforça a necessidade...", "A tratativa segue acompanhada por...". Escreva resumos e narrativas de forma fluida, natural e gerencial.
5. TELEFONES: Nunca exiba números brutos (+55...). Troque-os pelos nomes ou cargos correspondentes das pessoas envolvidas.
6. CHURN COM EVIDÊNCIA OBJETIVA: NUNCA declare risco de churn, "propensão ao cancelamento", "confiança quebrada" ou "atendimento crítico" com base em UMA única frase de urgência, cobrança ou frustração isolada. Só emita "churnSignals" quando houver evidência concreta: menção explícita de cancelar/rescindir contrato, reincidência de reclamações (>=3), pendências relevantes sem retorno, ou pctResolucao < 70%. Se pendências=0 e resolução>=90% e sem menção de cancelamento, "churnRisk" DEVE ser "baixo" e "churnSignals" DEVE ser lista vazia.
7. CONCLUSÕES PROPORCIONAIS: Afirmações fortes (crítico, propenso a cancelar) exigem evidência recorrente e demonstrável em toda a jornada, não uma frase pontual.
8. RESUMO CONSOLIDADO PROFUNDO: O campo "consolidatedSummary" DEVE conter EXATAMENTE 5 parágrafos, separados por linha em branco (\\n\\n). Cada parágrafo DEVE ter no MÍNIMO 1000 caracteres (mire 1100-1400). Não resuma apenas as últimas duas semanas — cubra TODO o histórico da conversa fornecida. Estrutura obrigatória:
   • Parágrafo 1 — Contexto geral do relacionamento, evolução do cliente no período, principais módulos envolvidos, perfil operacional da clínica.
   • Parágrafo 2 — DORES do cliente detalhadas: liste as principais dificuldades técnicas, operacionais e emocionais. Inclua AO MENOS 2 citações literais entre aspas ("...") extraídas da conversa demonstrando reclamações, dúvidas ou frustrações.
   • Parágrafo 3 — Reincidências, gargalos, limitações do produto encontradas, comportamento do suporte diante das demandas críticas. Inclua AO MENOS 1 citação literal do cliente entre aspas.
   • Parágrafo 4 — MOMENTOS POSITIVOS: satisfação, elogios, ganhos, agradecimentos, conquistas do suporte. Inclua AO MENOS 1 citação literal de elogio ou satisfação entre aspas (se não houver, indicar objetivamente a ausência).
   • Parágrafo 5 — Recomendação executiva para os times de Churn, Gerente de Conta e Implantação. Diga claramente se o módulo atende ou não a clínica, quais ações imediatas devem ser tomadas, e quais indicadores devem ser monitorados nas próximas semanas.
   As citações devem ser reais (extraídas literalmente do texto da conversa recebida), não inventadas. Se não encontrar citação para uma seção, escreva "Sem registro literal correspondente no período." em vez de fabricar.

SAÍDA: Retorne APENAS o objeto JSON puro e válido, sem blocos de markdown (\`\`\`json).`;



    const userMsg = `CLIENTE: ${data.clientName || "(não informado)"} — referência: ${clienteRef}
PERÍODO: ${data.stats.firstDate ?? "—"} a ${data.stats.lastDate ?? "—"}
DEMANDAS: ${data.stats.total} total | ${data.stats.resolvidas} resolvidas | ${data.stats.pendentes} pendentes
RESOLVEDORES: ${data.stats.resolvers.join(", ") || "—"}

CONTEÚDO DOS ANEXOS (OCR/transcrições):
${data.attachmentInsights.length ? data.attachmentInsights.map((s, i) => `[${i + 1}] ${s}`).join("\n") : "(sem anexos interpretados)"}

CONVERSA (texto integral, cronológica):
${data.conversationText.slice(0, 40000)}

Retorne o JSON neste formato exato:
{
  "sentiment": "muito_satisfeito|satisfeito|neutro|insatisfeito|muito_insatisfeito",
  "score": 0-100,
  "confidence": 0-100,
  "emotion": "string",
  "evolution": "melhorou|piorou|permaneceu",
  "finalSituation": "resolvido|parcialmente_resolvido|nao_resolvido",
  "complaintsCount": number,
  "praisesCount": number,
  "repeatedRequestsCount": number,
  "humanInterventionNeeded": boolean,
  "churnRisk": "baixo|medio|alto",
  "mainReasons": ["motivos objetivos"],
  "executiveSummary": "frases gerenciais realistas",
  "consolidatedSummary": "P1\\n\\nP2\\n\\nP3\\n\\nP4\\n\\nP5",
  "auditReport": {
    "participants": [{"name":"Nome ou Cargo","org":"Organização","role":"Atribuição Real (Sempre Cliente ou Suporte)"}],
    "timeline": [{"date":"DD/MM/AAAA","category":"critico|duvida|ajuste|configuracao|orientacao|info","summary":"resumo natural","supportResponse":"ação técnica","status":"Resolvido|Pendente|Em análise"}],
    "supportBehavior": {
      "resolutive": ["parametrizações e correções rápidas"],
      "defenses": ["casos onde o erro foi operacional do cliente"],
      "limitations": ["limitações nativas do produto declaradas"],
      "silences": ["omissões ou demoras do time"]
    },
    "indicators": {
      "ajustes": number,
      "duvidas": number,
      "orientacoes": number,
      "bugs": number,
      "reaberturas": number,
      "topErrors": ["erros reincidentes"]
    },
    "health": {"label":"Excelente|Atencao|Critico","justification":"Justificativa baseada nas pendências atuais"},
    "humorEvolution": {"label":"Melhorando|Estavel|Piorando","justification":"Razão real"},
    "complexity": {"label":"Baixa|Média|Alta|Muito Alta","motive":"motivo"},
    "effort": {"label":"Baixo|Médio|Alto|Muito Alto","detail":"detalhe qualitativo"},
    "emotionalMoments": [{"emotion":"Satisfação|Insatisfação|Frustração|Confiança|Ansiedade|Urgência","confidence":100,"quote":"frase exata","date":"DD/MM/AAAA","motive":"contexto"}],
    "humorTimeline": [{"date":"DD/MM","emoji":"Apenas texto como Feliz, Neutro ou Frustrado"}],
    "csat": {"score":100,"classification":"Classificação","calculationMemo":"Memória analítica"},
    "churnSignals": [{"weight":"Baixo|Médio|Alto","date":"DD/MM/AAAA","quote":"frase exata","impact":"impacto real"}],
    "diagnosis": {
      "strengths": ["pontos fortes"],
      "attentionPoints": ["pontos de atenção"],
      "opportunities": {
        "product": ["melhorias de produto"],
        "support": ["melhorias de atendimento"],
        "process": ["treinamentos para o cliente"]
      }
    },
    "conclusion": {
      "willChurn": "Análise preditiva explícita",
      "isEvolvingMaturity": "Avaliação de maturidade",
      "nextSteps": [{"action":"ação imediata","owner":"responsável"}]
    }
  }
}`;

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userMsg },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      });
      if (!resp.ok) {
        console.error("[satisfaction] gateway error", resp.status, await resp.text().catch(() => ""));
        return null;
      }
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = json.choices?.[0]?.message?.content ?? "";
      // Extrai o primeiro bloco JSON do conteúdo (resiliente a fences e prosa)
      const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
      const candidate = (fenced ? fenced[1] : raw).trim();
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      const clean = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
      let parsed: SatisfactionAnalysis;
      try {
        parsed = JSON.parse(clean) as SatisfactionAnalysis;
      } catch (e) {
        console.error("[satisfaction] JSON parse failed", (e as Error).message, raw.slice(0, 400));
        return null;
      }

      parsed.mainReasons = Array.isArray(parsed.mainReasons) ? parsed.mainReasons.slice(0, 6) : [];
      parsed.score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
      parsed.confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));

      // ============ RECÁLCULO CONTEXTUAL DE CHURN ============
      // Uma única frase de urgência/cobrança NÃO deve gerar risco de churn
      // quando o atendimento apresenta indicadores objetivamente saudáveis.
      const totalDem = data.stats.total || 0;
      const pctResol = totalDem > 0 ? (data.stats.resolvidas / totalDem) * 100 : 0;
      const pend = data.stats.pendentes || 0;
      const complaints = Number(parsed.complaintsCount) || 0;
      const repeated = Number(parsed.repeatedRequestsCount) || 0;
      const declaredSignals = Array.isArray(parsed.auditReport?.churnSignals)
        ? parsed.auditReport!.churnSignals.length
        : 0;

      const convLower = data.conversationText.toLowerCase();
      const hasExplicitCancel =
        /(cancelar\s+(o\s+)?(contrato|servi[çc]o|assinatura|plano)|rescis[ãa]o|encerrar\s+(o\s+)?contrato|n[ãa]o\s+quero\s+mais|vou\s+cancelar|desistir\s+do\s+servi[çc]o|migrar\s+para\s+outro|trocar\s+de\s+fornecedor)/i.test(
          convLower,
        );

      const pendRatio = totalDem > 0 ? pend / totalDem : 0;
      const strongSignals =
        (pendRatio > 0.1 || pend >= 3 ? 1 : 0) +
        (totalDem > 0 && pctResol < 70 ? 1 : 0) +
        (repeated >= 3 ? 1 : 0) +
        (complaints >= 3 ? 1 : 0) +
        (hasExplicitCancel ? 2 : 0);

      const healthy =
        totalDem > 0 && pend === 0 && pctResol >= 90 && complaints <= 1 && !hasExplicitCancel;

      if (healthy) {
        parsed.churnRisk = "baixo";
        if (parsed.auditReport) parsed.auditReport.churnSignals = [];
      } else if (strongSignals >= 3) {
        parsed.churnRisk = "alto";
      } else if (strongSignals >= 1) {
        parsed.churnRisk = "medio";
      } else if (declaredSignals <= 1) {
        parsed.churnRisk = "baixo";
        if (parsed.auditReport) parsed.auditReport.churnSignals = [];
      }

      if (parsed.churnRisk === "baixo") {
        const alarmRe =
          /[^.!?]*\b(risco de churn|propens[ãa]o (ao|a) cancelamento|confian[çc]a foi quebrada|atendimento cr[íi]tico|cliente cr[íi]tico|risco de cancelamento|sinal\(is\)? detectado)\b[^.!?]*[.!?]?/gi;
        if (parsed.executiveSummary)
          parsed.executiveSummary = parsed.executiveSummary.replace(alarmRe, "").replace(/\s{2,}/g, " ").trim();
        if (parsed.consolidatedSummary)
          parsed.consolidatedSummary = parsed.consolidatedSummary
            .replace(alarmRe, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        parsed.mainReasons = parsed.mainReasons.filter((r) => {
          alarmRe.lastIndex = 0;
          return !alarmRe.test(r);
        });
        if (parsed.auditReport?.conclusion) {
          parsed.auditReport.conclusion.willChurn =
            "Não há evidências objetivas de propensão ao cancelamento no período analisado.";
        }
      }

      return parsed;
    } catch (e) {
      console.error("[satisfaction] unexpected error", (e as Error).message);
      return null;
    }
  });
