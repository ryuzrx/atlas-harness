import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Square, Plus, Box, ChevronDown, Check, X, FileText, Users, Bot, ChevronRight,
  Copy, Pencil, Columns2, Volume2, AlertCircle, SlidersHorizontal, Loader2, Code2, Layers, Sparkles, PanelRight, Cpu, Zap, RotateCcw,
} from "lucide-react";
import { Agent, api, Approval, Model, Project, Provider, subscribe, Task, Team, TOKEN, useApi, useConnected } from "../api";
import { BrandMark, brandFor } from "../components/Brand";
import { ChatModelPicker } from "../components/ChatModelPicker";
import { SessionPanel } from "../components/SessionPanel";
import { ProviderIcon, resolveProviderIconKey } from "../components/Endpoints";
import { useStore } from "../store";
import { cx, StatusBadge, Toggle, useAction, useToast } from "../components/ui";
import { AtlasMark } from "../components/Logo";
import { AnimatedMark } from "../components/AnimatedMark";
import { Markdown, PathBase } from "../components/Markdown";
import { RunTimeline, summarizeSteps, useRunSteps } from "../components/RunTimeline";
import { Starfield } from "../components/Starfield";
import { RunMedia } from "../components/RunMedia";

// ---------------------------------------------------------------- types & config
export interface ChatConfig {
  mode?: "model" | "agent" | "team" | "auto_team"; provider_id?: string; model?: string; agent_id?: string; team_id?: string;
  auto_team?: boolean;
  web_search?: boolean;
  tools?: string[]; project_id?: string; access_level?: "read_only" | "workspace" | "computer_use";
  computer_consent_for?: string; system?: string; temperature?: number | null; reasoning_effort?: "low" | "medium" | "high" | "xhigh"; auto_approve?: boolean;
  compare_models?: { provider_id: string; model: string }[];
}
interface ChatMessage {
  id: string; conversation_id: string; role: "user" | "assistant"; content: string;
  status: "done" | "streaming" | "running" | "error" | "stopped"; task_id?: string; data: Record<string, any>; created_at: number;
}
interface ConversationFull { id: string; title: string; config: ChatConfig; messages: ChatMessage[] }

const DRAFT_KEY = "atlas_chat_draft_cfg";
export const loadDraft = (): ChatConfig => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch { return {}; } };
export const saveDraft = (c: ChatConfig) => localStorage.setItem(DRAFT_KEY, JSON.stringify(c));
export function clearHermesPlaceholder(cfg: ChatConfig, providers: Provider[]): ChatConfig | undefined {
  if ((cfg.mode || "model") !== "model") return;
  const provider = providers.find((p) => p.id === cfg.provider_id);
  const clearPrimary = cfg.model === "default" && provider?.kind === "hermes_cli";
  const compare = (cfg.compare_models || []).filter((item) => {
    const selected = providers.find((p) => p.id === item.provider_id);
    return !(item.model === "default" && selected?.kind === "hermes_cli");
  });
  if (!clearPrimary && compare.length === (cfg.compare_models || []).length) return;
  return { ...cfg, ...(clearPrimary ? { provider_id: undefined, model: undefined } : {}), compare_models: compare };
}

const MAX_FILE = 200_000;            // text up to this size goes straight into the prompt
const MAX_IMAGE = 4 * 1024 * 1024;   // images up to this size are sent to the model as images
const MAX_UPLOAD = 2 * 1024 ** 3;    // anything bigger is uploaded to disk (up to 2 GB) and opened with tools
const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;

const CHUNK = 8 * 1024 * 1024;

/** Send one piece of a file; resolves to the upload id. */
function sendChunk(url: string, body: Blob, onProgress: (loaded: number) => void, signal: { xhr?: XMLHttpRequest }): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    signal.xhr = xhr;
    xhr.open("POST", url);
    xhr.setRequestHeader("x-atlas-token", TOKEN);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText).id); } catch { reject(new Error("Upload failed.")); } }
      else { let msg = `Upload failed (${xhr.status}).`; try { msg = JSON.parse(xhr.responseText).detail || msg; } catch {} reject(new Error(msg)); }
    };
    xhr.onerror = () => reject(new Error("Upload failed: the connection dropped."));
    xhr.onabort = () => reject(new Error("aborted"));
    xhr.send(body);
  });
}

/** Upload a file in 8 MB pieces so the page never holds more than one piece in memory. */
async function uploadFile(f: File, onProgress: (p: number) => void, signal: { xhr?: XMLHttpRequest; cancelled?: boolean }): Promise<string> {
  let id = "";
  for (let offset = 0; offset < f.size || (offset === 0 && !id); offset += CHUNK) {
    if (signal.cancelled) throw new Error("aborted");
    const url = id ? `/api/uploads?id=${encodeURIComponent(id)}&offset=${offset}` : `/api/uploads?name=${encodeURIComponent(f.name)}`;
    id = await sendChunk(url, f.slice(offset, offset + CHUNK), (loaded) => onProgress(f.size ? Math.min(1, (offset + loaded) / f.size) : 1), signal);
    if (f.size === 0) break;
  }
  return id;
}


// ---------------------------------------------------------------- popover
function Popover({ open, onClose, children, align = "left", place = "top", width = 300 }: {
  open: boolean; onClose: () => void; children: React.ReactNode; align?: "left" | "right"; place?: "top" | "bottom"; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("mousedown", h); window.addEventListener("keydown", k, true);
    return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", k, true); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" style={{ width }}
      className={cx("absolute z-40 max-h-[420px] overflow-y-auto p-1 rounded-lg bg-surface border border-line shadow-[var(--shadow-lg)] anim-pop",
        place === "top" ? "bottom-full mb-2" : "top-full mt-2", align === "left" ? "left-0" : "right-0",
        place === "top" ? (align === "left" ? "origin-bottom-left" : "origin-bottom-right") : (align === "left" ? "origin-top-left" : "origin-top-right"))}>
      {children}
    </div>
  );
}
const MenuLabel = ({ children }: { children: React.ReactNode }) => <div className="px-2.5 pt-2 pb-1 text-2xs font-semibold text-ink-3">{children}</div>;
function MenuRow({ active, onClick, children, hint, disabled }: { active?: boolean; onClick: () => void; children: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} role="menuitemradio" aria-checked={!!active}
      className="chat-menu-row w-full flex items-start gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-sm hover:bg-hover disabled:opacity-40">
      <span className="min-w-0 flex-1"><span className="block truncate">{children}</span>{hint && <span className="chat-menu-hint block text-xs truncate">{hint}</span>}</span>
      <span className="w-4 shrink-0 pt-0.5">{active && <Check size={14} />}</span>
    </button>
  );
}
function Chip({ icon, label, onClick, open, disabled, title, iconBox }: {
  icon: React.ReactNode; label: string; onClick: () => void; open: boolean; disabled?: boolean; title?: string; iconBox?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-haspopup="menu" aria-expanded={open}
      aria-label={label ? undefined : title}
      className={cx("h-8 min-w-0 shrink rounded-lg flex items-center text-[13px] text-ink-2 hover:text-ink no-drag disabled:opacity-50 transition-colors",
        !label ? "w-8 justify-center" : iconBox ? "max-w-[220px] pl-1 pr-2 gap-1.5" : "max-w-[200px] px-2 gap-1.5",
        open ? "bg-active text-ink" : "hover:bg-hover")}>
      <span className={cx("shrink-0 flex items-center justify-center", iconBox && "h-6 w-6 rounded-md text-ink")}>{icon}</span>
      {label && <><span className="truncate">{label}</span><ChevronDown size={12} className="shrink-0 text-ink-3" /></>}
    </button>
  );
}

// ---------------------------------------------------------------- selectors
function useHarnessData() {
  const { data: agents = [] } = useApi<Agent[]>("/agents", ["agent"]);
  const { data: models = [], loading: modelsLoading } = useApi<Model[]>("/models", ["provider", "model"]);
  const { data: providers = [] } = useApi<Provider[]>("/providers", ["provider"]);
  const { data: projects = [] } = useApi<Project[]>("/projects", ["project"]);
  return { agents, models, modelsLoading, providers, projects };
}

export async function prepareAutoTeamConfig(cfg: ChatConfig, text: string, attachments: Attachment[]): Promise<ChatConfig> {
  if (cfg.mode !== "auto_team") return cfg;
  const routing = cfg.provider_id && cfg.model
    ? { reasoning: { provider_id: cfg.provider_id, model: cfg.model }, coding: { provider_id: cfg.provider_id, model: cfg.model } }
    : undefined;
  const need = text || attachments.map((a) => a.name).join(", ") || "Analyze the attached files";
  const created = await api<Team>("/teams/auto", { body: { need, project_id: cfg.project_id, routing } });
  return { ...cfg, mode: "team", team_id: created.id, agent_id: undefined, auto_team: true };
}

function AgentMenu({ cfg, set, h }: { cfg: ChatConfig; set: (p: ChatConfig) => void; h: ReturnType<typeof useHarnessData> }) {
  const [open, setOpen] = useState(false);
  const { go } = useStore();
  const mode = cfg.mode || "model";
  const agent = h.agents.find((a) => a.id === cfg.agent_id);
  const label = mode === "auto_team" || (mode === "team" && cfg.auto_team) ? "Auto team" : mode === "agent" && agent ? agent.name : mode === "team" ? "Team" : "Solo";
  const pick = (p: ChatConfig) => { set(p); setOpen(false); };
  const agents = h.agents.filter((a) => !a.config?.chat_assistant);
  return (
    <div className="relative">
      <Chip icon={<Box size={16} strokeWidth={1.6} />} label={label} title="Team mode" open={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} width={320}>
        <MenuRow active={mode === "model"} onClick={() => pick({ mode: "model", agent_id: undefined, team_id: undefined, auto_team: false })} hint="Team mode off · answer directly with the selected model">Solo</MenuRow>
        <MenuRow active={mode === "auto_team"} onClick={() => pick({ mode: "auto_team", agent_id: undefined, team_id: undefined, auto_team: true })}
          hint="Team mode on · up to two specialists, three tasks, six model steps per specialist">Auto team</MenuRow>
        <MenuLabel>Agents</MenuLabel>
        {agents.length === 0 && <div className="px-2.5 pb-2 text-xs text-ink-3">No agents yet.</div>}
        {agents.map((a) => (
          <MenuRow key={a.id} active={mode === "agent" && cfg.agent_id === a.id} onClick={() => pick({ mode: "agent", agent_id: a.id, team_id: undefined, auto_team: false })}
            hint={`${a.role}${a.team_name ? ` · ${a.team_name}` : ""} · ${a.model || "no model"}`}>{a.name}</MenuRow>
        ))}
        <div className="h-px bg-line my-1.5" />
        <MenuRow onClick={() => { setOpen(false); go({ name: "agents" }); }}>Manage agents…</MenuRow>
      </Popover>
    </div>
  );
}

function ModelMenu({ cfg, set, h }: { cfg: ChatConfig; set: (p: ChatConfig) => void; h: ReturnType<typeof useHarnessData> }) {
  return <ChatModelPicker cfg={cfg} set={set} models={h.models} providers={h.providers} agents={h.agents} loading={h.modelsLoading} />;
}

const EFFORT = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
] as const;

function ReasoningControl({ cfg, set, providers }: { cfg: ChatConfig; set: (p: ChatConfig) => void; providers: Provider[] }) {
  const [open, setOpen] = useState(false);
  const provider = providers.find((p) => p.id === cfg.provider_id);
  if ((cfg.mode || "model") !== "model" || !["openai_compat", "hermes_cli"].includes(provider?.kind || "")) return null;
  const effort = cfg.reasoning_effort || "medium";
  const selected = EFFORT.findIndex((item) => item.value === effort);
  const activeIndex = selected < 0 ? 1 : selected;
  const current = EFFORT[activeIndex];
  return <div className="relative no-drag">
    <button type="button" onClick={() => setOpen((v) => !v)} aria-label={`Reasoning effort: ${current.label}`} aria-expanded={open}
      className="h-8 px-2 rounded-lg flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink hover:bg-hover transition-colors">
      <Zap size={14} className="text-[var(--accent)]" /><span className="hidden sm:inline">{current.label}</span>
    </button>
    {open && <>
      <button aria-label="Close reasoning settings" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
      <div role="dialog" aria-label="Reasoning effort" className="reasoning-popover pop-in absolute z-40 bottom-full right-0 mb-3 w-[min(320px,calc(100vw-32px))] rounded-2xl border border-line-strong bg-surface p-4 shadow-[var(--shadow-lg)]">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div><div className="text-lg font-medium text-[var(--accent)]">{current.label}</div>
            <div className="text-xs text-ink-2 truncate max-w-[220px]">{cfg.model || "Selected model"}</div></div>
          <button type="button" onClick={() => set({ reasoning_effort: undefined })} aria-label="Reset reasoning to default" title="Reset to default"
            className="h-7 w-7 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover"><RotateCcw size={15} /></button>
        </div>
        <div className="relative mx-[15px]">
          <div className="reasoning-track" aria-hidden="true"><span style={{ width: `${activeIndex * 100 / (EFFORT.length - 1)}%` }} /></div>
          {EFFORT.map((item, index) => <span key={item.value} aria-hidden="true" className={`reasoning-tick${index <= activeIndex ? " is-active" : ""}`} style={{ left: `${index * 100 / (EFFORT.length - 1)}%` }} />)}
          <input type="range" min={0} max={EFFORT.length - 1} step={1} value={activeIndex}
            aria-label="Reasoning effort" aria-valuetext={current.label}
            onClick={(e) => set({ reasoning_effort: EFFORT[Number((e.currentTarget as HTMLInputElement).value)].value })}
            onChange={(e) => set({ reasoning_effort: EFFORT[Number(e.target.value)].value })} className="reasoning-slider" />
        </div>
        <div className="flex justify-between mt-3 text-[10px] text-ink-3" aria-hidden="true"><span>Low</span><span>Medium</span><span>High</span><span>Extra high</span></div>
      </div>
    </>}
  </div>;
}

function AccessMenu({ cfg, set, h }: { cfg: ChatConfig; set: (p: ChatConfig) => void; h: ReturnType<typeof useHarnessData> }) {
  const [open, setOpen] = useState(false);
  const { data: webSearch } = useApi<{ connected: boolean }>("/integrations/web-search", ["settings"]);
  const level = cfg.access_level === "computer_use" ? "computer_use" : "workspace";
  const agent = cfg.mode === "agent" ? h.agents.find((a) => a.id === cfg.agent_id) : undefined;
  const provider = h.providers.find((p) => p.id === (agent?.provider_id || cfg.provider_id));
  const modelName = agent?.model || cfg.model;
  const model = h.models.find((m) => m.provider_id === provider?.id && m.name === modelName);
  const unsupported = model?.capabilities?.vision === false || model?.capabilities?.tools === false;
  const teamMode = cfg.mode === "team" || cfg.mode === "auto_team";
  const computerReady = !teamMode && !!provider && !!modelName && !provider.agentic && !unsupported;
  const capabilitiesUnverified = model?.capabilities?.vision !== true || model?.capabilities?.tools !== true;
  const consentKey = `${provider?.id || ""}:${modelName || ""}:${provider?.base_url || ""}`;
  // A loopback endpoint can proxy requests to a hosted service. Only the bundled/default Ollama
  // connection is treated as local; every custom endpoint gets the screenshot disclosure.
  const localProvider = provider?.kind === "ollama" && !provider.base_url;
  const options = [
    { id: "workspace" as const, label: "Workspace", hint: "Atlas uses every tool it needs. Git changes ask first unless you ask for them." },
  ];
  const enableComputerUse = () => {
    if (!computerReady) return;
    if (capabilitiesUnverified && !window.confirm(`Atlas cannot verify that ${modelName} supports both images and tool calls. Computer Use may fail. Try it anyway?`)) return;
    const hosted = !localProvider;
    if (hosted && cfg.computer_consent_for !== consentKey) {
      const approved = window.confirm(`Atlas Computer Use will capture your screen and send frames to ${provider?.name} (${modelName}) for this chat. Stop prevents the next action; an action already sent to macOS may finish. Continue?`);
      if (!approved) return;
      set({ access_level: "computer_use", computer_consent_for: consentKey });
    } else set({ access_level: "computer_use" });
    setOpen(false);
  };
  return <div className="relative">
    <Chip icon={<SlidersHorizontal size={15} strokeWidth={1.6} />} label={level === "computer_use" ? "Computer Use" : ""} title="Access" open={open} onClick={() => setOpen((v) => !v)} />
    <Popover open={open} onClose={() => setOpen(false)} width={300}>
      <MenuLabel>Project</MenuLabel>
      <div className="px-1.5 pb-1">
        <select value={cfg.project_id || ""} onChange={(e) => set({ project_id: e.target.value || undefined })} aria-label="Project"
          className="w-full h-8 px-2 rounded-md bg-base border border-line text-sm text-ink outline-none">
          <option value="">No project · plain chat</option>
          {h.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="px-1 pt-1.5 text-xs text-ink-3 leading-relaxed">{cfg.project_id ? "Atlas uses files, terminal and connectors as needed. Git changes ask first unless you ask for them." : "Pick a project to let Atlas work on files."}</div>
      </div>
      <MenuLabel>Access for this chat</MenuLabel>
      <div className="flex items-start gap-3 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink">Web search</div>
          <div className="mt-0.5 text-xs leading-relaxed text-ink-3">{webSearch?.connected ? "Search current public web pages and cite source links." : "Connect Tavily in Settings → Integrations to search the web."}</div>
        </div>
        <Toggle checked={!!cfg.web_search} onChange={(v) => set({ web_search: v })} label="Web search for this chat" />
      </div>
      <div className="flex items-start gap-3 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink">Auto-approve tool actions</div>
          <div className="mt-0.5 text-xs leading-relaxed text-ink-3">{cfg.auto_approve === false ? "Ask before actions that need approval." : "Tool actions run without per-action approval. Git history or remote changes still ask; blocked commands stay blocked."}</div>
        </div>
        <Toggle checked={cfg.auto_approve !== false} onChange={(v) => set({ auto_approve: v })} label="Auto-approve tool actions" />
      </div>
      {options.map((o) => <MenuRow key={o.id} active={level === o.id} onClick={() => { set({ access_level: o.id }); setOpen(false); }} hint={o.hint}>{o.label}</MenuRow>)}
      <MenuRow active={level === "computer_use"} disabled={!computerReady} onClick={enableComputerUse}
        hint={computerReady ? `${capabilitiesUnverified ? "Model support unverified · " : ""}Use Mac screen and input${localProvider ? " · inference stays on this Mac" : " · screens are shared with provider"}; macOS permissions are required` : teamMode ? "Computer Use isn't available for team chats yet." : !provider || !modelName ? "Choose a model first." : provider.agentic ? "CLI model providers aren't supported for Computer Use." : "This model reports that it doesn't support images or tool calls."}>Atlas Computer Use</MenuRow>
    </Popover>
  </div>;
}

// ---------------------------------------------------------------- composer
export interface Attachment { name: string; content: string; size: number; type?: string; upload_id?: string; progress?: number }

const STARTERS: { icon: React.ElementType; label: string; text: string }[] = [
  { icon: Code2, label: "Write code", text: "Write code that " },
  { icon: Layers, label: "Build a project", text: "Help me build a project: " },
  { icon: FileText, label: "Analyze files", text: "Analyze these files and tell me " },
  { icon: Sparkles, label: "Use an agent", text: "Have an agent " },
];

export function Composer({ cfg, setCfg, onSend, busy, onStop, big, seed }: {
  cfg: ChatConfig; setCfg: (p: ChatConfig) => void; onSend: (text: string, att: Attachment[]) => Promise<boolean>;
  busy: boolean; onStop: () => void; big?: boolean; seed?: { text: string; n: number };
}) {
  const h = useHarnessData();
  const { settings } = useStore();
  const toast = useToast();
  const [text, setText] = useState("");
  const textRef = useRef(text);
  textRef.current = text;
  const [att, setAtt] = useState<Attachment[]>([]);
  const uploads = useRef(new Map<string, { xhr?: XMLHttpRequest; cancelled?: boolean }>());
  const [sending, setSending] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [drag, setDrag] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const { settings: appSettings } = useStore();
  const file = useRef<HTMLInputElement>(null);
  // "/" at the start of the message lists the skills that are switched on.
  const { data: ext } = useApi<{ skills: { name: string; description: string; enabled: boolean }[] }>("/extensions", ["settings"]);
  const slash = /^\/([\w-]*)$/.exec(text);
  const [pick, setPick] = useState(0);
  const [slashOff, setSlashOff] = useState(false);
  const matches = slash && !slashOff ? (ext?.skills || []).filter((x) => x.enabled && x.name.toLowerCase().includes(slash[1].toLowerCase())).slice(0, 8) : [];
  useEffect(() => { setPick(0); if (!text.startsWith("/")) setSlashOff(false); }, [text]);
  const applySkill = (name: string) => { setText(`/${name} `); ta.current?.focus(); };
  useEffect(() => { if (seed) { setText(seed.text); ta.current?.focus(); } }, [seed?.n]);
  useLayoutEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = "0px"; el.style.height = Math.min(el.scrollHeight, 260) + "px";
  }, [text]);
  useEffect(() => {
    ta.current?.focus();
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(tag)) { e.preventDefault(); ta.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.size > MAX_UPLOAD) { toast(`${f.name} is ${fmtSize(f.size)}. Files can be up to 2 GB.`, "bad"); continue; }
      const small = f.type.startsWith("image/") ? f.size <= MAX_IMAGE : f.size <= MAX_FILE;
      let binary = false;
      if (small && !f.type.startsWith("image/")) {
        const head = await f.slice(0, 2000).text();
        binary = /\u0000/.test(head);
      }
      if (!small || binary) {
        // large or binary: upload it and let Atlas open it with tools
        const signal: { xhr?: XMLHttpRequest; cancelled?: boolean } = {};
        uploads.current.set(f.name, signal);
        setAtt((a) => [...a.filter((x) => x.name !== f.name), { name: f.name, content: "", size: f.size, type: f.type || "application/octet-stream", progress: 0 }]);
        uploadFile(f, (p) => setAtt((a) => a.map((x) => (x.name === f.name ? { ...x, progress: p } : x))), signal)
          .then((id) => setAtt((a) => a.map((x) => (x.name === f.name ? { ...x, upload_id: id, progress: 1 } : x))))
          .catch((e) => { if (e.message !== "aborted") toast(`${f.name}: ${e.message}`, "bad"); setAtt((a) => a.filter((x) => x.name !== f.name)); })
          .finally(() => uploads.current.delete(f.name));
        continue;
      }
      if (f.type.startsWith("image/")) {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
          reader.onerror = () => reject(reader.error); reader.readAsDataURL(f);
        }).catch(() => "");
        if (!content) { toast(`Could not read ${f.name}.`, "bad"); continue; }
        setAtt((a) => [...a.filter((x) => x.name !== f.name), { name: f.name, content, size: f.size, type: f.type }]);
        continue;
      }
      const content = await f.text();
      setAtt((a) => [...a.filter((x) => x.name !== f.name), { name: f.name, content, size: f.size, type: f.type || "text/plain" }]);
    }
  };
  const submit = async () => {
    if (!text.trim() && !att.length) return;
    if (att.some((a) => a.progress != null && !a.upload_id)) { toast("Wait for the upload to finish.", "bad"); return; }
    setSending(true);
    const ok = await onSend(text, att);
    setSending(false);
    if (ok) { setText(""); setAtt([]); }
    ta.current?.focus();
  };
  const enhance = async () => {
    const draft = text;
    const target = cfg.compare_models?.[0] || { provider_id: cfg.provider_id, model: cfg.model };
    if (!draft.trim() || !target.provider_id || !target.model) return;
    setEnhancing(true);
    try {
      const result = await api<{ prompt: string }>("/prompts/enhance", { body: { ...target, prompt: draft } });
      if (textRef.current === draft) {
        setText(result.prompt);
        toast("Prompt enhanced. Review it before sending.", "ok");
      } else {
        toast("Your draft changed while enhancement was running, so it was left untouched.", "info");
      }
    } catch (e: any) {
      toast(e.message || "Could not enhance this prompt.", "bad");
    } finally { setEnhancing(false); }
  };
  const uploading = att.some((a) => a.progress != null && a.progress < 1 && !a.upload_id);
  const canSend = (text.trim() || att.length) && !sending && !uploading;
  return (
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      className={cx("chat-composer w-full rounded-[24px] bg-surface border border-line px-4 pt-4 pb-3 transition-[box-shadow,border-color] duration-200",
        drag ? "ring-1 ring-[var(--ring)]" : "focus-within:border-line-strong")}>
      {att.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {att.map((a) => (
            <span key={a.name} className="relative overflow-hidden h-8 pl-2 pr-1 rounded-lg bg-surface border border-line flex items-center gap-1.5 text-xs text-ink">
              {a.progress != null && !a.upload_id && <span className="absolute inset-y-0 left-0 bg-[var(--accent-bg)] transition-[width] duration-200" style={{ width: `${Math.round((a.progress || 0) * 100)}%` }} />}
              <span className="relative flex items-center gap-1.5 min-w-0">
                {a.type?.startsWith("image/") && a.content ? <img src={`data:${a.type};base64,${a.content}`} alt="" className="h-5 w-5 rounded object-cover" /> : <FileText size={13} className="text-ink-2" />}
                <span className="truncate max-w-[220px]">{a.name}</span>
                <span className="text-ink-3 tnum">{a.progress != null && !a.upload_id ? `${Math.round((a.progress || 0) * 100)}% of ${fmtSize(a.size)}` : fmtSize(a.size)}</span>
              </span>
              <button onClick={() => { const u = uploads.current.get(a.name); if (u) { u.cancelled = true; u.xhr?.abort(); } setAtt((x) => x.filter((y) => y.name !== a.name)); }} aria-label={`Remove ${a.name}`} className="relative h-5 w-5 rounded flex items-center justify-center text-ink-3 hover:text-ink"><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {matches.length > 0 && (
        <div role="listbox" aria-label="Skills" className="mb-2 -mx-1.5 rounded-lg border border-line bg-[var(--surface)] p-1 max-h-[260px] overflow-y-auto">
          {matches.map((m, i) => (
            <button key={m.name} role="option" aria-selected={i === pick} onMouseEnter={() => setPick(i)} onMouseDown={(e) => { e.preventDefault(); applySkill(m.name); }}
              className={cx("w-full text-left px-3 py-2 rounded-md flex items-baseline gap-3", i === pick ? "bg-hover" : "")}>
              <span className="font-mono text-sm text-ink shrink-0">/{m.name}</span><span className="text-sm text-ink-3 truncate">{m.description}</span>
            </button>))}
        </div>)}
      <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} onPaste={(e) => {
        const images = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith("image/")).map((item, i) => item.getAsFile()).filter((f): f is File => !!f).map((f, i) => new File([f], f.name || `pasted-image-${Date.now()}-${i}.${f.type.split("/")[1] || "png"}`, { type: f.type }));
        if (images.length) { e.preventDefault(); void addFiles(images); }
      }} rows={1} aria-label="Message Atlas" spellCheck={appSettings?.["chat.spellcheck"] !== false}
        placeholder={busy ? "Send a message to redirect Atlas…" : "How can I help you today?"}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setPick((p) => (p + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length); return; }
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); applySkill(matches[pick]?.name || matches[0].name); return; }
            if (e.key === "Escape") { e.preventDefault(); setSlashOff(true); return; }
          }
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          const modSends = settings?.["chat.send_key"] === "mod_enter";
          if (modSends ? (e.metaKey || e.ctrlKey) : !(e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        }}
        className={cx("composer-input w-full resize-none bg-transparent outline-none text-[16px] leading-[1.6] text-ink placeholder:text-ink-3 px-1", big ? "min-h-[48px]" : "min-h-[28px]")} />
      <div className="flex items-center gap-1.5 mt-2 -mx-1.5">
        <div className="shrink-0 flex items-center gap-0.5">
        <input ref={file} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <button onClick={() => file.current?.click()} aria-label="Attach files" title="Attach files (up to 2 GB)"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover shrink-0"><Plus size={18} strokeWidth={1.6} /></button>
        <button type="button" onClick={enhance} disabled={!text.trim() || !cfg.model || (cfg.mode || "model") !== "model" || enhancing || sending}
          aria-label="Enhance prompt" aria-busy={enhancing} title={!cfg.model ? "Choose a model to enhance this prompt" : "Rewrite your draft with clearer details, then review before sending"}
          className="h-8 px-2 max-[520px]:px-1 rounded-lg flex items-center gap-1.5 max-[520px]:gap-1 text-xs text-ink-2 hover:text-ink hover:bg-hover disabled:opacity-40 disabled:cursor-default shrink-0">
          <Sparkles size={14} className={enhancing ? "animate-pulse text-[var(--accent)]" : ""} />
          <span className="max-[520px]:hidden">{enhancing ? "Enhancing…" : "Enhance prompt"}</span>
        </button>
        <AgentMenu cfg={cfg} set={setCfg} h={h} />
        <AccessMenu cfg={cfg} set={setCfg} h={h} />
        </div>
        <div className="flex-1 min-w-0 flex items-center justify-end gap-1"><ReasoningControl cfg={cfg} set={setCfg} providers={h.providers} /><ModelMenu cfg={cfg} set={setCfg} h={h} /></div>
        {busy && !canSend ? (
          <button onClick={onStop} aria-label="Stop" title="Stop  ⌘."
            className="h-8 w-8 rounded-full bg-ink text-[var(--base)] flex items-center justify-center hover:opacity-90 shrink-0"><Square size={13} fill="currentColor" /></button>
        ) : (
          <button onClick={submit} disabled={!canSend} aria-label="Send message" title={busy ? "Stop the current run and send this" : settings?.["chat.send_key"] === "mod_enter" ? "Send  ⌘↵" : "Send  ↵"}
            className="h-8 w-8 rounded-full bg-ink text-[var(--base)] flex items-center justify-center hover:opacity-90 disabled:opacity-30 disabled:cursor-default shrink-0">
            {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={18} strokeWidth={2} />}</button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- run panels
function ApprovalCard({ a }: { a: Approval }) {
  const { busy, run } = useAction();
  const [answer, setAnswer] = useState("");
  if (a.kind === "user_question") {
    const sendAnswer = () => {
      const value = answer.trim();
      if (value) void run(a.id, () => api(`/approvals/${a.id}/answer`, { body: { answer: value } }));
    };
    return <div className="rounded-xl border border-[var(--ring)]/35 bg-surface p-3.5">
      <div className="flex items-center gap-2 text-sm text-ink"><Sparkles size={14} className="text-[var(--ring)]" />
        <span className="font-medium">Atlas needs your input</span>{a.agent_name && <span className="text-ink-3">· {a.agent_name}</span>}</div>
      <p className="mt-2 text-sm text-ink-2 whitespace-pre-wrap">{a.payload?.question || "What would you like Atlas to know?"}</p>
      {!!a.payload?.choices?.length && <div className="mt-2 flex flex-wrap gap-1.5">{a.payload.choices.map((choice: string) =>
        <button key={choice} onClick={() => setAnswer(choice)} aria-pressed={answer === choice}
          className={cx("rounded-full border px-2.5 py-1 text-xs text-ink-2 hover:bg-hover", answer === choice && "border-[var(--ring)] bg-hover text-ink")}>{choice}</button>)}</div>}
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAnswer(); } }}
        rows={2} maxLength={4000} placeholder="Your answer…" aria-label="Answer Atlas's question"
        className="mt-2 w-full resize-y rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" />
      <div className="mt-2 flex justify-end"><button onClick={sendAnswer} disabled={!!busy || !answer.trim()}
        className="h-8 rounded-md bg-ink px-3.5 text-sm font-medium text-[var(--base)] hover:opacity-90 disabled:opacity-40">{busy ? "Continuing…" : "Continue"}</button></div>
    </div>;
  }
  const decide = (approved: boolean, always = false) => run(a.id, () => api(`/approvals/${a.id}`, { body: { approved, always } }));
  const cmd = a.payload?.command || a.payload?.title;
  return (
    <div className="rounded-xl border border-line-strong bg-surface p-3">
      <div className="flex items-center gap-2 text-sm text-ink"><AlertCircle size={14} className="text-warn" />
        <span className="font-medium">Approval needed</span><span className="text-ink-3">· {a.kind.replace(/_/g, " ")}{a.agent_name ? ` · ${a.agent_name}` : ""}</span></div>
      {cmd ? <pre className="selectable mt-2 px-2.5 py-2 rounded-md bg-base border border-line text-xs font-mono whitespace-pre-wrap break-all">{cmd}</pre>
        : <pre className="selectable mt-2 px-2.5 py-2 rounded-md bg-base border border-line text-xs font-mono whitespace-pre-wrap max-h-40 overflow-auto">{JSON.stringify(a.payload, null, 2)}</pre>}
      {a.payload?.reason && <div className="mt-1.5 text-xs text-ink-2">{a.payload.reason}</div>}
      <div className="mt-2.5 flex gap-2">
        <button onClick={() => decide(true)} disabled={!!busy} className="h-8 px-3.5 rounded-md bg-ink text-[var(--base)] text-sm font-medium hover:opacity-90 disabled:opacity-50">Approve</button>
        {a.kind === "command" && a.payload?.command && <button onClick={() => decide(true, true)} disabled={!!busy} title="Approve, and never ask again for this exact command"
          className="h-8 px-3.5 rounded-md border border-line text-sm text-ink hover:bg-hover disabled:opacity-50">Always allow</button>}
        <button onClick={() => decide(false)} disabled={!!busy} className="h-8 px-3.5 rounded-md border border-line text-sm text-ink hover:bg-hover disabled:opacity-50">Deny</button>
      </div>
    </div>
  );
}

function SubRun({ t }: { t: Task }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => { if (open) setSeen(true); }, [open]);
  return (
    <div className="border-t border-line first:border-t-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-2.5 px-3 h-10 text-left hover:bg-hover">
        <ChevronRight size={13} className={cx("text-ink-3 transition-transform duration-150 shrink-0", open && "rotate-90")} />
        <span className="text-sm text-ink-2 w-[120px] truncate shrink-0">{t.agent_name || "Unassigned"}</span>
        <span className="flex-1 min-w-0 truncate text-sm text-ink">{t.title}</span>
        <StatusBadge status={t.status} />
      </button>
      <div className={cx("disclose", open && "open")}><div>{(open || seen) && (
        <div className="px-3 pb-3">
          {t.error && <div className="mb-2 text-xs text-bad">{t.error}</div>}
          {t.result && <div className="mb-2 text-sm text-ink-2 whitespace-pre-wrap">{t.result.slice(0, 1200)}</div>}
          <div className="mt-2 -ml-1"><RunTimeline taskId={t.id} live={!['completed', 'failed', 'cancelled'].includes(t.status)} /></div>
        </div>
      )}</div></div>
    </div>
  );
}

function RunPanel({ taskId, bare }: { taskId: string; bare?: boolean }) {
  const { go, select } = useStore();
  const { data: t } = useApi<Task>(`/tasks/${taskId}`, ["task", "approval"]);
  const { data: approvals = [] } = useApi<Approval[]>("/approvals", ["approval", "task"]);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(Date.now() / 1000);
  const { run } = useAction();
  const { steps } = useRunSteps(t && t.kind !== "objective" ? taskId : undefined);
  const live = !!t && !["completed", "failed", "cancelled"].includes(t.status);
  useEffect(() => { if (!live) return; const i = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(i); }, [live]);
  if (!t) return <div className="h-7 w-40 rounded-md bg-hover animate-pulse" />;
  const ids = new Set([t.id, ...(t.children || []).map((c) => c.id)]);
  const pending = approvals.filter((a) => ids.has(a.task_id));
  const isTeam = t.kind === "objective";
  const kids = t.children || [];
  const done = kids.filter((k) => k.status === "completed").length;
  const who = isTeam ? t.team_name || "Team" : t.agent_name || "Agent";
  const started = (t as any).started_at || (t as any).created_at || now;
  const label = live
    ? <>{pending.length ? "Waiting for you" : isTeam && kids.length ? `Working · ${done}/${kids.length} tasks` : "Working"} <span className="tnum opacity-70">{fmtDur(now - started)}</span></>
    : <>{who} · {isTeam && kids.length ? `${done}/${kids.length} tasks` : steps.length ? summarizeSteps(steps) : t.status}</>;
  const body = (
    <div className="space-y-3">
      {isTeam
        ? (kids.length ? <div className="rounded-xl border border-line overflow-hidden">{kids.map((k) => <SubRun key={k.id} t={k} />)}</div>
          : <div className="text-[14px] text-ink-3">{t.status === "planning" ? "The lead is planning the work…" : "No tasks yet."}</div>)
        : <div className="-ml-2"><RunTimeline taskId={t.id} live={live} /></div>}
      <RunMedia taskId={t.id} live={live} />
      {t.error && <div className="text-[13px] text-bad">{t.error}</div>}
    </div>
  );
  if (bare) return <div className="space-y-3">{pending.length > 0 && pending.map((a) => <ApprovalCard key={a.id} a={a} />)}{body}</div>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="chat-disclosure-head min-w-0">
          {live && <AnimatedMark size={18} play="shimmer" />}
          <span className={cx("truncate", live && "chat-shimmer")}>{label}</span>
          <ChevronRight size={15} className={cx("shrink-0 transition-transform duration-200", open && "rotate-90")} />
        </button>
        {!!t.config?.resume_count && <span className="shrink-0 rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-2" title="Atlas restarted during this run and picked it back up">Resumed</span>}
        {t.config?.access_level === "computer_use" && <span className="shrink-0 rounded-full bg-hover px-2 py-0.5 text-[10px] text-ink-2">Computer Use</span>}
        <span className="flex-1" />
        {live && <button onClick={() => run("c", () => api(`/tasks/${t.id}/cancel`, { body: {} }))} className="shrink-0 text-xs text-ink-3 hover:text-ink">Stop</button>}
      </div>
      {pending.length > 0 && <div className="space-y-2">{pending.map((a) => <ApprovalCard key={a.id} a={a} />)}</div>}
      <div className={cx("disclose", open && "open")}><div>{open && <div className="chat-disclosure-body">{body}</div>}</div></div>
    </div>
  );
}

// ---------------------------------------------------------------- messages
const fmtDur = (s: number) => { const n = Math.max(0, Math.round(s)); return n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${n % 60}s`; };
const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const elapsed = (m: ChatMessage) => (m.data?.finished_at ? m.data.finished_at - m.created_at : 0);

function useCopy(): [boolean, (t: string) => void] {
  const [copied, setCopied] = useState(false);
  return [copied, (t: string) => { navigator.clipboard?.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 1400); }];
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} aria-label={label} title={label}
    className="h-8 w-8 rounded-lg flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover transition-colors">{children}</button>;
}

/** Claude-style disclosure: a quiet line of text with a chevron, content tucked under a left rule. */
function Disclosure({ label, live, open, onToggle, children }: {
  label: React.ReactNode; live?: boolean; open: boolean; onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="chat-disclosure">
      <button onClick={onToggle} aria-expanded={open} className="chat-disclosure-head">
        {live && <AnimatedMark size={18} play="shimmer" />}
        <span className={cx(live && "chat-shimmer")}>{label}</span>
        <ChevronRight size={15} className={cx("transition-transform duration-200", open && "rotate-90")} />
      </button>
      <div className={cx("disclose", open && "open")}><div>{children && <div className="chat-disclosure-body">{children}</div>}</div></div>
    </div>
  );
}

function Thinking({ since }: { since: number }) {
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => { const i = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(i); }, []);
  return (
    <div role="status">
      <Disclosure live open={open} onToggle={() => setOpen((o) => !o)} label={<>Thinking <span className="tnum opacity-70">{fmtDur(now - since)}</span></>}>
        <div className="text-[14px] text-ink-3">Waiting for the model to start answering…</div>
      </Disclosure>
    </div>
  );
}

function UserMessage({ m, onEdit }: { m: ChatMessage; onEdit?: (text: string) => void }) {
  const [copied, copy] = useCopy();
  const files: { name: string; type?: string; content?: string }[] = m.data?.attachments || [];
  return (
    <div className="group flex flex-col items-end anim-rise">
      {files.length > 0 && <div className="flex flex-wrap justify-end gap-2 mb-2 max-w-[80%]">{files.map((f) =>
        f.type?.startsWith("image/") && f.content
          ? <img key={f.name} src={`data:${f.type};base64,${f.content}`} alt={f.name} className="h-28 max-w-[220px] rounded-xl object-cover border border-line" />
          : <span key={f.name} className="h-9 px-3 rounded-xl border border-line bg-surface text-sm text-ink-2 flex items-center gap-2"><FileText size={14} />{f.name}</span>)}</div>}
      {m.content && <div className="chat-user-bubble selectable">{m.content}</div>}
      <div className="mt-1 flex items-center gap-0.5 text-xs text-ink-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <span className="tnum px-2">{fmtTime(m.created_at)}</span>
        <IconBtn label={copied ? "Copied" : "Copy"} onClick={() => copy(m.content)}>{copied ? <Check size={15} /> : <Copy size={15} />}</IconBtn>
        {onEdit && <IconBtn label="Edit" onClick={() => onEdit(m.content)}><Pencil size={15} /></IconBtn>}
      </div>
    </div>
  );
}

const MessageView = React.memo(function MessageView({ m, live, providers, onEdit, last, projectId }: { m: ChatMessage; live?: string; providers: Provider[]; onEdit?: (text: string) => void; last?: boolean; projectId?: string }) {
  const [copied, copy] = useCopy();
  const [worked, setWorked] = useState(false);
  if (m.role === "user") return <UserMessage m={m} onEdit={onEdit} />;
  const streaming = m.status === "streaming";
  const text = streaming && live && live.length >= m.content.length ? live : m.content;
  const waiting = (streaming && !text) || (m.status === "running" && !m.content);
  const busy = streaming || m.status === "running";
  const modelProvider = m.data?.provider_id ? providers.find((p) => p.id === m.data.provider_id) : undefined;
  const modelIcon = resolveProviderIconKey({ presetId: modelProvider?.config?.preset_id, kind: modelProvider?.kind, baseUrl: modelProvider?.base_url, name: modelProvider?.name });
  const finishedRun = m.task_id && (m.status === "done" || m.status === "error" || (m.status === "stopped" && !m.data?.interrupted));
  return (
    <div className="group anim-rise flex flex-col gap-4">
      {m.status === "stopped" && m.data?.interrupted && <div className="chat-note">You stopped after {fmtDur(elapsed(m))}</div>}
      {waiting && !m.task_id && <Thinking since={m.created_at} />}
      {m.task_id && (finishedRun
        ? <Disclosure open={worked} onToggle={() => setWorked((o) => !o)} label={`Worked for ${fmtDur(elapsed(m))}`}>{worked && <RunPanel taskId={m.task_id} bare />}</Disclosure>
        : <RunPanel taskId={m.task_id} />)}
      {text && <div className={cx("chat-reply", streaming && "caret")}><PathBase.Provider value={{ taskId: m.task_id, projectId: m.data?.project_id ?? projectId }}><Markdown text={text} /></PathBase.Provider></div>}
      {m.data?.error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--error)]/30 bg-[var(--error-bg)] px-3.5 py-3 text-sm text-bad">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /><span className="selectable">{m.data.error}</span></div>)}
      {!busy && text && (
        <div className={cx("-ml-2 flex items-center gap-0.5 transition-opacity", last ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
          <IconBtn label={copied ? "Copied" : "Copy"} onClick={() => copy(text)}>{copied ? <Check size={15} /> : <Copy size={15} />}</IconBtn>
          {"speechSynthesis" in window && <IconBtn label="Read aloud" onClick={() => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }}><Volume2 size={15} /></IconBtn>}
          {m.data?.mode === "model" && m.data?.model && (
            <span className="ml-2 flex items-center gap-2 text-xs text-ink-3 min-w-0" title={modelProvider?.name}>
              <BrandMark model={m.data.model} fallbackIconKey={modelIcon} label={modelProvider?.name} size={16} />
              <span className="truncate">{m.data.model}</span>
              {m.data?.usage?.completion_tokens != null && <span className="tnum shrink-0">· {m.data.usage.completion_tokens} tokens · {(m.data.latency_ms / 1000).toFixed(1)}s</span>}
              {m.status === "stopped" && <span className="shrink-0">· Stopped</span>}
            </span>)}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------- top bar: activity + conversation settings
function SettingsPopover({ cfg, set, open, onClose }: { cfg: ChatConfig; set: (p: ChatConfig) => void; open: boolean; onClose: () => void }) {
  const [system, setSystem] = useState(cfg.system || "");
  useEffect(() => { if (open) setSystem(cfg.system || ""); }, [open]);
  return (
    <Popover open={open} onClose={() => { if (system !== (cfg.system || "")) set({ system }); onClose(); }} align="right" place="bottom" width={360}>
      <div className="p-2 space-y-3">
        <div className="text-sm font-medium text-ink">Chat settings</div>
        <label className="block">
          <span className="block text-xs text-ink-2 mb-1">Custom instructions</span>
          <textarea value={system} onChange={(e) => setSystem(e.target.value)} onBlur={() => set({ system })} rows={4}
            placeholder="Tell Atlas how to respond or what to prioritize."
            className="w-full px-2.5 py-2 rounded-lg bg-base border border-line text-sm text-ink placeholder:text-ink-3 outline-none focus:border-line-strong resize-y" />
        </label>
        <label className="block">
          <span className="flex justify-between text-xs text-ink-2 mb-1"><span>Temperature</span>
            <span className="tnum text-ink">{cfg.temperature == null ? "Model default" : cfg.temperature.toFixed(1)}</span></span>
          <input type="range" min={0} max={1.5} step={0.1} value={cfg.temperature ?? 0.7} onChange={(e) => set({ temperature: +e.target.value })}
            className="w-full accent-[var(--text)]" aria-label="Temperature" />
          {cfg.temperature != null && <button onClick={() => set({ temperature: null })} className="text-xs text-ink-3 hover:text-ink">Use model default</button>}
        </label>
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------- the view
// Extra chats shown beside the main one. Each pane is its own conversation with its own model,
// and every pane can be running at the same time.
const PANES_KEY = "atlas_chat_panes";
const loadPanes = (): (string | null)[] => { try { const v = JSON.parse(localStorage.getItem(PANES_KEY) || "[]"); return Array.isArray(v) ? v.slice(0, 3) : []; } catch { return []; } };
const MAX_PANES = 3;

export function Chat() {
  const { route } = useStore();
  const [panes, setPanesState] = useState<(string | null)[]>(loadPanes);
  const setPanes = (next: (string | null)[]) => { setPanesState(next); try { localStorage.setItem(PANES_KEY, JSON.stringify(next)); } catch {} };
  const addPane = () => { if (panes.length < MAX_PANES) setPanes([...panes, null]); };
  const split = panes.length > 0;
  return (
    <div className="flex-1 min-w-0 h-full flex">
      <ChatInner key={route.id || "new"} id={route.id} split={split} canSplit={panes.length < MAX_PANES} onSplit={addPane} />
      {panes.map((pid, i) => (
        <div key={i} className="flex-1 min-w-0 h-full flex border-l border-line">
          <ChatInner key={pid || `new-${i}`} id={pid || undefined} split pane
            canSplit={panes.length < MAX_PANES} onSplit={addPane}
            onOpen={(cid) => setPanes(panes.map((x, j) => (j === i ? cid : x)))}
            onClose={() => setPanes(panes.filter((_, j) => j !== i))} />
        </div>
      ))}
    </div>
  );
}

function ChatInner({ id, split, pane, canSplit, onSplit, onOpen, onClose }: {
  id?: string; split?: boolean; pane?: boolean; canSplit?: boolean; onSplit?: () => void;
  onOpen?: (id: string) => void; onClose?: () => void;
}) {
  const { go: goRoute, settings } = useStore();
  // a side pane keeps its own conversation instead of changing the app's route
  const go = (r: { name: string; id?: string }) => (pane && r.name === "chat" ? (r.id ? onOpen?.(r.id) : onClose?.()) : goRoute(r as any));
  const { providers: chatProviders } = useHarnessData();
  const wide = settings?.["chat.width"] === "wide";
  const toast = useToast();
  const { data: loadedConv, error, setData } = useApi<ConversationFull>(id ? `/conversations/${id}` : null, ["conversation"]);
  // useApi keeps the previous chat's data until the new one arrives; never show chat A under chat B's id.
  const conv = loadedConv && loadedConv.id === id ? loadedConv : undefined;
  const [draft, setDraftState] = useState<ChatConfig>(loadDraft);
  const setDraft = (c: ChatConfig) => setDraftState(c);
  // Chat is mounted behind Welcome; pick up the model chosen there when setup finishes.
  useEffect(() => {
    if (!id && settings?.["onboarding.completed"]) setDraft(loadDraft());
  }, [id, settings?.["onboarding.completed"]]);
  useEffect(() => {
    if (id) return;
    const cleaned = clearHermesPlaceholder(loadDraft(), chatProviders);
    if (cleaned) { setDraft(cleaned); saveDraft(cleaned); }
  }, [id, chatProviders, settings?.["onboarding.completed"]]);
  const [live, setLive] = useState<Record<string, string>>({});
  const msgsRef = useRef<ChatMessage[]>([]);
  const online = useConnected();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionPref, setSession] = useState(() => localStorage.getItem("atlas_session") !== "0");
  const session = sessionPref && !split;
  const toggleSession = () => setSession((v) => { localStorage.setItem("atlas_session", v ? "0" : "1"); return !v; });
  const [seed, setSeed] = useState<{ text: string; n: number } | undefined>();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const convConfig = conv?.config;
  const cfg: ChatConfig = useMemo(() => (id && convConfig ? { ...draft, ...convConfig } : draft), [id, convConfig, draft]);
  const onEdit = useCallback((t: string) => setSeed({ text: t, n: Date.now() }), []);

  const setCfg = (p: ChatConfig) => {
    const next = { ...cfg, ...p };
    const modelChanged = ["mode", "provider_id", "model", "agent_id", "team_id"].some((key) => (cfg as any)[key] !== (next as any)[key]);
    if (modelChanged && cfg.access_level === "computer_use") {
      next.access_level = "workspace";
      next.computer_consent_for = undefined;
    }
    setDraft(next); if (!pane) saveDraft(next);
    if (id && conv) { setData({ ...conv, config: next }); api(`/conversations/${id}`, { method: "PATCH", body: { config: next } }).catch(() => {}); }
  };

  // streaming deltas
  useEffect(() => subscribe((m) => {
    // Coming back to a chat mid-reply: continue from the text saved so far, not from empty.
    // reconnected: drop half-received text; the reloaded messages carry everything saved so far
    if (m.kind === "changed" && m.entity === "*") { setLive({}); return; }
    if (m.kind === "chat_delta" && m.conversation_id === id) setLive((l) => ({ ...l, [m.message_id]: (l[m.message_id] ?? (msgsRef.current.find((x) => x.id === m.message_id)?.content || "")) + m.delta }));
  }), [id]);

  const messages = conv?.messages || [];
  msgsRef.current = messages;
  const busy = messages.some((m) => m.status === "streaming" || m.status === "running");
  const liveLen = Object.values(live).reduce((a, s) => a + s.length, 0);
  const renderedMessages: React.ReactNode[] = [];
  const renderedCompareGroups = new Set<string>();
  messages.forEach((m, index) => {
    const groupId = m.data?.compare_group as string | undefined;
    if (!groupId) {
      renderedMessages.push(<MessageView key={m.id} m={m} live={live[m.id]} providers={chatProviders} last={index === messages.length - 1} onEdit={onEdit} projectId={cfg.project_id} />);
      return;
    }
    if (renderedCompareGroups.has(groupId)) return;
    renderedCompareGroups.add(groupId);
    const responses = messages.filter((item) => item.data?.compare_group === groupId);
    renderedMessages.push(<div key={groupId} role="group" aria-label={`Responses from ${responses.length} models`} className="grid grid-cols-1 min-[620px]:grid-cols-2 gap-3">
      {responses.map((response, responseIndex) => {
        const provider = chatProviders.find((item) => item.id === response.data?.provider_id);
        const icon = resolveProviderIconKey({ presetId: provider?.config?.preset_id, kind: provider?.kind, baseUrl: provider?.base_url, name: provider?.name });
        return <article key={response.id} className="min-w-0 rounded-xl border border-line bg-surface/60 p-3.5">
          <div className="flex items-center gap-2 min-w-0 mb-3 text-xs text-ink-2">
            <BrandMark model={response.data?.model} fallbackIconKey={icon} label={provider?.name} size={18} />
            <span className="truncate font-medium text-ink">{response.data?.model}</span>
            <span className="truncate text-ink-3">{provider?.name || "Provider"}</span>
            {(response.status === "streaming" || response.status === "running") && <span className="ml-auto shrink-0 text-ink-3">Generating</span>}
            {response.status === "error" && <span className="ml-auto shrink-0 text-bad">Failed</span>}
          </div>
          <MessageView m={response} live={live[response.id]} providers={chatProviders} last={index + responses.length === messages.length && responseIndex === responses.length - 1} projectId={cfg.project_id} />
        </article>;
      })}
    </div>);
  });

  // auto-scroll while the reader is at the bottom
  useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages.length, liveLen, conv?.messages]);
  const onScroll = () => { const el = scroller.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (!pane && (e.metaKey || e.ctrlKey) && e.key === ".") { e.preventDefault(); stop(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const send = async (text: string, attachments: Attachment[]) => {
    const mode = cfg.mode || "model";
    if (mode === "model" && (!cfg.provider_id || !cfg.model)) { toast("Choose a model first.", "bad"); return false; }
    try {
      let sendCfg = cfg;
      if (mode === "auto_team") {
        sendCfg = await prepareAutoTeamConfig(cfg, text, attachments);
        setCfg(sendCfg);
      }
      let cid = id;
      if (!cid) {
        const c = await api<{ id: string }>("/conversations", { body: { config: sendCfg } });
        cid = c.id;
      }
      stick.current = true;
      await api(`/conversations/${cid}/messages`, { body: { content: text, attachments, config: sendCfg } });
      if (!id) go({ name: "chat", id: cid });
      return true;
    } catch (e: any) { toast(e.message || String(e), "bad"); return false; }
  };
  const stop = () => { if (id && busy) api(`/conversations/${id}/stop`, { body: {} }).catch((e) => toast(e.message, "bad")); };

  const empty = !id || (conv && messages.length === 0);
  const notFound = id && error;

  return (
    <div className="relative flex-1 min-w-0 h-full flex">
      <div className="relative flex-1 min-w-0 h-full flex flex-col">
        <header className={cx("drag absolute top-0 inset-x-0 h-[64px] z-10 flex items-center justify-end gap-3 px-6 pt-2", !empty && "bg-[var(--base)]")}>
          {id && conv && !empty && <div className="absolute left-6 top-[22px] text-sm text-ink-2 truncate max-w-[50%]">{conv.title}</div>}
          {canSplit && <button onClick={onSplit} aria-label="Open another chat side by side" title="New chat side by side"
            className="no-drag h-8 w-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover"><Columns2 size={18} strokeWidth={1.6} /></button>}
          {pane && <button onClick={onClose} aria-label="Close this chat pane" title="Close pane"
            className="no-drag h-8 w-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover"><X size={18} strokeWidth={1.6} /></button>}
          {!empty && !split && <button onClick={toggleSession} aria-label="Session details" title="Session details" aria-pressed={session}
            className={cx("no-drag h-8 w-8 rounded-md flex items-center justify-center", session ? "bg-active text-ink" : "text-ink-2 hover:text-ink hover:bg-hover")}><PanelRight size={18} strokeWidth={1.6} /></button>}
          <div className="relative">
            <button onClick={() => setSettingsOpen((o) => !o)} aria-label="Chat settings" title="Chat settings" aria-expanded={settingsOpen}
              className={cx("no-drag h-8 w-8 rounded-md flex items-center justify-center", settingsOpen ? "bg-active text-ink" : "text-ink-2 hover:text-ink hover:bg-hover")}>
              <SlidersHorizontal size={18} strokeWidth={1.6} /></button>
            <SettingsPopover cfg={cfg} set={setCfg} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          </div>
        </header>

        {notFound ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="text-lg text-ink">This chat no longer exists.</div>
            <button onClick={() => go({ name: "chat" })} className="h-8 px-3 rounded-md border border-line text-sm text-ink hover:bg-hover">Start a new chat</button>
          </div>
        ) : id && !conv ? (
          <div className="flex-1" aria-busy="true" />
        ) : empty ? (
          <div className="relative flex-1 overflow-y-auto">
            {!split && <Starfield />}
            <div className="stagger relative min-h-full flex flex-col items-center justify-center px-8 pb-[8vh]">
              <AtlasMark size={40} className="text-ink" />
              <h1 className={cx("chat-greeting mt-5 text-ink", split && "!text-[26px]")}>{pane ? "Pick a model and ask" : "What should we work on?"}</h1>
              <div className="mt-8 w-full max-w-[760px]">
                <Composer cfg={cfg} setCfg={setCfg} onSend={send} busy={false} onStop={stop} big seed={seed} />
              </div>
              {!split && <div className="mt-4 w-full max-w-[760px] flex flex-wrap justify-center gap-2">
                {STARTERS.map(({ icon: Icon, label, text }) => (
                  <button key={label} onClick={() => setSeed({ text, n: Date.now() })}
                    className="h-8 px-3 rounded-full border border-line text-sm text-ink-2 hover:text-ink hover:bg-hover flex items-center gap-1.5">
                    <Icon size={14} strokeWidth={1.7} />{label}
                  </button>))}
              </div>}
            </div>
          </div>
        ) : (
          <>
            <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
              <div className={cx("mx-auto px-6 pt-[88px] pb-16 flex flex-col gap-9", wide ? "max-w-[1000px]" : "max-w-[768px]")}>
                {!conv && <div className="flex justify-center py-16"><Loader2 size={18} className="animate-spin text-ink-3" /></div>}
                {renderedMessages}
              </div>
            </div>
            <div className="shrink-0 px-6 pb-5 pt-1 chat-composer-dock">
              <div className={cx("mx-auto", wide ? "max-w-[1000px]" : "max-w-[768px]")}>
                {!online && <div role="status" className="mb-2 mx-auto w-fit flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2">
                  <span className="working-spinner" />Reconnecting… running work keeps going and will resume</div>}
                <Composer cfg={cfg} setCfg={setCfg} onSend={send} busy={busy} onStop={stop} />
                <div className="mt-2.5 text-center text-[11.5px] text-ink-3">Atlas can make mistakes. Agents work on isolated branches, and git changes ask first.</div>
              </div>
            </div>
          </>
        )}
      </div>
      {session && !empty && !notFound && <SessionPanel messages={messages} cfg={cfg} onClose={toggleSession} />}
    </div>
  );
}
