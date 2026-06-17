import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyze, parseWhatsApp, type Analysis } from "@/lib/whatsapp-parser";
import { buildDraft, generatePdf, type ReportDraft } from "@/lib/pdf-report";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Análise de Conversa WhatsApp – Relatório em PDF" },
      {
        name: "description",
        content:
          "Envie a exportação do WhatsApp e gere um relatório técnico enxuto e editável em PDF.",
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
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
    if (files.length === 0) return;

    const buckets: ExtraMedia = {
      images: [], videos: [], audios: [], documents: [], others: [],
    };
    const txts: File[] = [];
    for (const f of files) {
      const k = classify(f.name);
      if (k === "txt") txts.push(f);
      else buckets[k].push({ name: f.name, size: f.size });
    }
    setExtras(buckets);
    setTxtFiles(txts);
    setSourceLabel(label);

    const totalMedia = buckets.images.length + buckets.videos.length + buckets.audios.length + buckets.documents.length;
    if (txts.length === 0 && totalMedia === 0) {
      setError("Nenhum arquivo reconhecido. Envie o .txt exportado do WhatsApp ou a pasta inteira da exportação.");
      return;
    }
    if (txts.length === 0) {
      setInfo(`Encontrei ${totalMedia} mídia(s), mas nenhum arquivo .txt da conversa. Envie o .txt para análise completa.`);
    } else {
      setInfo(`Pronto para analisar: ${txts.length} conversa(s) .txt` + (totalMedia ? ` + ${totalMedia} mídia(s).` : "."));
    }
  }

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      let combined = "";
      for (const f of txtFiles) {
        const t = await f.text();
        combined += (combined ? "\n" : "") + t;
      }
      const msgs = combined ? parseWhatsApp(combined) : [];
      const a = analyze(msgs);
      const fileMedia = {
        image: extras.images.length, video: extras.videos.length,
        audio: extras.audios.length, document: extras.documents.length,
        sticker: 0, gif: 0,
      };
      for (const k of Object.keys(fileMedia) as (keyof typeof fileMedia)[]) {
        a.mediaCount[k] = Math.max(a.mediaCount[k], fileMedia[k]);
      }
      if (msgs.length === 0 && extras.images.length + extras.videos.length + extras.audios.length === 0) {
        setError("Não foi possível identificar mensagens nem mídias.");
        setAnalysis(null);
      } else {
        setAnalysis(a);
        setDraft(buildDraft(a, sourceLabel ?? "Relatório"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao analisar.");
    } finally {
      setLoading(false);
    }
  }

  function resetDraft() {
    if (analysis) setDraft(buildDraft(analysis, sourceLabel ?? "Relatório"));
  }

  function downloadPdf() {
    if (!draft) return;
    const doc = generatePdf(draft);
    const fname = (draft.title || "relatorio").replace(/[^\w\-]+/g, "_").slice(0, 60);
    doc.save(`${fname}.pdf`);
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
        const label = items.length === 1 && items[0].webkitGetAsEntry()?.isDirectory
          ? items[0].webkitGetAsEntry()!.name
          : `${all.length} arquivos`;
        handleFiles(all, label);
      });
    } else {
      const files = Array.from(e.dataTransfer.files);
      handleFiles(files, files.length === 1 ? files[0].name : `${files.length} arquivos`);
    }
  }

  const canAnalyze = txtFiles.length > 0 || extras.images.length + extras.videos.length + extras.audios.length + extras.documents.length > 0;

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
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white font-bold">W</div>
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
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <h2 className="text-2xl font-bold text-emerald-900">Envie a exportação do WhatsApp</h2>
          <p className="mt-2 text-sm text-emerald-800/70">
            Aceita <strong>.txt</strong>, imagens, vídeos, áudios e documentos. Você pode arrastar a pasta inteira.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-6 py-10 text-center transition hover:bg-emerald-50">
              <span className="text-3xl">📄</span>
              <span className="mt-2 font-medium text-emerald-900">Arquivos</span>
              <span className="text-xs text-emerald-700/70">um ou vários (qualquer tipo)</span>
            </button>
            <input ref={fileRef} type="file" multiple className="hidden"
              onChange={(e) => { const files = Array.from(e.target.files ?? []); handleFiles(files, files.length === 1 ? files[0].name : `${files.length} arquivos`); e.target.value = ""; }} />

            <button type="button" onClick={() => folderRef.current?.click()} className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-6 py-10 text-center transition hover:bg-emerald-50">
              <span className="text-3xl">📁</span>
              <span className="mt-2 font-medium text-emerald-900">Pasta completa</span>
              <span className="text-xs text-emerald-700/70">extração inteira do WhatsApp</span>
            </button>
            <input ref={folderRef} type="file" multiple className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                let label = `${files.length} arquivos`;
                const first = files[0] as File & { webkitRelativePath?: string };
                if (first?.webkitRelativePath) label = first.webkitRelativePath.split("/")[0];
                handleFiles(files, label);
                e.target.value = "";
              }} />
          </div>

          {sourceLabel && (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
              <span className="text-sm font-medium text-emerald-900">📎 {sourceLabel}</span>
              <button onClick={runAnalysis} disabled={loading || !canAnalyze}
                className="ml-auto rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50">
                {loading ? "Analisando…" : "Analisar conversa"}
              </button>
            </div>
          )}

          {info && !error && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{info}</div>}
          {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
        </div>

        {draft && analysis && (
          <div className="mt-10 space-y-6">
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
                <button onClick={resetDraft} className="rounded-md border border-emerald-300 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                  ↺ Restaurar
                </button>
                <button onClick={downloadPdf} className="rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800">
                  ⬇️ Gerar PDF
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
          <Field label="Título / Nome do grupo">
            <input className={inputCls} value={draft.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Cliente / Grupo (identificação)">
            <input className={inputCls} value={draft.clientName} onChange={(e) => set("clientName", e.target.value)} />
          </Field>
          <Field label="Início do grupo">
            <input className={inputCls} value={draft.groupCreatedAt} onChange={(e) => set("groupCreatedAt", e.target.value)} />
          </Field>
          <Field label="Período analisado">
            <input className={inputCls} value={draft.period} onChange={(e) => set("period", e.target.value)} />
          </Field>
          <Field label="Data de emissão">
            <input className={inputCls} value={draft.emissionDate} onChange={(e) => set("emissionDate", e.target.value)} />
          </Field>
          <Field label="Status do projeto">
            <input className={inputCls} value={draft.status} onChange={(e) => set("status", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="1. Resumo Executivo">
        <textarea className={textareaCls} rows={5} value={draft.executiveSummary} onChange={(e) => set("executiveSummary", e.target.value)} />
      </Card>

      <Card title="Parecer (últimas 2 semanas)">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Texto do banner">
            <input className={inputCls} value={draft.verdictLabel} onChange={(e) => set("verdictLabel", e.target.value)} />
          </Field>
          <Field label="Recomendação">
            <select className={inputCls} value={draft.verdictRecommendation}
              onChange={(e) => set("verdictRecommendation", e.target.value as ReportDraft["verdictRecommendation"])}>
              <option value="pode_encerrar">Pode encerrar</option>
              <option value="manter_aberto">Manter aberto</option>
              <option value="avaliar_manual">Avaliar manualmente</option>
            </select>
          </Field>
        </div>
        <Field label="Corpo do parecer">
          <textarea className={textareaCls} rows={6} value={draft.verdictBody} onChange={(e) => set("verdictBody", e.target.value)} />
        </Field>
      </Card>

      <Card title="2. Envolvidos">
        <div className="space-y-2">
          {draft.envolvidos.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input className={`${inputCls} col-span-4`} value={p.name}
                onChange={(e) => { const n = [...draft.envolvidos]; n[i] = { ...n[i], name: e.target.value }; set("envolvidos", n); }} />
              <input className={`${inputCls} col-span-7`} value={p.role}
                onChange={(e) => { const n = [...draft.envolvidos]; n[i] = { ...n[i], role: e.target.value }; set("envolvidos", n); }} />
              <button className="col-span-1 rounded border border-red-200 text-sm text-red-700 hover:bg-red-50"
                onClick={() => set("envolvidos", draft.envolvidos.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="text-sm font-medium text-emerald-700 hover:underline"
            onClick={() => set("envolvidos", [...draft.envolvidos, { name: "", role: "" }])}>
            + Adicionar participante
          </button>
        </div>
      </Card>

      <Card title="3. Demandas Críticas">
        <div className="space-y-4">
          {draft.criticalDemands.map((d, i) => (
            <div key={i} className="rounded-lg border border-emerald-100 bg-emerald-50/30 p-3">
              <div className="grid grid-cols-12 gap-2">
                <input className={`${inputCls} col-span-3`} value={d.dateLabel} placeholder="Data"
                  onChange={(e) => { const n = [...draft.criticalDemands]; n[i] = { ...n[i], dateLabel: e.target.value }; set("criticalDemands", n); }} />
                <button className="col-span-1 ml-auto rounded border border-red-200 text-sm text-red-700 hover:bg-red-50"
                  onClick={() => set("criticalDemands", draft.criticalDemands.filter((_, j) => j !== i))}>✕</button>
              </div>
              <Field label="Ocorrência">
                <textarea className={textareaCls} rows={2} value={d.ocorrencia}
                  onChange={(e) => { const n = [...draft.criticalDemands]; n[i] = { ...n[i], ocorrencia: e.target.value }; set("criticalDemands", n); }} />
              </Field>
              <Field label="Resolução">
                <textarea className={textareaCls} rows={2} value={d.resolucao}
                  onChange={(e) => { const n = [...draft.criticalDemands]; n[i] = { ...n[i], resolucao: e.target.value }; set("criticalDemands", n); }} />
              </Field>
            </div>
          ))}
          <button className="text-sm font-medium text-emerald-700 hover:underline"
            onClick={() => set("criticalDemands", [...draft.criticalDemands, { dateLabel: "", ocorrencia: "", resolucao: "" }])}>
            + Adicionar demanda
          </button>
        </div>
      </Card>

      <Card title="4. Parecer Técnico Final">
        <textarea className={textareaCls} rows={6} value={draft.finalOpinion} onChange={(e) => set("finalOpinion", e.target.value)} />
      </Card>
    </div>
  );
}

const inputCls = "w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-emerald-900 focus:border-emerald-500 focus:outline-none";
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
