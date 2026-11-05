import React, { useMemo, useState } from "react";
import { GitBranch, LayoutGrid, LayoutList, Play, Plus, Search, ShieldQuestion } from "lucide-react";
import { ago, api, Approval, dur, Status, STATUS_LABEL, Task, Team, useApi } from "../api";
import { useStore } from "../store";
import { Badge, Button, Card, cx, Dot, Empty, Segmented, Select, useAction } from "../components/ui";

const ACTIVE: Status[] = ["planning", "running", "reviewing", "waiting_approval"];

export function TaskTable({ tasks }: { tasks: Task[] }) {
  const { select, selection } = useStore();
  const byParent = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const t of tasks) if (t.parent_id) (m[t.parent_id] ||= []).push(t);
    return m;
  }, [tasks]);
  const roots = tasks.filter((t) => !t.parent_id || !tasks.some((x) => x.id === t.parent_id));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  if (!tasks.length) return <Card><Empty icon={<Play size={22} />} title="Nothing has run yet" body="Start a task, or give a team an objective, and it will show up here." /></Card>;
  const row = (t: Task, depth: number) => (
    <React.Fragment key={t.id}>
      <tr onClick={() => select({ kind: "task", id: t.id })}
        className={cx("border-b border-line last:border-0 hover:bg-hover cursor-default", selection?.id === t.id && "bg-hover")}>
        <td className="h-14 pr-3" style={{ paddingLeft: 20 + depth * 20 }}>
          <div className="flex items-center gap-2.5 min-w-0">
            {byParent[t.id] ? <button onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [t.id]: !c[t.id] })); }}
              className="text-ink-3 w-3 text-2xs shrink-0" aria-label="Toggle subtasks">{collapsed[t.id] ? "▸" : "▾"}</button> : <span className="w-3 shrink-0" />}
            <div className="min-w-0">
              <div className={cx("text-base text-ink truncate", t.kind === "objective" && "font-medium")}>{t.title}</div>
              <div className="text-xs text-ink-3 truncate">{[t.agent_name, t.team_name, t.kind !== "objective" && t.kind !== "code" ? t.kind : null].filter(Boolean).join(" · ") || "Unassigned"}</div>
            </div>
          </div>
        </td>
        <td className="tnum text-ink-2 @max-2xl:hidden">{t.started_at ? dur(t.started_at, t.finished_at) : "—"}</td>
        <td><span className="inline-flex items-center gap-2 text-sm text-ink-2"><Dot status={t.status} />{STATUS_LABEL[t.status] || t.status}</span></td>
        <td className="text-ink-3 tnum pr-5 text-right @max-xl:hidden">{ago(t.updated_at)}</td>
      </tr>
      {!collapsed[t.id] && (byParent[t.id] || []).slice().reverse().map((c) => row(c, depth + 1))}
    </React.Fragment>
  );
  return (
    <Card className="overflow-hidden @container">
      <table className="w-full text-sm table-fixed">
        <thead><tr className="text-left text-xs text-ink-3 border-b border-line">
          <th className="font-medium pl-5 h-10">Run</th><th className="font-medium w-[100px] @max-2xl:hidden">Duration</th><th className="font-medium w-[150px]">Status</th><th className="w-[90px] @max-xl:hidden" /></tr></thead>
        <tbody>{roots.map((t) => row(t, 0))}</tbody>
      </table>
    </Card>
  );
}

const COLUMNS: { id: string; label: string; statuses: Status[] }[] = [
  { id: "queued", label: "Queued", statuses: ["queued", "ready", "blocked"] },
  { id: "active", label: "In progress", statuses: ["planning", "running", "reviewing"] },
  { id: "approval", label: "Needs approval", statuses: ["waiting_approval"] },
  { id: "done", label: "Completed", statuses: ["completed"] },
  { id: "failed", label: "Failed / cancelled", statuses: ["failed", "cancelled"] },
];

function Kanban({ tasks }: { tasks: Task[] }) {
  const { select } = useStore();
  return (
    <div className="grid grid-cols-5 gap-3 min-w-[900px]">
      {COLUMNS.map((c) => {
        const items = tasks.filter((t) => c.statuses.includes(t.status));
        return (
          <div key={c.id} className="min-w-0">
            <div className="flex items-center gap-1.5 mb-2 px-1 text-xs font-medium text-ink-2">{c.label}<span className="tnum text-ink-3">{items.length}</span></div>
            <div className="space-y-2">
              {items.map((t) => (
                <Card key={t.id} onClick={() => select({ kind: "task", id: t.id })} className="lift p-3 rounded-lg">
                  <div className="flex items-start gap-1.5"><Dot status={t.status} className="mt-1.5 shrink-0" />
                    <div className={cx("text-sm leading-snug", t.kind === "objective" && "font-medium")}>{t.title}</div></div>
                  <div className="flex items-center gap-1.5 mt-2 text-2xs text-ink-2">
                    <span className="truncate">{t.agent_name || t.team_name || "—"}</span>
                    {t.status === "blocked" && <Badge tone="warn">blocked</Badge>}
                    <span className="ml-auto tnum text-ink-3">{ago(t.updated_at)}</span>
                  </div>
                </Card>))}
            </div>
          </div>);
      })}
    </div>
  );
}

/** Layered DAG of real task dependencies. */
export function DependencyGraph({ tasks, compact }: { tasks: Task[]; compact?: boolean }) {
  const { select } = useStore();
  const ids = new Set(tasks.map((t) => t.id));
  const level: Record<string, number> = {};
  const lv = (t: Task, seen = new Set<string>()): number => {
    if (level[t.id] != null) return level[t.id];
    if (seen.has(t.id)) return 0;
    seen.add(t.id);
    const deps = t.deps.filter((d) => ids.has(d)).map((d) => lv(tasks.find((x) => x.id === d)!, seen));
    return (level[t.id] = deps.length ? Math.max(...deps) + 1 : 0);
  };
  tasks.forEach((t) => lv(t));
  const cols: Task[][] = [];
  tasks.forEach((t) => (cols[level[t.id]] ||= []).push(t));
  const W = compact ? 190 : 220, H = compact ? 46 : 56, GX = compact ? 46 : 70, GY = 14;
  const pos: Record<string, { x: number; y: number }> = {};
  cols.forEach((col, i) => col.forEach((t, j) => (pos[t.id] = { x: i * (W + GX), y: j * (H + GY) })));
  const width = cols.length * (W + GX) - GX;
  const height = Math.max(...cols.map((c) => c.length)) * (H + GY) - GY;
  if (!tasks.length) return <Empty title="No tasks to graph" />;
  return (
    <div className="overflow-auto">
      <div className="relative" style={{ width, height }}>
        <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
          {tasks.flatMap((t) => t.deps.filter((d) => pos[d]).map((d) => {
            const a = pos[d], b = pos[t.id];
            const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
            return <path key={d + t.id} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--border-strong)" strokeWidth={1.5} />;
          }))}
        </svg>
        {tasks.map((t) => (
          <button key={t.id} onClick={() => select({ kind: "task", id: t.id })} style={{ left: pos[t.id].x, top: pos[t.id].y, width: W, height: H }}
            className="lift absolute text-left px-2.5 py-1.5 rounded-lg neu-sm">
            <div className="flex items-center gap-1.5"><Dot status={t.status} className="shrink-0" /><span className="text-xs font-medium truncate">{t.title}</span></div>
            <div className="text-2xs text-ink-2 truncate mt-0.5">{t.agent_name || "—"} · {STATUS_LABEL[t.status]}</div>
          </button>))}
      </div>
    </div>
  );
}

export function ApprovalQueue() {
  const { data: items = [], reload } = useApi<Approval[]>("/approvals", ["approval", "task"]);
  const { select } = useStore();
  const { busy, run } = useAction();
  if (!items.length) return <Card><Empty icon={<ShieldQuestion size={22} />} title="Nothing awaiting approval" body="Commands outside the allowlist, destructive operations and plan reviews appear here." /></Card>;
  return (
    <div className="space-y-2.5">
      {items.map((a) => (
        <Card key={a.id} className="p-4">
          <div className="flex items-center gap-2">
            <Badge tone="warn">{a.kind.replace(/_/g, " ")}</Badge>
            <button className="font-medium text-sm hover:underline truncate" onClick={() => select({ kind: "task", id: a.task_id })}>{a.task_title}</button>
            <span className="text-xs text-ink-2">{a.agent_name}</span>
            <span className="ml-auto text-2xs text-ink-3 tnum">{ago(a.created_at)}</span>
          </div>
          {a.kind === "plan" ? (
            <ol className="mt-2 text-sm list-decimal ml-5 space-y-0.5">{(a.payload.plan?.tasks || []).map((t: any, i: number) => <li key={i}><b className="font-medium">{t.title}</b> <span className="text-ink-2">— {t.role}{t.deps?.length ? `, after ${t.deps.join(", ")}` : ""}</span></li>)}</ol>
          ) : (
            <pre className="selectable mt-2 p-2.5 rounded-md bg-surface-2 border border-line text-xs font-mono whitespace-pre-wrap">{a.payload.command || JSON.stringify(a.payload, null, 2)}</pre>)}
          {a.payload.reason && <div className="text-xs text-ink-2 mt-1.5">{a.payload.reason}{a.payload.cwd ? ` · in ${a.payload.cwd}` : ""}</div>}
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="primary" busy={busy === a.id + "y"} onClick={() => run(a.id + "y", () => api(`/approvals/${a.id}`, { body: { approved: true } }), "Approved").then(reload)}>{a.kind === "plan" ? "Approve plan" : "Allow once"}</Button>
            <Button size="sm" variant="danger" busy={busy === a.id + "n"} onClick={() => run(a.id + "n", () => api(`/approvals/${a.id}`, { body: { approved: false } }), "Denied").then(reload)}>Deny</Button>
          </div>
        </Card>))}
    </div>
  );
}

type View = "list" | "board" | "graph" | "approvals";

export function Tasks() {
  const { setNewTaskOpen, route } = useStore();
  const [view, setView] = useState<View>(() => (route.tab === "approvals" ? "approvals" : (localStorage.getItem("atlas_tasks_view") as View) || "list"));
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const { data: tasks = [] } = useApi<Task[]>(`/tasks?limit=800${team ? `&team_id=${team}` : ""}`, ["task"]);
  const { data: teams = [] } = useApi<Team[]>("/teams", ["team"]);
  const { data: approvals = [] } = useApi<Approval[]>("/approvals", ["approval", "task"]);
  const [root, setRoot] = useState("");
  const filtered = tasks.filter((t) => (!q || t.title.toLowerCase().includes(q.toLowerCase())) && (!status || (status === "active" ? ACTIVE.includes(t.status) : t.status === status)));
  const objectives = tasks.filter((t) => t.kind === "objective");
  const graphRoot = root || objectives[0]?.id || "";
  const graphTasks = graphRoot ? tasks.filter((t) => t.parent_id === graphRoot) : tasks.filter((t) => !t.parent_id && t.kind !== "objective");
  const setV = (v: View) => { setView(v); localStorage.setItem("atlas_tasks_view", v); };
  return (
    <div className="max-w-[1240px] mx-auto">
      <div className="flex items-center gap-4 mb-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl leading-[30px] font-semibold tracking-[-0.022em] text-ink">Runs</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {[["Active", tasks.filter((t) => ACTIVE.includes(t.status)).length], ["Queued", tasks.filter((t) => ["queued", "ready"].includes(t.status)).length], ["Needs approval", approvals.length], ["Completed", tasks.filter((t) => t.status === "completed").length]].map(([l, n]) => (
              <span key={l as string} className="h-7 px-3 rounded-full border border-line text-sm text-ink-2 flex items-center gap-1.5">{l}<span className={cx("tnum", Number(n) ? "text-ink" : "text-ink-3")}>{n}</span></span>))}
          </div>
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setNewTaskOpen(true)}>New task</Button>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <Segmented value={view === "approvals" ? "approvals" : "runs"} onChange={(v) => setV(v === "approvals" ? "approvals" : (localStorage.getItem("atlas_tasks_layout") as View) || "list")}
          options={[{ id: "runs", label: "All runs" }, { id: "approvals", label: <>Needs approval{approvals.length > 0 && <span className="ml-1.5 tnum text-ink">{approvals.length}</span>}</> }]} />
        <div className="flex-1" />
        {view !== "approvals" && <Segmented value={view} onChange={(v) => { localStorage.setItem("atlas_tasks_layout", v); setV(v); }}
          options={[{ id: "list", label: <LayoutList size={14} />, title: "List" }, { id: "board", label: <LayoutGrid size={14} />, title: "Board" }, { id: "graph", label: <GitBranch size={14} />, title: "Dependencies" }]} />}
      </div>
      {view !== "approvals" && (
        <div className="flex items-center gap-2 mb-4">
          {view !== "graph" && <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs" aria-label="Search runs" className="h-9 w-[240px] pl-8 pr-2.5 rounded-md bg-hover border border-line text-sm text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" /></div>}
          <Select value={team} onChange={(e) => setTeam(e.target.value)} className="!w-auto !h-9 text-sm" aria-label="Filter by team">
            <option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          {view !== "graph" && <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto !h-9 text-sm" aria-label="Filter by status">
            <option value="">Any status</option><option value="active">Active</option>
            {Object.keys(STATUS_LABEL).slice(0, 10).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>}
          {view === "graph" && <Select value={graphRoot} onChange={(e) => setRoot(e.target.value)} className="!w-auto !h-9 text-sm max-w-[360px]" aria-label="Objective">
            {objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}<option value="">Standalone tasks</option></Select>}
        </div>)}
      {view === "list" && <TaskTable tasks={filtered} />}
      {view === "board" && <div className="overflow-x-auto pb-4"><Kanban tasks={filtered} /></div>}
      {view === "graph" && <Card className="p-5"><DependencyGraph tasks={graphTasks} /></Card>}
      {view === "approvals" && <ApprovalQueue />}
    </div>
  );
}
