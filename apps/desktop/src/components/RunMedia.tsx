import React, { Suspense, lazy, useEffect, useState } from "react";
import { Box, Image as ImageIcon, Maximize2, X } from "lucide-react";
import { TOKEN, useApi } from "../api";
import { cx } from "./ui";

// three.js only loads when a run actually produced a 3D model
const ModelViewer = lazy(() => import("./ModelViewer"));

export interface MediaFile { task_id: string; path: string; name: string; kind: "image" | "model"; size: number; mtime: number }

export const mediaUrl = (m: MediaFile) =>
  `/api/tasks/${m.task_id}/file?path=${encodeURIComponent(m.path)}&token=${encodeURIComponent(TOKEN)}&v=${Math.round(m.mtime)}`;

const fmtSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Images and 3D models a run created, shown inline like a chat attachment. Click to enlarge. */
export function RunMedia({ taskId, live }: { taskId: string; live: boolean }) {
  const { data: media = [] } = useApi<MediaFile[]>(`/tasks/${taskId}/media`, ["task"], live ? 4000 : 0);
  const [open, setOpen] = useState<MediaFile | null>(null);
  if (!media.length) return null;
  const models = media.filter((m) => m.kind === "model");
  const images = media.filter((m) => m.kind === "image");
  return (
    <div className="px-3 pb-3 pt-2 space-y-2">
      {models.slice(0, 2).map((m) => (
        <figure key={`${m.task_id}:${m.path}`} className="m-0 rounded-xl border border-line overflow-hidden bg-surface">
          <Suspense fallback={<div className="h-[220px] flex items-center justify-center text-xs text-ink-3">Loading 3D viewer…</div>}>
            <ModelViewer url={mediaUrl(m)} name={m.name} />
          </Suspense>
          <Caption m={m} onOpen={() => setOpen(m)} />
        </figure>
      ))}
      {images.length > 0 && (
        <div className={cx("grid gap-2", images.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3")}>
          {images.slice(0, 9).map((m) => (
            <button key={`${m.task_id}:${m.path}`} onClick={() => setOpen(m)} title={m.path}
              className="group relative overflow-hidden rounded-xl border border-line bg-surface text-left">
              <img src={mediaUrl(m)} alt={m.name} loading="lazy" draggable={false}
                className={cx("w-full object-contain bg-[var(--surface-2)] transition-transform duration-300 group-hover:scale-[1.02]", images.length === 1 ? "max-h-[320px]" : "h-[140px] object-cover")} />
              <span className="absolute bottom-0 inset-x-0 px-2.5 py-1.5 text-2xs text-white truncate bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">{m.path}</span>
            </button>
          ))}
        </div>
      )}
      {(models.length > 2 || images.length > 9) && <div className="text-xs text-ink-3">{media.length} files in this run · showing the newest</div>}
      {open && <Lightbox m={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Caption({ m, onOpen }: { m: MediaFile; onOpen: () => void }) {
  return (
    <figcaption className="flex items-center gap-2 px-3 h-9 border-t border-line text-xs text-ink-2">
      {m.kind === "model" ? <Box size={13} className="shrink-0 text-ink-3" /> : <ImageIcon size={13} className="shrink-0 text-ink-3" />}
      <span className="truncate font-mono" title={m.path}>{m.path}</span>
      <span className="ml-auto shrink-0 text-ink-3 tnum">{fmtSize(m.size)}</span>
      <button onClick={onOpen} aria-label={`Open ${m.name} larger`} title="Open larger"
        className="h-6 w-6 shrink-0 rounded flex items-center justify-center text-ink-3 hover:text-ink hover:bg-hover"><Maximize2 size={12} /></button>
    </figcaption>
  );
}

/** Full-window view: large image, or a big orbitable model. Esc or click outside closes. */
function Lightbox({ m, onClose }: { m: MediaFile; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={onClose} role="dialog" aria-label={m.name}>
      <div className="modal-panel relative w-full max-w-[1100px] rounded-2xl border border-line bg-surface overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 h-11 border-b border-line text-sm">
          {m.kind === "model" ? <Box size={15} className="text-ink-2" /> : <ImageIcon size={15} className="text-ink-2" />}
          <span className="font-mono truncate">{m.path}</span>
          <span className="text-ink-3 text-xs">{fmtSize(m.size)}</span>
          <button onClick={onClose} aria-label="Close preview" className="ml-auto h-8 w-8 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover"><X size={16} /></button>
        </div>
        {m.kind === "model" ? (
          <Suspense fallback={<div className="h-[70vh] flex items-center justify-center text-sm text-ink-3">Loading 3D viewer…</div>}>
            <ModelViewer url={mediaUrl(m)} name={m.name} height={Math.round(innerHeight * 0.7)} />
          </Suspense>
        ) : (
          <img src={mediaUrl(m)} alt={m.name} className="block max-h-[78vh] w-full object-contain bg-[var(--surface-2)]" />
        )}
      </div>
    </div>
  );
}
