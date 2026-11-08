import React, { useEffect, useState } from "react";
import { ChevronRight, Crown, MoreHorizontal, Plus, Sparkles, Users } from "lucide-react";
import { Agent, api } from "../api";
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
        { label: agent.status === "paused" ? "Enable agent" : agent.current_task ? "Pause after current step" : "Disable agent",
          disabled: busy !== null, onClick: () => { void action(agent, agent.status === "paused" ? "resume" : "pause"); } },
        { label: "Duplicate", disabled: busy !== null, onClick: () => { void action(agent, "clone"); } },
      ]} />
    </div>)}
  </Card>;
}

export function CreateAgentModal({ open, onClose, teamId, onSaved }: { open: boolean; onClose: () => void; teamId?: string; onSaved?: () => void }) {
  const { settings } = useStore();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [persona, setPersona] = useState("");
  const [expertise, setExpertise] = useState("");
  const [voice, setVoice] = useState("Clear and direct");
  const [approach, setApproach] = useState("Think carefully, then act");
  const [instructions, setInstructions] = useState("");
  const [manual, setManual] = useState(false);
  const [model, setModel] = useState<{ provider?: string; name?: string }>({});
  const { busy, run } = useAction();
  useEffect(() => { if (open) { setName(""); setRole(""); setPersona(""); setExpertise(""); setVoice("Clear and direct"); setApproach("Think carefully, then act"); setInstructions(""); setManual(false); setModel({}); } }, [open]);
  const valid = Boolean(name.trim() && role.trim() && (!manual || (model.provider && model.name)));
  const create = async () => {
    if (!valid || busy) return;
    const personalizedInstructions = [
      persona.trim() && `PERSONALITY\n${persona.trim()}`,
      expertise.trim() && `SPECIALTY\n${expertise.trim()}`,
      `COMMUNICATION STYLE\n${voice}`,
      `WORKING STYLE\n${approach}`,
      instructions.trim() && `ADDITIONAL GUIDANCE\n${instructions.trim()}`,
    ].filter(Boolean).join("\n\n");
    const agent = await run("create", () => api<Agent>("/agents", { body: {
      name: name.trim(), role: role.trim().replace(/\s+/g, "_").toLowerCase(),
      team_id: teamId || null, instructions: personalizedInstructions,
      provider_id: manual ? model.provider : undefined, model: manual ? model.name : undefined, auto_assign_model: !manual,
      tools: settings?.["agents.default_tools"] || ["read", "write", "shell", "git", "messages", "memory"],
    } }), "Agent created");
    if (agent) { onSaved?.(); onClose(); }
  };
  return <Modal open={open} onClose={onClose} title="Create your agent" width={680} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Plus size={14} />} disabled={!valid} busy={busy !== null} onClick={create}>Create agent</Button></>}>
    <div className="space-y-6 text-ink">
      <div className="flex items-center gap-3 border-b border-line pb-5">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-active text-lg font-semibold text-ink">{name.trim().slice(0, 1).toUpperCase() || "A"}</div>
        <div className="min-w-0"><div className="truncate text-base font-medium">{name.trim() || "Your agent"}</div><div className="mt-0.5 truncate text-sm text-ink-2">{role.trim() || "Define its role below"}</div></div>
        <span className="ml-auto shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2">Custom profile</span>
      </div>
      <section className="space-y-4">
        <div><h3 className="text-sm font-semibold">Identity</h3><p className="mt-1 text-xs text-ink-3">Give this agent a name and a clear area of responsibility.</p></div>
        <div className="grid grid-cols-1 gap-4 min-[600px]:grid-cols-2">
          <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nova" /></Field>
          <Field label="Role"><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Frontend engineer" /></Field>
        </div>
        <Field label="Model"><Select value={manual ? "manual" : "auto"} onChange={(e) => setManual(e.target.value === "manual")}><option value="auto">Choose automatically</option><option value="manual">Choose a specific model</option></Select></Field>
        {manual && <Field label="Select model"><ModelPicker providerId={model.provider} model={model.name} onChange={(provider, name) => setModel({ provider, name })} /></Field>}
      </section>
      <section className="space-y-4 border-t border-line pt-5">
        <div><h3 className="text-sm font-semibold">Personality</h3><p className="mt-1 text-xs text-ink-3">This becomes part of the agent’s standing instructions for every task.</p></div>
        <Field label="How should it act?" hint="Write freely. Include traits, values, or how it should react under pressure.">
          <TextArea rows={3} value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="A sharp, curious partner: candid about problems, playful when it fits, and clear about uncertainty." />
        </Field>
        <Field label="Expertise"><Input value={expertise} onChange={(e) => setExpertise(e.target.value)} placeholder="e.g. React performance, API design, accessibility" /></Field>
        <div className="grid grid-cols-1 gap-4 min-[600px]:grid-cols-2">
          <Field label="Voice"><Select value={voice} onChange={(e) => setVoice(e.target.value)}>{["Clear and direct", "Warm and encouraging", "Concise and technical", "Curious and exploratory", "Witty and candid"].map((v) => <option key={v}>{v}</option>)}</Select></Field>
          <Field label="Work approach"><Select value={approach} onChange={(e) => setApproach(e.target.value)}>{["Think carefully, then act", "Move quickly and iterate", "Ask before assumptions", "Challenge ideas and find risks"].map((v) => <option key={v}>{v}</option>)}</Select></Field>
        </div>
        <Field label="Extra instructions" hint="Optional rules, boundaries, preferred tools, or response format.">
          <TextArea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Add any specific guidance you want this agent to follow." />
        </Field>
      </section>
    </div>
  </Modal>;
}
