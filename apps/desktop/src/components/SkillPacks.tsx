import React, { useState } from "react";
import { BarChart3, BookOpen, Bot, Braces, Briefcase, Check, ChevronDown, ClipboardList, Code2, Feather, FileCode, FlaskConical, Gamepad2, GitBranch, Globe, GraduationCap, Headphones, Megaphone, Palette, PenLine, Rocket, Search, Server, ShieldCheck, Sigma, Smartphone, SquareTerminal, Wallet } from "lucide-react";
import { api, useApi } from "../api";
import { Button, cx, Modal, useAction } from "./ui";

interface Pack { id: string; name: string; description: string; installed: number; skills: { name: string; description: string; installed: boolean }[] }
const ICONS: Record<string, React.ElementType> = {
  "coding-essentials": Code2, "git-and-releases": GitBranch, "research-analysis": Search, "writing-communication": PenLine, "design-ux": Palette,
  "product-planning": ClipboardList, "data-analysis": BarChart3, "security-quality": ShieldCheck, "devops-ship": Rocket, "learning-coach": GraduationCap,
  "web-development": Globe, "python-toolkit": FileCode, "javascript-typescript": Braces, "mobile-apps": Smartphone, "api-backend": Server,
  "ai-prompting": Bot, "business-marketing": Megaphone, "career-productivity": Briefcase, "documentation": BookOpen, "game-development": Gamepad2,
  "creative-writing": Feather, "finance-admin": Wallet, "customer-support": Headphones, "testing-deep-dive": FlaskConical, "shell-linux": SquareTerminal,
  "math-science": Sigma,
};

function PackCard({ pack }: { pack: Pack }) {
  const Icon = ICONS[pack.id] || Code2;
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string> | null>(null);
  const { busy, run } = useAction();
  const fresh = pack.skills.filter((s) => !s.installed);
  const chosen = sel ?? new Set(fresh.map((s) => s.name));
  const done = fresh.length === 0;
  const add = () => run("i", () => api<{ added: number }>(`/skillpacks/${pack.id}/install`, { body: { skills: [...chosen] } }), `${chosen.size} skill${chosen.size === 1 ? "" : "s"} added`).then(() => setSel(null));
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="p-4 flex items-start gap-3.5">
        <span className="h-10 w-10 rounded-md border border-line bg-hover flex items-center justify-center text-ink shrink-0"><Icon size={19} strokeWidth={1.6} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-lg text-ink">{pack.name}</div>
          <div className="text-sm text-ink-2 leading-[18px] mt-0.5">{pack.description}</div>
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 text-sm text-ink-3 hover:text-ink flex items-center gap-1">
            {pack.skills.length} skills<ChevronDown size={13} className={cx("transition-transform duration-200", open && "rotate-180")} /></button>
        </div>
        {done ? <span className="text-sm text-ink-2 flex items-center gap-1 shrink-0 pt-1"><Check size={14} />Added</span>
          : <Button size="sm" variant="primary" busy={busy === "i"} disabled={!chosen.size} onClick={add}>{open ? `Add ${chosen.size}` : "Add all"}</Button>}
      </div>
      {open && (
        <ul className="border-t border-line divide-y divide-[var(--border)]">
          {pack.skills.map((s) => (
            <li key={s.name}>
              <label className={cx("flex items-start gap-3 px-4 py-2.5", s.installed ? "opacity-55" : "hover:bg-hover")}>
                <input type="checkbox" disabled={s.installed} checked={s.installed || chosen.has(s.name)} className="mt-1 shrink-0"
                  onChange={(e) => { const n = new Set(chosen); e.target.checked ? n.add(s.name) : n.delete(s.name); setSel(n); }} />
                <span className="min-w-0"><span className="block text-base text-ink font-mono">/{s.name}</span><span className="block text-sm text-ink-3">{s.description}</span></span>
              </label>
            </li>))}
        </ul>)}
    </div>
  );
}

/** The pack cards on their own, so the Welcome flow and the Skills settings share them. */
export function PackGrid({ cols = 2 }: { cols?: 1 | 2 }) {
  const { data: packs = [] } = useApi<Pack[]>("/skillpacks", ["settings"]);
  return <div className={cx("grid gap-3 items-start", cols === 2 ? "grid-cols-2 max-[800px]:grid-cols-1" : "grid-cols-1")}>{packs.map((p) => <PackCard key={p.id} pack={p} />)}</div>;
}

/** Ready-made skill packs that ship with Atlas: add a whole pack or just the skills you want. */
export function SkillPacks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: packs = [] } = useApi<Pack[]>(open ? "/skillpacks" : null, ["settings"]);
  const total = packs.reduce((a, p) => a + p.skills.length, 0);
  return (
    <Modal open={open} onClose={onClose} title="Skill packs" width={820} footer={<Button variant="ghost" onClick={onClose}>Done</Button>}>
      <p className="text-base text-ink-2 mb-4">{packs.length} packs with {total} ready-made skills for everyday work. They are built into Atlas, so nothing is downloaded. Turn any skill off later under Settings → Skills.</p>
      <PackGrid />
    </Modal>
  );
}
