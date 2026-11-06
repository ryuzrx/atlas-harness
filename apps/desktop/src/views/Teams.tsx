import React, { useEffect, useState } from "react";
import { ArrowUpRight, MoreHorizontal, Plus, Search, Sparkles, Users } from "lucide-react";
import { ago, api, Project, Team, useApi } from "../api";
import { useStore } from "../store";
import { ModelPicker } from "../components/Inspector";
import { TeamAdvisor } from "../components/TeamAdvisor";
import { Button, Card, Empty, Field, Input, Menu, Modal, PageHeader, Segmented, Select, StatusBadge, TextArea, useAction } from "../components/ui";

export const teamColor = (_id: string) => "var(--text-3)";

export function CreateTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: meta, loading, error, reload } = useApi<{ templates: Record<string, { name: string; description: string; agents: number }> }>(open ? "/meta" : null);
  const { data: projects = [] } = useApi<Project[]>(open ? "/projects" : null, ["project"]);
  const { settings, go, saveSettings } = useStore();
  const [template, setTemplate] = useState("engineering");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [customModels, setCustomModels] = useState(false);
  const [routing, setRouting] = useState<Record<string, { provider_id?: string; model?: string }>>({});
  const [remember, setRemember] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => { if (open) { setTemplate(settings?.["teams.default_template"] ?? "engineering"); setName(""); setDescription(""); setProject(""); setCustomModels(false); setRouting(settings?.["models.routing"] || {}); setRemember(false); } }, [open]);
  const create = async () => {
    if (busy) return;
    const team = await run("create", () => api<Team>("/teams", { body: {
      template: template || undefined, name: name.trim() || undefined, description: description.trim() || undefined,
      project_id: project || undefined, routing: customModels ? routing : {}, auto_assign_models: !customModels,
    } }), "Team created");
    if (team) {
      if (customModels && remember) await saveSettings({ "models.routing": routing });
      onClose(); go({ name: "team", id: team.id });
    }
  };
  return <Modal open={open} onClose={onClose} title="New team" width={620} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy !== null} disabled={Boolean(template && (loading || error || !meta?.templates?.[template]))} onClick={create}>Create team</Button></>}>
    <div className="space-y-5 text-ink">
      <p className="text-sm text-ink-2">Choose what your team does. Atlas sets up its roles and connects available models.</p>
      <Field label="Team type">
        <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
          {Object.entries(meta?.templates || {}).map(([key, item]) => <option key={key} value={key}>{item.name} · {item.agents} agents</option>)}
          <option value="">Start empty</option>
        </Select>
      </Field>
      {loading && <p className="text-sm text-ink-2" role="status">Loading team templates…</p>}
      {error && <div role="alert" className="text-sm text-bad">Couldn’t load templates. <Button onClick={reload}>Try again</Button></div>}
      <div className="rounded-lg bg-hover p-3 text-sm text-ink-2">{template ? meta?.templates?.[template]?.description || "Choose a team type to continue." : "Start with an empty workspace and add your own agents."}
        {template && <p className="text-xs text-ink-3 mt-2">Roles are ready to use. Models are chosen from connected endpoints.</p>}
      </div>
      <div className="grid grid-cols-1 min-[600px]:grid-cols-2 gap-4">
        <Field label="Team name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta?.templates?.[template]?.name || "New team"} /></Field>
        <Field label="Project"><Select value={project} onChange={(e) => setProject(e.target.value)}><option value="">Choose later</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      </div>
      <details className="border border-line rounded-lg p-3"><summary className="cursor-pointer text-sm text-ink-2">Customize setup</summary><div className="mt-4 space-y-4">
        <Field label="Description"><TextArea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this team is responsible for" /></Field>
        {template && <><Field label="Models"><Select value={customModels ? "custom" : "auto"} onChange={(e) => setCustomModels(e.target.value === "custom")}><option value="auto">Choose automatically from connected endpoints</option><option value="custom">Choose models by role</option></Select></Field>
          {customModels && <div className="space-y-3">{[["reasoning", "Planning & review"], ["coding", "Engineering"], ["light", "Research"]].map(([tier, label]) => <Field key={tier} label={label}><ModelPicker emptyLabel="Choose automatically" providerId={routing[tier]?.provider_id} model={routing[tier]?.model} onChange={(provider_id, model) => setRouting((r) => ({ ...r, [tier]: { provider_id, model } }))} /></Field>)}
            <label className="flex gap-2 items-center text-xs text-ink-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember these model choices</label>
          </div>}</>}
      </div></details>
    </div>
  </Modal>;
}

function TeamActions({ team, reload }: { team: Team; reload: () => void }) {
  const { go, settings } = useStore();
  const { busy, run } = useAction();
  const mutate = async (verb: string, body: object) => { const result = await run(verb, () => api(`/teams/${team.id}/${verb}`, { body })); if (result) reload(); };
  return <Menu trigger={<button disabled={busy !== null} aria-label={`Actions for ${team.name}`} className="h-8 w-8 flex items-center justify-center rounded-md text-ink-2 hover:bg-hover"><MoreHorizontal size={17} /></button>} items={[
    { label: "Team settings", onClick: () => go({ name: "team", id: team.id, tab: "settings" }) },
    { label: "Duplicate", disabled: busy !== null, onClick: () => { void mutate("duplicate", {}); } },
    { label: team.archived ? "Restore team" : "Archive team", disabled: busy !== null, onClick: () => { void mutate("archive", { archived: !team.archived }); } },
    { label: "Delete team", danger: true, disabled: busy !== null, onClick: async () => { if (settings?.["teams.confirm_delete"] !== false && !confirm(`Delete ${team.name} and its agents? Task history is kept.`)) return; const result = await run("delete", () => api(`/teams/${team.id}`, { method: "DELETE" }), "Team deleted"); if (result) reload(); } },
  ]} />;
}

export function Teams() {
  const { route, go } = useStore();
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(route.tab === "create");
  const [advising, setAdvising] = useState(false);
  useEffect(() => { if (route.tab === "create") setCreating(true); }, [route.tab]);
  const { data: teams = [], loading, error, reload } = useApi<Team[]>(`/teams?archived=${archived}`, ["team", "agent", "task"]);
  const shown = teams.filter((t) => `${t.name} ${t.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="max-w-[1060px] mx-auto space-y-5 text-ink">
    <PageHeader title="Teams" subtitle="Give a team an objective. Follow its work in one place." actions={<><Button icon={<Sparkles size={14} />} onClick={() => setAdvising(true)}>Help me choose</Button><Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New team</Button></>} />
    <div className="flex items-center gap-3 flex-wrap">
      <Segmented value={archived ? "archived" : "active"} onChange={(v) => setArchived(v === "archived")} options={[{ id: "active", label: "Your teams" }, { id: "archived", label: "Archived" }]} />
      <div className="relative flex-1 min-w-[180px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" /><Input className="pl-9" aria-label="Search teams" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a team" /></div>
    </div>
    {loading ? <Card className="p-8 text-sm text-ink-2" role="status">Loading teams…</Card> : error ? <Card className="p-5 text-sm text-bad" role="alert">Couldn’t load teams. <Button onClick={reload}>Try again</Button></Card> : !shown.length ? <Card><Empty icon={<Users size={22} />} title={query ? "No teams found" : archived ? "No archived teams" : "Start with a team"} body={query ? "Try another name or clear your search." : archived ? "Archived teams stay here until you need them again." : "Choose a template. Atlas creates the agents and finds models for their roles."} action={query ? <Button onClick={() => setQuery("")}>Clear search</Button> : !archived && <Button variant="primary" onClick={() => setCreating(true)}>Create your first team</Button>} /></Card> : <div className="grid grid-cols-1 min-[900px]:grid-cols-2 gap-4">
      {shown.map((team) => {
        const missing = (team.agents || []).filter((a) => !a.model).length;
        return <Card key={team.id} className="flex flex-col p-5 gap-4">
          <div className="flex items-start gap-3"><span className="h-10 w-10 shrink-0 rounded-xl bg-active border border-line flex items-center justify-center text-ink-2"><Users size={19} /></span><div className="min-w-0 flex-1"><button onClick={() => go({ name: "team", id: team.id })} className="text-base font-semibold text-ink hover:underline text-left break-words">{team.name}</button><p className="text-xs text-ink-2 mt-1 line-clamp-2">{team.description || "A team ready for your next objective."}</p></div><TeamActions team={team} reload={reload} /></div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-ink-2"><span>{team.agent_count} agents</span><span aria-hidden="true">·</span><StatusBadge status={team.status} />{missing > 0 && <span className="text-warn ml-auto">{missing} need a model</span>}</div>
          <div className="rounded-lg bg-hover p-3 flex-1"><div className="text-xs text-ink-3 mb-1">Latest objective</div><p className="text-sm text-ink line-clamp-2">{team.current?.title || "Ready for a new objective"}</p>{team.current && <div className="mt-2"><StatusBadge status={team.current.status} /></div>}</div>
          <div className="flex items-center justify-between gap-3 pt-1"><span className="text-xs text-ink-3">{team.active_tasks ? `${team.active_tasks} active tasks` : `Updated ${ago(team.last_activity || team.updated_at)}`}</span><Button size="sm" icon={<ArrowUpRight size={14} />} onClick={() => go({ name: "team", id: team.id })}>Open team</Button></div>
        </Card>;
      })}
    </div>}
    <Modal open={advising} onClose={() => setAdvising(false)} title="Find the right team" width={640}><TeamAdvisor onDone={() => { setAdvising(false); reload(); }} onSkip={() => setAdvising(false)} /></Modal>
    <CreateTeamModal open={creating} onClose={() => { setCreating(false); if (route.tab) go({ name: "teams" }); }} />
  </div>;
}
