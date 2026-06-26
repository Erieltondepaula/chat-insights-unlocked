import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type SatisfactionAnalysis = {
  sentiment: "muito_satisfeito" | "satisfeito" | "neutro" | "insatisfeito" | "muito_insatisfeito";
  score: number; // 0-100
  confidence: number; // 0-100
  emotion: string; // Gratidão, Frustração, etc.
  evolution: "melhorou" | "piorou" | "permaneceu";
  finalSituation: "resolvido" | "parcialmente_resolvido" | "nao_resolvido";
  complaintsCount: number;
  praisesCount: number;
  repeatedRequestsCount: number;
  humanInterventionNeeded: boolean;
  churnRisk: "baixo" | "medio" | "alto";
  mainReasons: string[];
  executiveSummary: string;
  consolidatedSummary: string; // 4-5 paragraphs, fluid, with grammar rules applied
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
    const articleO = suffix === "a" ? "a" : "o";
    const clienteRef = `${articleO} client${suffix}`;

    const sys = `Você é o analista sênior de auditoria do Agente Flow. Avalie a satisfação do cliente considerando TODA a interação como uma única jornada: texto, transcrições de áudio, OCR de imagens, descrições de vídeo e conteúdo de documentos. NÃO use apenas palavras-chave isoladas — pondere contexto, evolução emocional, resolução real do problema, tom geral e padrões de repetição.

REGRAS DE SAÍDA OBRIGATÓRIAS:
- Retorne APENAS JSON válido, sem markdown.
- "consolidatedSummary" deve ter 4 a 5 parágrafos (separados por \\n\\n), fluidos, narrativa cronológica (início, desenvolvimento, conclusão), com tom técnico-executivo. Evite frases genéricas, repetições e jargão vazio.
- Referências ao cliente devem usar gênero correto: "${clienteRef}" (concordando artigos e adjetivos).
- Citações diretas do cliente vão entre aspas duplas: "...".
- Assuntos paralelos vão entre parênteses: (...).
- Comentários da auditoria vão entre colchetes: [...].
- Destaque internamente termos críticos colocando-os em CAIXA ALTA quando for nome próprio, número, data ou status (o renderizador aplica negrito automaticamente).
- "mainReasons": 3 a 6 motivos curtos e específicos que justificam a classificação.
- "executiveSummary": 2 a 3 frases objetivas resumindo o veredito.`;

    const userMsg = `CLIENTE: ${data.clientName || "(não informado)"} — referência: ${clienteRef}
PERÍODO: ${data.stats.firstDate ?? "—"} a ${data.stats.lastDate ?? "—"}
DEMANDAS: ${data.stats.total} total | ${data.stats.resolvidas} resolvidas | ${data.stats.pendentes} pendentes
RESOLVEDORES: ${data.stats.resolvers.join(", ") || "—"}
TEMAS: ${data.stats.themes.join("; ") || "—"}

CONTEÚDO INTERPRETADO DOS ANEXOS (OCR/transcrições):
${data.attachmentInsights.length ? data.attachmentInsights.map((s, i) => `[${i + 1}] ${s}`).join("\n") : "(sem anexos interpretados)"}

CONVERSA (texto integral consolidado, ordem cronológica):
${data.conversationText.slice(0, 24000)}

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
  "mainReasons": ["..."],
  "executiveSummary": "...",
  "consolidatedSummary": "P1...\\n\\nP2...\\n\\nP3...\\n\\nP4...\\n\\nP5..."
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
          temperature: 0.2,
        }),
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = json.choices?.[0]?.message?.content ?? "";
      const clean = raw.replace(/^```json\s*|\s*```$/g, "").trim();
      const parsed = JSON.parse(clean) as SatisfactionAnalysis;
      // Sanity defaults
      parsed.mainReasons = Array.isArray(parsed.mainReasons) ? parsed.mainReasons.slice(0, 6) : [];
      parsed.score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
      parsed.confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
      return parsed;
    } catch {
      return null;
    }
  });
