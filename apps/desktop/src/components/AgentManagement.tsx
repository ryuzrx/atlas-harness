import React, { useEffect, useState } from "react";
import { ChevronRight, Crown, MoreHorizontal, Plus, Sparkles, Users } from "lucide-react";
import { Agent, api, Team, useApi } from "../api";
import { useStore } from "../store";
import { BrandMark } from "./Brand";
import { resolveProviderIconKey } from "./Endpoints";
import { ModelPicker } from "./Inspector";
import { Badge, Button, Card, cx, Empty, Field, Input, Menu, Modal, Select, StatusBadge, TextArea, useAction, useToast } from "./ui";

export const roleLabel = (role: string) => role.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function AutoAssignModels({ teamId, onSaved, disabled = false }: { teamId: string; onSaved?: () => void; disabled?: boolean }) {
  const { busy, run } = useAction();
  const toast = useToast();
  return <Button icon={<Sparkles size={14} />} busy={busy !== null} disabled={disabled}
    title="Choose models from connected endpoints for agents without an assignment"
    onClick={async () => {
      const result = await run("assign", () => api<{ assigned: { id: string }[]; message: string }>(`/teams/${teamId}/agents/auto-assign`, { body: {} }));
      if (result) { toast(result.assigned.length ? `Models assigned to ${result.assigned.length} agents.` : result.message, result.assigned.length ? "ok" : "info"); onSaved?.(); }
    }}>Assign missing models</Button>;
}

export function AgentRoster({ agents, loading, onReload, showTeam = false, emptyAction }: {
  agents: Agent[]; loading?: boolean; onReload: () => void; showTeam?: boolean; emptyAction?: React.ReactNode;
}) {
  const { select, selection } = useStore();
  const { busy, run } = useAction();
  const action = async (agent: Agent, verb: string) => {
    const result = await run(agent.id, () => api(`/agents/${agent.id}/${verb}`, { body: {} }), verb === "clone" ? "Agent duplicated" : undefined);
    if (result) onReload();
  };
  if (loading) return <Card className="p-8 text-sm text-ink-2" role="status">Loading agents…</Card>;
  if (!agents.length) return <Card><Empty icon={<Users size={22} />} title="No agents here" body="Add an agent, or choose another filter." action={emptyAction} /></Card>;
  return <Card className="divide-y divide-line">
    {agents.map((agent) => <div key={agent.id} className={cx("flex items-center gap-3 px-4 py-4 transition-colors hover:bg-hover", selection?.kind === "agent" && selection.id === agent.id && "bg-hover")}>
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink" onClick={() => select({ kind: "agent", id: agent.id })}>
        <span className="h-10 w-10 shrink-0 rounded-xl border border-line bg-active flex items-center justify-center text-ink font-medium">{agent.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-ink"><span className="truncate">{agent.name}</span>{agent.is_lead && <Badge><Crown size={11} className="mr-1" />Lead</Badge>}</span>
          <span className="block truncate mt-1 text-xs text-ink-2">{roleLabel(agent.role)}{showTeam && ` · ${agent.team_name || "Independent"}`}</span>
          <span className="flex items-center gap-1.5 mt-2 text-xs min-w-0">
            {agent.model ? <><BrandMark model={agent.model} fallbackIconKey={resolveProviderIconKey({ kind: agent.provider_kind, name: agent.provider_name })} size={18} /><span className="truncate text-ink-2" title={`${agent.provider_name || ""} · ${agent.model}`}>{agent.model}</span></> : <span className="text-warn">Needs a model</span>}
          </span>
        </span>
        {agent.current_task && <span className="hidden min-[1100px]:block max-w-[210px] truncate text-xs text-ink-2">{agent.current_task.title}</span>}
        <StatusBadge status={agent.status} />
        <ChevronRight size={14} className="text-ink-3 shrink-0" />
      </button>
      <Menu trigger={<button disabled={busy !== null} aria-label={`Actions for ${agent.name}`} className="h-8 w-8 shrink-0 rounded-md hover:bg-active flex items-center justify-center text-ink-2"><MoreHorizontal size={16} /></button>} items={[
        { label: "Edit agent", onClick: () => select({ kind: "agent", id: agent.id }) },
        { label: agent.status === "paused" ? "Resume" : "Pause", disabled: busy !== null, onClick: () => { void action(agent, agent.status === "paused" ? "resume" : "pause"); } },
        { label: "Duplicate", disabled: busy !== null, onClick: () => { void action(agent, "clone"); } },
      ]} />
    </div>)}
  </Card>;
}

export function CreateAgentModal({ open, onClose, teamId, onSaved }: { open: boolean; onClose: () => void; teamId?: string; onSaved?: () => void }) {
  const { data: teams = [] } = useApi<Team[]>(open && !teamId ? "/teams" : null, ["team"]);
  const { data: presets = [] } = useApi<{ id: string; name: string; data: Partial<Agent> }[]>(open ? "/presets" : null, ["preset"]);
  const { settings } = useStore();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [instructions, setInstructions] = useState("");
  const [team, setTeam] = useState(teamId || "");
  const [manual, setManual] = useState(false);
  const [model, setModel] = useState<{ provider?: string; name?: string }>({});
  const [preset, setPreset] = useState("");
  const { busy, run } = useAction();
  useEffect(() => { if (open) { setName(""); setRole(""); setInstructions(""); setTeam(teamId || ""); setManual(false); setModel({}); setPreset(""); } }, [open, teamId]);
  const selected = presets.find((p) => p.id === preset)?.data;
  const valid = Boolean((name || selected?.name || "").trim() && (role || selected?.role || "").trim() && (!manual || (model.provider && model.name)));
  const create = async () => {
    if (!valid || busy) return;
    const agent = await run("create", () => api<Agent>("/agents", { body: {
      ...selected, name: (name || selected?.name || "").trim(), role: (role || selected?.role || "").trim().replace(/\s+/g, "_").toLowerCase(),
      team_id: teamId || team || null, instructions: instructions || selected?.instructions || "",
      provider_id: manual ? model.provider : undefined, model: manual ? model.name : undefined, auto_assign_model: !manual,
      tools: selected?.tools || settings?.["agents.default_tools"] || ["read", "write", "shell", "git", "messages", "memory"],
    } }), "Agent created");
    if (agent) { onSaved?.(); onClose(); }
  };
  return <Modal open={open} onClose={onClose} title="New agent" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Plus size={14} />} disabled={!valid} busy={busy !== null} onClick={create}>Create agent</Button></>}>
    <div className="space-y-5 text-ink">
      <p className="text-sm text-ink-2">Give your agent a role. Atlas can choose a model from your connected endpoints.</p>
      <div className="grid grid-cols-1 min-[600px]:grid-cols-2 gap-4">
        <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={selected?.name || "API engineer"} /></Field>
        <Field label="Role"><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={selected?.role || "Engineer"} /></Field>
      </div>
      {!teamId && <Field label="Team"><Select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">Independent agent</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>}
      <Field label="Model"><Select value={manual ? "manual" : "auto"} onChange={(e) => setManual(e.target.value === "manual")}><option value="auto">Choose automatically</option><option value="manual">Choose a specific model</option></Select></Field>
      {manual && <Field label="Select model"><ModelPicker providerId={model.provider} model={model.name} onChange={(provider, name) => setModel({ provider, name })} /></Field>}
      <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-sm text-ink-2">Instructions & presets</summary><div className="space-y-4 mt-4">
        {presets.length > 0 && <Field label="Preset"><Select value={preset} onChange={(e) => setPreset(e.target.value)}><option value="">No preset</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
        <Field label="Instructions"><TextArea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={selected?.instructions || "Optional guidance for this agent"} /></Field>
      </div></details>
    </div>
  </Modal>;
}
