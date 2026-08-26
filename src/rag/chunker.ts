import type { RepositoryDocumentChunk } from "./types.js";

export interface ChunkingOptions {
  chunkSize?: number;
  overlap?: number;
}

const DEFAULT_CHUNK_SIZE = 1_200;
const DEFAULT_OVERLAP = 200;

export function chunkDocument(
  content: string,
  options: ChunkingOptions = {},
): RepositoryDocumentChunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  validateOptions(chunkSize, overlap);

  const chunks: RepositoryDocumentChunk[] = [];
  let start = 0;

  while (start < content.length) {
    let end = Math.min(start + chunkSize, content.length);
    const boundary = content.lastIndexOf("\n", end);
    if (boundary > start + Math.floor(chunkSize / 2)) {
      end = boundary;
    }

    const chunk = content.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({ chunkIndex: chunks.length, content: chunk });
    }

    if (end === content.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function validateOptions(chunkSize: number, overlap: number): void {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new RangeError("chunkSize must be a positive integer.");
  }

  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new RangeError("overlap must be a non-negative integer smaller than chunkSize.");
  }
}
