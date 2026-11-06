import { test } from "node:test";
import assert from "node:assert/strict";
import { starterModels } from "../src/components/freeModels.ts";

const model = (name, provider_id = "chosen", capabilities = {}) => ({ name, provider_id, capabilities, state: "available" });

test("OpenRouter setup excludes paid models and other providers", () => {
  const models = [model("paid/coder"), model("qwen/coder:free"), model("openrouter/free"), model("other:free", "other")];
  assert.deepEqual(starterModels(models, "chosen", "openrouter").map(m => m.name), ["openrouter/free", "qwen/coder:free"]);
});

test("starter choices omit failed, nameless and non-chat models", () => {
  const models = [model("whisper-large-v3"), model("embed-v4"), model(null), { ...model("failed"), error: "Unavailable" }, model("coder")];
  assert.deepEqual(starterModels(models, "chosen", "groq").map(m => m.name), ["coder"]);
});

test("tool-capable models appear first without selecting an unavailable model", () => {
  const models = [model("a-chat"), model("z-coder", "chosen", { tools: true }), model("outsider", "other")];
  assert.deepEqual(starterModels(models, "chosen", "groq").map(m => m.name), ["z-coder", "a-chat"]);
});

test("OCR, transcription and image generators are excluded while vision chat remains", () => {
  const models = [model("mistral-ocr-latest"), model("voxtral-mini-transcribe"), model("black-forest-labs/FLUX.1-schnell"), model("stable-diffusion-xl"), model("pixtral-large-latest")];
  assert.deepEqual(starterModels(models, "chosen", "mistral").map(m => m.name), ["pixtral-large-latest"]);
});
