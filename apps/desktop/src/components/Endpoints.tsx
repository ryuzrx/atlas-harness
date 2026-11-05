import React, { useEffect, useState } from "react";
import { Check, AlertCircle, Loader2, ExternalLink, Lock, Cpu, Cloud, TerminalSquare } from "lucide-react";
import { api, openExternal, Provider } from "../api";
import { Button, cx, Field, Input, useAction } from "./ui";
import { PROVIDER_ICON_MARKUP } from "./providerIcons";
import { AtlasMark } from "./Logo";

/** Official-ish brand colours for provider logos. Codex uses the ChatGPT/OpenAI mark; custom endpoints use Atlas. */
export const PROVIDER_COLOR: Record<string, string> = {
  openai: "#10A37F", anthropic: "#D97757", claudecode: "#D97757", gemini: "#4C8DF6", openrouter: "#6467F2", groq: "#F55036",
  deepseek: "#5B7CFF", mistral: "#FA6A2A", xai: "#C7CBD1", together: "#3B82F6", fireworks: "#8B5CF6", cerebras: "#F15A29",
  sambanova: "#EE7624", deepinfra: "#5B7CFA", huggingface: "#FFD21E", nvidia: "#76B900", novita: "#34D399", hyperbolic: "#5EEAD4",
  nebius: "#D4F04A", perplexity: "#22B8CD", cohere: "#7FD1AE", moonshot: "#A78BFA", qwen: "#7B6CF6", zai: "#7C8CFF", minimax: "#F23F5D",
  ollama: "#E5E7EB", lmstudio: "#7C6BFF", vllm: "#FDB515", apple: "#E5E7EB",
};

export interface Preset {
  id: string; label: string; kind: string; category: "local" | "cloud" | "cli"; base_url?: string;
  needs_key?: boolean; key_url?: string; note: string; config?: any;
}
export const CATEGORIES: { id: Preset["category"]; label: string; icon: React.ElementType; blurb: string }[] = [
  { id: "local", label: "On this Mac", icon: Cpu, blurb: "Private and free. Nothing leaves your computer." },
  { id: "cloud", label: "Cloud API", icon: Cloud, blurb: "Your own API key, stored in the macOS Keychain." },
  { id: "cli", label: "Agent CLI", icon: TerminalSquare, blurb: "Claude Code or Codex with your existing sign-in." },
];

const ICON_ALIASES: Record<string, string> = {
  openai: "openai", chatgpt: "openai", codex: "openai", codex_cli: "openai", codex_oss: "openai",
  anthropic: "anthropic", claude: "anthropic", claude_code: "claudecode", claudecode: "claudecode",
  google: "gemini", gemini: "gemini", openrouter: "openrouter", groq: "groq", deepseek: "deepseek",
  mistral: "mistral", mistralai: "mistral", xai: "xai", together: "together", togetherai: "together",
  fireworks: "fireworks", cerebras: "cerebras", sambanova: "sambanova", deepinfra: "deepinfra",
  huggingface: "huggingface", nvidia: "nvidia", novita: "novita", hyperbolic: "hyperbolic",
  nebius: "nebius", perplexity: "perplexity", cohere: "cohere", moonshot: "moonshot", kimi: "moonshot",
  qwen: "qwen", dashscope: "qwen", zai: "zai", minimax: "minimax", ollama: "ollama", lmstudio: "lmstudio",
  vllm: "vllm", mlx: "apple", apple: "apple", codexcli: "openai", codexoss: "openai", customendpoint: "atlas", custom: "atlas",
};

export function resolveProviderIconKey(input: { presetId?: string; kind?: string; baseUrl?: string; name?: string }) {
  const fromName = (value?: string) => value ? ICON_ALIASES[value.toLowerCase().replace(/[^a-z0-9]/g, "")] : undefined;
  const preset = fromName(input.presetId);
  if (preset) return preset;
  const kind = fromName(input.kind);
  if (kind) return kind;
  let host = "";
  try { host = new URL(input.baseUrl || "").hostname.toLowerCase().replace(/^www\./, ""); } catch { /* custom URL */ }
  const hostKey = Object.entries({
    "api.openai.com": "openai", "anthropic.com": "anthropic", "generativelanguage.googleapis.com": "gemini",
    "openrouter.ai": "openrouter", "groq.com": "groq", "deepseek.com": "deepseek", "mistral.ai": "mistral",
    "x.ai": "xai", "together.xyz": "together", "fireworks.ai": "fireworks", "cerebras.ai": "cerebras",
    "sambanova.ai": "sambanova", "deepinfra.com": "deepinfra", "huggingface.co": "huggingface",
    "nvidia.com": "nvidia", "novita.ai": "novita", "hyperbolic.xyz": "hyperbolic", "nebius.com": "nebius",
    "perplexity.ai": "perplexity", "cohere.ai": "cohere", "moonshot.ai": "moonshot", "aliyuncs.com": "qwen",
    "z.ai": "zai", "minimax.io": "minimax", "ollama.com": "ollama", "lmstudio.ai": "lmstudio",
  }).find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1];
  return hostKey || fromName(input.name);
}

export function ProviderIcon({ providerKey, label, size = 18 }: { providerKey?: string; label?: string; size?: number }) {
  const key = providerKey ? (ICON_ALIASES[providerKey.toLowerCase().replace(/[^a-z0-9]/g, "")] || providerKey) : undefined;
  if (key === "atlas") return <AtlasMark size={size} className="shrink-0 text-ink" />;
  const icon = key ? PROVIDER_ICON_MARKUP[key] : undefined;
  const brand = key ? PROVIDER_COLOR[key] : undefined;
  if (!icon) return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-[5px] border border-line bg-active font-semibold text-ink-2" style={{ width: size, height: size, fontSize: size * 0.55 }}>{monogram(label || "?")}</span>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" style={{ width: size, height: size, color: brand }} className="shrink-0 text-current" dangerouslySetInnerHTML={{ __html: icon }} />;
}

function monogram(label: string) {
  const words = label.replace(/\(.*?\)/g, "").split(/[\s/.+-]+/).filter(Boolean);
  const w = words[0] || "?";
  const nextCap = w.slice(1).match(/[A-Z]/)?.[0];
  const text = words.length > 1 ? (words[0][0] + words[1][0]).toUpperCase() : nextCap ? (w[0] + nextCap).toUpperCase() : w.slice(0, 2);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ProviderTile({ label, size = 36, providerKey }: { label: string; size?: number; providerKey?: string }) {
  const key = providerKey ? (ICON_ALIASES[providerKey.toLowerCase().replace(/[^a-z0-9]/g, "")] || providerKey) : resolveProviderIconKey({ name: label });
  const known = !!(key && (key === "atlas" || PROVIDER_ICON_MARKUP[key]));
  const brand = key ? PROVIDER_COLOR[key] : undefined;
  return <span aria-hidden="true" style={{ width: size, height: size, background: brand ? `${brand}1f` : undefined, borderColor: brand ? `${brand}40` : undefined }}
    className={cx("shrink-0 rounded-[9px] border border-line flex items-center justify-center text-ink", known ? (brand ? "" : "bg-surface") : "bg-active font-semibold tracking-[-0.02em]") }>
    {known ? <ProviderIcon providerKey={key} label={label} size={Math.min(18, size * 0.52)} /> : <span style={{ fontSize: size * 0.36 }}>{monogram(label)}</span>}
  </span>;
}

export function isConnected(p: Preset, providers: Provider[]) {
  return providers.some((x) => x.kind === p.kind && (p.base_url ? (x.base_url || "").replace(/\/$/, "") === p.base_url.replace(/\/$/, "") : !!p.config?.oss === !!x.config?.oss));
}

type TestResult = { ok: boolean; error?: string; count?: number | null; models?: string[]; note?: string; version?: string };

/** Fields + Test + Connect for one preset. Test never saves anything; Connect stores the key in the Keychain. */
export function ConnectForm({ preset: p, onConnected, compact }: { preset: Preset; onConnected?: (provider: Provider, test: TestResult | null) => void; compact?: boolean }) {
  const [name, setName] = useState(""); const [url, setUrl] = useState(p.base_url || ""); const [key, setKey] = useState("");
  const [models, setModels] = useState(""); const [binary, setBinary] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => { setUrl(p.base_url || ""); setName(""); setKey(""); setModels(""); setBinary(""); setTest(null); }, [p.id]);
  useEffect(() => { setTest(null); }, [url, key, binary]);
  const cli = p.kind === "claude_code" || p.kind === "codex_cli";
  const body = () => {
    const config: any = { ...(p.config || {}) };
    if (models.trim()) {
      const list = models.split(",").map((s) => s.trim()).filter(Boolean);
      if (p.kind === "openai_compat") config.extra_models = [...(config.extra_models || []), ...list]; else config.models = list;
    }
    if (binary.trim()) config.binary = binary.trim();
    config.preset_id = p.id;
    return { kind: p.kind, name: name || p.label, base_url: url || undefined, api_key: key || undefined, config };
  };
  const runTest = async () => {
    setTesting(true);
    try { setTest(await api<TestResult>("/providers/test-config", { body: body() })); }
    catch (e: any) { setTest({ ok: false, error: e.message }); }
    finally { setTesting(false); }
  };
  const connect = async () => {
    const r = await run("c", () => api<Provider>("/providers", { body: body() }), `${name || p.label} connected`);
    if (r) { await api(`/providers/${r.id}/test`, { body: {} }).catch(() => {}); onConnected?.(r, test); }
  };
  const missing = (p.needs_key && !key) || (!cli && p.kind !== "anthropic" && p.kind !== "ollama" && !url);
  return (
    <div className="space-y-3.5">
      {!compact && (
        <div className="flex items-start gap-3">
          <ProviderTile label={p.label} size={42} providerKey={p.id} />
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-ink">{p.label}</div>
            <div className="text-[12.5px] text-ink-2 mt-0.5">{p.note}</div>
          </div>
        </div>
      )}
      {p.category === "cloud" && (
        <div className="flex gap-2 text-[12px] text-ink-2 leading-relaxed rounded-[10px] border border-line bg-surface px-3 py-2.5">
          <Lock size={13} className="mt-0.5 shrink-0 text-ink-3" />
          <span>Messages and code you send to {p.label === "Custom endpoint" ? "this endpoint" : p.label} leave your Mac and are handled under that provider's terms and
            privacy policy. Usage may be billed to your account. Your key is kept in the macOS Keychain, never in Atlas's database or logs.</span>
        </div>
      )}
      {!compact && <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={p.label} /></Field>}
      {!cli && p.kind !== "anthropic" && (
        <Field label="Base URL" hint={p.id === "custom" ? "For example https://api.example.com/v1" : undefined}>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="font-mono text-[12.5px]" /></Field>
      )}
      {(p.needs_key || p.kind === "openai_compat") && (
        <Field label={`API key${p.needs_key ? "" : " (optional)"}`}
          hint={p.key_url ? <button type="button" onClick={() => openExternal(p.key_url!)} className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink">Get a key from {p.label}<ExternalLink size={11} /></button> : undefined}>
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder={p.needs_key ? "Paste your key" : "Only if the server requires one"} /></Field>
      )}
      {!compact && (cli || p.kind === "openai_compat") && (
        <Field label={cli ? "Model names / aliases (optional)" : "Extra model IDs (optional)"}
          hint={p.kind === "claude_code" ? "Defaults: opus, sonnet, haiku." : p.kind === "codex_cli" ? "Leave empty to use your Codex default model." : "Only needed for servers that don't list their models."}>
          <Input value={models} onChange={(e) => setModels(e.target.value)} placeholder="comma separated" /></Field>
      )}
      {!compact && cli && (
        <Field label="CLI path (optional)" hint="Found automatically in PATH, ~/.local/bin, Homebrew and npm global folders.">
          <Input value={binary} onChange={(e) => setBinary(e.target.value)} placeholder={p.kind === "claude_code" ? "~/.local/bin/claude" : "/opt/homebrew/bin/codex"} /></Field>
      )}

      {test && (
        <div role="status" className={cx("anim-rise flex items-start gap-2 rounded-[10px] border px-3 py-2.5 text-[12.5px]",
          test.ok ? "border-line bg-surface text-ink" : "border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-bad-bg text-bad")}>
          {test.ok ? <Check size={14} className="mt-0.5 shrink-0 text-ok" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
          <div className="min-w-0">
            {test.ok ? (
              <>
                <div className="font-medium">Connection works{test.count != null ? ` · ${test.count} model${test.count === 1 ? "" : "s"} available` : ""}{test.version ? ` · ${test.version}` : ""}</div>
                {test.models && test.models.length > 0 && <div className="mt-0.5 text-ink-3 font-mono text-[11.5px] truncate">{test.models.slice(0, 6).join(" · ")}{(test.count || 0) > 6 ? " …" : ""}</div>}
                {test.note && <div className="mt-0.5 text-ink-3">{test.note}</div>}
              </>
            ) : <div className="selectable break-words">{test.error}</div>}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button onClick={runTest} disabled={missing || testing} busy={testing}>Test</Button>
        <Button variant="primary" onClick={connect} disabled={missing} busy={busy === "c"}>{test?.ok ? "Connect" : "Connect anyway"}</Button>
      </div>
      {!test && !missing && <div className="-mt-2 text-right text-[11.5px] text-ink-3">Test checks the endpoint without saving anything.</div>}
    </div>
  );
}

export function ConnectingSpinner() { return <Loader2 size={14} className="animate-spin text-ink-3" />; }
