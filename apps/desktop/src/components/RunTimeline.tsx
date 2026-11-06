import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronRight, FilePen, FileText, FolderOpen, GitBranch, Search, SquareTerminal, Wrench } from "lucide-react";
import { AtlasEvent, api, subscribe } from "../api";
import { AnimatedMark } from "./AnimatedMark";
import { cx } from "./ui";

export interface RunStep {
  id: string;
  tool: string;
  verb: string;
  target: string;
  mono: boolean;
  kind: "command" | "read" | "list" | "search" | "write" | "git" | "other";
  state: "running" | "done" | "failed";
  output?: string;
  ms?: number;
}

const firstString = (args: Record<string, any>) => {
  for (const key of ["command", "path", "query", "pattern", "name", "url", "tool"]) if (typeof args[key] === "string" && args[key]) return args[key] as string;
  const any = Object.values(args).find((v) => typeof v === "string" && v);
  return (any as string) || "";
};

function describe(tool: string, args: Record<string, any>): Pick<RunStep, "verb" | "target" | "mono" | "kind"> {
  const target = firstString(args || {});
  switch (tool) {
    case "run_command": return { verb: "Ran", target: String(args?.command || target), mono: true, kind: "command" };
    case "read_file": return { verb: "Read", target, mono: true, kind: "read" };
    case "list_dir": return { verb: "Listed", target: target || ".", mono: true, kind: "list" };
    case "search": return { verb: "Searched", target, mono: true, kind: "search" };
    case "write_file": return { verb: "Wrote", target, mono: true, kind: "write" };
    case "edit_file": return { verb: "Edited", target, mono: true, kind: "write" };
    case "apply_patch": return { verb: "Applied a patch", target: "", mono: false, kind: "write" };
    case "git": return { verb: "Git", target: String(args?.command || args?.args || target), mono: true, kind: "git" };
    case "remember": return { verb: "Saved a note", target: "", mono: false, kind: "other" };
    case "skill": return { verb: "Used skill", target, mono: false, kind: "other" };
    case "mcp": return { verb: "Called", target, mono: false, kind: "other" };
    default: return { verb: tool.replace(/_/g, " "), target, mono: false, kind: "other" };
  }
}

/** Collapse the raw event stream into one row per tool call: what ran, whether it worked, and its output. */
export function buildSteps(events: AtlasEvent[]): RunStep[] {
  const steps: RunStep[] = [];
  for (const e of events) {
    const d = e.data || {};
    if (e.type === "tool_call") {
      if (d.tool === "finish" || d.tool === "ask_user") continue;
      steps.push({ id: String(e.id ?? `${e.at}-${steps.length}`), tool: d.tool, state: "running", ...describe(d.tool, d.args || {}) });
    } else if (e.type === "tool_result") {
      if (d.tool === "finish" || d.tool === "ask_user") continue;
      const open = [...steps].reverse().find((s) => s.tool === d.tool && s.state === "running");
      const failed = d.ok === false || !!d.is_error || (d.exit_code != null && d.exit_code !== 0 && d.tool === "run_command");
      if (open) {
        open.state = failed ? "failed" : "done";
        open.output = String(d.output || "");
        open.ms = d.ms;
      }
    }
  }
  return steps;
}

export function useRunSteps(taskId?: string): { steps: RunStep[]; loading: boolean } {
  const [events, setEvents] = useState<AtlasEvent[]>([]);
  const [loading, setLoading] = useState(!!taskId);
  useEffect(() => {
    if (!taskId) { setEvents([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api<AtlasEvent[]>(`/events?task_id=${taskId}&include_children=true&limit=400`)
      .then((ev) => { if (alive) { setEvents(ev); setLoading(false); } }).catch(() => alive && setLoading(false));
    const off = subscribe((m) => {
      if (m.kind !== "event") return;
      const e: AtlasEvent = m.event;
      if (e.task_id === taskId && (e.type === "tool_call" || e.type === "tool_result")) setEvents((ev) => [...ev.slice(-800), e]);
    });
    return () => { alive = false; off(); };
  }, [taskId]);
  const steps = useMemo(() => buildSteps(events), [events]);
  return { steps, loading };
}

const ICON: Record<RunStep["kind"], React.ElementType> = {
  command: SquareTerminal, read: FileText, list: FolderOpen, search: Search, write: FilePen, git: GitBranch, other: Wrench,
};

function StepRow({ s }: { s: RunStep }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[s.kind];
  const canOpen = !!s.output?.trim();
  return (
    <div>
      <button onClick={() => canOpen && setOpen((o) => !o)} aria-expanded={canOpen ? open : undefined} disabled={!canOpen}
        className={cx("w-full min-h-8 flex items-center gap-2.5 px-1 py-1 rounded-md text-left", canOpen && "hover:bg-hover")}>
        <span className="h-4 w-4 shrink-0 flex items-center justify-center">
          {s.state === "running" ? <AnimatedMark size={14} play="shimmer" />
            : s.state === "failed" ? <AlertCircle size={14} className="text-bad" /> : <Check size={14} strokeWidth={2.2} className="text-ink-3" />}
        </span>
        <Icon size={14} strokeWidth={1.6} className="shrink-0 text-ink-3" />
        <span className={cx("text-sm shrink-0", s.state === "running" ? "text-ink" : "text-ink-2")}>{s.state === "running" && s.kind === "command" ? "Running" : s.verb}</span>
        {s.target && <span className={cx("min-w-0 truncate text-sm text-ink", s.mono && "font-mono text-[13px] px-1.5 py-px rounded-sm bg-surface-2")} title={s.target}>{s.target}</span>}
        <span className="flex-1" />
        {s.state === "failed" && <span className="text-xs text-bad shrink-0">failed</span>}
        {s.ms != null && s.state !== "running" && s.ms >= 1000 && <span className="text-xs text-ink-3 tnum shrink-0">{(s.ms / 1000).toFixed(1)}s</span>}
        {canOpen && <ChevronRight size={12} className={cx("text-ink-3 shrink-0 transition-transform duration-150", open && "rotate-90")} />}
      </button>
      {open && <pre className="selectable ml-[26px] mr-1 mb-1.5 p-2.5 rounded-md bg-base border border-line text-xs leading-[1.5] font-mono whitespace-pre-wrap break-words max-h-[260px] overflow-auto text-ink-2">{(s.output || "").slice(0, 6000)}</pre>}
    </div>
  );
}

/** Claude-style activity list for one run: each tool call as a quiet row, newest at the bottom. */
export function RunTimeline({ taskId, live }: { taskId: string; live: boolean }) {
  const { steps, loading } = useRunSteps(taskId);
  const [all, setAll] = useState(false);
  const LIMIT = 10;
  const shown = all ? steps : steps.slice(-LIMIT);
  const hidden = steps.length - shown.length;
  if (loading && !steps.length) return <div className="px-3 py-2 text-sm text-ink-3">Loading activity…</div>;
  if (!steps.length) return live
    ? <div className="px-3 py-2.5 flex items-center gap-2 text-sm text-ink-3" role="status"><AnimatedMark size={16} play="shimmer" /><span className="am-thinking">Working…</span></div>
    : <div className="px-3 py-2.5 text-sm text-ink-3">No tools were used.</div>;
  const last = steps[steps.length - 1];
  return (
    <div className="px-2 py-1.5" role="log" aria-live="polite">
      {hidden > 0 && <button onClick={() => setAll(true)} className="ml-1 mb-1 text-xs text-ink-3 hover:text-ink">Show {hidden} earlier step{hidden === 1 ? "" : "s"}</button>}
      {shown.map((s) => <StepRow key={s.id} s={s} />)}
      {live && last.state !== "running" && <div className="px-1 h-8 flex items-center gap-2.5 text-sm text-ink-3"><AnimatedMark size={14} play="shimmer" /><span className="am-thinking">Working…</span></div>}
    </div>
  );
}

/** One-line summary such as "Ran 4 commands · Edited 2 files" for collapsed headers. */
export function summarizeSteps(steps: RunStep[]): string {
  const n = (k: RunStep["kind"]) => steps.filter((s) => s.kind === k).length;
  const parts: string[] = [];
  const cmds = n("command"), reads = n("read") + n("list") + n("search"), writes = n("write");
  if (cmds) parts.push(`Ran ${cmds} command${cmds === 1 ? "" : "s"}`);
  if (writes) parts.push(`Changed ${writes} file${writes === 1 ? "" : "s"}`);
  if (reads) parts.push(`Read ${reads}`);
  return parts.join(" · ") || (steps.length ? `${steps.length} steps` : "");
}
