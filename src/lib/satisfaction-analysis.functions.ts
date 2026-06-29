import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type TimelineEvent = {
  date: string; // DD/MM/AAAA
  category:
    | "critico"
    | "duvida"
    | "ajuste"
    | "configuracao"
    | "orientacao"
    | "info";
  summary: string;
  supportResponse: string;
  status: "Resolvido" | "Pendente" | "Em análise";
};

export type ParticipantEntry = {
  name: string; // never phone numbers — role+name from conversation
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
  sentiment:
    | "muito_satisfeito"
    | "satisfeito"
    | "neutro"
    | "insatisfeito"
    | "muito_insatisfeito";
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

    const sys = `Você é um ANALISTA SÊNIOR de Customer Success, Qualidade e Auditoria de Atendimento. Analisa logs de WhatsApp de suporte (texto, OCR de imagens, transcrições de áudio/vídeo, documentos) como UMA jornada única.

REGRAS CRÍTICAS:
- Escreva como auditor humano: direto, natural, profissional. PROIBIDO usar jargões da IA ("O contato reforça a necessidade de...", "A tratativa segue acompanhada por...", "vale ressaltar", "de forma cronológica e documentada").
- NUNCA exiba números de telefone (+55...). Substitua pelo nome/cargo identificado na conversa (ex: "Dra. Luciana / Diretora", "Tatiele / Recepção"). Se realmente não há nome, use "Recepção" ou "Solicitante 1".
- CRONOLOGIA IMUTÁVEL: ordem estritamente linear, sem misturar datas passadas dentro de blocos futuros.
- Faixa temporal: analise TODO o histórico fornecido — não ignore os primeiros dias.
- Citações: TODA emoção, churn, frustração precisa trazer a frase EXATA do cliente (ipsis litteris) e a DATA.
- Referências ao cliente devem usar gênero correto: "${clienteRef}".
- Citação direta entre aspas duplas: "...". Assunto paralelo entre parênteses: (...). Comentário do auditor entre colchetes: [...].
- Para destaque interno (negrito automático no PDF) coloque nomes próprios, datas, status ou números em CAIXA ALTA quando crítico.
- "consolidatedSummary": 4-5 parágrafos fluidos, narrativa cronológica (início, desenvolvimento, conclusão), tom técnico-executivo. SEM jargão da IA.

SAÍDA: APENAS JSON válido, sem markdown.`;

    const userMsg = `CLIENTE: ${data.clientName || "(não informado)"} — referência: ${clienteRef}
PERÍODO: ${data.stats.firstDate ?? "—"} a ${data.stats.lastDate ?? "—"}
DEMANDAS: ${data.stats.total} total | ${data.stats.resolvidas} resolvidas | ${data.stats.pendentes} pendentes
RESOLVEDORES: ${data.stats.resolvers.join(", ") || "—"}

CONTEÚDO DOS ANEXOS (OCR/transcrições):
${data.attachmentInsights.length ? data.attachmentInsights.map((s, i) => `[${i + 1}] ${s}`).join("\n") : "(sem anexos interpretados)"}

CONVERSA (texto integral, cronológica):
${data.conversationText.slice(0, 40000)}

Retorne JSON com este schema EXATO:
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
  "mainReasons": ["3 a 6 motivos curtos"],
  "executiveSummary": "2-3 frases objetivas",
  "consolidatedSummary": "P1\\n\\nP2\\n\\nP3\\n\\nP4\\n\\nP5",
  "auditReport": {
    "participants": [{"name":"Nome ou Cargo","org":"Clínica X | Amigo Flow","role":"Solicitante Principal | Analista de Implantação | Recepção | Diretora"}],
    "timeline": [{"date":"DD/MM/AAAA","category":"critico|duvida|ajuste|configuracao|orientacao|info","summary":"resumo curto e natural","supportResponse":"o que a equipe respondeu/executou","status":"Resolvido|Pendente|Em análise"}],
    "supportBehavior": {
      "resolutive": ["parametrizações e correções ágeis"],
      "defenses": ["momentos onde suporte provou via logs/prints que erro foi operacional interno do cliente"],
      "limitations": ["travas nativas do produto declaradas com transparência"],
      "silences": ["dias sem resposta, loops longos, dependência excessiva de envio de link"]
    },
    "indicators": {
      "ajustes": number,
      "duvidas": number,
      "orientacoes": number,
      "bugs": number,
      "reaberturas": number,
      "topErrors": ["temas mais reincidentes"]
    },
    "health": {"label":"🟢 Excelente|🟡 Atenção|🔴 Crítico","justification":"2 frases"},
    "humorEvolution": {"label":"⬆ Melhorando|➡ Estável|⬇ Piorando","justification":"justificativa"},
    "complexity": {"label":"Baixa|Média|Alta|Muito Alta","motive":"motivo"},
    "effort": {"label":"Baixo|Médio|Alto|Muito Alto","detail":"detalhar retrabalhos manuais por causa do sistema"},
    "emotionalMoments": [{"emotion":"Satisfação|Insatisfação|Frustração|Confiança|Ansiedade|Urgência","confidence":0-100,"quote":"citação literal","date":"DD/MM/AAAA","motive":"contexto"}],
    "humorTimeline": [{"date":"DD/MM","emoji":"😊|😐|😠|😟|😡|🙂"}],
    "csat": {"score":0-100,"classification":"Muito Satisfeito|Satisfeito|Neutro|Insatisfeito|Muito Insatisfeito","calculationMemo":"justificativa qualitativa+quantitativa que determinou a nota"},
    "churnSignals": [{"weight":"Baixo|Médio|Alto","date":"DD/MM/AAAA","quote":"texto idêntico enviado pelo cliente","impact":"por que essa fala coloca o contrato em risco"}],
    "diagnosis": {
      "strengths": ["boas posturas e resoluções eficientes"],
      "attentionPoints": ["retrabalhos, configurações incompletas, falhas sistêmicas"],
      "opportunities": {
        "product": ["o que o software precisa passar a fazer nativamente"],
        "support": ["como os analistas podem melhorar tempo/proatividade"],
        "process": ["alinhamentos ou treinamentos operacionais para o cliente"]
      }
    },
    "conclusion": {
      "willChurn": "Sim/Não + justificativa direta com evidência",
      "isEvolvingMaturity": "diagnóstico: evoluindo ou apenas paliativo? Justificar",
      "nextSteps": [{"action":"passo prático imediato","owner":"responsável (papel/equipe)"}]
    }
  }
}`;

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userMsg },
          ],
          temperature: 0.2,
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
