export interface AIReviewConfig {
  apiKey: string;
  model: string;
}

const DEFAULT_REVIEW_MODEL = "gpt-4.1-mini";

export function loadAIReviewConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AIReviewConfig {
  const apiKey = environment.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const model = environment.OPENAI_REVIEW_MODEL?.trim() || DEFAULT_REVIEW_MODEL;
  return { apiKey, model };
}
