import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight, Terminal, FileEdit, Wrench, MessageSquare, AlertTriangle, CheckCircle2, GitBranch, Brain,
  ShieldQuestion, ArrowRightLeft, Flag, Cpu, Hourglass,
} from "lucide-react";
import { Agent, AtlasEvent, api, subscribe, useApi } from "../api";
import { Badge, cx, Empty, Select, Spinner } from "./ui";

const KIND: Record<string, { label: string; icon: React.ElementType; tone?: string }> = {
  tool_call: { label: "Tool call", icon: Wrench },
  tool_result: { label: "Tool result", icon: Terminal },
  file_edit: { label: "File edit", icon: FileEdit, tone: "text-accent" },
  agent_message: { label: "Agent", icon: MessageSquare },
  llm_request: { label: "Model request", icon: Cpu },
  llm_response: { label: "Model response", icon: Cpu },
  queued_for_model: { label: "Queued for model", icon: Hourglass, tone: "text-warn" },
  agent_started: { label: "Agent started", icon: Cpu },
  planning_started: { label: "Planning", icon: Brain },
  plan_created: { label: "Plan", icon: Brain, tone: "text-accent" },
  task_status: { label: "Status", icon: Flag },
  completion_report: { label: "Completion report", icon: CheckCircle2, tone: "text-ok" },
  final_report: { label: "Final report", icon: CheckCircle2, tone: "text-ok" },
  error: { label: "Error", icon: AlertTriangle, tone: "text-bad" },
  approval_requested: { label: "Approval requested", icon: ShieldQuestion, tone: "text-warn" },
  approval_decided: { label: "Approval decided", icon: ShieldQuestion },
  agent_message_sent: { label: "Handoff", icon: ArrowRightLeft },
  worktree_created: { label: "Worktree", icon: GitBranch },
  branch_merged_into_worktree: { label: "Merged upstream", icon: GitBranch },
  conflict_detected: { label: "Conflict", icon: AlertTriangle, tone: "text-bad" },
  permission_denied: { label: "Permission denied", icon: ShieldQuestion, tone: "text-bad" },
  merged: { label: "Merged", icon: GitBranch, tone: "text-ok" },
  objective_submitted: { label: "Objective", icon: Flag },
};
const GROUPS: Record<string, string[]> = {
  tools: ["tool_call", "tool_result"], files: ["file_edit"], messages: ["agent_message", "agent_message_sent", "completion_report", "final_report"],
  errors: ["error", "conflict_detected", "permission_denied"], status: ["task_status", "plan_created", "approval_requested", "approval_decided"],
  model: ["llm_request", "llm_response", "queued_for_model", "agent_started"],
};

function summary(e: AtlasEvent): string {
  const d = e.data || {};
  switch (e.type) {
    case "tool_call": return `${d.tool}(${Object.entries(d.args || {}).map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.length > 60 ? v.slice(0, 60) + "…" : v) : JSON.stringify(v)}`).join(", ")})`;
    case "tool_result": return `${d.tool || ""} ${d.ok === false || d.is_error ? "failed" : "ok"}${d.ms != null ? ` · ${d.ms} ms` : ""}${d.exit_code != null ? ` · exit ${d.exit_code}` : ""} — ${String(d.output || "").split("\n")[0].slice(0, 120)}`;
    case "file_edit": return d.path ? `${d.result || d.path}` : `${(d.changes || []).map((c: any) => `${c.kind} ${c.path}`).join(", ")}`;
    case "agent_message": return String(d.text || "").slice(0, 200);
    case "llm_request": return `step ${d.step} · ~${d.est_prompt_tokens} tokens (estimated) · ${d.messages} messages`;
    case "llm_response": return `step ${d.step} · ${d.latency_ms} ms · ${d.tool_calls} tool call(s)${d.usage?.completion_tokens ? ` · ${d.usage.completion_tokens} output tokens` : ""}`;
    case "agent_started": return `${d.provider} · ${d.model} · ${d.tool_mode}`;
    case "task_status": return `${d.title}: ${d.from || "—"} → ${d.to}${d.reason ? ` — ${d.reason}` : ""}`;
    case "plan_created": return `${(d.tasks || []).length} tasks — ${d.summary || ""}`;
    case "completion_report": return `${d.status}: ${String(d.summary || "").slice(0, 160)}`;
    case "final_report": return `${d.failed ? `${d.failed} failed` : "All tasks completed"}`;
    case "error": return String(d.message || "").slice(0, 200);
    case "approval_requested": return `${d.kind}: ${d.payload?.command || d.payload?.title || ""}`;
    case "approval_decided": return d.approved ? "Approved" : "Denied";
    case "agent_message_sent": return `${d.type}: ${d.preview || ""}`;
    case "worktree_created": return `${d.branch} at ${d.path}`;
    case "conflict_detected": return d.files ? `${d.files.join(", ")}` : String(d.error || d.branch || "");
    case "queued_for_model": return `Waiting for a free ${d.provider} inference slot`;
    default: return JSON.stringify(d).slice(0, 160);
  }
}

function detail(e: AtlasEvent): string | null {
  const d = e.data || {};
  if (e.type === "tool_result") return String(d.output || "");
  if (e.type === "tool_call") return JSON.stringify(d.args, null, 2);
  if (e.type === "agent_message") return String(d.text || "");
  if (e.type === "completion_report") return `${d.summary || ""}\n\nFiles: ${(d.files || []).join(", ") || "none"}\n${d.verification ? `\nVerification: ${d.verification}` : ""}`;
  if (e.type === "final_report") return String(d.report || "");
  if (e.type === "error") return [d.message, d.trace].filter(Boolean).join("\n\n");
  if (e.type === "plan_created") return (d.tasks || []).map((t: any, i: number) => `${i + 1}. ${t.title}`).join("\n") + (d.summary ? `\n\n${d.summary}` : "");
  return JSON.stringify(d, null, 2);
}

function Row({ e, agents }: { e: AtlasEvent; agents: Record<string, Agent> }) {
  const [open, setOpen] = useState(false);
  const k = KIND[e.type] || { label: e.type, icon: ChevronRight };
  const Icon = k.icon;
  const bad = e.type === "error" || (e.type === "tool_result" && (e.data.ok === false || e.data.is_error));
  const ag = e.agent_id ? agents[e.agent_id] : undefined;
  return (
    <div className="row-cv border-b border-line last:border-0 @container">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-3 h-9 text-left hover:bg-hover">
        <ChevronRight size={12} className={cx("text-ink-3 shrink-0 transition-transform", open && "rotate-90")} />
        <Icon size={14} className={cx("shrink-0", bad ? "text-bad" : k.tone || "text-ink-2")} />
        <span className="text-[11.5px] text-ink-2 w-[118px] shrink-0 truncate @max-xl:hidden">{k.label}</span>
        {ag && <span className="text-[11.5px] font-medium text-ink shrink-0 max-w-[140px] @max-xl:max-w-[80px] truncate">{ag.name}</span>}
        <span className={cx("text-[12px] truncate flex-1 font-mono", bad ? "text-bad" : "text-ink")}>{summary(e)}</span>
        <span className="text-[11px] text-ink-3 tnum shrink-0 @max-md:hidden">{new Date(e.at * 1000).toLocaleTimeString()}</span>
      </button>
      {open && (
        <pre className="selectable mx-3 mb-2.5 ml-[38px] p-2.5 rounded-[7px] bg-surface-2 border border-line text-[11.5px] leading-[1.5] font-mono whitespace-pre-wrap break-words max-h-[420px] overflow-auto">
          {detail(e)}
        </pre>
      )}
    </div>
  );
}

/** Live execution viewer: persisted events + streaming updates + token preview. */
export function ExecutionViewer({ taskId, teamId, agentId, includeChildren = true, height = 520, showFilters = true }: {
  taskId?: string; teamId?: string; agentId?: string; includeChildren?: boolean; height?: number | string; showFilters?: boolean;
}) {
  const params = new URLSearchParams();
  if (taskId) params.set("task_id", taskId);
  if (teamId) params.set("team_id", teamId);
  if (agentId) params.set("agent_id", agentId);
  if (taskId && includeChildren) params.set("include_children", "true");
  params.set("limit", "400");
  const [events, setEvents] = useState<AtlasEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fAgent, setFAgent] = useState("");
  const [fType, setFType] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const { data: agentList = [] } = useApi<Agent[]>(teamId ? `/agents?team_id=${teamId}` : "/agents", ["agent"]);
  const agents = useMemo(() => Object.fromEntries(agentList.map((a) => [a.id, a])), [agentList]);
  const childIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<AtlasEvent[]>(`/events?${params}`).then((ev) => { if (alive) { setEvents(ev); setLoading(false); } }).catch(() => setLoading(false));
    if (taskId) api<any>(`/tasks/${taskId}`).then((t) => { childIds.current = new Set((t.children || []).map((c: any) => c.id)); }).catch(() => {});
    return () => { alive = false; };
  }, [params.toString()]);

  useEffect(() => subscribe((m) => {
    if (m.kind === "tokens") {
      const relevant = (!taskId || m.task_id === taskId || childIds.current.has(m.task_id)) && (!agentId || m.agent_id === agentId);
      if (relevant) setTokens((t) => ({ ...t, [m.task_id]: ((t[m.task_id] || "") + m.text).slice(-1500) }));
      return;
    }
    if (m.kind === "changed" && m.entity === "task" && taskId) {
      api<any>(`/tasks/${taskId}`).then((t) => { childIds.current = new Set((t.children || []).map((c: any) => c.id)); }).catch(() => {});
    }
    if (m.kind !== "event") return;
    const e: AtlasEvent = m.event;
    const ok = (!taskId || e.task_id === taskId || (includeChildren && childIds.current.has(e.task_id || ""))) &&
      (!teamId || e.team_id === teamId) && (!agentId || e.agent_id === agentId);
    if (!ok) return;
    if (e.type === "llm_response" || e.type === "agent_message") setTokens((t) => { const n = { ...t }; delete n[e.task_id || ""]; return n; });
    setEvents((ev) => [...ev.slice(-1500), e]);
  }), [taskId, teamId, agentId, includeChildren]);

  useEffect(() => { if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [events, tokens, follow]);

  const shown = events.filter((e) =>
    (!fAgent || e.agent_id === fAgent) &&
    (!fType || (GROUPS[fType] || []).includes(e.type)) &&
    (!fStatus || (fStatus === "errors" ? e.type === "error" || e.data?.ok === false || e.data?.is_error : !(e.type === "error" || e.data?.ok === false))));
  const loadEarlier = async () => {
    const first = events[0]?.id;
    if (!first) return;
    const more = await api<AtlasEvent[]>(`/events?${params}&before=${first}`);
    setEvents((ev) => [...more, ...ev]);
  };
  const live = Object.entries(tokens).filter(([, v]) => v.trim());

  return (
    <div className="flex flex-col">
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 mb-2.5">
          <Select value={fAgent} onChange={(e) => setFAgent(e.target.value)} className="!w-auto !h-7 text-[12px]" aria-label="Filter by agent">
            <option value="">All agents</option>
            {agentList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select value={fType} onChange={(e) => setFType(e.target.value)} className="!w-auto !h-7 text-[12px]" aria-label="Filter by event type">
            <option value="">All events</option>
            {Object.keys(GROUPS).map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
          </Select>
          <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="!w-auto !h-7 text-[12px]" aria-label="Filter by outcome">
            <option value="">Any outcome</option><option value="ok">Successful</option><option value="errors">Errors only</option>
          </Select>
          <label className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-2">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
          </label>
          <span className="text-[11.5px] text-ink-3 tnum">{shown.length} events</span>
        </div>
      )}
      <div ref={scroller} style={{ height }} className="overflow-auto rounded-[10px] border border-line bg-surface">
        {loading ? <div className="p-6 flex justify-center"><Spinner /></div> :
          shown.length === 0 && live.length === 0 ? <Empty title="No execution events yet" body="Events appear here as agents plan, call tools, edit files and report results." /> :
            <>
              {events.length >= 400 && <button onClick={loadEarlier} className="w-full h-8 text-[12px] text-ink-2 hover:bg-hover">Load earlier events</button>}
              {shown.map((e, i) => <Row key={e.id ?? `l${i}`} e={e} agents={agents} />)}
              {live.map(([tid, text]) => (
                <div key={tid} className="px-3 py-2 border-t border-line bg-info-bg/40">
                  <div className="flex items-center gap-2 text-[11.5px] text-accent mb-1"><span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" /> Streaming model output</div>
                  <pre className="selectable text-[11.5px] font-mono whitespace-pre-wrap text-ink-2 max-h-40 overflow-hidden">{text}</pre>
                </div>
              ))}
            </>}
      </div>
    </div>
  );
}

export function Markdownish({ text }: { text: string }) {
  // Minimal, safe rendering of report text (headings, bullets, inline code). No HTML injection.
  return (
    <div className="md selectable text-[12.5px] leading-relaxed">
      {text.split("\n").map((line, i) => {
        const inline = (s: string) => s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith("`") ? <code key={j}>{p.slice(1, -1)}</code> : p.startsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : p);
        if (line.startsWith("# ")) return <h1 key={i}>{inline(line.slice(2))}</h1>;
        if (line.startsWith("## ")) return <h2 key={i}>{inline(line.slice(3))}</h2>;
        if (line.startsWith("- ")) return <li key={i}>{inline(line.slice(2))}</li>;
        if (!line.trim()) return <div key={i} className="h-2" />;
        return <div key={i} className={line.startsWith("  ") ? "pl-5 text-ink-2" : ""}>{inline(line.trim())}</div>;
      })}
    </div>
  );
}

export { Badge };
