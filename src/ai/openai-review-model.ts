import OpenAI from "openai";

import { InvalidAIReviewResponseError } from "./errors.js";
import type {
  StructuredReviewModel,
  StructuredReviewModelRequest,
} from "./types.js";

export class OpenAIReviewModel implements StructuredReviewModel {
  constructor(private readonly client: OpenAI) {}

  async complete(request: StructuredReviewModelRequest): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: request.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
    });

    const content = completion.choices[0]?.message.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new InvalidAIReviewResponseError("OpenAI returned an empty review response.");
    }

    return content;
  }
}
