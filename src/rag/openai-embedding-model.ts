import OpenAI from "openai";

import { EmbeddingResponseError } from "./errors.js";
import type { EmbeddingModel } from "./types.js";

export class OpenAIEmbeddingModel implements EmbeddingModel {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    private readonly dimensions: number,
  ) {}

  async embed(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: inputs,
      dimensions: this.dimensions,
    });

    const embeddings = [...response.data]
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);

    if (embeddings.length !== inputs.length) {
      throw new EmbeddingResponseError("OpenAI returned an unexpected number of embeddings.");
    }

    if (embeddings.some((embedding) => embedding.length !== this.dimensions)) {
      throw new EmbeddingResponseError(
        `OpenAI embeddings must have ${this.dimensions} dimensions.`,
      );
    }

    return embeddings;
  }
}
