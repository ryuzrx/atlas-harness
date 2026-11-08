import React, { useEffect, useState } from "react";
import { SlidersHorizontal, Palette, MessageSquare, Bell, Keyboard, Layers, Users, Play, ShieldCheck, HardDrive, Plug, Wrench, Info, Download, FolderKanban, Sparkles, Puzzle, Webhook, Search, X } from "lucide-react";
import { api, useApi } from "../api";
import { useStore } from "../store";
import { ModelPicker } from "../components/Inspector";
import { LegalDoc, LegalDocId } from "../components/Welcome";
import { openExternal } from "../api";
import { Badge, Button, cx, Input, Segmented, Select, TextArea, Toggle, useAction, useToast } from "../components/ui";
import { Avatar, useProfile } from "../components/Profile";
import { ImportSettings } from "../components/ImportSettings";
import { HooksPanel, PluginsPanel, SkillsPanel } from "../components/ExtensionsSettings";
import { ModelFolder } from "../components/ModelFolder";
import { McpIntegrations } from "../components/McpIntegrations";

const SECTIONS = ["General", "Appearance", "Chat", "Notifications", "Keyboard shortcuts", "Import", "Projects", "Models", "Agents", "Execution", "Permissions", "Storage", "Skills", "Plugins", "Hooks", "Integrations", "Advanced", "About & legal"] as const;
type Section = typeof SECTIONS[number];
const GROUPS: { label: string; items: { id: Section; icon: React.ElementType }[] }[] = [
  { label: "Personal", items: [{ id: "General", icon: SlidersHorizontal }, { id: "Appearance", icon: Palette }, { id: "Chat", icon: MessageSquare }, { id: "Notifications", icon: Bell }, { id: "Keyboard shortcuts", icon: Keyboard }, { id: "Import", icon: Download }] },
  { label: "Workspace", items: [{ id: "Projects", icon: FolderKanban }, { id: "Models", icon: Layers }, { id: "Agents", icon: Users }, { id: "Execution", icon: Play }, { id: "Permissions", icon: ShieldCheck }, { id: "Storage", icon: HardDrive }] },
  { label: "Extensions", items: [{ id: "Skills", icon: Sparkles }, { id: "Plugins", icon: Puzzle }, { id: "Hooks", icon: Webhook }, { id: "Integrations", icon: Plug }] },
  { label: "Atlas", items: [{ id: "Advanced", icon: Wrench }, { id: "About & legal", icon: Info }] },
];
const SHORTCUT_LABELS: Record<string, string> = { palette: "Command palette", new_task: "New chat", toggle_sidebar: "Toggle sidebar", overview: "Chat", agents: "Agents", settings: "Settings" };

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="set-row flex items-center gap-6 px-4 py-3 min-h-[52px]">
      <div className="flex-1 min-w-0"><div className="text-sm text-ink">{label}</div>{hint && <div className="text-xs text-ink-3 mt-0.5 max-w-[520px]">{hint}</div>}</div>
      <div className="shrink-0 flex justify-end">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="pt-6 first:pt-1"><h3 className="text-xs font-medium text-ink-2 px-1 pb-2">{title}</h3><div>{children}</div></div>;
}
function Choice({ value, options, onPick }: { value: number | string; options: [number | string, string][]; onPick: (v: any) => void }) {
  return <Segmented value={String(value)} onChange={(v) => onPick(typeof options[0][0] === "number" ? Number(v) : v)} options={options.map(([v, l]) => ({ id: String(v), label: l }))} />;
}
const ABILITY_LABELS: Record<string, string> = { read: "Read files", write: "Edit files", shell: "Run commands", git: "Use git", memory: "Remember things", messages: "Message teammates", mcp: "Use connected apps" };

export function Settings() {
  const { settings, saveSettings, setSettingsOpen } = useStore();
  const close = () => setSettingsOpen(false);
  const [q, setQ] = useState("");
  const prof = useProfile();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && document.querySelectorAll("[role=dialog]").length < 2) close(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const [section, setSection] = useState<Section>(() => { const s = localStorage.getItem("atlas_settings_section") as Section | null; localStorage.removeItem("atlas_settings_section"); return s && (SECTIONS as readonly string[]).includes(s) ? s : "General"; });
  const [doc, setDoc] = useState<LegalDocId | null>(null);
  const toast = useToast();
  const { data: health } = useApi<any>("/health");
  const { data: meta } = useApi<any>("/meta");
  const { data: mcp, reload: reloadMcp } = useApi<any>(section === "Integrations" ? "/mcp" : null);
  const [mcpSaving, setMcpSaving] = useState(false);
  const [allow, setAllow] = useState("");
  const [prot, setProt] = useState("");
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  useEffect(() => {
    if (!settings) return;
    setAllow((settings["permissions.allowlist"] || []).join("\n"));
    setProt((settings["permissions.protected_branches"] || []).join(", "));
    setShortcuts(settings.shortcuts || {});
  }, [settings]);
  if (!settings) return null;
  const set = (k: string) => (v: any) => saveSettings({ [k]: v }).then(() => toast("Saved", "ok")).catch((e) => toast(e.message, "bad"));
  const saveMcp = async (next: any[]) => {
    setMcpSaving(true);
    try {
      await saveSettings({ "integrations.mcp_servers": next });
      await reloadMcp();
    } finally { setMcpSaving(false); }
  };
  const num = (k: string, min = 0, max = 100000) => (
    <Input type="number" className="!w-28 text-right tnum" defaultValue={settings[k]} min={min} max={max}
      onBlur={(e) => { const v = Math.max(min, Math.min(max, +e.target.value)); if (v !== settings[k]) set(k)(v); }} />);
  const tog = (k: string) => <Toggle checked={!!settings[k]} onChange={set(k)} label={k} />;
  const routing = settings["models.routing"] || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-10 max-[760px]:p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div role="dialog" aria-modal="true" aria-label="Settings" className="pop-in w-[min(1040px,100%)] h-[min(760px,100%)] flex flex-col rounded-xl border border-line-strong bg-[var(--surface)] shadow-[var(--shadow-lg)] overflow-hidden">
      <div className="h-12 shrink-0 px-4 flex items-center border-b border-line">
        <h1 className="flex-1 text-sm font-semibold text-ink text-center pl-8">Settings</h1>
        <button onClick={close} aria-label="Close settings" title="Close  Esc" className="h-8 w-8 flex items-center justify-center rounded-md text-ink-2 hover:text-ink hover:bg-hover"><X size={18} strokeWidth={1.6} /></button>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-[224px_1fr] max-[760px]:grid-cols-[60px_1fr]">
        <nav className="p-2.5 border-r border-line bg-[var(--sidebar)] overflow-y-auto" aria-label="Settings sections">
          <div className="relative mb-2 max-[760px]:hidden">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search settings sections"
              className="w-full h-8 pl-8 pr-3 rounded-md bg-[var(--sunken)] border border-line text-sm text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" />
          </div>
          {GROUPS.map((g) => {
            const items = g.items.filter((x) => !q || x.id.toLowerCase().includes(q.toLowerCase()));
            if (!items.length) return null;
            return (
              <div key={g.label} className="mb-1">
                <div className="px-2.5 pt-3 pb-1 text-2xs font-semibold text-ink-3 max-[760px]:hidden">{g.label}</div>
                <div className="space-y-0.5 max-[760px]:mt-2">
                {items.map(({ id, icon: Icon }) => (
                  <button key={id} onClick={() => setSection(id)} aria-current={section === id ? "page" : undefined} title={id}
                    className={cx("w-full h-8 px-2.5 flex items-center gap-2.5 rounded-md text-sm text-left max-[760px]:justify-center max-[760px]:px-0", section === id ? "bg-active text-ink font-medium" : "text-ink hover:bg-hover")}>
                    <Icon size={16} strokeWidth={1.7} className={cx("shrink-0", section === id ? "text-ink" : "text-ink-2")} /><span className="max-[760px]:hidden">{id}</span></button>))}
                </div>
              </div>);
          })}
        </nav>
        <div className="px-8 pt-6 pb-8 min-w-0 overflow-y-auto bg-[var(--base)]" key={section}>
          <h2 className="text-xl font-semibold text-ink mb-2">{section}</h2>
          {section === "General" && <>
            <Row label="Profile picture" hint="Shown in the sidebar. Stays on this Mac.">
              <div className="flex items-center gap-3"><Avatar src={prof.avatar} name={settings["profile.name"] || meta?.user || "You"} size={44} />
                <Button size="sm" onClick={prof.changePhoto}>{prof.avatar ? "Change" : "Add photo"}</Button>{prof.avatar && <Button size="sm" variant="ghost" onClick={() => prof.save({ "profile.avatar": "" })}>Remove</Button>}</div></Row>
            <Row label="Workspace label" hint="The small line under your name in the sidebar."><Input className="!w-60" defaultValue={settings["profile.workspace"] || ""} placeholder="Local workspace" onBlur={(e) => e.target.value !== (settings["profile.workspace"] || "") && set("profile.workspace")(e.target.value.trim())} /></Row>
            <Row label="Display name" hint="Shown in the sidebar. Empty uses your macOS account name.">{<Input className="!w-60" defaultValue={settings["profile.name"] || ""} placeholder={meta?.user || "Your name"} onBlur={(e) => e.target.value !== (settings["profile.name"] || "") && set("profile.name")(e.target.value.trim())} />}</Row>
            <Row label="Open on launch" hint="Where Atlas starts. A link to a specific page always wins.">
              <Select className="!w-44" value={settings["general.launch_view"] || "last"} onChange={(e) => set("general.launch_view")(e.target.value)}>
                <option value="last">Where I left off</option><option value="chat">Chat</option><option value="work">Work</option></Select></Row>
            <Row label="Welcome guide" hint="Walk through setting up a model again."><Button size="sm" onClick={() => saveSettings({ "onboarding.completed": false })}>Show</Button></Row>
          </>}
          {section === "Appearance" && <>
            <Row label="Appearance" hint="Black and white, with no accent colours.">
              <Select className="!w-40" value={settings["general.theme"] === "light" ? "light" : "dark"} onChange={(e) => set("general.theme")(e.target.value)}>
                <option value="light">Light</option><option value="dark">Dark</option></Select></Row>
            <Row label="Interface size" hint="Scales the whole app.">
              <Select className="!w-40" value={String(settings["general.ui_scale"] ?? 1)} onChange={(e) => set("general.ui_scale")(+e.target.value)}>
                <option value="0.9">Small (90%)</option><option value="1">Default</option><option value="1.1">Large (110%)</option><option value="1.2">Larger (120%)</option></Select></Row>
            <Row label="Personalized greeting" hint="Use your display name in the launch animation.">{tog("profile.personalized_greeting")}</Row>
            <Row label="Launch animation" hint="Play the Atlas welcome animation when the app opens.">{tog("general.launch_animation")}</Row>
            <Row label="Reduce motion" hint="Also respects the macOS Reduce Motion accessibility setting.">{tog("general.reduce_motion")}</Row>
          </>}
          {section === "Chat" && <>
            <Row label="Chat width" hint="How wide the conversation column is."><Select className="!w-40" value={settings["chat.width"] || "normal"} onChange={(e) => set("chat.width")(e.target.value)}>
              <option value="normal">Comfortable</option><option value="wide">Wide</option></Select></Row>
            <Row label="Send messages with" hint="The other key inserts a new line."><Select className="!w-40" value={settings["chat.send_key"] || "enter"} onChange={(e) => set("chat.send_key")(e.target.value)}>
              <option value="enter">Enter</option><option value="mod_enter">⌘ Enter</option></Select></Row>
            <Row label="Message text size" hint="Size of text in conversations.">
              <Select className="!w-40" value={settings["chat.font_size"] || "default"} onChange={(e) => set("chat.font_size")(e.target.value)}><option value="small">Small</option><option value="default">Default</option><option value="large">Large</option></Select></Row>
            <Row label="Spell check in the message box" hint="Underline misspelled words while you type.">
              <Toggle checked={settings["chat.spellcheck"] !== false} onChange={set("chat.spellcheck")} label="chat.spellcheck" /></Row>
            <Row label="Group chats by day" hint="Today, Yesterday and Previous headings in the sidebar.">
              <Toggle checked={settings["chat.group_history"] !== false} onChange={set("chat.group_history")} label="chat.group_history" /></Row>
            <Row label="Chats listed in the sidebar" hint="Older chats stay saved and are found with search.">
              <Select className="!w-40" value={String(settings["chat.history_limit"] ?? 50)} onChange={(e) => set("chat.history_limit")(+e.target.value)}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n} chats</option>)}<option value="0">All</option></Select></Row>
            <Row label="Confirm before deleting chats" hint="Ask first when you delete a conversation from the sidebar.">
              <Toggle checked={settings["chat.confirm_delete"] !== false} onChange={set("chat.confirm_delete")} label="chat.confirm_delete" /></Row>
          </>}
          {section === "Notifications" && <>
            <Row label="Also notify while Atlas is focused" hint="By default notifications only appear when Atlas is in the background.">{tog("general.notify_when_focused")}</Row>
            <Row label="Desktop notifications" hint="Notify when approvals are needed or objectives finish while ATLAS is in the background.">{tog("general.notifications")}</Row>
          </>}
          {section === "Keyboard shortcuts" && <>
            <div className="py-4 text-sm text-ink-2">Use <span className="font-mono text-ink">mod</span> for ⌘. Example: <span className="font-mono text-ink">mod+shift+p</span>. Changes apply when you leave the field.</div>
            {Object.entries(shortcuts).map(([k, v]) => (
              <Row key={k} label={SHORTCUT_LABELS[k] || k.replace(/_/g, " ")}>
                <Input className="!w-44 font-mono text-sm" value={v} onChange={(e) => setShortcuts({ ...shortcuts, [k]: e.target.value })} onBlur={() => set("shortcuts")(shortcuts)} /></Row>))}
          </>}
          {section === "Projects" && <>
            <Row label="Sort projects" hint="Order of the folder list in Work.">
              <Select className="!w-40" value={settings["projects.sort"] || "name"} onChange={(e) => set("projects.sort")(e.target.value)}><option value="name">By name</option><option value="added">By date added</option></Select></Row>
            <Row label="Commit history length" hint="How many recent commits a project page lists.">
              <Select className="!w-40" value={String(settings["projects.history_limit"] ?? 25)} onChange={(e) => set("projects.history_limit")(+e.target.value)}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} commits</option>)}</Select></Row>
            <Row label="Confirm before removing a project" hint="Removing only forgets the folder in Atlas; your files are never touched. Initializing git always asks.">
              <Toggle checked={settings["projects.confirm_remove"] !== false} onChange={set("projects.confirm_remove")} label="projects.confirm_remove" /></Row>
          </>}
          {section === "Models" && <>
            <Group title="Default models">
              {[["reasoning", "Planning and review", "Used by team leads and reviewers."], ["coding", "Writing code", "Used by engineers."], ["light", "Quick, light tasks", "Used by researchers and small jobs."]].map(([k, l, h]) => (
                <Row key={k} label={l} hint={h}>
                  <ModelPicker className="!w-64" providerId={routing[k]?.provider_id} model={routing[k]?.model} onChange={(p, m) => set("models.routing")({ ...routing, [k]: { provider_id: p, model: m } })} /></Row>))}
            </Group>
            <Group title="Local models">
              <ModelFolder variant="row" className="!px-0 !py-5 border-b border-line" />
              <Row label="Keep models ready for" hint="How long a local model stays in memory after its last use. Shorter frees memory sooner.">
                <Select className="!w-40" value={settings["models.keep_alive"]} onChange={(e) => set("models.keep_alive")(e.target.value)}>
                  {[["1m", "1 minute"], ["5m", "5 minutes"], ["10m", "10 minutes"], ["30m", "30 minutes"], ["1h", "1 hour"], ["-1", "Always"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Row>
              <Row label="Ollama address" hint="Change this only if Ollama runs somewhere else."><Input className="!w-60 font-mono text-xs" defaultValue={settings["models.ollama_url"]} onBlur={(e) => e.target.value !== settings["models.ollama_url"] && set("models.ollama_url")(e.target.value)} /></Row>
            </Group>
            <Group title="Models page">
              <Row label="Open on"><Select className="!w-40" value={settings["models.default_tab"] || "last"} onChange={(e) => set("models.default_tab")(e.target.value)}><option value="last">Last used</option><option value="endpoints">Endpoints</option><option value="models">Models</option></Select></Row>
              <Row label="Sort models by"><Select className="!w-40" value={settings["models.default_sort"] || "name"} onChange={(e) => set("models.default_sort")(e.target.value)}><option value="name">Name</option><option value="size">Size</option><option value="context">Context window</option></Select></Row>
            </Group>
          </>}
          {section === "Agents" && <>
            <Group title="How agents work">
              <Row label="Style" hint="Precise sticks to facts and code. Creative explores more ideas.">
                <Choice value={settings["agents.default_temperature"] ?? 0.2} options={[[0.1, "Precise"], [0.4, "Balanced"], [0.8, "Creative"]]} onPick={set("agents.default_temperature")} /></Row>
              <Row label="Working memory" hint="How much an agent can keep in mind at once. Larger needs more memory.">
                <Choice value={settings["agents.default_context_budget"] ?? 16000} options={[[8000, "Small"], [16000, "Medium"], [32000, "Large"], [64000, "Huge"]]} onPick={set("agents.default_context_budget")} /></Row>
            </Group>
            <Group title="New agents">
              <div className="py-5">
                <div className="text-base text-ink">Starting abilities</div>
                <div className="text-sm text-ink-2 mt-1 mb-3">What a new agent is allowed to do. You can change this per agent later.</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 max-w-[520px]">
                  {Object.keys(meta?.permission_groups || ABILITY_LABELS).map((k) => {
                    const on = (settings["agents.default_tools"] || []).includes(k);
                    return <label key={k} className="flex items-center gap-2.5 text-base text-ink"><input type="checkbox" checked={on} onChange={(e) => set("agents.default_tools")(e.target.checked ? [...(settings["agents.default_tools"] || []), k] : (settings["agents.default_tools"] || []).filter((x: string) => x !== k))} />{ABILITY_LABELS[k] || k}</label>;
                  })}
                </div>
              </div>
            </Group>
          </>}
          {section === "Execution" && <>
            <Group title="Planning">
              <Row label="Review agent plans first" hint="Pause after agents plan larger work so you can review it before execution.">{tog("execution.require_plan_approval")}</Row>
              <Row label="Work on separate branches" hint="Coding tasks use isolated branches to protect your project files.">{tog("execution.use_worktrees")}</Row>
            </Group>
            <Row label="Concurrent tasks" hint="Number of agent tasks allowed to run at once.">{num("execution.max_concurrent_tasks", 1, 16)}</Row>
            <Row label="Concurrent inference requests per provider" hint="Agents share loaded models; extra requests queue. Keep at 1–2 on 24 GB machines.">{num("execution.max_concurrent_inference", 1, 8)}</Row>
            <Row label="Command timeout (s)">{num("execution.command_timeout_s", 5, 3600)}</Row>
            <Row label="Task timeout (s)">{num("execution.task_timeout_s", 30, 86400)}</Row>
            <Row label="Automatic retries on provider errors">{num("execution.max_retries", 0, 5)}</Row>
          </>}
          {section === "Permissions" && <>
            <Row label="Command policy" hint="Destructive commands always ask; blocked patterns (sudo, disk tools…) are always denied.">
              <Select className="!w-56" value={settings["permissions.command_policy"]} onChange={(e) => set("permissions.command_policy")(e.target.value)}>
                <option value="ask">Ask for non-allowlisted commands</option><option value="allowlist">Allowlist only (deny others)</option><option value="auto">Run automatically (sandboxed)</option></Select></Row>
            <Row label="Sandbox commands" hint="macOS sandbox prevents agent commands from writing outside the workspace.">{tog("execution.sandbox_commands")}</Row>
            <Row label="Allow network in commands" hint="Off blocks outbound network for agent commands (localhost still allowed).">{tog("execution.allow_network_in_commands")}</Row>
            <Row label="Block credential files" hint=".env, keys, certificates and similar files cannot be read by agents.">{tog("permissions.block_secret_files")}</Row>
            <Row label="Protected branches" hint="Merging into these requires explicit confirmation.">
              <Input className="!w-60" value={prot} onChange={(e) => setProt(e.target.value)} onBlur={() => set("permissions.protected_branches")(prot.split(",").map((s) => s.trim()).filter(Boolean))} /></Row>
            <div className="py-5">
              <div className="text-base text-ink">Command allowlist</div>
              <div className="text-sm text-ink-2 mt-1 mb-3">One prefix per line. Every segment of a pipeline must match.</div>
              <TextArea rows={8} className="font-mono text-xs" value={allow} onChange={(e) => setAllow(e.target.value)} />
              <div className="flex justify-end mt-2"><Button size="sm" onClick={() => set("permissions.allowlist")(allow.split("\n").map((s) => s.trim()).filter(Boolean))}>Save allowlist</Button></div>
            </div>
          </>}
          {section === "Storage" && <>
            <Row label="Event retention" hint="Older execution events are pruned beyond this count.">{num("storage.event_retention", 1000, 1000000)}</Row>
            <Row label="Data location" hint="Database, worktrees and logs.">
              <span className="font-mono text-xs text-ink-2 selectable">~/Library/Application Support/ATLAS Harness</span></Row>
            <Row label="Database schema"><Badge>v{health?.schema}</Badge></Row>
          </>}
          {section === "Import" && <ImportSettings />}
          {section === "Skills" && <SkillsPanel />}
          {section === "Plugins" && <PluginsPanel />}
          {section === "Hooks" && <HooksPanel />}
          {section === "Integrations" && <div className="pt-1 pb-4">
            <McpIntegrations servers={settings["integrations.mcp_servers"] || []} status={mcp?.servers || []} saving={mcpSaving} onSave={saveMcp} />
          </div>}
          {section === "About & legal" && <>
            <Row label="Atlas" hint="Free software under the GNU AGPL v3.0 or later. Provided without warranty.">
              <span className="tnum text-ink-2">v{health?.version}</span></Row>
            <Row label="Terms of Use and Disclaimer"><Button size="sm" onClick={() => setDoc("terms")}>Read</Button></Row>
            <Row label="Privacy Policy" hint="Atlas collects nothing. Your data stays on this Mac unless you send it to a provider."><Button size="sm" onClick={() => setDoc("privacy")}>Read</Button></Row>
            <Row label="Trademarks" hint="Provider marks identify compatible services and remain their owners' property. Atlas is not affiliated with them."><Button size="sm" onClick={() => setDoc("trademarks")}>Read</Button></Row>
            <Row label="Source code" hint="Report issues and contribute on GitHub."><Button size="sm" onClick={() => openExternal("https://github.com/ryuzrx/atlas-harness")}>Open</Button></Row>
          </>}
          {section === "Advanced" && <>
            <Row label="Version"><span className="tnum">{health?.version}</span></Row>
            <Row label="Export settings" hint="Saves your settings as a JSON file. Integration (MCP) configuration is left out because it can hold secrets.">
              <Button size="sm" onClick={() => { const { ["integrations.mcp_servers"]: _m, ...rest } = settings; const url = URL.createObjectURL(new Blob([JSON.stringify(rest, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "atlas-settings.json"; a.click(); URL.revokeObjectURL(url); }}>Export</Button></Row>
            <Row label="Import settings" hint="Applies a settings file exported from Atlas. Unknown or integration settings are ignored.">
              <Button size="sm" onClick={() => { const i = document.createElement("input"); i.type = "file"; i.accept = "application/json"; i.onchange = async () => { try { const f = i.files?.[0]; if (!f) return; const data = JSON.parse(await f.text()); const skip = ["integrations.mcp_servers", "onboarding.completed", "legal.acknowledged"]; const body = Object.fromEntries(Object.entries(data).filter(([k]) => k in settings && !skip.includes(k))); await saveSettings(body); toast(`Imported ${Object.keys(body).length} settings`, "ok"); } catch (e: any) { toast(e.message || "Could not import that file", "bad"); } }; i.click(); }}>Import</Button></Row>
            <Row label="Copy diagnostics" hint="Version and schema, for bug reports. Contains no chats or keys.">
              <Button size="sm" onClick={() => navigator.clipboard.writeText(`Atlas v${health?.version} (schema ${health?.schema})\n${navigator.userAgent}`).then(() => toast("Copied", "ok"))}>Copy</Button></Row>
            <Row label="Reset settings" hint="Restores defaults. Teams, agents, tasks and history are kept.">
              <Button variant="danger" size="sm" onClick={() => confirm("Reset all settings to defaults?") &&
                run("r", () => api("/settings/reset", { body: {} }), "Settings reset").then(() => location.reload())}>Reset</Button></Row>
          </>}
        </div>
      </div>
    </div>
      <LegalDoc doc={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
