import React, { useEffect, useState } from "react";
import { Plus, LayoutList, LayoutGrid, Sparkles, Users, MoreHorizontal } from "lucide-react";
import { ago, api, Project, STATUS_LABEL, Task, Team, useApi } from "../api";
import { useStore } from "../store";
import { ModelPicker } from "../components/Inspector";
import { TeamAdvisor } from "../components/TeamAdvisor";
import { Badge, Button, Card, cx, Dot, Empty, Field, Input, Menu, Modal, PageHeader, Segmented, Select, StatusBadge, TextArea, useAction } from "../components/ui";

const ACCENTS = ["var(--text-3)"];
export const teamColor = (id: string) => ACCENTS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % ACCENTS.length];

export function CreateTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: meta } = useApi<any>(open ? "/meta" : null);
  const { data: projects = [] } = useApi<Project[]>(open ? "/projects" : null, ["project"]);
  const { settings, go, saveSettings } = useStore();
  const [tpl, setTpl] = useState<string>(settings?.["teams.default_template"] ?? "engineering");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [project, setProject] = useState("");
  const routing0 = settings?.["models.routing"] || {};
  const [routing, setRouting] = useState<Record<string, { provider_id?: string; model?: string }>>(routing0);
  const [remember, setRemember] = useState(true);
  const { busy, run } = useAction();
  useEffect(() => { if (open) { setRouting(settings?.["models.routing"] || {}); setProject(projects[0]?.id || ""); } }, [open, projects.length]);
  const create = async () => {
    if (remember) await saveSettings({ "models.routing": routing });
    const t = await run("c", () => api<Team>("/teams", { body: { template: tpl || undefined, name: name || undefined, description: desc || undefined, project_id: project || undefined, routing } }), "Team created");
    if (t) { onClose(); go({ name: "team", id: t.id }); }
  };
  const tiers: [string, string][] = [["reasoning", "Leads & reviewers (reasoning)"], ["coding", "Engineers (coding)"], ["light", "Researchers (lightweight)"]];
  return (
    <Modal open={open} onClose={onClose} title="Create team" width={620}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create} busy={busy === "c"}>Create team</Button></>}>
      <div className="space-y-4">
        <Field label="Template">
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(meta?.templates || {}).map(([k, v]: any) => (
              <button key={k} onClick={() => setTpl(k)} className={cx("text-left p-2.5 rounded-md border", tpl === k ? "border-accent bg-accent-bg ring-[3px] ring-[var(--ring)]" : "border-line hover:bg-hover")}>
                <div className="text-sm font-medium">{v.name}</div><div className="text-2xs text-ink-2">{v.agents} agents</div>
              </button>))}
            <button onClick={() => setTpl("")} className={cx("text-left p-2.5 rounded-md border", tpl === "" ? "border-accent bg-accent-bg ring-[3px] ring-[var(--ring)]" : "border-line hover:bg-hover")}>
              <div className="text-sm font-medium">Blank team</div><div className="text-2xs text-ink-2">Add agents yourself</div>
            </button>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta?.templates?.[tpl]?.name || "New Team"} /></Field>
          <Field label="Default project"><Select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        </div>
        <Field label="Description"><TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={meta?.templates?.[tpl]?.description} /></Field>
        {tpl && (
          <Field label="Model routing" hint="Every agent can be overridden later. Any provider works: Ollama (incl. abliterated models), MLX, llama.cpp, Claude, Codex.">
            <div className="space-y-2 mt-1">
              {tiers.map(([k, label]) => (
                <div key={k} className="grid grid-cols-[190px_1fr] items-center gap-2">
                  <span className="text-sm text-ink-2">{label}</span>
                  <ModelPicker providerId={routing[k]?.provider_id} model={routing[k]?.model} onChange={(p, m) => setRouting((r) => ({ ...r, [k]: { provider_id: p, model: m } }))} />
                </div>))}
              <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Use as default routing for new teams</label>
            </div>
          </Field>)}
      </div>
    </Modal>
  );
}

function TeamActions({ t, reload }: { t: Team; reload: () => void }) {
  const { go, settings } = useStore();
  const { run } = useAction();
  return (
    <Menu trigger={<button aria-label="Team actions" className="h-7 w-7 flex items-center justify-center rounded-md text-ink-2 hover:bg-hover"><MoreHorizontal size={15} /></button>}
      items={[
        { label: "Open", onClick: () => go({ name: "team", id: t.id }) },
        { label: "Duplicate", onClick: () => run("d", () => api(`/teams/${t.id}/duplicate`, { body: {} }), "Team duplicated").then(reload) },
        { label: t.archived ? "Unarchive" : "Archive", onClick: () => run("a", () => api(`/teams/${t.id}/archive`, { body: { archived: !t.archived } })).then(reload) },
        { label: "Delete", danger: true, onClick: () => (settings?.["teams.confirm_delete"] === false || confirm(`Delete ${t.name} and its agents? Task history is kept.`)) && run("x", () => api(`/teams/${t.id}`, { method: "DELETE" }), "Team deleted").then(reload) },
      ]} />
  );
}

function progressOf(t: Team, tasks: Task[]) {
  const kids = tasks.filter((x) => x.team_id === t.id && x.parent_id === t.current?.id);
  if (!kids.length) return t.current?.status === "completed" ? 1 : 0;
  return kids.filter((k) => k.status === "completed").length / kids.length;
}

export function Teams() {
  const { route, go, setNewTaskOpen } = useStore();
  const [view, setView] = useState<"cards" | "list">(() => (localStorage.getItem("atlas_teams_view") as any) || "cards");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(route.tab === "create");
  const [advising, setAdvising] = useState(false);
  useEffect(() => { if (route.tab === "create") setCreating(true); }, [route]);
  const { data: teams = [], loading, reload } = useApi<Team[]>(`/teams?archived=${archived}`, ["team", "agent", "task"]);
  const { data: tasks = [] } = useApi<Task[]>("/tasks?limit=500", ["task"]);
  const setV = (v: "cards" | "list") => { setView(v); localStorage.setItem("atlas_teams_view", v); };
  return (
    <div className="max-w-[1100px] mx-auto">
      <PageHeader title="Teams" subtitle={teams.length ? `${teams.length} ${archived ? "archived " : ""}team${teams.length === 1 ? "" : "s"}` : "Groups of agents with a lead who plans and hands out the work."}
        actions={<>
          <Segmented value={archived ? "a" : "s"} onChange={(v) => setArchived(v === "a")} options={[{ id: "s", label: "Saved" }, { id: "a", label: "Archived" }]} />
          {teams.length > 0 && <Segmented value={view} onChange={setV} options={[{ id: "cards", label: <LayoutGrid size={13} />, title: "Cards" }, { id: "list", label: <LayoutList size={13} />, title: "List" }]} />}
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>Create team</Button>
        </>} />
      {!loading && teams.length === 0 && (
        <Card><Empty icon={<Users size={22} />} title={archived ? "No archived teams" : "No teams yet"}
          body={archived ? "Teams you archive show up here." : "Not sure which you need? Atlas can suggest some."}
          action={!archived && <div className="flex gap-2"><Button variant="primary" icon={<Sparkles size={14} />} onClick={() => setAdvising(true)}>Help me choose</Button><Button onClick={() => setCreating(true)}>Create one myself</Button></div>} /></Card>)}
      {view === "cards" ? (
        <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
          {teams.map((t) => {
            const pct = progressOf(t, tasks);
            const live = t.current?.status && !["completed", "failed", "cancelled"].includes(t.current.status) ? t.current.status : t.status;
            return (
              <Card key={t.id} onClick={() => go({ name: "team", id: t.id })} className="lift p-5 flex flex-col gap-4 min-h-[184px]">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-medium text-ink truncate">{t.name}</div>
                    <div className="text-sm text-ink-2 mt-0.5 line-clamp-2 min-h-[38px]">{t.description || "No description"}</div>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}><TeamActions t={t} reload={reload} /></span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {(t.agents || []).slice(0, 4).map((a) => (
                      <span key={a.id} title={`${a.name} · ${a.role}`} className="h-7 w-7 rounded-full bg-active border-2 border-[var(--surface)] flex items-center justify-center text-2xs font-medium text-ink">{a.name.slice(0, 1).toUpperCase()}</span>))}
                    {t.agent_count > 4 && <span className="h-7 min-w-7 px-1.5 rounded-full bg-active border-2 border-[var(--surface)] flex items-center justify-center text-2xs text-ink-2 tnum">+{t.agent_count - 4}</span>}
                  </div>
                  <span className="text-sm text-ink-3">{t.agent_count} agent{t.agent_count === 1 ? "" : "s"}</span>
                  <span className="ml-auto inline-flex items-center gap-2 text-sm text-ink-2"><Dot status={live} />{STATUS_LABEL[live] || live}</span>
                </div>
                <div className="mt-auto">
                  <div className="flex items-center justify-between text-xs text-ink-3 mb-1.5">
                    <span className="truncate max-w-[70%]">{t.current ? t.current.title : "No objective yet"}</span>
                    <span className="tnum">{t.active_tasks} active · {ago(t.last_activity || t.updated_at)}</span>
                  </div>
                  <div className="h-1 rounded-full bg-active overflow-hidden"><div className="h-full bg-ink rounded-full transition-[width] duration-500" style={{ width: `${pct * 100}%` }} title={`${Math.round(pct * 100)}% of the current objective's subtasks completed`} /></div>
                </div>
              </Card>);
          })}
        </div>
      ) : teams.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-2 border-b border-line">
              <th className="font-medium px-4 h-9">Team</th><th className="font-medium">Objective</th><th className="font-medium w-16">Agents</th>
              <th className="font-medium w-16">Active</th><th className="font-medium w-32">Status</th><th className="font-medium w-24">Last activity</th><th className="w-10" /></tr></thead>
            <tbody>{teams.map((t) => (
              <tr key={t.id} onClick={() => go({ name: "team", id: t.id })} className="border-b border-line last:border-0 hover:bg-hover">
                <td className="px-4 h-10"><div className="flex items-center gap-2 font-medium"><span className="h-2 w-2 rounded-full" style={{ background: teamColor(t.id) }} />{t.name}</div></td>
                <td className="text-ink-2 truncate max-w-[280px]">{t.current?.title || "—"}</td>
                <td className="tnum">{t.agent_count}</td><td className="tnum">{t.active_tasks}</td>
                <td><StatusBadge status={t.status} /></td><td className="text-ink-2 tnum">{ago(t.last_activity || t.updated_at)}</td>
                <td onClick={(e) => e.stopPropagation()}><TeamActions t={t} reload={reload} /></td>
              </tr>))}</tbody>
          </table>
        </Card>)}
      <Modal open={advising} onClose={() => setAdvising(false)} title="Find the right teams" width={640}><TeamAdvisor onDone={() => { setAdvising(false); reload(); }} onSkip={() => setAdvising(false)} /></Modal>
      <CreateTeamModal open={creating} onClose={() => { setCreating(false); if (route.tab) go({ name: "teams" }); }} />
    </div>
  );
}
