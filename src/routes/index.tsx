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
          "Envie a exportação do WhatsApp e receba um relatório profissional em PDF com linha do tempo, participantes, demandas e insights.",
      },
      { property: "og:title", content: "Análise de Conversa WhatsApp" },
      {
        property: "og:description",
        content: "Relatório completo em PDF a partir da exportação de conversas do WhatsApp.",
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // Set folder-upload attributes via ref (React strips unknown attrs)
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
    if (files.length === 0) return;

    const buckets: ExtraMedia = {
      images: [],
      videos: [],
      audios: [],
      documents: [],
      others: [],
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

    const totalMedia =
      buckets.images.length + buckets.videos.length + buckets.audios.length + buckets.documents.length;
    if (txts.length === 0 && totalMedia === 0) {
      setError("Nenhum arquivo reconhecido. Envie o .txt exportado do WhatsApp ou a pasta inteira da exportação.");
      return;
    }
    if (txts.length === 0) {
      setInfo(
        `Encontrei ${totalMedia} mídia(s), mas nenhum arquivo .txt da conversa. As mídias serão contabilizadas no relatório, mas é recomendado enviar o .txt para análise completa.`,
      );
    } else {
      setInfo(
        `Pronto para analisar: ${txts.length} conversa(s) .txt` +
          (totalMedia ? ` + ${totalMedia} mídia(s) detectada(s).` : "."),
      );
    }
  }

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      // Concatenate all txt contents
      let combined = "";
      for (const f of txtFiles) {
        const t = await f.text();
        combined += (combined ? "\n" : "") + t;
      }
      const msgs = combined ? parseWhatsApp(combined) : [];
      const a = analyze(msgs);

      // Merge file-based media counts (folder contents override / supplement)
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

      if (msgs.length === 0 && extras.images.length + extras.videos.length + extras.audios.length === 0) {
        setError("Não foi possível identificar mensagens nem mídias.");
        setAnalysis(null);
      } else {
        setAnalysis(a);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao analisar.");
    } finally {
      setLoading(false);
    }
  }

  function downloadPdf() {
    if (!analysis || !sourceLabel) return;
    const doc = generatePdf(analysis, sourceLabel);
    doc.save(`relatorio-whatsapp-${Date.now()}.pdf`);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.items;
    if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
      // Walk directory entries
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
        handleFiles(all, label);
      });
    } else {
      const files = Array.from(e.dataTransfer.files);
      handleFiles(files, files.length === 1 ? files[0].name : `${files.length} arquivos`);
    }
  }

  const stats = useMemo(() => {
    if (!analysis) return null;
    return [
      { label: "Mensagens", value: analysis.totalMessages },
      { label: "Participantes", value: analysis.participants.length },
      { label: "Demandas solicitadas", value: analysis.demandStats.total },
      { label: "Pendentes", value: analysis.demandStats.pendentes },
      { label: "Resolvidas", value: analysis.demandStats.resolvidas },
      { label: "Taxa resolução", value: `${analysis.demandStats.taxaResolucao.toFixed(0)}%` },
    ];
  }, [analysis]);

  const canAnalyze = txtFiles.length > 0 || extras.images.length + extras.videos.length + extras.audios.length + extras.documents.length > 0;

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 to-white">
      <header className="border-b border-emerald-100 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white font-bold">
              W
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight text-emerald-900">
                Análise de Conversa WhatsApp
              </h1>
              <p className="text-xs text-emerald-700/70">Relatório profissional em PDF</p>
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
          <h2 className="text-2xl font-bold text-emerald-900">
            Envie a exportação do WhatsApp
          </h2>
          <p className="mt-2 text-sm text-emerald-800/70">
            Aceita: <strong>.txt</strong>, .docx, .pdf, imagens (.jpg .png .webp), vídeos (.mp4 .mov)
            e áudios (.opus .mp3 .ogg). Você pode arrastar uma pasta inteira aqui.
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
                // Try to label by top-level folder
                let label = `${files.length} arquivos`;
                const first = files[0] as File & { webkitRelativePath?: string };
                if (first?.webkitRelativePath) label = first.webkitRelativePath.split("/")[0];
                handleFiles(files, label);
                e.target.value = "";
              }}
            />
          </div>

          {sourceLabel && (
            <div className="mt-6 space-y-3">
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                <span className="text-sm font-medium text-emerald-900">📎 {sourceLabel}</span>
                <button
                  onClick={runAnalysis}
                  disabled={loading || !canAnalyze}
                  className="ml-auto rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
                >
                  {loading ? "Analisando…" : "Analisar conversa"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-emerald-800/80 sm:grid-cols-5">
                <Pill label="Conversas (.txt)" value={txtFiles.length} />
                <Pill label="Imagens" value={extras.images.length} />
                <Pill label="Vídeos" value={extras.videos.length} />
                <Pill label="Áudios" value={extras.audios.length} />
                <Pill label="Documentos" value={extras.documents.length} />
              </div>
            </div>
          )}

          {info && !error && (
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

        {analysis && (
          <div className="mt-10 space-y-8">
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {stats!.map((s) => (
                <div key={s.label} className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
                  <p className="text-[10px] uppercase tracking-wide text-emerald-700/70">{s.label}</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-900">{s.value}</p>
                </div>
              ))}
            </div>

            {analysis.closureVerdict && (
              <div
                className={
                  "rounded-xl border-2 p-5 shadow-sm " +
                  (analysis.closureVerdict.recommendation === "pode_encerrar"
                    ? "border-emerald-500 bg-emerald-50"
                    : analysis.closureVerdict.recommendation === "manter_aberto"
                      ? "border-red-400 bg-red-50"
                      : "border-amber-400 bg-amber-50")
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-bold text-emerald-900">
                    Parecer (últimas 2 semanas)
                  </h3>
                  <span
                    className={
                      "rounded-full px-3 py-1 text-sm font-bold text-white " +
                      (analysis.closureVerdict.recommendation === "pode_encerrar"
                        ? "bg-emerald-600"
                        : analysis.closureVerdict.recommendation === "manter_aberto"
                          ? "bg-red-600"
                          : "bg-amber-600")
                    }
                  >
                    {analysis.closureVerdict.recommendation === "pode_encerrar"
                      ? "✅ Pode encerrar"
                      : analysis.closureVerdict.recommendation === "manter_aberto"
                        ? "⛔ Manter aberto"
                        : "⚠️ Avaliar manualmente"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  <Pill label="Mensagens" value={analysis.closureVerdict.totalMessages} />
                  <Pill label="Participantes ativos" value={analysis.closureVerdict.activeParticipants} />
                  <Pill label="Pendentes" value={analysis.closureVerdict.openDemands} />
                  <Pill label="Resolvidas" value={analysis.closureVerdict.resolvedDemands} />
                  <Pill
                    label="Dias s/ msg"
                    value={analysis.closureVerdict.daysSinceLastMessage >= 9999 ? 0 : analysis.closureVerdict.daysSinceLastMessage}
                  />
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-emerald-900/80">
                  {analysis.closureVerdict.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.demandStats.resolvedoresTop.length > 0 && (
              <Card title="Quem resolveu mais demandas">
                <Table
                  head={["Resolvedor", "Demandas resolvidas"]}
                  rows={analysis.demandStats.resolvedoresTop.map((r) => [r.name, r.count])}
                />
                {analysis.demandStats.tempoMedioResolucaoHoras !== null && (
                  <p className="mt-3 text-sm text-emerald-800/70">
                    Tempo médio de resolução: <strong>{analysis.demandStats.tempoMedioResolucaoHoras.toFixed(1)}h</strong>
                  </p>
                )}
              </Card>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-emerald-900">Pré-visualização</h3>
                <p className="text-sm text-emerald-800/70">Revise os dados antes de exportar o relatório.</p>
              </div>
              <button
                onClick={downloadPdf}
                className="rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
              >
                ⬇️ Gerar PDF
              </button>
            </div>

            <Card title="Participantes">
              {analysis.participants.length === 0 ? (
                <p className="text-sm text-emerald-800/70">Sem participantes identificados (apenas mídias foram enviadas).</p>
              ) : (
                <Table
                  head={["Nome", "Mensagens", "%", "Mídias", "Pediu", "Resolveu"]}
                  rows={analysis.participants.map((p) => [
                    p.name,
                    p.messageCount,
                    p.percentage.toFixed(1) + "%",
                    p.mediaSent,
                    p.demandsRequested,
                    p.demandsResolved,
                  ])}
                />
              )}
            </Card>

            <Card title={`Demandas (${analysis.demands.length})`}>
              {analysis.demands.length === 0 ? (
                <p className="text-sm text-emerald-800/70">Nenhuma demanda identificada.</p>
              ) : (
                <Table
                  head={["Data abertura", "Solicitante", "Mensagem", "Status", "Resolvido por", "Quando"]}
                  rows={analysis.demands.slice(0, 30).map((d) => [
                    d.date.toLocaleString("pt-BR"),
                    d.requester,
                    d.message.slice(0, 100) + (d.message.length > 100 ? "…" : ""),
                    <span
                      key="s"
                      className={
                        d.status === "resolvido"
                          ? "rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
                          : "rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                      }
                    >
                      {d.status}
                    </span>,
                    d.resolvedBy ?? "—",
                    d.resolvedAt ? d.resolvedAt.toLocaleString("pt-BR") : "—",
                  ])}
                />
              )}
            </Card>

            <Card title="Linha do tempo (resumo diário)">
              {analysis.dailySummary.length === 0 ? (
                <p className="text-sm text-emerald-800/70">Sem mensagens datadas.</p>
              ) : (
                <Table
                  head={["Data", "Mensagens", "Tópicos"]}
                  rows={analysis.dailySummary.slice(-20).map((d) => [
                    new Date(d.date).toLocaleDateString("pt-BR"),
                    d.count,
                    d.topics.join(", "),
                  ])}
                />
              )}
            </Card>

            <Card title="Mídias detectadas">
              <Table
                head={["Tipo", "Quantidade"]}
                rows={[
                  ["Imagens", analysis.mediaCount.image],
                  ["Vídeos", analysis.mediaCount.video],
                  ["Áudios", analysis.mediaCount.audio],
                  ["Documentos", analysis.mediaCount.document],
                  ["Figurinhas", analysis.mediaCount.sticker],
                  ["GIFs", analysis.mediaCount.gif],
                ]}
              />
            </Card>
          </div>
        )}
      </section>

      <footer className="border-t border-emerald-100 bg-white/60 py-6 text-center text-xs text-emerald-700/70">
        Os arquivos são processados localmente no seu navegador.
      </footer>
    </main>
  );
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-emerald-100 bg-white px-3 py-1.5">
      <span>{label}</span>
      <span className="font-semibold text-emerald-900">{value}</span>
    </div>
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

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-emerald-100 text-emerald-800">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-emerald-50 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="py-2 pr-4 text-emerald-900/90">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Recursively walk a DataTransferItem entry tree
async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej),
    );
    out.push(file);
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const readAll = async (): Promise<FileSystemEntry[]> => {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
        reader.readEntries(res, rej),
      );
      if (batch.length === 0) return [];
      const rest = await readAll();
      return [...batch, ...rest];
    };
    const entries = await readAll();
    for (const e of entries) await walkEntry(e, out);
  }
}
