import React, { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronDown, Download, LoaderCircle, RotateCcw, Square, X } from "lucide-react";
import { api, bytes, subscribe, useApi } from "../api";
import { cx } from "./ui";

type Pull = {
  pull_id: string; provider_id: string; model: string; status: string;
  completed?: number; total?: number; error?: string;
};

const terminal = (p: Pull) => ["success", "error", "cancelled"].includes(p.status) || !!p.error;

export function ModelDownloads() {
  const { data: active = [] } = useApi<Pull[]>("/models/pulls", ["pull"]);
  const [items, setItems] = useState<Record<string, Pull>>({});
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!active.length) return;
    setItems((current) => {
      const next = { ...current };
      for (const pull of active) next[pull.pull_id] = { ...next[pull.pull_id], ...pull };
      return next;
    });
    setOpen(true);
  }, [active]);

  useEffect(() => subscribe((message) => {
    if (message.kind !== "pull" || !message.pull_id) return;
    const pull = message as Pull;
    setItems((current) => ({ ...current, [pull.pull_id]: { ...current[pull.pull_id], ...pull } }));
    if (pull.status === "starting") setOpen(true);
    if (terminal(pull)) {
      window.setTimeout(() => setItems((current) => {
        if (current[pull.pull_id]?.status === pull.status) {
          const next = { ...current };
          delete next[pull.pull_id];
          return next;
        }
        return current;
      }), 12000);
    }
  }), []);

  const downloads = useMemo(() => Object.values(items).sort((a, b) => a.model.localeCompare(b.model)), [items]);
  const running = downloads.filter((pull) => !terminal(pull)).length;
  if (!downloads.length) return null;

  const stop = async (pull: Pull) => {
    try { await api(`/models/pulls/${encodeURIComponent(pull.pull_id)}/cancel`, { body: {} }); }
    catch (error: any) {
      setItems((current) => ({ ...current, [pull.pull_id]: { ...pull, status: "error", error: error.message } }));
    }
  };
  const retry = async (pull: Pull) => {
    try { await api("/models/pull", { body: { provider_id: pull.provider_id, model: pull.model } }); }
    catch (error: any) {
      setItems((current) => ({ ...current, [pull.pull_id]: { ...pull, status: "error", error: error.message } }));
    }
  };

  return (
    <section aria-label="Model downloads" className="fixed bottom-3 right-3 z-[100] w-[min(390px,calc(100vw-24px))] overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-md)]">
      <button onClick={() => setOpen((value) => !value)} aria-expanded={open}
        className="flex h-11 w-full items-center gap-2.5 px-3 text-left hover:bg-hover">
        {running ? <LoaderCircle size={15} className="shrink-0 animate-spin text-ink-2" /> : <Download size={15} className="shrink-0 text-ink-2" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
          {running ? `${running} model${running === 1 ? "" : "s"} downloading` : "Recent model downloads"}
        </span>
        <span className="text-xs text-ink-3">{downloads.length}</span>
        <ChevronDown size={14} className={cx("text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="max-h-[min(320px,55vh)] overflow-y-auto border-t border-line">
        {downloads.map((pull) => {
          const done = pull.status === "success";
          const failed = pull.status === "error" || !!pull.error;
          const cancelled = pull.status === "cancelled";
          const percent = pull.total ? Math.min(100, Math.round((pull.completed || 0) / pull.total * 100)) : 0;
          return <div key={pull.pull_id} className="border-b border-line px-3 py-2.5 last:border-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink" title={pull.model}>{pull.model}</div>
                <div className={cx("mt-0.5 truncate text-xs", failed ? "text-bad" : "text-ink-3")} title={pull.error}>
                  {pull.error || (done ? "Download complete" : cancelled ? "Download stopped" : pull.status === "starting" ? "Starting…" : pull.total ? `${bytes(pull.completed || 0)} of ${bytes(pull.total)} · ${percent}%` : pull.status)}
                </div>
              </div>
              {!terminal(pull) ? <button onClick={() => stop(pull)} aria-label={`Stop downloading ${pull.model}`} title="Stop download"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><Square size={13} /></button> :
                failed ? <button onClick={() => retry(pull)} aria-label={`Retry downloading ${pull.model}`} title="Retry download"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><RotateCcw size={14} /></button> :
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-ink-3">{done ? <Check size={15} /> : cancelled ? <X size={14} /> : <AlertCircle size={14} />}</span>}
            </div>
            {!terminal(pull) && <div className="mt-2 h-1 overflow-hidden rounded-full bg-active" role="progressbar" aria-label={`Download progress for ${pull.model}`} aria-valuenow={pull.total ? percent : undefined} aria-valuemin={0} aria-valuemax={100}>
              <div className={cx("h-full rounded-full bg-ink-2 transition-[width]", !pull.total && "w-1/3 animate-pulse")} style={pull.total ? { width: `${percent}%` } : undefined} />
            </div>}
          </div>;
        })}
      </div>}
    </section>
  );
}
