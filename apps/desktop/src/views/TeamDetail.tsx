import React, { useEffect, useState } from "react";
import { ChevronLeft, Plus, Send, Check, Trash2, Users } from "lucide-react";
import { Agent, ago, api, Message, Project, Task, Team, useApi } from "../api";
import { useStore } from "../store";
import { ExecutionViewer, Markdownish } from "../components/Execution";
import { AgentRoster, AutoAssignModels, CreateAgentModal } from "../components/AgentManagement";
import { Badge, Button, Card, cx, Empty, Field, Input, Modal, Select, StatusBadge, Tabs, TextArea, useAction } from "../components/ui";
import { TaskTable, DependencyGraph } from "./Tasks";


type Tab = "overview" | "agents" | "execution" | "resources" | "settings";
const tabFor = (tab?: string): Tab => tab === "context" || tab === "artifacts" ? "resources" : tab === "tasks" ? "overview" : ["overview", "agents", "execution", "resources", "settings"].includes(tab || "") ? tab as Tab : "overview";

function MemoryEditor({ scope, scopeId, title }: { scope: string; scopeId?: string; title: string }) {
  const { data: rows = [], reload } = useApi<any[]>(scopeId ? `/memory?scope=${scope}&scope_id=${scopeId}` : null, ["memory"]);
  const [key, setKey] = useState(""); const [content, setContent] = useState("");
  const { run } = useAction();
  if (!scopeId) return <Card className="p-4 text-ink-2 text-sm">{title}: assign a project to this team to use project memory.</Card>;
  return (
    <Card className="p-4">
      <div className="font-medium mb-1">{title}</div>
      <div className="text-xs text-ink-2 mb-3">Injected into agent prompts. Agent-written notes are unverified until you mark them verified.</div>
      <div className="space-y-2">
        {rows.length === 0 && <div className="text-ink-3 text-sm">Empty.</div>}
        {rows.map((m) => (
          <div key={m.id} className="group p-2.5 rounded-md border border-line">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{m.key}</span>
              <Badge tone={m.verified ? "ok" : "warn"}>{m.verified ? "verified" : "unverified"}</Badge>
              <span className="text-2xs text-ink-3 truncate">{m.source}</span>
              <span className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100">
                {!m.verified && <button title="Mark verified" aria-label="Mark verified" className="h-6 w-6 rounded hover:bg-hover flex items-center justify-center" onClick={() => run("v", () => api(`/memory/${m.id}`, { method: "PATCH", body: { verified: 1 } })).then(reload)}><Check size={13} /></button>}
                <button title="Edit" className="h-6 px-1.5 rounded hover:bg-hover text-2xs" onClick={() => { const c = prompt("Edit memory", m.content); if (c != null) run("e", () => api(`/memory/${m.id}`, { method: "PATCH", body: { content: c } })).then(reload); }}>Edit</button>
                <button title="Delete" aria-label="Delete memory" className="h-6 w-6 rounded hover:bg-hover flex items-center justify-center text-bad" onClick={() => run("d", () => api(`/memory/${m.id}`, { method: "DELETE" })).then(reload)}><Trash2 size={13} /></button>
              </span>
            </div>
            <div className="text-sm text-ink-2 mt-1 whitespace-pre-wrap selectable">{m.content}</div>
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
  const [tab, setTab] = useState<Tab>(() => tabFor(route.tab));
  useEffect(() => { setTab(tabFor(route.tab)); setObjective(""); setAdding(false); }, [id, route.tab]);
  const { data: team, error: teamError, reload } = useApi<Team>(`/teams/${id}`, ["team", "agent", "task"]);
  const { data: agents = [], loading: agentsLoading, reload: reloadAgents } = useApi<Agent[]>(`/agents?team_id=${id}`, ["agent", "team", "task"]);
  const { data: tasks = [] } = useApi<Task[]>(`/tasks?team_id=${id}&limit=300`, ["task"]);
  const { data: messages = [] } = useApi<Message[]>(`/messages?team_id=${id}&limit=60`, ["task"]);
  const { data: projects = [] } = useApi<Project[]>("/projects", ["project"]);
  const [objective, setObjective] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Partial<Team>>({});
  const { busy, run } = useAction();
  useEffect(() => { if (team) setForm({ name: team.name, description: team.description, project_id: team.project_id }); }, [team?.id, team?.updated_at]);
  if (!team) return <Card className="p-6 text-sm text-ink-2" role={teamError ? "alert" : "status"}>{teamError ? <>Couldn’t load this team. <Button onClick={reload}>Try again</Button></> : "Loading team…"}</Card>;
  const agentName = (aid?: string) => agents.find((a) => a.id === aid)?.name || "User";
  const current = tasks.find((t) => t.id === team.current?.id);
  const currentKids = tasks.filter((t) => t.parent_id === current?.id);
  const lead = agents.find((a) => a.id === team.lead_agent_id);
  const ready = Boolean(lead?.model && lead?.provider_id && lead.status !== "paused" && !team.archived);
  const submit = async () => {
    if (!objective.trim() || !ready || busy) return;
    const r = await run("o", () => api<Task>("/objectives", { body: { team_id: id, objective: objective.trim() } }), "Objective submitted");
    if (r) { setObjective(""); setTab("execution"); }
  };
  const done = tasks.filter((t) => t.kind !== "objective" && t.status === "completed");

  return (
    <div className="max-w-[1100px] mx-auto text-ink">
      <button onClick={() => go({ name: "teams" })} className="flex items-center gap-1 text-xs text-ink-2 hover:text-ink mb-3"><ChevronLeft size={14} />Teams</button>
      <div className="flex items-start gap-3 mb-6 flex-wrap">
        <span className="h-11 w-11 rounded-xl border border-line bg-active flex items-center justify-center text-ink-2 shrink-0"><Users size={20} /></span>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{team.name}</h1>
          <div className="text-ink-2 text-sm">{team.description || "Your team workspace"}{team.project_id ? ` · ${projects.find((p) => p.id === team.project_id)?.name || "Project"}` : ""}</div>
        </div>
        <StatusBadge status={team.status} />
        <Button variant="primary" icon={<Plus size={14} />} disabled={Boolean(team.archived)} onClick={() => setNewTaskOpen(true, { teamId: id })}>New task</Button>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Work" }, { id: "agents", label: "Agents", count: agents.length },
        { id: "execution", label: "Activity" }, { id: "resources", label: "Resources" }, { id: "settings", label: "Settings" }]} />

      {tab === "overview" && (
        <div className="grid grid-cols-[1fr_340px] gap-5 max-[1050px]:grid-cols-1">
          <div className="space-y-5 min-w-0">
            <Card className="p-5">
              <div className="font-medium mb-3">What should this team work on?</div>
              <TextArea rows={3} value={objective} onChange={(e) => setObjective(e.target.value)}
                placeholder="e.g. Add rate limiting to the public API and cover it with tests."
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && objective.trim()) submit(); }} />
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <span className="text-xs text-ink-2">{team.archived ? "Restore this team in Settings to start work." : !lead ? "Choose a team lead in Settings first." : !lead.model || !lead.provider_id ? "Assign a model to your team lead first." : lead.status === "paused" ? "Resume your team lead in Agents first." : `${lead.name} will plan and delegate. ⌘ / Ctrl + Enter to start.`}</span>
                {!ready && <Button size="sm" onClick={() => setTab(!lead || team.archived ? "settings" : "agents")}>{team.archived ? "Team settings" : !lead ? "Choose lead" : "Manage agents"}</Button>}
                <Button className="ml-auto" variant="primary" icon={<Send size={13} />} busy={busy === "o"} disabled={!objective.trim() || !ready} onClick={submit}>Start work</Button>
              </div>
            </Card>
            <div>
              <div className="flex items-center justify-between mb-2"><div className="text-sm font-semibold">Current objective</div>
                {current && <Button size="sm" variant="ghost" onClick={() => select({ kind: "task", id: current.id })}>Inspect</Button>}</div>
              {current ? (
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3"><span className="font-medium flex-1 truncate">{current.title}</span><StatusBadge status={current.status} /></div>
                  {currentKids.length ? <DependencyGraph tasks={currentKids} compact /> : <div className="text-ink-2 text-sm">{current.status === "planning" ? "The lead is planning…" : "No subtasks."}</div>}
                </Card>) : <Card><Empty title="No objective yet" body="Submit one above. The lead inspects the project, creates a plan and starts delegated work." /></Card>}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold mb-2">Agent messages</div>
            <Card className="p-3 max-h-[560px] overflow-auto">
              {messages.length === 0 ? <div className="text-ink-2 text-sm p-1">Structured handoffs between agents appear here.</div> :
                messages.map((m) => (
                  <div key={m.id} className="py-2 border-b border-line last:border-0">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="font-medium">{agentName(m.sender_agent_id)}</span><span className="text-ink-3">→</span>
                      <span className="text-ink-2">{m.recipient_agent_id ? agentName(m.recipient_agent_id) : "team"}</span>
                      <Badge className="ml-auto">{MSG_LABEL[m.type] || m.type}</Badge>
                    </div>
                    <div className="text-xs text-ink-2 mt-1 line-clamp-3 selectable">{m.body.summary || m.body.content || (m.body.files ? `files: ${m.body.files.join(", ")}` : JSON.stringify(m.body))}</div>
                    <div className="text-2xs text-ink-3 mt-0.5 tnum">{ago(m.at)}</div>
                  </div>))}
            </Card>
          </div>
        </div>)}

      {tab === "overview" && tasks.length > 0 && <section className="mt-6 space-y-3"><h2 className="text-sm font-semibold">Task history</h2><TaskTable tasks={tasks} /></section>}

      {tab === "agents" && <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap"><p className="text-sm text-ink-2">Choose an agent to edit its role, model or permissions.</p><div className="flex gap-2 flex-wrap">
          {agents.some((a) => !a.model || !a.provider_id) && <AutoAssignModels teamId={id} onSaved={() => { reloadAgents(); reload(); }} disabled={Boolean(team.archived)} />}
          <Button icon={<Plus size={14} />} onClick={() => setAdding(true)} disabled={Boolean(team.archived)}>Add agent</Button>
        </div></div>
        <AgentRoster agents={agents} loading={agentsLoading} onReload={reloadAgents} emptyAction={!team.archived && <Button onClick={() => setAdding(true)}>Add your first agent</Button>} />
      </div>}
      <CreateAgentModal open={adding} onClose={() => setAdding(false)} teamId={id} onSaved={() => { reloadAgents(); reload(); }} />

      {tab === "execution" && <ExecutionViewer teamId={id} height="calc(100vh - 290px)" />}
      {tab === "resources" && (
        <div className="grid grid-cols-2 gap-4 max-[1000px]:grid-cols-1">
          <MemoryEditor scope="team" scopeId={id} title="Team memory" />
          <MemoryEditor scope="project" scopeId={team.project_id} title="Project memory" />
        </div>)}
      {tab === "resources" && (
        <div className="space-y-3 mt-6">
          <h2 className="text-sm font-semibold">Results & artifacts</h2>
          {tasks.filter((t) => t.kind === "objective" && t.artifacts?.report).map((t) => (
            <Card key={t.id} className="p-4"><div className="flex items-center gap-2 mb-2"><span className="font-medium flex-1">{t.title}</span><StatusBadge status={t.status} />
              <Button size="sm" variant="ghost" onClick={() => select({ kind: "task", id: t.id })}>Inspect</Button></div>
              <Markdownish text={t.artifacts.report} /></Card>))}
          {done.map((t) => (
            <Card key={t.id} className="p-3.5 flex items-center gap-3 cursor-default hover:bg-hover" onClick={() => select({ kind: "task", id: t.id })}>
              <div className="min-w-0 flex-1"><div className="font-medium text-sm truncate">{t.title}</div>
                <div className="text-xs text-ink-2 truncate">{t.artifacts?.branch ? <span className="font-mono">{t.artifacts.branch}</span> : "in-place"} · {(t.artifacts?.files || []).length} files · {t.agent_name}</div></div>
              {t.artifacts?.merged && <Badge tone="ok">merged</Badge>}
              <span className="text-2xs text-ink-3 tnum">{ago(t.finished_at)}</span>
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
          <div className="flex gap-2 pt-1 flex-wrap">
            <Button variant="primary" disabled={!form.name?.trim()} busy={busy === "s"} onClick={() => run("s", () => api(`/teams/${id}`, { method: "PATCH", body: { ...form, name: form.name?.trim(), project_id: form.project_id || null } }), "Team saved").then((result) => { if (result) reload(); })}>Save</Button>
            <Button onClick={() => run("d", () => api<Team>(`/teams/${id}/duplicate`, { body: {} }), "Duplicated").then((t) => t && go({ name: "team", id: t.id }))}>Duplicate</Button>
            <Button onClick={() => run("a", () => api(`/teams/${id}/archive`, { body: { archived: !team.archived } }), team.archived ? "Unarchived" : "Archived").then(reload)}>{team.archived ? "Unarchive" : "Archive"}</Button>
            <Button variant="danger" className="ml-auto" onClick={() => confirm(`Delete ${team.name}?`) && run("x", () => api(`/teams/${id}`, { method: "DELETE" }), "Deleted").then((result) => { if (result) go({ name: "teams" }); })}>Delete team</Button>
          </div>
        </Card>)}
    </div>
  );
}
