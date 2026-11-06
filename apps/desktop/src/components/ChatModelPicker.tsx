import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu, Search, Settings2 } from "lucide-react";
import { Agent, Model, Provider } from "../api";
import type { ChatConfig } from "../views/Chat";
import { useStore } from "../store";
import { BrandMark } from "./Brand";
import { resolveProviderIconKey } from "./Endpoints";
import { Button, cx, Input, Select } from "./ui";

const modelTitle = (model: string, kind?: string) => kind === "claude_code"
  ? ({ default: "Claude Code default", opus: "Claude Opus", sonnet: "Claude Sonnet", haiku: "Claude Haiku" } as Record<string, string>)[model] || model
  : kind === "codex_cli" && model === "default" ? "Codex default" : model;
const cli = (kind?: string) => kind === "claude_code" || kind === "codex_cli";

export function ChatModelPicker({ cfg, set, models, providers, agents, loading }: {
  cfg: ChatConfig; set: (patch: ChatConfig) => void; models: Model[]; providers: Provider[]; agents: Agent[]; loading: boolean;
}) {
  const { go } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [heightLimit, setHeightLimit] = useState(420);
  const [customProvider, setCustomProvider] = useState("");
  const [customModel, setCustomModel] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const mode = cfg.mode || "model";
  const locked = mode !== "model";
  const selected = models.find((m) => m.provider_id === cfg.provider_id && m.name === cfg.model);
  const provider = providers.find((p) => p.id === cfg.provider_id);
  const iconFor = (p?: Provider, m?: Model) => (p?.kind || m?.provider_kind) === "claude_code" ? "anthropic" : resolveProviderIconKey({ presetId: p?.config?.preset_id || m?.provider_preset_id, kind: p?.kind || m?.provider_kind, baseUrl: p?.base_url, name: p?.name || m?.provider_name });
  const label = mode === "team" ? "Team models" : mode === "agent" ? agents.find((a) => a.id === cfg.agent_id)?.model || "Agent model" : cfg.model ? selected?.details?.display_name || modelTitle(cfg.model, provider?.kind) : "Select model";
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const pick = (provider_id: string, model: string) => { set({ provider_id, model }); close(); };
  useEffect(() => {
    if (!open) return;
    setQuery(""); setCustomModel(""); setCustomProvider(cfg.provider_id || providers.find((p) => cli(p.kind))?.id || "");
    search.current?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } };
    window.addEventListener("mousedown", outside); window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("mousedown", outside); window.removeEventListener("keydown", escape, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => { const rect = root.current?.getBoundingClientRect(); if (!rect) return; setOffset(Math.min(0, window.innerWidth - 12 - rect.left - Math.min(420, window.innerWidth - 24))); setHeightLimit(Math.min(580, Math.max(120, rect.top - 24))); };
    fit(); window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);
  const groups = new Map<string, { provider?: Provider; models: Model[] }>();
  const term = query.trim().toLowerCase();
  for (const model of models) {
    if (!model.name) continue;
    const p = providers.find((p) => p.id === model.provider_id);
    const title = model.details?.display_name || modelTitle(model.name, p?.kind || model.provider_kind);
    if (term && !`${title} ${model.name} ${p?.name || model.provider_name} ${model.details?.description || ""}`.toLowerCase().includes(term)) continue;
    if (!groups.has(model.provider_id)) groups.set(model.provider_id, { provider: p, models: [] });
    const group = groups.get(model.provider_id)!;
    if (!group.models.some((m) => m.name === model.name)) group.models.push(model);
  }
  const runtimes = providers.filter((p) => p.enabled && cli(p.kind));
  return <div ref={root} className="relative">
    <button ref={trigger} disabled={locked} onClick={() => setOpen((v) => !v)} aria-label={`Choose model: ${label}`} aria-haspopup="dialog" aria-expanded={open}
      title={locked ? "This agent or team manages its own models." : label}
      className={cx("h-8 max-w-[260px] rounded-full flex items-center gap-2 pl-1 pr-2.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50 no-drag", open ? "bg-active" : "hover:bg-hover")}>
      {cfg.model ? <BrandMark model={cfg.model} fallbackIconKey={iconFor(provider, selected)} size={24} /> : <span className="h-6 w-6 flex items-center justify-center"><Cpu size={16} /></span>}
      <span className="truncate font-medium">{label}</span><ChevronDown size={13} className="shrink-0" />
    </button>
    {open && <div role="dialog" aria-label="Choose a model" style={{ left: offset, maxHeight: heightLimit }} className="pop-in absolute bottom-full left-0 mb-3 z-40 w-[420px] max-w-[calc(100vw-24px)] max-h-[min(580px,75vh)] flex flex-col rounded-2xl border border-line-strong bg-surface shadow-[var(--shadow-lg)] overflow-hidden origin-bottom-left">
      <div className="p-4 pb-3 shrink-0"><h2 className="text-sm font-semibold text-ink mb-3">Choose a model</h2><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" /><Input ref={search} className="pl-9" aria-label="Search models" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search models or providers" /></div></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
        if (!options.length) return;
        event.preventDefault();
        const current = options.indexOf(document.activeElement as HTMLButtonElement);
        options[(current + (event.key === "ArrowDown" ? 1 : options.length - 1) + options.length) % options.length]?.focus();
      }}>
        {loading && <p className="text-sm text-ink-2 p-3" role="status">Loading available models…</p>}
        {!loading && !groups.size && <p className="text-sm text-ink-2 p-3">{query ? "No models match your search." : "Connect an endpoint to choose a model."}</p>}
        {Array.from(groups).map(([pid, group]) => {
          const p = group.provider;
          const name = p?.name || group.models[0].provider_name;
          return <section key={pid} aria-label={`${name} models`} className="mb-3 last:mb-0">
            <div className="flex items-center gap-2.5 px-3 py-2"><BrandMark fallbackIconKey={iconFor(p, group.models[0])} size={24} label={name} /><span className="text-xs font-semibold text-ink-2 flex-1">{name}</span><span className="text-[11px] text-ink-3">{p?.status === "connected" ? "Connected" : p?.status === "unavailable" || p?.status === "failed" ? "Offline" : ""}</span></div>
            <div role="menu" aria-label={`${name} model choices`} className="space-y-1">
              {group.models.map((model) => {
                const title = model.details?.display_name || modelTitle(model.name!, p?.kind || model.provider_kind);
                const active = cfg.provider_id === pid && cfg.model === model.name;
                const description = model.details?.description || [model.details?.parameter_size, model.context_length ? `${Math.round(model.context_length / 1000)}k context` : "", model.capabilities?.vision ? "Images" : "", model.state === "loaded" ? "Loaded" : ""].filter(Boolean).join(" · ");
                return <button key={model.name} role="menuitemradio" aria-checked={active} className="chat-model-option" onClick={() => pick(pid, model.name!)}>
                  <span className="min-w-0 flex-1"><span className="model-option-title block truncate">{title}</span>{description && <span className="model-option-detail block mt-1 line-clamp-2">{description}</span>}{title !== model.name && !["default", "opus", "sonnet", "haiku"].includes(model.name!) && <span className="block mt-1 text-[11px] text-ink-3 truncate">{model.name}</span>}</span>
                  {active && <span className="h-6 w-6 rounded-full bg-active text-ink flex items-center justify-center shrink-0"><Check size={14} /></span>}
                </button>;
              })}
            </div>
          </section>;
        })}
      </div>
      <div className="border-t border-line px-3 py-2 shrink-0 overflow-y-auto max-h-[200px]">
        {runtimes.length > 0 && <details className="mb-1"><summary className="cursor-pointer px-1 py-2 text-xs text-ink-2">Use an exact model ID</summary><form className="space-y-2 py-2" onSubmit={(event) => { event.preventDefault(); if (customProvider && customModel.trim()) pick(customProvider, customModel.trim()); }}>
          <Select aria-label="Model runtime" value={runtimes.some((p) => p.id === customProvider) ? customProvider : ""} onChange={(e) => setCustomProvider(e.target.value)}><option value="" disabled>Choose runtime</option>{runtimes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Input aria-label="Exact model ID" value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="Enter a model ID supported by this runtime" />
          <Button type="submit" disabled={!customModel.trim() || !runtimes.some((p) => p.id === customProvider)}>Use model</Button>
        </form></details>}
        <button onClick={() => { close(); go({ name: "models" }); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-ink-2 hover:bg-hover hover:text-ink"><Settings2 size={14} />Manage models & connections</button>
      </div>
    </div>}
  </div>;
}
