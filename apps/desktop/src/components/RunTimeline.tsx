import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpen, Brain, Check, ChevronRight, FilePen, FilePlus, FileText, FolderOpen, GitBranch, Globe, Plug, Search, SquareTerminal, Wrench } from "lucide-react";
import { AtlasEvent, api, subscribe } from "../api";
import { cx } from "./ui";

export interface RunStep {
  id: string;
  callId?: string;
  tool: string;
  verb: string;
  target: string;
  mono: boolean;
  kind: "command" | "read" | "list" | "search" | "write" | "create" | "git" | "memory" | "mcp" | "skill" | "web" | "thinking" | "other";
  state: "running" | "done" | "failed";
  ms?: number;
  at?: number;
}

const firstString = (args: Record<string, any>) => {
  for (const key of ["command", "path", "file_path", "query", "pattern", "target", "name", "url", "tool"]) if (typeof args[key] === "string" && args[key]) return args[key] as string;
  const any = Object.values(args).find((v) => typeof v === "string" && v);
  return (any as string) || "";
};

const GIT_LABEL: Record<string, string> = { status: "Checked git status", diff: "Viewed the diff", log: "Read git history", show: "Viewed a commit", commit: "Committed" };

function describe(tool: string, args: Record<string, any>): Pick<RunStep, "verb" | "target" | "mono" | "kind"> {
  const target = firstString(args || {});
  switch (tool) {
    case "run_command": return { verb: "Ran command", target: "", mono: false, kind: "command" };
    case "terminal": return { verb: "Ran commands", target: "", mono: false, kind: "command" };
    case "read_file": return { verb: "Read", target, mono: true, kind: "read" };
    case "list_dir": return { verb: "Listed", target: target || ".", mono: true, kind: "list" };
    case "search": return { verb: "Searched for", target, mono: true, kind: "search" };
    case "search_files": return { verb: "Searched files for", target, mono: true, kind: "search" };
    case "web_search": return { verb: "Searched the web for", target, mono: false, kind: "web" };
    case "web_extract": return { verb: "Read web page", target: String(args?.url || target), mono: false, kind: "web" };
    case "write_file": return { verb: "Wrote", target, mono: true, kind: "create" };
    case "edit_file": return { verb: "Edited", target, mono: true, kind: "write" };
    case "apply_patch": return { verb: "Applied a patch", target: "", mono: false, kind: "write" };
    case "patch": return { verb: "Edited", target: String(args?.path || target), mono: true, kind: "write" };
    case "git": return { verb: GIT_LABEL[String(args?.action)] || "Git", target: args?.action === "commit" ? String(args?.message || "") : String(args?.ref || ""), mono: args?.action !== "commit", kind: "git" };
    case "remember": return { verb: "Saved to memory", target: String(args?.key || ""), mono: false, kind: "memory" };
    case "skill": return { verb: "Used skill", target, mono: false, kind: "skill" };
    case "mcp": return { verb: "Called", target: [args?.server, args?.tool].filter(Boolean).join(" › ") || target, mono: false, kind: "mcp" };
    case "web_fetch": case "fetch_url": return { verb: "Opened", target, mono: false, kind: "web" };
    default: return { verb: tool.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), target, mono: false, kind: "other" };
  }
}

const RUNNING_VERB: Partial<Record<RunStep["kind"], string>> = {
  command: "Running", read: "Reading", list: "Listing", search: "Searching for", write: "Editing", create: "Writing", git: "Running git", memory: "Saving to memory", mcp: "Calling", web: "Opening",
};

/** Turn tool events into concise, user-facing progress rows. */
export function buildSteps(events: AtlasEvent[]): RunStep[] {
  const steps: RunStep[] = [];
  let lastResultAt: number | undefined;
  for (const e of events) {
    const d = e.data || {};
    if (e.type === "tool_call") {
      if (d.tool === "finish" || d.tool === "ask_user") continue;
      if (lastResultAt != null && e.at > lastResultAt) {
        const thinkingMs = Math.round((e.at - lastResultAt) * 1000);
        if (thinkingMs >= 1500) steps.push({ id: `thinking-${e.id ?? e.at}`, tool: "thinking", verb: "Thought", target: "", mono: false, kind: "thinking", state: "done", ms: thinkingMs });
      }
      const args = d.args || {};
      const details = describe(d.tool, args);
      const missing = (["run_command", "terminal"].includes(d.tool) ? !args?.command : !details.target) &&
        ["run_command", "terminal", "read_file", "search", "search_files", "web_search"].includes(d.tool);
      steps.push({ id: String(e.id ?? `${e.at}-${steps.length}`), callId: d.id == null ? undefined : String(d.id), tool: d.tool,
        state: "running", ...details, target: missing ? `No ${d.tool === "read_file" ? "file path" : d.tool === "search" || d.tool === "search_files" || d.tool === "web_search" ? "search query" : "command"} supplied` : details.target });
    } else if (e.type === "tool_result") {
      if (d.tool === "finish" || d.tool === "ask_user") continue;
      lastResultAt = e.at;
      const open = [...steps].reverse().find((s) => s.state === "running" &&
        (d.id != null && s.callId != null ? s.callId === String(d.id) : s.tool === d.tool));
      const failed = d.ok === false || !!d.is_error || (d.exit_code != null && d.exit_code !== 0 && d.tool === "run_command");
      if (open) {
        open.state = failed ? "failed" : "done";
        open.ms = d.ms;
        open.at = e.at;
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
  memory: Brain, mcp: Plug, skill: BookOpen, web: Globe, thinking: Brain, other: Wrench,
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
  const quiet = s.kind === "thinking";
  return (
    <div>
      <div className={cx("group/step w-full min-h-9 flex items-center gap-3 px-1.5 py-1 text-left", quiet && "min-h-8")} role="listitem">
        <span className="h-5 w-5 shrink-0 flex items-center justify-center">
          {running && quiet ? <span className="working-spinner" /> : s.state === "failed" ? <AlertCircle size={15} className="text-bad" />
            : quiet ? <ChevronRight size={14} className="text-ink-3" /> : <Icon size={15} strokeWidth={1.7} className="text-ink-3" />}
        </span>
        <span className={cx("text-[14px] shrink-0", quiet ? "text-ink-3" : running ? "chat-shimmer" : "text-ink-2")}>{running && !quiet ? RUNNING_VERB[s.kind] || s.verb : quiet && s.ms != null ? `Thought for ${Math.max(1, Math.round(s.ms / 1000))}s` : s.verb}</span>
        {s.target && <span className={cx("min-w-0 truncate text-[14px] text-ink", s.mono && "font-mono text-[13px]")} title={s.target}>
          {isPath ? <PathLabel path={s.target} /> : s.target}</span>}
        <span className="flex-1" />
        {s.state === "failed" && <span className="text-xs text-bad shrink-0">Failed</span>}
        {s.state === "done" && !quiet && <Check size={14} strokeWidth={2} className="shrink-0 text-ink-3" />}
        {s.ms != null && !running && !quiet && <span className="text-xs text-ink-3 tnum shrink-0">{s.ms < 1000 ? `${s.ms}ms` : `${(s.ms / 1000).toFixed(1)}s`}</span>}
      </div>
      {s.state === "failed" && <div className="ml-9 mb-1 text-xs text-bad">This step couldn’t finish.</div>}
    </div>
  );
}

/** Claude-style activity list for one run: each tool call as a quiet row, newest at the bottom. */
export function RunTimeline({ taskId, live }: { taskId: string; live: boolean }) {
  const { steps, loading } = useRunSteps(taskId);
  const [now, setNow] = useState(Date.now() / 1000);
  const [all, setAll] = useState(false);
  const startedAt = React.useRef(Date.now() / 1000);
  const LIMIT = 10;
  useEffect(() => { startedAt.current = Date.now() / 1000; setNow(startedAt.current); }, [taskId]);
  useEffect(() => { if (!live) return; const timer = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(timer); }, [live]);
  const last = steps[steps.length - 1];
  const thinking = live && last?.state === "done" && last.kind !== "thinking"
    ? { id: `thinking-live-${taskId}`, tool: "thinking", verb: "Thinking", target: "", mono: false, kind: "thinking" as const, state: "running" as const, ms: Math.max(0, Math.round((now - (last.at ?? now)) * 1000)) }
    : undefined;
  const timeline = thinking ? [...steps, thinking] : steps;
  const shown = all ? timeline : timeline.slice(-LIMIT);
  const hidden = timeline.length - shown.length;
  if (loading && !steps.length) return <div className="px-3 py-2 text-sm text-ink-3">Loading activity…</div>;
  if (!steps.length) return live
    ? <div className="px-3 py-2.5 flex items-center gap-2 text-sm text-ink-3" role="status"><span className="working-spinner" /><span className="am-thinking">Thinking · {Math.max(0, Math.floor(now - startedAt.current))}s</span><ChevronRight size={14} /></div>
    : <div className="px-3 py-2.5 text-sm text-ink-3">No tools were used.</div>;
  return (
    <div className="px-2 py-1.5" role="list" aria-label="Run activity" aria-live="polite">
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
