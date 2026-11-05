import React from "react";
import { FolderOpen } from "lucide-react";
import { api, pickFolder, useApi } from "../api";
import { Button, cx, useAction } from "./ui";

/** Shared control for choosing where Atlas-managed Ollama stores model files. */
export function ModelFolder({ variant = "card", disabled = false, onChanged, className }: {
  variant?: "card" | "row";
  disabled?: boolean;
  onChanged?: () => void;
  className?: string;
}) {
  const { data: status, reload } = useApi<any>("/ollama", ["provider"]);
  const { busy, run } = useAction();

  const choose = async () => {
    if (disabled) return;
    const path = await pickFolder({
      prompt: "Use Folder",
      message: "Choose where Ollama stores local model files.",
    });
    if (!path) return;
    const old = status;
    const saved = await run("location", () => api("/settings", { method: "PUT", body: { "models.ollama_dir": path } }), "Model folder saved");
    if (!saved) return;
    if (old?.managed) {
      await api("/ollama/stop", { body: {} }).catch(() => {});
      const result = await api<any>("/ollama/start", { body: {} }).catch((e) => ({ ok: false, error: e.message }));
      if (!result.ok) alert(result.error || "Ollama did not restart with the new model folder.");
    }
    reload();
    onChanged?.();
  };

  if (!status) return null;
  const path = status.model_dir || status.default_model_dir;
  return (
    <div className={cx(
      "flex items-center gap-3",
      variant === "card" && "rounded-md border border-line bg-surface px-3 py-2.5",
      variant === "row" && "px-4 py-3.5",
      className,
    )}>
      <FolderOpen size={15} className="shrink-0 text-ink-2" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-ink">Local model files</div>
        <div className="truncate font-mono text-2xs text-ink-3" title={path}>{path}</div>
        <div className="text-2xs text-ink-3">
          {disabled
            ? "Finish the current download before changing this folder."
            : "Ollama stores downloaded models here. Existing files are not moved; external services keep their own folder."}
        </div>
      </div>
      <Button size="sm" icon={<FolderOpen size={12} />} busy={busy === "location"} disabled={disabled} onClick={choose}>Choose folder</Button>
    </div>
  );
}
