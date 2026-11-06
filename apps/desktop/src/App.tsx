import React, { Suspense, lazy, useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { TOKEN, useApi, useConnected } from "./api";
import { matches, useStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { Inspector } from "./components/Inspector";
import { CommandPalette, NewTaskModal } from "./components/Dialogs";
import { cx } from "./components/ui";
import { Chat } from "./views/Chat";
import { LEGAL_VERSION, Welcome } from "./components/Welcome";
import { Splash, ViewLoading } from "./components/LoadingScreen";
import { ModelDownloads } from "./components/ModelDownloads";

const Teams = lazy(() => import("./views/Teams").then((m) => ({ default: m.Teams })));
const TeamDetail = lazy(() => import("./views/TeamDetail").then((m) => ({ default: m.TeamDetail })));
const Agents = lazy(() => import("./views/Agents").then((m) => ({ default: m.Agents })));
const Tasks = lazy(() => import("./views/Tasks").then((m) => ({ default: m.Tasks })));
const WorkHome = lazy(() => import("./views/WorkHome").then((m) => ({ default: m.WorkHome })));
const Projects = lazy(() => import("./views/Projects").then((m) => ({ default: m.Projects })));
const Models = lazy(() => import("./views/Models").then((m) => ({ default: m.Models })));
const Activity = lazy(() => import("./views/Activity").then((m) => ({ default: m.Activity })));
const Settings = lazy(() => import("./views/Settings").then((m) => ({ default: m.Settings })));

export function App() {
  const store = useStore();
  const { route, go, settings } = store;
  const connected = useConnected();
  const [splash, setSplash] = useState(() => !localStorage.getItem("atlas_welcome_seen") || localStorage.getItem("atlas_launch_animation") !== "0");
  const { data: meta } = useApi<any>("/meta", ["settings"]);
  const { data: approvals = [] } = useApi<any[]>("/approvals", ["approval", "task"]);

  useEffect(() => {
    const sc = settings?.shortcuts || {};
    const h = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement)?.tagName || "");
      if (matches(e, sc.palette)) { e.preventDefault(); store.setPaletteOpen(!store.paletteOpen); return; }
      if (matches(e, sc.new_task)) { e.preventDefault(); go({ name: "chat" }); return; }
      if (matches(e, sc.toggle_sidebar)) { e.preventDefault(); store.toggleSidebar(); return; }
      if (matches(e, sc.settings)) { e.preventDefault(); go({ name: "settings" }); return; }
      if (matches(e, sc.overview)) { e.preventDefault(); go({ name: "chat" }); return; }
      if (matches(e, sc.teams)) { e.preventDefault(); go({ name: "teams" }); return; }
      if (matches(e, sc.agents)) { e.preventDefault(); go({ name: "agents" }); return; }
      if (e.key === "Escape" && !typing && store.selection) store.select(null);
      if ((e.metaKey || e.ctrlKey) && e.key === "[") { e.preventDefault(); store.back(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [settings, store.paletteOpen, store.selection, route]);

  if (!TOKEN) {
    return <div className="h-full flex items-center justify-center text-ink-2 bg-bg">Open Atlas from the app to connect to its local backend.</div>;
  }
  const view = (() => {
    switch (route.name) {
      case "teams": return <Teams />;
      case "team": return route.id ? <TeamDetail key={route.id} id={route.id} /> : <Teams />;
      case "agents": return <Agents />;
      case "tasks": return <Tasks />;
      case "projects": return route.id ? <Projects /> : <WorkHome />;
      case "models": return <Models />;
      case "activity": return <Activity />;
      default: return null;
    }
  })();
  // Pages that share one sidebar entry get a small section switch.
  const sections: { id: string; label: string }[] | null =
    ["agents", "teams"].includes(route.name) ? [{ id: "agents", label: "Agents" }, { id: "teams", label: "Teams" }] :
    ["tasks", "activity"].includes(route.name) ? [{ id: "tasks", label: "Runs" }, { id: "activity", label: "Activity" }] : null;
  const isChat = route.name === "chat" || route.name === "overview";
  return (
    <div className="h-full flex overflow-hidden bg-[var(--base)]">
      <div className="contents" inert={splash}>
      <Sidebar pending={approvals.length} user={meta?.user} />
      <main className="relative flex-1 min-w-0 h-full flex">
        {isChat ? <Chat /> : (
          <div className="relative flex-1 min-w-0 h-full flex flex-col">
            <header className="drag h-[68px] shrink-0 flex items-center gap-3 px-10 pt-2">
              {sections && (
                <div role="tablist" className="no-drag flex items-center gap-1 p-1 rounded-md border border-line">
                  {sections.map((x) => (
                    <button key={x.id} role="tab" aria-selected={route.name === x.id} onClick={() => go({ name: x.id as any })}
                      className={cx("h-7 px-3 rounded-sm text-sm", route.name === x.id ? "bg-selected text-ink" : "text-ink-2 hover:text-ink")}>{x.label}</button>
                  ))}
                </div>
              )}
              <div className="flex-1" />
              {approvals.length > 0 && (
                <button onClick={() => go({ name: "tasks", tab: "approvals" })}
                  className="no-drag h-8 px-3 rounded-md border border-line text-sm text-ink hover:bg-hover flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" />{approvals.length} awaiting approval</button>
              )}
            </header>
            <div className="flex-1 overflow-y-auto px-10 max-[760px]:px-6 pb-12 pt-6" key={route.name + (route.id || "")}>
              <div className={cx("fade-in", route.name === "projects" && !route.id && "h-full")}><Suspense fallback={<ViewLoading />}>{view}</Suspense></div>
            </div>
          </div>
        )}
        {!isChat && <Inspector />}
        {!connected && (
          <div role="status" className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 h-8 px-3 rounded-md bg-surface border border-line flex items-center gap-2 text-sm text-ink">
            <WifiOff size={13} className="text-bad" />Reconnecting to the local backend…</div>
        )}
        <ModelDownloads />
      </main>
      {store.settingsOpen && <Suspense fallback={null}><Settings /></Suspense>}
      <NewTaskModal />
      <CommandPalette />
      {settings && (!settings["onboarding.completed"] || settings["legal.acknowledged"] !== LEGAL_VERSION) && <Welcome />}
      </div>
      {splash && <Splash ready={Boolean(settings && meta)} onFinish={() => setSplash(false)} />}
    </div>
  );
}
