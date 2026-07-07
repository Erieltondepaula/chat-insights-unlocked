import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyze, parseWhatsApp, type Analysis } from "@/lib/whatsapp-parser";
import { analyzeAttachments } from "@/lib/attachment-analysis.functions";
import { analyzeSatisfaction, DEFAULT_SATISFACTION_SYSTEM_PROMPT, type SatisfactionAnalysis } from "@/lib/satisfaction-analysis.functions";
import { buildDraft, generatePdf, type AttachmentInsight, type ReportDraft } from "@/lib/pdf-report";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Análise de Conversa WhatsApp – Relatório em PDF" },
      {
        name: "description",
        content: "Envie a exportação do WhatsApp e gere um relatório técnico enxuto e editável em PDF.",
      },
    ],
  }),
  component: Index,
});

type ExtraMedia = {
  images: { name: string; size: number }[];
  videos: { name: string; size: number }[];
  audios: { name: string; size: number }[];
  documents: { name: string; size: number }[];
  others: { name: string; size: number }[];
};

type MediaAttachmentFile = { file: File; kind: AttachmentInsight["type"] };

/**
 * Extrai o nome da clínica/cliente a partir de rótulos como:
 *   "Conversa do WhatsApp com PÓS - AMIGO FLOW - Clínica X"
 *   "Conversa do WhatsApp com AMIGO FLOW - Clínica X.txt"
 * Regra: ignorar tudo até (e inclusive) o último "AMIGO FLOW" e retornar
 * o trecho após o próximo hífen. Se não houver marcador, devolve o rótulo limpo.
 */
function extractClientName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim().replace(/\.txt$/i, "").replace(/\s+/g, " ");
  const re = /amigo\s*flow/gi;
  let lastIdx = -1;
  let lastLen = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    lastIdx = m.index;
    lastLen = m[0].length;
  }
  if (lastIdx >= 0) {
    const after = s.slice(lastIdx + lastLen);
    const dashIdx = after.search(/[-–—]/);
    if (dashIdx >= 0) {
      const tail = after.slice(dashIdx + 1).trim();
      if (tail) return tail.replace(/^[-–—\s]+|[-–—\s]+$/g, "");
    }
  }
  // Fallback: remove prefixos comuns
  return s
    .replace(/^conversa\s+do\s+whatsapp\s+com\s+/i, "")
    .replace(/^p[oó]s\s*[-–—]\s*amigo\s*flow\s*[-–—]?\s*/i, "")
    .replace(/^amigo\s*flow\s*[-–—]?\s*/i, "")
    .trim();
}


const EXT = {
  image: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "tiff"],
  video: ["mp4", "mov", "avi", "mkv", "3gp", "webm"],
  audio: ["opus", "mp3", "ogg", "m4a", "wav", "aac", "flac"],
  document: ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "vcf"],
};

function classify(name: string): keyof ExtraMedia | "txt" {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "txt") return "txt";
  if (EXT.image.includes(ext)) return "images";
  if (EXT.video.includes(ext)) return "videos";
  if (EXT.audio.includes(ext)) return "audios";
  if (EXT.document.includes(ext)) return "documents";
  return "others";
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fallbackMime(name: string, kind: AttachmentInsight["type"]): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (kind === "image") return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  if (kind === "audio")
    return ext === "wav"
      ? "audio/wav"
      : ext === "m4a"
        ? "audio/mp4"
        : ext === "ogg" || ext === "opus"
          ? "audio/ogg"
          : "audio/mpeg";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

function Index() {
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [txtFiles, setTxtFiles] = useState<File[]>([]);
  const [extras, setExtras] = useState<ExtraMedia>({
    images: [],
    videos: [],
    audios: [],
    documents: [],
    others: [],
  });
  const [mediaFiles, setMediaFiles] = useState<MediaAttachmentFile[]>([]);
  const [attachmentInsights, setAttachmentInsights] = useState<AttachmentInsight[]>([]);
  const [satisfaction, setSatisfaction] = useState<SatisfactionAnalysis | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null); // Estado para feedback dinâmico de etapas
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [customPrompt, setCustomPrompt] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_SATISFACTION_SYSTEM_PROMPT;
    return localStorage.getItem("satisfaction_prompt_v1") || DEFAULT_SATISFACTION_SYSTEM_PROMPT;
  });
  const [promptSaved, setPromptSaved] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "");
      folderRef.current.setAttribute("directory", "");
      folderRef.current.setAttribute("mozdirectory", "");
    }
  }, []);

  async function handleFiles(files: File[], label: string) {
    setError(null);
    setInfo(null);
    setAnalysis(null);
    setDraft(null);
    setAttachmentInsights([]);
    setSatisfaction(null);
    setStatusMessage(null);
    if (files.length === 0) return;

    const buckets: ExtraMedia = {
      images: [],
      videos: [],
      audios: [],
      documents: [],
      others: [],
    };
    const txts: File[] = [];
    const mediaForAi: MediaAttachmentFile[] = [];
    for (const f of files) {
      const k = classify(f.name);
      if (k === "txt") txts.push(f);
      else {
        buckets[k].push({ name: f.name, size: f.size });
        if (k === "images") mediaForAi.push({ file: f, kind: "image" });
        if (k === "audios") mediaForAi.push({ file: f, kind: "audio" });
        if (k === "documents") mediaForAi.push({ file: f, kind: "document" });
        if (k === "others") mediaForAi.push({ file: f, kind: "other" });
      }
    }
    setExtras(buckets);
    setTxtFiles(txts);
    setMediaFiles(mediaForAi);
    setSourceLabel(label);

    const totalMedia = buckets.images.length + buckets.videos.length + buckets.audios.length + buckets.documents.length;
    if (txts.length === 0 && totalMedia === 0) {
      setError("Nenhum arquivo reconhecido. Envie o .txt exportado do WhatsApp ou a pasta inteira da exportação.");
      return;
    }
    if (txts.length === 0) {
      setInfo(
        `Encontrei ${totalMedia} mídia(s), mas nenhum arquivo .txt da conversa. Envie o .txt para análise completa.`,
      );
    } else {
      setInfo(
        `Pronto para analisar: ${txts.length} conversa(s) .txt` +
          (totalMedia ? ` + ${totalMedia} mídia(s) com interpretação por IA.` : "."),
      );
    }
  }

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      setStatusMessage("1/3 📂 Lendo e estruturando os arquivos de texto...");
      let combined = "";
      for (const f of txtFiles) {
        const t = await f.text();
        combined += (combined ? "\n" : "") + t;
      }
      const allMsgs = combined ? parseWhatsApp(combined) : [];
      const lastTs = allMsgs.length ? Math.max(...allMsgs.map((m) => m.date.getTime())) : Date.now();
      const windowEnd = lastTs;
      const windowStart = lastTs - 14 * 86_400_000;
      const msgs = allMsgs.filter((m) => m.date.getTime() >= windowStart && m.date.getTime() <= windowEnd);
      const a = analyze(msgs);
      const fileMedia = {
        image: extras.images.length,
        video: extras.videos.length,
        audio: extras.audios.length,
        document: extras.documents.length,
        sticker: 0,
        gif: 0,
      };
      for (const k of Object.keys(fileMedia) as (keyof typeof fileMedia)[]) {
        a.mediaCount[k] = Math.max(a.mediaCount[k], fileMedia[k]);
      }

      if (mediaFiles.length > 0) {
        setStatusMessage(
          `2/3 🖼️ Processando ${Math.min(mediaFiles.length, 8)} anexo(s) com Inteligência Computacional (OCR e Áudios)...`,
        );
      }
      const insights = await analyzeSelectedAttachments(mediaFiles);
      setAttachmentInsights(insights);

      if (msgs.length === 0 && allMsgs.length > 0) {
        setError(
          "Nenhuma mensagem encontrada nas últimas 2 semanas. A conversa pode estar fora do recorte solicitado.",
        );
        setAnalysis(null);
        setStatusMessage(null);
      } else if (
        msgs.length === 0 &&
        extras.images.length + extras.videos.length + extras.audios.length + extras.documents.length === 0
      ) {
        setError("Não foi possível identificar mensagens nem mídias.");
        setAnalysis(null);
        setStatusMessage(null);
      } else {
        setAnalysis(a);

        setStatusMessage("3/3 🤖 Rodando Auditoria Comportamental, CSAT Analítico e Sinais de Churn...");

        const rawLabel = a.groupName || sourceLabel || "";
        const clientDisplayName = extractClientName(rawLabel) || rawLabel;
        const lastWord = clientDisplayName.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
        const gender: "o" | "a" =
          /^(clinica|clínica|dra|dra\.|sra|sra\.|recep[cç][aã]o)$/.test(lastWord) || /a$/.test(lastWord) ? "a" : "o";
        const convoText = msgs
          .filter((m) => !m.isSystem)
          .map((m) => `[${m.date.toLocaleDateString("pt-BR")} ${m.author}] ${m.content}`)
          .join("\n")
          .slice(0, 24000);
        const sat = await analyzeSatisfaction({
          data: {
            clientName: clientDisplayName,
            clientGender: gender,
            conversationText: convoText || "(sem texto)",
            attachmentInsights: insights.map((i) => i.summary).filter(Boolean),
            customSystemPrompt: customPrompt,
            stats: {
              total: a.demandStats.total,
              resolvidas: a.demandStats.resolvidas,
              pendentes: a.demandStats.pendentes,
              firstDate: a.firstDate ? a.firstDate.toISOString().slice(0, 10) : null,
              lastDate: a.lastDate ? a.lastDate.toISOString().slice(0, 10) : null,
              resolvers: a.demandStats.resolvedoresTop.slice(0, 3).map((r) => r.name),
              themes: [],
            },
          },
        }).catch(() => null);
        setSatisfaction(sat);
        setDraft(buildDraft(a, clientDisplayName || "Relatório", insights, sat));

        setStatusMessage(null); // Limpa mensagem após o fim
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao analisar.");
      setStatusMessage(null);
    } finally {
      setLoading(false);
    }
  }

  function resetDraft() {
    if (analysis) setDraft(buildDraft(analysis, extractClientName(sourceLabel) || sourceLabel || "Relatório", attachmentInsights, satisfaction));
  }

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  function buildPreview() {
    if (!draft) return;
    const doc = generatePdf(draft);
    const url = doc.output("bloburl") as unknown as string;
    setPreviewUrl((prev) => {
      if (prev) {
        try { URL.revokeObjectURL(prev); } catch { /* noop */ }
      }
      return String(url);
    });
  }

  function openPreview() {
    if (!draft) return;
    buildPreview();
    setPreviewOpen(true);
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewUrl((prev) => {
      if (prev) {
        try { URL.revokeObjectURL(prev); } catch { /* noop */ }
      }
      return null;
    });
  }

  function downloadPdf() {
    if (!draft) return;
    const doc = generatePdf(draft);
    const fname = (draft.title || "relatorio").replace(/[^\w-]+/g, "_").slice(0, 60);
    doc.save(`${fname}.pdf`);
  }


  async function analyzeSelectedAttachments(files: MediaAttachmentFile[]): Promise<AttachmentInsight[]> {
    const selected = files.filter(({ file }) => file.size <= 8 * 1024 * 1024).slice(0, 8);
    if (!selected.length) return [];
    try {
      return await analyzeAttachments({
        data: {
          files: await Promise.all(
            selected.map(async ({ file, kind }) => ({
              name: file.name,
              mime: file.type || fallbackMime(file.name, kind),
              kind,
              data: await fileToBase64(file),
            })),
          ),
        },
      });
    } catch {
      return selected.map(({ file, kind }) => ({
        name: file.name,
        type: kind,
        summary: "Anexo considerado como contexto da conversa.",
      }));
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.items;
    if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
      const all: File[] = [];
      const promises: Promise<void>[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) promises.push(walkEntry(entry, all));
      }
      Promise.all(promises).then(() => {
        const label =
          items.length === 1 && items[0].webkitGetAsEntry()?.isDirectory
            ? items[0].webkitGetAsEntry()!.name
            : `${all.length} arquivos`;
        all.sort((x, y) => x.name.localeCompare(y.name));
        handleFiles(all, label);
      });
    } else {
      const files = Array.from(e.dataTransfer.files);
      files.sort((x, y) => x.name.localeCompare(y.name));
      handleFiles(files, files.length === 1 ? files[0].name : `${files.length} arquivos`);
    }
  }

  const canAnalyze =
    txtFiles.length > 0 ||
    extras.images.length + extras.videos.length + extras.audios.length + extras.documents.length > 0;

  const kpis = useMemo(() => {
    if (!analysis) return null;
    return [
      { label: "Mensagens", value: analysis.totalMessages },
      { label: "Participantes", value: analysis.participants.length },
      { label: "Solicitadas", value: analysis.demandStats.total },
      { label: "Pendentes", value: analysis.demandStats.pendentes },
      { label: "Resolvidas", value: analysis.demandStats.resolvidas },
      { label: "Resolução", value: `${analysis.demandStats.taxaResolucao.toFixed(0)}%` },
    ];
  }, [analysis]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 to-white">
      <header className="border-b border-emerald-100 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white font-bold">
              W
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight text-emerald-900">Análise de Conversa WhatsApp</h1>
              <p className="text-xs text-emerald-700/70">Relatório técnico enxuto e editável em PDF</p>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div
          className={`rounded-2xl border-2 ${dragOver ? "border-emerald-500 bg-emerald-50" : "border-emerald-100 bg-white"} p-8 shadow-sm transition`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <h2 className="text-2xl font-bold text-emerald-900">Envie a exportação do WhatsApp</h2>
          <p className="mt-2 text-sm text-emerald-800/70">
            Aceita <strong>.txt</strong>, imagens, vídeos, áudios e documentos. Você pode arrastar a pasta inteira.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-6 py-10 text-center transition hover:bg-emerald-50"
            >
              <span className="text-3xl">📄</span>
              <span className="mt-2 font-medium text-emerald-900">Arquivos</span>
              <span className="text-xs text-emerald-700/70">um ou vários (qualquer tipo)</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                files.sort((x, y) => x.name.localeCompare(y.name));
                handleFiles(files, files.length === 1 ? files[0].name : `${files.length} arquivos`);
                e.target.value = "";
              }}
            />

            <button
              type="button"
              onClick={() => folderRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-6 py-10 text-center transition hover:bg-emerald-50"
            >
              <span className="text-3xl">📁</span>
              <span className="mt-2 font-medium text-emerald-900">Pasta completa</span>
              <span className="text-xs text-emerald-700/70">extração inteira do WhatsApp</span>
            </button>
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                files.sort((x, y) => x.name.localeCompare(y.name));
                let label = `${files.length} arquivos`;
                const first = files[0] as File & { webkitRelativePath?: string };
                if (first?.webkitRelativePath) label = first.webkitRelativePath.split("/")[0];
                handleFiles(files, label);
                e.target.value = "";
              }}
            />
          </div>

          {sourceLabel && (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-emerald-900">📎 {sourceLabel}</span>
                {statusMessage && (
                  <span className="text-xs font-semibold text-emerald-700 animate-pulse flex items-center gap-1.5 mt-0.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600 animate-ping"></span>
                    {statusMessage}
                  </span>
                )}
              </div>
              <button
                onClick={runAnalysis}
                disabled={loading || !canAnalyze}
                className="ml-auto rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {loading ? "Analisando…" : "Analisar conversa"}
              </button>
            </div>
          )}

          {info && !error && !loading && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {info}
            </div>
          )}
          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}
        </div>

        {draft && analysis && (
          <div className="mt-10 space-y-6">
            <div className="sticky top-4 z-30 rounded-xl border border-emerald-200 bg-white/95 p-6 shadow-lg backdrop-blur">

              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-lg font-semibold text-emerald-900">Prompt da Análise (editável)</h4>
                {promptSaved && <span className="text-xs text-emerald-700">{promptSaved}</span>}
              </div>
              <textarea
                className="h-56 w-full rounded-md border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-emerald-900 focus:border-emerald-500 focus:outline-none"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    localStorage.setItem("satisfaction_prompt_v1", customPrompt);
                    setPromptSaved("Prompt salvo. Vale para as próximas análises.");
                    setTimeout(() => setPromptSaved(null), 3000);
                  }}
                  className="rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  Salvar prompt
                </button>
                <button
                  onClick={() => {
                    setCustomPrompt(DEFAULT_SATISFACTION_SYSTEM_PROMPT);
                    localStorage.removeItem("satisfaction_prompt_v1");
                    setPromptSaved("Prompt restaurado para o padrão.");
                    setTimeout(() => setPromptSaved(null), 3000);
                  }}
                  className="rounded-md border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                >
                  Restaurar padrão
                </button>
                <button
                  onClick={() => {
                    setCustomPrompt("");
                    localStorage.removeItem("satisfaction_prompt_v1");
                    setPromptSaved("Prompt limpo.");
                    setTimeout(() => setPromptSaved(null), 3000);
                  }}
                  className="rounded-md border border-red-200 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  Excluir
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              {kpis!.map((k) => (
                <div key={k.label} className="rounded-xl border border-emerald-100 bg-white p-3 text-center shadow-sm">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-700/70">{k.label}</p>
                  <p className="mt-1 text-xl font-bold text-emerald-900">{k.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-emerald-900">Pré-visualização editável</h3>
                <p className="text-sm text-emerald-800/70">Ajuste os textos abaixo. As alterações vão para o PDF.</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={resetDraft}
                  className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
                >
                  ↺ Restaurar
                </button>
                <button
                  onClick={openPreview}
                  className="rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
                >
                  👁️ Pré-visualizar PDF
                </button>
              </div>
            </div>

            <Editor draft={draft} onChange={setDraft} />
          </div>
        )}
      </section>

      <footer className="border-t border-emerald-100 bg-white/60 py-6 text-center text-xs text-emerald-700/70">
        Os arquivos são processados localmente no seu navegador.
      </footer>
    </main>
  );
}

function Editor({ draft, onChange }: { draft: ReportDraft; onChange: (d: ReportDraft) => void }) {
  const set = <K extends keyof ReportDraft>(k: K, v: ReportDraft[K]) => onChange({ ...draft, [k]: v });

  return (
    <div className="space-y-6">
      <Card title="Cabeçalho">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Título do relatório">
            <input className={inputCls} value={draft.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Subtítulo">
            <input className={inputCls} value={draft.subtitle} onChange={(e) => set("subtitle", e.target.value)} />
          </Field>
          <Field label="Cliente Contratante">
            <input className={inputCls} value={draft.clientName} onChange={(e) => set("clientName", e.target.value)} />
          </Field>
          <Field label="Módulo Auditado">
            <input
              className={inputCls}
              value={draft.moduleAudited}
              onChange={(e) => set("moduleAudited", e.target.value)}
            />
          </Field>
          <Field label="Data de Emissão">
            <input
              className={inputCls}
              value={draft.emissionDate}
              onChange={(e) => set("emissionDate", e.target.value)}
            />
          </Field>
          <Field label="Status Atual">
            <input className={inputCls} value={draft.status} onChange={(e) => set("status", e.target.value)} />
          </Field>
          <Field label="Início do Grupo">
            <input
              className={inputCls}
              value={draft.groupCreatedAt}
              onChange={(e) => set("groupCreatedAt", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title="1. Envolvidos no Processo">
        <div className="space-y-2">
          {draft.envolvidos.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input
                className={`${inputCls} col-span-3`}
                placeholder="Nome"
                value={p.name}
                onChange={(e) => {
                  const n = [...draft.envolvidos];
                  n[i] = { ...n[i], name: e.target.value };
                  set("envolvidos", n);
                }}
              />
              <input
                className={`${inputCls} col-span-3`}
                placeholder="Organização"
                value={p.org}
                onChange={(e) => {
                  const n = [...draft.envolvidos];
                  n[i] = { ...n[i], org: e.target.value };
                  set("envolvidos", n);
                }}
              />
              <input
                className={`${inputCls} col-span-5`}
                placeholder="Papel / atribuição"
                value={p.role}
                onChange={(e) => {
                  const n = [...draft.envolvidos];
                  n[i] = { ...n[i], role: e.target.value };
                  set("envolvidos", n);
                }}
              />
              <button
                className="col-span-1 rounded border border-red-200 text-sm text-red-700 hover:bg-red-50"
                onClick={() =>
                  set(
                    "envolvidos",
                    draft.envolvidos.filter((_, j) => j !== i),
                  )
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="text-sm font-medium text-emerald-700 hover:underline"
            onClick={() => set("envolvidos", [...draft.envolvidos, { name: "", org: "", role: "" }])}
          >
            + Adicionar envolvido
          </button>
        </div>
      </Card>

      <Card title="2. Situação Atual, Pendências e Resumo Executivo">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Breve resumo do período analisado">
            <textarea
              className={textareaCls}
              rows={4}
              value={draft.periodSummary}
              onChange={(e) => set("periodSummary", e.target.value)}
            />
          </Field>
          <Field label="Situação Atual">
            <textarea
              className={textareaCls}
              rows={4}
              value={draft.currentSituation}
              onChange={(e) => set("currentSituation", e.target.value)}
            />
          </Field>
          <Field label="Pendências">
            <textarea
              className={textareaCls}
              rows={4}
              value={draft.pendingItems}
              onChange={(e) => set("pendingItems", e.target.value)}
            />
          </Field>
          <Field label="Resumo Executivo">
            <textarea
              className={textareaCls}
              rows={4}
              value={draft.executiveSummary}
              onChange={(e) => set("executiveSummary", e.target.value)}
            />
          </Field>
          <Field label="Principais Temas Identificados">
            <textarea
              className={textareaCls}
              rows={4}
              value={draft.mainThemes}
              onChange={(e) => set("mainThemes", e.target.value)}
            />
          </Field>
          <Field label="Ações Executadas">
            <textarea
              className={textareaCls}
              rows={4}
              value={draft.actionsExecuted}
              onChange={(e) => set("actionsExecuted", e.target.value)}
            />
          </Field>
          <Field label="Pendências Atuais">
            <textarea
              className={textareaCls}
              rows={4}
              value={draft.currentPendencies}
              onChange={(e) => set("currentPendencies", e.target.value)}
            />
          </Field>
          <Field label="Imagens, áudios e documentos considerados">
            <textarea
              className={textareaCls}
              rows={4}
              value={draft.attachmentNotes}
              onChange={(e) => set("attachmentNotes", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title="3. Demandas do Cliente e Retorno/Ações Realizadas">
        <div className="space-y-4">
          {draft.demands.map((d, i) => (
            <div key={i} className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
              <div className="grid grid-cols-12 gap-2">
                <input
                  className={`${inputCls} col-span-3`}
                  value={d.dateLabel}
                  placeholder="Data"
                  onChange={(e) => {
                    const n = [...draft.demands];
                    n[i] = { ...n[i], dateLabel: e.target.value };
                    set("demands", n);
                  }}
                />
                <input
                  className={`${inputCls} col-span-8`}
                  value={d.requester}
                  placeholder="Solicitante"
                  onChange={(e) => {
                    const n = [...draft.demands];
                    n[i] = { ...n[i], requester: e.target.value };
                    set("demands", n);
                  }}
                />
                <button
                  className="col-span-1 rounded border border-red-200 text-sm text-red-700 hover:bg-red-50"
                  onClick={() =>
                    set(
                      "demands",
                      draft.demands.filter((_, j) => j !== i),
                    )
                  }
                >
                  ✕
                </button>
              </div>
              <Field label="Solicitação do Cliente — resumo">
                <textarea
                  className={textareaCls}
                  rows={2}
                  value={d.demandSummary}
                  onChange={(e) => {
                    const n = [...draft.demands];
                    n[i] = { ...n[i], demandSummary: e.target.value };
                    set("demands", n);
                  }}
                />
              </Field>
              <Field label="Frases importantes (uma por linha)">
                <textarea
                  className={textareaCls}
                  rows={2}
                  value={(d.keyQuotes ?? []).join("\n")}
                  onChange={(e) => {
                    const n = [...draft.demands];
                    n[i] = { ...n[i], keyQuotes: e.target.value.split("\n").filter(Boolean) };
                    set("demands", n);
                  }}
                />
              </Field>
              <Field label="Devolutiva do Suporte — resumo">
                <textarea
                  className={textareaCls}
                  rows={2}
                  value={d.responseSummary}
                  onChange={(e) => {
                    const n = [...draft.demands];
                    n[i] = { ...n[i], responseSummary: e.target.value };
                    set("demands", n);
                  }}
                />
              </Field>
              <Field label="Solução apresentada / Status">
                <div className="grid grid-cols-2 gap-2">
                  <textarea
                    className={textareaCls}
                    rows={2}
                    placeholder="Solução"
                    value={d.solution}
                    onChange={(e) => {
                      const n = [...draft.demands];
                      n[i] = { ...n[i], solution: e.target.value };
                      set("demands", n);
                    }}
                  />
                  <textarea
                    className={textareaCls}
                    rows={2}
                    placeholder="Status / Próximos passos"
                    value={`${d.status}${d.nextSteps ? " | " + d.nextSteps : ""}`}
                    onChange={(e) => {
                      const [status, ...rest] = e.target.value.split("|");
                      const n = [...draft.demands];
                      n[i] = { ...n[i], status: status.trim(), nextSteps: rest.join("|").trim() };
                      set("demands", n);
                    }}
                  />
                </div>
              </Field>
            </div>
          ))}
          <button
            className="text-sm font-medium text-emerald-700 hover:underline"
            onClick={() =>
              set("demands", [
                ...draft.demands,
                {
                  dateLabel: "",
                  requester: "",
                  demandSummary: "",
                  keyQuotes: [],
                  problem: "",
                  responder: "",
                  responseSummary: "",
                  solution: "",
                  status: "",
                  nextSteps: "",
                },
              ])
            }
          >
            + Adicionar demanda
          </button>
        </div>
      </Card>

      <Card title="16. Resumo Consolidado do Atendimento">
        <Field label="Texto completo (5 parágrafos, com citações do cliente)">
          <textarea
            className={textareaCls}
            rows={22}
            value={draft.consolidatedSummary}
            onChange={(e) => set("consolidatedSummary", e.target.value)}
          />
        </Field>
        <p className="mt-2 text-xs text-emerald-700/70">
          Dica: use aspas duplas "assim" para destacar citações do cliente em negrito no PDF. Rótulos como Dor:, Elogio:, Recomendação:, Impacto:, Risco:, Reincidência: também são destacados automaticamente.
        </p>
      </Card>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-900 focus:border-emerald-500 focus:outline-none";
const textareaCls = inputCls + " font-mono text-[12.5px] leading-relaxed";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-emerald-700/70">{label}</span>
      {children}
    </label>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-white p-6 shadow-sm">
      <h4 className="mb-4 text-lg font-semibold text-emerald-900">{title}</h4>
      {children}
    </div>
  );
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push(file);
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const readAll = async (): Promise<FileSystemEntry[]> => {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (batch.length === 0) return [];
      const rest = await readAll();
      return [...batch, ...rest];
    };
    const entries = await readAll();
    for (const e of entries) await walkEntry(e, out);
  }
}
