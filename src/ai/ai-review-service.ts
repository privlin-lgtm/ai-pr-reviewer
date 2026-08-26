import OpenAI from "openai";

import { AIReviewEngine, type AIReviewEngineOptions } from "./ai-review-engine.js";
import type { AIReviewConfig } from "./config.js";
import { OpenAIReviewModel } from "./openai-review-model.js";

export function createAIReviewEngine(
  config: AIReviewConfig,
  options: Omit<AIReviewEngineOptions, "model"> = {},
): AIReviewEngine {
  return new AIReviewEngine(new OpenAIReviewModel(new OpenAI({ apiKey: config.apiKey })), {
    ...options,
    model: config.model,
  });
}
