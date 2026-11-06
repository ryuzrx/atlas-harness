import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Search, Sparkles } from "lucide-react";
import { api, bytes, Provider, subscribe, useApi } from "../api";
import { Button, cx, Empty, Field, Input, Meter, Modal, SectionTitle, Select, useAction } from "./ui";
import { ModelFolder } from "./ModelFolder";
import { BrandMark, brandFor } from "./Brand";
import { ModelFinder } from "./ModelFinder";

interface LibraryModel { name: string; group: string; size: string; note: string }
interface Pull { pull_id: string; provider_id: string; model: string; status: string; completed?: number; total?: number; error?: string }

/** Inline Ollama model catalog with the existing recommendation and download flows. */
export function ModelLibrary({ providers, installed, onRefresh }: {
  providers: Provider[];
  installed: Set<string>;
  onRefresh: () => void;
}) {
  const { data: meta } = useApi<any>("/meta");
  const { data: activePulls = [] } = useApi<Pull[]>("/models/pulls", ["pull"]);
  const library: LibraryModel[] = meta?.ollama_library || [];
  const ollamas = providers.filter((p) => p.kind === "ollama");
  const [providerId, setProviderId] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [finding, setFinding] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [folderConfirmed, setFolderConfirmed] = useState(false);
  const [status, setStatus] = useState<Record<string, any>>({});
  const refreshRef = useRef(onRefresh);
  const { run } = useAction();
  const downloading = Object.values(status).some((s: any) => s && !s.error && !["success", "cancelled"].includes(s.status));

  useEffect(() => { refreshRef.current = onRefresh; }, [onRefresh]);
  useEffect(() => { setProviderId((current) => ollamas.some((p) => p.id === current) ? current : ollamas[0]?.id || ""); }, [ollamas.map((p) => p.id).join("\0")]);
  useEffect(() => {
    if (!activePulls.length) return;
    setStatus((current) => activePulls.reduce((next, pull) => ({ ...next, [pull.model]: pull }), current));
  }, [activePulls]);
  useEffect(() => {
    return subscribe((message) => {
      if (message.kind !== "pull") return;
      setStatus((current) => ({ ...current, [message.model]: message }));
      if (message.status === "success") refreshRef.current();
    });
  }, []);
  const pull = (model: string) => {
    if (!providerId || !model) return;
    setStatus((current) => ({ ...current, [model]: { status: "starting" } }));
    void run(`pull-${model}`, () => api("/models/pull", { body: { provider_id: providerId, model } }))
      .then((result) => {
        if (!result) setStatus((current) => ({ ...current, [model]: { status: "failed", error: "Couldn't start the download. Try again." } }));
      });
  };
  const requestDownload = (model: string) => {
    if (folderConfirmed) pull(model);
    else setAsking(model);
  };
  const isInstalled = (model: string) => installed.has(model) || status[model]?.status === "success";
  const groups = useMemo(() => ["All", ...Array.from(new Set(library.map((m) => m.group))), "Installed"], [library]);
  const countOf = (group: string) => group === "All" ? library.length
    : group === "Installed" ? library.filter((m) => isInstalled(m.name)).length
      : library.filter((m) => m.group === group).length;
  const shown = library.filter((m) => (category === "All" || (category === "Installed" ? isInstalled(m.name) : m.group === category)) &&
    (!query || `${m.name} ${m.note} ${brandFor(m.name)?.label || ""}`.toLowerCase().includes(query.toLowerCase())));

  return (
    <section id="model-library" className="scroll-mt-6">
      <SectionTitle>Model library</SectionTitle>
      <div className="rounded-lg border border-line bg-surface overflow-hidden">
        {!ollamas.length ? (
          <Empty title="Ollama isn't connected" body="Connect or start Ollama in Runtime sources to browse and download local models." />
        ) : (
          <>
            <div className="p-4 border-b border-line space-y-3">
              <ModelFolder disabled={downloading} />
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative min-w-[220px] flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${library.length} models or companies`} aria-label="Search local models"
                    className="w-full h-9 pl-9 pr-3 rounded-md bg-[var(--sunken)] border border-line text-sm text-ink placeholder:text-ink-3 outline-none focus:border-line-strong focus:ring-[3px] focus:ring-[var(--ring)]" />
                </div>
                <Button icon={<Sparkles size={14} />} onClick={() => setFinding(true)}>Find a model for this Mac</Button>
                {ollamas.length > 1 && <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="Download to Ollama endpoint" className="!w-[190px] !h-9">{ollamas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
              </div>
            </div>
            <nav aria-label="Local model categories" className="flex flex-wrap gap-x-4 px-4 border-b border-line">
              {groups.map((group) => (
                <button key={group} onClick={() => setCategory(group)} aria-current={category === group ? "true" : undefined}
                  className={cx("h-10 shrink-0 inline-flex items-center gap-2 border-b text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    category === group ? "border-[var(--accent)] text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
                  {group === "Abliterated" ? "Uncensored" : group}<span className="text-xs text-ink-3 tnum">{countOf(group)}</span>
                </button>))}
            </nav>
            {category === "Abliterated" && <p className="px-4 pt-3 text-xs text-ink-3">Community builds with safety tuning removed.</p>}
            <div className="max-h-[420px] overflow-y-auto">
              {shown.length === 0 ? <div className="px-4 py-10 text-center text-sm text-ink-3">{query ? `No models match “${query}”.` : "Nothing here yet."}</div> : (
                <ul className="divide-y divide-[var(--border)]">
                  {shown.map((model) => {
                    const current = status[model.name];
                    const present = isInstalled(model.name);
                    const active = current && !current.error && !["success", "cancelled"].includes(current.status);
                    const [family, tag] = model.name.split("/").pop()!.split(":");
                    const brand = brandFor(model.name);
                    return (
                      <li key={model.name} className="px-4 py-3 hover:bg-hover/60">
                        <div className="flex items-center gap-3">
                          <BrandMark brand={brand} label={family} size={32} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-ink truncate" title={model.name}>{family}</span>
                              {tag && tag !== "latest" && <span className="text-2xs text-ink-2 truncate">{tag}</span>}
                            </div>
                            <div className="text-xs text-ink-3 truncate">{brand?.label || model.group} · {noteWithoutBrand(model.note, brand?.label)}</div>
                          </div>
                          <span className="hidden min-[820px]:block w-20 text-right text-xs text-ink-2 tnum">{model.size}</span>
                          {present ? <span className="w-[92px] shrink-0 flex justify-end items-center gap-1.5 text-xs text-ink-2"><Check size={13} />Installed</span>
                          : active ? <span className="w-[92px] shrink-0 text-right text-xs text-ink-2 truncate" title={current.error}>{current.total ? `${bytes(current.completed || 0)} / ${bytes(current.total)}` : current.status}</span>
                            : current?.error ? <div className="shrink-0 flex items-center gap-2"><span className="max-w-[170px] text-right text-xs text-bad truncate" title={current.error}>{current.error}</span><Button size="sm" onClick={() => requestDownload(model.name)}>Retry</Button></div>
                              : <Button size="sm" icon={<Download size={13} />} onClick={() => requestDownload(model.name)}>Download</Button>}
                        </div>
                        {active && current.total && <div className="mt-2 ml-[44px]"><Meter value={current.completed || 0} max={current.total} tone="bg-ink" /></div>}
                      </li>);
                  })}
                </ul>)}
            </div>
            <div className="px-4 py-3 border-t border-line">
              <Field label="Download another model" hint="Ollama tag, community model (user/model:tag), or Hugging Face GGUF (hf.co/user/repo:quant).">
                <div className="flex gap-2"><Input value={customModel} onChange={(e) => setCustomModel(e.target.value.trim())} placeholder="e.g. hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M" />
                  <Button onClick={() => requestDownload(customModel)} disabled={!customModel}>Download</Button></div>
              </Field>
              {customModel && status[customModel] && <div className="mt-2 text-sm"><span className={status[customModel].error ? "text-bad" : "text-ink-2"}>{status[customModel].error || status[customModel].status}</span>
                {status[customModel].total && <div className="mt-1.5"><Meter value={status[customModel].completed || 0} max={status[customModel].total} tone="bg-ink" /></div>}</div>}
            </div>
          </>
        )}
      </div>
      <ModelFinder open={finding} onClose={() => setFinding(false)} lib={library} installed={installed} onPick={requestDownload} />
      <Modal open={!!asking} onClose={() => setAsking(null)} title="Choose where to save this model" width={520}
        footer={<><Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button><Button variant="primary" icon={<Download size={14} />} onClick={() => { const model = asking!; setFolderConfirmed(true); setAsking(null); pull(model); }}>Download here</Button></>}>
        <p className="text-sm text-ink-2 mb-3">Atlas will download <span className="font-mono text-ink">{asking}</span> into this folder. You can choose a different location first.</p>
        <ModelFolder variant="row" disabled={downloading} className="!px-0 !py-0" />
      </Modal>
    </section>
  );
}

/** Avoid repeating a provider name when the catalog note starts with it. */
function noteWithoutBrand(note: string, brand?: string) {
  const [head, ...rest] = note.split(", ");
  if (!rest.length || !brand || !brand.toLowerCase().includes(head.toLowerCase())) return note;
  const text = rest.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
