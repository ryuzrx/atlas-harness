import React, { useState } from "react";
import { Starfield } from "../components/Starfield";
import { ChevronDown, Download, FolderPlus, Folder, GitBranch, Laptop, GitFork, X } from "lucide-react";
import { api, pickFolder, Project, useApi } from "../api";
import { useStore } from "../store";
import { useAddProject } from "../components/useAddProject";
import { Attachment, ChatConfig, Composer, loadDraft, saveDraft } from "./Chat";
import { Button, Menu, useToast } from "../components/ui";
import { useImportScan } from "../components/ImportSettings";

/** Work landing: pick a project folder, describe a task. Starts a chat that has that project's context. */
export function WorkHome({ pinnedProjectId }: { pinnedProjectId?: string }) {
  const { go, setSettingsOpen } = useStore();
  const { scan } = useImportScan();
  const found = (scan?.folders || []).filter((f) => !f.added).length;
  const toast = useToast();
  const { add } = useAddProject();
  const { data: projects = [], loading } = useApi<Project[]>("/projects", ["project"]);
  const [cfg, setCfgState] = useState<ChatConfig>(loadDraft);
  const [pid, setPid] = useState<string | undefined>(() => pinnedProjectId || localStorage.getItem("atlas_last_project") || undefined);
  const [source, setSource] = useState<"local" | "git">("local");
  const [showGit, setShowGit] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [seed, setSeed] = useState<{ text: string; n: number } | undefined>();
  const project = (pinnedProjectId ? projects.find((p) => p.id === pinnedProjectId) : projects.find((p) => p.id === pid) || projects[0]);
  const { data: git } = useApi<any>(project?.exists ? `/projects/${project.id}/git` : null, ["project", "task"]);
  const dirty: number = git?.is_repo ? (git.dirty || []).length : 0;

  const full: ChatConfig = { ...cfg, project_id: project?.id, tools: Array.from(new Set([...(cfg.tools || []), "project"])) };
  const setCfg = (p: ChatConfig) => { const next = { ...cfg, ...p }; setCfgState(next); saveDraft(next); };
  const choose = (id: string) => { setPid(id); localStorage.setItem("atlas_last_project", id); };

  const cloneProject = async () => {
    const url = gitUrl.trim();
    if (!url) return;
    const parent = await pickFolder();
    if (!parent) return;
    setCloning(true);
    try {
      const created = await api<Project>("/projects/clone", { body: { url, parent } });
      choose(created.id);
      go({ name: "projects", id: created.id });
      setShowGit(false);
      setGitUrl("");
    } catch (error: any) { toast(error.message || String(error), "bad"); }
    finally { setCloning(false); }
  };

  const send = async (text: string, attachments: Attachment[]) => {
    if (!project) { toast("Add a project folder first.", "bad"); return false; }
    if ((full.mode || "model") === "model" && (!full.provider_id || !full.model)) { toast("Choose a model first.", "bad"); return false; }
    try {
      const c = await api<{ id: string }>("/conversations", { body: { config: full } });
      await api(`/conversations/${c.id}/messages`, { body: { content: text, attachments, config: full } });
      go({ name: "chat", id: c.id });
      return true;
    } catch (e: any) { toast(e.message || String(e), "bad"); return false; }
  };

  const row = "w-full h-11 px-3.5 flex items-center gap-3 text-sm text-ink text-left";
  return (
    <div className="relative h-full min-h-[520px] flex flex-col">
      <Starfield />
      <div className="relative flex-1 flex flex-col items-center justify-center py-10">
        <div className="w-full max-w-[440px] space-y-3">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-semibold text-ink">{pinnedProjectId && project ? project.name : "New session"}</h1>
            <p className="mt-1 text-sm text-ink-2">{pinnedProjectId ? "Work with files in this local project." : "Choose where to work, then describe the task below."}</p>
          </div>
          {!pinnedProjectId && <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface p-1.5">
            <button onClick={() => { setSource("local"); setShowGit(false); }} aria-pressed={source === "local"}
              className={`h-9 rounded-md flex items-center justify-center gap-2 text-sm ${source === "local" ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover"}`}>
              <Laptop size={15} />Local folder</button>
            <button onClick={() => { setSource("git"); setShowGit(true); }} aria-pressed={source === "git"}
              className={`h-9 rounded-md flex items-center justify-center gap-2 text-sm ${source === "git" ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover"}`}>
              <GitFork size={15} />Git repository</button>
          </div>}
          {!showGit && <div className="rounded-lg border border-line bg-surface divide-y divide-[var(--border)] shadow-[var(--shadow)]">
            <div className="px-3.5 py-2.5 flex items-center gap-3 text-sm text-ink-2"><Laptop size={16} strokeWidth={1.6} />Files stay on this Mac</div>
            {projects.length === 0 ? (
              !loading && <button onClick={add} className={`${row} hover:bg-hover rounded-b-[14px]`}><FolderPlus size={16} strokeWidth={1.6} className="text-ink-2" />Add a project folder</button>
            ) : (
              pinnedProjectId ? <div className={`${row} rounded-b-[14px]`}><Folder size={16} className="text-ink-2" />{project?.name || "Project"}</div> :
              <Menu trigger={<button className={`${row} hover:bg-hover rounded-b-[14px]`} aria-label="Choose project">
                <Folder size={16} strokeWidth={1.6} className="text-ink-2" /><span className="flex-1 truncate">{project?.name || "Choose project"}</span><ChevronDown size={15} className="text-ink-3" /></button>}
                items={[...projects.map((p) => ({ label: p.name, onClick: () => choose(p.id) })), { label: "Add a project folder…", onClick: add }]} />
            )}
          </div>}
          {showGit && <div className="rounded-lg border border-line bg-surface p-3.5 space-y-3">
            <div className="flex items-center justify-between"><div className="text-sm font-medium">Clone a Git repository</div><button aria-label="Close Git repository setup" onClick={() => setShowGit(false)} className="p-1 text-ink-3 hover:text-ink"><X size={15} /></button></div>
            <p className="text-xs text-ink-2">The checkout stays on this Mac. Git remotes let you sync changes with a host.</p>
            <input aria-label="Git repository URL" placeholder="https://github.com/you/project.git" value={gitUrl} onChange={(event) => setGitUrl(event.target.value)}
              className="h-9 w-full rounded-md border border-line bg-bg px-3 text-sm text-ink placeholder:text-ink-3" />
            <Button size="sm" disabled={!gitUrl.trim() || cloning} busy={cloning} onClick={cloneProject} className="w-full">Choose location and clone</Button>
          </div>}
          {!pinnedProjectId && !showGit && projects.length === 0 && !loading && found > 0 && (
            <button onClick={() => { localStorage.setItem("atlas_settings_section", "Import"); setSettingsOpen(true); }}
              className="w-full h-11 px-3.5 rounded-lg border border-line bg-surface hover:bg-hover flex items-center gap-3 text-sm text-ink text-left">
              <Download size={16} strokeWidth={1.6} className="text-ink-2" />Import folders from your other tools<span className="ml-auto text-xs text-ink-3">{found} found</span>
            </button>)}
          {dirty > 0 && (
            <button onClick={() => setSeed({ text: "Continue the uncommitted work in this project. Start by reviewing what changed.", n: Date.now() })}
              className="w-full h-11 px-3.5 rounded-lg border border-line bg-surface hover:bg-hover flex items-center gap-3 text-sm text-ink text-left">
              <GitBranch size={16} strokeWidth={1.6} className="text-ink-2" />Continue uncommitted work<span className="ml-auto text-xs text-ink-3">{dirty} {dirty === 1 ? "file" : "files"}</span>
            </button>)}
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-[860px]">
        <Composer cfg={full} setCfg={setCfg} onSend={send} busy={false} onStop={() => {}} seed={seed} />
        <div className="mt-2 px-2 flex items-center gap-4 text-sm text-ink-3">
          <span className="flex items-center gap-1.5"><Laptop size={13} />This Mac</span>
          {project && <span className="flex items-center gap-1.5 truncate"><Folder size={13} />{project.name}</span>}
        </div>
      </div>
    </div>
  );
}
