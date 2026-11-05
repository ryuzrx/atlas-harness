import React, { useState } from "react";
import { ChevronRight, Folder, GitBranch, Laptop, X } from "lucide-react";
import { Model, Project, useApi } from "../api";
import { cx } from "./ui";

interface Msg { role: string; content: string; data?: Record<string, any> }

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="px-5 py-5 border-b border-line last:border-0">
      <div className="flex items-center justify-between mb-3"><h3 className="text-lg text-ink">{title}</h3>{right}</div>
      {children}
    </section>
  );
}

/** Side panel shown once a conversation has started: where it runs, how full the context is, connectors, and changes. */
export function SessionPanel({ messages, cfg, onClose }: {
  messages: Msg[]; cfg: { provider_id?: string; model?: string; project_id?: string; mode?: string }; onClose: () => void;
}) {
  const { data: projects = [] } = useApi<Project[]>("/projects", ["project"]);
  const project = projects.find((p) => p.id === cfg.project_id);
  const { data: git } = useApi<any>(project?.exists ? `/projects/${project.id}/git` : null, ["project", "task"], 8000);
  const { data: models = [] } = useApi<Model[]>("/models", ["model"]);
  const { data: mcp } = useApi<any>("/mcp", ["settings"]);
  const [showServers, setShowServers] = useState(false);

  const model = models.find((m) => m.provider_id === cfg.provider_id && m.name === cfg.model);
  const windowSize = model?.context_length || 0;
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant" && m.data?.usage?.prompt_tokens);
  const measured = lastReply ? Number(lastReply.data!.usage.prompt_tokens) + Number(lastReply.data!.usage.completion_tokens || 0) : 0;
  const estimated = Math.ceil(messages.reduce((a, m) => a + (m.content || "").length, 0) / 4);
  const used = measured || estimated;
  const pct = windowSize ? Math.min(100, (used / windowSize) * 100) : 0;
  const servers: { name: string; running: boolean; tools: number }[] = mcp?.servers || [];
  const connected = servers.filter((s) => s.running);

  const Row = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="flex items-center gap-3 h-10 text-base text-ink min-w-0"><span className="text-ink-2 shrink-0">{icon}</span>{children}</div>);

  return (
    <aside className="anim-rise w-[340px] max-[1100px]:absolute max-[1100px]:right-0 max-[1100px]:top-0 max-[1100px]:bottom-0 max-[1100px]:z-30 shrink-0 h-full border-l border-line bg-[var(--sidebar)] flex flex-col overflow-y-auto" aria-label="Session details">
      <div className="drag h-[64px] shrink-0 flex items-center justify-between pl-5 pr-3 pt-2">
        <span className="text-base text-ink-2">Session</span>
        <button onClick={onClose} aria-label="Close session panel" className="no-drag h-8 w-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover"><X size={16} /></button>
      </div>

      <Section title="Environment">
        <Row icon={<Laptop size={17} strokeWidth={1.6} />}>This Mac</Row>
        {project && <Row icon={<Folder size={17} strokeWidth={1.6} />}><span className="truncate" title={project.path}>{project.name}</span></Row>}
        {project && <div className="-mt-1.5 ml-[29px] text-xs font-mono text-ink-3 truncate" title={project.path}>{project.path}</div>}
        {git?.branch && <Row icon={<GitBranch size={17} strokeWidth={1.6} />}><span className="truncate font-mono text-sm">{git.branch}</span></Row>}
        {!project && <div className="text-sm text-ink-3 mt-1">No project attached. Pick one in Tools → Project context.</div>}
      </Section>

      <Section title="Context">
        <div className="flex items-baseline justify-between text-base">
          <span className="text-ink">{windowSize ? `${Math.round(pct)}% used` : `${fmt(used)} tokens`}</span>
          {windowSize ? <span className="text-ink-3 tnum">{fmt(used)} / {fmt(windowSize)}</span> : null}
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-active overflow-hidden"><div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-[var(--ease)]" style={{ width: `${windowSize ? Math.max(pct, 1) : 0}%` }} /></div>
        <dl className="mt-4 space-y-2 text-base">
          <div className="flex justify-between"><dt className="text-ink-2">Messages</dt><dd className="tnum text-ink-2">{messages.length}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-2">{measured ? "Last request (measured)" : "Conversation (estimated)"}</dt><dd className="tnum text-ink-2">{fmt(used)}</dd></div>
          {windowSize ? <div className="flex justify-between"><dt className="text-ink-2">Free space</dt><dd className="tnum text-ink-2">{fmt(Math.max(0, windowSize - used))}</dd></div> : null}
        </dl>
        {!windowSize && <div className="mt-3 text-xs text-ink-3">This model doesn't report its context window.</div>}
      </Section>

      <Section title="Connectors">
        <button onClick={() => setShowServers((s) => !s)} className="w-full flex items-center justify-between text-base text-left" aria-expanded={showServers}>
          <span className="flex items-center gap-1.5 text-ink-2"><ChevronRight size={14} className={cx("transition-transform duration-200", showServers && "rotate-90")} />{servers.length ? "Integrations" : "None added"}</span>
          <span className="text-ink-2">{connected.length} connected</span>
        </button>
        {showServers && servers.map((s) => (
          <div key={s.name} className="mt-2 ml-5 flex items-center gap-2 text-sm text-ink-2"><span className={cx("h-1.5 w-1.5 rounded-full", s.running ? "bg-ok" : "bg-ink-3")} />{s.name}<span className="ml-auto text-ink-3 tnum">{s.running ? `${s.tools} tools` : "off"}</span></div>))}
      </Section>

      {project && git?.is_repo && (
        <Section title="Changes">
          <div className="flex items-center gap-3 text-base tnum">
            <span className="text-ok">+{(git.added || 0).toLocaleString()}</span><span className="text-bad">−{(git.removed || 0).toLocaleString()}</span>
            <span className="text-ink-3 text-sm ml-auto">{(git.dirty || []).length} file{(git.dirty || []).length === 1 ? "" : "s"} changed</span>
          </div>
        </Section>)}
    </aside>
  );
}
