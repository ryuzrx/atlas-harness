import React, { useEffect, useState } from "react";
import { Check, Copy, Moon, Palette, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { useStore } from "../store";
import {
  BUILTIN_PALETTES, DEFAULT_PALETTE_ID, PALETTE_ROLES, PaletteRoles, ThemeMode,
  customPalettesFrom, defaultRoles, isHexColor, newPaletteId, normalizeRoles, resolvePalette,
} from "../theme";
import { Button, Field, Input, Modal, Segmented, cx, useToast } from "./ui";

function effectiveMode(settings?: Record<string, any>): ThemeMode {
  const pref = settings?.["general.theme"] || "dark";
  if (pref === "system") return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return pref === "light" ? "light" : "dark";
}

function useEffectiveMode() {
  const { settings } = useStore();
  const [mode, setMode] = useState<ThemeMode>(() => effectiveMode(settings));
  useEffect(() => {
    const update = () => setMode(effectiveMode(settings));
    update();
    if ((settings?.["general.theme"] || "dark") !== "system") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [settings?.["general.theme"]]);
  return mode;
}

function PalettePreview({ roles, className }: { roles: PaletteRoles; className?: string }) {
  return (
    <div aria-hidden className={cx("rounded-[8px] border p-2", className)} style={{ background: roles.background, borderColor: roles.border }}>
      <div className="rounded-[5px] border p-1.5" style={{ background: roles.surface, borderColor: roles.border }}>
        <div className="h-1.5 w-14 rounded-full" style={{ background: roles.text }} />
        <div className="mt-1 h-1 w-9 rounded-full" style={{ background: roles.mutedText }} />
        <div className="mt-2 flex items-center gap-1.5">
          <span className="h-3.5 w-8 rounded-[3px]" style={{ background: roles.accent }} />
          <span className="h-3.5 w-3.5 rounded-[3px] border" style={{ borderColor: roles.border }} />
        </div>
      </div>
    </div>
  );
}

function MiniButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={cx("h-6 w-6 flex items-center justify-center rounded-[6px] no-drag", danger ? "text-ink-3 hover:text-bad hover:bg-bad-bg" : "text-ink-3 hover:text-ink hover:bg-hover")}>
      {children}
    </button>
  );
}

interface Draft { id?: string; name: string; mode: ThemeMode; roles: PaletteRoles }

function previewRoles(roles: PaletteRoles, mode: ThemeMode): PaletteRoles {
  const fallback = defaultRoles(mode);
  const out = {} as PaletteRoles;
  for (const { key } of PALETTE_ROLES) out[key] = isHexColor(roles[key]) ? roles[key].toLowerCase() : fallback[key];
  return out;
}

export function PaletteSettings() {
  const { settings, saveSettings } = useStore();
  const toast = useToast();
  const mode = useEffectiveMode();
  const activeId = settings?.["appearance.palette"] || DEFAULT_PALETTE_ID;
  const custom = customPalettesFrom(settings);
  // A custom palette is tied to one appearance; resolvePalette falls back when
  // the current mode differs, so the checkmark always shows what is applied.
  const appliedId = resolvePalette(activeId, custom, mode).id;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const selectPalette = async (id: string, customMode?: ThemeMode) => {
    try {
      await saveSettings({ "appearance.palette": id, ...(customMode ? { "general.theme": customMode } : {}) });
    } catch (e: any) {
      toast(e.message || String(e), "bad");
    }
  };

  const openNew = () => {
    const current = resolvePalette(activeId, custom, mode);
    setDraft({ name: "My palette", mode, roles: { ...current.roles } });
  };

  const openDuplicate = (name: string, paletteMode: ThemeMode, roles: PaletteRoles) => {
    setDraft({ name: `${name} copy`, mode: paletteMode, roles: { ...roles } });
  };

  const openEdit = (id: string) => {
    const palette = custom.find((p) => p.id === id);
    if (palette) setDraft({ id: palette.id, name: palette.name, mode: palette.mode, roles: { ...palette.roles } });
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete the “${name}” palette? This cannot be undone.`)) return;
    try {
      await saveSettings({
        "appearance.custom_palettes": custom.filter((p) => p.id !== id),
        ...(activeId === id ? { "appearance.palette": DEFAULT_PALETTE_ID } : {}),
      });
      toast("Palette deleted", "ok");
    } catch (e: any) {
      toast(e.message || String(e), "bad");
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast("Give the palette a name.", "bad"); return; }
    const roles = normalizeRoles(draft.roles);
    if (!roles) { toast("Each colour needs a six-digit hex value, such as #1a1a1a.", "bad"); return; }
    setSaving(true);
    try {
      const existing = !!draft.id && custom.some((p) => p.id === draft.id);
      const id = existing ? draft.id! : newPaletteId();
      const palette = { id, name, mode: draft.mode, roles };
      await saveSettings({
        "appearance.custom_palettes": existing ? custom.map((p) => (p.id === id ? palette : p)) : [...custom, palette],
        "appearance.palette": id,
        "general.theme": draft.mode,
      });
      toast(existing ? "Palette updated" : "Palette saved", "ok");
      setDraft(null);
    } catch (e: any) {
      toast(e.message || String(e), "bad");
    } finally {
      setSaving(false);
    }
  };

  const shownRoles = draft ? previewRoles(draft.roles, draft.mode) : defaultRoles(mode);

  return (
    <div className="py-4 border-b border-line last:border-0">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Palette</div>
          <div className="text-[12px] text-ink-2 mt-0.5">Start from a built-in palette or build your own with named colour roles. Status colours stay reserved for status.</div>
        </div>
        <Button size="sm" icon={<Plus size={13} />} onClick={openNew}>New palette</Button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {BUILTIN_PALETTES.map((p) => {
          const active = appliedId === p.id;
          const roles = p.modes[mode];
          return (
            <div key={p.id} className={cx("rounded-[16px] border transition-colors", active ? "border-ink-2 bg-selected" : "border-line hover:border-line-strong")}>
              <button type="button" aria-pressed={active} onClick={() => selectPalette(p.id)} className="block w-full text-left p-2.5">
                <PalettePreview roles={roles} />
                <div className="mt-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{p.name}</span>
                  {active && <Check size={13} className="shrink-0 text-ink" />}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-ink-3">Built-in · {p.description}</div>
              </button>
              <div className="flex items-center justify-end gap-0.5 px-1.5 pb-1.5 -mt-1">
                <MiniButton label={`Duplicate ${p.name}`} onClick={() => openDuplicate(p.name, mode, roles)}><Copy size={12} /></MiniButton>
              </div>
            </div>
          );
        })}
      </div>

      {custom.length > 0 && (
        <>
          <div className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Your palettes</div>
          <div className="grid grid-cols-2 gap-2.5">
            {custom.map((p) => {
              const active = appliedId === p.id;
              return (
                <div key={p.id} className={cx("rounded-[16px] border transition-colors", active ? "border-ink-2 bg-selected" : "border-line hover:border-line-strong")}>
                  <button type="button" aria-pressed={active} onClick={() => selectPalette(p.id, p.mode)} className="block w-full text-left p-2.5">
                    <PalettePreview roles={p.roles} />
                    <div className="mt-2 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{p.name}</span>
                      {active && <Check size={13} className="shrink-0 text-ink" />}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-3">Custom · {p.mode === "light" ? "Light" : "Dark"}</div>
                  </button>
                  <div className="flex items-center justify-end gap-0.5 px-1.5 pb-1.5 -mt-1">
                    <MiniButton label={`Edit ${p.name}`} onClick={() => openEdit(p.id)}><Pencil size={12} /></MiniButton>
                    <MiniButton label={`Duplicate ${p.name}`} onClick={() => openDuplicate(p.name, p.mode, p.roles)}><Copy size={12} /></MiniButton>
                    <MiniButton label={`Delete ${p.name}`} danger onClick={() => remove(p.id, p.name)}><Trash2 size={12} /></MiniButton>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Modal open={!!draft} onClose={() => { if (!saving) setDraft(null); }}
        title={draft?.id ? "Edit palette" : "New palette"} width={660}
        footer={<>
          <Button onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
          <Button variant="primary" busy={saving} onClick={saveDraft}>Save palette</Button>
        </>}>
        {draft && (
          <div className="grid grid-cols-[1fr_210px] gap-5">
            <div className="min-w-0 space-y-3.5">
              <Field label="Name">
                <Input autoFocus value={draft.name} maxLength={40} placeholder="Palette name"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </Field>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[12px] font-medium text-ink">Appearance</span>
                <Segmented<ThemeMode> value={draft.mode} onChange={(next) => setDraft({ ...draft, mode: next })}
                  options={[
                    { id: "light", label: <><Sun size={12} /> Light</> },
                    { id: "dark", label: <><Moon size={12} /> Dark</> },
                  ]} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {PALETTE_ROLES.map((role) => (
                  <Field key={role.key} label={role.label} hint={role.hint}>
                    <div className="flex items-center gap-1.5">
                      <input type="color" aria-label={`${role.label} colour`} className="swatch-input h-9 w-10 shrink-0"
                        value={isHexColor(draft.roles[role.key]) ? draft.roles[role.key] : defaultRoles(draft.mode)[role.key]}
                        onChange={(e) => setDraft({ ...draft, roles: { ...draft.roles, [role.key]: e.target.value } })} />
                      <Input className="font-mono text-[12px] uppercase" maxLength={7} spellCheck={false} value={draft.roles[role.key]}
                        onChange={(e) => setDraft({ ...draft, roles: { ...draft.roles, [role.key]: e.target.value } })} />
                    </div>
                  </Field>
                ))}
              </div>
            </div>
            <div className="min-w-0 space-y-2.5">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink"><Palette size={13} /> Preview</div>
              <PalettePreview roles={shownRoles} />
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                These six roles generate the app&apos;s surfaces, borders and controls. Success, warning and error colours stay fixed so status stays legible.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
