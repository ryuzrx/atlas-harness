import React, { useState } from "react";
import { Crown, Plus, Search, Users } from "lucide-react";
import { Agent, ago, api, STATUS_LABEL, Team, useApi } from "../api";
import { useStore } from "../store";
import { Button, Card, cx, Dot, Empty, Field, Input, Modal, Select, useAction } from "../components/ui";
import { BrandMark } from "../components/Brand";
import { resolveProviderIconKey } from "../components/Endpoints";
import { ModelPicker } from "../components/Inspector";

const pretty = (role: string) => { const t = role.replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

export function Agents() {
  const { select, selection, settings } = useStore();
  const { data: agents = [], loading } = useApi<Agent[]>("/agents", ["agent", "task"]);
  const { data: teams = [] } = useApi<Team[]>("/teams", ["team"]);
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; role: string; team_id: string; p?: string; m?: string }>({ name: "", role: "", team_id: "" });
  const { busy, run } = useAction();
  const shown = agents.filter((a) => (!team || a.team_id === team) && (!q || `${a.name} ${a.role} ${a.model}`.toLowerCase().includes(q.toLowerCase())));
  const working = agents.filter((a) => a.status === "running" || a.status === "waiting").length;
  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="flex items-center gap-4 mb-5">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] leading-[30px] font-semibold tracking-[-0.022em] text-ink">Agents</h1>
          <p className="mt-1 text-[13.5px] text-ink-2">{agents.length ? `${agents.length} agent${agents.length === 1 ? "" : "s"}${working ? ` · ${working} working` : ""}` : "AI helpers with a role, a model and the tools they may use."}</p>
        </div>
        <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New agent</Button>
      </div>
      {agents.length > 0 && <div className="flex items-center gap-2 mb-4">
        <div className="relative"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" aria-label="Search agents"
            className="h-9 w-[260px] pl-8 pr-2.5 rounded-[10px] bg-hover border border-line text-[13px] text-ink placeholder:text-ink-3 outline-none focus:border-line-strong" /></div>
        {teams.length > 0 && <Select value={team} onChange={(e) => setTeam(e.target.value)} className="!w-auto !h-9 text-[13px]" aria-label="Filter by team">
          <option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
      </div>}
      {!loading && shown.length === 0 ? (
        <Card><Empty icon={<Users size={22} />} title={q || team ? "No agents match" : "No agents yet"} body={q || team ? "Try a different search." : "Create a team from a template, or add an agent yourself."}
          action={!q && !team && <Button variant="primary" onClick={() => setCreating(true)}>New agent</Button>} /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
          {shown.map((a) => {
            const busyNow = a.status === "running" || a.status === "waiting";
            return (
              <button key={a.id} onClick={() => select({ kind: "agent", id: a.id })}
                className={cx("text-left rounded-[14px] border border-line bg-surface p-4 flex flex-col gap-3 hover:border-line-strong transition-colors", selection?.id === a.id && "border-line-strong bg-hover")}>
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-full bg-active flex items-center justify-center text-[15px] font-medium text-ink shrink-0">{a.name.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[15px] text-ink truncate">{a.name}{a.is_lead && <Crown size={13} className="text-ink-2 shrink-0" aria-label="Team lead" />}</div>
                    <div className="text-[12.5px] text-ink-3 truncate">{pretty(a.role)}{a.team_name ? ` · ${a.team_name}` : ""}</div>
                  </div>
                  <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-2 shrink-0"><Dot status={a.status} />{STATUS_LABEL[a.status] || a.status}</span>
                </div>
                <div className="text-[13px] text-ink-2 truncate min-h-[19px]">{busyNow && a.current_task ? a.current_task.title : "Idle"}</div>
                <div className="flex items-center gap-2 pt-3 border-t border-line text-[12.5px]">
                  {a.model ? <><BrandMark model={a.model} fallbackIconKey={resolveProviderIconKey({ kind: a.provider_kind, name: a.provider_name })} label={a.provider_name} size={22} />
                    <span className="truncate text-ink-2" title={a.model}>{a.model}</span></> : <span className="text-warn">No model assigned</span>}
                  <span className="ml-auto text-ink-3 tnum shrink-0">{a.last_activity ? ago(a.last_activity) : ""}</span>
                </div>
              </button>);
          })}
        </div>)}
      <Modal open={creating} onClose={() => setCreating(false)} title="New agent"
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
          <Button variant="primary" disabled={!form.name || !form.role} busy={busy === "c"} onClick={async () => {
            const a = await run("c", () => api<Agent>("/agents", { body: { name: form.name, role: form.role.trim().replace(/\s+/g, "_").toLowerCase(), team_id: form.team_id || null, provider_id: form.p, model: form.m,
              tools: settings?.["agents.default_tools"] || ["read", "write", "shell", "git", "messages", "memory"] } }), "Agent created");
            if (a) { setCreating(false); setForm({ name: "", role: "", team_id: "" }); select({ kind: "agent", id: a.id }); }
          }}>Create</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ada" /></Field>
            <Field label="What does it do?"><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Engineer" /></Field>
          </div>
          <Field label="Team"><Select value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>
            <option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Model"><ModelPicker providerId={form.p} model={form.m} onChange={(p, m) => setForm({ ...form, p, m })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
