import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, Globe, Search, Star } from "lucide-react";
import { api } from "../api";
import { Button, cx, Modal, Spinner, useAction } from "./ui";

interface RepoRow { full_name: string; description: string; stars: number; license: string; open: boolean; url: string }
interface RepoView extends RepoRow { blocked?: string; skills: { path: string; name: string; description: string }[] }

const stars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

/** Browse open-source skill collections on GitHub and add the ones you want. Only repositories with an open-source licence can be added. */
export function SkillHub({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RepoRow[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [err, setErr] = useState("");
  const [repo, setRepo] = useState<RepoView | null>(null);
  const [filter, setFilter] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [peek, setPeek] = useState<{ path: string; text: string } | null>(null);
  const { busy, run } = useAction();

  const load = async (query: string | null) => {
    setErr(""); setRows(null);
    try { setRows(await api<RepoRow[]>(query === null ? "/skillhub/featured" : `/skillhub/search?q=${encodeURIComponent(query)}`)); setSearched(query !== null); }
    catch (e: any) { setErr(e.message || "Could not reach GitHub."); setRows([]); }
  };
  useEffect(() => { if (open && !rows) load(null); if (!open) { setRepo(null); setSel(new Set()); setPeek(null); } }, [open]);

  const browse = async (full: string) => {
    const [owner, name] = full.split("/");
    setErr(""); setFilter(""); setSel(new Set()); setPeek(null);
    const r = await run("o", () => api<RepoView>("/skillhub/repo", { body: { owner, repo: name } }));
    if (r) setRepo(r);
  };
  const shown = useMemo(() => (repo?.skills || []).filter((s) => !filter || `${s.name} ${s.description}`.toLowerCase().includes(filter.toLowerCase())), [repo, filter]);
  const allOn = shown.length > 0 && shown.every((s) => sel.has(s.path));
  const add = async () => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split("/");
    const r = await run("i", () => api<{ added: number; skipped: number }>("/skillhub/install", { body: { owner, repo: name, paths: [...sel] } }));
    if (r) { setSel(new Set()); }
  };
  const look = async (path: string) => {
    if (peek?.path === path) return setPeek(null);
    const [owner, name] = repo!.full_name.split("/");
    const r = await run("p", () => api<{ text: string }>("/skillhub/preview", { body: { owner, repo: name, path } }));
    if (r) setPeek({ path, text: r.text });
  };

  return (
    <Modal open={open} onClose={onClose} width={780} title={<span className="inline-flex items-center gap-2"><Globe size={16} strokeWidth={1.6} />Find skills on GitHub</span>}
      footer={repo && !repo.blocked ? <><span className="mr-auto text-sm text-ink-3">{sel.size ? `${sel.size} selected` : "Tick the skills you want"}</span><Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="primary" busy={busy === "i"} disabled={!sel.size} onClick={add}>Add {sel.size || ""} skill{sel.size === 1 ? "" : "s"}</Button></> : <Button variant="ghost" onClick={onClose}>Close</Button>}>
      {!repo ? (
        <div>
          <form onSubmit={(e) => { e.preventDefault(); load(q.trim()); }} className="flex gap-2 mb-4">
            <div className="relative flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skill collections (e.g. marketing, testing, security)" aria-label="Search GitHub for skills"
                className="w-full h-10 pl-9 pr-3 rounded-lg bg-hover border border-line text-base text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" /></div>
            <Button type="submit" variant="primary" className="!h-10">Search</Button>
            {searched && <Button type="button" className="!h-10" onClick={() => { setQ(""); load(null); }}>Featured</Button>}
          </form>
          <p className="text-sm text-ink-3 mb-3">{searched ? "Public repositories tagged as agent skills." : "Popular open-source collections."} Atlas contacts github.com only when you search or open a repository. Skills are instructions your agents will follow, so only add ones you trust.</p>
          {err && <div className="mb-3 text-sm text-bad">{err}</div>}
          {!rows ? <div className="py-12 flex justify-center"><Spinner /></div> : rows.length === 0 && !err ? <div className="py-12 text-center text-sm text-ink-3">Nothing found.</div> : (
            <ul className="rounded-lg border border-line divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <li key={r.full_name} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-base text-ink"><span className="truncate">{r.full_name}</span>
                      <span className={cx("shrink-0 text-2xs rounded-full border px-2 leading-[18px]", r.open ? "border-line text-ink-2" : "border-line text-warn")}>{r.open ? r.license : "No open licence"}</span></div>
                    <div className="text-sm text-ink-3 truncate">{r.description}</div>
                  </div>
                  {r.stars > 0 && <span className="text-xs text-ink-3 flex items-center gap-1 shrink-0"><Star size={12} />{stars(r.stars)}</span>}
                  <Button size="sm" busy={busy === "o"} onClick={() => browse(r.full_name)}>Browse</Button>
                </li>))}
            </ul>)}
        </div>
      ) : (
        <div>
          <button onClick={() => setRepo(null)} className="mb-3 text-sm text-ink-2 hover:text-ink flex items-center gap-1.5"><ArrowLeft size={14} />All collections</button>
          <div className="mb-4"><div className="text-lg text-ink">{repo.full_name}</div>
            <div className="text-sm text-ink-3">{repo.license ? `${repo.license} licence` : "No licence"} · {repo.skills.length} skills</div></div>
          {repo.blocked ? <div className="rounded-lg border border-line p-4 text-base text-ink-2">{repo.blocked}</div> : <>
            <div className="flex items-center gap-3 mb-3">
              <div className="relative flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${repo.skills.length} skills`} aria-label="Filter skills"
                  className="w-full h-9 pl-9 pr-3 rounded-md bg-hover border border-line text-base text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" /></div>
              <button className="text-sm text-ink-2 hover:text-ink shrink-0" onClick={() => setSel(allOn ? new Set() : new Set(shown.map((s) => s.path)))}>{allOn ? "Select none" : `Select all ${shown.length}`}</button>
            </div>
            <ul className="rounded-lg border border-line divide-y divide-[var(--border)] max-h-[52vh] overflow-y-auto">
              {shown.map((s) => (
                <li key={s.path}>
                  <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-hover">
                    <input type="checkbox" className="mt-1 shrink-0" checked={sel.has(s.path)} aria-label={`Select ${s.name}`}
                      onChange={(e) => setSel((p) => { const n = new Set(p); e.target.checked ? n.add(s.path) : n.delete(s.path); return n; })} />
                    <div className="min-w-0 flex-1"><div className="text-base text-ink font-mono truncate">/{s.name}</div><div className="text-sm text-ink-3 line-clamp-2">{s.description}</div></div>
                    <button onClick={() => look(s.path)} aria-label={`Preview ${s.name}`} title="Preview" className="h-7 w-7 shrink-0 rounded-sm text-ink-3 hover:text-ink hover:bg-active flex items-center justify-center"><Eye size={14} /></button>
                  </div>
                  {peek?.path === s.path && <pre className="selectable mx-4 mb-3 p-3 rounded-md bg-hover border border-line text-xs font-mono whitespace-pre-wrap max-h-[240px] overflow-auto">{peek.text}</pre>}
                </li>))}
              {shown.length === 0 && <li className="py-10 text-center text-sm text-ink-3">No skills match.</li>}
            </ul></>}
        </div>
      )}
    </Modal>
  );
}
