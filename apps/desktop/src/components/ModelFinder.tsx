import React, { useState } from "react";
import { Check, Download, Sparkles } from "lucide-react";
import { useApi } from "../api";
import { Button, cx, Modal } from "./ui";
import { BrandMark, brandFor } from "./Brand";

interface Lib { name: string; group: string; size: string; note: string }
type Use = "chat" | "coding" | "reasoning" | "vision";
type Prio = "fast" | "balanced" | "best";

const USES: { id: Use; label: string; hint: string }[] = [
  { id: "chat", label: "Everyday chat", hint: "Questions, writing, summaries" },
  { id: "coding", label: "Coding", hint: "Write, fix and explain code" },
  { id: "reasoning", label: "Reasoning", hint: "Math, logic, step-by-step thinking" },
  { id: "vision", label: "Understanding images", hint: "Describe and read pictures" },
];
const PRIOS: { id: Prio; label: string; hint: string; factor: number }[] = [
  { id: "fast", label: "Fast replies", hint: "Smaller and snappier", factor: 0.3 },
  { id: "balanced", label: "Balanced", hint: "Good quality, still quick", factor: 0.6 },
  { id: "best", label: "Best quality", hint: "Biggest your Mac can run", factor: 1 },
];

const gb = (s: string) => { const m = s.match(/([\d.]+)\s*(GB|MB)/i); return m ? (m[2].toUpperCase() === "MB" ? parseFloat(m[1]) / 1000 : parseFloat(m[1])) : 0; };

function pool(lib: Lib[], use: Use): Lib[] {
  const ok = (m: Lib) => m.group !== "Abliterated" && !/embed/i.test(m.name + m.note);
  const t = (m: Lib) => (m.note + " " + m.name).toLowerCase();
  return lib.filter(ok).filter((m) => use === "coding" ? m.group === "Coding"
    : use === "reasoning" ? m.group === "Reasoning" || /thinking|reasoning/.test(t(m))
    : use === "vision" ? /vision|llava/.test(t(m))
    : m.group === "General");
}

export function recommend(lib: Lib[], use: Use, prio: Prio, ramGb: number, diskGb: number) {
  const budget = ramGb * 0.6;   // weights plus context and the rest of macOS
  const cap = budget * PRIOS.find((p) => p.id === prio)!.factor;
  const all = pool(lib, use).filter((m) => !diskGb || gb(m.size) * 1.1 < diskGb).sort((a, b) => gb(a.size) - gb(b.size));
  const fits = all.filter((m) => gb(m.size) <= cap);
  const pick = fits[fits.length - 1] || all[0];
  const tooBig = !fits.length && !!pick;
  const alts = all.filter((m) => m !== pick && gb(m.size) <= budget).sort((a, b) => Math.abs(gb(a.size) - gb(pick?.size || "0")) - Math.abs(gb(b.size) - gb(pick?.size || "0"))).slice(0, 2);
  return { pick, alts, tooBig, budget };
}

/** One-click "which local model is best for my Mac?": reads this Mac's memory, asks two questions, recommends. */
export function ModelFinder({ open, onClose, lib, installed, onPick }: { open: boolean; onClose: () => void; lib: Lib[]; installed: Set<string>; onPick: (name: string) => void }) {
  const { data: hw } = useApi<{ ram_bytes: number; chip: string; disk_free_bytes: number }>(open ? "/hardware" : null);
  const [use, setUse] = useState<Use>("chat");
  const [prio, setPrio] = useState<Prio>("balanced");
  const [done, setDone] = useState(false);
  const ram = hw ? hw.ram_bytes / 1e9 : 0;
  const rec = hw && done ? recommend(lib, use, prio, ram, hw.disk_free_bytes / 1e9) : null;

  const reason = (m: Lib) => {
    const brand = (brandFor(m.name)?.label || "").toLowerCase();
    const note = m.note.split(", ").filter((x) => !brand.includes(x.toLowerCase())).join(", ");
    const lead = note ? note.charAt(0).toUpperCase() + note.slice(1) + ". " : "";
    return `${lead}A ${m.size} download that uses about ${(gb(m.size) * 1.2).toFixed(1)} GB of your ${Math.round(ram)} GB memory while running.`;
  };
  const Opt = ({ on, label, hint, onClick }: { on: boolean; label: string; hint: string; onClick: () => void }) => (
    <button onClick={onClick} aria-pressed={on} className={cx("text-left rounded-[12px] border p-3.5 transition-colors", on ? "border-ink bg-selected" : "border-line hover:bg-hover")}>
      <div className="text-[14px] text-ink">{label}</div><div className="text-[12.5px] text-ink-3 mt-0.5">{hint}</div>
    </button>);
  const Card = ({ m, primary }: { m: Lib; primary?: boolean }) => {
    const [family, tag] = m.name.split(":");
    return (
      <div className={cx("rounded-[14px] border p-4 flex items-center gap-4", primary ? "border-ink bg-selected" : "border-line")}>
        <BrandMark model={m.name} label={family} size={primary ? 48 : 38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className={cx("text-ink truncate", primary ? "text-[17px] font-medium" : "text-[14.5px]")}>{family}</span>{tag && <span className="text-[11px] text-ink-2 border border-line rounded-[6px] px-1.5 leading-[18px]">{tag}</span>}</div>
          <div className="text-[12.5px] text-ink-3 truncate">{brandFor(m.name)?.label} · {m.size}</div>
          {primary && <p className="text-[13px] text-ink-2 mt-1.5 leading-[18px]">{reason(m)}</p>}
        </div>
        {installed.has(m.name) ? <span className="text-[12.5px] text-ink-2 flex items-center gap-1 shrink-0"><Check size={14} />Installed</span>
          : <Button variant={primary ? "primary" : "secondary"} size={primary ? "md" : "sm"} icon={<Download size={13} />} onClick={() => { onPick(m.name); onClose(); }}>Download</Button>}
      </div>);
  };

  return (
    <Modal open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Sparkles size={16} strokeWidth={1.6} />Find the best model for me</span>} width={640}
      footer={done ? <><Button variant="ghost" onClick={() => setDone(false)}>Change answers</Button><Button variant="ghost" onClick={onClose}>Close</Button></>
        : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!hw} onClick={() => setDone(true)}>Recommend</Button></>}>
      {!done ? (
        <div className="space-y-6">
          <p className="text-[13.5px] text-ink-2">{hw ? <>Your Mac has <span className="text-ink">{Math.round(ram)} GB</span> of memory{hw.chip ? <> and a <span className="text-ink">{hw.chip}</span></> : null}. Answer two quick questions and Atlas picks a model that runs well on it.</> : "Checking your Mac…"}</p>
          <div><div className="text-[14px] text-ink mb-2">What will you use it for?</div><div className="grid grid-cols-2 gap-2.5">{USES.map((u) => <Opt key={u.id} on={use === u.id} label={u.label} hint={u.hint} onClick={() => setUse(u.id)} />)}</div></div>
          <div><div className="text-[14px] text-ink mb-2">What matters more?</div><div className="grid grid-cols-3 gap-2.5">{PRIOS.map((p) => <Opt key={p.id} on={prio === p.id} label={p.label} hint={p.hint} onClick={() => setPrio(p.id)} />)}</div></div>
        </div>
      ) : rec?.pick ? (
        <div className="space-y-4">
          <div className="text-[13px] text-ink-3">Best match for {USES.find((u) => u.id === use)!.label.toLowerCase()}, {PRIOS.find((p) => p.id === prio)!.label.toLowerCase()}, on {Math.round(ram)} GB</div>
          <Card m={rec.pick} primary />
          {rec.tooBig && <p className="text-[12.5px] text-warn">Nothing in this category fits comfortably in your memory. This is the smallest option and may run slowly.</p>}
          {rec.alts.length > 0 && <><div className="text-[13px] text-ink-3 pt-2">Other good options</div><div className="space-y-2.5">{rec.alts.map((m) => <Card key={m.name} m={m} />)}</div></>}
        </div>
      ) : <p className="text-[13.5px] text-ink-2">No model in the library fits that combination on this Mac. Try "Fast replies" or another use.</p>}
    </Modal>
  );
}
