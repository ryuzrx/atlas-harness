// Typed API client + WebSocket stream for the ATLAS backend.
import { useCallback, useEffect, useRef, useState } from "react";

export type Status =
  | "queued" | "planning" | "ready" | "running" | "blocked" | "waiting_approval"
  | "reviewing" | "completed" | "failed" | "cancelled";

export interface Provider {
  id: string; kind: string; kind_label: string; name: string; base_url?: string; enabled: number;
  status: string; last_error?: string; config: Record<string, any>; agentic: boolean;
  stats?: { active_requests: number; total_requests: number; errors: number; last_latency_ms?: number } | null;
}
export interface Model {
  name: string | null; provider_id: string; provider_name: string; provider_kind: string; size_bytes?: number;
  provider_preset_id?: string;
  context_length?: number; capabilities?: Record<string, any>; details?: Record<string, any>; state: string;
  error?: string; assigned_agents?: string[];
}
export interface Agent {
  id: string; team_id?: string; name: string; role: string; instructions: string; provider_id?: string; model?: string;
  params: Record<string, any>; tools: string[]; config: Record<string, any>; status: string; team_name?: string;
  provider_name?: string; provider_kind?: string; current_task?: { id: string; title: string; status: Status } | null;
  last_activity?: number; is_lead?: boolean; updated_at: number;
}
export interface Team {
  id: string; name: string; description: string; objective: string; lead_agent_id?: string; project_id?: string;
  archived: number; agents: { id: string; name: string; role: string; status: string; model?: string }[];
  agent_count: number; active_tasks: number; last_activity?: number; status: string; running_agents: number;
  current?: { id: string; title: string; status: Status } | null; config: Record<string, any>; updated_at: number;
}
export interface Task {
  id: string; parent_id?: string; team_id?: string; agent_id?: string; project_id?: string; title: string;
  description: string; kind: string; priority: number; acceptance: string[]; status: Status; deps: string[];
  result?: string; artifacts: Record<string, any>; evidence: Record<string, any>; worktree?: string; branch?: string;
  attempts: number; error?: string; created_at: number; updated_at: number; started_at?: number; finished_at?: number;
  agent_name?: string; agent_model?: string; team_name?: string; needs_approval?: number;
  transitions?: { from_status: string; to_status: string; reason: string; at: number }[];
  children?: Task[]; approvals?: Approval[]; messages?: Message[];
}
export interface Approval {
  id: string; task_id: string; agent_id?: string; kind: string; payload: Record<string, any>; status: string;
  created_at: number; task_title?: string; agent_name?: string;
}
export interface Message { id: string; type: string; sender_agent_id?: string; recipient_agent_id?: string; body: any; at: number }
export interface AtlasEvent {
  id?: number; type: string; data: Record<string, any>; task_id?: string; team_id?: string; agent_id?: string; at: number;
}
export interface Project { id: string; name: string; path: string; workspace: string; exists: boolean; is_repo: boolean }

function readToken(): string {
  const m = location.hash.match(/token=([^&]+)/);
  if (m) {
    sessionStorage.setItem("atlas_token", decodeURIComponent(m[1]));
    // keep any route part (#/chat/<id>) so deep links survive; drop only the token
    const rest = location.hash.replace(/[?&]?token=[^&]+/, "").replace(/^#&/, "#");
    history.replaceState(null, "", location.pathname + (rest.length > 1 ? rest : ""));
  }
  return sessionStorage.getItem("atlas_token") || (import.meta as any).env?.VITE_ATLAS_TOKEN || "";
}
export const TOKEN = readToken();

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers: { "x-atlas-token": TOKEN, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch { /* not json */ }
    throw new ApiError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return res.json();
}

// ---- WebSocket hub ---------------------------------------------------------
type Listener = (msg: any) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let connected = false;
const connListeners = new Set<(c: boolean) => void>();

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/api/ws?token=${encodeURIComponent(TOKEN)}`);
  socket.onopen = () => { connected = true; connListeners.forEach((l) => l(true)); listeners.forEach((l) => l({ kind: "changed", entity: "*" })); };
  socket.onmessage = (e) => {
    const batch = JSON.parse(e.data);
    for (const m of Array.isArray(batch) ? batch : [batch]) listeners.forEach((l) => l(m));
  };
  socket.onclose = () => { connected = false; connListeners.forEach((l) => l(false)); setTimeout(connect, 1500); };
}
if (TOKEN) connect();

export function subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useConnected() {
  const [c, setC] = useState(connected);
  useEffect(() => { connListeners.add(setC); setC(connected); return () => { connListeners.delete(setC); }; }, []);
  return c;
}

/** Fetch `path`; refetch when the backend reports changes to any of `entities`. */
export function useApi<T = any>(path: string | null, entities: string[] = [], pollMs = 0) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(null); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => {
    if (!entities.length) return;
    return subscribe((m) => {
      if (m.kind === "changed" && (m.entity === "*" || entities.includes(m.entity))) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(load, 120);
      }
    });
  }, [load, entities.join(",")]);
  useEffect(() => {
    if (!pollMs) return;
    const h = window.setInterval(() => { if (!document.hidden) load(); }, pollMs);
    return () => window.clearInterval(h);
  }, [load, pollMs]);
  return { data, error, loading, reload: load, setData };
}

// ---- native shell bridge (WKWebView); graceful fallback in a browser ---------
const pending = new Map<string, (v: any) => void>();
(window as any).__atlasNative = (id: string, value: any) => { pending.get(id)?.(value); pending.delete(id); };
const bridge = () => (window as any).webkit?.messageHandlers?.atlas;
export const isNative = () => !!bridge();

export function nativeCall<T = any>(type: string, payload: any = {}): Promise<T | null> {
  const b = bridge();
  if (!b) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => { pending.set(id, resolve); b.postMessage({ id, type, ...payload }); });
}

export async function pickFolder(options?: { prompt?: string; message?: string }): Promise<string | null> {
  if (isNative()) return nativeCall<string>("pickFolder", options || {});
  return window.prompt(options?.message || "Absolute path to the project folder:");
}

export function notify(title: string, body: string) {
  if (isNative()) nativeCall("notify", { title, body });
}

/** Open an http(s) link in the default browser (never inside the app window). */
export function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (isNative()) nativeCall("openURL", { url }); else window.open(url, "_blank", "noopener,noreferrer");
}

export function openPath(path: string) {
  if (isNative()) nativeCall("reveal", { path });
}

// ---- formatting --------------------------------------------------------------
export function ago(ts?: number | null) {
  if (!ts) return "—";
  const s = Date.now() / 1000 - ts;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}
export function bytes(n?: number | null) {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export function dur(a?: number | null, b?: number | null) {
  if (!a) return "—";
  const s = Math.max(0, (b || Date.now() / 1000) - a);
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}
export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued", planning: "Planning", ready: "Ready", running: "Running", blocked: "Blocked",
  waiting_approval: "Needs approval", reviewing: "Reviewing", completed: "Completed", failed: "Failed",
  cancelled: "Cancelled", idle: "Idle", active: "Active", paused: "Paused", waiting: "Waiting", archived: "Archived",
  connected: "Connected", unavailable: "Unavailable", unknown: "Not checked", installed: "Installed",
  available: "Available", loaded: "Loaded", processing: "Processing",
};
