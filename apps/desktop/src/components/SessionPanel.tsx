import React, { useState } from "react";
import { AlertCircle, Check, ChevronRight, Folder, FolderOpen, GitBranch, Globe2, Laptop, ListChecks, X } from "lucide-react";
import { AnimatedMark } from "./AnimatedMark";
import { summarizeSteps, useRunSteps } from "./RunTimeline";
import { Model, openBrowser, openPath, Project, useApi } from "../api";
import { cx } from "./ui";

interface Msg { role: string; content: string; status?: string; task_id?: string; data?: Record<string, any> }

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const tokenCount = (usage: Record<string, any> | undefined, ...keys: string[]) => {
  for (const key of keys) { const raw = usage?.[key]; if (raw == null || raw === "") continue; const value = Number(raw); if (Number.isFinite(value) && value >= 0) return value; }
  return undefined;
};
const nestedTokenCount = (usage: Record<string, any> | undefined, section: string, ...keys: string[]) =>
  tokenCount(usage?.[section], ...keys);

function Section({ title, children, right, id }: { title: string; children: React.ReactNode; right?: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-3 px-4 py-4 border-b border-line last:border-0">
      <div className="flex items-center justify-between mb-2.5"><h3 className="text-sm font-medium text-ink">{title}</h3>{right}</div>
      {children}
    </section>
  );
}

function ContextRow({ label, value, detail, color }: { label: string; value: string; detail: string; color: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-xs">
      <span className="flex min-w-0 items-center gap-2 text-ink-2">
        <span aria-hidden="true" className={cx("h-2.5 w-2.5 shrink-0 rounded-[3px]", color)} />
        <span className="truncate">{label}</span>
      </span>
      <span className="tnum text-right text-ink">{value}<span className="ml-1.5 text-ink-3">{detail}</span></span>
    </div>
  );
}

/** Side panel shown once a conversation has started: where it runs, how full the context is, connectors, and changes. */
export const SessionPanel = React.memo(function SessionPanel({ messages, cfg, onClose }: {
  messages: Msg[]; cfg: { provider_id?: string; model?: string; project_id?: string; mode?: string; system?: string }; onClose: () => void;
}) {
  const { data: projects = [] } = useApi<Project[]>("/projects", ["project"]);
  const project = projects.find((p) => p.id === cfg.project_id);
  const { data: git } = useApi<any>(project?.exists ? `/projects/${project.id}/git` : null, ["project", "task"], 8000);
  const { data: models = [] } = useApi<Model[]>("/models", ["model"]);
  const { data: mcp } = useApi<any>("/mcp", ["settings"]);
  const [showServers, setShowServers] = useState(false);
  const lastRun = [...messages].reverse().find((m) => m.task_id);
  const runLive = !!lastRun && (lastRun.status === "running" || lastRun.status === "streaming");
  const { steps } = useRunSteps(lastRun?.task_id);
  const dirty: { code: string; path: string }[] = git?.dirty || [];

  const model = models.find((m) => m.provider_id === cfg.provider_id && m.name === cfg.model);
  const windowSize = model?.context_length || 0;
  const measuredUsage = messages.filter((m) => m.role === "assistant" && m.data?.usage && m.data.usage.measured !== false)
    .map((m) => m.data!.usage as Record<string, any>);
  const lastUsage = measuredUsage.at(-1);
  const requestInput = tokenCount(lastUsage, "prompt_tokens", "input_tokens");
  const requestOutput = tokenCount(lastUsage, "completion_tokens", "output_tokens");
  const cachedInput = tokenCount(lastUsage, "cached_input_tokens", "cached_tokens") ??
    nestedTokenCount(lastUsage, "prompt_tokens_details", "cached_tokens") ??
    nestedTokenCount(lastUsage, "input_tokens_details", "cached_tokens");
  const reasoningOutput = nestedTokenCount(lastUsage, "completion_tokens_details", "reasoning_tokens") ??
    nestedTokenCount(lastUsage, "output_tokens_details", "reasoning_tokens");
  const sessionInput = measuredUsage.reduce((sum, u) => sum + (tokenCount(u, "prompt_tokens", "input_tokens") || 0), 0);
  const sessionOutput = measuredUsage.reduce((sum, u) => sum + (tokenCount(u, "completion_tokens", "output_tokens") || 0), 0);
  const hasRequestUsage = requestInput !== undefined || requestOutput !== undefined;
  // Character-based sizing is deliberately marked as an estimate. Provider input usage
  // remains the source of truth for the total; most providers do not expose prompt parts.
  const conversationEstimate = Math.ceil(messages.reduce((sum, message) => sum + (message.content?.length || 0), 0) / 4);
  const instructionEstimate = cfg.system?.trim() ? Math.ceil(cfg.system.trim().length / 4) : 0;
  const usedPercent = requestInput !== undefined && windowSize > 0 ? Math.min(100, requestInput / windowSize * 100) : undefined;
  const servers: { name: string; running: boolean; tools: number }[] = mcp?.servers || [];
  const connected = servers.filter((s) => s.running);

  const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="flex items-center gap-3 h-8 text-sm text-ink min-w-0"><span className="text-ink-2 shrink-0">{icon}</span>{children}</div>);

  return (
    <aside className="anim-rise w-[320px] max-[1000px]:w-[280px] shrink-0 h-full border-l border-line bg-[var(--sidebar)] flex flex-col overflow-y-auto" aria-label="Session details">
      <div className="drag h-[64px] shrink-0 flex items-center justify-between pl-5 pr-3 pt-2">
        <span className="text-base text-ink-2">Session</span>
        <button onClick={onClose} aria-label="Close session panel" className="no-drag h-8 w-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover"><X size={16} /></button>
      </div>
      <div role="toolbar" aria-label="Session tools" className="no-drag flex items-center gap-1 px-3 pb-3 border-b border-line">
        <button onClick={() => document.getElementById("session-progress")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          title="Jump to progress" aria-label="Jump to progress" className="h-8 w-8 rounded-md flex items-center justify-center bg-active text-ink hover:bg-hover"><ListChecks size={17} /></button>
        <button onClick={() => openBrowser()} title="Open web browser" aria-label="Open web browser" className="h-8 w-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover"><Globe2 size={17} /></button>
        <button onClick={() => project && openPath(project.path)} disabled={!project?.exists} title={project ? "Reveal project in Finder" : "No project attached"} aria-label="Reveal project in Finder" className="h-8 w-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover disabled:opacity-35 disabled:cursor-not-allowed"><FolderOpen size={17} /></button>
        <span className="ml-auto text-[11px] text-ink-3">{model?.name || "Atlas session"}</span>
      </div>

      <Section id="session-progress" title="Progress" right={runLive ? <AnimatedMark size={14} play="shimmer" /> : undefined}>
        {!lastRun ? <div className="text-sm text-ink-3">Steps appear here once Atlas starts working.</div> : (
          <>
            <div className="text-sm text-ink-2 mb-2">{steps.length ? summarizeSteps(steps) : runLive ? "Starting…" : "No tools were used."}</div>
            <ol className="space-y-1">
              {steps.slice(-8).map((st) => (
                <li key={st.id} className="flex items-center gap-2 text-sm min-w-0">
                  <span className="h-4 w-4 shrink-0 flex items-center justify-center">
                    {st.state === "running" ? <AnimatedMark size={12} play="shimmer" /> : st.state === "failed" ? <AlertCircle size={13} className="text-bad" /> : <Check size={13} strokeWidth={2.2} className="text-ink-3" />}
                  </span>
                  <span className="text-ink-2 shrink-0">{st.verb}</span>
                  {st.target && <span className={cx("truncate text-ink", st.mono && "font-mono text-xs")} title={st.target}>{st.target}</span>}
                </li>))}
            </ol>
            {steps.length > 8 && <div className="mt-1.5 text-xs text-ink-3">{steps.length - 8} earlier step{steps.length - 8 === 1 ? "" : "s"}</div>}
          </>)}
      </Section>

      <Section title="Environment">
        <Row icon={<Laptop size={17} strokeWidth={1.6} />}>This Mac</Row>
        {project && <Row icon={<Folder size={17} strokeWidth={1.6} />}><span className="truncate" title={project.path}>{project.name}</span></Row>}
        {project && <div className="-mt-1.5 ml-[29px] text-xs font-mono text-ink-3 truncate" title={project.path}>{project.path}</div>}
        {git?.branch && <Row icon={<GitBranch size={17} strokeWidth={1.6} />}><span className="truncate font-mono text-sm">{git.branch}</span></Row>}
        {!project && <div className="text-sm text-ink-3 mt-1">No project attached. Pick one in the Access menu below the message box.</div>}
      </Section>

      <Section title="Context used">
        <div className="mt-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-ink">{usedPercent === undefined ? "Usage unavailable" : `${Math.round(usedPercent)}% of window`}</span>
            <span className="text-xs text-ink-2 tnum">{requestInput === undefined ? "—" : fmt(requestInput)}{windowSize ? ` / ${fmt(windowSize)}` : " input tokens"}</span>
          </div>
          <div role="progressbar" aria-label="Last request context window used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent === undefined ? undefined : Math.round(usedPercent)}
            className="mt-2 h-2 overflow-hidden rounded-full bg-active">
            {usedPercent !== undefined && <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${usedPercent}%` }} />}
          </div>
          <div className="mt-1.5 text-[11px] text-ink-3">Last request · provider reported</div>
        </div>

        <div className="mt-4 space-y-2.5">
          <ContextRow label="Conversation text" value={fmt(conversationEstimate)} detail="estimated" color="bg-accent" />
          {instructionEstimate > 0 && <ContextRow label="Custom instructions" value={fmt(instructionEstimate)} detail="estimated" color="bg-warn" />}
          {requestOutput !== undefined && <ContextRow label="Response output" value={fmt(requestOutput)} detail="reported" color="bg-ok" />}
          {cachedInput !== undefined && <ContextRow label="Cached input" value={fmt(cachedInput)} detail="reported" color="bg-ink-3" />}
          <div className="pt-2 border-t border-line flex justify-between text-xs">
            <span className="text-ink-2">Messages in chat</span><span className="tnum text-ink">{messages.length}</span>
          </div>
          {windowSize > 0 && requestInput !== undefined && <div className="flex justify-between text-xs">
            <span className="text-ink-2">Approx. remaining</span><span className="tnum text-ink">{fmt(Math.max(0, windowSize - requestInput))}</span>
          </div>}
        </div>
        <div className="mt-3 text-[11px] leading-relaxed text-ink-3">Totals come from the provider. Conversation and instruction counts are rough estimates; hidden system and tool prompts are not itemized. {windowSize ? (model?.details?.context_estimated ? "The context window size is estimated." : "Window size is provider supplied.") : "This provider does not report its context window."}</div>
        {hasRequestUsage && <div className="sr-only">Session totals: {fmt(sessionInput)} input tokens and {fmt(sessionOutput)} output tokens.</div>}
      </Section>

      <Section title="Connectors">
        <button onClick={() => setShowServers((s) => !s)} className="w-full flex items-center justify-between text-sm text-left" aria-expanded={showServers}>
          <span className="flex items-center gap-1.5 text-ink-2"><ChevronRight size={14} className={cx("transition-transform duration-200", showServers && "rotate-90")} />{servers.length ? "Integrations" : "None added"}</span>
          <span className="text-ink-2">{connected.length} connected</span>
        </button>
        {showServers && servers.map((s) => (
          <div key={s.name} className="mt-2 ml-5 flex items-center gap-2 text-sm text-ink-2"><span className={cx("h-1.5 w-1.5 rounded-full", s.running ? "bg-ok" : "bg-ink-3")} />{s.name}<span className="ml-auto text-ink-3 tnum">{s.running ? `${s.tools} tools` : "off"}</span></div>))}
      </Section>

      {project && git?.is_repo && (
        <Section title="Changes" right={<span className="text-xs tnum"><span className="text-ok">+{(git.added || 0).toLocaleString()}</span> <span className="text-bad">−{(git.removed || 0).toLocaleString()}</span></span>}>
          {dirty.length === 0 ? <div className="text-sm text-ink-3">No uncommitted changes.</div> : (
            <ul className="space-y-0.5">
              {dirty.slice(0, 14).map((f) => (
                <li key={f.path} className="flex items-center gap-2 text-sm min-w-0" title={f.path}>
                  <span className={cx("w-4 shrink-0 text-center font-mono text-xs", f.code.includes("?") || f.code.includes("A") ? "text-ok" : f.code.includes("D") ? "text-bad" : "text-ink-3")}>{f.code.includes("?") ? "U" : f.code.trim()[0] || "M"}</span>
                  <span className="truncate text-ink-2 font-mono text-xs">{f.path}</span>
                </li>))}
            </ul>)}
          {dirty.length > 14 && <div className="mt-1.5 text-xs text-ink-3">and {dirty.length - 14} more · {dirty.length} files changed</div>}
        </Section>)}
    </aside>
  );
});
