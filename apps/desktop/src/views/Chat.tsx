import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Square, Plus, Box, Wrench, ChevronDown, Check, X, FileText, Users, Bot, ChevronRight,
  Copy, AlertCircle, Terminal, SlidersHorizontal, ExternalLink, Loader2, Code2, Layers, Sparkles, PanelRight, Cpu,
} from "lucide-react";
import { Agent, api, Approval, Model, Project, Provider, subscribe, Task, Team, useApi } from "../api";
import { BrandMark, brandFor } from "../components/Brand";
import { SessionPanel } from "../components/SessionPanel";
import { ProviderIcon, resolveProviderIconKey } from "../components/Endpoints";
import { useStore } from "../store";
import { cx, StatusBadge, useAction, useToast } from "../components/ui";
import { AtlasMark } from "../components/Logo";
import { AnimatedMark } from "../components/AnimatedMark";
import { Markdown } from "../components/Markdown";
import { ExecutionViewer } from "../components/Execution";

// ---------------------------------------------------------------- types & config
export interface ChatConfig {
  mode?: "model" | "agent" | "team"; provider_id?: string; model?: string; agent_id?: string; team_id?: string;
  tools?: string[]; project_id?: string; system?: string; temperature?: number | null;
}
interface ChatMessage {
  id: string; conversation_id: string; role: "user" | "assistant"; content: string;
  status: "done" | "streaming" | "running" | "error" | "stopped"; task_id?: string; data: Record<string, any>; created_at: number;
}
interface ConversationFull { id: string; title: string; config: ChatConfig; messages: ChatMessage[] }

const DRAFT_KEY = "atlas_chat_draft_cfg";
export const loadDraft = (): ChatConfig => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch { return {}; } };
export const saveDraft = (c: ChatConfig) => localStorage.setItem(DRAFT_KEY, JSON.stringify(c));

const TOOLS: { id: string; label: string; icon?: string }[] = [
  { id: "project", label: "Project context" },
  { id: "read", label: "Read files" },
  { id: "write", label: "Edit files" },
  { id: "shell", label: "Terminal" },
  { id: "git", label: "Git" },
  { id: "memory", label: "Memory" },
  { id: "mcp", label: "MCP integrations" },
];
const TOOL_HINT: Record<string, string> = {
  project: "Adds the project's file list and README to the model's context",
  read: "Read files, list folders, search", write: "Create and edit files on an isolated branch",
  shell: "Run commands; risky ones ask for approval", git: "Status, diff, commit on the run's branch",
  memory: "Save notes to team and project memory", mcp: "Call configured MCP servers",
};
const MAX_FILE = 200_000;

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
      className="w-full flex items-start gap-2 px-2.5 py-1.5 rounded-[6px] text-left text-sm text-ink hover:bg-hover disabled:opacity-40">
      <span className="min-w-0 flex-1"><span className="block truncate">{children}</span>{hint && <span className="block text-xs text-ink-3 truncate">{hint}</span>}</span>
      <span className="w-4 shrink-0 pt-0.5">{active && <Check size={14} />}</span>
    </button>
  );
}
function Chip({ icon, label, onClick, open, disabled, title, iconBox }: {
  icon: React.ReactNode; label: string; onClick: () => void; open: boolean; disabled?: boolean; title?: string; iconBox?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-haspopup="menu" aria-expanded={open}
      className={cx("h-8 rounded-full flex items-center text-sm text-ink-2 hover:text-ink no-drag disabled:opacity-50",
        iconBox ? "max-w-[250px] pl-1 pr-2.5 gap-1.5" : "max-w-[220px] px-2.5 gap-1.5",
        open ? "bg-active text-ink" : "hover:bg-hover")}>
      <span className={cx("shrink-0 flex items-center justify-center", iconBox && "h-6 w-6 rounded-full bg-hover text-ink")}>{icon}</span>
      <span className="truncate">{label}</span>
      <ChevronDown size={13} className="shrink-0 text-ink-3" />
    </button>
  );
}

// ---------------------------------------------------------------- selectors
function useHarnessData() {
  const { data: agents = [] } = useApi<Agent[]>("/agents", ["agent"]);
  const { data: teams = [] } = useApi<Team[]>("/teams", ["team"]);
  const { data: models = [], loading: modelsLoading } = useApi<Model[]>("/models", ["provider", "model"]);
  const { data: providers = [] } = useApi<Provider[]>("/providers", ["provider"]);
  const { data: projects = [] } = useApi<Project[]>("/projects", ["project"]);
  return { agents, teams, models, modelsLoading, providers, projects };
}

function AgentMenu({ cfg, set, h }: { cfg: ChatConfig; set: (p: ChatConfig) => void; h: ReturnType<typeof useHarnessData> }) {
  const [open, setOpen] = useState(false);
  const { go } = useStore();
  const mode = cfg.mode || "model";
  const agent = h.agents.find((a) => a.id === cfg.agent_id);
  const team = h.teams.find((t) => t.id === cfg.team_id);
  const label = mode === "agent" && agent ? agent.name : mode === "team" && team ? team.name : "Agent";
  const pick = (p: ChatConfig) => { set(p); setOpen(false); };
  const agents = h.agents.filter((a) => !a.config?.chat_assistant);
  return (
    <div className="relative">
      <Chip icon={<Box size={16} strokeWidth={1.6} />} label={label} open={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} width={320}>
        <MenuRow active={mode === "model"} onClick={() => pick({ mode: "model", agent_id: undefined, team_id: undefined })} hint="Answer directly with the selected model">No agent</MenuRow>
        <MenuLabel>Agents</MenuLabel>
        {agents.length === 0 && <div className="px-2.5 pb-2 text-xs text-ink-3">No agents yet.</div>}
        {agents.map((a) => (
          <MenuRow key={a.id} active={mode === "agent" && cfg.agent_id === a.id} onClick={() => pick({ mode: "agent", agent_id: a.id, team_id: undefined })}
            hint={`${a.role}${a.team_name ? ` · ${a.team_name}` : ""} · ${a.model || "no model"}`}>{a.name}</MenuRow>
        ))}
        <MenuLabel>Teams</MenuLabel>
        {h.teams.length === 0 && <div className="px-2.5 pb-2 text-xs text-ink-3">No teams yet.</div>}
        {h.teams.map((t) => (
          <MenuRow key={t.id} active={mode === "team" && cfg.team_id === t.id} onClick={() => pick({ mode: "team", team_id: t.id, agent_id: undefined })}
            hint={`${t.agent_count} agents · the lead plans and delegates`}>{t.name}</MenuRow>
        ))}
        <div className="h-px bg-line my-1.5" />
        <MenuRow onClick={() => { setOpen(false); go({ name: "agents" }); }}>Manage agents and teams…</MenuRow>
      </Popover>
    </div>
  );
}

function ModelMenu({ cfg, set, h }: { cfg: ChatConfig; set: (p: ChatConfig) => void; h: ReturnType<typeof useHarnessData> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { go } = useStore();
  const mode = cfg.mode || "model";
  const agent = h.agents.find((a) => a.id === cfg.agent_id);
  const locked = mode !== "model";
  const label = mode === "agent" ? (agent?.model || "Model") : mode === "team" ? "Team models" : (cfg.model || "Select model");
  const statusOf = (pid: string) => h.providers.find((p) => p.id === pid)?.status || "unknown";
  const selectedModel = h.models.find((m) => m.provider_id === cfg.provider_id && m.name === cfg.model);
  const selectedProvider = h.providers.find((p) => p.id === cfg.provider_id);
  const selectedIcon = resolveProviderIconKey({ presetId: selectedProvider?.config?.preset_id || selectedModel?.provider_preset_id, kind: selectedProvider?.kind || selectedModel?.provider_kind, baseUrl: selectedProvider?.base_url, name: selectedProvider?.name || selectedModel?.provider_name });
  const groups = useMemo(() => {
    const g: Record<string, { name: string; status: string; items: Model[]; provider?: Provider }> = {};
    for (const m of h.models) {
      if (!m.name) continue;
      if (q && !m.name.toLowerCase().includes(q.toLowerCase())) continue;
      const provider = h.providers.find((p) => p.id === m.provider_id);
      (g[m.provider_id] ||= { name: provider?.name || m.provider_name, status: statusOf(m.provider_id), items: [], provider }).items.push(m);
    }
    return Object.entries(g);
  }, [h.models, h.providers, q]);
  const unavailable = h.providers.filter((p) => p.enabled && !h.models.some((m) => m.provider_id === p.id && m.name));
  return (
    <div className="relative">
      <Chip iconBox icon={cfg.model ? <BrandMark model={cfg.model} fallbackIconKey={selectedIcon} label={selectedProvider?.name || selectedModel?.provider_name} size={24} /> : <Cpu size={15} strokeWidth={1.6} />} label={label} open={open} onClick={() => setOpen((o) => !o)} disabled={locked}
        title={locked ? (mode === "agent" ? "This agent uses its own model. Change it on the Agents page." : "Each team agent uses its own model.") : label} />
      <Popover open={open} onClose={() => setOpen(false)} width={380}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" aria-label="Search models"
          className="w-full h-10 mb-2 px-3 rounded-md bg-hover border border-line text-base text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" />
        <div className="max-h-[360px] overflow-y-auto">
        {h.modelsLoading && <div className="px-2.5 py-3 text-sm text-ink-3 flex items-center gap-2"><Loader2 size={13} className="animate-spin" />Loading models…</div>}
        {!h.modelsLoading && groups.length === 0 && <div className="px-2.5 py-3 text-sm text-ink-3">{q ? "No models match." : "No models available. Connect a provider on the Models page."}</div>}
        {groups.map(([pid, g]) => (
          <div key={pid}>
            <div className="flex items-center gap-2 px-2.5 pt-3 pb-1.5 text-xs text-ink-3">
              <span className="truncate uppercase tracking-[0.06em] text-2xs">{g.name}</span>
              <span className={cx("h-1.5 w-1.5 rounded-full", g.status === "connected" ? "bg-ok" : g.status === "failed" || g.status === "unavailable" ? "bg-bad" : "bg-ink-3")} />
              <span className="ml-auto">{g.status === "connected" ? "Connected" : g.status === "failed" ? "Unavailable" : ""}</span>
            </div>
            {g.items.map((m) => (
              <MenuRow key={pid + m.name} active={cfg.provider_id === pid && cfg.model === m.name}
                onClick={() => { set({ provider_id: pid, model: m.name! }); setOpen(false); }}
                hint={[m.details?.parameter_size, m.context_length ? `${Math.round(m.context_length / 1024)}k ctx` : null,
                  m.capabilities?.tools === true ? "tools" : null, m.capabilities?.vision ? "vision" : null, m.state === "loaded" ? "loaded" : null].filter(Boolean).join(" · ") || undefined}>
                <span className="flex items-center gap-2.5 min-w-0"><BrandMark model={m.name} fallbackIconKey={resolveProviderIconKey({ presetId: g.provider?.config?.preset_id, kind: g.provider?.kind || m.provider_kind, baseUrl: g.provider?.base_url, name: g.name })} label={g.name} size={26} /><span className="truncate text-base">{m.name}</span></span>
              </MenuRow>
            ))}
          </div>
        ))}
        {unavailable.length > 0 && !q && (
          <div className="px-2.5 pt-2 pb-1 text-xs text-ink-3">{unavailable.map((p) => `${p.name} ${p.last_error ? "isn't running" : "has no models yet"}`).join(" · ")}.</div>
        )}
        </div>
        <div className="h-px bg-line my-1.5" />
        <MenuRow onClick={() => { setOpen(false); go({ name: "models" }); }}>Manage models…</MenuRow>
      </Popover>
    </div>
  );
}

function ToolsMenu({ cfg, set, h, groups }: { cfg: ChatConfig; set: (p: ChatConfig) => void; h: ReturnType<typeof useHarnessData>; groups: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const tools = cfg.tools || [];
  const mode = cfg.mode || "model";
  const agent = h.agents.find((a) => a.id === cfg.agent_id);
  const toggle = (id: string) => set({ tools: tools.includes(id) ? tools.filter((t) => t !== id) : [...tools, id] });
  const available = TOOLS.filter((t) => t.id === "project" || groups[t.id]);
  const allowedByAgent = (id: string) => mode !== "agent" || !agent || id === "project" || (agent.tools || []).includes(id);
  return (
    <div className="relative">
      <Chip icon={<Wrench size={16} strokeWidth={1.6} />} label={tools.length ? `Tools · ${tools.length}` : "Tools"} open={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} width={330}>
        <MenuLabel>Project</MenuLabel>
        <div className="px-1.5 pb-1">
          <select value={cfg.project_id || ""} onChange={(e) => set({ project_id: e.target.value || undefined })} aria-label="Project"
            className="w-full h-8 px-2 rounded-md bg-base border border-line text-sm text-ink outline-none">
            <option value="">No project (scratch folder)</option>
            {h.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <MenuLabel>Capabilities</MenuLabel>
        {available.map((t) => {
          const ok = allowedByAgent(t.id);
          return (
            <button key={t.id} onClick={() => ok && toggle(t.id)} disabled={!ok} role="menuitemcheckbox" aria-checked={tools.includes(t.id)}
              className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-hover disabled:opacity-40">
              <span className={cx("mt-0.5 h-4 w-4 rounded-sm border flex items-center justify-center shrink-0", tools.includes(t.id) ? "bg-ink border-ink text-[var(--base)]" : "border-line-strong")}>
                {tools.includes(t.id) && <Check size={11} strokeWidth={3} />}</span>
              <span className="min-w-0"><span className="block text-sm text-ink">{t.label}</span>
                <span className="block text-xs text-ink-3">{ok ? TOOL_HINT[t.id] : `${agent?.name} doesn't have this permission`}</span></span>
            </button>
          );
        })}
        <div className="px-2.5 pt-2 pb-1.5 text-xs text-ink-3 leading-relaxed">
          {mode === "model" ? "With file, terminal or git tools, the model runs as the Atlas Assistant agent in a sandbox." :
            mode === "agent" ? "Selected tools narrow this agent's permissions for the run. None selected: the agent's own permissions." :
              "Team agents use their own permissions."} Risky commands always ask first.
        </div>
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------- composer
export interface Attachment { name: string; content: string; size: number }

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
  const { data: meta } = useApi<any>("/meta");
  const toast = useToast();
  const [text, setText] = useState("");
  const [att, setAtt] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
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
      if (f.size > MAX_FILE) { toast(`${f.name} is larger than 200 KB. Attach a smaller text file.`, "bad"); continue; }
      const content = await f.text();
      if (/\u0000/.test(content.slice(0, 2000))) { toast(`${f.name} looks binary. Only text files can be attached.`, "bad"); continue; }
      setAtt((a) => [...a.filter((x) => x.name !== f.name), { name: f.name, content, size: f.size }]);
    }
  };
  const submit = async () => {
    if (busy) return;
    if (!text.trim() && !att.length) return;
    setSending(true);
    const ok = await onSend(text, att);
    setSending(false);
    if (ok) { setText(""); setAtt([]); }
    ta.current?.focus();
  };
  const canSend = (text.trim() || att.length) && !sending;
  return (
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      className={cx("w-full rounded-[20px] bg-surface border border-line px-4 pt-3.5 pb-2.5 shadow-[var(--shadow-md)] transition-[box-shadow,border-color] duration-200",
        drag ? "ring-1 ring-[var(--ring)]" : "focus-within:border-line-strong")}>
      {att.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {att.map((a) => (
            <span key={a.name} className="h-7 pl-2 pr-1 rounded-md bg-surface border border-line flex items-center gap-1.5 text-xs text-ink">
              <FileText size={13} className="text-ink-2" />{a.name}<span className="text-ink-3">{(a.size / 1024).toFixed(1)} KB</span>
              <button onClick={() => setAtt((x) => x.filter((y) => y.name !== a.name))} aria-label={`Remove ${a.name}`} className="h-5 w-5 rounded flex items-center justify-center text-ink-3 hover:text-ink"><X size={12} /></button>
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
      <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={1} aria-label="Message Atlas" spellCheck={appSettings?.["chat.spellcheck"] !== false}
        placeholder="Message Atlas..."
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
        className={cx("composer-input w-full resize-none bg-transparent outline-none text-lg leading-6 text-ink placeholder:text-ink-3", big ? "min-h-[48px]" : "min-h-[28px]")} />
      <div className="flex items-center gap-1 mt-2 -mx-1.5">
        <input ref={file} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <button onClick={() => file.current?.click()} aria-label="Attach files" title="Attach text files"
          className="h-8 w-8 rounded-full flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover shrink-0"><Plus size={18} strokeWidth={1.6} /></button>
        <AgentMenu cfg={cfg} set={setCfg} h={h} />
        <ModelMenu cfg={cfg} set={setCfg} h={h} />
        <ToolsMenu cfg={cfg} set={setCfg} h={h} groups={meta?.permission_groups || {}} />
        <div className="flex-1" />
        {busy ? (
          <button onClick={onStop} aria-label="Stop" title="Stop  ⌘."
            className="h-8 w-8 rounded-full bg-ink text-[var(--base)] flex items-center justify-center hover:opacity-90 shrink-0"><Square size={13} fill="currentColor" /></button>
        ) : (
          <button onClick={submit} disabled={!canSend} aria-label="Send message" title={settings?.["chat.send_key"] === "mod_enter" ? "Send  ⌘↵" : "Send  ↵"}
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
  const decide = (approved: boolean) => run(a.id, () => api(`/approvals/${a.id}`, { body: { approved } }));
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
          <div className="rounded-md border border-line overflow-hidden"><ExecutionViewer taskId={t.id} height={260} showFilters={false} /></div>
        </div>
      )}</div></div>
    </div>
  );
}

function RunPanel({ taskId }: { taskId: string }) {
  const { go, select } = useStore();
  const { data: t } = useApi<Task>(`/tasks/${taskId}`, ["task", "approval"]);
  const { data: approvals = [] } = useApi<Approval[]>("/approvals", ["approval", "task"]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => { if (open) setSeen(true); }, [open]);
  const { run } = useAction();
  if (!t) return <div className="h-11 rounded-lg border border-line bg-surface animate-pulse" />;
  const ids = new Set([t.id, ...(t.children || []).map((c) => c.id)]);
  const pending = approvals.filter((a) => ids.has(a.task_id));
  const live = !["completed", "failed", "cancelled"].includes(t.status);
  const isTeam = t.kind === "objective";
  const kids = t.children || [];
  const done = kids.filter((k) => k.status === "completed").length;
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="flex items-center gap-2.5 pl-3 pr-2 h-11">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
          <ChevronRight size={14} className={cx("text-ink-3 transition-transform duration-150 shrink-0", open && "rotate-90")} />
          {isTeam ? <Users size={15} strokeWidth={1.6} className="text-ink-2 shrink-0" /> : <Bot size={15} strokeWidth={1.6} className="text-ink-2 shrink-0" />}
          <span className="text-sm text-ink font-medium shrink-0">{isTeam ? t.team_name || "Team" : t.agent_name || "Agent"}</span>
          <span className="text-sm text-ink-2 truncate">{isTeam && kids.length ? `${done}/${kids.length} tasks` : t.title}</span>
          {live && <AnimatedMark size={16} play="shimmer" className="shrink-0" />}
        </button>
        <StatusBadge status={t.status} />
        {live && <button onClick={() => run("c", () => api(`/tasks/${t.id}/cancel`, { body: {} }))} title="Stop this run"
          className="h-7 px-2 rounded-md text-xs text-ink-2 hover:text-ink hover:bg-hover">Stop</button>}
        <button onClick={() => { go({ name: "tasks" }); setTimeout(() => select({ kind: "task", id: t.id }), 0); }} aria-label="Open in Runs" title="Open in Runs"
          className="h-7 w-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover"><ExternalLink size={13} /></button>
      </div>
      {pending.length > 0 && <div className="px-3 pb-3 space-y-2">{pending.map((a) => <ApprovalCard key={a.id} a={a} />)}</div>}
      {t.error && !open && <div className="px-3 pb-3 -mt-1 text-xs text-bad truncate">{t.error}</div>}
      <div className={cx("disclose", open && "open")}><div>{(open || seen) && (
        <div className="border-t border-line">
          {isTeam ? (
            kids.length ? kids.map((k) => <SubRun key={k.id} t={k} />) :
              <div className="px-3 py-3 text-sm text-ink-3">{t.status === "planning" ? "The lead is planning the work…" : "No tasks yet."}</div>
          ) : (
            <div className="p-3"><div className="rounded-md border border-line overflow-hidden"><ExecutionViewer taskId={t.id} height={300} showFilters={false} /></div></div>
          )}
        </div>
      )}</div></div>
    </div>
  );
}

// ---------------------------------------------------------------- messages
function MessageView({ m, live }: { m: ChatMessage; live?: string }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") {
    const files: { name: string }[] = m.data?.attachments || [];
    return (
      <div className="flex justify-end anim-rise">
        <div className="max-w-[78%] rounded-[20px] bg-[var(--accent-bg)] px-4 py-2.5">
          {files.length > 0 && <div className="flex flex-wrap gap-1.5 mb-1.5">{files.map((f) => (
            <span key={f.name} className="h-6 px-2 rounded-sm bg-active text-xs text-ink-2 flex items-center gap-1"><FileText size={12} />{f.name}</span>))}</div>}
          <div className="selectable text-base leading-6 text-ink whitespace-pre-wrap break-words">{m.content}</div>
        </div>
      </div>
    );
  }
  const streaming = m.status === "streaming";
  const text = streaming && live && live.length >= m.content.length ? live : m.content;
  const waiting = (streaming && !text) || (m.status === "running" && !m.content);
  return (
    <div className="group flex gap-3.5 anim-rise">
      <div className="h-7 w-7 shrink-0 rounded-md border border-line flex items-center justify-center text-ink mt-0.5">
        {streaming || m.status === "running" ? <AnimatedMark size={15} play="shimmer" /> : <AtlasMark size={15} />}</div>
      <div className="min-w-0 flex-1 space-y-3">
        {m.data?.mode === "model" && m.data?.model && <div className="text-xs text-ink-3 font-mono -mb-1">{m.data.model}</div>}
        {m.task_id && <RunPanel taskId={m.task_id} />}
        {waiting && !m.task_id && <div className="h-6 flex items-center gap-2 text-sm text-ink-3" role="status"><AnimatedMark size={22} play="shimmer" /><span className="am-thinking">Thinking…</span></div>}
        {text && <div className={cx(streaming && "caret")}><Markdown text={text} /></div>}
        {m.status === "error" && m.data?.error && (
          <div className="flex items-start gap-2 text-sm text-bad"><AlertCircle size={15} className="mt-0.5 shrink-0" /><span className="selectable">{m.data.error}</span></div>)}
        {m.status === "stopped" && <div className="text-xs text-ink-3">Stopped.</div>}
        {!streaming && m.status !== "running" && text && (
          <div className="h-7 -ml-1.5 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }} aria-label="Copy reply"
              className="h-7 px-1.5 rounded-sm flex items-center gap-1 text-xs text-ink-3 hover:text-ink hover:bg-hover">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button>
            {m.data?.usage?.completion_tokens != null && <span className="ml-2 text-xs text-ink-3 tnum">{m.data.usage.completion_tokens} tokens · {(m.data.latency_ms / 1000).toFixed(1)} s</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- top bar: activity + conversation settings
function SettingsPopover({ cfg, set, open, onClose }: { cfg: ChatConfig; set: (p: ChatConfig) => void; open: boolean; onClose: () => void }) {
  const [system, setSystem] = useState(cfg.system || "");
  useEffect(() => { if (open) setSystem(cfg.system || ""); }, [open]);
  return (
    <Popover open={open} onClose={() => { if (system !== (cfg.system || "")) set({ system }); onClose(); }} align="right" place="bottom" width={360}>
      <div className="p-2 space-y-3">
        <div className="text-sm font-medium text-ink">Chat settings</div>
        <label className="block">
          <span className="block text-xs text-ink-2 mb-1">System instructions (model chats)</span>
          <textarea value={system} onChange={(e) => setSystem(e.target.value)} onBlur={() => set({ system })} rows={4}
            placeholder="Default: concise, helpful Atlas assistant."
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

function ActivityDrawer({ onClose }: { onClose: () => void }) {
  return (
    <aside className="anim-rise w-[400px] max-[1000px]:absolute max-[1000px]:right-0 max-[1000px]:top-0 max-[1000px]:bottom-0 max-[1000px]:z-30 shrink-0 h-full border-l border-line bg-[var(--sidebar)] flex flex-col fade-in">
      <div className="drag h-[64px] shrink-0 flex items-center justify-between pl-4 pr-3 pt-2">
        <span className="text-base font-medium text-ink">Live activity</span>
        <button onClick={onClose} aria-label="Close activity" className="no-drag h-8 w-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover"><X size={16} /></button>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-3"><div className="h-full rounded-xl border border-line overflow-hidden"><ExecutionViewer height="100%" showFilters={false} /></div></div>
    </aside>
  );
}

// ---------------------------------------------------------------- the view
export function Chat() {
  const { route } = useStore();
  return <ChatInner key={route.id || "new"} id={route.id} />;
}

function ChatInner({ id }: { id?: string }) {
  const { go, settings } = useStore();
  const wide = settings?.["chat.width"] === "wide";
  const toast = useToast();
  const { data: conv, error, setData } = useApi<ConversationFull>(id ? `/conversations/${id}` : null, ["conversation"]);
  const [draft, setDraft] = useState<ChatConfig>(loadDraft);
  const [live, setLive] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState(() => localStorage.getItem("atlas_activity") === "1");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState(() => localStorage.getItem("atlas_session") !== "0");
  const toggleSession = () => setSession((v) => { localStorage.setItem("atlas_session", v ? "0" : "1"); return !v; });
  const [seed, setSeed] = useState<{ text: string; n: number } | undefined>();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const cfg: ChatConfig = id && conv ? { ...draft, ...conv.config } : draft;

  const setCfg = (p: ChatConfig) => {
    const next = { ...cfg, ...p };
    setDraft(next); saveDraft(next);
    if (id && conv) { setData({ ...conv, config: next }); api(`/conversations/${id}`, { method: "PATCH", body: { config: next } }).catch(() => {}); }
  };

  // streaming deltas
  useEffect(() => subscribe((m) => {
    if (m.kind === "chat_delta" && m.conversation_id === id) setLive((l) => ({ ...l, [m.message_id]: (l[m.message_id] || "") + m.delta }));
  }), [id]);

  const messages = conv?.messages || [];
  const busy = messages.some((m) => m.status === "streaming" || m.status === "running");
  const liveLen = Object.values(live).reduce((a, s) => a + s.length, 0);

  // auto-scroll while the reader is at the bottom
  useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages.length, liveLen, conv?.messages]);
  const onScroll = () => { const el = scroller.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === ".") { e.preventDefault(); stop(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const send = async (text: string, attachments: Attachment[]) => {
    const mode = cfg.mode || "model";
    if (mode === "model" && (!cfg.provider_id || !cfg.model)) { toast("Choose a model first.", "bad"); return false; }
    try {
      let cid = id;
      if (!cid) {
        const c = await api<{ id: string }>("/conversations", { body: { config: cfg } });
        cid = c.id;
      }
      stick.current = true;
      await api(`/conversations/${cid}/messages`, { body: { content: text, attachments: attachments.map(({ name, content }) => ({ name, content })), config: cfg } });
      if (!id) go({ name: "chat", id: cid });
      return true;
    } catch (e: any) { toast(e.message || String(e), "bad"); return false; }
  };
  const stop = () => { if (id && busy) api(`/conversations/${id}/stop`, { body: {} }).catch((e) => toast(e.message, "bad")); };
  const toggleDrawer = () => setDrawer((d) => { localStorage.setItem("atlas_activity", d ? "0" : "1"); return !d; });

  const empty = !id || (conv && messages.length === 0);
  const notFound = id && error;

  return (
    <div className="relative flex-1 min-w-0 h-full flex">
      <div className="relative flex-1 min-w-0 h-full flex flex-col">
        <header className={cx("drag absolute top-0 inset-x-0 h-[64px] z-10 flex items-center justify-end gap-3 px-6 pt-2", !empty && "bg-[var(--base)]")}>
          {id && conv && !empty && <div className="absolute left-6 top-[22px] text-sm text-ink-2 truncate max-w-[50%]">{conv.title}</div>}
          {!empty && <button onClick={toggleSession} aria-label="Session details" title="Session details" aria-pressed={session}
            className={cx("no-drag h-8 w-8 rounded-md flex items-center justify-center", session ? "bg-active text-ink" : "text-ink-2 hover:text-ink hover:bg-hover")}><PanelRight size={18} strokeWidth={1.6} /></button>}
          <button onClick={toggleDrawer} aria-label="Live activity" title="Live activity" aria-pressed={drawer}
            className={cx("no-drag h-8 w-8 rounded-md flex items-center justify-center", drawer ? "bg-active text-ink" : "text-ink-2 hover:text-ink hover:bg-hover")}>
            <Terminal size={18} strokeWidth={1.6} /></button>
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
        ) : empty ? (
          <div className="flex-1 overflow-y-auto">
            <div className="stagger min-h-full flex flex-col items-center justify-center px-8 pb-[8vh]">
              <AtlasMark size={40} className="text-ink" />
              <h1 className="mt-5 text-2xl font-semibold text-ink">How can I help you today?</h1>
              <div className="mt-8 w-full max-w-[760px]">
                <Composer cfg={cfg} setCfg={setCfg} onSend={send} busy={false} onStop={stop} big seed={seed} />
              </div>
              <div className="mt-4 w-full max-w-[760px] flex flex-wrap justify-center gap-2">
                {STARTERS.map(({ icon: Icon, label, text }) => (
                  <button key={label} onClick={() => setSeed({ text, n: Date.now() })}
                    className="h-8 px-3 rounded-full border border-line text-sm text-ink-2 hover:text-ink hover:bg-hover flex items-center gap-1.5">
                    <Icon size={14} strokeWidth={1.7} />{label}
                  </button>))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto">
              <div className={cx("mx-auto px-8 pt-[84px] pb-8 space-y-7", wide ? "max-w-[1080px]" : "max-w-[820px]")}>
                {!conv && <div className="flex justify-center py-16"><Loader2 size={18} className="animate-spin text-ink-3" /></div>}
                {messages.map((m) => <MessageView key={m.id} m={m} live={live[m.id]} />)}
              </div>
            </div>
            <div className="shrink-0 px-8 pb-6 pt-2">
              <div className={cx("mx-auto", wide ? "max-w-[1120px]" : "max-w-[860px]")}>
                <Composer cfg={cfg} setCfg={setCfg} onSend={send} busy={busy} onStop={stop} />
                <div className="mt-2 text-center text-xs text-ink-3">Atlas runs on your Mac. Agents work on isolated branches and ask before risky commands.</div>
              </div>
            </div>
          </>
        )}
      </div>
      {session && !empty && !notFound && <SessionPanel messages={messages} cfg={cfg} onClose={toggleSession} />}
      {drawer && <ActivityDrawer onClose={toggleDrawer} />}
    </div>
  );
}
