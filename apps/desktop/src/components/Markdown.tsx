import React, { createContext, useContext, useState } from "react";
import { Check, Copy, FileText, Folder } from "lucide-react";
import { api, openExternal } from "../api";
import { useToast } from "./ui";

/** Where relative paths in a reply live: the run's worktree, then its project. */
export const PathBase = createContext<{ taskId?: string; projectId?: string }>({});

// "src/app.ts", "./README.md", "~/notes/", "src/app.ts:42". Not "0.1", "e.g", "toBe(x)", or bare words.
const PATHLIKE = /^(~\/|\.{1,2}\/|\/)?[\w@.+-]+(\/[\w@.+-]+)*\/?(:\d+)*$/;
const looksLikePath = (t: string) => PATHLIKE.test(t) && !/^\d/.test(t) && (t.includes("/") || /\.[a-z][a-z0-9]{0,5}(:\d+)*$/i.test(t));

function PathLink({ path, children, code }: { path: string; children: React.ReactNode; code?: boolean }) {
  const base = useContext(PathBase);
  const toast = useToast();
  const isDir = path.endsWith("/");
  const open = (e: React.MouseEvent) => {
    e.preventDefault();
    api<{ is_dir: boolean }>("/open", { body: { path, task_id: base.taskId, project_id: base.projectId, reveal: e.altKey } })
      .catch((err) => toast(err.message || `Couldn't open ${path}.`, "bad"));
  };
  const tip = `${path}\nClick to open · Option-click to show in Finder`;
  if (code) return <a href="#" onClick={open} title={tip} className="path-link"><code>{children}</code></a>;
  return <a href="#" onClick={open} title={tip} className="path-link path-link-text">
    {isDir ? <Folder size={13} strokeWidth={1.8} /> : <FileText size={13} strokeWidth={1.8} />}<span>{children}</span></a>;
}

/** Small, safe Markdown renderer for chat: React elements only, never innerHTML. */

function inline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Bold/italic may wrap across soft line breaks inside one paragraph; links to files open them on this Mac.
  const re = /(`[^`\n]+`)|(\*\*[^*]+?\*\*)|(\*[^*\s][^*]*?\*|\b_[^_\n]+_\b)|(\[[^\]\n]+\]\(([^)\s]+)\))|(https?:\/\/[^\s<>"']+|(?:www\.)?(?:[\w-]+\.)+[A-Za-z]{2,}\/[^\s<>"']+)|((?:~\/|\.{1,2}\/|\/)?(?:[\w@.+-]+\/)+[\w@.+-]+(?:\.[A-Za-z0-9]{1,8})?(?::\d+)?)/g;
  const pushPlain = (s: string) => {
    const links = /https?:\/\/[^\s<>"']+|(?:www\.)?(?:[\w-]+\.)+[A-Za-z]{2,}\/[^\s<>"']+|(?:~\/|\.{1,2}\/|\/)?(?:[\w@.+-]+\/)+[\w@.+-]+(?:\.[A-Za-z0-9]{1,8})?(?::\d+)?/g;
    let lastPlain = 0, match: RegExpExecArray | null;
    while ((match = links.exec(s))) {
      const raw = match[0]; let link = raw;
      while (/[.,!?;:]$/.test(link)) link = link.slice(0, -1);
      if (match.index > lastPlain) out.push(s.slice(lastPlain, match.index));
      const linkKey = `${key}-auto-${i++}`;
      if (/^https?:\/\//i.test(link) || /^(?:www\.)?(?:[\w-]+\.)+[A-Za-z]{2,}\//i.test(link)) { const url = /^https?:\/\//i.test(link) ? link : `https://${link}`; out.push(<a key={linkKey} href={url} title={url} onClick={(e) => { e.preventDefault(); openExternal(url); }}>{link}</a>); }
      else if (looksLikePath(link)) out.push(<PathLink key={linkKey} path={link}>{link}</PathLink>);
      else out.push(link);
      if (raw.length > link.length) out.push(raw.slice(link.length));
      lastPlain = match.index + raw.length;
    }
    if (lastPlain < s.length) out.push(s.slice(lastPlain));
  };
  const push = (s: string) => s.split("\n").forEach((part, j) => { if (j) out.push(<br key={`${key}-br${i++}`} />); if (part) pushPlain(part); });
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (m[1]) { const c = t.slice(1, -1); out.push(looksLikePath(c) ? <PathLink key={k} path={c} code>{c}</PathLink> : <code key={k}>{c}</code>); }
    else if (m[2]) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{t.slice(1, -1)}</em>);
    else if (m[4] && /^(mailto:|#)/.test(m[5])) out.push(t.slice(1, t.indexOf("]")));
    else if (m[4] && !/^https?:\/\//.test(m[5])) out.push(<PathLink key={k} path={decodeURI(m[5])}>{t.slice(1, t.indexOf("]"))}</PathLink>);
    else if (m[4]) { const url = m[5]; out.push(<a key={k} href={url} title={url} onClick={(e) => { e.preventDefault(); openExternal(url); }}>{t.slice(1, t.indexOf("]"))}</a>); }
    else if (m[6]) { let textUrl = m[6]; while (/[.,!?;:]$/.test(textUrl)) textUrl = textUrl.slice(0, -1); const url = /^https?:\/\//i.test(textUrl) ? textUrl : `https://${textUrl}`; out.push(<a key={k} href={url} title={url} onClick={(e) => { e.preventDefault(); openExternal(url); }}>{textUrl}</a>); if (textUrl.length < t.length) out.push(t.slice(textUrl.length)); }
    else if (m[7] && looksLikePath(m[7])) out.push(<PathLink key={k} path={m[7]}>{m[7]}</PathLink>);
    last = m.index + t.length;
  }
  if (last < text.length) push(text.slice(last));
  return out;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre className="group relative">
      <div className="flex items-center justify-between h-8 pl-3.5 pr-1.5 border-b border-line text-xs text-ink-3">
        <span>{lang || "code"}</span>
        <button onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          aria-label="Copy code" className="h-6 px-2 rounded-sm flex items-center gap-1 text-ink-3 hover:text-ink hover:bg-hover">
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}</button>
      </div>
      <code>{code}</code>
    </pre>
  );
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end of a still-streaming block)
      blocks.push(<CodeBlock key={k++} code={body.join("\n")} lang={fence[1]} />);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      const Tag = (["h1", "h2", "h3"] as const)[h[1].length - 1];
      blocks.push(<Tag key={k++}>{inline(h[2], k)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k++}>{items.map((it, j) => <li key={j}>{inline(it, j)}</li>)}</L>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k++}>{inline(q.join(" "), k)}</blockquote>);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```|^#{1,3}\s|^\s*([-*•]|\d+[.)])\s+|^>/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(para.join("\n"), k)}</p>);
  }
  return <div className="chat-md selectable">{blocks}</div>;
}
