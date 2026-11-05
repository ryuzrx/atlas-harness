import React from "react";
import { PROVIDER_ICON_MARKUP } from "./providerIcons";
import { AtlasMark } from "./Logo";

/** Company behind a model, with its brand colour. Marks come from the provider icon set where available. */
export interface Brand { key: string; label: string; color?: string; icon?: string }

const MS = '<path d="M1 1h10v10H1z" fill="#F25022"/><path d="M13 1h10v10H13z" fill="#7FBA00"/><path d="M1 13h10v10H1z" fill="#00A4EF"/><path d="M13 13h10v10H13z" fill="#FFB900"/>';
const META = '<path d="M6.8 7.4C4.6 7.4 3 9.5 3 12c0 1.9.9 3.2 2.3 3.2 1.2 0 2.2-.9 3.8-3.6l.9-1.5C11.3 8.2 12.4 7.4 13.8 7.4c2.4 0 4.2 2.2 4.2 4.9 0 2-.9 3-2.1 3-1.4 0-2.4-1-4-3.7" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" transform="translate(1.2 0)"/>';
const ICONS: Record<string, string> = { ...PROVIDER_ICON_MARKUP, microsoft: MS, meta: META };

const BRANDS: Record<string, Omit<Brand, "key">> = {
  meta: { label: "Meta", color: "#0A7CFF" }, qwen: { label: "Alibaba Qwen", color: "#7B6CF6" }, google: { label: "Google", color: "#4C8DF6" },
  openai: { label: "OpenAI", color: "#10A37F" }, mistral: { label: "Mistral AI", color: "#FA6A2A" }, microsoft: { label: "Microsoft", color: "#00A4EF" },
  ibm: { label: "IBM", color: "#4589FF" }, deepseek: { label: "DeepSeek", color: "#5B7CFF" }, ai2: { label: "AI2", color: "#F0529C" },
  huggingface: { label: "Hugging Face", color: "#E8A900" }, nvidia: { label: "NVIDIA", color: "#76B900" }, anthropic: { label: "Anthropic", color: "#D97757" },
  xai: { label: "xAI" }, llava: { label: "LLaVA", color: "#A78BFA" }, nomic: { label: "Nomic", color: "#34D399" },
  cogito: { label: "Deep Cogito", color: "#F59E0B" }, agentica: { label: "Agentica", color: "#22D3EE" },
  cohere: { label: "Cohere", color: "#7FD1AE" }, perplexity: { label: "Perplexity", color: "#22B8CD" }, moonshot: { label: "Moonshot AI", color: "#A78BFA" },
  zai: { label: "Z.ai", color: "#7C8CFF" }, minimax: { label: "MiniMax", color: "#F23F5D" },
};
const ICON_KEY: Record<string, string> = { google: "gemini" };
const RULES: [RegExp, string][] = [
  [/^(llama|codellama|tinyllama)/, "meta"], [/^(qwen|qwq)/, "qwen"], [/^(gemma|codegemma|paligemma)/, "google"], [/^gpt-oss/, "openai"],
  [/^(mistral|mixtral|magistral|devstral|codestral|ministral)/, "mistral"], [/^phi/, "microsoft"], [/^granite/, "ibm"], [/^deepseek/, "deepseek"],
  [/^olmo/, "ai2"], [/^(smollm|starcoder)/, "huggingface"], [/^nemotron/, "nvidia"], [/^llava/, "llava"], [/^nomic/, "nomic"],
  [/^cogito/, "cogito"], [/^deepcoder/, "agentica"],
  [/^(claude|anthropic)/, "anthropic"], [/^(gpt|chatgpt|o[1-9](-|$)|text-embedding|davinci|codex)/, "openai"], [/^(gemini|gemma|palm|bard)/, "google"],
  [/^(grok)/, "xai"], [/^(command|aya)/, "cohere"], [/^(sonar|pplx)/, "perplexity"], [/^(kimi|moonshot)/, "moonshot"], [/^(glm|chatglm)/, "zai"], [/^(minimax|abab)/, "minimax"],
];
// "vendor/model" ids (OpenRouter and similar) name the creator directly
const VENDORS: Record<string, string> = { anthropic: "anthropic", openai: "openai", google: "google", "meta-llama": "meta", meta: "meta", mistralai: "mistral", mistral: "mistral", deepseek: "deepseek", "deepseek-ai": "deepseek", qwen: "qwen", "x-ai": "xai", xai: "xai", nvidia: "nvidia", cohere: "cohere", perplexity: "perplexity", moonshotai: "moonshot", "z-ai": "zai", microsoft: "microsoft", minimax: "minimax", ibm: "ibm", "ibm-granite": "ibm" };

export function brandFor(model?: string | null): Brand | null {
  if (!model) return null;
  const parts = model.toLowerCase().split("/");
  const base = parts.pop()!;
  const vendor = parts.length ? VENDORS[parts[parts.length - 1]] : undefined;
  const key = vendor || RULES.find(([re]) => re.test(base))?.[1];
  if (!key || !BRANDS[key]) return null;
  return { key, ...BRANDS[key], icon: ICONS[ICON_KEY[key] || key] };
}

/** Rounded tile with the company's logo in its brand colour (monogram when no logo exists). */
export function BrandMark({ model, brand, fallbackIconKey, label, size = 32 }: { model?: string | null; brand?: Brand | null; fallbackIconKey?: string; label?: string; size?: number }) {
  const b = brand === undefined ? brandFor(model) : brand;
  const fallback = fallbackIconKey ? PROVIDER_ICON_MARKUP[fallbackIconKey] : undefined;
  const markup = b?.icon || fallback;
  if (!markup && fallbackIconKey === "atlas") return <span aria-hidden="true" style={{ width: size, height: size }} className="shrink-0 rounded-md border border-line bg-surface flex items-center justify-center text-ink"><AtlasMark size={size * 0.6} /></span>;
  const color = b?.color;
  const text = (b?.label || label || "?").replace(/[^A-Za-z0-9 ]/g, "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span aria-hidden="true" title={b?.label || label} style={{ width: size, height: size, color: color || undefined, background: color ? `${color}1f` : undefined, borderColor: color ? `${color}40` : undefined }}
      className="shrink-0 rounded-md border border-line flex items-center justify-center text-ink-2">
      {markup
        ? <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: size * 0.56, height: size * 0.56 }} dangerouslySetInnerHTML={{ __html: markup }} />
        : <span className="font-semibold" style={{ fontSize: size * 0.38 }}>{text}</span>}
    </span>
  );
}
