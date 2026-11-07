import React, { useEffect, useState } from "react";
import { X, Pause, Play, Square, MoreHorizontal, GitMerge, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Agent, ago, api, dur, Model, Task, Team, useApi } from "../api";
import { useStore } from "../store";
import { ExecutionViewer, Markdownish } from "./Execution";
import { Badge, Button, cx, Field, IconButton, Input, Menu, Modal, Select, StatusBadge, TextArea, Toggle, useAction } from "./ui";

export const PERMISSIONS: Record<string, string> = {
  read: "Read files & search", write: "Edit files", shell: "Run commands", git: "Git", memory: "Write memory",
  messages: "Message teammates", mcp: "MCP integrations",
};

export function ModelPicker({ providerId, model, onChange, className, emptyLabel = "No model assigned" }: {
  providerId?: string; model?: string; onChange: (providerId: string, model: string) => void; className?: string; emptyLabel?: string;
}) {
  const { data: models = [] } = useApi<Model[]>("/models", ["model", "provider"]);
  const value = providerId && model ? `${providerId}::${model}` : "";
  const groups: Record<string, Model[]> = {};
  for (const m of models) if (m.name) (groups[m.provider_name] ||= []).push(m);
  const known = models.some((m) => `${m.provider_id}::${m.name}` === value);
  return (
    <Select className={className} value={value} onChange={(e) => { const [p, ...rest] = e.target.value.split("::"); onChange(p, rest.join("::")); }}>
      <option value="">{emptyLabel}</option>
      {value && !known && <option value={value}>{model} (not currently available)</option>}
      {Object.entries(groups).map(([g, ms]) => (
        <optgroup key={g} label={g}>
          {ms.map((m) => (
            <option key={m.provider_id + m.name} value={`${m.provider_id}::${m.name}`}>
              {m.name}{m.capabilities?.tools === false ? " · text tools" : ""}{m.capabilities?.agentic ? " · CLI agent" : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="py-3.5 border-b border-line last:border-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-ink-2 uppercase tracking-[0.05em]">{title}</div>{action}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-start gap-3 py-1 text-sm"><span className="w-28 shrink-0 text-ink-2">{k}</span><span className="min-w-0 flex-1 break-words">{v}</span></div>;
}

export function AgentEditor({ agent, onSaved }: { agent: Agent; onSaved?: () => void }) {
  const [a, setA] = useState(agent);
  useEffect(() => setA(agent), [agent.id, agent.updated_at]);
  const { busy, run } = useAction();
  const set = (patch: Partial<Agent>) => setA((x) => ({ ...x, ...patch }));
  const cfg = (k: string, v: any) => setA((x) => ({ ...x, config: { ...x.config, [k]: v } }));
  const prm = (k: string, v: any) => setA((x) => ({ ...x, params: { ...x.params, [k]: v } }));
  const save = () => run("save", () => api(`/agents/${a.id}`, { method: "PATCH", body: {
    name: a.name, role: a.role, instructions: a.instructions, provider_id: a.provider_id || null, model: a.model || null,
    params: a.params, tools: a.tools, config: a.config } }), "Agent saved").then((result) => { if (result) onSaved?.(); });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Name"><Input value={a.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label="Role" hint="Used by the lead when delegating."><Input value={a.role} onChange={(e) => set({ role: e.target.value })} /></Field>
      </div>
      <Field label="Model" hint="Capabilities are checked per model; models without tool calling use ATLAS's text tool protocol.">
        <ModelPicker providerId={a.provider_id} model={a.model} onChange={(p, m) => set({ provider_id: p, model: m })} />
      </Field>
      <Field label="System instructions"><TextArea rows={4} value={a.instructions} onChange={(e) => set({ instructions: e.target.value })} /></Field>
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm text-ink-2">Advanced settings & permissions</summary>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Temperature"><Input type="number" step="0.1" min="0" max="2" value={a.params.temperature ?? ""} onChange={(e) => prm("temperature", e.target.value === "" ? undefined : +e.target.value)} /></Field>
            <Field label="Max output tokens"><Input type="number" value={a.params.max_tokens ?? ""} placeholder="default" onChange={(e) => prm("max_tokens", e.target.value ? +e.target.value : undefined)} /></Field>
            <Field label="Context budget"><Input type="number" value={a.config.context_budget ?? 16000} onChange={(e) => cfg("context_budget", +e.target.value)} /></Field>
            <Field label="Max duration (s)"><Input type="number" value={a.config.max_duration_s ?? ""} placeholder="default" onChange={(e) => cfg("max_duration_s", e.target.value ? +e.target.value : undefined)} /></Field>
            <Field label="Retries"><Input type="number" min="0" max="5" value={a.config.max_retries ?? ""} placeholder="default" onChange={(e) => cfg("max_retries", e.target.value === "" ? undefined : +e.target.value)} /></Field>
            <Field label="Parallel tasks"><Input type="number" min="1" max="4" value={a.config.max_parallel ?? 1} onChange={(e) => cfg("max_parallel", +e.target.value)} /></Field>
            <Field label="Memory"><Select value={a.config.memory ?? "team"} onChange={(e) => cfg("memory", e.target.value)}>
              <option value="team">Team + project</option><option value="project">Project only</option><option value="none">Task only</option></Select></Field>
            <Field label="Workspace access"><Select value={a.config.workspace_access ?? "project"} onChange={(e) => cfg("workspace_access", e.target.value)}>
              <option value="project">Project (isolated)</option><option value="readonly">Read-only</option></Select></Field>
          </div>
          <Field label="Reporting format"><Input value={a.config.report_format ?? ""} placeholder="e.g. Summary, Files changed, Tests run, Risks" onChange={(e) => cfg("report_format", e.target.value)} /></Field>
          <Field label="Tool permissions">
            <div className="grid grid-cols-2 gap-1.5 mt-0.5">
              {Object.entries(PERMISSIONS).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Toggle checked={a.tools.includes(k)} label={label} onChange={(v) => set({ tools: v ? [...a.tools, k] : a.tools.filter((t) => t !== k) })} />
                  {label}
                </label>
              ))}
            </div>
          </Field>
        </div>
      </details>
      <div className="flex justify-end"><Button variant="primary" disabled={!a.name.trim() || !a.role.trim()} onClick={save} busy={busy === "save"}>Save changes</Button></div>
    </div>
  );
}

function AgentInspector({ id }: { id: string }) {
  const { data: a, reload } = useApi<Agent>(`/agents/${id}`, ["agent"]);
  const { data: tasks = [] } = useApi<Task[]>(`/tasks?agent_id=${id}&limit=20`, ["task"]);
  const { data: teams = [] } = useApi<Team[]>("/teams", ["team"]);
  const { select } = useStore();
  const { busy, run } = useAction();
  const [moving, setMoving] = useState(false);
  if (!a) return null;
  return (
    <>
      <div className="flex items-center gap-2.5">
        <div className="h-9 w-9 rounded-md bg-hover flex items-center justify-center text-sm font-semibold">{a.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{a.name} {a.is_lead && <Badge tone="info">Lead</Badge>}</div>
          <div className="text-xs text-ink-2 truncate">{a.role} · {a.team_name || "No team"}</div>
        </div>
        <StatusBadge status={a.status} />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {a.status === "paused"
          ? <Button size="sm" icon={<Play size={13} />} onClick={() => run("r", () => api(`/agents/${id}/resume`, { body: {} })).then(reload)}>Resume</Button>
          : <Button size="sm" icon={<Pause size={13} />} onClick={() => run("p", () => api(`/agents/${id}/pause`, { body: {} }), "Agent paused; current step finishes first").then(reload)}>Pause</Button>}
        <Button size="sm" icon={<Square size={12} />} disabled={!a.current_task} onClick={() => run("c", () => api(`/agents/${id}/cancel`, { body: {} }), "Cancelled")}>Cancel task</Button>
        <Menu trigger={<Button size="sm" icon={<MoreHorizontal size={14} />}>More</Button>} items={[
          { label: "Duplicate", disabled: busy !== null, onClick: () => { void run("cl", () => api(`/agents/${id}/clone`, { body: {} }), "Agent duplicated"); } },
          { label: "Move to team…", onClick: () => setMoving(true) },
          { label: "Save as preset", disabled: busy !== null, onClick: () => { void run("ps", () => api("/presets", { body: { agent_id: id } }), "Saved as preset"); } },
          { label: "Delete agent", danger: true, disabled: busy !== null, onClick: async () => { if (!confirm(`Delete ${a.name}?`)) return; const result = await run("d", () => api(`/agents/${id}`, { method: "DELETE" }), "Agent deleted"); if (result) select(null); } },
        ]} />
      </div>
      <Section title="Now">
        <KV k="Model" v={a.model ? <span className="font-mono text-xs">{a.model}</span> : <span className="text-warn">No model assigned</span>} />
        <KV k="Provider" v={a.provider_name || "—"} />
        <KV k="Current task" v={a.current_task ? <button className="text-accent hover:underline text-left" onClick={() => select({ kind: "task", id: a.current_task!.id })}>{a.current_task.title}</button> : "Idle"} />
        <KV k="Last activity" v={ago(a.last_activity)} />
      </Section>
      <Section title="Configuration"><AgentEditor agent={a} onSaved={reload} /></Section>
      <Section title="Execution history">
        {tasks.length === 0 ? <div className="text-ink-2 text-sm">No tasks yet.</div> : tasks.map((t) => (
          <button key={t.id} onClick={() => select({ kind: "task", id: t.id })} className="w-full flex items-center gap-2 py-1.5 text-left hover:bg-hover rounded px-1">
            <StatusBadge status={t.status} /><span className="flex-1 truncate text-sm">{t.title}</span><span className="text-2xs text-ink-3 tnum">{ago(t.updated_at)}</span>
          </button>))}
      </Section>
      <Section title="Recent events"><ExecutionViewer agentId={id} height={280} showFilters={false} /></Section>
      <Modal open={moving} onClose={() => setMoving(false)} title={`Move ${a.name}`}>
        <Select defaultValue={a.team_id || ""} onChange={(e) => run("mv", () => api(`/agents/${id}/move`, { body: { team_id: e.target.value || null } }), "Agent moved").then(() => { setMoving(false); reload(); })}>
          <option value="">No team</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Modal>
    </>
  );
}

export function DiffView({ diff }: { diff: string }) {
  if (!diff) return <div className="text-ink-2 text-sm">No changes.</div>;
  return (
    <pre className="selectable text-xs font-mono leading-[1.55] rounded-md border border-line bg-surface-2 overflow-auto max-h-[480px]">
      {diff.split("\n").slice(0, 4000).map((l, i) => (
        <div key={i} className={cx("px-2.5 whitespace-pre",
          l.startsWith("+") && !l.startsWith("+++") && "bg-ok-bg text-ok",
          l.startsWith("-") && !l.startsWith("---") && "bg-bad-bg text-bad",
          l.startsWith("@@") && "text-accent", (l.startsWith("diff ") || l.startsWith("index ")) && "text-ink-3")}>{l || " "}</div>
      ))}
    </pre>
  );
}

function MergePanel({ task, onDone }: { task: Task; onDone: () => void }) {
  const [preview, setPreview] = useState<any>(null);
  const [confirmProtected, setConfirm] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => { api(`/tasks/${task.id}/merge-preview`).then(setPreview).catch((e) => setPreview({ error: e.message })); }, [task.id]);
  if (!preview) return null;
  if (preview.error) return <div className="text-bad text-sm">{preview.error}</div>;
  const merged = task.artifacts?.merged;
  return (
    <div className="space-y-2 text-sm">
      <KV k="Into" v={<span className="font-mono">{preview.target}</span>} />
      <KV k="Files" v={preview.files.length ? preview.files.join(", ") : "none"} />
      <KV k="Conflicts" v={preview.clean ? <span className="text-ok">None detected</span> : <span className="text-bad">{preview.conflicts.join(", ") || "yes"}</span>} />
      {preview.dirty?.length > 0 && <div className="text-warn">Your checkout has {preview.dirty.length} uncommitted change(s). ATLAS refuses merges that touch those files.</div>}
      {preview.protected && !merged && (
        <label className="flex items-center gap-2 text-warn"><input type="checkbox" checked={confirmProtected} onChange={(e) => setConfirm(e.target.checked)} />
          I reviewed this change and authorize merging into protected branch <b>{preview.target}</b></label>)}
      <div className="flex gap-2 pt-1">
        {!merged ? (
          <Button variant="primary" size="sm" icon={<GitMerge size={13} />} disabled={!preview.clean || (preview.protected && !confirmProtected)} busy={busy === "m"}
            onClick={() => run("m", () => api(`/tasks/${task.id}/merge`, { body: { confirm_protected: confirmProtected } }), "Merged").then(onDone)}>Merge</Button>
        ) : task.artifacts?.reverted ? <Badge tone="muted">Merge reverted</Badge> : (
          <Button size="sm" icon={<Undo2 size={13} />} busy={busy === "r"} onClick={() => confirm("Create a revert commit for this merge?") && run("r", () => api(`/tasks/${task.id}/rollback`, { body: {} }), "Reverted").then(onDone)}>Revert merge</Button>
        )}
      </div>
    </div>
  );
}

function TaskInspector({ id }: { id: string }) {
  const { data: t, reload } = useApi<Task>(`/tasks/${id}`, ["task", "approval"]);
  const { select } = useStore();
  const { busy, run } = useAction();
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => setDiff(null), [id]);
  if (!t) return null;
  const live = ["running", "planning", "reviewing", "waiting_approval", "queued", "ready"].includes(t.status);
  const a = t.artifacts || {};
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug">{t.title}</div>
          <div className="text-xs text-ink-2 mt-0.5">{t.kind === "objective" ? "Objective" : t.kind} · {t.team_name || "No team"} · {t.agent_name || "unassigned"}</div>
        </div>
        <StatusBadge status={t.status} />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        {live && <Button size="sm" icon={<Square size={12} />} onClick={() => run("c", () => api(`/tasks/${id}/cancel`, { body: {} }), "Cancelled").then(reload)}>Cancel</Button>}
        {["failed", "cancelled", "blocked"].includes(t.status) && <Button size="sm" icon={<RotateCcw size={13} />} busy={busy === "r"} onClick={() => run("r", () => api(`/tasks/${id}/retry`, { body: {} }), "Requeued").then(reload)}>Retry</Button>}
        {t.kind === "objective" && t.status === "waiting_approval" && <>
          <Button size="sm" variant="primary" onClick={() => run("a", () => api(`/tasks/${id}/approve-plan`, { body: { approved: true } }), "Plan approved").then(reload)}>Approve plan</Button>
          <Button size="sm" variant="danger" onClick={() => run("a", () => api(`/tasks/${id}/approve-plan`, { body: { approved: false } }), "Plan rejected").then(reload)}>Reject</Button></>}
        {!live && <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => confirm("Delete this task and its history?") && run("d", () => api(`/tasks/${id}`, { method: "DELETE" }), "Deleted").then(() => select(null))}>Delete</Button>}
      </div>
      {t.error && <div className="mt-3 p-2.5 rounded-md bg-bad-bg text-bad text-xs selectable whitespace-pre-wrap">{t.error}</div>}
      {t.approvals?.filter((x) => x.status === "pending").map((ap) => (
        <div key={ap.id} className="mt-3 p-3 rounded-md border border-warn/40 bg-warn-bg">
          <div className="text-xs font-medium text-warn">Approval needed: {ap.kind.replace(/_/g, " ")}</div>
          <pre className="selectable text-xs font-mono mt-1.5 whitespace-pre-wrap">{ap.payload.command || ap.payload.title || JSON.stringify(ap.payload, null, 2)}</pre>
          {ap.payload.reason && <div className="text-xs text-ink-2 mt-1">{ap.payload.reason}</div>}
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="primary" onClick={() => run("ap", () => api(`/approvals/${ap.id}`, { body: { approved: true } })).then(reload)}>Allow once</Button>
            <Button size="sm" variant="danger" onClick={() => run("ap", () => api(`/approvals/${ap.id}`, { body: { approved: false } })).then(reload)}>Deny</Button>
          </div>
        </div>
      ))}
      <Section title="Details">
        <KV k="Created" v={new Date(t.created_at * 1000).toLocaleString()} />
        <KV k="Duration" v={<span className="tnum">{dur(t.started_at, t.finished_at)}</span>} />
        <KV k="Attempts" v={<span className="tnum">{t.attempts}</span>} />
        <KV k="Model" v={t.agent_model ? <span className="font-mono text-xs">{t.agent_model}</span> : "—"} />
        {t.deps.length > 0 && <KV k="Depends on" v={t.deps.map((d) => <button key={d} onClick={() => select({ kind: "task", id: d })} className="block text-accent hover:underline">{d}</button>)} />}
        {t.description && <KV k="Instructions" v={<div className="selectable whitespace-pre-wrap text-ink-2">{t.description}</div>} />}
        {t.acceptance?.length > 0 && <KV k="Acceptance" v={<ul>{t.acceptance.map((x, i) => <li key={i} className="list-disc ml-4">{x}</li>)}</ul>} />}
      </Section>
      {t.children && t.children.length > 0 && (
        <Section title={`Subtasks (${t.children.length})`}>
          {t.children.map((c) => (
            <button key={c.id} onClick={() => select({ kind: "task", id: c.id })} className="w-full flex items-center gap-2 py-1.5 px-1 text-left rounded hover:bg-hover">
              <StatusBadge status={c.status} /><span className="flex-1 truncate text-sm">{c.title}</span><span className="text-2xs text-ink-2 truncate max-w-[110px]">{c.agent_name}</span>
            </button>))}
        </Section>)}
      {(t.result || a.report) && <Section title="Result"><Markdownish text={a.report || t.result || ""} /></Section>}
      {(a.files?.length > 0 || a.branch) && (
        <Section title="Changes" action={a.branch && <Button size="sm" variant="ghost" onClick={() => api(`/tasks/${id}/diff`).then((d) => setDiff(d.diff))}>View diff</Button>}>
          {a.branch && <KV k="Branch" v={<span className="font-mono text-xs">{a.branch}</span>} />}
          <KV k="Files" v={(a.files || []).join(", ") || "none"} />
          {a.diffstat && <pre className="selectable text-xs font-mono text-ink-2 mt-1 whitespace-pre-wrap">{a.diffstat}</pre>}
          {diff !== null && <div className="mt-2"><DiffView diff={diff} /></div>}
          {a.branch && t.status === "completed" && <div className="mt-3"><MergePanel task={t} onDone={reload} /></div>}
        </Section>)}
      {t.evidence?.commands?.length > 0 && (
        <Section title="Verification evidence">
          {t.evidence.verification && <div className="text-sm mb-1.5 selectable">{t.evidence.verification}</div>}
          {t.evidence.commands.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs font-mono py-0.5"><Badge tone={c.exit_code === 0 ? "ok" : "bad"}>{c.exit_code ?? "timeout"}</Badge>{c.command}</div>))}
        </Section>)}
      {a.plan && (
        <Section title="Plan"><div className="text-sm text-ink-2 selectable">{a.plan.summary}</div></Section>)}
      <Section title="State history">
        {(t.transitions || []).map((tr, i) => (
          <div key={i} className="flex items-start gap-2 text-xs py-0.5">
            <span className="text-ink-3 tnum w-[74px] shrink-0 whitespace-nowrap">{new Date(tr.at * 1000).toLocaleTimeString()}</span>
            <span className="shrink-0">{tr.from_status || "—"} → <b className="font-medium">{tr.to_status}</b></span>
            <span className="text-ink-2 truncate">{tr.reason}</span>
          </div>))}
      </Section>
      <Section title="Execution"><ExecutionViewer taskId={id} height={360} /></Section>
    </>
  );
}

export function Inspector() {
  const { selection, select } = useStore();
  if (!selection) return null;
  return (
    <aside className="w-[420px] shrink-0 h-full chrome border-l border-line flex flex-col fade-in max-[1100px]:absolute max-[1100px]:right-0 max-[1100px]:z-30 max-[1100px]:shadow-[var(--shadow-lg)]">
      <div className="drag h-[56px] shrink-0 flex items-center justify-between px-4">
        <span className="text-sm font-semibold">{selection.kind === "agent" ? "Agent" : "Task"}</span>
        <IconButton label="Close inspector" onClick={() => select(null)}><X size={15} /></IconButton>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {selection.kind === "agent" ? <AgentInspector id={selection.id} /> : <TaskInspector id={selection.id} />}
      </div>
    </aside>
  );
}
