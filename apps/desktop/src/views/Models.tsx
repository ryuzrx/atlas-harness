import React, { useEffect, useRef, useState } from "react";
import { Download, Play, Square, Zap, MoreHorizontal, Check, Plus } from "lucide-react";
import { api, bytes, Model, Provider, subscribe, useApi } from "../api";
import { Button, Card, cx, Empty, Field, Input, Menu, Modal, PageHeader, SectionTitle, Segmented, Select, useAction } from "../components/ui";
import { CATEGORIES, ConnectForm, isConnected, Preset, ProviderIcon, ProviderTile, resolveProviderIconKey } from "../components/Endpoints";
import { ModelsList } from "../components/ModelsList";
import { ModelLibrary } from "../components/ModelLibrary";
import { useStore } from "../store";

function EndpointRow({ p, count, reload, ollama }: { p: Provider; count: number; reload: () => void; ollama?: React.ReactNode }) {
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [toolMode, setToolMode] = useState(p.config.tool_mode || "");
  const [envAuth, setEnvAuth] = useState(!!p.config.use_env_auth);
  const [key, setKey] = useState("");
  const status = !p.enabled ? "disabled" : p.status;
  const label = { connected: "Connected", failed: "Unavailable", unavailable: "Unavailable", unknown: "Not checked", disabled: "Disabled" }[status] || status;
  const dot = status === "connected" ? "bg-ok" : status === "failed" || status === "unavailable" ? "bg-bad" : "bg-ink-3";
  return (
    <div className="px-4 py-3.5 anim-rise">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <ProviderTile label={p.name} providerKey={resolveProviderIconKey({ presetId: p.config?.preset_id, kind: p.kind, baseUrl: p.base_url, name: p.name })} />
        <div className="min-w-[160px] flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-ink truncate">{p.name}</span>
            <span className="shrink-0 text-2xs text-ink-3 border border-line rounded-sm px-1.5 leading-[18px]">{p.kind_label}</span>
          </div>
          <div className="text-xs text-ink-3 font-mono truncate mt-0.5">{p.base_url || (p.agentic ? (p.config.binary || "CLI found automatically") : "")}</div>
        </div>
        <div className="hidden min-[900px]:flex flex-col items-end w-[120px] shrink-0 text-xs tnum">
          <span className="text-ink">{count} model{count === 1 ? "" : "s"}</span>
          <span className="text-ink-3">{p.stats?.last_latency_ms ? `${Math.round(p.stats.last_latency_ms)} ms last` : `${p.stats?.total_requests ?? 0} requests`}</span>
        </div>
        <span className="ml-auto w-[104px] shrink-0 flex items-center gap-1.5 text-xs text-ink-2"><span className={cx("h-1.5 w-1.5 rounded-full", dot)} />{label}</span>
        {ollama}
        <Button size="sm" busy={busy === "t"} onClick={() => run("t", () => api(`/providers/${p.id}/test`, { body: {} })).then(reload)}>Test</Button>
        <Menu trigger={<button aria-label={`${p.name} actions`} className="h-8 w-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-hover"><MoreHorizontal size={16} /></button>}
          items={[
            { label: "Configure…", onClick: () => setEditing(true) },
            { label: p.enabled ? "Disable" : "Enable", onClick: () => run("e", () => api(`/providers/${p.id}`, { method: "PATCH", body: { enabled: p.enabled ? 0 : 1 } })).then(reload) },
            { label: "Remove", danger: true, onClick: () => confirm(`Remove ${p.name}? Its key is deleted from the Keychain and agents using it become unassigned.`) && run("d", () => api(`/providers/${p.id}`, { method: "DELETE" }), "Removed").then(reload) },
          ]} />
      </div>
      {p.last_error && p.enabled ? <div className="mt-2 ml-[50px] text-xs text-ink-2 selectable break-words" title={p.last_error}>{friendlyError(p)}</div> : null}
      <Modal open={editing} onClose={() => setEditing(false)} title={`Configure ${p.name}`}
        footer={<><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" busy={busy === "s"} onClick={() => run("s", () => api(`/providers/${p.id}`, { method: "PATCH", body: { config: { tool_mode: toolMode || null, use_env_auth: envAuth }, ...(key ? { api_key: key } : {}) } }), "Saved").then(() => { setEditing(false); reload(); })}>Save</Button></>}>
        <div className="space-y-3.5">
          <section>
            <h3 className="text-2xs font-medium text-ink-2 mb-1">Identity</h3>
            <dl className="text-xs space-y-1">
              <div className="flex justify-between gap-3"><dt className="text-ink-3">Name</dt><dd className="text-ink truncate">{p.name}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-3">Runtime</dt><dd className="text-ink truncate">{p.kind_label}</dd></div>
              {p.base_url && <div className="flex justify-between gap-3"><dt className="text-ink-3">Endpoint</dt><dd className="text-ink font-mono truncate selectable" title={p.base_url}>{p.base_url}</dd></div>}
            </dl>
          </section>
          <h3 className="text-2xs font-medium text-ink-2 -mb-1.5 pt-1">Runtime</h3>
          {!p.agentic && <Field label="Tool protocol" hint="Auto uses native tool calling only where it was verified for the model. The text protocol works with any model, including abliterated builds.">
            <Select value={toolMode} onChange={(e) => setToolMode(e.target.value)}><option value="">Auto (verified capabilities)</option><option value="native">Always native tool calling</option><option value="text">Always text protocol</option></Select></Field>}
          {p.agentic && <Field label="Authentication" hint="By default the CLI uses its own sign-in; API keys inherited from the environment are removed.">
            <Select value={envAuth ? "env" : "cli"} onChange={(e) => setEnvAuth(e.target.value === "env")}>
              <option value="cli">CLI sign-in (subscription)</option><option value="env">API key from environment</option></Select></Field>}
          {p.kind !== "ollama" && !p.agentic && <Field label="Replace API key" hint="Leave empty to keep the current key."><Input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" /></Field>}
        </div>
      </Modal>
    </div>
  );
}

function Gallery({ presets, providers, onPick }: { presets: Preset[]; providers: Provider[]; onPick: (p: Preset) => void }) {
  const [cat, setCat] = useState<"all" | Preset["category"]>("all");
  const [q, setQ] = useState("");
  const shown = presets.filter((p) => (cat === "all" || p.category === cat) && (!q || (p.label + p.note).toLowerCase().includes(q.toLowerCase())));
  const filters = [{ id: "all" as const, label: `All ${presets.length}` }, ...CATEGORIES];
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-base font-semibold text-ink">Add an endpoint</h2>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search providers" aria-label="Search providers" className="!w-[220px] !h-8" />
      </div>
      <nav aria-label="Endpoint categories" className="flex flex-wrap gap-x-4 border-b border-line mb-3">
        {filters.map((filter) => (
          <button key={filter.id} onClick={() => setCat(filter.id)} aria-current={cat === filter.id ? "true" : undefined}
            className={cx("h-9 border-b text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              cat === filter.id ? "border-[var(--accent)] text-ink" : "border-transparent text-ink-2 hover:text-ink")}>{filter.label}</button>))}
      </nav>
      <div className="grid grid-cols-3 gap-3 max-[1180px]:grid-cols-2 max-[760px]:grid-cols-1">
        {shown.map((p) => {
          const on = isConnected(p, providers);
          return (
            <button key={p.id} onClick={() => onPick(p)}
              className="lift group text-left flex items-start gap-3 p-3.5 rounded-lg border border-line bg-surface hover:bg-hover">
              <ProviderTile label={p.label} providerKey={p.id} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="text-base font-medium text-ink truncate">{p.label}</span>
                  {on && <span className="shrink-0 text-2xs text-ink-2 flex items-center gap-0.5"><Check size={12} />Added</span>}</span>
                <span className="block text-xs text-ink-3 mt-0.5 line-clamp-2">{p.note}</span>
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <div className="col-span-full py-8 text-center text-sm text-ink-3">No providers match “{q}”.</div>}
      </div>
    </section>
  );
}

function OllamaControls({ reload }: { reload: () => void }) {
  const { data: s, reload: r2 } = useApi<any>("/ollama", ["provider"]);
  const { busy, run } = useAction();
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  useEffect(() => subscribe((m) => { if (m.kind === "install" && m.target === "ollama") setProgress(m); }), []);
  if (!s) return null;
  const refresh = () => { r2(); reload(); };
  if (!s.binary) return (
    <span className="flex items-center gap-2">
      {progress && busy === "i" && <span className="text-xs text-ink-3 tnum">{bytes(progress.downloaded)} / {bytes(progress.total)}</span>}
      <Button size="sm" icon={<Download size={13} />} busy={busy === "i"} onClick={() => run("i", () => api("/ollama/install", { body: {} }), "Ollama installed").then(refresh)}>Install</Button>
    </span>);
  if (!s.running) return <Button size="sm" variant="primary" icon={<Play size={12} />} busy={busy === "s"} onClick={() => run("s", () => api("/ollama/start", { body: {} })).then((r: any) => { if (r && !r.ok) alert(r.error); refresh(); })}>Start</Button>;
  if (s.managed) return <Button size="sm" icon={<Square size={11} />} busy={busy === "x"} onClick={() => run("x", () => api("/ollama/stop", { body: {} })).then(refresh)}>Stop</Button>;
  return null;
}

function TestModal({ model, onClose }: { model: Model | null; onClose: () => void }) {
  const [prompt, setPrompt] = useState("Write a Python function that reverses a string. Reply with code only.");
  const [res, setRes] = useState<any>(null);
  const { busy, run } = useAction();
  useEffect(() => setRes(null), [model?.name]);
  if (!model) return null;
  return (
    <Modal open={!!model} onClose={onClose} title={`Test ${model.name}`} width={620}
      footer={<Button variant="primary" busy={busy === "t"} onClick={() => run("t", () => api(`/providers/${model.provider_id}/chat`, { body: { model: model.name, prompt } })).then(setRes)}>Send request</Button>}>
      <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      {res && <div className="mt-3"><div className="text-xs text-ink-2 tnum mb-1">{res.latency_ms} ms (measured){res.usage?.completion_tokens ? ` · ${res.usage.completion_tokens} output tokens` : ""}</div>
        <pre className="selectable p-3 rounded-md bg-surface-2 border border-line text-xs font-mono whitespace-pre-wrap max-h-[320px] overflow-auto">{res.text}</pre></div>}
    </Modal>
  );
}

/** "Meta, small and fast" under a card already labelled Meta reads as "Small and fast". */
function noteWithoutBrand(note: string, brand?: string) {
  const [head, ...rest] = note.split(", ");
  if (!rest.length || !brand || !brand.toLowerCase().includes(head.toLowerCase())) return note;
  const t = rest.join(", ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Turn a raw connection error into one plain sentence; the raw text stays in the tooltip. */
function friendlyError(p: { kind?: string; name: string; last_error?: string | null }) {
  const e = p.last_error || "";
  if (/ConnectError|not reachable|Connection refused|ECONNREFUSED/i.test(e)) return p.kind === "ollama" ? "Ollama isn't running. Install it, or open the Ollama app." : `Can't reach ${p.name}. Check that it's running.`;
  if (/401|403|unauthori|invalid.*key/i.test(e)) return "The API key was rejected. Check it and try again.";
  if (/timeout|timed out/i.test(e)) return `${p.name} took too long to answer.`;
  return e;
}

export function Models() {
  const { data: providers = [], reload } = useApi<Provider[]>("/providers", ["provider"]);
  const { data: models = [], loading, reload: reloadModels } = useApi<Model[]>("/models", ["model", "provider", "agent"]);
  const { data: meta } = useApi<any>("/meta");
  const { settings: appSettings } = useStore();
  const presets: Preset[] = meta?.provider_presets || [];
  const [showGallery, setShowGallery] = useState(false);
  const [connecting, setConnecting] = useState<Preset | null>(null);
  const [testing, setTesting] = useState<Model | null>(null);
  const initialScrollDone = useRef(false);
  const real = models.filter((m) => m.name);
  const failed = models.filter((m) => !m.name);
  const counts = (pid: string) => real.filter((m) => m.provider_id === pid).length;
  const refresh = () => { reload(); reloadModels(); };
  const scrollTo = (id: string) => {
    const target = document.getElementById(id);
    const scroller = target?.closest<HTMLElement>(".overflow-y-auto");
    if (!target || !scroller) return;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 16), behavior: "smooth" });
    localStorage.setItem("atlas_models_tab", id === "runtime-sources" ? "endpoints" : "models");
  };
  useEffect(() => {
    if (loading || !appSettings || initialScrollDone.current) return;
    initialScrollDone.current = true;
    const saved = appSettings?.["models.default_tab"];
    const last = localStorage.getItem("atlas_models_tab");
    const section = saved === "endpoints" ? "runtime-sources"
      : saved === "models" ? "installed-models"
        : last === "models" ? "installed-models" : null;
    if (section) requestAnimationFrame(() => scrollTo(section));
  }, [loading, appSettings?.["models.default_tab"]]);
  const addEndpoint = () => {
    setShowGallery(true);
    requestAnimationFrame(() => scrollTo("runtime-sources"));
  };
  return (
    <div className="max-w-[1200px] mx-auto space-y-8">
      <PageHeader title="Models" subtitle="Connect runtimes, find local models, and choose what Atlas can use."
        actions={<Button icon={<Plus size={14} />} onClick={addEndpoint}>Add endpoint</Button>} />
      <nav aria-label="Models page sections" className="-mt-5 flex flex-wrap gap-x-6 border-b border-line">
        <button type="button" onClick={() => scrollTo("runtime-sources")} className="h-9 inline-flex items-center text-xs text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">Runtime sources</button>
        <button type="button" onClick={() => scrollTo("model-library")} className="h-9 inline-flex items-center text-xs text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">Model library</button>
        <button type="button" onClick={() => scrollTo("installed-models")} className="h-9 inline-flex items-center text-xs text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">Available models</button>
      </nav>

      <section id="runtime-sources" className="scroll-mt-6">
        <SectionTitle action={providers.length > 0 && <span className="text-xs text-ink-3 tnum">{providers.length} source{providers.length === 1 ? "" : "s"}</span>}>Runtime sources</SectionTitle>
        {providers.length === 0 ? (
          <Card><Empty title="No runtime sources yet" body="Add Ollama for local models or connect a provider that already hosts models."
            action={<Button icon={<Plus size={13} />} onClick={() => setShowGallery(true)}>Browse endpoints</Button>} /></Card>
        ) : (
          <div className="rounded-lg border border-line bg-surface divide-y divide-[var(--border)]">
            {providers.map((p) => <EndpointRow key={p.id} p={p} count={counts(p.id)} reload={refresh} ollama={p.kind === "ollama" ? <OllamaControls reload={refresh} /> : undefined} />)}
          </div>) }
        {presets.length > 0 && <div className="mt-3">
          <button onClick={() => setShowGallery((shown) => !shown)} aria-expanded={showGallery}
            className="h-9 px-2 -ml-2 rounded-md inline-flex items-center gap-2 text-sm text-ink-2 hover:text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            <Plus size={14} />{showGallery ? "Close endpoint list" : "Browse available endpoints"}
          </button>
          {showGallery && <div id="endpoint-gallery" className="mt-3"><Gallery presets={presets} providers={providers} onPick={setConnecting} /></div>}
        </div>}
      </section>

      <ModelLibrary providers={providers} installed={new Set(real.filter((m) => m.provider_kind === "ollama").map((m) => m.name!))} onRefresh={reloadModels} />

      <section id="installed-models" className="scroll-mt-6">
        <SectionTitle action={<span className="text-xs text-ink-3 tnum">{real.length} available</span>}>Available models</SectionTitle>
        <ModelsList models={real} failed={failed} providers={providers} loading={loading} onTest={setTesting} reload={refresh} onGoEndpoints={() => scrollTo("runtime-sources")} />
      </section>

      <Modal open={!!connecting} onClose={() => setConnecting(null)} title={<span className="inline-flex items-center gap-2"><ProviderIcon providerKey={connecting?.id} label={connecting?.label} size={18} />Connect endpoint</span>} width={560}>
        {connecting && <ConnectForm preset={connecting} onConnected={() => { setConnecting(null); refresh(); }} />}
      </Modal>
      <TestModal model={testing} onClose={() => setTesting(null)} />
    </div>
  );
}
