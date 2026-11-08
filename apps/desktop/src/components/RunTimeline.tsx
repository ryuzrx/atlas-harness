import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, Brain, Check, FilePen, FilePlus, FileText, FolderOpen, GitBranch, Globe, Plug, Search, SquareTerminal, Wrench } from "lucide-react";
import { AtlasEvent, api, subscribe } from "../api";
import { AnimatedMark } from "./AnimatedMark";
import { cx } from "./ui";

export interface RunStep {
  id: string;
  tool: string;
  verb: string;
  target: string;
  mono: boolean;
  kind: "command" | "read" | "list" | "search" | "write" | "create" | "git" | "memory" | "mcp" | "skill" | "web" | "other";
  state: "running" | "done" | "failed";
  ms?: number;
  exit?: number;
}

const firstString = (args: Record<string, any>) => {
  for (const key of ["command", "path", "query", "pattern", "name", "url", "tool"]) if (typeof args[key] === "string" && args[key]) return args[key] as string;
  const any = Object.values(args).find((v) => typeof v === "string" && v);
  return (any as string) || "";
};

const GIT_LABEL: Record<string, string> = { status: "Checked git status", diff: "Viewed the diff", log: "Read git history", show: "Viewed a commit", commit: "Committed" };

function describe(tool: string, args: Record<string, any>): Pick<RunStep, "verb" | "target" | "mono" | "kind"> {
  const target = firstString(args || {});
  switch (tool) {
    case "run_command": case "terminal": return { verb: "Ran a command", target: "", mono: false, kind: "command" };
    case "read_file": return { verb: "Read", target, mono: true, kind: "read" };
    case "list_dir": return { verb: "Listed", target: target || ".", mono: true, kind: "list" };
    case "search": case "search_files": return { verb: "Searched for", target, mono: true, kind: "search" };
    case "write_file": return { verb: "Wrote", target, mono: true, kind: "create" };
    case "edit_file": return { verb: "Edited", target, mono: true, kind: "write" };
    case "apply_patch": case "patch": return { verb: "Edited files", target: "", mono: false, kind: "write" };
    case "git": return { verb: GIT_LABEL[String(args?.action)] || "Git", target: args?.action === "commit" ? String(args?.message || "") : String(args?.ref || ""), mono: args?.action !== "commit", kind: "git" };
    case "remember": return { verb: "Saved to memory", target: String(args?.key || ""), mono: false, kind: "memory" };
    case "skill": return { verb: "Used skill", target, mono: false, kind: "skill" };
    case "mcp": return { verb: "Called", target: [args?.server, args?.tool].filter(Boolean).join(" › ") || target, mono: false, kind: "mcp" };
    case "web_search": return { verb: "Searched the web for", target, mono: false, kind: "web" };
    case "web_extract": case "web_fetch": case "fetch_url": return { verb: "Opened", target, mono: false, kind: "web" };
    default: return { verb: tool.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), target, mono: false, kind: "other" };
  }
}

const RUNNING_VERB: Partial<Record<RunStep["kind"], string>> = {
  command: "Running a command", read: "Reading", list: "Listing", search: "Searching for", write: "Editing", create: "Writing", git: "Running git", memory: "Saving to memory", mcp: "Calling", web: "Opening",
};

/** Collapse run events into compact activity rows without exposing command output. */
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
        open.ms = d.ms;
        if (d.exit_code != null) open.exit = Number(d.exit_code);
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
  command: SquareTerminal, read: FileText, list: FolderOpen, search: Search, write: FilePen, create: FilePlus, git: GitBranch,
  memory: Brain, mcp: Plug, skill: BookOpen, web: Globe, other: Wrench,
};

/** "src/components/App.tsx" -> dim "src/components/" + bright "App.tsx" */
function PathLabel({ path }: { path: string }) {
  const i = path.lastIndexOf("/");
  if (i <= 0 || i === path.length - 1 || /\s/.test(path)) return <>{path}</>;
  return <><span className="text-ink-3">{path.slice(0, i + 1)}</span>{path.slice(i + 1)}</>;
}

function StepRow({ s }: { s: RunStep }) {
  const Icon = ICON[s.kind];
  const running = s.state === "running";
  const isPath = s.mono && (s.kind === "read" || s.kind === "write" || s.kind === "create" || s.kind === "list");
  return (
    <div>
      <div className="group/step w-full min-h-8 flex items-center gap-2.5 px-1.5 py-1 rounded-lg text-left">
        <span className="h-5 w-5 shrink-0 flex items-center justify-center rounded-md">
          {running ? <span className="working-spinner" /> : s.state === "failed" ? <AlertCircle size={14} className="text-bad" />
            : <Icon size={14} strokeWidth={1.7} className="text-ink-3" />}
        </span>
        <span className={cx("text-[13.5px] shrink-0", running ? "chat-shimmer" : "text-ink-2")}>{running ? RUNNING_VERB[s.kind] || s.verb : s.verb}</span>
        {s.target && <span className={cx("min-w-0 truncate text-[13px] text-ink", s.mono && "font-mono text-[12.5px] px-1.5 py-px rounded-md bg-surface-2 border border-line")} title={s.target}>
          {isPath ? <PathLabel path={s.target} /> : s.target}</span>}
        <span className="flex-1" />
        {s.state === "failed" && <span className="text-[11px] text-bad shrink-0">{s.exit != null && s.exit !== 0 ? `exit ${s.exit}` : "failed"}</span>}
        {s.state === "done" && <Check size={13} strokeWidth={2.2} className="shrink-0 text-ink-3 opacity-0 group-hover/step:opacity-100 transition-opacity" />}
        {s.ms != null && !running && s.ms >= 1000 && <span className="text-[11px] text-ink-3 tnum shrink-0">{(s.ms / 1000).toFixed(1)}s</span>}
      </div>
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
  return (
    <div className="px-2 py-1.5" role="log" aria-live="polite">
      {hidden > 0 && <button onClick={() => setAll(true)} className="ml-1 mb-1 text-xs text-ink-3 hover:text-ink">Show {hidden} earlier step{hidden === 1 ? "" : "s"}</button>}
      {shown.map((s) => <StepRow key={s.id} s={s} />)}
    </div>
  );
}

/** One-line summary such as "Ran 4 commands · Edited 2 files" for collapsed headers. */
export function summarizeSteps(steps: RunStep[]): string {
  const n = (k: RunStep["kind"]) => steps.filter((s) => s.kind === k).length;
  const parts: string[] = [];
  const cmds = n("command"), reads = n("read") + n("list") + n("search"), writes = n("write") + n("create");
  if (cmds) parts.push(`Ran ${cmds} command${cmds === 1 ? "" : "s"}`);
  if (writes) parts.push(`Changed ${writes} file${writes === 1 ? "" : "s"}`);
  if (reads) parts.push(`Looked at ${reads} file${reads === 1 ? "" : "s"}`);
  return parts.join(" · ") || (steps.length ? `${steps.length} steps` : "");
}
