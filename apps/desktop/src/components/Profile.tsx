import React, { useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, ChevronUp, Pencil, Settings, Trash2 } from "lucide-react";
import { isNative, nativeCall } from "../api";
import { useStore } from "../store";
import { Button, cx, Input, useToast } from "./ui";

export function Avatar({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  return src
    ? <img src={src} alt="" aria-hidden width={size} height={size} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0 border border-line" />
    : <span aria-hidden style={{ width: size, height: size, fontSize: size * 0.4 }} className="rounded-full bg-active border border-line flex items-center justify-center font-medium text-ink shrink-0">{(name || "?").slice(0, 1).toUpperCase()}</span>;
}

/** Choose any system-supported image, crop it square and shrink it for settings. */
export async function pickAvatar(): Promise<string | null> {
  if (isNative()) {
    const result = await nativeCall<any>("pickImage");
    if (result && typeof result === "object" && result.error) throw new Error(result.error);
    return result as string | null;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const S = 192, c = document.createElement("canvas"); c.width = c.height = S;
        const context = c.getContext("2d");
        if (!context || !img.naturalWidth || !img.naturalHeight) { URL.revokeObjectURL(url); return resolve(null); }
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        context.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.86));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image. Try exporting it as PNG or JPEG.")); };
      img.src = url;
    };
    input.click();
  });
}

export function useProfile() {
  const { settings, saveSettings } = useStore();
  const toast = useToast();
  const save = (patch: Record<string, any>) => saveSettings(patch).catch((e) => toast(e.message, "bad"));
  const changePhoto = async () => {
    try {
      const a = await pickAvatar();
      if (a) save({ "profile.avatar": a });
    } catch (e: any) { toast(e?.message || "Could not open that image.", "bad"); }
  };
  return { avatar: (settings?.["profile.avatar"] as string) || "", workspace: (settings?.["profile.workspace"] as string) || "Local workspace", save, changePhoto };
}

/** The sidebar profile menu and its local name, picture, and workspace editor. */
export function ProfileCard({ name, collapsed = false }: { name: string; collapsed?: boolean }) {
  const { go } = useStore();
  const { avatar, workspace, save, changePhoto } = useProfile();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nm, setNm] = useState(name); const [ws, setWs] = useState(workspace);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) { setNm(name); setWs(workspace); setEditing(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    (editing ? backButton.current : editButton.current)?.focus();
  }, [open, editing]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setEditing(false); } };
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false); setEditing(false); trigger.current?.focus();
      }
    };
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
        <div role="dialog" aria-label={editing ? "Edit profile" : "Profile menu"}
          className={cx("pop-in absolute rounded-xl border border-line-strong bg-[var(--surface)] shadow-[var(--shadow-lg)] p-1.5 z-40", collapsed ? "left-full ml-4 bottom-0 w-[248px] max-w-[calc(100vw-100px)]" : "bottom-full mb-2 inset-x-0")}>
          {editing ? (
            <div className="p-2">
              <div className="flex items-center gap-2 mb-4">
                <button ref={backButton} onClick={() => setEditing(false)} aria-label="Back to profile menu"
                  className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-ink-2 hover:text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                  <ChevronLeft size={17} strokeWidth={1.7} /></button>
                <span className="text-sm font-semibold text-ink">Edit profile</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={changePhoto} aria-label="Change profile picture" title="Change picture" className="group relative shrink-0 rounded-full">
                  <Avatar src={avatar} name={nm || name} size={48} />
                  <span className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 flex items-center justify-center text-white transition-opacity duration-150"><Camera size={16} /></span>
                </button>
                <div className="min-w-0 flex flex-col gap-1">
                  <Button size="sm" icon={<Camera size={13} />} onClick={changePhoto}>{avatar ? "Change photo" : "Add photo"}</Button>
                  {avatar && <button onClick={() => save({ "profile.avatar": "" })} className="text-left text-xs text-ink-3 hover:text-bad flex items-center gap-1.5"><Trash2 size={12} />Remove photo</button>}
                </div>
              </div>
              <label className="block mt-4 text-xs text-ink-3">Your name
                <Input value={nm} onChange={(e) => setNm(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="mt-1" placeholder="Your name" /></label>
              <label className="block mt-3 text-xs text-ink-3">Workspace label
                <Input value={ws} onChange={(e) => setWs(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="mt-1" placeholder="Local workspace" /></label>
              <p className="mt-3 text-xs text-ink-3 leading-[17px]">Saved on this Mac only. Your picture is shown in Atlas and never uploaded.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-2.5 py-2.5">
                <Avatar src={avatar} name={name} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink truncate">{name || "You"}</span>
                  <span className="block text-xs text-ink-3 truncate mt-0.5">{workspace}</span>
                </span>
              </div>
              <div className="h-px bg-line mx-1.5 my-1" />
              <button ref={editButton} onClick={() => setEditing(true)}
                className="w-full h-9 px-2.5 rounded-md flex items-center gap-2.5 text-sm text-ink text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                <Pencil size={15} strokeWidth={1.7} className="text-ink-2" />Edit profile</button>
              <button onClick={() => { setOpen(false); go({ name: "settings" }); }}
                className="w-full h-9 px-2.5 rounded-md flex items-center gap-2.5 text-sm text-ink text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                <Settings size={15} strokeWidth={1.7} className="text-ink-2" />Settings</button>
              <div className="border-t border-line mt-1 px-2.5 py-2 text-xs text-ink-3">Your profile stays on this Mac.</div>
            </>
          )}
        </div>)}
      <div className={cx("w-full flex items-center rounded-lg", collapsed ? "h-11 justify-center" : "h-12", open ? "bg-selected" : "")}>
        <button ref={trigger} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label="Profile menu"
          title={collapsed ? "Profile menu" : undefined} className={cx("min-w-0 h-full flex items-center rounded-lg text-left hover:bg-hover no-drag focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", collapsed ? "w-11 justify-center" : "flex-1 px-2 gap-2.5")}>
          <Avatar src={avatar} name={name} size={30} />
          {!collapsed && <>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink truncate leading-[17px]">{name}</span>
            <span className="block text-xs text-ink-3 truncate leading-[16px]">{workspace}</span>
          </span>
          <ChevronUp size={15} strokeWidth={1.6} className={cx("shrink-0 text-ink-3 mr-1 transition-transform duration-200 ease-[var(--ease)]", !open && "rotate-180")} />
          </>}
        </button>
      </div>
    </div>
  );
}
