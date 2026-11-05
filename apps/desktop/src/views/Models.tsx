import React, { useEffect, useState } from "react";
import { Download, Play, Square, RefreshCw, Zap, FlaskConical, Trash2, PowerOff, MoreHorizontal, Check, Search, Sparkles } from "lucide-react";
import { api, bytes, Model, Provider, subscribe, useApi } from "../api";
import { Badge, Button, Card, cx, Empty, Field, Input, Menu, Meter, Modal, PageHeader, Segmented, Select, StatusBadge, useAction } from "../components/ui";
import { CATEGORIES, ConnectForm, isConnected, Preset, ProviderIcon, ProviderTile, resolveProviderIconKey } from "../components/Endpoints";
import { useStore } from "../store";
import { ModelFolder } from "../components/ModelFolder";
import { BrandMark, brandFor } from "../components/Brand";
import { ModelFinder } from "../components/ModelFinder";
import { ModelsList } from "../components/ModelsList";

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
  return (
    <section>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h2 className="text-lg font-semibold text-ink">Add an endpoint</h2>
        <div className="flex-1" />
        <Segmented value={cat} onChange={setCat} options={[{ id: "all", label: `All ${presets.length}` }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))]} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search providers" aria-label="Search providers" className="!w-[220px] !h-8" />
      </div>
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

function PullModal({ open, onClose, providers, installed }: { open: boolean; onClose: () => void; providers: Provider[]; installed: Set<string> }) {
  const { data: meta } = useApi<any>(open ? "/meta" : null);
  const lib: { name: string; group: string; size: string; note: string }[] = meta?.ollama_library || [];
  const ollamas = providers.filter((p) => p.kind === "ollama");
  const [pid, setPid] = useState(""); const [name, setName] = useState(""); const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [finding, setFinding] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);   // model waiting for a "where should it go?" answer
  const [placed, setPlaced] = useState(false);                // folder confirmed for this visit
  const [status, setStatus] = useState<Record<string, any>>({});
  const downloading = Object.values(status).some((st: any) => st && !st.error && st.status !== "success");
  const { run } = useAction();
  useEffect(() => { setPid(ollamas[0]?.id || ""); }, [open, ollamas.length]);
  useEffect(() => { if (!open) { setPlaced(false); setAsking(null); } }, [open]);
  useEffect(() => subscribe((m) => { if (m.kind === "pull") setStatus((s) => ({ ...s, [m.model]: m })); }), []);
  const pull = (model: string) => {
    if (!pid || !model) return;
    setStatus((s) => ({ ...s, [model]: { status: "starting" } }));
    run("p" + model, () => api("/models/pull", { body: { provider_id: pid, model } }));
  };
  const request = (model: string) => (placed ? pull(model) : setAsking(model));
  const isInstalled = (m: string) => installed.has(m) || status[m]?.status === "success";
  const groups = ["All", ...Array.from(new Set(lib.map((m) => m.group))), "Installed"];
  const countOf = (g: string) => (g === "All" ? lib.length : g === "Installed" ? lib.filter((m) => isInstalled(m.name)).length : lib.filter((m) => m.group === g).length);
  const shown = lib.filter((m) => (cat === "All" || (cat === "Installed" ? isInstalled(m.name) : m.group === cat)) &&
    (!q || (m.name + " " + m.note + " " + (brandFor(m.name)?.label || "")).toLowerCase().includes(q.toLowerCase())));

  const Card = ({ m }: { m: { name: string; group: string; size: string; note: string } }) => {
    const st = status[m.name]; const has = isInstalled(m.name);
    const active = st && !st.error && st.status !== "success";
    const base = m.name.split("/").pop()!; const [family, tag] = base.split(":");
    const brand = brandFor(m.name);
    return (
      <div className="rounded-lg border border-line bg-surface p-4 flex flex-col gap-3 hover:border-line-strong transition-colors">
        <div className="flex items-start gap-3">
          <BrandMark brand={brand} label={family} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0"><span className="text-base font-medium text-ink truncate" title={m.name}>{family}</span>
              {tag && tag !== "latest" && <span className="shrink-0 text-2xs text-ink-2 border border-line rounded-sm px-1.5 leading-[18px]">{tag}</span>}</div>
            <div className="text-xs text-ink-3 truncate">{brand?.label || m.group}</div>
          </div>
        </div>
        <p className="text-sm leading-[18px] text-ink-2 line-clamp-2 min-h-[36px]">{noteWithoutBrand(m.note, brandFor(m.name)?.label)}</p>
        {active || st?.error ? (
          <div>
            <div className={cx("text-xs mb-1.5", st.error ? "text-bad" : "text-ink-2")}>{st.error || (st.total ? `${bytes(st.completed || 0)} of ${bytes(st.total)}` : st.status)}</div>
            {st.total ? <Meter value={st.completed || 0} max={st.total} tone="bg-ink" /> : null}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-3 tnum">{m.size}</span>
            {has ? <span className="text-sm text-ink-2 flex items-center gap-1"><Check size={14} />Installed</span>
              : <Button size="sm" icon={<Download size={13} />} onClick={() => request(m.name)}>Download</Button>}
          </div>)}
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Download models" width={1240} footer={<Button variant="ghost" onClick={onClose}>Done</Button>}>
      {!ollamas.length ? <Empty title="Ollama isn't connected" body="Connect or start Ollama on the Models page to download local models." /> : (
        <div className="space-y-4">
          <ModelFolder disabled={downloading} />
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${lib.length} models or companies`} aria-label="Search models"
                className="w-full h-10 pl-9 pr-3 rounded-lg bg-hover border border-line text-base text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" />
            </div>
            <Button className="!h-10" icon={<Sparkles size={14} />} onClick={() => setFinding(true)}>Find the best for me</Button>
            {ollamas.length > 1 && <Select value={pid} onChange={(e) => setPid(e.target.value)} className="!w-48 !h-10">{ollamas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
          </div>
          <div className="grid grid-cols-[200px_1fr] gap-6 max-[900px]:grid-cols-1">
            <nav aria-label="Model categories" className="flex flex-col gap-0.5 max-[900px]:flex-row max-[900px]:flex-wrap">
              {groups.map((g) => (
                <button key={g} onClick={() => setCat(g)} aria-current={cat === g ? "true" : undefined}
                  className={cx("h-9 px-3 rounded-md flex items-center justify-between text-base text-left", cat === g ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover hover:text-ink")}>
                  <span className="truncate">{g === "Abliterated" ? "Uncensored" : g}</span><span className="text-xs text-ink-3 tnum ml-2">{countOf(g)}</span></button>))}
            </nav>
            <div className="min-w-0">
              {cat === "Abliterated" && <p className="mb-3 text-sm text-ink-3">Community builds with safety tuning removed.</p>}
              <div className="max-h-[62vh] overflow-y-auto pr-1">
                {shown.length === 0 ? <div className="py-16 text-center text-sm text-ink-3">{q ? `No models match “${q}”.` : "Nothing here yet."}</div> : (
                  <div className="grid grid-cols-3 gap-3.5 max-[1250px]:grid-cols-2 max-[900px]:grid-cols-1">{shown.map((m) => <Card key={m.name} m={m} />)}</div>)}
              </div>
            </div>
          </div>
          <Field label="Any other model" hint="Any Ollama library tag, a community model (user/model:tag), or a Hugging Face GGUF (hf.co/user/repo:quant).">
            <div className="flex gap-2"><Input value={name} onChange={(e) => setName(e.target.value.trim())} placeholder="e.g. hf.co/bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M" />
              <Button onClick={() => request(name)} disabled={!name}>Download</Button></div>
          </Field>
          {name && status[name] && (
            <div className="text-sm"><span className={status[name].error ? "text-bad" : "text-ink-2"}>{status[name].error || status[name].status}</span>
              {status[name].total ? <div className="mt-1.5"><Meter value={status[name].completed || 0} max={status[name].total} tone="bg-ink" /></div> : null}</div>)}
        </div>
      )}
      <ModelFinder open={finding} onClose={() => setFinding(false)} lib={lib} installed={installed} onPick={request} />
      <Modal open={!!asking} onClose={() => setAsking(null)} title="Where should it be saved?" width={520}
        footer={<><Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button><Button variant="primary" icon={<Download size={14} />} onClick={() => { const m = asking!; setPlaced(true); setAsking(null); pull(m); }}>Download here</Button></>}>
        <p className="text-base text-ink-2 mb-3">Atlas will download <span className="font-mono text-ink">{asking}</span> into this folder. You can pick a different drive or folder first.</p>
        <ModelFolder variant="row" className="!px-0 !py-0" />
      </Modal>
    </Modal>
  );
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

function cap(v: any) { return v === true ? <Badge tone="ok">yes</Badge> : v === false ? <Badge tone="muted">no</Badge> : <Badge tone="muted">unverified</Badge>; }

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
  const presets: Preset[] = meta?.provider_presets || [];
  const { settings: appSettings } = useStore();
  const [tab, setTab] = useState<"endpoints" | "models">(() => { const d = appSettings?.["models.default_tab"]; return d === "endpoints" || d === "models" ? d : (localStorage.getItem("atlas_models_tab") as any) || "endpoints"; });
  const [connecting, setConnecting] = useState<Preset | null>(null);
  const [pulling, setPulling] = useState(false);
  const [testing, setTesting] = useState<Model | null>(null);
  const [q, setQ] = useState("");
  const { busy, run } = useAction();
  const real = models.filter((m) => m.name);
  const failed = models.filter((m) => !m.name);
  const counts = (pid: string) => real.filter((m) => m.provider_id === pid).length;
  const refresh = () => { reload(); reloadModels(); };
  const setT = (t: "endpoints" | "models") => { setTab(t); localStorage.setItem("atlas_models_tab", t); };
  const shownModels = real.filter((m) => !q || (m.name + " " + m.provider_name).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="max-w-[1200px] mx-auto">
      <PageHeader title="Models" subtitle="Connect endpoints on this Mac, in the cloud with your own keys, or through agent CLIs."
        actions={<>
          <Segmented value={tab} onChange={setT} options={[{ id: "endpoints", label: `Endpoints ${providers.length}` }, { id: "models", label: `Models ${real.length}` }]} />
          {providers.some((p) => p.kind === "ollama") && <Button icon={<Download size={13} />} onClick={() => setPulling(true)}>Download models</Button>}
        </>} />
      <ModelFolder className="mb-6" />

      {tab === "endpoints" ? (
        <div key="e" className="fade-in space-y-9">
          <section>
            <h2 className="text-lg font-semibold text-ink mb-3">Connected</h2>
            {providers.length === 0 ? (
              <Card><Empty title="No endpoints yet" body="Pick one below. Ollama runs models privately on this Mac; cloud APIs use your own key." /></Card>
            ) : (
              <div className="rounded-lg border border-line bg-surface divide-y divide-[var(--border)]">
                {providers.map((p) => <EndpointRow key={p.id} p={p} count={counts(p.id)} reload={refresh} ollama={p.kind === "ollama" ? <OllamaControls reload={refresh} /> : undefined} />)}
              </div>
            )}
          </section>
          {presets.length > 0 && <Gallery presets={presets} providers={providers} onPick={setConnecting} />}
        </div>
      ) : (
        <ModelsList key="m" models={real} failed={failed} providers={providers} loading={loading} onTest={setTesting} reload={refresh} onGoEndpoints={() => setT("endpoints")} />
      )}

      <Modal open={!!connecting} onClose={() => setConnecting(null)} title={<span className="inline-flex items-center gap-2"><ProviderIcon providerKey={connecting?.id} label={connecting?.label} size={18} />Connect endpoint</span>} width={560}>
        {connecting && <ConnectForm preset={connecting} onConnected={() => { setConnecting(null); refresh(); }} />}
      </Modal>
      <PullModal open={pulling} onClose={() => { setPulling(false); reloadModels(); }} providers={providers}
        installed={new Set(real.filter((m) => providers.find((p) => p.id === m.provider_id)?.kind === "ollama").map((m) => m.name!))} />
      <TestModal model={testing} onClose={() => setTesting(null)} />
    </div>
  );
}
