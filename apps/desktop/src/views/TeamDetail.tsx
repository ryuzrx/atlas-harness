import React, { useEffect, useState } from "react";
import { ChevronLeft, Plus, Crown, Send, Check, Trash2 } from "lucide-react";
import { Agent, ago, api, Message, Project, Task, Team, useApi } from "../api";
import { useStore } from "../store";
import { ExecutionViewer, Markdownish } from "../components/Execution";
import { ModelPicker } from "../components/Inspector";
import { Badge, Button, Card, cx, Empty, Field, Input, Modal, Select, StatusBadge, Tabs, TextArea, useAction } from "../components/ui";
import { TaskTable, DependencyGraph } from "./Tasks";
import { teamColor } from "./Teams";

type Tab = "overview" | "agents" | "tasks" | "execution" | "context" | "artifacts" | "settings";

function AddAgentModal({ open, onClose, teamId }: { open: boolean; onClose: () => void; teamId: string }) {
  const { data: presets = [] } = useApi<any[]>(open ? "/presets" : null, ["preset"]);
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [instr, setInstr] = useState("");
  const [pm, setPm] = useState<{ p?: string; m?: string }>({}); const [preset, setPreset] = useState("");
  const { busy, run } = useAction();
  const { select } = useStore();
  const create = async () => {
    const p = presets.find((x) => x.id === preset)?.data || {};
    const a = await run("c", () => api<Agent>("/agents", { body: { ...p, team_id: teamId, name: name || p.name, role: role || p.role,
      instructions: instr || p.instructions || "", provider_id: pm.p || p.provider_id, model: pm.m || p.model,
      tools: p.tools || ["read", "write", "shell", "git", "messages", "memory"] } }), "Agent added");
    if (a) { onClose(); select({ kind: "agent", id: a.id }); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add agent"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy === "c"} disabled={!(name || preset) || !(role || preset)} onClick={create}>Add agent</Button></>}>
      <div className="space-y-3">
        {presets.length > 0 && <Field label="Start from preset"><Select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="">None</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="API Engineer" /></Field>
          <Field label="Role key"><Input value={role} onChange={(e) => setRole(e.target.value.replace(/\s+/g, "_").toLowerCase())} placeholder="api" /></Field>
        </div>
        <Field label="Model"><ModelPicker providerId={pm.p} model={pm.m} onChange={(p, m) => setPm({ p, m })} /></Field>
        <Field label="Instructions"><TextArea rows={3} value={instr} onChange={(e) => setInstr(e.target.value)} /></Field>
        <div className="text-[11.5px] text-ink-2">Permissions default to read, write, shell, git, messages and memory. Adjust them in the inspector.</div>
      </div>
    </Modal>
  );
}

function MemoryEditor({ scope, scopeId, title }: { scope: string; scopeId?: string; title: string }) {
  const { data: rows = [], reload } = useApi<any[]>(scopeId ? `/memory?scope=${scope}&scope_id=${scopeId}` : null, ["memory"]);
  const [key, setKey] = useState(""); const [content, setContent] = useState("");
  const { run } = useAction();
  if (!scopeId) return <Card className="p-4 text-ink-2 text-[12.5px]">{title}: assign a project to this team to use project memory.</Card>;
  return (
    <Card className="p-4">
      <div className="font-medium mb-1">{title}</div>
      <div className="text-[11.5px] text-ink-2 mb-3">Injected into agent prompts. Agent-written notes are unverified until you mark them verified.</div>
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-ink-3 text-[12.5px]">Empty.</div>}
        {rows.map((m) => (
          <div key={m.id} className="group p-2.5 rounded-[8px] border border-line">
            <div className="flex items-center gap-2">
              <span className="font-medium text-[12.5px]">{m.key}</span>
              <Badge tone={m.verified ? "ok" : "warn"}>{m.verified ? "verified" : "unverified"}</Badge>
              <span className="text-[11px] text-ink-3 truncate">{m.source}</span>
              <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100">
                {!m.verified && <button title="Mark verified" aria-label="Mark verified" className="h-6 w-6 rounded hover:bg-hover flex items-center justify-center" onClick={() => run("v", () => api(`/memory/${m.id}`, { method: "PATCH", body: { verified: 1 } })).then(reload)}><Check size={13} /></button>}
                <button title="Edit" className="h-6 px-1.5 rounded hover:bg-hover text-[11px]" onClick={() => { const c = prompt("Edit memory", m.content); if (c != null) run("e", () => api(`/memory/${m.id}`, { method: "PATCH", body: { content: c } })).then(reload); }}>Edit</button>
                <button title="Delete" aria-label="Delete memory" className="h-6 w-6 rounded hover:bg-hover flex items-center justify-center text-bad" onClick={() => run("d", () => api(`/memory/${m.id}`, { method: "DELETE" })).then(reload)}><Trash2 size={13} /></button>
              </span>
            </div>
            <div className="text-[12.5px] text-ink-2 mt-1 whitespace-pre-wrap selectable">{m.content}</div>
          </div>))}
      </div>
      <div className="mt-3 grid grid-cols-[160px_1fr_auto] gap-2">
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Key (e.g. conventions)" />
        <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Fact, decision or convention" />
        <Button disabled={!content} onClick={() => run("a", () => api("/memory", { body: { scope, scope_id: scopeId, key: key || "note", content } })).then(() => { setKey(""); setContent(""); reload(); })}>Add</Button>
      </div>
    </Card>
  );
}

const MSG_LABEL: Record<string, string> = {
  task_assignment: "Task assignment", status_update: "Status update", context_request: "Context request",
  research_finding: "Research finding", artifact_handoff: "Artifact handoff", review_request: "Review request",
  blocker_notification: "Blocker", completion_report: "Completion report",
};

export function TeamDetail({ id }: { id: string }) {
  const { go, select, setNewTaskOpen, route } = useStore();
  const [tab, setTab] = useState<Tab>((route.tab as Tab) || "overview");
  const { data: team, reload } = useApi<Team>(`/teams/${id}`, ["team", "agent", "task"]);
  const { data: agents = [] } = useApi<Agent[]>(`/agents?team_id=${id}`, ["agent"]);
  const { data: tasks = [] } = useApi<Task[]>(`/tasks?team_id=${id}&limit=300`, ["task"]);
  const { data: messages = [] } = useApi<Message[]>(`/messages?team_id=${id}&limit=60`, ["task"]);
  const { data: projects = [] } = useApi<Project[]>("/projects", ["project"]);
  const [objective, setObjective] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<Team>>({});
  const { busy, run } = useAction();
  useEffect(() => { if (team) setForm({ name: team.name, description: team.description, project_id: team.project_id }); }, [team?.id, team?.updated_at]);
  if (!team) return null;
  const agentName = (aid?: string) => agents.find((a) => a.id === aid)?.name || "User";
  const current = tasks.find((t) => t.id === team.current?.id);
  const currentKids = tasks.filter((t) => t.parent_id === current?.id);
  const submit = async () => {
    const r = await run("o", () => api<Task>("/objectives", { body: { team_id: id, objective } }), "Objective submitted");
    if (r) { setObjective(""); setTab("execution"); }
  };
  const done = tasks.filter((t) => t.kind !== "objective" && t.status === "completed");

  return (
    <div className="max-w-[1180px] mx-auto">
      <button onClick={() => go({ name: "teams" })} className="flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink mb-3"><ChevronLeft size={14} />Teams</button>
      <div className="flex items-start gap-3 mb-5">
        <span className="mt-2.5 h-2.5 w-2.5 rounded-full" style={{ background: teamColor(team.id) }} />
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{team.name}</h1>
          <div className="text-ink-2 text-[13px]">{team.description || "No description"} · {projects.find((p) => p.id === team.project_id)?.name || "no default project"}</div>
        </div>
        <StatusBadge status={team.status} />
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setNewTaskOpen(true, { teamId: id })}>New task</Button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Overview" }, { id: "agents", label: "Agents", count: agents.length },
        { id: "tasks", label: "Tasks", count: tasks.length }, { id: "execution", label: "Execution" },
        { id: "context", label: "Context" }, { id: "artifacts", label: "Artifacts", count: done.length }, { id: "settings", label: "Settings" }]} />

      {tab === "overview" && (
        <div className="grid grid-cols-[1fr_340px] gap-5 max-[1050px]:grid-cols-1">
          <div className="space-y-5 min-w-0">
            <Card className="p-4">
              <div className="font-medium mb-2">Give the team an objective</div>
              <TextArea rows={3} value={objective} onChange={(e) => setObjective(e.target.value)}
                placeholder="e.g. Add rate limiting to the public API and cover it with tests."
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && objective.trim()) submit(); }} />
              <div className="flex items-center mt-2">
                <span className="text-[11.5px] text-ink-2">{agents.find((a) => a.id === team.lead_agent_id) ? `${agentName(team.lead_agent_id)} plans and delegates. ⌘↩ to submit.` : "Set a team lead in the Agents tab first."}</span>
                <Button className="ml-auto" variant="primary" icon={<Send size={13} />} busy={busy === "o"} disabled={!objective.trim()} onClick={submit}>Submit</Button>
              </div>
            </Card>
            <div>
              <div className="flex items-center justify-between mb-2"><div className="text-[13px] font-semibold">Current objective</div>
                {current && <Button size="sm" variant="ghost" onClick={() => select({ kind: "task", id: current.id })}>Inspect</Button>}</div>
              {current ? (
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3"><span className="font-medium flex-1 truncate">{current.title}</span><StatusBadge status={current.status} /></div>
                  {currentKids.length ? <DependencyGraph tasks={currentKids} compact /> : <div className="text-ink-2 text-[12.5px]">{current.status === "planning" ? "The lead is planning…" : "No subtasks."}</div>}
                </Card>) : <Card><Empty title="No objective yet" body="Submit one above. The lead inspects the project, creates a plan and starts delegated work." /></Card>}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold mb-2">Agent messages</div>
            <Card className="p-3 max-h-[560px] overflow-auto">
              {messages.length === 0 ? <div className="text-ink-2 text-[12.5px] p-1">Structured handoffs between agents appear here.</div> :
                messages.map((m) => (
                  <div key={m.id} className="py-2 border-b border-line last:border-0">
                    <div className="flex items-center gap-1.5 text-[11.5px]">
                      <span className="font-medium">{agentName(m.sender_agent_id)}</span><span className="text-ink-3">→</span>
                      <span className="text-ink-2">{m.recipient_agent_id ? agentName(m.recipient_agent_id) : "team"}</span>
                      <Badge className="ml-auto">{MSG_LABEL[m.type] || m.type}</Badge>
                    </div>
                    <div className="text-[12px] text-ink-2 mt-1 line-clamp-3 selectable">{m.body.summary || m.body.content || (m.body.files ? `files: ${m.body.files.join(", ")}` : JSON.stringify(m.body))}</div>
                    <div className="text-[10.5px] text-ink-3 mt-0.5 tnum">{ago(m.at)}</div>
                  </div>))}
            </Card>
          </div>
        </div>)}

      {tab === "agents" && (
        <>
          <div className="flex justify-end mb-3"><Button icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add agent</Button></div>
          <Card className="overflow-hidden">
            {agents.length === 0 ? <Empty title="No agents" body="Add agents or create the team from a template." /> : (
              <table className="w-full text-[12.5px]">
                <thead><tr className="text-left text-[11.5px] text-ink-2 border-b border-line"><th className="font-medium px-4 h-9">Agent</th><th className="font-medium">Role</th><th className="font-medium">Model</th><th className="font-medium">Permissions</th><th className="font-medium">Current task</th><th className="font-medium w-28">Status</th><th className="w-24" /></tr></thead>
                <tbody>{agents.map((a) => (
                  <tr key={a.id} onClick={() => select({ kind: "agent", id: a.id })} className="border-b border-line last:border-0 hover:bg-hover">
                    <td className="px-4 h-11 font-medium"><div className="flex items-center gap-1.5">{a.name}{a.is_lead && <Crown size={12} className="text-warn" aria-label="Team lead" />}</div></td>
                    <td className="text-ink-2">{a.role}</td>
                    <td className="font-mono text-[11.5px]">{a.model || <span className="text-warn font-sans">unassigned</span>}</td>
                    <td className="text-ink-2 text-[11.5px]">{a.tools.join(", ")}</td>
                    <td className="text-ink-2 truncate max-w-[180px]">{a.current_task?.title || "—"}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td onClick={(e) => e.stopPropagation()}>{!a.is_lead && <Button size="sm" variant="ghost" onClick={() => run("l", () => api(`/agents/${a.id}`, { method: "PATCH", body: { make_lead: true } }), `${a.name} is now lead`).then(reload)}>Make lead</Button>}</td>
                  </tr>))}</tbody>
              </table>)}
          </Card>
          <AddAgentModal open={adding} onClose={() => setAdding(false)} teamId={id} />
        </>)}

      {tab === "tasks" && <TaskTable tasks={tasks} />}
      {tab === "execution" && <ExecutionViewer teamId={id} height="calc(100vh - 290px)" />}
      {tab === "context" && (
        <div className="grid grid-cols-2 gap-4 max-[1000px]:grid-cols-1">
          <MemoryEditor scope="team" scopeId={id} title="Team memory" />
          <MemoryEditor scope="project" scopeId={team.project_id} title="Project memory" />
        </div>)}
      {tab === "artifacts" && (
        <div className="space-y-3">
          {tasks.filter((t) => t.kind === "objective" && t.artifacts?.report).map((t) => (
            <Card key={t.id} className="p-4"><div className="flex items-center gap-2 mb-2"><span className="font-medium flex-1">{t.title}</span><StatusBadge status={t.status} />
              <Button size="sm" variant="ghost" onClick={() => select({ kind: "task", id: t.id })}>Inspect</Button></div>
              <Markdownish text={t.artifacts.report} /></Card>))}
          {done.map((t) => (
            <Card key={t.id} className="p-3.5 flex items-center gap-3 cursor-default hover:bg-hover" onClick={() => select({ kind: "task", id: t.id })}>
              <div className="min-w-0 flex-1"><div className="font-medium text-[12.5px] truncate">{t.title}</div>
                <div className="text-[11.5px] text-ink-2 truncate">{t.artifacts?.branch ? <span className="font-mono">{t.artifacts.branch}</span> : "in-place"} · {(t.artifacts?.files || []).length} files · {t.agent_name}</div></div>
              {t.artifacts?.merged && <Badge tone="ok">merged</Badge>}
              <span className="text-[11px] text-ink-3 tnum">{ago(t.finished_at)}</span>
            </Card>))}
          {done.length === 0 && <Card><Empty title="No artifacts yet" body="Completed tasks, their branches, changed files and final reports appear here." /></Card>}
        </div>)}
      {tab === "settings" && (
        <Card className="p-5 max-w-[640px] space-y-4">
          <Field label="Name"><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description"><TextArea rows={2} value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Default project" hint="Objectives run against this folder unless another project is chosen.">
            <Select value={form.project_id || ""} onChange={(e) => setForm({ ...form, project_id: e.target.value || undefined })}>
              <option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Team lead"><Select value={team.lead_agent_id || ""} onChange={(e) => run("l", () => api(`/agents/${e.target.value}`, { method: "PATCH", body: { make_lead: true } }), "Lead updated").then(reload)}>
            <option value="" disabled>Choose…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <div className="flex gap-2 pt-1">
            <Button variant="primary" busy={busy === "s"} onClick={() => run("s", () => api(`/teams/${id}`, { method: "PATCH", body: { ...form, project_id: form.project_id || null } }), "Team saved").then(reload)}>Save</Button>
            <Button onClick={() => run("d", () => api<Team>(`/teams/${id}/duplicate`, { body: {} }), "Duplicated").then((t) => t && go({ name: "team", id: t.id }))}>Duplicate</Button>
            <Button onClick={() => run("a", () => api(`/teams/${id}/archive`, { body: { archived: !team.archived } }), team.archived ? "Unarchived" : "Archived").then(reload)}>{team.archived ? "Unarchive" : "Archive"}</Button>
            <Button variant="danger" className="ml-auto" onClick={() => confirm(`Delete ${team.name}?`) && run("x", () => api(`/teams/${id}`, { method: "DELETE" }), "Deleted").then(() => go({ name: "teams" }))}>Delete team</Button>
          </div>
        </Card>)}
    </div>
  );
}
