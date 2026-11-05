import React, { useState } from "react";
import { FolderOpen, FolderPlus, Globe, Package, PenLine, Plus, Puzzle, RotateCcw, Sparkles, Trash2, Webhook } from "lucide-react";
import { api, openPath, pickFolder, useApi } from "../api";
import { useStore } from "../store";
import { SkillPacks } from "./SkillPacks";
import { SkillHub } from "./SkillHub";
import { Button, cx, Field, Input, Menu, Modal, Select, TextArea, Toggle, useAction, useToast } from "./ui";

interface Ext {
  skills: { name: string; description: string; path: string; source: string; folder: string; enabled: boolean }[];
  plugins: { id: string; name: string; version: string; description: string; path: string; enabled: boolean; error?: string; skills: number; hooks: boolean }[];
  hooks: { id: string; event: string; matcher: string; command: string; label: string; enabled: boolean; block: boolean; source: string }[];
  hooks_enabled: boolean;
  dirs: Record<string, string>; defaults: Record<string, string>;
}
type Kind = "skills" | "plugins" | "hooks";
const KEY: Record<Kind, string> = { skills: "extensions.skills_dir", plugins: "extensions.plugins_dir", hooks: "extensions.hooks_dir" };
const useExtensions = () => useApi<Ext>("/extensions", ["settings"]);

const WHEN: [string, string][] = [
  ["before_command", "Before Atlas runs a command"], ["after_command", "After Atlas runs a command"],
  ["before_edit", "Before Atlas changes a file"], ["after_edit", "After Atlas changes a file"],
  ["before_any", "Before any action"], ["after_any", "After any action"],
];
const whenLabel = (event: string, matcher: string) => {
  const key = (event === "PreToolUse" ? "before_" : "after_") + (matcher === "run_command" ? "command" : matcher.includes("write_file") ? "edit" : "any");
  return WHEN.find(([k]) => k === key)?.[1] || `${event} · ${matcher}`;
};

function Shell({ intro, action, children }: { intro: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <>
    <div className="flex items-center gap-4 pt-1 pb-5">
      <div className="flex-1 min-w-0"><p className="text-[13.5px] leading-[20px] text-ink-2 max-w-[520px]">{intro}</p></div><div className="shrink-0">{action}</div>
    </div>
    {children}
  </>;
}
function Card({ children, empty, icon }: { children: React.ReactNode[]; empty: string; icon: React.ReactNode }) {
  return children.length ? <ul className="rounded-[12px] border border-line divide-y divide-[var(--border)]">{children}</ul> : (
    <div className="rounded-[12px] border border-dashed border-line py-10 flex flex-col items-center gap-2 text-ink-3">{icon}<span className="text-[13px]">{empty}</span></div>);
}
function RemoveBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button aria-label={label} title={label} onClick={onClick} className="h-8 w-8 flex items-center justify-center rounded-[8px] text-ink-3 hover:text-bad hover:bg-bad-bg"><Trash2 size={15} strokeWidth={1.6} /></button>;
}

/** Technical folder location, tucked away for people who want it. */
function Location({ kind, ext }: { kind: Kind; ext: Ext }) {
  const { saveSettings } = useStore();
  const toast = useToast();
  const dir = ext.dirs[kind];
  const isDefault = dir === ext.defaults[kind];
  const choose = async () => {
    const p = await pickFolder({ prompt: "Use Folder", message: `Choose where Atlas keeps ${kind}.` });
    if (p) saveSettings({ [KEY[kind]]: p }).then(() => toast("Folder saved", "ok")).catch((e) => toast(e.message, "bad"));
  };
  return (
    <details className="mt-6 group">
      <summary className="text-[13px] text-ink-3 hover:text-ink-2 cursor-default select-none list-none">Where are these stored?</summary>
      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1 font-mono text-[12px] text-ink-2 truncate selectable" title={dir}>{dir}</div>
        <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => openPath(dir)}>Open</Button>
        <Button size="sm" onClick={choose}>Change…</Button>
        {!isDefault && <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => saveSettings({ [KEY[kind]]: "" })}>Default</Button>}
      </div>
    </details>
  );
}

function NewSkill({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState(""); const [desc, setDesc] = useState(""); const [body, setBody] = useState("");
  const { busy, run } = useAction();
  const save = () => run("s", () => api("/extensions/skills", { body: { name, description: desc, body } }), "Skill added").then((r) => { if (r) { setName(""); setDesc(""); setBody(""); onClose(); } });
  return (
    <Modal open={open} onClose={onClose} title="Write a skill" width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy === "s"} disabled={!name || !body.trim()} onClick={save}>Add skill</Button></>}>
      <div className="space-y-4">
        <Field label="Name" hint="Short and lowercase, like code-review. You can type /code-review in Chat to use it."><Input autoFocus value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))} placeholder="code-review" /></Field>
        <Field label="What is it for?"><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Review changes for bugs and missing tests" /></Field>
        <Field label="Instructions" hint="Tell Atlas what to do, in plain words."><TextArea rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Look at what changed, point out likely bugs, and suggest tests…" /></Field>
      </div>
    </Modal>
  );
}

export function SkillsPanel() {
  const { data: ext } = useExtensions();
  const { settings, saveSettings } = useStore();
  const { run } = useAction();
  const [writing, setWriting] = useState(false);
  const [packs, setPacks] = useState(false);
  const [hub, setHub] = useState(false);
  if (!ext) return null;
  const off: string[] = settings?.["extensions.disabled_skills"] || [];
  const fromFolder = async () => {
    const p = await pickFolder({ prompt: "Add skill", message: "Choose a skill folder (it contains a SKILL.md file)." });
    if (p) run("i", () => api("/extensions/install", { body: { kind: "skills", path: p } }), "Skill added");
  };
  return (
    <Shell intro="Skills teach Atlas how you like things done. Turn on the ones you want. In Chat, type / and a skill's name to use it."
      action={<div className="flex gap-2"><Button icon={<Package size={14} />} onClick={() => setPacks(true)}>Skill packs</Button><Button icon={<Globe size={14} />} onClick={() => setHub(true)}>Find on GitHub</Button><Menu trigger={<Button variant="primary" icon={<Plus size={14} />}>Add skill</Button>}
        items={[{ label: "Write a skill", onClick: () => setWriting(true) }, { label: "Add from a folder…", onClick: fromFolder }]} /></div>}>
      <Card icon={<Sparkles size={20} strokeWidth={1.5} />} empty="No skills yet. Add a ready-made pack, or write your own.">
        {ext.skills.map((s) => (
          <li key={s.name} className="flex items-center gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] text-ink">{s.name}</div>
              <div className="text-[13px] text-ink-2 truncate" title={s.description}>{s.description || "No description"}{s.source !== "user" && ` · from ${s.source}`}</div>
            </div>
            <Toggle checked={s.enabled} label={`Use ${s.name}`} onChange={(v) => saveSettings({ "extensions.disabled_skills": v ? off.filter((n) => n !== s.name) : [...off, s.name] })} />
            {s.source === "user" && <RemoveBtn label={`Remove ${s.name}`} onClick={() => confirm(`Remove the skill “${s.name}”?`) && run("d", () => api(`/extensions/skills/${s.folder}`, { method: "DELETE" }), "Removed")} />}
          </li>))}
      </Card>
      <Location kind="skills" ext={ext} />
      <NewSkill open={writing} onClose={() => setWriting(false)} />
      <SkillPacks open={packs} onClose={() => setPacks(false)} />
      <SkillHub open={hub} onClose={() => setHub(false)} />
    </Shell>
  );
}

export function PluginsPanel() {
  const { data: ext } = useExtensions();
  const { settings, saveSettings } = useStore();
  const { run } = useAction();
  if (!ext) return null;
  const off: string[] = settings?.["extensions.disabled_plugins"] || [];
  const add = async () => {
    const p = await pickFolder({ prompt: "Add plugin", message: "Choose a plugin folder (it contains a plugin.json file)." });
    if (p) run("i", () => api("/extensions/install", { body: { kind: "plugins", path: p } }), "Plugin added");
  };
  return (
    <Shell intro="Plugins add extra skills and actions in one bundle. Add one from a folder, then switch it on or off here."
      action={<Button variant="primary" icon={<FolderPlus size={14} />} onClick={add}>Add plugin</Button>}>
      <Card icon={<Puzzle size={20} strokeWidth={1.5} />} empty="No plugins yet.">
        {ext.plugins.map((p) => (
          <li key={p.id} className="flex items-center gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] text-ink">{p.name}{p.version && <span className="text-ink-3 text-[12px] ml-2">v{p.version}</span>}</div>
              <div className={cx("text-[13px] truncate", p.error ? "text-bad" : "text-ink-2")} title={p.error || p.description}>{p.error || p.description || `${p.skills} skill${p.skills === 1 ? "" : "s"}${p.hooks ? " and hooks" : ""}`}</div>
            </div>
            <Toggle checked={p.enabled && !p.error} label={`Use ${p.name}`} onChange={(v) => saveSettings({ "extensions.disabled_plugins": v ? off.filter((n) => n !== p.id) : [...off, p.id] })} />
            <RemoveBtn label={`Remove ${p.name}`} onClick={() => confirm(`Remove the plugin “${p.name}”?`) && run("d", () => api(`/extensions/plugins/${p.id}`, { method: "DELETE" }), "Removed")} />
          </li>))}
      </Card>
      <Location kind="plugins" ext={ext} />
    </Shell>
  );
}

function NewHook({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [label, setLabel] = useState(""); const [when, setWhen] = useState("before_command"); const [command, setCommand] = useState(""); const [block, setBlock] = useState(false);
  const { busy, run } = useAction();
  const save = () => run("s", () => api("/extensions/hooks", { body: { label, when, command, block } }), "Hook added").then((r) => { if (r) { setLabel(""); setCommand(""); setBlock(false); onClose(); } });
  return (
    <Modal open={open} onClose={onClose} title="Add a hook" width={540}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy === "s"} disabled={!command.trim()} onClick={save}>Add hook</Button></>}>
      <div className="space-y-4">
        <Field label="When should it run?"><Select value={when} onChange={(e) => setWhen(e.target.value)}>{WHEN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="What should it run?" hint="A command, like ./check.sh or npm run lint."><Input autoFocus value={command} onChange={(e) => setCommand(e.target.value)} className="font-mono text-[12.5px]" placeholder="npm run lint" /></Field>
        <Field label="Name (optional)"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Lint before edits" /></Field>
        {when.startsWith("before") && (
          <label className="flex items-start gap-2.5 text-[13.5px] text-ink">
            <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} className="mt-1" />
            <span>Stop the action if the command fails<span className="block text-[12.5px] text-ink-3">Atlas tells the agent why it was stopped.</span></span>
          </label>)}
      </div>
    </Modal>
  );
}

export function HooksPanel() {
  const { data: ext } = useExtensions();
  const { settings, saveSettings } = useStore();
  const { run } = useAction();
  const [adding, setAdding] = useState(false);
  if (!ext) return null;
  const on = !!settings?.["extensions.hooks_enabled"];
  return (
    <Shell intro="Hooks run a command for you automatically, for example to check your code before Atlas changes it."
      action={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add hook</Button>}>
      <div className="flex items-center gap-4 mb-5 px-4 py-3.5 rounded-[12px] border border-line">
        <div className="flex-1 min-w-0">
          <div className="text-[14px] text-ink">Allow hooks to run</div>
          <div className="text-[13px] text-ink-2">Hooks run on your Mac, outside Atlas's safety sandbox. Only add commands you trust.</div>
        </div>
        <Toggle checked={on} label="Allow hooks to run" onChange={(v) => (!v || confirm("Hooks run commands on your Mac outside Atlas's safety sandbox. Turn them on?")) && saveSettings({ "extensions.hooks_enabled": v })} />
      </div>
      <Card icon={<Webhook size={20} strokeWidth={1.5} />} empty="No hooks yet.">
        {ext.hooks.map((h, i) => (
          <li key={h.id || i} className={cx("flex items-center gap-4 px-4 py-3.5", !on && "opacity-55")}>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] text-ink truncate">{h.label || h.command}</div>
              <div className="text-[13px] text-ink-2 truncate">{whenLabel(h.event, h.matcher)}{h.block && " · stops the action if it fails"}{h.source !== "user" && ` · from ${h.source}`}</div>
            </div>
            {h.source === "user" && h.id && <>
              <Toggle checked={h.enabled} label={`Use ${h.label || h.command}`} onChange={(v) => run("t", () => api(`/extensions/hooks/${h.id}`, { method: "PATCH", body: { enabled: v } }))} />
              <RemoveBtn label="Remove hook" onClick={() => run("d", () => api(`/extensions/hooks/${h.id}`, { method: "DELETE" }), "Removed")} />
            </>}
          </li>))}
      </Card>
      <Location kind="hooks" ext={ext} />
      <NewHook open={adding} onClose={() => setAdding(false)} />
    </Shell>
  );
}
