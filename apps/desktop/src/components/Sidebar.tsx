import React, { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, FolderKanban, FolderPlus, Folder, FolderGit2, Sparkles, Layers, Play, ChevronRight, SquarePlus, Plus, Search, Settings, MoreHorizontal, X } from "lucide-react";
import { api, Project, useApi } from "../api";
import { useAddProject } from "./useAddProject";
import { Mode, RouteName, useStore } from "../store";
import { cx, Menu, useAction } from "./ui";
import { AtlasMark, AtlasWordmark } from "./Logo";
import { Avatar, useProfile } from "./Profile";
import { ProfileCard } from "./Profile";

export { AtlasMark as Logo };

export interface Conversation { id: string; title: string; updated_at: number; created_at: number; config: Record<string, any> }

const NAV: { id: RouteName; label: string; icon: React.ElementType; match: RouteName[] }[] = [
  { id: "agents", label: "Agents", icon: Sparkles, match: ["agents", "teams", "team"] },
  { id: "models", label: "Models", icon: Layers, match: ["models"] },
  { id: "tasks", label: "Runs", icon: Play, match: ["tasks", "activity"] },
];

function NavItem({ active, collapsed, icon: Icon, label, onClick, badge }: {
  active: boolean; collapsed: boolean; icon: React.ElementType; label: string; onClick: () => void; badge?: number;
}) {
  return (
    <button onClick={onClick} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cx("relative z-[1] flex items-center gap-2.5 rounded-[10px] text-[14px] no-drag",
        collapsed ? "h-10 w-10 mx-auto justify-center" : "h-11 w-full px-3",
        active ? "text-accent" : "text-ink hover:bg-hover")}>
      <Icon size={17} strokeWidth={1.6} className={cx("shrink-0", !active && "text-ink-2")} />
      {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
      {!collapsed && !badge && <ChevronRight size={15} strokeWidth={1.6} className="shrink-0 text-ink-3" />}
      {!!badge && (collapsed
        ? <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-ink" />
        : <span className="text-[11px] text-ink-2 tnum">{badge}</span>)}
    </button>
  );
}

function groupOf(ts: number) {
  const d = new Date(ts * 1000), today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (d.getTime() >= start) return "Today";
  if (d.getTime() >= start - 86400000) return "Yesterday";
  return "Previous";
}

function ChatItem({ c, active }: { c: Conversation; active: boolean }) {
  const { go, settings } = useStore();
  const { run } = useAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setName(c.title); setTimeout(() => input.current?.select(), 0); } }, [editing]);
  const save = async () => {
    setEditing(false);
    if (name.trim() && name.trim() !== c.title) await run("r", () => api(`/conversations/${c.id}`, { method: "PATCH", body: { title: name.trim() } }));
  };
  const remove = async () => {
    if (settings?.["chat.confirm_delete"] !== false && !confirm(`Delete “${c.title}”? This removes the conversation history. Runs it started are kept.`)) return;
    await run("d", () => api(`/conversations/${c.id}`, { method: "DELETE" }));
    if (active) go({ name: "chat" });
  };
  if (editing) {
    return (
      <input ref={input} value={name} onChange={(e) => setName(e.target.value)} onBlur={save} aria-label="Conversation name"
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        className="w-full h-9 px-2.5 rounded-[10px] bg-surface border border-line-strong text-[13.5px] text-ink outline-none no-drag" />
    );
  }
  return (
    <div className={cx("group flex items-center rounded-[10px] anim-rise transition-colors duration-150", active ? "bg-selected" : "hover:bg-hover")}>
      <button onClick={() => go({ name: "chat", id: c.id })} onDoubleClick={() => setEditing(true)}
        className="flex-1 min-w-0 flex items-center gap-2.5 h-9 pl-2.5 pr-1 text-[14px] text-ink text-left no-drag">
        <MessageSquare size={15} strokeWidth={1.6} className="shrink-0 text-ink-2" />
        <span className="truncate">{c.title}</span>
      </button>
      <span className={cx("mr-1 shrink-0", active ? "flex" : "hidden group-hover:flex group-focus-within:flex")}>
        <Menu trigger={<button aria-label={`Actions for ${c.title}`} className="h-6 w-6 flex items-center justify-center rounded-[6px] text-ink-2 hover:text-ink hover:bg-active no-drag"><MoreHorizontal size={14} /></button>}
          items={[{ label: "Rename", onClick: () => setEditing(true) }, { label: "Delete", danger: true, onClick: remove }]} />
      </span>
    </div>
  );
}

function ChatHistory() {
  const { route, go, settings } = useStore();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 180); return () => clearTimeout(t); }, [q]);
  const { data: convs = [], loading } = useApi<Conversation[]>(`/conversations${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`, ["conversation"]);
  // drop the remembered chat if it no longer exists, so the Chat tab never reopens a deleted conversation
  useEffect(() => {
    const last = localStorage.getItem("atlas_last_chat");
    if (!debounced && !loading && last && !convs.some((c) => c.id === last)) localStorage.removeItem("atlas_last_chat");
  }, [convs, loading, debounced]);
  const groups = useMemo(() => {
    const g: Record<string, Conversation[]> = { Today: [], Yesterday: [], Previous: [] };
    const limit = Number(settings?.["chat.history_limit"] ?? 50);
    for (const c of limit > 0 ? convs.slice(0, limit) : convs) g[groupOf(c.updated_at)].push(c);
    return g;
  }, [convs, settings]);
  const grouped = settings?.["chat.group_history"] !== false;
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center h-8 pl-2.5 pr-0.5 mb-1 shrink-0">
        <span className="flex-1 text-[13px] text-ink-2">Chat History</span>
        <button onClick={() => setSearching((s) => !s)} aria-label="Search chats" title="Search chats"
          className={cx("h-7 w-7 flex items-center justify-center rounded-[7px] no-drag", searching ? "text-ink bg-hover" : "text-ink-2 hover:text-ink hover:bg-hover")}><Search size={14} /></button>
        <button onClick={() => go({ name: "chat" })} aria-label="New chat" title="New chat  ⌘N"
          className="h-7 w-7 flex items-center justify-center rounded-[7px] text-ink-2 hover:text-ink hover:bg-hover no-drag"><Plus size={16} /></button>
      </div>
      {searching && (
        <div className="relative pb-2 shrink-0">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats"
            onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setSearching(false); } }}
            className="w-full h-8 pl-2.5 pr-7 rounded-[8px] bg-surface border border-line text-[13px] text-ink placeholder:text-ink-3 outline-none focus:border-line-strong no-drag" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-2 text-ink-3 hover:text-ink"><X size={14} /></button>}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {!loading && convs.length === 0 && (
          <div className="px-2.5 py-2 text-[12.5px] text-ink-3">{debounced ? "No chats match." : "No chats yet."}</div>
        )}
        {(["Today", "Yesterday", "Previous"] as const).map((g) => groups[g].length > 0 && (
          <div key={g}>
            {grouped && <div className="px-2.5 pt-3 pb-1 text-[11.5px] text-ink-3">{g}</div>}
            <div className="flex flex-col gap-0.5">
              {groups[g].map((c) => <ChatItem key={c.id} c={c} active={route.name === "chat" && route.id === c.id} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const MODES: { id: Mode; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "work", label: "Work", icon: FolderKanban },
];

/** Compact two-option switch under the wordmark. Roving tabindex + arrow keys, like a tablist. */
function ModeSwitch({ collapsed }: { collapsed: boolean }) {
  const { mode, switchMode } = useStore();
  const onKey = (e: React.KeyboardEvent) => {
    const i = MODES.findIndex((m) => m.id === mode);
    const next = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key) ? MODES[(i + 1) % 2] : null;
    if (!next) return;
    e.preventDefault(); switchMode(next.id);
    requestAnimationFrame(() => (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-mode="${next.id}"]`)?.focus());
  };
  return (
    <div role="tablist" aria-label="Workspace mode" onKeyDown={onKey}
      className={cx("no-drag shrink-0 gap-1 p-1.5 rounded-[14px] bg-hover border border-line-strong", collapsed ? "flex flex-col mx-2 mt-2" : "flex mx-3 mt-3")}>
      {MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button key={m.id} data-mode={m.id} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} aria-label={m.label} title={collapsed ? m.label : undefined}
            onClick={() => switchMode(m.id)}
            className={cx("flex-1 h-10 flex items-center justify-center gap-2 rounded-[10px] border text-[15px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease)]",
              collapsed && "h-10",
              on ? "bg-surface text-ink border-line-strong shadow-[var(--shadow)]" : "border-transparent text-ink-2 hover:text-ink")}>
            <m.icon size={19} strokeWidth={1.7} className={on ? "text-accent" : ""} />
            {!collapsed && <span>{m.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

function ProjectList() {
  const { route, go, settings } = useStore();
  const { add, adding } = useAddProject();
  const { data: list = [], loading } = useApi<Project[]>("/projects", ["project"]);
  const projects = useMemo(() => settings?.["projects.sort"] === "added" ? list : [...list].sort((a, b) => a.name.localeCompare(b.name)), [list, settings]);
  const current = route.name === "projects" ? route.id : undefined;
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center h-8 pl-2.5 pr-0.5 mb-1 shrink-0">
        <span className="flex-1 text-[13px] text-ink-2">Project Folders</span>
        <button onClick={add} disabled={adding} aria-label="Add project" title="Add project"
          className="h-7 w-7 flex items-center justify-center rounded-[7px] text-ink-2 hover:text-ink hover:bg-hover disabled:opacity-45 no-drag"><FolderPlus size={15} strokeWidth={1.6} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {!loading && projects.length === 0 && (
          <div className="px-2.5 py-2 text-[12.5px] text-ink-3">No projects yet. Add a folder to get started.</div>
        )}
        <div className="flex flex-col gap-0.5">
          {projects.map((p) => {
            const active = p.id === current;
            const Icon = p.is_repo ? FolderGit2 : Folder;
            return (
              <button key={p.id} onClick={() => go({ name: "projects", id: p.id })} aria-current={active ? "page" : undefined} title={p.path}
                className={cx("flex items-center gap-2.5 h-9 px-2.5 rounded-[10px] text-[14px] text-left no-drag", active ? "bg-selected text-ink" : "text-ink hover:bg-hover")}>
                <Icon size={15} strokeWidth={1.6} className={cx("shrink-0", !p.exists ? "text-bad" : active ? "text-accent" : "text-ink-2")} />
                <span className="truncate">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ pending, user }: { pending: number; user?: string }) {
  const { route, go, mode, settingsOpen, sidebarCollapsed: collapsed, toggleSidebar } = useStore();
  const name = user || "you";
  const { avatar: avatarSrc } = useProfile();
  const idx = NAV.findIndex((n) => n.match.includes(route.name));
  const rowH = collapsed ? 40 : 44;
  return (
    <aside style={{ width: collapsed ? 68 : 268 }} aria-label="Sidebar"
      className="h-full shrink-0 flex flex-col bg-[var(--sidebar)] border-r border-line transition-[width] duration-300 ease-[var(--ease)] overflow-hidden">
      {/* traffic lights sit in this strip */}
      <div className="drag h-[56px] shrink-0" />
      <div className={cx("shrink-0 flex items-center", collapsed ? "flex-col gap-2 px-2 pb-2" : "h-12 pl-[22px] pr-3 gap-1 mt-1 mb-1")}>
        {collapsed ? (
          <>
            <button onClick={toggleSidebar} aria-label="Expand sidebar" title="Expand sidebar  ⌘B"
              className="h-10 w-10 flex items-center justify-center rounded-[10px] text-ink hover:bg-hover no-drag"><AtlasMark size={22} /></button>
            <button onClick={() => go({ name: "chat" })} aria-label="New chat" title="New chat  ⌘N"
              className="h-10 w-10 flex items-center justify-center rounded-[10px] text-ink hover:bg-hover no-drag"><SquarePlus size={18} strokeWidth={1.6} /></button>
          </>
        ) : (
          <>
            <button onClick={() => go({ name: "chat" })} className="flex-1 min-w-0 text-left no-drag" aria-label="Atlas home"><AtlasWordmark /></button>
            <button onClick={() => go({ name: "chat" })} aria-label="New chat" title="New chat  ⌘N"
              className="h-10 w-10 flex items-center justify-center rounded-[10px] border border-line text-ink hover:bg-hover no-drag"><Plus size={19} strokeWidth={1.6} /></button>
          </>
        )}
      </div>

      <ModeSwitch collapsed={collapsed} />

      <nav aria-label="Primary" className={cx("relative shrink-0 flex flex-col gap-0.5", collapsed ? "px-2 pt-4" : "px-3 pt-5 pb-4")}>
        {/* one highlight that glides to the active page */}
        <span aria-hidden className={cx("nav-indicator absolute rounded-[10px] bg-selected", collapsed ? "left-1/2 -ml-5 w-10" : "left-3 right-3")}
          style={{ top: collapsed ? 16 : 20, height: rowH, transform: `translateY(${Math.max(idx, 0) * (rowH + 2)}px)`, opacity: idx < 0 ? 0 : 1 }} />
        {NAV.map((n) => (
          <NavItem key={n.id} active={n.match.includes(route.name)} collapsed={collapsed} icon={n.icon} label={n.label}
            badge={n.id === "tasks" ? pending : undefined} onClick={() => go({ name: n.id })} />
        ))}
      </nav>

      {collapsed ? <div className="flex-1" /> : (
        <div className="min-h-0 flex-1 flex flex-col mx-3 pt-3 border-t border-line">
          {mode === "chat" ? <ChatHistory /> : <ProjectList />}
        </div>)}

      <div className={cx("shrink-0", collapsed ? "px-2 pb-4 pt-2" : "px-3 pt-2 pb-3")}>
        {collapsed ? (
          <button onClick={() => go({ name: "settings" })} aria-label="Settings" title="Settings  ⌘,"
            className={cx("h-10 w-10 mx-auto flex items-center justify-center rounded-[10px] no-drag", settingsOpen ? "bg-selected text-ink" : "text-ink-2 hover:bg-hover hover:text-ink")}>
            <Avatar src={avatarSrc} name={name} size={30} /></button>
        ) : (
          <ProfileCard name={name} />
        )}
      </div>
    </aside>
  );
}
