import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { Agent, api, Project, Task, Team, useApi } from "../api";
import { RouteName, useStore } from "../store";
import { Button, cx, Field, Input, Modal, Segmented, Select, TextArea, useAction } from "./ui";

export function NewTaskModal() {
  const { newTaskOpen, setNewTaskOpen, newTaskPreset, go, select } = useStore();
  const { data: teams = [] } = useApi<Team[]>(newTaskOpen ? "/teams" : null, ["team"]);
  const { data: projects = [] } = useApi<Project[]>(newTaskOpen ? "/projects" : null, ["project"]);
  const { data: agents = [] } = useApi<Agent[]>(newTaskOpen ? "/agents" : null, ["agent"]);
  const { data: tasks = [] } = useApi<Task[]>(newTaskOpen ? "/tasks?limit=100" : null, ["task"]);
  const [mode, setMode] = useState<"objective" | "task">("objective");
  const [teamId, setTeamId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [agentId, setAgentId] = useState("");
  const [deps, setDeps] = useState<string[]>([]);
  const [priority, setPriority] = useState(2);
  const [approval, setApproval] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => {
    if (!newTaskOpen) return;
    const t = newTaskPreset.teamId || teams[0]?.id || "";
    setTeamId(t);
    setProjectId(teams.find((x) => x.id === t)?.project_id || projects[0]?.id || "");
  }, [newTaskOpen, teams.length, projects.length]);
  const team = teams.find((t) => t.id === teamId);
  const lead = agents.find((a) => a.id === team?.lead_agent_id);
  const teamAgents = agents.filter((a) => !teamId || a.team_id === teamId);

  const submit = async () => {
    const r = await run("go", async () => mode === "objective"
      ? api<Task>("/objectives", { body: { team_id: teamId, objective: text, project_id: projectId || undefined, priority } })
      : api<Task>("/tasks", { body: { title, description: text, team_id: teamId || undefined, project_id: projectId || undefined,
          agent_id: agentId || undefined, deps, priority, needs_approval: approval, kind: "code" } }), "Task submitted");
    if (r) { setNewTaskOpen(false); setText(""); setTitle(""); setDeps([]); go({ name: "tasks" }); select({ kind: "task", id: r.id }); }
  };
  const canSubmit = mode === "objective" ? !!teamId && !!text.trim() : !!title.trim() && !!agentId;

  return (
    <Modal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} title="New task" width={600}
      footer={<>
        <Button variant="ghost" onClick={() => setNewTaskOpen(false)}>Cancel</Button>
        <Button variant="primary" onClick={submit} busy={busy === "go"} disabled={!canSubmit}>
          {mode === "objective" ? "Plan and run" : "Create task"}
        </Button>
      </>}>
      <div className="space-y-4">
        <Segmented value={mode} onChange={setMode} options={[{ id: "objective", label: "Team objective" }, { id: "task", label: "Single task" }]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Team">
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {mode === "task" && <option value="">No team</option>}
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project (scratch folder)</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_repo ? "" : " (not a git repo)"}</option>)}
            </Select>
          </Field>
        </div>
        {mode === "task" && (
          <>
            <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add input validation to signup form" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assign to agent">
                <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">Choose…</option>
                  {teamAgents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.model || "no model"}</option>)}
                </Select>
              </Field>
              <Field label="Depends on">
                <Select value="" onChange={(e) => e.target.value && setDeps((d) => Array.from(new Set([...d, e.target.value])))}>
                  <option value="">{deps.length ? `${deps.length} selected — add more…` : "None"}</option>
                  {tasks.filter((t) => t.kind !== "objective").map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </Select>
              </Field>
            </div>
            {deps.length > 0 && <div className="flex flex-wrap gap-1">{deps.map((d) => (
              <button key={d} onClick={() => setDeps((x) => x.filter((y) => y !== d))} className="text-[11.5px] px-2 h-6 rounded-full bg-active hover:bg-bad-bg hover:text-bad">
                {tasks.find((t) => t.id === d)?.title || d} ✕</button>))}</div>}
          </>
        )}
        <Field label={mode === "objective" ? "Objective" : "Instructions"}
          hint={mode === "objective" ? (lead ? `${lead.name} (${lead.model || "no model assigned"}) will inspect the project, plan tasks and delegate them.` :
            "This team has no lead. Assign one in the team's Agents tab.") : undefined}>
          <TextArea rows={5} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={mode === "objective" ? "Build a complete authentication system for my application." : "What exactly should the agent do?"}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) submit(); }} />
        </Field>
        <div className="flex items-center gap-4">
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(+e.target.value)} className="!w-36">
              <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
            </Select>
          </Field>
          {mode === "task" && (
            <label className="flex items-center gap-2 text-[12.5px] mt-5">
              <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Require my approval before it starts
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface PaletteItem { id: string; label: string; hint?: string; group: string; run: () => void }

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, go, setNewTaskOpen, toggleSidebar, select, saveSettings, settings } = useStore();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [found, setFound] = useState<any>({});
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (paletteOpen) { setQ(""); setIdx(0); setTimeout(() => input.current?.focus(), 10); } }, [paletteOpen]);
  useEffect(() => {
    if (!q.trim()) { setFound({}); return; }
    const h = setTimeout(() => api(`/search?q=${encodeURIComponent(q)}`).then(setFound).catch(() => {}), 120);
    return () => clearTimeout(h);
  }, [q]);
  const close = () => setPaletteOpen(false);
  const items = useMemo<PaletteItem[]>(() => {
    const nav: [RouteName, string][] = [["chat", "Chat"], ["agents", "Agents"], ["teams", "Teams"], ["models", "Models"], ["tasks", "Runs"],
      ["activity", "Activity"], ["projects", "Projects"], ["settings", "Settings"]];
    const base: PaletteItem[] = [
      { id: "chat", label: "New chat", hint: "⌘N", group: "Actions", run: () => go({ name: "chat" }) },
      { id: "new", label: "New run…", group: "Actions", run: () => setNewTaskOpen(true) },
      { id: "team", label: "Create team…", group: "Actions", run: () => go({ name: "teams", tab: "create" }) },
      { id: "sb", label: "Toggle sidebar", hint: "⌘B", group: "Actions", run: toggleSidebar },
      { id: "theme", label: `Switch to ${document.documentElement.dataset.theme === "dark" ? "light" : "dark"} appearance`, group: "Actions",
        run: () => saveSettings({ "general.theme": document.documentElement.dataset.theme === "dark" ? "light" : "dark" }) },
      ...nav.map(([id, label]) => ({ id: `go-${id}`, label: `Go to ${label}`, group: "Navigate", run: () => go({ name: id }) })),
      ...(found.teams || []).map((t: any) => ({ id: t.id, label: t.name, group: "Teams", run: () => go({ name: "team", id: t.id }) })),
      ...(found.agents || []).map((a: any) => ({ id: a.id, label: a.name, hint: a.role, group: "Agents", run: () => { go({ name: "agents" }); setTimeout(() => select({ kind: "agent", id: a.id }), 0); } })),
      ...(found.tasks || []).map((t: any) => ({ id: t.id, label: t.title, hint: t.status, group: "Runs", run: () => { go({ name: "tasks" }); setTimeout(() => select({ kind: "task", id: t.id }), 0); } })),
      ...(found.projects || []).map((p: any) => ({ id: p.id, label: p.name, group: "Projects", run: () => go({ name: "projects", id: p.id }) })),
    ];
    const s = q.toLowerCase().trim();
    return s ? base.filter((i) => ["Teams", "Agents", "Tasks", "Projects"].includes(i.group) || i.label.toLowerCase().includes(s)) : base;
  }, [q, found, settings]);
  useEffect(() => setIdx(0), [items.length]);
  if (!paletteOpen) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/50 backdrop-blur-[4px] modal-backdrop no-drag" onMouseDown={close}>
      <div role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}
        className="pop-in w-[600px] max-w-[92vw] bg-surface rounded-[12px] shadow-[var(--shadow-lg)] overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line">
          <Search size={16} className="text-ink-3" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search teams, agents, tasks, or run a command"
            className="flex-1 bg-transparent outline-none focus-visible:outline-none text-[14px] placeholder:text-ink-3"
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === "Enter" && items[idx]) { close(); items[idx].run(); }
            }} />
        </div>
        <div className="max-h-[380px] overflow-auto p-1.5" role="listbox">
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <React.Fragment key={it.group + it.id}>
                {header && <div className="eyebrow px-2.5 pt-2.5 pb-1">{header}</div>}
                <button role="option" aria-selected={i === idx} onMouseEnter={() => setIdx(i)} onClick={() => { close(); it.run(); }}
                  className={cx("w-full flex items-center gap-2 px-3 h-9 rounded-[10px] text-left text-[13px]", i === idx && "bg-active text-ink")}>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-[11px] text-ink-3">{it.hint}</span>}
                  {i === idx && <CornerDownLeft size={12} className="text-ink-3" />}
                </button>
              </React.Fragment>
            );
          })}
          {items.length === 0 && <div className="px-4 py-6 text-center text-ink-2 text-[12.5px]">No results</div>}
        </div>
      </div>
    </div>
  );
}
