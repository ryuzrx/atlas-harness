import React, { useState } from "react";
import { FolderOpen, Pencil, Plug, Plus, Search, Trash2, X } from "lucide-react";
import { openExternal, pickFolder } from "../api";
import { Badge, Button, Field, Input, Modal, TextArea, Toggle, cx, useToast } from "./ui";
import { IntegrationMark } from "./IntegrationIcon";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  [key: string]: any;
}

export interface McpServerStatus {
  name: string;
  running: boolean;
  tools: number;
  error?: string | null;
}

/** A plain-language question asked when connecting: Atlas turns the answers into the technical setup. */
export interface SetupField { label: string; kind: "folder" | "secret" | "text"; env?: string; help?: string; link?: string; placeholder?: string }

export interface PopularIntegration {
  setup?: SetupField[];
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Common stdio servers used as starting points. Nothing is started until the user saves. */
export const POPULAR_INTEGRATIONS: PopularIntegration[] = [
  { name: "Filesystem", description: "Read and edit files in a chosen folder", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"], setup: [{ label: "Which folder can Atlas use?", kind: "folder" }] },
  { name: "GitHub", description: "Issues, pull requests and repositories", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" }, setup: [{ label: "GitHub access token", kind: "secret", env: "GITHUB_PERSONAL_ACCESS_TOKEN", link: "https://github.com/settings/tokens", help: "Create a token on GitHub and paste it here." }] },
  { name: "Slack", description: "Channels, messages and threads", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" }, setup: [{ label: "Slack bot token", kind: "secret", env: "SLACK_BOT_TOKEN", help: "Starts with xoxb-" }, { label: "Slack team ID", kind: "text", env: "SLACK_TEAM_ID", placeholder: "T0123456789" }] },
  { name: "Notion", description: "Pages, databases and search", command: "npx", args: ["-y", "@notionhq/notion-mcp-server"], env: { NOTION_TOKEN: "" }, setup: [{ label: "Notion integration token", kind: "secret", env: "NOTION_TOKEN", link: "https://www.notion.so/profile/integrations" }] },
  { name: "Linear", description: "Issues and project tracking", command: "npx", args: ["-y", "mcp-remote", "https://mcp.linear.app/sse"] },
  { name: "Sentry", description: "Errors, issues and releases", command: "npx", args: ["-y", "@sentry/mcp-server"], env: { SENTRY_AUTH_TOKEN: "" }, setup: [{ label: "Sentry auth token", kind: "secret", env: "SENTRY_AUTH_TOKEN", link: "https://sentry.io/settings/account/api/auth-tokens/" }] },
  { name: "Postgres", description: "Query a PostgreSQL database", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"], setup: [{ label: "Database address", kind: "text", placeholder: "postgresql://localhost/mydb", help: "Where your database lives." }] },
  { name: "Google Drive", description: "Search and read Drive files", command: "npx", args: ["-y", "@modelcontextprotocol/server-gdrive"], env: { GDRIVE_CREDENTIALS: "" }, setup: [{ label: "Path to your Google credentials file", kind: "text", env: "GDRIVE_CREDENTIALS" }] },
  { name: "Memory", description: "Persistent notes across sessions", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
  { name: "Brave Search", description: "Web and local search", command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"], env: { BRAVE_API_KEY: "" }, setup: [{ label: "Brave Search API key", kind: "secret", env: "BRAVE_API_KEY", link: "https://brave.com/search/api/" }] },
  { name: "Puppeteer", description: "Browse and interact with web pages", command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"] },
  { name: "Figma", description: "Read design files and components", command: "npx", args: ["-y", "figma-developer-mcp", "--stdio"], env: { FIGMA_API_KEY: "" }, setup: [{ label: "Figma access token", kind: "secret", env: "FIGMA_API_KEY", link: "https://www.figma.com/settings" }] },
];

function commandLine(server: McpServerConfig) {
  return [server.command, ...(server.args || [])].filter(Boolean).join(" ");
}

interface ServerDraft {
  index: number | null;
  name: string;
  command: string;
  argsText: string;
  env: { key: string; value: string }[];
  enabled: boolean;
}

function draftFor(server: McpServerConfig, index: number): ServerDraft {
  return {
    index,
    name: server.name,
    command: server.command,
    argsText: (server.args || []).join("\n"),
    env: Object.entries(server.env || {}).map(([key, value]) => ({ key, value: String(value) })),
    enabled: server.enabled !== false,
  };
}

function draftForPopular(server: PopularIntegration): ServerDraft {
  return {
    index: null,
    name: server.name,
    command: server.command,
    argsText: server.args.join("\n"),
    env: Object.entries(server.env || {}).map(([key, value]) => ({ key, value })),
    enabled: true,
  };
}

function emptyDraft(): ServerDraft {
  return { index: null, name: "", command: "", argsText: "", env: [], enabled: true };
}

function IconAction({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cx("h-7 w-7 flex items-center justify-center rounded-sm no-drag", danger ? "text-ink-2 hover:text-bad hover:bg-bad-bg" : "text-ink-2 hover:text-ink hover:bg-hover")}>
      {children}
    </button>
  );
}

/** Friendly connect form: asks only what a person can answer, hides commands and arguments. */
function SimpleConnect({ item, busy, onCancel, onConnect }: { item: PopularIntegration | null; busy: boolean; onCancel: () => void; onConnect: (values: string[]) => void }) {
  const [values, setValues] = useState<string[]>([]);
  React.useEffect(() => setValues([]), [item?.name]);
  if (!item) return null;
  const fields = item.setup || [];
  const ready = fields.every((_, i) => (values[i] || "").trim());
  const set = (i: number, v: string) => setValues((cur) => { const n = [...cur]; n[i] = v; return n; });
  return (
    <Modal open onClose={() => !busy && onCancel()} title={`Connect ${item.name}`} width={480}
      footer={<><Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant="primary" busy={busy} disabled={!ready} onClick={() => onConnect(values)}>Connect</Button></>}>
      <div className="space-y-4">
        <p className="text-base text-ink-2">{item.description}. Atlas will always ask before it uses {item.name}.</p>
        {fields.map((f, i) => (
          <Field key={i} label={f.label} hint={<>{f.help}{f.link && <>{f.help ? " " : ""}<button type="button" className="underline underline-offset-2 hover:text-ink" onClick={() => openExternal(f.link!)}>Get one here</button></>}</>}>
            {f.kind === "folder" ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 h-9 px-3 rounded-md border border-line flex items-center text-sm text-ink-2 truncate">{values[i] || "No folder chosen"}</div>
                <Button icon={<FolderOpen size={14} />} onClick={async () => { const p = await pickFolder({ prompt: "Use Folder" }); if (p) set(i, p); }}>Choose…</Button>
              </div>
            ) : <Input autoFocus={i === 0} type={f.kind === "secret" ? "password" : "text"} autoComplete="off" value={values[i] || ""} placeholder={f.placeholder} onChange={(e) => set(i, e.target.value)} />}
          </Field>))}
      </div>
    </Modal>
  );
}

export function McpIntegrations({ servers, status, saving, onSave }: {
  servers: McpServerConfig[];
  status: McpServerStatus[];
  saving: boolean;
  onSave: (next: McpServerConfig[]) => Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [connecting, setConnecting] = useState<PopularIntegration | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const connect = async (item: PopularIntegration, values: string[]) => {
    const args = [...item.args]; const env: Record<string, string> = { ...(item.env || {}) };
    (item.setup || []).forEach((f, i) => { const v = (values[i] || "").trim(); if (f.env) env[f.env] = v; else if (f.kind === "folder" || f.kind === "text") { if (item.name === "Filesystem" || item.name === "Postgres") args[args.length - 1] = v; } });
    setConnectBusy(true);
    try { await onSave([...servers, { name: item.name.replace(/\s+/g, ""), command: item.command, args, env, enabled: true }]); toast(`${item.name} connected`, "ok"); setConnecting(null); }
    catch (e: any) { toast(e.message || String(e), "bad"); } finally { setConnectBusy(false); }
  };
  const pickItem = (item: PopularIntegration) => ((item.setup || []).length ? setConnecting(item) : connect(item, []));
  const [query, setQuery] = useState("");
  const byName = new Map(status.map((s) => [s.name, s]));
  const q = query.trim().toLowerCase();
  const matches = (haystack: string) => !q || haystack.toLowerCase().includes(q);
  const connected = servers.filter((s) => matches([s.name, s.command, ...(s.args || [])].join(" ")));
  const popular = POPULAR_INTEGRATIONS
    .filter((p) => !servers.some((s) => s.name.toLowerCase().replace(/\s+/g, "") === p.name.toLowerCase().replace(/\s+/g, "")))
    .filter((p) => matches([p.name, p.description, p.command, ...p.args].join(" ")));

  const write = async (next: McpServerConfig[], key: string, message?: string) => {
    setPending(key);
    try {
      await onSave(next);
      if (message) toast(message, "ok");
    } catch (e: any) {
      toast(e.message || String(e), "bad");
    } finally {
      setPending(null);
    }
  };

  const toggle = (server: McpServerConfig, index: number, enabled: boolean) =>
    write(servers.map((s, i) => (i === index ? { ...s, enabled } : s)), server.name);

  const remove = (server: McpServerConfig, index: number) => {
    if (!confirm(`Remove the “${server.name}” integration?`)) return;
    write(servers.filter((_, i) => i !== index), server.name, "Integration removed");
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const command = draft.command.trim();
    if (!name) { toast("Give the integration a name.", "bad"); return; }
    if (/[\/\s]/.test(name)) { toast("Names cannot contain spaces or slashes.", "bad"); return; }
    if (servers.some((s, i) => i !== draft.index && s.name.toLowerCase() === name.toLowerCase())) {
      toast("Another integration already uses that name.", "bad"); return;
    }
    if (!command) { toast("Enter the command Atlas should start.", "bad"); return; }
    const args = draft.argsText.split("\n").map((line) => line.trim()).filter(Boolean);
    const env = Object.fromEntries(draft.env.map((row) => [row.key.trim(), row.value]).filter(([key]) => key));
    const base = draft.index != null ? servers[draft.index] : {};
    const entry: McpServerConfig = { ...base, name, command, args, env, enabled: draft.enabled };
    const next = [...servers];
    if (draft.index != null) next[draft.index] = entry; else next.push(entry);
    setDraftSaving(true);
    try {
      await onSave(next);
      toast(draft.index != null ? "Integration updated" : "Integration added", "ok");
      setDraft(null);
    } catch (e: any) {
      toast(e.message || String(e), "bad");
    } finally {
      setDraftSaving(false);
    }
  };

  const addRow = () => draft && setDraft({ ...draft, env: [...draft.env, { key: "", value: "" }] });
  const setRow = (index: number, patch: Partial<{ key: string; value: string }>) =>
    draft && setDraft({ ...draft, env: draft.env.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const dropRow = (index: number) => draft && setDraft({ ...draft, env: draft.env.filter((_, i) => i !== index) });

  const preview = draft ? [draft.command.trim(), ...draft.argsText.split("\n").map((line) => line.trim()).filter(Boolean)].filter(Boolean).join(" ") : "";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="max-w-[420px] text-base leading-[20px] text-ink-2">Connect the apps you use so Atlas can work with them. Atlas always asks before it does anything.</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Explore integrations" aria-label="Search integrations"
              className="h-9 w-[220px] rounded-lg border border-line bg-base pl-8 pr-3 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" />
          </div>
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setDraft(emptyDraft())}>Add your own</Button>
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-ink">Connected</div>
          {servers.length > 0 && <span className="rounded-full bg-active px-1.5 py-0.5 text-2xs tnum text-ink-3">{servers.length}</span>}
        </div>
        
      </div>

      {connected.length === 0 ? (
        <div className="mt-2.5 flex flex-col items-center rounded-lg border border-dashed border-line px-4 py-8 text-center">
          <span className="mb-2 text-ink-3"><Plug size={20} strokeWidth={1.5} /></span>
          <div className="text-sm text-ink-2">{servers.length ? "No matches" : "No integrations connected"}</div>
          <div className="mt-1 max-w-[280px] text-xs leading-relaxed text-ink-3">{servers.length ? "Try a different search, or add a custom server." : "Pick one below, or add your own."}</div>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {connected.map((server) => {
            const index = servers.indexOf(server);
            const enabled = server.enabled !== false;
            const state = byName.get(server.name);
            const busy = pending === server.name;
            return (
              <div key={`${server.name}-${index}`}
                className={cx("overflow-hidden rounded-xl border border-line bg-surface", !enabled && "opacity-70")}>
                <div className="flex items-start gap-3 px-4 pt-3.5 pb-2.5">
                  <IntegrationMark server={server} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{server.name}</span>
                      {!enabled ? <Badge tone="muted">Disabled</Badge>
                        : state?.error ? <Badge tone="bad">Error</Badge>
                        : state?.running ? <Badge tone="ok">Connected</Badge>
                        : <Badge tone="muted">On</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-2">{POPULAR_INTEGRATIONS.find((p) => p.name.replace(/\s+/g, "") === server.name)?.description || "Custom integration"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Toggle checked={enabled} label={`Enable ${server.name}`} onChange={(value) => toggle(server, index, value)} />
                    <IconAction label={`Edit ${server.name}`} onClick={() => setDraft(draftFor(server, index))}><Pencil size={14} /></IconAction>
                    <IconAction label={`Remove ${server.name}`} danger onClick={() => remove(server, index)}><Trash2 size={14} /></IconAction>
                  </div>
                </div>
                {(busy || (enabled && state?.error)) && (
                  <div className="flex items-center gap-3 border-t border-line bg-[var(--base)] px-4 py-2 text-xs">
                    {busy && <span className="text-ink-3">Saving…</span>}
                    {!busy && enabled && state?.error && <span className="truncate text-bad" title={state.error}>Couldn’t start: {state.error}</span>}
                  </div>)}
              </div>
            );
          })}
        </div>
      )}

      {popular.length > 0 && (
        <>
          <div className="mt-7 flex items-end justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-ink">Popular</div>
              <div className="mt-0.5 text-xs text-ink-3">Click one to connect it</div>
            </div>
            
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2.5 min-[1200px]:grid-cols-2">
            {popular.map((item) => (
              <button key={item.name} type="button" onClick={() => pickItem(item)}
                title={item.description}
                className="group flex min-h-[76px] items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 text-left transition-colors hover:border-line-strong hover:bg-hover">
                <IntegrationMark server={item} size={44} className="transition-transform duration-200 group-hover:scale-[1.03]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{item.name}</span>
                  <span className="mt-0.5 block text-2xs leading-[14px] text-ink-3 line-clamp-2">{item.description}</span>
                </span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-ink-3 transition-colors group-hover:border-ink-2 group-hover:text-ink">
                  <Plus size={14} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {popular.length === 0 && q && (
        <div className="mt-7 rounded-xl border border-line bg-surface px-4 py-5 text-center text-xs text-ink-3">No integrations match “{query}”.</div>
      )}

      <SimpleConnect item={connecting} busy={connectBusy} onCancel={() => setConnecting(null)} onConnect={(v) => connecting && connect(connecting, v)} />

      <Modal open={!!draft} onClose={() => { if (!draftSaving) setDraft(null); }}
        title={draft?.index != null ? "Edit integration" : "Add your own integration (advanced)"} width={560}
        footer={<>
          <Button onClick={() => setDraft(null)} disabled={draftSaving}>Cancel</Button>
          <Button variant="primary" busy={draftSaving || (saving && !draftSaving)} onClick={saveDraft}>Save integration</Button>
        </>}>
        {draft && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" hint="Used as the tool prefix. No spaces or slashes.">
                <Input autoFocus value={draft.name} placeholder="filesystem" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <Field label="Command" hint="The executable Atlas starts.">
                <Input className="font-mono text-xs" value={draft.command} placeholder="npx" spellCheck={false}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
              </Field>
            </div>
            <Field label="Arguments" hint="One argument per line.">
              <TextArea rows={4} className="font-mono text-xs" spellCheck={false} value={draft.argsText}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/project"}
                onChange={(e) => setDraft({ ...draft, argsText: e.target.value })} />
            </Field>
            <div>
              <div className="text-xs font-medium text-ink">Environment variables</div>
              <div className="mt-0.5 mb-1.5 text-xs text-ink-2">Optional. Passed only to this server process.</div>
              {draft.env.length === 0 ? (
                <button type="button" onClick={addRow} className="h-8 rounded-md border border-line px-2.5 text-xs text-ink-2 hover:bg-hover hover:text-ink">Add variable</button>
              ) : (
                <div className="space-y-1.5">
                  {draft.env.map((row, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <Input className="!h-8 font-mono text-xs" placeholder="KEY" aria-label={`Environment variable ${index + 1} name`}
                        value={row.key} onChange={(e) => setRow(index, { key: e.target.value })} />
                      <Input className="!h-8 font-mono text-xs" placeholder="value" aria-label={`Environment variable ${index + 1} value`}
                        value={row.value} onChange={(e) => setRow(index, { value: e.target.value })} />
                      <button type="button" aria-label={`Remove environment variable ${index + 1}`} onClick={() => dropRow(index)}
                        className="h-8 w-8 shrink-0 rounded-sm flex items-center justify-center text-ink-3 hover:bg-hover hover:text-ink"><X size={13} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={addRow} className="h-7 rounded-sm px-2 text-xs text-ink-2 hover:bg-hover hover:text-ink">Add variable</button>
                </div>
              )}
            </div>
            <div className="rounded-md border border-line bg-sunken px-3 py-2">
              <div className="text-2xs font-medium uppercase tracking-[0.06em] text-ink-3">Command preview</div>
              <div className="mt-1 break-all font-mono text-xs text-ink-2">{preview || "Enter a command to preview it."}</div>
            </div>
            <div className="flex items-center justify-between gap-4 pt-0.5">
              <div>
                <div className="text-sm text-ink">Enabled</div>
                <div className="text-xs text-ink-2">Disabled servers are kept but never started.</div>
              </div>
              <Toggle checked={draft.enabled} label="Enable integration" onChange={(enabled) => setDraft({ ...draft, enabled })} />
            </div>
            <p className="text-xs leading-relaxed text-ink-3">
              Atlas stores this configuration locally. Every tool call still requires your approval.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
