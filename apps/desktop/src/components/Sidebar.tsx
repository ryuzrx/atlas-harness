import React, { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, FolderKanban, FolderPlus, Folder, FolderGit2, Sparkles, Layers, Play, SquarePlus, Plus, Search, Settings, MoreHorizontal, PanelLeftClose, PanelLeftOpen, ChevronRight, ChevronsUpDown, X } from "lucide-react";
import { api, Project, useApi } from "../api";
import { useAddProject } from "./useAddProject";
import { Mode, RouteName, useStore } from "../store";
import { cx, Menu, useAction } from "./ui";
import { AtlasMark, AtlasWordmark } from "./Logo";
import { ProfileCard } from "./Profile";
import { loadDraft } from "../views/Chat";

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
      className={cx("sidebar-nav-item relative z-[1] flex items-center gap-2.5 rounded-lg text-sm no-drag",
        collapsed ? "h-11 w-11 mx-auto justify-center" : "h-10 w-full px-3",
        active ? "bg-selected text-ink font-medium" : "text-ink-2 hover:text-ink hover:bg-hover")}>
      <Icon size={collapsed ? 20 : 17} strokeWidth={1.7} className={cx("shrink-0", active ? "text-ink" : "text-ink-2")} />
      {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
      {!!badge && (collapsed
        ? <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-ink" />
        : <span className="text-2xs text-ink-2 tnum">{badge}</span>)}
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
        className="w-full h-8 px-2.5 rounded-md bg-surface border border-line-strong text-sm text-ink outline-none no-drag" />
    );
  }
  return (
    <div className={cx("group flex items-center rounded-md anim-rise transition-colors duration-150", active ? "bg-selected" : "hover:bg-hover")}>
      <button onClick={() => go({ name: "chat", id: c.id })} onDoubleClick={() => setEditing(true)}
        className="flex-1 min-w-0 flex items-center h-8 pl-2.5 pr-1 text-sm text-ink text-left no-drag">
        <span className="truncate">{c.title}</span>
      </button>
      <span className={cx("mr-1 shrink-0", active ? "flex" : "hidden group-hover:flex group-focus-within:flex")}>
        <Menu trigger={<button aria-label={`Actions for ${c.title}`} className="h-6 w-6 flex items-center justify-center rounded-sm text-ink-2 hover:text-ink hover:bg-active no-drag"><MoreHorizontal size={14} /></button>}
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
  const { data: allConvs = [], loading } = useApi<Conversation[]>(`/conversations${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`, ["conversation"]);
  // Project chats live under their project in the Work sidebar, not in general Chat history.
  const convs = useMemo(() => allConvs.filter((c) => !c.config?.project_id), [allConvs]);
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
      <div className="flex items-center h-7 pl-2.5 pr-0.5 shrink-0">
        <span className="flex-1 text-2xs font-semibold text-ink-3">Chats</span>
        <button onClick={() => setSearching((s) => !s)} aria-label="Search chats" title="Search chats"
          className={cx("h-7 w-7 flex items-center justify-center rounded-sm no-drag", searching ? "text-ink bg-hover" : "text-ink-2 hover:text-ink hover:bg-hover")}><Search size={14} /></button>
        <button onClick={() => go({ name: "chat" })} aria-label="New chat" title="New chat  ⌘N"
          className="h-7 w-7 flex items-center justify-center rounded-sm text-ink-2 hover:text-ink hover:bg-hover no-drag"><Plus size={16} /></button>
      </div>
      {searching && (
        <div className="relative pb-2 shrink-0">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats"
            onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); setSearching(false); } }}
            className="w-full h-8 pl-2.5 pr-7 rounded-md bg-surface border border-line text-sm text-ink placeholder:text-ink-3 outline-none focus:border-line-strong no-drag" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-2 text-ink-3 hover:text-ink"><X size={14} /></button>}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {!loading && convs.length === 0 && (
          <div className="px-2.5 py-1.5 text-xs text-ink-3">{debounced ? "No chats match." : "No chats yet."}</div>
        )}
        {(["Today", "Yesterday", "Previous"] as const).map((g) => groups[g].length > 0 && (
          <div key={g}>
            {grouped && <div className="px-2.5 pt-3 pb-1 text-2xs text-ink-3">{g}</div>}
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
    const target = e.currentTarget;
    requestAnimationFrame(() => target.querySelector<HTMLElement>(`[data-mode="${next.id}"]`)?.focus());
  };
  return (
    <div role="tablist" aria-label="Workspace mode" onKeyDown={onKey}
      className={cx("no-drag shrink-0 gap-0.5 p-[3px] rounded-md bg-active", collapsed ? "flex flex-col mx-3 mt-2" : "flex mx-3 mt-2")}>
      {MODES.map((m) => {
        const on = mode === m.id;
        return (
          <button key={m.id} data-mode={m.id} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} aria-label={m.label} title={collapsed ? m.label : undefined}
            onClick={() => switchMode(m.id)}
            className={cx("flex-1 h-7 flex items-center justify-center gap-1.5 rounded-[6px] text-sm font-medium transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease)]",
              collapsed && "!h-10 !flex-none",
              on ? "bg-surface text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:text-ink")}>
            <m.icon size={15} strokeWidth={1.7} />
            {!collapsed && <span>{m.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

const GROUPS_KEY = "atlas_project_groups";
const CHAT_PREVIEW = 6;

function ProjectList() {
  const { route, go, settings } = useStore();
  const { add, adding } = useAddProject();
  const { data: list = [], loading } = useApi<Project[]>("/projects", ["project"]);
  const { data: conversations = [] } = useApi<Conversation[]>("/conversations", ["conversation"]);
  const { busy, run } = useAction();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}"); } catch { return {}; }
  });
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  useEffect(() => { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(expanded)); } catch { /* storage unavailable */ } }, [expanded]);
  const projects = useMemo(() => settings?.["projects.sort"] === "added" ? list : [...list].sort((a, b) => a.name.localeCompare(b.name)), [list, settings]);
  const chatsByProject = useMemo(() => {
    const map: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      const id = c.config?.project_id;
      if (id) (map[id] ||= []).push(c);
    }
    for (const id of Object.keys(map)) map[id].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    return map;
  }, [conversations]);
  const current = route.name === "projects" ? route.id : undefined;
  const openChatId = route.name === "chat" ? route.id : undefined;
  // Opening a chat reveals it inside its project group.
  useEffect(() => {
    if (!openChatId) return;
    const project = conversations.find((c) => c.id === openChatId)?.config?.project_id;
    if (project) setExpanded((value) => value[project] ? value : { ...value, [project]: true });
  }, [openChatId, conversations]);
  const withChats = projects.filter((p) => (chatsByProject[p.id] || []).length > 0);
  const allOpen = withChats.length > 0 && withChats.every((p) => expanded[p.id]);
  const toggle = (id: string) => setExpanded((value) => ({ ...value, [id]: !value[id] }));
  const toggleAll = () => setExpanded(Object.fromEntries(projects.map((p) => [p.id, !allOpen])));
  const newChat = (project: Project) => run(`chat:${project.id}`, async () => {
    const draft = loadDraft();
    const config = { ...draft, project_id: project.id, tools: Array.from(new Set([...(draft.tools || []), "project"])) };
    const chat = await api<Conversation>("/conversations", { body: { config } });
    setExpanded((value) => ({ ...value, [project.id]: true }));
    go({ name: "chat", id: chat.id });
  });
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center h-7 pl-2.5 pr-0.5 shrink-0">
        <span className="flex-1 text-2xs font-semibold text-ink-3">Projects{projects.length > 0 && <span className="ml-1.5 font-normal">{projects.length}</span>}</span>
        {withChats.length > 0 && <button onClick={toggleAll} aria-label={allOpen ? "Collapse all projects" : "Expand all projects"} title={allOpen ? "Collapse all" : "Expand all"}
          className="h-7 w-7 flex items-center justify-center rounded-sm text-ink-2 hover:text-ink hover:bg-hover no-drag"><ChevronsUpDown size={14} strokeWidth={1.6} /></button>}
        <button onClick={add} disabled={adding} aria-label="Add project" title="Add project"
          className="h-7 w-7 flex items-center justify-center rounded-sm text-ink-2 hover:text-ink hover:bg-hover disabled:opacity-45 no-drag"><FolderPlus size={15} strokeWidth={1.6} /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {!loading && projects.length === 0 && (
          <div className="px-2.5 py-1.5 text-xs text-ink-3">No projects yet. Add a folder to get started.</div>
        )}
        <div className="flex flex-col gap-0.5">
          {projects.map((p) => {
            const active = p.id === current;
            const Icon = p.is_repo ? FolderGit2 : Folder;
            const chats = chatsByProject[p.id] || [];
            const isOpen = !!expanded[p.id];
            const visible = showAll[p.id] ? chats : chats.slice(0, CHAT_PREVIEW);
            const creating = busy === `chat:${p.id}`;
            return (
              <section key={p.id} className="min-w-0">
                <div className={cx("group flex items-center rounded-md", active ? "bg-selected" : "hover:bg-hover")}>
                  <button onClick={() => toggle(p.id)} aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`} aria-expanded={isOpen}
                    className="h-8 w-6 ml-0.5 shrink-0 flex items-center justify-center rounded-sm text-ink-3 hover:text-ink no-drag"><ChevronRight size={14} className={cx("transition-transform duration-150", isOpen && "rotate-90")} /></button>
                  <button onClick={() => { go({ name: "projects", id: p.id }); setExpanded((v) => v[p.id] ? v : { ...v, [p.id]: true }); }} aria-current={active ? "page" : undefined} title={p.path}
                    className="flex-1 min-w-0 flex items-center gap-2 h-8 pr-1.5 rounded-md text-sm text-left text-ink no-drag">
                    <Icon size={15} strokeWidth={1.6} className={cx("shrink-0", !p.exists ? "text-bad" : "text-ink-2")} />
                    <span className="truncate">{p.name}</span>
                  </button>
                  {chats.length > 0 && <span className="shrink-0 px-1.5 text-2xs text-ink-3 tabular-nums group-hover:hidden group-focus-within:hidden">{chats.length}</span>}
                  <button onClick={() => void newChat(p)} disabled={!p.exists || creating} aria-label={`New chat in ${p.name}`} title={`New chat in ${p.name}`}
                    className="h-7 w-7 mr-0.5 shrink-0 hidden group-hover:flex group-focus-within:flex items-center justify-center rounded-sm text-ink-3 hover:text-ink hover:bg-active disabled:opacity-40 no-drag"><Plus size={14} /></button>
                </div>
                {isOpen && (
                  <div className="ml-[23px] pl-[10px] border-l border-line mt-0.5 mb-1 flex flex-col gap-0.5">
                    {visible.map((chat) => {
                      const on = openChatId === chat.id;
                      return <button key={chat.id} onClick={() => go({ name: "chat", id: chat.id })} title={chat.title}
                        aria-current={on ? "page" : undefined}
                        className={cx("h-7 min-w-0 px-2 rounded-sm text-left text-xs truncate no-drag", on ? "bg-selected text-ink" : "text-ink-2 hover:text-ink hover:bg-hover")}>{chat.title || "Untitled chat"}</button>;
                    })}
                    {chats.length > CHAT_PREVIEW && <button onClick={() => setShowAll((v) => ({ ...v, [p.id]: !v[p.id] }))}
                      className="h-6 px-2 rounded-sm text-left text-xs text-ink-3 hover:text-ink hover:bg-hover no-drag">{showAll[p.id] ? "Show less" : `Show all ${chats.length}`}</button>}
                    {chats.length === 0 && <button onClick={() => void newChat(p)} disabled={!p.exists || creating}
                      className="h-6 px-2 rounded-sm text-left text-xs text-ink-3 hover:text-ink hover:bg-hover disabled:opacity-40 no-drag">No chats · New chat</button>}
                  </div>
                )}
              </section>
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
  return (
    <aside data-collapsed={collapsed} aria-label="Sidebar" id="atlas-sidebar"
      className="atlas-sidebar h-full shrink-0 flex flex-col bg-[var(--sidebar)] border-r border-line">
      {/* traffic lights sit in this strip */}
      <div className="drag h-[44px] shrink-0" />
      <div className={cx("shrink-0 flex items-center h-12", collapsed ? "justify-center" : "pl-[18px] pr-3 gap-2")}>
        {!collapsed && <button onClick={() => go({ name: "chat" })} className="flex-1 min-w-0 text-left no-drag sidebar-label" aria-label="Atlas home"><AtlasWordmark /></button>}
        <button onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="atlas-sidebar-content" title={`${collapsed ? "Expand" : "Collapse"} sidebar  ⌘B`}
          className="sidebar-toggle h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-ink-2 hover:text-ink hover:bg-hover no-drag">
          {collapsed ? <PanelLeftOpen size={19} strokeWidth={1.7} /> : <PanelLeftClose size={19} strokeWidth={1.7} />}
        </button>
      </div>
      <div className={cx("shrink-0 mt-1", collapsed ? "px-3" : "px-3")}>
        <button onClick={() => go({ name: "chat" })} aria-label="New chat" title={collapsed ? "New chat  ⌘N" : undefined}
          className={cx("sidebar-nav-item flex items-center gap-2.5 rounded-lg text-ink hover:bg-hover no-drag", collapsed ? "h-11 w-11 mx-auto justify-center" : "h-10 w-full px-3")}>
          <SquarePlus size={collapsed ? 20 : 17} strokeWidth={1.7} />{!collapsed && <span className="sidebar-label text-sm">New chat</span>}
        </button>
      </div>
      <ModeSwitch collapsed={collapsed} />
      <nav aria-label="Primary" className={cx("shrink-0 flex flex-col gap-1 px-3 pt-5 pb-4")}>
        {NAV.map((n) => <NavItem key={n.id} active={n.match.includes(route.name)} collapsed={collapsed} icon={n.icon} label={n.label}
          badge={n.id === "tasks" ? pending : undefined} onClick={() => go({ name: n.id })} />)}
      </nav>
      <div id="atlas-sidebar-content" className={cx("min-h-0 flex-1 flex flex-col", !collapsed && "mx-3 pt-2")}>
        {!collapsed && <div className="sidebar-label min-h-0 flex-1 flex flex-col">{mode === "chat" ? <ChatHistory /> : <ProjectList />}</div>}
      </div>
      <div className="shrink-0 px-3 pt-3 pb-3 border-t border-line space-y-2">
        <NavItem active={settingsOpen} collapsed={collapsed} icon={Settings} label="Settings" onClick={() => go({ name: "settings" })} />
        <ProfileCard name={name} collapsed={collapsed} />
      </div>
    </aside>
  );
}
