import React, { useEffect, useState } from "react";
import { Folder, FolderGit2, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../api";
import { useStore } from "../store";
import { Button, cx, Spinner, useAction } from "./ui";

export interface ImportScan {
  tools: { id: string; label: string; count: number }[];
  folders: { path: string; name: string; sources: string[]; is_repo: boolean; added: boolean; last_used: number }[];
  skills: { name: string; description: string; source: string; path: string; added: boolean }[];
}

/** Scan this Mac for project folders and skills from other AI tools and import the ones you pick. */
export function useImportScan() {
  const [scan, setScan] = useState<ImportScan | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { setScan(await api<ImportScan>("/import/scan")); } catch { setScan(null); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  return { scan, loading, reload: load };
}

function Pick({ checked, onChange, children, sub, right }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 px-4 py-3 cursor-default hover:bg-hover">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="shrink-0" />
      <div className="min-w-0 flex-1"><div className="text-[14px] text-ink truncate">{children}</div>{sub && <div className="text-[12.5px] text-ink-3 truncate">{sub}</div>}</div>
      {right}
    </label>
  );
}

export function ImportSettings() {
  const { activeWorkspace } = useStore();
  const { scan, loading, reload } = useImportScan();
  const { busy, run } = useAction();
  const [folders, setFolders] = useState<Set<string>>(new Set());
  const [skills, setSkills] = useState<Set<string>>(new Set());
  const newFolders = scan?.folders.filter((f) => !f.added) || [];
  const newSkills = scan?.skills.filter((s) => !s.added) || [];
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string, on: boolean) => { const n = new Set(set); on ? n.add(key) : n.delete(key); setter(n); };
  const total = folders.size + skills.size;

  const doImport = async () => {
    const [p, s] = await Promise.all([
      folders.size ? run("p", () => api<any>("/import/projects", { body: { paths: [...folders], workspace: activeWorkspace } })) : Promise.resolve({ added: [] }),
      skills.size ? run("s", () => api<any>("/import/skills", { body: { paths: [...skills] } })) : Promise.resolve({ added: [] }),
    ]);
    const n = (p?.added?.length || 0) + (s?.added?.length || 0);
    if (n) { setFolders(new Set()); setSkills(new Set()); reload(); }
  };

  return (
    <div>
      <div className="flex items-center gap-4 pt-1 pb-5">
        <p className="flex-1 min-w-0 text-[13.5px] leading-[20px] text-ink-2">Atlas looks for project folders and skills you already use with other AI tools on this Mac, like Claude Code, Codex, OpenCode, Cursor and VS Code. Nothing is read except folder names and skill instructions, and nothing leaves your Mac.</p>
        <Button icon={<RefreshCw size={14} />} busy={loading} onClick={reload}>Scan again</Button>
      </div>

      {loading && !scan && <div className="py-10 flex justify-center"><Spinner /></div>}
      {scan && <>
        <div className="flex flex-wrap gap-2 mb-6">
          {scan.tools.map((t) => (
            <span key={t.id} className={cx("h-7 px-3 rounded-full border border-line text-[12.5px] flex items-center", t.count ? "text-ink" : "text-ink-3")}>{t.label}<span className="ml-1.5 tnum text-ink-3">{t.count || "not found"}</span></span>))}
          {scan.skills.length > 0 && <span className="h-7 px-3 rounded-full border border-line text-[12.5px] text-ink flex items-center">Skills<span className="ml-1.5 tnum text-ink-3">{scan.skills.length}</span></span>}
        </div>

        <div className="flex items-center justify-between mb-2"><h3 className="text-[14px] text-ink flex items-center gap-2"><Folder size={15} strokeWidth={1.6} />Project folders</h3>
          {newFolders.length > 0 && <button className="text-[12.5px] text-ink-2 hover:text-ink" onClick={() => setFolders(folders.size === newFolders.length ? new Set() : new Set(newFolders.map((f) => f.path)))}>{folders.size === newFolders.length ? "Select none" : "Select all"}</button>}</div>
        {scan.folders.length === 0 ? <div className="rounded-[12px] border border-dashed border-line py-8 text-center text-[13px] text-ink-3">No project folders found.</div> : (
          <ul className="rounded-[12px] border border-line divide-y divide-[var(--border)] max-h-[320px] overflow-y-auto">
            {scan.folders.map((f) => f.added ? (
              <li key={f.path} className="flex items-center gap-3 px-4 py-3 opacity-60"><FolderGit2 size={15} className="text-ink-3" /><div className="min-w-0 flex-1 text-[14px] text-ink truncate">{f.name}</div><span className="text-[12px] text-ink-3">Added</span></li>
            ) : (
              <Pick key={f.path} checked={folders.has(f.path)} onChange={(v) => toggle(folders, setFolders, f.path, v)} sub={f.path}
                right={<span className="text-[12px] text-ink-3 shrink-0">{f.sources.join(", ")}</span>}>{f.name}</Pick>))}
          </ul>)}

        <div className="flex items-center justify-between mt-8 mb-2"><h3 className="text-[14px] text-ink flex items-center gap-2"><Sparkles size={15} strokeWidth={1.6} />Skills</h3>
          {newSkills.length > 0 && <button className="text-[12.5px] text-ink-2 hover:text-ink" onClick={() => setSkills(skills.size === newSkills.length ? new Set() : new Set(newSkills.map((s) => s.path)))}>{skills.size === newSkills.length ? "Select none" : "Select all"}</button>}</div>
        {scan.skills.length === 0 ? <div className="rounded-[12px] border border-dashed border-line py-8 text-center text-[13px] text-ink-3">No skills found in ~/.claude/skills or ~/.codex/skills.</div> : (
          <ul className="rounded-[12px] border border-line divide-y divide-[var(--border)] max-h-[320px] overflow-y-auto">
            {scan.skills.map((s) => s.added ? (
              <li key={s.path} className="flex items-center gap-3 px-4 py-3 opacity-60"><Sparkles size={15} className="text-ink-3" /><div className="min-w-0 flex-1 text-[14px] text-ink truncate">{s.name}</div><span className="text-[12px] text-ink-3">Added</span></li>
            ) : (
              <Pick key={s.path} checked={skills.has(s.path)} onChange={(v) => toggle(skills, setSkills, s.path, v)} sub={s.description}
                right={<span className="text-[12px] text-ink-3 shrink-0">{s.source}</span>}>{s.name}</Pick>))}
          </ul>)}

        <div className="sticky bottom-0 mt-6 -mx-1 px-1 pt-3 pb-1 border-t border-line bg-[var(--surface)] flex items-center gap-3">
          <span className="flex-1 text-[13px] text-ink-3">{total ? `${total} selected` : "Pick what you want to bring into Atlas."}</span>
          <Button variant="primary" busy={busy === "p" || busy === "s"} disabled={!total} onClick={doImport}>Import{total ? ` ${total}` : ""}</Button>
        </div>
      </>}
    </div>
  );
}
