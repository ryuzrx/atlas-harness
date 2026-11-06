import React from "react";
import { FolderPlus, FolderOpen, FolderGit2, GitBranch, GitBranchPlus, History, Trash2 } from "lucide-react";
import { api, openPath, Project, useApi } from "../api";
import { useStore } from "../store";
import { useAddProject } from "../components/useAddProject";
import { Badge, Button, Card, Empty, useAction } from "../components/ui";
import { WorkHome } from "./WorkHome";

function GitPanel({ project }: { project: Project }) {
  const { settings } = useStore();
  const limit = Number(settings?.["projects.history_limit"]) || 25;
  const { data: g, reload } = useApi<any>(`/projects/${project.id}/git`, ["project", "task"]);
  const { busy, run } = useAction();
  if (!g) return null;
  if (!g.is_repo || !g.branch) return (
    <Card className="p-4">
      <div className="font-medium">{g.is_repo ? "Repository has no commits" : "Not a git repository"}</div>
      <div className="text-ink-2 text-sm mt-1">Coding tasks run in isolated git worktrees so agents never touch your checkout. Without git, write tasks run one at a time directly in the folder.</div>
      <Button className="mt-3" icon={<GitBranchPlus size={14} />} busy={busy === "i"} onClick={() => confirm(`Initialize git in ${project.path} and commit the current files?`) && run("i", () => api(`/projects/${project.id}/git-init`, { body: {} }), "Repository initialized").then(reload)}>
        Initialize git and commit current files</Button>
    </Card>);
  const atlasWts = (g.worktrees || []).filter((w: any) => (w.branch || "").includes("atlas/"));
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2"><GitBranch size={14} /><span className="font-mono text-sm">{g.branch}</span>
          <Badge tone={g.dirty.length ? "warn" : "ok"}>{g.dirty.length ? `${g.dirty.length} uncommitted` : "clean"}</Badge>
          <span className="ml-auto text-xs text-ink-2 tnum">{g.branches.length} branches · {atlasWts.length} ATLAS worktrees</span></div>
        {g.dirty.length > 0 && <div className="mt-2 text-xs font-mono text-ink-2 max-h-28 overflow-auto selectable">{g.dirty.map((d: any) => <div key={d.path}>{d.code} {d.path}</div>)}</div>}
      </Card>
      <Card className="overflow-hidden">
        <div className="px-4 h-9 flex items-center gap-2 text-xs font-medium text-ink-2 border-b border-line"><History size={13} strokeWidth={1.7} />Commit history</div>
        {g.log.slice(0, limit).map((c: any) => (
          <div key={c.sha} className="flex items-center gap-3 px-4 h-9 border-b border-line last:border-0 text-sm">
            <span className="font-mono text-ink-3 text-xs">{c.sha.slice(0, 8)}</span><span className="flex-1 truncate">{c.subject}</span>
            <span className="text-ink-2 text-xs">{c.author}</span><span className="text-ink-3 text-xs w-24 text-right">{c.when}</span></div>))}
      </Card>
      {g.branches.filter((b: string) => b.startsWith("atlas/")).length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-ink-2 mb-2"><GitBranch size={13} strokeWidth={1.7} />ATLAS task branches</div>
          <div className="flex flex-wrap gap-1.5">{g.branches.filter((b: string) => b.startsWith("atlas/")).map((b: string) => <Badge key={b} className="font-mono">{b}</Badge>)}</div>
        </Card>)}
    </div>
  );
}

export function Projects() {
  const { route, go, settings } = useStore();
  const { data: projects = [], reload } = useApi<Project[]>("/projects", ["project"]);
  const { add } = useAddProject();
  const { run } = useAction();
  // The sidebar's Work list is the project switcher; the route id picks the detail shown here.
  const cur = projects.find((p) => p.id === route.id) || projects[0];
  return (
    <div className="max-w-[860px] mx-auto">
      {!cur ? (
        <Card><Empty icon={<FolderGit2 size={22} />} title="No projects" body="Add a folder (ideally a git repository) to let teams work on it. Each agent is confined to its project." action={<Button icon={<FolderPlus size={14} />} onClick={add}>Add project</Button>} /></Card>
      ) : (
        <div className="min-w-0 space-y-6">
          <div className="flex items-center gap-2 pb-5 border-b border-line">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl leading-[26px] font-semibold tracking-[-0.02em] text-ink truncate">{cur.name}</h1>
              <div className="text-xs text-ink-2 font-mono truncate selectable" title={cur.path}>{cur.path}</div>
            </div>
            <Badge tone={cur.is_repo ? "ok" : "neutral"}>{cur.is_repo ? "Local Git checkout" : "Local files"}</Badge>
            <Button size="sm" icon={<FolderOpen size={13} />} onClick={() => openPath(cur.path)}>Reveal in Finder</Button>
            <Button size="sm" variant="danger" icon={<Trash2 size={13} />}
              onClick={() => (settings?.["projects.confirm_remove"] === false || confirm(`Remove ${cur.name} from ATLAS? Files are not touched.`)) && run("d", () => api(`/projects/${cur.id}`, { method: "DELETE" }), "Removed").then(() => { reload(); go({ name: "projects" }); })}>Remove</Button>
          </div>
          {cur.exists ? <>
            <WorkHome key={cur.id} pinnedProjectId={cur.id} />
            {cur.is_repo && <details className="pt-2">
              <summary className="cursor-pointer text-sm text-ink-2 hover:text-ink">Git status and history</summary>
              <div className="mt-3"><GitPanel project={cur} /></div>
            </details>}
          </> : <Card className="p-4 text-bad text-sm">Folder not found. It may have been moved or deleted.</Card>}
        </div>)}
    </div>
  );
}
