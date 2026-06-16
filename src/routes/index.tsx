import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { analyze, parseWhatsApp, type Analysis } from "@/lib/whatsapp-parser";
import { generatePdf } from "@/lib/pdf-report";

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

function Index() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    setError(null);
    setAnalysis(null);
    if (!files || files.length === 0) return;
    // Pick the first .txt found (supports single file or folder upload)
    const txt = Array.from(files).find((f) => f.name.toLowerCase().endsWith(".txt"));
    if (!txt) {
      setError("Nenhum arquivo .txt encontrado. Exporte a conversa do WhatsApp e selecione o .txt.");
      return;
    }
    setFileName(txt.name);
    const text = await txt.text();
    setRawText(text);
  }

  function runAnalysis() {
    if (!rawText) return;
    setLoading(true);
    setError(null);
    try {
      const msgs = parseWhatsApp(rawText);
      if (msgs.length === 0) {
        setError("Não foi possível identificar mensagens. Verifique se é uma exportação válida do WhatsApp.");
        setAnalysis(null);
      } else {
        setAnalysis(analyze(msgs));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao analisar.");
    } finally {
      setLoading(false);
    }
  }

  function downloadPdf() {
    if (!analysis || !fileName) return;
    const doc = generatePdf(analysis, fileName);
    doc.save(`relatorio-whatsapp-${Date.now()}.pdf`);
  }

  const stats = useMemo(() => {
    if (!analysis) return null;
    return [
      { label: "Mensagens", value: analysis.totalMessages },
      { label: "Participantes", value: analysis.participants.length },
      { label: "Demandas", value: analysis.demands.length },
      {
        label: "Resolvidas",
        value: analysis.demands.filter((d) => d.status === "resolvido").length,
      },
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
              <h1 className="text-base font-semibold leading-tight text-emerald-900">
                Análise de Conversa WhatsApp
              </h1>
              <p className="text-xs text-emerald-700/70">Relatório profissional em PDF</p>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-emerald-100 bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-emerald-900">
            Envie a exportação do WhatsApp
          </h2>
          <p className="mt-2 text-sm text-emerald-800/70">
            Selecione o arquivo <code className="rounded bg-emerald-50 px-1.5 py-0.5">.txt</code>{" "}
            exportado, ou a pasta completa (o .txt será detectado automaticamente).
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-6 py-10 text-center transition hover:bg-emerald-50">
              <span className="text-3xl">📄</span>
              <span className="mt-2 font-medium text-emerald-900">Arquivo único</span>
              <span className="text-xs text-emerald-700/70">.txt da conversa</span>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 px-6 py-10 text-center transition hover:bg-emerald-50">
              <span className="text-3xl">📁</span>
              <span className="mt-2 font-medium text-emerald-900">Pasta completa</span>
              <span className="text-xs text-emerald-700/70">extração inteira do WhatsApp</span>
              <input
                type="file"
                /* @ts-expect-error non-standard */
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
          </div>

          {fileName && (
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
              <span className="text-sm font-medium text-emerald-900">📎 {fileName}</span>
              <button
                onClick={runAnalysis}
                disabled={loading}
                className="ml-auto rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-50"
              >
                {loading ? "Analisando…" : "Analisar conversa"}
              </button>
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {stats!.map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-emerald-100 bg-white p-5 shadow-sm"
                >
                  <p className="text-xs uppercase tracking-wide text-emerald-700/70">
                    {s.label}
                  </p>
                  <p className="mt-1 text-3xl font-bold text-emerald-900">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-bold text-emerald-900">Pré-visualização</h3>
                <p className="text-sm text-emerald-800/70">
                  Revise os dados antes de exportar o relatório.
                </p>
              </div>
              <button
                onClick={downloadPdf}
                className="rounded-md bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800"
              >
                ⬇️ Gerar PDF
              </button>
            </div>

            <Card title="Participantes">
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
            </Card>

            <Card title={`Demandas (${analysis.demands.length})`}>
              {analysis.demands.length === 0 ? (
                <p className="text-sm text-emerald-800/70">Nenhuma demanda identificada.</p>
              ) : (
                <Table
                  head={["Data", "Solicitante", "Mensagem", "Status", "Resolvido por"]}
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
                  ])}
                />
              )}
            </Card>

            <Card title="Linha do tempo (resumo diário)">
              <Table
                head={["Data", "Mensagens", "Tópicos"]}
                rows={analysis.dailySummary.slice(-20).map((d) => [
                  new Date(d.date).toLocaleDateString("pt-BR"),
                  d.count,
                  d.topics.join(", "),
                ])}
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
