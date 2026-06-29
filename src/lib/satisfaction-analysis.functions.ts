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

export const analyzeSatisfaction = createServerFn({ method: "POST" })
  .inputValidator(inputSchema)
  .handler(async ({ data }): Promise<SatisfactionAnalysis | null> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return null;

    const suffix = data.clientGender;
    const clienteRef = `${suffix === "a" ? "a" : "o"} client${suffix}`;

    const sys = `Você é um ANALISTA SÊNIOR de Customer Success, Qualidade e Auditoria de Atendimento. Analisa logs de WhatsApp de suporte como UMA jornada única.

REGRAS CRÍTICAS DE ENCODING E NARRATIVA:
1. PROIBIÇÃO DE CARACTERES CORROMPIDOS: É terminantemente proibido gerar símbolos matemáticos ou codificações corrompidas (como $\\emptyset=\\dot{Y}4$, !', &ª) no JSON. No campo 'category' use estritamente uma destas strings: "critico", "duvida", "ajuste", "configuracao", "orientacao" ou "info".
2. FIM DO VÍCIO DE PADRÃO: Avalie a saúde com base em fatos atuais. Se as pendências ('stats.pendentes') forem iguais a 0, a Saúde do Atendimento ("health.label") DEVE ser classificada como "🟢 Excelente" ou "🟡 Atenção/Estabilizado" (nunca "Crítico" se tudo já foi resolvido). O Risco de Churn deve cair proporcionalmente se as soluções foram definitivas.
3. SEM JARGÕES DE REPETIÇÃO: Banido usar expressões repetitivas como "O contato reforça a necessidade...", "A tratativa segue acompanhada por...", "vale ressaltar" ou "de forma cronológica". Escreva resumos e narrativas de forma fluida, natural, humana e executiva.
4. TELEFONES: Nunca exiba números brutos (+55...). Troque-os pelos nomes ou cargos correspondentes das pessoas envolvidas.
5. CITAÇÕES GATILHO: Toda análise de sentimento ou risco de churn deve ser ancorada na frase exata (ipsis litteris) enviada pelo cliente e na respectiva data.
6. Referências ao cliente devem usar o gênero correto de acordo com: "${clienteRef}".

SAÍDA: Retorne APENAS o objeto JSON puro e perfeitamente válido, sem blocos de markdown (\`\`\`json).`;

    const userMsg = `CLIENTE: ${data.clientName || "(não informado)"} — referência: ${clienteRef}
PERÍODO: ${data.stats.firstDate ?? "—"} a ${data.stats.lastDate ?? "—"}
DEMANDAS: ${data.stats.total} total | ${data.stats.resolvidas} resolvidas | ${data.stats.pendentes} pendentes
RESOLVEDORES: ${data.stats.resolvers.join(", ") || "—"}

CONTEÚDO DOS ANEXOS (OCR/transcrições):
${data.attachmentInsights.length ? data.attachmentInsights.map((s, i) => `[${i + 1}] ${s}`).join("\n") : "(sem anexos interpretados)"}

CONVERSA (texto integral, cronológica):
${data.conversationText.slice(0, 40000)}

Retorne o JSON seguindo fielmente este formato:
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
  "mainReasons": ["motivos curtos e objetivos"],
  "executiveSummary": "frases gerenciais e realistas",
  "consolidatedSummary": "P1\\n\\nP2\\n\\nP3",
  "auditReport": {
    "participants": [{"name":"Nome/Cargo Limpo","org":"Organização","role":"Atribuição Real"}],
    "timeline": [{"date":"DD/MM/AAAA","category":"critico|duvida|ajuste|configuracao|orientacao|info","summary":"resumo natural","supportResponse":"ação técnica real","status":"Resolvido|Pendente|Em análise"}],
    "supportBehavior": {
      "resolutive": ["parametrizações e correções rápidas documentadas"],
      "defenses": ["casos onde o suporte provou que o erro foi operacional da clínica"],
      "limitations": ["limitações nativas do produto alinhadas de forma clara"],
      "silences": ["omissões, demoras ou cobranças do cliente deixadas no vácuo"]
    },
    "indicators": {
      "ajustes": number,
      "duvidas": number,
      "orientacoes": number,
      "bugs": number,
      "reaberturas": number,
      "topErrors": ["erros reincidentes"]
    },
    "health": {"label":"🟢 Excelente|🟡 Atenção|🔴 Crítico","justification":"Justificativa baseada nas pendências atuais"},
    "humorEvolution": {"label":"⬆ Melhorando|➡ Estável|⬇ Piorando","justification":"Razão real"},
    "complexity": {"label":"Baixa|Média|Alta|Muito Alta","motive":"motivo"},
    "effort": {"label":"Baixo|Médio|Alto|Muito Alto","detail":"detalhe qualitativo dos retrabalhos"},
    "emotionalMoments": [{"emotion":"Satisfação|Insatisfação|Frustração|Confiança|Ansiedade|Urgência","confidence":100,"quote":"frase exata","date":"DD/MM/AAAA","motive":"contexto"}],
    "humorTimeline": [{"date":"DD/MM","emoji":"😊|😐|😠"}],
    "csat": {"score":100,"classification":"Classificação","calculationMemo":"Memória analítica fundamentada"},
    "churnSignals": [{"weight":"Baixo|Médio|Alto","date":"DD/MM/AAAA","quote":"frase exata do cliente","impact":"impacto contratual real"}],
    "diagnosis": {
      "strengths": ["pontos fortes do suporte"],
      "attentionPoints": ["pontos de atrito sistêmico"],
      "opportunities": {
        "product": ["melhorias de software nativas"],
        "support": ["melhorias de proatividade do time"],
        "process": ["treinamentos sugeridos para o cliente"]
      }
    },
    "conclusion": {
      "willChurn": "Análise preditiva explícita",
      "isEvolvingMaturity": "Avaliação de maturidade real",
      "nextSteps": [{"action":"ação imediata","owner":"responsável"}]
    }
  }
}`;

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash", // Mudança estratégica do modelo Pro para o Flash (Velocidade e resposta instantânea)
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userMsg },
          ],
          temperature: 0.1,
        }),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = json.choices?.[0]?.message?.content ?? "";
      const clean = raw.replace(/^```json\s*|\s*```$/g, "").trim();
      const parsed = JSON.parse(clean) as SatisfactionAnalysis;

      parsed.mainReasons = Array.isArray(parsed.mainReasons) ? parsed.mainReasons.slice(0, 6) : [];
      parsed.score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
      parsed.confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
      return parsed;
    } catch {
      return null;
    }
  });
