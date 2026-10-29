import OpenAI from "openai";

import { InvalidAIReviewResponseError } from "./errors.js";
import type {
  StructuredReviewModel,
  StructuredReviewModelRequest,
} from "./types.js";

const MAXIMUM_COMPLETION_TOKENS = 8_192;

export class OpenAIReviewModel implements StructuredReviewModel {
  constructor(private readonly client: OpenAI) {}

  async complete(request: StructuredReviewModelRequest): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: request.model,
      max_completion_tokens: MAXIMUM_COMPLETION_TOKENS,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
    });

    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") {
      throw new InvalidAIReviewResponseError(
        `OpenAI stopped the review at the ${MAXIMUM_COMPLETION_TOKENS}-token output limit.`,
      );
    }
    const content = choice?.message.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new InvalidAIReviewResponseError("OpenAI returned an empty review response.");
    }

    return content;
  }
}
