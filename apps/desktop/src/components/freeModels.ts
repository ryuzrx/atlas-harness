import type { Model } from "../api";

/** Provider offers checked against their linked documentation on 2026-11-06.
 * These describe account plans, not a guarantee that every listed model is free.
 */
export const FREE_MODEL_PROVIDERS = [
  { id: "openrouter", access: "Free models", note: "One key for many free models. Only free routes appear here; rate limits apply.", url: "https://openrouter.ai/collections/free-models" },
  { id: "groq", access: "Free tier", note: "Fast open models on Groq's Free plan. Per-model request and token limits apply.", url: "https://console.groq.com/docs/rate-limits" },
  { id: "gemini", access: "Free tier", note: "Selected Gemini models have free API quotas. Availability depends on model, region and account tier.", url: "https://ai.google.dev/gemini-api/docs/pricing" },
  { id: "mistral", access: "Free tier", note: "Use Mistral Studio's Free / Experiment plan for limited API access. Check which models your plan includes.", url: "https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request" },
  { id: "cohere", access: "Evaluation", note: "Free evaluation keys for prototyping, with monthly and per-minute limits. Production keys are billed.", url: "https://docs.cohere.com/docs/rate-limits" },
  { id: "nvidia", access: "Evaluation", note: "NVIDIA-hosted API access for development and evaluation. Registration, model terms and limits apply.", url: "https://build.nvidia.com" },
  { id: "huggingface", access: "Monthly credits", note: "Free accounts receive a small monthly Inference Providers credit allowance. Additional usage requires credits.", url: "https://huggingface.co/docs/inference-providers/pricing" },
  { id: "cerebras", access: "Trial credits", note: "One-time promotional credits for eligible accounts. A payment method is required; credits expire.", url: "https://www.cerebras.ai/pricing" },
  { id: "fireworks", access: "Trial credits", note: "Starter credits let eligible new accounts try inference. Continued usage after credits run out is paid.", url: "https://docs.fireworks.ai/faq-new/billing-pricing/what-happens-when-i-finish-my-1-dollar-credit" },
];

/** Only offer this connection's usable chat models; never pick a paid OpenRouter route. */
export function starterModels(models: Model[], providerId: string, presetId: string): Model[] {
  return models.filter((m) => {
    if (m.provider_id !== providerId || !m.name || m.error) return false;
    if (presetId === "openrouter") return m.name === "openrouter/free" || m.name.endsWith(":free");
    return !/embed|whisper|tts|speech|audio|rerank|moderation|guard|orpheus|ocr|transcri|flux|stable.diffusion|imagen/i.test(m.name);
  }).sort((a, b) => {
    if (a.name === "openrouter/free") return -1;
    if (b.name === "openrouter/free") return 1;
    return Number(b.capabilities?.tools === true) - Number(a.capabilities?.tools === true) || a.name!.localeCompare(b.name!);
  });
}
