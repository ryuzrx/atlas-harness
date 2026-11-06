import React, { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Agent, Team, useApi } from "../api";
import { useStore } from "../store";
import { AgentRoster, AutoAssignModels, CreateAgentModal } from "../components/AgentManagement";
import { Button, Input, PageHeader, Select } from "../components/ui";

export function Agents() {
  const { go } = useStore();
  const { data: agents = [], loading, error, reload } = useApi<Agent[]>("/agents", ["agent", "team", "task"]);
  const { data: teams = [] } = useApi<Team[]>("/teams", ["team"]);
  const [team, setTeam] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const shown = agents.filter((a) => (!team || (team === "independent" ? !a.team_id : a.team_id === team))
    && (!query.trim() || `${a.name} ${a.role} ${a.model || ""} ${a.team_name || ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    && (!status || (status === "unassigned" ? !a.model || !a.provider_id : status === "working" ? Boolean(a.current_task) : a.status === status)));
  const missing = agents.filter((a) => (!team || a.team_id === team) && (!a.model || !a.provider_id)).length;
  return <div className="max-w-[1060px] mx-auto space-y-5 text-ink">
    <PageHeader title="Agents" subtitle="Your AI helpers, their models and current work."
      actions={<><Button onClick={() => go({ name: "teams" })}>View teams</Button><Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New agent</Button></>} />
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
      <div className="relative min-w-[180px] flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" /><Input className="pl-9" aria-label="Search agents" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents, roles or models" /></div>
      <Select className="!w-auto max-w-full" aria-label="Filter by team" value={team} onChange={(e) => setTeam(e.target.value)}><option value="">All teams</option><option value="independent">Independent</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      <Select className="!w-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="working">Working</option><option value="idle">Idle</option><option value="paused">Paused</option><option value="unassigned">Needs a model</option></Select>
    </div>
    <div className="flex flex-wrap gap-3 items-center justify-between text-xs text-ink-2"><span>{shown.length} of {agents.length} agents{missing > 0 ? ` · ${missing} need a model` : ""}</span>
      {team && team !== "independent" && missing > 0 && <AutoAssignModels teamId={team} onSaved={reload} />}
      {(query || team || status) && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setTeam(""); setStatus(""); }}>Clear filters</Button>}
    </div>
    {error ? <div role="alert" className="rounded-xl border border-line p-5 text-sm text-bad">Couldn’t load agents. <Button onClick={reload}>Try again</Button></div> : <AgentRoster agents={shown} loading={loading} onReload={reload} showTeam emptyAction={<Button onClick={() => setCreating(true)}>New agent</Button>} />}
    <CreateAgentModal open={creating} onClose={() => setCreating(false)} teamId={team && team !== "independent" ? team : undefined} onSaved={reload} />
  </div>;
}
