import React, { useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { api, useApi } from "../api";
import { Button, cx, Spinner, useAction } from "./ui";

interface Tpl { name: string; description: string; agents: number }
interface Suggestion { teams: string[]; reason: string; source: "ai" | "keywords"; model: string | null }

const IDEAS = ["Build apps and websites", "Research and compare options", "Design interfaces", "Test and secure my code", "Deploy and release software"];

/** Pick preset teams. Describe what you want to do and a model suggests which ones fit; or just tick the ones you like. */
export function TeamAdvisor({ onDone, onSkip }: { onDone: (created: number) => void; onSkip?: () => void }) {
  const { data: meta } = useApi<any>("/meta");
  const templates: Record<string, Tpl> = meta?.templates || {};
  const [need, setNeed] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set(["engineering"]));
  const [creating, setCreating] = useState(false);
  const [sugg, setSugg] = useState<Suggestion | null>(null);
  const { busy, run } = useAction();

  const suggest = async () => {
    if (busy || creating || !need.trim()) return;
    const r = await run("s", () => api<Suggestion>("/teams/suggest", { body: { need } }));
    if (r) { setSugg(r); setPicked(new Set(r.teams)); }
  };
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const create = async () => {
    if (busy || creating || !picked.size) return;
    setCreating(true);
    let made = 0;
    const remaining = new Set(picked);
    try {
      for (const k of picked) {
        const t = await run("c", () => api("/teams", { body: { template: k } }));
        if (t) { made++; remaining.delete(k); }
      }
      setPicked(remaining);
      if (!remaining.size) onDone(made);
    } finally { setCreating(false); }
  };

  return (
    <div>
      <h1 className="text-center text-2xl leading-tight font-semibold tracking-[-0.02em] text-ink">Set up your teams</h1>
      <p className="mt-2 text-center text-base text-ink-2">Teams are groups of AI agents that work together. Tell Atlas what you want to do and it suggests the right ones.</p>
      <p className="mt-1 text-center text-xs text-ink-3">Each agent is matched to an available model for its role. Your last chat model is not reused.</p>

      <div className="mt-7 rounded-lg border border-line bg-surface p-3">
        <textarea value={need} onChange={(e) => setNeed(e.target.value)} rows={2} aria-label="What do you want to get done?" placeholder="What do you want to get done? For example: build a mobile app and make sure it's secure."
          className="w-full resize-none bg-transparent outline-none text-base leading-6 text-ink placeholder:text-ink-3 px-1" />
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {IDEAS.map((i) => <button key={i} onClick={() => setNeed((n) => (n ? n.replace(/\.?\s*$/, ". ") : "") + i)} className="h-7 px-2.5 rounded-full border border-line text-xs text-ink-2 hover:text-ink hover:bg-hover">{i}</button>)}
          <div className="flex-1" />
          <Button size="sm" variant="primary" icon={busy === "s" ? <Spinner /> : <Sparkles size={13} />} disabled={!need.trim() || busy !== null || creating} onClick={suggest}>Suggest teams</Button>
        </div>
      </div>
      {sugg && (
        <p className="mt-3 text-sm text-ink-2">
          {sugg.reason ? <span className="text-ink">{sugg.reason} </span> : null}
          <span className="text-ink-3">{sugg.source === "ai" ? `Suggested by ${sugg.model}.` : "Matched by keywords. Connect a model for smarter suggestions."}</span>
        </p>)}

      <div className="mt-5 grid gap-2.5">
        {Object.entries(templates).map(([k, t]) => {
          const on = picked.has(k); const suggested = sugg?.teams.includes(k);
          return (
            <button key={k} disabled={creating} onClick={() => toggle(k)} role="checkbox" aria-checked={on}
              className={cx("text-left rounded-lg border p-3.5 flex items-center gap-3.5 transition-colors", on ? "border-ink-2 bg-selected" : "border-line bg-surface hover:bg-hover")}>
              <span className={cx("h-5 w-5 rounded-sm border flex items-center justify-center shrink-0", on ? "border-ink bg-ink text-[var(--base)]" : "border-line-strong")}>{on && <Check size={13} strokeWidth={2.5} />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-base text-ink">{t.name}{suggested && <span className="text-2xs text-ink-2 border border-line rounded-full px-2 leading-[18px]">Suggested</span>}</span>
                <span className="block text-sm text-ink-3">{t.description}</span>
              </span>
              <span className="text-xs text-ink-3 shrink-0">{t.agents} agents</span>
            </button>);
        })}
      </div>
      <div className="mt-6 flex items-center justify-center gap-3">
        {onSkip && <Button variant="ghost" disabled={creating || busy !== null} onClick={onSkip}>Skip for now</Button>}
        <Button variant="primary" busy={creating} disabled={!picked.size || busy !== null} onClick={create} className="!h-10 !px-6">{picked.size ? `Create ${picked.size} team${picked.size === 1 ? "" : "s"}` : "Pick a team"}</Button>
      </div>
    </div>
  );
}
