import React from "react";
import { Plus, Users, Cpu, Bot, ListChecks, ShieldAlert, FolderGit2, Check } from "lucide-react";
import { ago, bytes, Team, useApi } from "../api";
import { useStore } from "../store";
import { ExecutionViewer } from "../components/Execution";
import { Button, Card, cx, Dot, Empty, Meter, PageHeader, SectionTitle, Stat, StatusBadge } from "../components/ui";

export function ResourcePanel() {
  const { data: m } = useApi<any>("/monitor", ["provider"], 4000);
  if (!m) return <Card className="p-4 h-[184px]" />;
  const rows: [string, React.ReactNode, number | null, string][] = [
    ["CPU", `${m.cpu_percent.value.toFixed(0)}%`, m.cpu_percent.value, "measured"],
    ["Unified memory", `${bytes(m.memory.used)} / ${bytes(m.memory.total)}`, m.memory.percent, "measured"],
    ["Model processes", bytes(m.model_process_rss_bytes.value), m.memory.total ? (m.model_process_rss_bytes.value / m.memory.total) * 100 : 0, "measured RSS"],
    ["Inference requests", `${m.active_inference} active · limit ${m.inference_limit}/provider`, null, "measured"],
    ["Agents / tasks", `${m.running_agents} agents · ${m.running_tasks}/${m.task_limit} tasks · ${m.queue_length} queued`, null, "measured"],
    ["Errors (1h)", `${m.errors_last_hour}`, null, "measured"],
  ];
  return (
    <Card className="p-4">
      <div className="space-y-2.5">
        {rows.map(([k, v, pct, label]) => (
          <div key={k}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-2">{k}</span>
              <span className="tnum font-medium" title={label}>{v}</span>
            </div>
            {pct != null && <div className="mt-1"><Meter value={pct} tone={pct > 90 ? "bg-bad" : pct > 75 ? "bg-warn" : undefined} /></div>}
          </div>
        ))}
        {(m.loaded_models || []).length > 0 && (
          <div className="pt-1.5 border-t border-line">
            {(m.loaded_models || []).map((lm: any) => (
              <div key={lm.name} className="flex justify-between text-xs text-ink-2 tnum"><span className="font-mono truncate">{lm.name}</span><span>{bytes(lm.size_bytes)} loaded</span></div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function Overview() {
  const { setNewTaskOpen, go, select } = useStore();
  const { data } = useApi<any>("/overview", ["task", "team", "agent", "approval"]);
  const metrics = data?.metrics;
  const teams: Team[] = data?.teams || [];
  const setupNeeded = metrics && (metrics.teams === 0 || metrics.providers === 0);
  return (
    <div className="max-w-[1180px] mx-auto">
      <PageHeader title="Overview"
        subtitle="Coordinate specialized AI teams on your own machine, with local or cloud models."
        actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setNewTaskOpen(true)}>New task</Button>} />

      {setupNeeded && (
        <Card className="p-6 mb-8">
          <div className="text-lg font-bold tracking-[-0.015em]">Get set up</div>
          <div className="text-ink-2 text-sm mt-0.5">Three steps before your first team can take on work.</div>
          <div className="grid grid-cols-3 gap-2.5 mt-4 max-[900px]:grid-cols-1">
            {([
              [1, "Connect a model", "Ollama, MLX, llama.cpp, Claude or Codex", Cpu, (metrics?.providers ?? 0) > 0, () => go({ name: "models" })],
              [2, "Add a project", "A folder or git repo agents work in", FolderGit2, (metrics?.projects ?? 0) > 0, () => go({ name: "projects" })],
              [3, "Create a team", "Start from a template", Users, (metrics?.teams ?? 0) > 0, () => go({ name: "teams", tab: "create" })],
            ] as const).map(([n, title, body, Icon, done, onClick]) => (
              <button key={n} onClick={onClick} className="lift flex items-start gap-3 text-left p-3.5 rounded-lg neu-sm">
                <span className={cx("h-6 w-6 rounded-full flex items-center justify-center text-2xs font-semibold shrink-0", done ? "bg-ok text-white" : "btn-accent")}>{done ? <Check size={13} /> : n}</span>
                <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm font-medium"><Icon size={13} className="text-ink-3" />{title}</span>
                  <span className="block text-xs text-ink-2 mt-0.5">{body}</span></span>
              </button>))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-4 gap-5 mb-8 max-[900px]:grid-cols-2">
        <Stat icon={<Users size={17} />} label="Active teams" value={metrics?.active_teams ?? "–"} hint={`${metrics?.teams ?? 0} saved`} />
        <Stat icon={<Bot size={17} />} label="Running agents" value={metrics?.running_agents ?? "–"} hint={`${metrics?.agents ?? 0} configured`} />
        <Stat icon={<ListChecks size={17} />} label="Tasks in progress" value={metrics?.tasks_in_progress ?? "–"} hint="across all teams" />
        <Stat icon={<ShieldAlert size={17} />} label="Awaiting approval" value={metrics?.awaiting_approval ?? "–"} hint="commands and merges" tone={metrics?.awaiting_approval ? "text-warn" : undefined} />
      </div>

      <div className="grid grid-cols-[1fr_330px] gap-6 max-[1050px]:grid-cols-1">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionTitle action={<Button size="sm" variant="ghost" onClick={() => go({ name: "teams" })}>All teams</Button>}>Team activity</SectionTitle>
            <Card className="overflow-hidden">
              {teams.length === 0 ? <Empty title="No teams yet" body="Create a team from a template to start delegating work." action={<Button size="sm" onClick={() => go({ name: "teams", tab: "create" })}>Create team</Button>} /> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-ink-2 border-b border-line">
                    <th className="font-medium px-4 h-9">Team</th><th className="font-medium px-2">Objective</th>
                    <th className="font-medium px-2 w-[90px]">Agents</th><th className="font-medium px-4 w-[130px]">Status</th></tr></thead>
                  <tbody>
                    {teams.map((t) => (
                      <tr key={t.id} onClick={() => go({ name: "team", id: t.id })} className="border-b border-line last:border-0 hover:bg-hover cursor-default">
                        <td className="px-4 h-11 font-medium"><div className="flex items-center gap-2"><Dot status={t.status} />{t.name}</div></td>
                        <td className="px-2 text-ink-2 truncate max-w-[320px]">{t.current?.title || t.objective || "—"}</td>
                        <td className="px-2 tnum text-ink-2">{t.running_agents}/{t.agent_count}</td>
                        <td className="px-4"><StatusBadge status={t.current?.status || t.status} /></td>
                      </tr>))}
                  </tbody>
                </table>)}
            </Card>
          </section>
          <section>
            <SectionTitle>Execution timeline</SectionTitle>
            <Card className="p-4">
              {(data?.timeline || []).length === 0 ? <div className="text-ink-2 text-sm">State changes will appear here as tasks run.</div> : (
                <div className="relative pl-4">
                  <div className="absolute left-[4px] top-1 bottom-1 w-px bg-line" />
                  {(data.timeline as any[]).slice(0, 14).map((tr) => (
                    <button key={tr.id} onClick={() => { go({ name: "tasks" }); setTimeout(() => select({ kind: "task", id: tr.task_id }), 0); }}
                      className="relative w-full flex items-center gap-2.5 py-1 text-left text-sm hover:bg-hover rounded">
                      <span className="absolute -left-[14.5px]"><Dot status={tr.to_status} /></span>
                      <span className="text-ink-3 tnum w-[78px] shrink-0 whitespace-nowrap">{new Date(tr.at * 1000).toLocaleTimeString()}</span>
                      <span className="truncate flex-1">{tr.title}</span>
                      <span className="text-ink-2 shrink-0">{tr.from_status ? `${tr.from_status} → ` : ""}<b className="font-medium text-ink">{tr.to_status}</b></span>
                    </button>))}
                </div>)}
            </Card>
          </section>
        </div>
        <div className="space-y-8 min-w-0">
          <section><SectionTitle>System resources</SectionTitle><ResourcePanel /></section>
          <section>
            <SectionTitle action={<Button size="sm" variant="ghost" onClick={() => go({ name: "activity" })}>Open</Button>}>Recent activity</SectionTitle>
            <Card className="p-3">
              {(data?.recent || []).length === 0 ? <div className="text-ink-2 text-sm p-1">No activity yet.</div> :
                (data.recent as any[]).slice(0, 10).map((e) => (
                  <div key={e.id} className="flex items-start gap-2 py-1.5 text-xs">
                    <span className={cx("mt-1.5 h-1.5 w-1.5 rounded-full shrink-0", e.type === "error" ? "bg-bad" : e.type === "approval_requested" ? "bg-warn" : "bg-ink-3")} />
                    <span className="flex-1 min-w-0 truncate">{e.data?.title || e.data?.summary || e.data?.message || e.type.replace(/_/g, " ")}{e.type === "task_status" ? ` → ${e.data.to}` : ""}</span>
                    <span className="text-ink-3 tnum shrink-0">{ago(e.at)}</span>
                  </div>))}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
