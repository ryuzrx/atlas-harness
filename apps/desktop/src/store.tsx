import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, notify, subscribe, useApi } from "./api";
import { paletteTokens, resolvePalette } from "./theme";

export type RouteName = "chat" | "overview" | "teams" | "team" | "agents" | "tasks" | "projects" | "models" | "activity" | "settings";
export interface Route { name: RouteName; id?: string; tab?: string }
export interface Selection { kind: "agent" | "task"; id: string }

interface Store {
  route: Route; go: (r: Route) => void; back: () => void;
  selection: Selection | null; select: (s: Selection | null) => void;
  sidebarCollapsed: boolean; toggleSidebar: () => void;
  newTaskOpen: boolean; setNewTaskOpen: (v: boolean, preset?: { teamId?: string }) => void; newTaskPreset: { teamId?: string };
  paletteOpen: boolean; setPaletteOpen: (v: boolean) => void;
  settings: Record<string, any> | undefined; saveSettings: (patch: Record<string, any>) => Promise<void>;
  activeWorkspace: string; setActiveWorkspace: (w: string) => void;
  /** Chat / Work. Derived from the route; shared pages (Models, Agents, Runs…) keep the last one. */
  mode: Mode; switchMode: (m: Mode) => void;
  /** Settings is an overlay on top of the current page, not a route. */
  settingsOpen: boolean; setSettingsOpen: (v: boolean) => void;
}
export type Mode = "chat" | "work";

const Ctx = createContext<Store>(null as any);
export const useStore = () => useContext(Ctx);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // Chat is home. Older saved routes (overview) open chat; other pages are restored as-is.
  const [route, setRoute] = useState<Route>(() => {
    const deep = parseHash();
    if (deep) return deep.name === "settings" ? { name: "chat" } : deep;
    try {
      const r = JSON.parse(localStorage.getItem("atlas_route") || '{"name":"chat"}');
      if (!r || !ROUTES.includes(r.name) || (r.id !== undefined && typeof r.id !== "string")) return { name: "chat" };
      return r.name === "overview" || r.name === "settings" ? { name: "chat" } : r;
    } catch {
      return { name: "chat" };
    }
  });
  // keep the URL in sync so any screen can be linked to (#/chat/<id>, #/models, ...)
  useEffect(() => {
    const h = "#/" + route.name + (route.id ? "/" + route.id : "");
    if (location.hash !== h) window.history.replaceState(null, "", location.pathname + h);
  }, [route]);
  const [history, setHistory] = useState<Route[]>([]);
  const [selection, select] = useState<Selection | null>(null);
  const [sidebarCollapsed, setCollapsed] = useState(() => localStorage.getItem("atlas_sidebar") === "1");
  const [newTaskOpen, setNTO] = useState(false);
  const [newTaskPreset, setPreset] = useState<{ teamId?: string }>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeWorkspace, setWS] = useState(() => localStorage.getItem("atlas_ws") || "Default");
  const { data: settings, setData } = useApi<Record<string, any>>("/settings", ["settings"]);

  const { data: convList } = useApi<{ id: string; config?: Record<string, any> }[]>("/conversations", ["conversation"]);
  const [lastMode, setLastMode] = useState<Mode>(() => (localStorage.getItem("atlas_mode") === "work" ? "work" : "chat"));
  // A chat that belongs to a project is part of Work: opening it must not flip the sidebar to Chat.
  const openChat = route.name === "chat" && route.id ? convList?.find((c) => c.id === route.id) : undefined;
  const isProjectChat = !!openChat?.config?.project_id;
  const routeMode: Mode | null = route.name === "chat"
    ? (route.id && !openChat ? lastMode : isProjectChat ? "work" : "chat")
    : route.name === "overview" ? "chat" : route.name === "projects" ? "work" : null;
  const mode: Mode = routeMode || lastMode;
  useEffect(() => {
    if (routeMode) { setLastMode(routeMode); localStorage.setItem("atlas_mode", routeMode); }
    // remember where each mode was so switching back returns there
    if (route.name === "chat") {
      if (!route.id) localStorage.removeItem("atlas_last_chat");
      else if (openChat && !isProjectChat) localStorage.setItem("atlas_last_chat", route.id);
      else if (isProjectChat) localStorage.setItem("atlas_last_project_chat", route.id);
    }
    if (route.name === "projects" && route.id) localStorage.setItem("atlas_last_project", route.id);
  }, [route.name, route.id, routeMode, isProjectChat]);
  // optional launch view: open Chat or Work instead of wherever you left off (never overrides a deep link)
  const launched = useRef(!!parseHash());
  useEffect(() => {
    if (launched.current || !settings) return;
    launched.current = true;
    const lv = settings["general.launch_view"];
    if ((lv === "chat" || lv === "work") && lv !== mode) switchMode(lv);
  }, [settings]);
  const switchMode = (m: Mode) => {
    if (m === mode && routeMode === m) return;
    if (m === "chat") go({ name: "chat", id: localStorage.getItem("atlas_last_chat") || undefined });
    else go({ name: "projects" });
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  const go = (r0: Route) => {
    if (r0.name === "settings") { setSettingsOpen(true); return; }
    setSettingsOpen(false);
    const r: Route = r0.name === "overview" ? { name: "chat" } : r0; setHistory((h) => [...h.slice(-20), route]); setRoute(r); select(null); localStorage.setItem("atlas_route", JSON.stringify(r)); };
  const back = () => setHistory((h) => { const prev = h[h.length - 1]; if (prev) setRoute(prev); return h.slice(0, -1); });
  const toggleSidebar = () => setCollapsed((c) => { localStorage.setItem("atlas_sidebar", c ? "0" : "1"); return !c; });
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());
  const saveSettings = (patch: Record<string, any>): Promise<void> => {
    const next = settingsQueue.current.catch(() => {}).then(async () => {
      setData(await api("/settings", { method: "PUT", body: patch }));
    });
    settingsQueue.current = next;
    return next;
  };
  const setActiveWorkspace = (w: string) => { setWS(w); localStorage.setItem("atlas_ws", w); };

  useEffect(() => {
    if (settings) localStorage.setItem("atlas_launch_animation", settings["general.launch_animation"] === false ? "0" : "1");
  }, [settings?.["general.launch_animation"]]);

  // theme + motion
  useEffect(() => {
    const apply = () => {
      const pref = settings?.["general.theme"] || "dark";
      const dark = pref !== "light";   // Light or Dark only; anything else (old "system") is Dark
      const root = document.documentElement, next = dark ? "dark" : "light";
      if (root.dataset.theme !== next) {
        root.classList.add("theme-switching");  // no colour transitions mid-switch
        root.dataset.theme = next;
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
      }
      const mode = dark ? "dark" : "light";
      const palette = resolvePalette("atlas-mono", [], mode);   // one palette: black and white, no accent colour
      for (const [token, value] of Object.entries(paletteTokens(palette.roles, mode, { neutralPrimary: true }))) root.style.setProperty(token, value);
      root.style.setProperty("--chat-font", ({ small: "13px", large: "16px" } as Record<string, string>)[settings?.["chat.font_size"]] || "14px");
      document.documentElement.classList.toggle("reduce-motion", !!settings?.["general.reduce_motion"]);
      const scale = Number(settings?.["general.ui_scale"]) || 1;
      const clamped = Math.min(1.3, Math.max(0.8, scale));
      const bridge = (window as any).webkit?.messageHandlers?.atlas;
      const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
      if (bridge && rgb && rgb.length >= 3) bridge.postMessage({ type: "chrome", color: rgb.slice(0, 3).map(Number) });
      // In the Mac app, scale natively (WKWebView page zoom): every length, vh unit and fixed
      // layer scales together. CSS zoom is only the fallback for the plain browser build.
      if (bridge) { bridge.postMessage({ type: "pageZoom", value: clamped }); root.style.removeProperty("zoom"); }
      else (root.style as any).zoom = String(clamped);
    };
    apply();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings]);

  // native notifications from backend
  useEffect(() => subscribe((m) => {
    if (m.kind === "notify" && settings?.["general.notifications"] !== false && (!document.hasFocus() || settings?.["general.notify_when_focused"])) notify(m.title, m.body);
  }), [settings]);

  const value = useMemo<Store>(() => ({
    route, go, back, selection, select, sidebarCollapsed, toggleSidebar,
    newTaskOpen, newTaskPreset, setNewTaskOpen: (v, p) => { setPreset(p || {}); setNTO(v); },
    paletteOpen, setPaletteOpen, settings, saveSettings, activeWorkspace, setActiveWorkspace, mode, switchMode, settingsOpen, setSettingsOpen,
  }), [settingsOpen, mode, route, selection, sidebarCollapsed, newTaskOpen, newTaskPreset, paletteOpen, settings, activeWorkspace, history]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const ROUTES: RouteName[] = ["chat", "overview", "teams", "team", "agents", "tasks", "projects", "models", "activity", "settings"];
function parseHash(): Route | null {
  const m = location.hash.match(/^#\/([a-z]+)(?:\/([\w-]+))?/);
  if (!m || !ROUTES.includes(m[1] as RouteName)) return null;
  return { name: (m[1] === "overview" ? "chat" : m[1]) as RouteName, id: m[2] };
}

/** Match a keyboard event to a shortcut string like "mod+k" or "mod+,". */
export function matches(e: KeyboardEvent, combo?: string) {
  if (!combo) return false;
  const parts = combo.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const mod = parts.includes("mod");
  const shift = parts.includes("shift");
  const alt = parts.includes("alt");
  return (mod ? e.metaKey || e.ctrlKey : !(e.metaKey || e.ctrlKey)) && e.shiftKey === shift && e.altKey === alt &&
    e.key.toLowerCase() === key;
}
