import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AttachmentInsight } from "./pdf-report";

const fileSchema = z.object({
  name: z.string().min(1),
  mime: z.string().min(1),
  kind: z.enum(["image", "audio", "document", "other"]),
  data: z.string().min(1),
});

export const analyzeAttachments = createServerFn({ method: "POST" })
  .inputValidator(z.object({ files: z.array(fileSchema).max(8) }))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey || data.files.length === 0) return [] satisfies AttachmentInsight[];

    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `Analise anexos de uma conversa de atendimento WhatsApp para auditoria operacional.
Retorne APENAS JSON válido com a chave "items".
Cada item: {"name":"arquivo","type":"image|audio|document|other","summary":"síntese objetiva do contexto","demands":["demandas do cliente"],"actions":["ações/devolutivas de suporte"],"pending":["pendências"]}.
Não invente dados. Se não houver texto audível/legível, descreva a limitação.`,
      },
    ];

    for (const file of data.files) {
      content.push({ type: "text", text: `Arquivo: ${file.name}` });
      const fileData = `data:${file.mime};base64,${file.data}`;
      if (file.kind === "image") content.push({ type: "image_url", image_url: { url: fileData } });
      else if (file.kind === "audio")
        content.push({
          type: "input_audio",
          input_audio: { data: file.data, format: audioFormat(file.name, file.mime) },
        });
      else content.push({ type: "file", file: { filename: file.name, file_data: fileData } });
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content }],
        temperature: 0.1,
      }),
    });

    if (!response.ok) return fallbackInsights(data.files);
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")) as {
        items?: AttachmentInsight[];
      };
      return (parsed.items ?? []).slice(0, 8);
    } catch {
      return fallbackInsights(data.files);
    }
  });

function fallbackInsights(files: Array<z.infer<typeof fileSchema>>): AttachmentInsight[] {
  return files.map((file) => ({
    name: file.name,
    type: file.kind,
    summary:
      "Anexo identificado e considerado como contexto da conversa; interpretação automática indisponível para este arquivo.",
  }));
}

function audioFormat(name: string, mime: string): string {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (mime.includes("wav") || ext === "wav") return "wav";
  if (mime.includes("mpeg") || ext === "mp3") return "mp3";
  if (mime.includes("mp4") || ext === "m4a") return "m4a";
  if (mime.includes("ogg") || ext === "ogg" || ext === "opus") return "ogg";
  if (mime.includes("aac") || ext === "aac") return "aac";
  if (mime.includes("flac") || ext === "flac") return "flac";
  return "webm";
}
