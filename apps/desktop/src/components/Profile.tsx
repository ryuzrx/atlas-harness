import React, { useEffect, useRef, useState } from "react";
import { Camera, ChevronUp, Settings, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { Button, cx, Input, useToast } from "./ui";

export function Avatar({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  return src
    ? <img src={src} alt="" aria-hidden width={size} height={size} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0 border border-line" />
    : <span aria-hidden style={{ width: size, height: size, fontSize: size * 0.4 }} className="rounded-full bg-active border border-line flex items-center justify-center font-medium text-ink shrink-0">{(name || "?").slice(0, 1).toUpperCase()}</span>;
}

/** Choose an image, crop it square and shrink it so it stays small in settings. */
export function pickAvatar(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f || !f.type.startsWith("image/") || f.size > 15_000_000) return resolve(null);
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const S = 192, c = document.createElement("canvas"); c.width = c.height = S;
        const side = Math.min(img.width, img.height);
        c.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    };
    input.click();
  });
}

export function useProfile() {
  const { settings, saveSettings } = useStore();
  const toast = useToast();
  const save = (patch: Record<string, any>) => saveSettings(patch).catch((e) => toast(e.message, "bad"));
  const changePhoto = async () => { const a = await pickAvatar(); a ? save({ "profile.avatar": a }) : toast("Choose an image file.", "bad"); };
  return { avatar: (settings?.["profile.avatar"] as string) || "", workspace: (settings?.["profile.workspace"] as string) || "Local workspace", save, changePhoto };
}

/** The sidebar profile: click the card to edit your name, picture and workspace label. The gear opens Settings. */
export function ProfileCard({ name }: { name: string }) {
  const { go, settingsOpen } = useStore();
  const { avatar, workspace, save, changePhoto } = useProfile();
  const [open, setOpen] = useState(false);
  const [nm, setNm] = useState(name); const [ws, setWs] = useState(workspace);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setNm(name); setWs(workspace); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", h); window.addEventListener("keydown", k);
    return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [open]);
  const commit = () => {
    const patch: Record<string, any> = {};
    if (nm.trim() !== name) patch["profile.name"] = nm.trim();
    if (ws.trim() !== workspace) patch["profile.workspace"] = ws.trim();
    if (Object.keys(patch).length) save(patch);
  };

  return (
    <div ref={ref} className="relative">
      {open && (
        <div role="dialog" aria-label="Your profile" className="pop-in absolute bottom-full mb-2 inset-x-0 rounded-xl border border-line-strong bg-[var(--surface)] shadow-[var(--shadow-lg)] p-4 z-40">
          <div className="flex items-center gap-4">
            <button onClick={changePhoto} aria-label="Change profile picture" title="Change picture" className="group relative shrink-0 rounded-full">
              <Avatar src={avatar} name={nm || name} size={64} />
              <span className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity duration-150"><Camera size={18} /></span>
            </button>
            <div className="min-w-0 flex-1 flex flex-col gap-1.5">
              <Button size="sm" icon={<Camera size={13} />} onClick={changePhoto}>{avatar ? "Change photo" : "Add photo"}</Button>
              {avatar && <button onClick={() => save({ "profile.avatar": "" })} className="text-left text-sm text-ink-3 hover:text-bad flex items-center gap-1.5"><Trash2 size={12} />Remove photo</button>}
            </div>
          </div>
          <label className="block mt-4 text-xs text-ink-3">Your name
            <Input value={nm} onChange={(e) => setNm(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="mt-1" placeholder="Your name" /></label>
          <label className="block mt-3 text-xs text-ink-3">Workspace label
            <Input value={ws} onChange={(e) => setWs(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="mt-1" placeholder="Local workspace" /></label>
          <p className="mt-3 text-xs text-ink-3 leading-[17px]">Saved on this Mac only. Your picture is shown in Atlas and never uploaded.</p>
        </div>)}
      <div className={cx("w-full h-12 pr-1 flex items-center gap-1 rounded-lg", open ? "bg-selected" : "")}>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Edit profile" className="flex-1 min-w-0 h-full pl-2 flex items-center gap-2.5 rounded-lg text-left hover:bg-hover no-drag">
          <Avatar src={avatar} name={name} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink truncate leading-[17px]">{name}</span>
            <span className="block text-xs text-ink-3 truncate leading-[16px]">{workspace}</span>
          </span>
          <ChevronUp size={15} strokeWidth={1.6} className={cx("shrink-0 text-ink-3 mr-1 transition-transform duration-200 ease-[var(--ease)]", !open && "rotate-180")} />
        </button>
        <button onClick={() => go({ name: "settings" })} aria-label="Settings" title="Settings  ⌘,"
          className={cx("h-9 w-9 shrink-0 rounded-md flex items-center justify-center no-drag", settingsOpen ? "bg-active text-ink" : "text-ink-2 hover:text-ink hover:bg-hover")}><Settings size={17} strokeWidth={1.6} /></button>
      </div>
    </div>
  );
}
