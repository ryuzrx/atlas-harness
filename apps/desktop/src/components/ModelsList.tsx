import React, { useMemo, useState } from "react";
import { ChevronRight, FlaskConical, PowerOff, RefreshCw, Search, Trash2, Zap, AlertCircle } from "lucide-react";
import { api, bytes, Model, Provider } from "../api";
import { useStore } from "../store";
import { Button, cx, Empty, Select, useAction } from "./ui";
const STATUS_DOT = (s: string) => (s === "loaded" || s === "processing" ? "bg-ok" : s === "unavailable" || s === "failed" ? "bg-bad" : "bg-ink-3");
import { resolveProviderIconKey } from "./Endpoints";
import { BrandMark } from "./Brand";

const ctxLabel = (n?: number) => (n ? (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1024)}K`) : null);
const stateLabel = (s: string) => ({ loaded: "Loaded", processing: "Running", installed: "Installed", available: "Available", unavailable: "Unavailable" } as Record<string, string>)[s] || s;
const CAPS: [string, string][] = [["tools", "Tool calling"], ["vision", "Vision"], ["thinking", "Reasoning"], ["structured", "Structured output"], ["agentic", "Agent CLI"]];

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3 py-1.5 text-xs"><dt className="text-ink-3 shrink-0">{label}</dt><dd className="text-ink text-right truncate min-w-0 selectable" title={typeof children === "string" ? children : undefined}>{children}</dd></div>;
}

function Detail({ m, provider, onTest, reload }: { m: Model; provider?: Provider; onTest: () => void; reload: () => void }) {
  const { busy, run } = useAction();
  const d = m.details || {};
  const caps = m.capabilities || {};
  const shownCaps = CAPS.filter(([k]) => k in caps);
  const ollama = m.provider_kind === "ollama";
  return (
    <div className="px-5 pb-5 pt-2 grid grid-cols-3 gap-x-10 gap-y-5 max-[900px]:grid-cols-1">
      <section>
        <h3 className="text-2xs font-medium text-ink-2 mb-2">Identity</h3>
        <dl>
          <Meta label="Model ID">{m.name || ""}</Meta>
          <Meta label="Provider">{m.provider_name}</Meta>
          {provider?.base_url && <Meta label="Endpoint">{provider.base_url}</Meta>}
          {d.family && <Meta label="Family">{d.family}</Meta>}
          {d.display_name && <Meta label="Display name">{d.display_name}</Meta>}
        </dl>
      </section>
      <section>
        <h3 className="text-2xs font-medium text-ink-2 mb-2">Runtime</h3>
        <dl>
          <Meta label="State">{stateLabel(m.state)}</Meta>
          {d.parameter_size && <Meta label="Parameters">{d.parameter_size}</Meta>}
          {d.quantization_level && <Meta label="Quantization">{d.quantization_level}</Meta>}
          {ctxLabel(m.context_length) && <Meta label="Context window">{`${m.context_length!.toLocaleString()} tokens`}</Meta>}
          {m.size_bytes ? <Meta label="On disk">{bytes(m.size_bytes)}</Meta> : null}
          {d.loaded_size_bytes ? <Meta label="In memory">{bytes(d.loaded_size_bytes)}</Meta> : null}
          {d.vram_bytes ? <Meta label="GPU memory">{bytes(d.vram_bytes)}</Meta> : null}
          {d.note && <Meta label="Note">{d.note}</Meta>}
        </dl>
      </section>
      <section>
        <h3 className="text-2xs font-medium text-ink-2 mb-2">Capabilities</h3>
        {shownCaps.length === 0 ? <div className="py-1 text-xs text-ink-3">Not reported by this endpoint.</div> : (
          <dl>{shownCaps.map(([k, label]) => <Meta key={k} label={label}>{caps[k] === true ? "Yes" : caps[k] === false ? "No" : "Unverified"}</Meta>)}</dl>)}
        {caps.probed && <div className="text-2xs text-ink-3 mt-1">Tool calling and structured output were verified by a live probe.</div>}
        {(m.assigned_agents || []).length > 0 && <div className="mt-2 text-xs text-ink-2">Used by {(m.assigned_agents || []).join(", ")}</div>}
      </section>
      <div className="col-span-full flex flex-wrap items-center gap-2">
        <Button size="sm" icon={<Zap size={13} />} onClick={onTest}>Test</Button>
        {!caps.agentic && <Button size="sm" icon={<FlaskConical size={13} />} busy={busy === "p"} title="Verify tool calling and structured output"
          onClick={() => run("p", () => api(`/providers/${m.provider_id}/probe`, { body: { model: m.name } }), "Capabilities verified").then(reload)}>Probe capabilities</Button>}
        {ollama && (m.state === "loaded" || m.state === "processing") && <Button size="sm" icon={<PowerOff size={13} />} busy={busy === "u"}
          onClick={() => run("u", () => api("/models/unload", { body: { provider_id: m.provider_id, model: m.name } }), "Unloaded").then(reload)}>Unload</Button>}
        <div className="flex-1" />
        {ollama && <Button size="sm" variant="danger" icon={<Trash2 size={13} />} busy={busy === "d"}
          onClick={() => confirm(`Delete ${m.name} from Ollama? This removes the model files.`) && run("d", () => api("/models/delete", { body: { provider_id: m.provider_id, model: m.name } }), "Deleted").then(reload)}>Delete</Button>}
      </div>
    </div>
  );
}

export function ModelsList({ models, failed, providers, loading, onTest, reload, onGoEndpoints }: {
  models: Model[]; failed: Model[]; providers: Provider[]; loading: boolean; onTest: (m: Model) => void; reload: () => void; onGoEndpoints: () => void;
}) {
  const { settings } = useStore();
  const visibleModels = useMemo(() => models.filter((m) => !(m.name === "default" &&
    (m.provider_kind === "hermes_cli" || providers.some((p) => p.id === m.provider_id && p.kind === "hermes_cli")))), [models, providers]);
  const [q, setQ] = useState("");
  const [prov, setProv] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<"name" | "size" | "context">(() => (["size", "context"].includes(settings?.["models.default_sort"]) ? settings!["models.default_sort"] : "name"));
  const [open, setOpen] = useState<string | null>(null);
  const states = useMemo(() => Array.from(new Set(visibleModels.map((m) => m.state))), [visibleModels]);
  const shown = useMemo(() => {
    const s = q.toLowerCase();
    const list = visibleModels.filter((m) => (prov === "all" || m.provider_id === prov) && (status === "all" || m.state === status) &&
      (!s || `${m.name} ${m.provider_name} ${m.details?.display_name || ""}`.toLowerCase().includes(s)));
    const key = (m: Model) => (sort === "size" ? m.size_bytes || 0 : sort === "context" ? m.context_length || 0 : 0);
    return list.sort((a, b) => (sort === "name" ? (a.name || "").localeCompare(b.name || "") : key(b) - key(a)));
  }, [visibleModels, q, prov, status, sort]);
  const filtered = q || prov !== "all" || status !== "all";

  return (
    <div className="fade-in">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${visibleModels.length} models`} aria-label="Search models"
            className="h-9 w-[280px] max-[760px]:w-full pl-8 pr-2.5 rounded-md bg-surface border border-line text-sm text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" />
        </div>
        {providers.length > 1 && <Select value={prov} onChange={(e) => setProv(e.target.value)} aria-label="Filter by provider" className="!w-[160px] !h-9"><option value="all">All providers</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
        {states.length > 1 && <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="!w-[140px] !h-9"><option value="all">Any status</option>{states.map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}</Select>}
        <Select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Sort models" className="!w-[150px] !h-9"><option value="name">Sort: Name</option><option value="size">Sort: Size</option><option value="context">Sort: Context</option></Select>
        <div className="flex-1" />
        <Button icon={<RefreshCw size={14} />} onClick={reload}>Refresh</Button>
      </div>

      {failed.length > 0 && (
        <div role="alert" className="mb-3 rounded-md border border-line bg-surface divide-y divide-[var(--border)]">
          {failed.map((f) => (
            <div key={f.provider_id} className="flex items-start gap-2 px-3 py-2 text-sm">
              <AlertCircle size={14} className="text-bad mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1 selectable break-words"><span className="text-ink">{f.provider_name}</span> <span className="text-ink-3">is unreachable{f.error ? `: ${f.error}` : "."}</span></span>
              <button onClick={onGoEndpoints} className="text-ink-2 hover:text-ink underline underline-offset-2 shrink-0">Check endpoint</button>
            </div>))}
        </div>)}

      {!loading && visibleModels.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface"><Empty title="No models yet" body={visibleModels.length === 0 && models.some((m) => m.provider_kind === "hermes_cli")
          ? "Hermes uses its configured model, which isn’t listed as a selectable model here."
          : failed.length ? "Every connected endpoint is unreachable right now." : "Download a model with Ollama or connect an endpoint."}
          action={<Button onClick={onGoEndpoints}>Open endpoints</Button>} /></div>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface"><Empty title="No matching models" body={filtered ? "Nothing matches the current search and filters." : undefined}
          action={<Button onClick={() => { setQ(""); setProv("all"); setStatus("all"); }}>Clear filters</Button>} /></div>
      ) : (
        <ul className="rounded-lg border border-line bg-surface divide-y divide-[var(--border)] overflow-hidden">
          {shown.map((m) => {
            const id = m.provider_id + "/" + m.name;
            const isOpen = open === id;
            const provider = providers.find((p) => p.id === m.provider_id);
            const spec = [m.details?.parameter_size, m.details?.quantization_level, ctxLabel(m.context_length) && `${ctxLabel(m.context_length)} ctx`, m.size_bytes ? bytes(m.size_bytes) : null].filter(Boolean).join(" · ");
            const caps = [m.capabilities?.tools === true && "tools", m.capabilities?.vision === true && "vision", m.capabilities?.thinking === true && "reasoning", m.capabilities?.agentic && "agent"].filter(Boolean).join(" · ");
            return (
              <li key={id} className={cx(isOpen && "bg-surface-2")}>
                <button onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}
                  className={cx("w-full flex items-center gap-3 h-14 px-4 text-left", !isOpen && "hover:bg-hover")}>
                  <ChevronRight size={14} className={cx("shrink-0 text-ink-3 transition-transform duration-200 ease-[var(--ease)]", isOpen && "rotate-90")} />
                  <BrandMark model={m.name} fallbackIconKey={resolveProviderIconKey({ presetId: m.provider_preset_id, kind: m.provider_kind, baseUrl: provider?.base_url, name: m.provider_name })} label={m.provider_name} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base text-ink truncate" title={m.name || ""}>{m.name}</span>
                    <span className="block text-xs text-ink-3 truncate">{m.provider_name}{caps ? ` · ${caps}` : ""}</span>
                  </span>
                  <span className="hidden min-[900px]:block w-[240px] shrink-0 text-right text-xs text-ink-2 tnum truncate" title={spec}>{spec || "—"}</span>
                  <span className="w-[96px] shrink-0 flex items-center justify-end gap-1.5 text-xs text-ink-2">
                    <span className={cx("h-1.5 w-1.5 rounded-full", STATUS_DOT(m.state))} />{stateLabel(m.state)}</span>
                </button>
                {isOpen && <Detail m={m} provider={provider} onTest={() => onTest(m)} reload={reload} />}
              </li>
            );
          })}
        </ul>)}
      <p className="mt-6 text-xs text-ink-3 leading-relaxed">Each model has its own license (for example the Llama, Gemma or Qwen licenses). Check a model's license before using it commercially.</p>
    </div>
  );
}
