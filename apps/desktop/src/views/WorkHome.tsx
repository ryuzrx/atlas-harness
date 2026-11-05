import React, { useState } from "react";
import { ChevronDown, Download, FolderPlus, Folder, GitBranch, Laptop } from "lucide-react";
import { api, Project, useApi } from "../api";
import { useStore } from "../store";
import { useAddProject } from "../components/useAddProject";
import { Attachment, ChatConfig, Composer, loadDraft, saveDraft } from "./Chat";
import { Menu, useToast } from "../components/ui";
import { useImportScan } from "../components/ImportSettings";

/** Work landing: pick a project folder, describe a task. Starts a chat that has that project's context. */
export function WorkHome() {
  const { go, setSettingsOpen } = useStore();
  const { scan } = useImportScan();
  const found = (scan?.folders || []).filter((f) => !f.added).length;
  const toast = useToast();
  const { add } = useAddProject();
  const { data: projects = [], loading } = useApi<Project[]>("/projects", ["project"]);
  const [cfg, setCfgState] = useState<ChatConfig>(loadDraft);
  const [pid, setPid] = useState<string | undefined>(() => localStorage.getItem("atlas_last_project") || undefined);
  const [seed, setSeed] = useState<{ text: string; n: number } | undefined>();
  const project = projects.find((p) => p.id === pid) || projects[0];
  const { data: git } = useApi<any>(project?.exists ? `/projects/${project.id}/git` : null, ["project", "task"]);
  const dirty: number = git?.is_repo ? (git.dirty || []).length : 0;

  const full: ChatConfig = { ...cfg, project_id: project?.id, tools: Array.from(new Set([...(cfg.tools || []), "project"])) };
  const setCfg = (p: ChatConfig) => { const next = { ...cfg, ...p }; setCfgState(next); saveDraft(next); };
  const choose = (id: string) => { setPid(id); localStorage.setItem("atlas_last_project", id); };

  const send = async (text: string, attachments: Attachment[]) => {
    if (!project) { toast("Add a project folder first.", "bad"); return false; }
    if ((full.mode || "model") === "model" && (!full.provider_id || !full.model)) { toast("Choose a model first.", "bad"); return false; }
    try {
      const c = await api<{ id: string }>("/conversations", { body: { config: full } });
      await api(`/conversations/${c.id}/messages`, { body: { content: text, attachments: attachments.map(({ name, content }) => ({ name, content })), config: full } });
      go({ name: "chat", id: c.id });
      return true;
    } catch (e: any) { toast(e.message || String(e), "bad"); return false; }
  };

  const row = "w-full h-12 px-4 flex items-center gap-3 text-[15px] text-ink text-left";
  return (
    <div className="h-full min-h-[520px] flex flex-col">
      <div className="text-[15px] text-ink-2 -mt-1">New session</div>
      <div className="flex-1 flex flex-col items-center justify-center py-10">
        <div className="w-full max-w-[400px] space-y-3">
          <div className="rounded-[14px] border border-line bg-surface divide-y divide-[var(--border)]">
            <div className={row}><Laptop size={17} strokeWidth={1.6} className="text-ink-2" />This Mac</div>
            {projects.length === 0 ? (
              !loading && <button onClick={add} className={`${row} hover:bg-hover rounded-b-[14px]`}><FolderPlus size={17} strokeWidth={1.6} className="text-ink-2" />Add a project folder</button>
            ) : (
              <Menu trigger={<button className={`${row} hover:bg-hover rounded-b-[14px]`} aria-label="Choose project">
                <Folder size={17} strokeWidth={1.6} className="text-ink-2" /><span className="flex-1 truncate">{project?.name || "Choose project"}</span><ChevronDown size={15} className="text-ink-3" /></button>}
                items={[...projects.map((p) => ({ label: p.name, onClick: () => choose(p.id) })), { label: "Add a project folder…", onClick: add }]} />
            )}
          </div>
          {projects.length === 0 && !loading && found > 0 && (
            <button onClick={() => { localStorage.setItem("atlas_settings_section", "Import"); setSettingsOpen(true); }}
              className="w-full h-12 px-4 rounded-[14px] border border-line bg-surface hover:bg-hover flex items-center gap-3 text-[15px] text-ink text-left">
              <Download size={17} strokeWidth={1.6} className="text-ink-2" />Import folders from your other tools<span className="text-ink-3">{found} found</span>
            </button>)}
          {dirty > 0 && (
            <button onClick={() => setSeed({ text: "Continue the uncommitted work in this project. Start by reviewing what changed.", n: Date.now() })}
              className="w-full h-12 px-4 rounded-[14px] border border-line bg-surface hover:bg-hover flex items-center gap-3 text-[15px] text-ink text-left">
              <GitBranch size={17} strokeWidth={1.6} className="text-ink-2" />Continue uncommitted work<span className="text-ink-3">{dirty} {dirty === 1 ? "file" : "files"}</span>
            </button>)}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[860px]">
        <Composer cfg={full} setCfg={setCfg} onSend={send} busy={false} onStop={() => {}} seed={seed} />
        <div className="mt-2 px-2 flex items-center gap-4 text-[12.5px] text-ink-3">
          <span className="flex items-center gap-1.5"><Laptop size={13} />This Mac</span>
          {project && <span className="flex items-center gap-1.5 truncate"><Folder size={13} />{project.name}</span>}
        </div>
      </div>
    </div>
  );
}
