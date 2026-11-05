import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { STATUS_LABEL } from "../api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; icon?: React.ReactNode; busy?: boolean;
};
export function Button({ variant = "secondary", size = "md", icon, busy, className, children, disabled, ...p }: BtnProps) {
  return (
    <button
      {...p}
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap rounded-md disabled:opacity-45 disabled:pointer-events-none no-drag",
        size === "sm" ? "h-7 px-2.5 text-xs" : size === "lg" ? "h-9 px-4 text-sm" : "h-8 px-3 text-sm",
        variant === "primary" && "btn-accent shadow-[var(--shadow)]",
        variant === "secondary" && "neu-btn text-ink shadow-[var(--shadow)]",
        variant === "ghost" && "text-ink-2 hover:bg-hover hover:text-ink",
        variant === "danger" && "neu-btn text-bad hover:!bg-bad-bg hover:!border-transparent",
        className,
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} {...p}
      className={cx("h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink active:bg-active no-drag disabled:opacity-40", className)}>
      {children}
    </button>
  );
}

const TONE: Record<string, string> = {
  ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", info: "bg-active text-ink",
  muted: "bg-active text-ink-2",
};
export function statusTone(s?: string): keyof typeof TONE {
  switch (s) {
    case "completed": case "connected": case "loaded": case "idle": return s === "idle" ? "muted" : "ok";
    case "running": case "planning": case "reviewing": case "active": case "processing": return "info";
    case "waiting_approval": case "blocked": case "paused": case "waiting": return "warn";
    case "failed": case "unavailable": return "bad";
    default: return "muted";
  }
}
export function Badge({ tone = "muted", children, className }: { tone?: string; children: React.ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 h-5 px-2 rounded-full text-2xs font-medium whitespace-nowrap", TONE[tone], className)}>{children}</span>;
}
export function StatusBadge({ status }: { status?: string }) {
  const tone = statusTone(status);
  const live = ["running", "planning", "reviewing", "processing"].includes(status || "");
  return (
    <Badge tone={tone}>
      <span className={cx("h-1.5 w-1.5 rounded-full bg-current", live && "pulse-dot")} />
      {STATUS_LABEL[status || ""] || status || "—"}
    </Badge>
  );
}
export function Dot({ status, className }: { status?: string; className?: string }) {
  const tone = statusTone(status);
  const color = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", info: "bg-ink-2", muted: "bg-ink-3" }[tone];
  return <span className={cx("inline-block h-2 w-2 rounded-full", color, className, ["running", "planning"].includes(status || "") && "pulse-dot")} />;
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx("neu rounded-lg", className)}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between h-7 mb-2">
      <h2 className="text-base font-semibold text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-6 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink [text-wrap:balance]">{title}</h1>
        {subtitle && <p className="text-ink-2 mt-1 text-sm">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      {icon && <div className="h-11 w-11 rounded-lg bg-hover text-ink-2 flex items-center justify-center mb-3">{icon}</div>}
      <div className="text-base font-medium text-ink">{title}</div>
      {body && <div className="text-ink-2 mt-1 max-w-sm text-sm [text-wrap:pretty]">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-ink mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-xs text-ink-3 mt-1.5">{hint}</div>}
    </label>
  );
}

const inputCls = "w-full h-8 px-2.5 rounded-md bg-[var(--sunken)] border border-line text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-line-strong focus:ring-[3px] focus:ring-[var(--ring)] transition-[border-color,box-shadow] duration-150";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} {...p} className={cx(inputCls, className)} />);
export function TextArea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(inputCls, "h-auto py-2 leading-relaxed resize-y", className)} />;
}
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(inputCls, "pr-7", className)}>{children}</select>;
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx("relative h-[20px] w-[34px] rounded-full shrink-0 transition-colors duration-200", checked ? "bg-[var(--primary)]" : "bg-active")}>
      <span className={cx("absolute top-[2px] h-4 w-4 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-[left] duration-200 ease-[var(--ease)]", checked ? "left-[16px] bg-[var(--on-primary)]" : "left-[2px] bg-white")} />
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="inline-flex items-center gap-0.5 p-[3px] rounded-md bg-active mb-5 max-w-full overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx("h-7 px-3 rounded-sm text-sm font-medium whitespace-nowrap inline-flex items-center",
            value === t.id ? "bg-[var(--surface)] text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:text-ink")}>
          {t.label}
          {t.count != null && <span className={cx("ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-2xs tnum inline-flex items-center justify-center", value === t.id && t.count ? "btn-accent" : "bg-active text-ink-2")}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: React.ReactNode; title?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-0.5 p-[3px] rounded-md bg-active">
      {options.map((o) => (
        <button key={o.id} title={o.title} onClick={() => onChange(o.id)}
          className={cx("h-[26px] px-2.5 rounded-sm text-xs font-medium inline-flex items-center gap-1",
            value === o.id ? "bg-[var(--surface)] text-ink shadow-[var(--shadow)]" : "text-ink-2 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 520 }: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", h);
    setTimeout(() => (ref.current?.querySelector<HTMLElement>("input:not([type=checkbox]),textarea") ||
      ref.current?.querySelector<HTMLElement>("select,input") )?.focus(), 30);
    return () => window.removeEventListener("keydown", h);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/50 modal-backdrop no-drag" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(e) => e.stopPropagation()}
        style={{ width }} className="modal-panel max-w-[92vw] max-h-[76vh] flex flex-col bg-surface text-ink rounded-xl border border-line shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between pl-5 pr-3 h-12 shrink-0">
        <div id="modal-title" className="font-semibold text-base text-ink">{title}</div>
          <IconButton label="Close" onClick={onClose}><X size={15} /></IconButton>
        </div>
        <div className="px-5 pb-5 pt-1 overflow-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

// ---- toasts --------------------------------------------------------------------
type Toast = { id: number; text: string; tone: "ok" | "bad" | "info" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = (text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "bad" ? 7000 : 3500);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 no-drag" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx("pop-in max-w-sm flex items-start gap-2.5 px-4 py-3 rounded-lg border border-line shadow-[var(--shadow-lg)] text-sm bg-[var(--surface)] text-ink")}>
            <span className={cx("mt-[6px] h-1.5 w-1.5 rounded-full shrink-0", t.tone === "bad" ? "bg-bad" : t.tone === "ok" ? "bg-ok" : "bg-ink-3")} />
            <span className="selectable">{t.text}</span></div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Run an async action, toast its error. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast(ok, "ok"); return r; }
    catch (e: any) { toast(e.message || String(e), "bad"); return undefined; }
    finally { setBusy(null); }
  };
  return { busy, run };
}

export function Menu({ trigger, items }: { trigger: React.ReactNode; items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", h); window.addEventListener("keydown", k);
    return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <span onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{trigger}</span>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1.5 z-40 min-w-[190px] p-1 bg-[var(--surface)] rounded-lg border border-line shadow-[var(--shadow-lg)] pop-in origin-top-right">
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}
              className={cx("w-full text-left px-2.5 h-7 rounded-sm text-sm disabled:opacity-40", it.danger ? "text-bad hover:bg-bad-bg" : "text-ink hover:bg-active")}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Stat({ label, value, hint, tone, icon, color = "var(--text-2)" }: { label: string; value: React.ReactNode; hint?: string; tone?: string; icon?: React.ReactNode; color?: string }) {
  return (
    <Card className="p-4 flex items-start gap-3.5">
      {icon && <span className="h-10 w-10 rounded-md bg-hover flex items-center justify-center shrink-0" style={{ color }}>{icon}</span>}
      <div className="min-w-0">
        <div className="text-xs text-ink-2 font-medium truncate">{label}</div>
        <div className={cx("text-2xl font-semibold tnum", tone)}>{value}</div>
        {hint && <div className="text-xs text-ink-3 truncate">{hint}</div>}
      </div>
    </Card>
  );
}

export function Meter({ value, max = 100, tone = "bg-ink-3" }: { value: number; max?: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return <div className="h-1.5 rounded-full neu-in-sm overflow-hidden" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><div className={cx("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${pct}%` }} /></div>;
}

/** System Settings-style inset group: rows separated by hairlines inside one rounded box. */
export function List({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("rounded-lg border border-line bg-[var(--surface)] divide-y divide-[var(--border)]", className)}>{children}</div>;
}
/** One settings row: label and hint on the left, the control on the right. */
export function Row({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 min-h-[52px]">
      <div className="min-w-0 flex-1"><div className="text-sm text-ink">{label}</div>{hint && <div className="text-xs text-ink-3 mt-0.5">{hint}</div>}</div>
      {children != null && <div className="shrink-0 flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Spinner() { return <Loader2 size={15} className="animate-spin text-ink-3" />; }
