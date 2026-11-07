import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Cloud, Cpu, Download, Globe, FolderPlus, KeyRound, Loader2, Lock, Shield, Sparkles, TerminalSquare } from "lucide-react";
import { api, bytes, Model, openExternal, pickFolder, Provider, subscribe, useApi } from "../api";
import { useStore } from "../store";
import { Button, cx, Meter, Modal, Toggle, useAction } from "./ui";
import { Avatar, useProfile } from "./Profile";
import { AnimatedMark } from "./AnimatedMark";
import { Markdown } from "./Markdown";
import { ConnectForm, isConnected, Preset, ProviderTile } from "./Endpoints";
import { FREE_MODEL_PROVIDERS, starterModels } from "./freeModels";
import { ModelFolder } from "./ModelFolder";
import { TeamAdvisor } from "./TeamAdvisor";
import { PackGrid } from "./SkillPacks";
import { SkillHub } from "./SkillHub";
import TERMS from "../../../../TERMS.md?raw";
import PRIVACY from "../../../../PRIVACY.md?raw";
import TRADEMARKS from "../../../../TRADEMARKS.md?raw";

/** Bump when TERMS.md or PRIVACY.md change materially; users see the notice again. */
export const LEGAL_VERSION = "2026-11-04";
export const LEGAL_DOCS = { terms: { title: "Terms of Use and Disclaimer", text: TERMS }, privacy: { title: "Privacy Policy", text: PRIVACY }, trademarks: { title: "Trademarks and affiliation", text: TRADEMARKS } };
export type LegalDocId = keyof typeof LEGAL_DOCS;

export function LegalDoc({ doc, onClose }: { doc: LegalDocId | null; onClose: () => void }) {
  const d = doc ? LEGAL_DOCS[doc] : null;
  return (
    <Modal open={!!d} onClose={onClose} title={d?.title || ""} width={720} footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
      {/* the first heading duplicates the modal title */}
      {d && <div className="text-base"><Markdown text={d.text.replace(/^# .*\n/, "").replace(/([^\n])\n(?=[^\n#>*\-\d\s])/g, "$1 ")} /></div>}
    </Modal>
  );
}

type Path = "local" | "cloud" | "free" | "cli" | "explore";
const DRAFT_KEY = "atlas_chat_draft_cfg";
const setDraftModel = (provider_id: string, model: string) => {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, mode: "model", provider_id, model })); } catch { /* ignore */ }
};

const STARTER_MODELS = [
  { name: "llama3.2:3b", title: "Fast", note: "Small and quick · 2.0 GB" },
  { name: "qwen3:8b", title: "Balanced", note: "Strong all-rounder with tools · 5.2 GB" },
  { name: "qwen2.5-coder:7b", title: "Coding", note: "Best small coder · 4.7 GB" },
];

const STEP_COUNT = 8;
function Steps({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <div className="no-drag flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEP_COUNT}`}>
      {Array.from({ length: STEP_COUNT }, (_, i) => (
        <button key={i} onClick={() => i < step && onJump(i)} disabled={i >= step} aria-label={`Go to step ${i + 1}`}
          className={cx("h-1 rounded-full transition-all duration-300 ease-[var(--ease)]", i === step ? "w-6 bg-ink" : i < step ? "w-3 bg-ink-2 hover:bg-ink" : "w-3 bg-active")} />
      ))}
    </div>
  );
}

/** A selectable card with an optional visual preview on top. */
function Choice({ selected, onClick, title, body, preview, badge }: { selected: boolean; onClick: () => void; title: string; body?: string; preview?: React.ReactNode; badge?: string }) {
  return (
    <button onClick={onClick} role="radio" aria-checked={selected}
      className={cx("lift text-left rounded-lg border p-2.5 transition-colors duration-150", selected ? "border-ink-2 bg-selected" : "border-line bg-surface hover:bg-hover")}>
      {preview && <div className="mb-2.5 rounded-md overflow-hidden border border-line">{preview}</div>}
      <div className="flex items-center gap-2 px-0.5">
        <span className={cx("h-4 w-4 rounded-full border flex items-center justify-center shrink-0 transition-colors", selected ? "border-ink bg-ink" : "border-line-strong")}>
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-[var(--base)]" />}</span>
        <span className="text-sm font-medium text-ink">{title}</span>
        {badge && <span className="ml-auto text-2xs text-ink-2 border border-line rounded-sm px-1.5 leading-[17px]">{badge}</span>}
      </div>
      {body && <div className="mt-1 px-0.5 pl-6 text-xs text-ink-3 leading-relaxed">{body}</div>}
    </button>
  );
}

/** Miniature app window drawn with fixed colours, so each theme card shows that theme regardless of the current one. */
function ThemePreview({ mode }: { mode: "dark" | "light" | "system" }) {
  const pal = (m: "dark" | "light") => m === "dark"
    ? { bg: "#000", side: "#050505", line: "#292929", card: "#101010", ink: "#f5f5f5", dim: "#3a3a3a" }
    : { bg: "#fff", side: "#fafafa", line: "#e5e5e5", card: "#f5f5f5", ink: "#0a0a0a", dim: "#d4d4d4" };
  const Win = ({ m, clip }: { m: "dark" | "light"; clip?: string }) => {
    const c = pal(m);
    return (
      <svg viewBox="0 0 160 90" className="absolute inset-0 w-full h-full" style={clip ? { clipPath: clip } : undefined} aria-hidden>
        <rect width="160" height="90" fill={c.bg} />
        <rect width="42" height="90" fill={c.side} /><rect x="42" width="0.6" height="90" fill={c.line} />
        <rect x="8" y="9" width="10" height="7" rx="1" fill={c.ink} />
        {[24, 32, 40, 48].map((y, k) => <rect key={y} x="8" y={y} width={k === 0 ? 26 : 20} height="4" rx="2" fill={k === 0 ? c.dim : c.line} />)}
        <path d="M95 30 L99 22 H101.6 L97.6 30 Z M102.4 23.6 L107 30 H104 L101.4 26.2 Z" fill={c.ink} />
        <rect x="70" y="56" width="62" height="14" rx="4" fill={c.bg} stroke={c.line} strokeWidth="0.8" />
        <rect x="124" y="60" width="5" height="5" rx="1.2" fill={c.ink} />
      </svg>
    );
  };
  return (
    <div className="relative w-full aspect-[16/9]">
      {mode === "system" ? <><Win m="light" /><Win m="dark" clip="polygon(100% 0, 100% 100%, 0 100%)" /></> : <Win m={mode} />}
    </div>
  );
}

const Label = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
  <div className="mb-2 flex items-baseline gap-2"><span className="text-sm font-medium text-ink">{children}</span>{hint && <span className="text-xs text-ink-3">{hint}</span>}</div>
);

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full p-1 rounded-md border border-line bg-surface">
      {options.map((o) => (
        <button key={String(o.id)} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={cx("flex-1 h-8 rounded-sm text-sm transition-colors duration-150", value === o.id ? "bg-selected text-ink border border-line" : "text-ink-2 hover:text-ink border border-transparent")}>{o.label}</button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ personalise
function PersonalizeStep({ onNext }: { onNext: () => void }) {
  const { settings, saveSettings, sidebarCollapsed, toggleSidebar } = useStore();
  const { avatar, changePhoto } = useProfile();
  const { busy, run } = useAction();
  const [workspace, setWorkspace] = useState<string>(settings?.["profile.workspace"] || "");
  const [name, setName] = useState<string>(settings?.["profile.name"] || "");
  const set = (k: string) => (v: any) => run("preference", async () => { await saveSettings({ [k]: v }); return true; });   // applied live, so the welcome itself previews it
  const theme = settings?.["general.theme"] || "dark";
  const scale = Number(settings?.["general.ui_scale"] ?? 1);
  return (
    <>
      <h1 className="text-center text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink">{name.trim() ? `Welcome, ${name.trim()}` : "Make Atlas yours"}</h1>
      <p className="mt-2 text-center text-base text-ink-2">Changes apply as you pick them. Everything can be changed later in Settings.</p>
      <div className="mt-8 space-y-6">
        <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4">
          <button onClick={changePhoto} aria-label="Change profile picture" className="rounded-full hover:opacity-80"><Avatar src={avatar} name={name || "You"} size={60} /></button>
          <div className="min-w-0"><div className="text-sm font-medium text-ink">Your profile</div><p className="text-xs text-ink-2 mt-1">Your name and picture stay on this Mac.</p><Button size="sm" className="mt-2" onClick={changePhoto}>{avatar ? "Change photo" : "Add photo"}</Button></div>
        </div>
        <div>
          <Label hint="Shown in the sidebar">Your name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => set("profile.name")(name.trim())} maxLength={40}
            placeholder="What should Atlas call you?" aria-label="Your name"
            className="w-full h-10 px-3 rounded-md bg-surface border border-line text-base text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" />
        </div>
        <div><Label hint="Shown below your name">Workspace label</Label>
          <input value={workspace} onChange={(e) => setWorkspace(e.target.value)} onBlur={() => set("profile.workspace")(workspace.trim())} maxLength={60} placeholder="Personal workspace" aria-label="Workspace label" className="w-full h-10 px-3 rounded-md bg-surface border border-line text-base text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" />
        </div>
        <div>
          <Label>Appearance</Label>
          <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-2 gap-2.5">
            {(["dark", "light"] as const).map((m) => (
              <Choice key={m} selected={theme === m} onClick={() => set("general.theme")(m)} preview={<ThemePreview mode={m} />}
                title={m === "dark" ? "Dark" : "Light"} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-5 max-[620px]:grid-cols-1">
          <div><Label hint={`${Math.round(scale * 100)}%`}>Interface size</Label>
            <Seg label="Interface size" value={scale} onChange={set("general.ui_scale")} options={[{ id: 0.9, label: "Small" }, { id: 1, label: "Default" }, { id: 1.1, label: "Large" }, { id: 1.2, label: "Larger" }]} /></div>
          <div><Label>Chat width</Label>
            <Seg label="Chat width" value={settings?.["chat.width"] || "normal"} onChange={set("chat.width")} options={[{ id: "normal", label: "Comfortable" }, { id: "wide", label: "Wide" }]} /></div>
          <div><Label>Send messages with</Label>
            <Seg label="Send messages with" value={settings?.["chat.send_key"] || "enter"} onChange={set("chat.send_key")} options={[{ id: "enter", label: "Enter" }, { id: "mod_enter", label: "⌘ Enter" }]} /></div>
          <div><Label>Motion</Label>
            <Seg label="Motion" value={settings?.["general.reduce_motion"] ? "reduced" : "full"} onChange={(v) => set("general.reduce_motion")(v === "reduced")} options={[{ id: "full", label: "Full" }, { id: "reduced", label: "Reduced" }]} /></div>
          <div><Label>Launch animation</Label><Seg label="Launch animation" value={settings?.["general.launch_animation"] !== false ? "on" : "off"} onChange={(v) => set("general.launch_animation")(v === "on")} options={[{ id: "on", label: "Play" }, { id: "off", label: "Skip" }]} /></div>
          <div><Label>Welcome greeting</Label><Seg label="Welcome greeting" value={settings?.["profile.personalized_greeting"] !== false ? "name" : "atlas"} onChange={(v) => set("profile.personalized_greeting")(v === "name")} options={[{ id: "name", label: "Use my name" }, { id: "atlas", label: "Atlas only" }]} /></div>
          <div><Label hint="⌘B toggles it any time">Sidebar</Label>
            <Seg label="Sidebar" value={sidebarCollapsed ? "collapsed" : "expanded"} onChange={(v) => { if ((v === "collapsed") !== sidebarCollapsed) toggleSidebar(); }} options={[{ id: "expanded", label: "Expanded" }, { id: "collapsed", label: "Icons only" }]} /></div>
        </div>
      </div>
      <div className="mt-8 flex justify-center"><Button variant="primary" busy={busy === "continue"} onClick={async () => { const saved = await run("continue", async () => { await saveSettings({ "profile.name": name.trim(), "profile.workspace": workspace.trim() }); return true; }); if (saved) onNext(); }} className="!h-10 !px-6">Continue</Button></div>
    </>
  );
}

// ------------------------------------------------------------------ safety
function SafetyStep({ onNext }: { onNext: () => void }) {
  const { settings, saveSettings } = useStore();
  const { data: projects = [], reload } = useApi<any[]>("/projects", ["project"]);
  const { busy, run } = useAction();
  const set = (k: string) => (v: any) => saveSettings({ [k]: v });
  const policy = settings?.["permissions.command_policy"] || "ask";
  const allow: string[] = settings?.["permissions.allowlist"] || [];
  const addProject = async () => {
    const path = await pickFolder();
    if (path) await run("p", () => api("/projects", { body: { path } }), "Project added");
    reload();
  };
  return (
    <>
      <h1 className="text-center text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink">How careful should agents be?</h1>
      <p className="mt-2 text-center text-base text-ink-2">Agents only run commands inside your project's sandbox. Choose how often they ask you first.</p>
      <div role="radiogroup" aria-label="Command approvals" className="mt-8 grid gap-2.5">
        <Choice selected={policy === "ask"} onClick={() => set("permissions.command_policy")("ask")} title="Ask before every command" badge="Recommended"
          body="You approve each terminal command. Safest while you get to know Atlas." />
        <Choice selected={policy === "allowlist"} onClick={() => set("permissions.command_policy")("allowlist")} title="Allow safe commands"
          body={`Read-only and test commands run on their own (${allow.slice(0, 5).join(", ")}…). Everything else asks.`} />
        <Choice selected={policy === "auto"} onClick={() => set("permissions.command_policy")("auto")} title="Don't ask"
          body="Commands run without asking. Destructive commands still always ask, and dangerous ones are always blocked." />
      </div>
      <div className="mt-6 rounded-lg border border-line bg-surface divide-y divide-[var(--border)]">
        {[["execution.require_plan_approval", "Review team plans first", "When a team gets an objective, you approve the lead's plan before agents start."],
          ["general.notifications", "Desktop notifications", "Get notified when an approval is needed or a run finishes while Atlas is in the background."]].map(([k, t, b]) => (
          <div key={k} className="flex items-center gap-4 px-4 py-3.5">
            <div className="flex-1 min-w-0"><div className="text-base text-ink">{t}</div><div className="text-xs text-ink-3 mt-0.5">{b}</div></div>
            <Toggle checked={!!settings?.[k]} onChange={set(k)} label={t} />
          </div>
        ))}
        <div className="flex items-center gap-4 px-4 py-3.5">
          <div className="flex-1 min-w-0"><div className="text-base text-ink">Project folders</div>
            <div className="text-xs text-ink-3 mt-0.5 truncate">{projects.length ? projects.map((p) => p.name).join(", ") : "Agents can only touch folders you add. Add one now or later under Work."}</div></div>
          <Button size="sm" icon={<FolderPlus size={13} />} busy={busy === "p"} onClick={addProject}>Add folder</Button>
        </div>
      </div>
      <div className="mt-8 flex justify-center"><Button variant="primary" onClick={onNext} className="!h-10 !px-6">Continue</Button></div>
    </>
  );
}

function Option({ icon: Icon, title, body, onClick, badge }: { icon: React.ElementType; title: string; body: string; onClick: () => void; badge?: string }) {
  return (
    <button onClick={onClick} className="lift group text-left p-4 rounded-lg border border-line bg-surface hover:bg-hover flex items-start gap-3.5">
      <span className="h-10 w-10 rounded-md border border-line bg-active flex items-center justify-center shrink-0"><Icon size={18} strokeWidth={1.7} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="text-base font-medium text-ink">{title}</span>
          {badge && <span className="text-2xs text-ink-2 border border-line rounded-sm px-1.5 leading-[17px]">{badge}</span>}</span>
        <span className="block text-sm text-ink-2 mt-1 leading-relaxed">{body}</span>
      </span>
      <ArrowRight size={16} className="mt-3 text-ink-3 group-hover:text-ink transition-transform duration-200 group-hover:translate-x-0.5" />
    </button>
  );
}

// ------------------------------------------------------------------ setup paths
function LocalSetup({ onDone }: { onDone: (model?: { provider_id: string; name: string }) => void }) {
  const { data: providers = [], reload } = useApi<Provider[]>("/providers", ["provider"]);
  const { data: models = [], reload: reloadModels } = useApi<Model[]>("/models", ["model", "provider"]);
  const { data: s, reload: reloadOllama } = useApi<any>("/ollama", ["provider"]);
  const { busy, run } = useAction();
  const [install, setInstall] = useState<{ downloaded: number; total: number } | null>(null);
  const [pull, setPull] = useState<Record<string, any>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const ollama = providers.find((p) => p.kind === "ollama");
  useEffect(() => subscribe((m) => {
    if (m.kind === "install" && m.target === "ollama") setInstall(m);
    if (m.kind === "pull") { setPull((x) => ({ ...x, [m.model]: m })); if (m.status === "success") reloadModels(); }
  }), []);
  const installed = models.filter((m) => m.name && m.provider_id === ollama?.id);
  const has = (n: string) => installed.some((m) => m.name === n);
  const refresh = () => { reloadOllama(); reload(); reloadModels(); };
  const stepState = !s ? "loading" : !s.binary ? "install" : !s.running ? "start" : "models";
  const downloading = Object.values(pull).some((st: any) => st && !st.error && !["success", "cancelled"].includes(st.status));
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface divide-y divide-[var(--border)]">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className={cx("h-6 w-6 rounded-full border flex items-center justify-center shrink-0", s?.binary ? "bg-ink border-ink text-[var(--base)]" : "border-line-strong text-ink-3")}>{s?.binary ? <Check size={13} strokeWidth={2.5} /> : <span className="text-2xs">1</span>}</span>
          <div className="flex-1 min-w-0"><div className="text-base text-ink">Install Ollama</div>
            <div className="text-xs text-ink-3">Free local model runtime (MIT). Installed into your user folder, no admin rights needed.</div>
            {install && busy === "i" && <div className="mt-2 max-w-xs"><Meter value={install.downloaded} max={install.total || 1} /><div className="text-2xs text-ink-3 tnum mt-1">{bytes(install.downloaded)} / {bytes(install.total)}</div></div>}
          </div>
          {stepState === "install" && <Button size="sm" variant="primary" busy={busy === "i"} icon={<Download size={13} />} onClick={() => run("i", () => api("/ollama/install", { body: {} }), "Ollama installed").then(refresh)}>Install</Button>}
        </div>
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className={cx("h-6 w-6 rounded-full border flex items-center justify-center shrink-0", s?.running ? "bg-ink border-ink text-[var(--base)]" : "border-line-strong text-ink-3")}>{s?.running ? <Check size={13} strokeWidth={2.5} /> : <span className="text-2xs">2</span>}</span>
          <div className="flex-1 min-w-0"><div className="text-base text-ink">Start Ollama</div><div className="text-xs text-ink-3">{s?.running ? `Running${s.health?.version ? ` · v${s.health.version}` : ""}` : "Runs in the background while Atlas is open."}</div></div>
          {stepState === "start" && <Button size="sm" variant="primary" busy={busy === "s"} onClick={() => run("s", () => api("/ollama/start", { body: {} })).then((r: any) => { if (r && !r.ok) alert(r.error); refresh(); })}>Start</Button>}
        </div>
        <ModelFolder variant="row" disabled={downloading} />
        <div className={cx("px-4 py-3.5", stepState !== "models" && "opacity-50 pointer-events-none")}>
          <div className="flex items-center gap-3">
            <span className={cx("h-6 w-6 rounded-full border flex items-center justify-center shrink-0", installed.length ? "bg-ink border-ink text-[var(--base)]" : "border-line-strong text-ink-3")}>{installed.length ? <Check size={13} strokeWidth={2.5} /> : <span className="text-2xs">3</span>}</span>
            <div className="text-base text-ink">Choose a model</div>
          </div>
          <div className="mt-3 ml-9 grid gap-2">
            {STARTER_MODELS.map((m) => {
              const st = pull[m.name]; const done = has(m.name) || st?.status === "success";
              const active = st && !st.error && st.status !== "cancelled" && !done;
              return (
                <div key={m.name} className={cx("rounded-md border px-3 py-2.5 transition-colors", picked === m.name ? "border-ink-2" : "border-line")}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1"><div className="text-sm text-ink"><span className="font-medium">{m.title}</span> <span className="font-mono text-xs text-ink-2">{m.name}</span></div>
                      <div className="text-xs text-ink-3">{m.note}</div></div>
                    {done ? <Button size="sm" variant={picked === m.name ? "primary" : "secondary"} icon={<Check size={13} />} onClick={() => setPicked(m.name)}>{picked === m.name ? "Selected" : "Use"}</Button> :
                      <Button size="sm" busy={!!active} icon={<Download size={13} />} onClick={() => { if (!ollama) return; setPicked(m.name); setPull((x) => ({ ...x, [m.name]: { status: "starting" } })); api("/models/pull", { body: { provider_id: ollama.id, model: m.name } }).catch((e) => setPull((x) => ({ ...x, [m.name]: { error: e.message } }))); }}>Download</Button>}
                  </div>
                  {(active || st?.error) && (
                    <div className="mt-2">{st?.total ? <><Meter value={st.completed || 0} max={st.total} /><div className="text-2xs text-ink-3 tnum mt-1">{bytes(st.completed)} / {bytes(st.total)}</div></> :
                      <div className={cx("text-xs", st?.error ? "text-bad" : "text-ink-3")}>{st?.error || st?.status}</div>}</div>
                  )}
                </div>
              );
            })}
            {installed.filter((m) => !STARTER_MODELS.some((x) => x.name === m.name)).slice(0, 4).map((m) => (
              <button key={m.name} onClick={() => setPicked(m.name!)} className={cx("text-left rounded-md border px-3 py-2 text-sm font-mono", picked === m.name ? "border-ink-2 text-ink" : "border-line text-ink-2 hover:bg-hover")}>{m.name} <span className="font-sans text-ink-3">· installed</span></button>
            ))}
          </div>
        </div>
      </div>
      <div className="text-xs text-ink-3">Models have their own licenses (Llama, Qwen, Gemma…). Downloads can take a few minutes; you can continue while they finish.</div>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!ollama || !s?.running} onClick={() => onDone(picked && ollama ? { provider_id: ollama.id, name: picked } : undefined)}>Continue</Button>
      </div>
    </div>
  );
}

function CloudSetup({ presets, onDone }: { presets: Preset[]; onDone: () => void }) {
  const cloud = presets.filter((p) => p.category === "cloud");
  const featured = ["openrouter", "openai", "anthropic", "gemini", "groq", "deepseek", "mistral", "xai"];
  const [id, setId] = useState("openrouter");
  const p = cloud.find((x) => x.id === id) || cloud[0];
  const { data: providers = [] } = useApi<Provider[]>("/providers", ["provider"]);
  if (!p) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {cloud.filter((x) => featured.includes(x.id)).sort((a, b) => featured.indexOf(a.id) - featured.indexOf(b.id)).map((x) => (
          <button key={x.id} onClick={() => setId(x.id)} aria-pressed={id === x.id}
            className={cx("h-9 pl-1.5 pr-3 rounded-md border flex items-center gap-2 text-sm transition-colors", id === x.id ? "border-ink-2 bg-selected text-ink" : "border-line text-ink-2 hover:bg-hover hover:text-ink")}>
            <ProviderTile label={x.label} size={36} providerKey={x.id} />{x.label.replace(" (Claude API)", "")}{isConnected(x, providers) && <Check size={13} />}</button>
        ))}
        <select value={featured.includes(id) ? "" : id} onChange={(e) => e.target.value && setId(e.target.value)} aria-label="More providers"
          className="h-9 px-2.5 rounded-md border border-line bg-[var(--base)] text-sm text-ink-2 outline-none">
          <option value="">{cloud.length - featured.length} more…</option>
          {cloud.filter((x) => !featured.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </div>
      <div key={p.id} className="rounded-lg border border-line bg-surface p-4 fade-in">
        <div className="flex items-center gap-3 mb-3"><ProviderTile label={p.label} size={36} providerKey={p.id} />
          <div><div className="text-base font-medium text-ink">{p.label}</div><div className="text-xs text-ink-3">{p.note}</div></div></div>
        <ConnectForm preset={p} compact onConnected={onDone} />
      </div>
    </div>
  );
}

function FreeModelSetup({ presets, onDone }: { presets: Preset[]; onDone: () => void }) {
  const [id, setId] = useState("openrouter");
  const options = FREE_MODEL_PROVIDERS.filter((offer) => presets.some((p) => p.id === offer.id));
  const offer = options.find((o) => o.id === id) || options[0];
  const preset = presets.find((p) => p.id === offer?.id);
  if (!preset || !offer) return <p role="status" className="text-sm text-ink-2">Loading provider options…</p>;
  return <div className="space-y-4">
    <div className="grid grid-cols-3 max-[620px]:grid-cols-2 gap-2" role="group" aria-label="Free model providers">
      {options.map((o) => {
        const p = presets.find((p) => p.id === o.id)!;
        return <button key={o.id} onClick={() => setId(o.id)} aria-pressed={offer.id === o.id}
          className={cx("flex items-center gap-2 rounded-lg border p-3 text-left", offer.id === o.id ? "border-ink-2 bg-selected" : "border-line bg-surface hover:bg-hover")}>
          <ProviderTile label={p.label} providerKey={p.id} size={30} />
          <span className="min-w-0"><span className="block text-sm font-medium text-ink">{p.label}</span><span className="block text-xs text-ink-3">{o.access}</span></span>
        </button>;
      })}
    </div>
    <div className="rounded-lg border border-line bg-surface p-4 space-y-2">
      <div className="text-sm font-medium text-ink">{preset.label} · {offer.access}</div>
      <p className="text-sm text-ink-2">{offer.note}</p>
      <button onClick={() => openExternal(offer.url)} className="text-xs text-ink-2 underline underline-offset-2">Check current plans and limits</button>
      <p className="text-xs text-ink-3">Use your own account and API key. Offers can change; paid accounts may be billed. Your code goes to the selected provider.</p>
    </div>
    <FreeProviderConnection key={preset.id} preset={preset} onDone={onDone} />
  </div>;
}

function FreeProviderConnection({ preset, onDone }: { preset: Preset; onDone: () => void }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [model, setModel] = useState("");
  const { data: models, error, reload } = useApi<Model[]>(provider ? "/models" : null, ["model", "provider"]);
  const choices = starterModels(models || [], provider?.id || "", preset.id);
  const selected = choices.find((m) => m.name === model);
  if (!provider) return <ConnectForm preset={preset} compact verifyBeforeConnect onConnected={setProvider} />;
  return <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
    <div className="flex items-center gap-2 text-sm text-ink"><Check size={15} />{preset.label} connected</div>
    <label className="block text-sm font-medium text-ink" htmlFor="free-starter-model">Choose your first model</label>
    <select id="free-starter-model" value={selected?.name || ""} onChange={(e) => setModel(e.target.value)} disabled={!choices.length}
      className="w-full h-10 px-3 rounded-md border border-line bg-[var(--base)] text-sm text-ink">
      <option value="">{!models && !error ? "Loading available models…" : "Select a model"}</option>
      {choices.map((m) => <option key={m.name} value={m.name!}>{m.name}{m.capabilities?.tools === true ? " · Supports tools" : ""}</option>)}
    </select>
    {(!models && !error) ? <p role="status" className="text-xs text-ink-3">Fetching this provider's model list…</p> : !choices.length ?
      <div role="status" className="text-sm text-ink-2">{error || "No chat models are available on this connection yet."} <button onClick={reload} className="underline">Retry</button></div> :
      <p className="text-xs text-ink-3">{preset.id === "openrouter" ? "Only free model routes are shown. Choose openrouter/free to let OpenRouter pick an available free model." : "Your provider's catalog may include paid models. Check your plan's free allowance before choosing. Tool support depends on the model."}</p>}
    <p className="text-xs text-ink-3">Next, add a project folder to let Atlas work with your code.</p>
    <div className="flex justify-end"><Button variant="primary" disabled={!selected} onClick={() => {
      setDraftModel(provider.id, selected!.name!);
      onDone();
    }}>Use this model</Button></div>
  </div>;
}

function CliSetup({ presets, onDone }: { presets: Preset[]; onDone: () => void }) {
  const clis = presets.filter((p) => p.kind === "hermes_agent" || p.kind === "claude_code" || (p.kind === "codex_cli" && !p.config?.oss));
  const { data: providers = [], reload } = useApi<Provider[]>("/providers", ["provider"]);
  const [found, setFound] = useState<Record<string, any>>({});
  const { busy, run } = useAction();
  useEffect(() => {
    clis.forEach((p) => api("/providers/test-config", { body: { kind: p.kind, config: p.config || {} } }).then((r) => setFound((f) => ({ ...f, [p.id]: r }))).catch((e) => setFound((f) => ({ ...f, [p.id]: { ok: false, error: e.message } }))));
  }, [clis.length]);
  const docs: Record<string, string> = { claude_code: "https://docs.claude.com/en/docs/claude-code/overview", codex_cli: "https://github.com/openai/codex" };
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface divide-y divide-[var(--border)]">
        {clis.map((p) => {
          const r = found[p.id]; const added = isConnected(p, providers);
          return (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3.5">
              <ProviderTile label={p.label} providerKey={p.id} />
              <div className="min-w-0 flex-1">
                <div className="text-base text-ink font-medium">{p.label}</div>
                <div className="text-xs text-ink-3 truncate">{!r ? "Looking for the CLI…" : r.ok ? `Found${r.version ? ` · ${r.version}` : ""}` : "Not installed on this Mac."}</div>
              </div>
              {!r ? <Loader2 size={15} className="animate-spin text-ink-3" /> : added ? <span className="text-sm text-ink-2 flex items-center gap-1"><Check size={14} />Added</span> :
                r.ok ? <Button size="sm" variant="primary" busy={busy === p.id} onClick={() => run(p.id, () => api("/providers", { body: { kind: p.kind, name: p.label, config: p.config || {} } }), `${p.label} connected`).then(reload)}>Connect</Button> :
                  docs[p.kind] ? <Button size="sm" onClick={() => openExternal(docs[p.kind])}>How to install</Button> : <span className="text-xs text-ink-3">Set up the Atlas Agent runtime first.</span>}
            </div>
          );
        })}
      </div>
      <div className="text-xs text-ink-3">These CLIs use your existing sign-in and their providers' terms. Atlas runs them in isolated git worktrees.</div>
      <div className="flex justify-end"><Button variant="primary" onClick={onDone}>Continue</Button></div>
    </div>
  );
}

// ------------------------------------------------------------------ the flow
// steps: 0 notice · 1 make it yours · 2 how to start · 3 setup · 4 safety · 5 ready
export function Welcome() {
  const { settings, saveSettings, go, sidebarCollapsed } = useStore();
  const { data: meta } = useApi<any>("/meta");
  const { data: providers = [] } = useApi<Provider[]>("/providers", ["provider"]);
  const presets: Preset[] = meta?.provider_presets || [];
  const legalOnly = !!settings?.["onboarding.completed"];
  // resume after the notice if it was already acknowledged (e.g. the app was quit mid-setup)
  const [step, setStep] = useState(() => (!legalOnly && settings?.["legal.acknowledged"] === LEGAL_VERSION ? 1 : 0));
  const [path, setPath] = useState<Path | null>(null);
  const [agree, setAgree] = useState(false);
  const [doc, setDoc] = useState<LegalDocId | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [hub, setHub] = useState(false);

  const acknowledge = async () => {
    await saveSettings({ "legal.acknowledged": LEGAL_VERSION });
    if (!legalOnly) setStep(1);
  };
  const finish = async (startCoding = false) => {
    setLeaving(true);
    await saveSettings({ "onboarding.completed": true, "legal.acknowledged": LEGAL_VERSION });
    go({ name: startCoding ? "projects" : "chat" });
  };
  const choose = (p: Path) => { setPath(p); setStep(p === "explore" ? 4 : 3); };
  const title = useMemo(() => ({ local: "Run models on this Mac", cloud: "Connect an API key", free: "Connect free online models", cli: "Use Claude Code or Codex", explore: "" } as Record<Path, string>), []);
  const s = settings || {};
  const { data: teams = [] } = useApi<any[]>(step === 7 ? "/teams" : null, ["team"]);
  const { data: packs = [] } = useApi<{ skills: { installed: boolean }[] }[]>(step === 7 ? "/skillpacks" : null, ["settings"]);
  const skillCount = packs.reduce((a, p) => a + p.skills.filter((x) => x.installed).length, 0);
  const summary: [string, string, number][] = [
    ["Name", s["profile.name"] || meta?.user || "—", 1],
    ["Appearance", ({ dark: "Dark", light: "Light", system: "Match system" } as any)[s["general.theme"] || "dark"], 1],
    ["Interface", `${Math.round((Number(s["general.ui_scale"]) || 1) * 100)}% · ${s["chat.width"] === "wide" ? "wide chat" : "comfortable chat"} · ${sidebarCollapsed ? "icon sidebar" : "full sidebar"}`, 1],
    ["Send with", s["chat.send_key"] === "mod_enter" ? "⌘ Enter" : "Enter", 1],
    ["Models", providers.length ? providers.map((p) => p.name).join(", ") : "None yet", 2],
    ["Commands", ({ ask: "Ask every time", allowlist: "Allow safe commands", auto: "Don't ask" } as any)[s["permissions.command_policy"] || "ask"], 4],
    ["Teams", teams.length ? teams.map((t) => t.name).join(", ") : "None yet", 5],
    ["Skills", skillCount ? `${skillCount} skill${skillCount === 1 ? "" : "s"} added` : "None yet", 6],
    ["Plans", s["execution.require_plan_approval"] ? "Reviewed before agents start" : "Agents start right away", 4],
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome to Atlas"
      className={cx("fixed inset-0 z-[80] bg-[var(--base)] flex flex-col transition-opacity duration-200", leaving && "opacity-0")}>
      <div className="drag h-[52px] shrink-0 flex items-center justify-center">{!legalOnly && <Steps step={step} onJump={setStep} />}</div>
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-8 pb-16">
          <div key={step} className={cx("w-full stagger", step === 1 ? "max-w-[640px]" : "max-w-[600px]")}>
            {step === 0 && <>
              <div className="flex justify-center text-ink"><AnimatedMark size={64} play="assemble" afterSplash /></div>
              <h1 className="mt-5 text-center text-[32px] leading-tight font-semibold tracking-[-0.02em] text-ink">{legalOnly ? "Updated terms" : "Welcome to Atlas"}</h1>
              <p className="mt-2 text-center text-lg text-ink-2">{legalOnly ? "Please review the updated notice to keep using Atlas." : "A local-first AI workspace. Chat with any model and hand real work to agents."}</p>
              {!legalOnly && (
                <div className="mt-8 grid grid-cols-3 gap-3 max-[640px]:grid-cols-1">
                  {[[Lock, "Private by default", "No telemetry. Your data stays on this Mac."], [KeyRound, "Your keys, your Keychain", "API keys never touch Atlas's database."], [Shield, "Agents in a sandbox", "Confined to your project; risky commands ask first."]].map(([Icon, t, b]: any) => (
                    <div key={t} className="rounded-lg border border-line bg-surface p-3.5">
                      <Icon size={17} strokeWidth={1.7} className="text-ink" /><div className="mt-2 text-sm font-medium text-ink">{t}</div><div className="text-xs text-ink-3 mt-0.5 leading-relaxed">{b}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-6 rounded-lg border border-line bg-surface p-4">
                <div className="text-sm font-medium text-ink">Before you start</div>
                <ul className="mt-2 space-y-1.5 text-sm text-ink-2 leading-relaxed list-disc pl-4">
                  <li>AI output can be wrong. Review it before you rely on it.</li>
                  <li>Agents you give tools can edit files and run commands in your project. Keep backups and use git.</li>
                  <li>Cloud providers you connect receive what you send them, under their own terms, and may charge you.</li>
                  <li>Downloaded models have their own licenses. You are responsible for lawful use.</li>
                  <li>Atlas is free software provided without warranty, and is not affiliated with any model provider.</li>
                </ul>
                <label className="mt-3.5 flex items-start gap-2.5 cursor-default select-none">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-[3px] accent-[var(--text)]" />
                  <span className="text-sm text-ink">I have read and accept the{" "}
                    <button type="button" onClick={() => setDoc("terms")} className="underline underline-offset-2">Terms of Use</button> and{" "}
                    <button type="button" onClick={() => setDoc("privacy")} className="underline underline-offset-2">Privacy Policy</button>.</span>
                </label>
              </div>
              <div className="mt-6 flex justify-center"><Button variant="primary" disabled={!agree} onClick={acknowledge} className="!h-10 !px-6">{legalOnly ? "Accept and continue" : "Continue"}</Button></div>
            </>}

            {step === 1 && <PersonalizeStep onNext={() => setStep(2)} />}

            {step === 2 && <>
              <h1 className="text-center text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink">How do you want to start?</h1>
              <p className="mt-2 text-center text-base text-ink-2">You can add more of these later on the Models page.</p>
              <div className="mt-8 grid gap-2.5">
                <Option icon={Cpu} title="Run models on this Mac" badge="Private · Free" body="Install Ollama and download an open model. Nothing leaves your computer." onClick={() => choose("local")} />
                <Option icon={Sparkles} title="Start with free online models" badge={`${FREE_MODEL_PROVIDERS.length} providers`} body="Choose OpenRouter, Groq, Gemini, Mistral and more. Free tiers, evaluation access and starter credits, with your own API key." onClick={() => choose("free")} />
                <Option icon={Cloud} title="Use an API key" badge={`${presets.filter((p) => p.category === "cloud" && p.id !== "custom").length} providers`} body="OpenRouter, OpenAI, Anthropic, Gemini, Groq, DeepSeek and more, with your own key." onClick={() => choose("cloud")} />
                <Option icon={TerminalSquare} title="Use Claude Code or Codex" body="Run your existing Claude Code or Codex sign-in as Atlas agents." onClick={() => choose("cli")} />
                <Option icon={Sparkles} title="Just explore" body="Look around first and connect a model whenever you're ready." onClick={() => choose("explore")} />
              </div>
            </>}

            {step === 3 && path && path !== "explore" && <>
              <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink">{title[path]}</h1>
              <p className="mt-1.5 mb-6 text-base text-ink-2">{path === "local" ? "Three quick steps. Everything runs on your Mac." : path === "cloud" ? "Pick a provider, paste your key, and test it before saving." : path === "free" ? "Choose a provider, connect your key, and pick a model to start building." : "Atlas looks for the CLIs on this Mac."}</p>
              {path === "local" && <LocalSetup onDone={(m) => { if (m) setDraftModel(m.provider_id, m.name); setStep(4); }} />}
              {path === "cloud" && <CloudSetup presets={presets} onDone={() => setStep(4)} />}
              {path === "free" && <FreeModelSetup presets={presets} onDone={() => setStep(4)} />}
              {path === "cli" && <CliSetup presets={presets} onDone={() => setStep(4)} />}
            </>}

            {step === 4 && <SafetyStep onNext={() => setStep(5)} />}

            {step === 5 && <TeamAdvisor onDone={() => setStep(6)} onSkip={() => setStep(6)} />}

            {step === 6 && <>
              <h1 className="text-center text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink">Add some skills</h1>
              <p className="mt-2 text-center text-base text-ink-2">Skills teach Atlas how to do specific jobs well. Add a ready-made pack now, or find more on GitHub. You can change this any time in Settings.</p>
              <div className="mt-6 max-h-[44vh] overflow-y-auto pr-1"><PackGrid cols={1} /></div>
              <div className="mt-5 flex items-center justify-center gap-3">
                <Button icon={<Globe size={14} />} onClick={() => setHub(true)}>Find more on GitHub</Button>
                <Button variant="primary" onClick={() => setStep(7)} className="!h-10 !px-6">Continue</Button>
              </div>
              <SkillHub open={hub} onClose={() => setHub(false)} />
            </>}

            {step === 7 && <>
              <div className="flex justify-center"><span className="h-14 w-14 rounded-full border border-line bg-surface flex items-center justify-center"><Check size={24} strokeWidth={2} /></span></div>
              <h1 className="mt-5 text-center text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink">You're ready{s["profile.name"] ? `, ${s["profile.name"]}` : ""}</h1>
              <p className="mt-2 text-center text-base text-ink-2">{providers.length ? "Pick a model in the composer and send your first message." : "Connect a model on the Models page whenever you like."}</p>
              <div className="mt-8 rounded-lg border border-line bg-surface divide-y divide-[var(--border)] text-sm">
                {summary.map(([k, v, to]) => (
                  <div key={k} className="flex items-center gap-4 px-4 h-11">
                    <span className="w-[92px] shrink-0 text-ink-3">{k}</span><span className="flex-1 min-w-0 truncate text-ink">{v}</span>
                    <button onClick={() => setStep(to)} className="text-xs text-ink-3 hover:text-ink underline-offset-2 hover:underline">Change</button>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-ink-3">
                {[["⌘N", "New chat"], ["⌘K", "Commands"], ["⌘B", "Sidebar"], ["⌘.", "Stop"]].map(([k, t]) => <span key={k}><kbd className="font-sans text-ink-2">{k}</kbd> {t}</span>)}
              </div>
              <div className="mt-8 flex justify-center gap-3">
                <Button onClick={() => finish()} className="!h-10 !px-6">Start chatting</Button>
                <Button variant="primary" onClick={() => finish(true)} className="!h-10 !px-6">Start coding</Button>
              </div>
            </>}

            {step > 0 && step < 7 && (
              <div className="mt-8 flex items-center justify-between">
                <button onClick={() => setStep(step === 4 && (!path || path === "explore") ? 2 : step - 1)} className="h-8 px-2 -ml-2 rounded-md text-sm text-ink-2 hover:text-ink hover:bg-hover flex items-center gap-1.5"><ArrowLeft size={14} />Back</button>
                {(step === 2 || step === 3) && <button onClick={() => { setPath("explore"); setStep(4); }} className="h-8 px-2 -mr-2 rounded-md text-sm text-ink-3 hover:text-ink hover:bg-hover">Skip model setup</button>}
              </div>
            )}
          </div>
        </div>
      </div>
      <LegalDoc doc={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
