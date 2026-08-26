import { DocumentExtractionError } from "./errors.js";
import { isIndexablePath, normalizeRepositoryPath } from "./document-paths.js";
import type { RepositoryDocumentSource } from "./types.js";

export function extractIndexableDocuments(
  documents: RepositoryDocumentSource[],
): RepositoryDocumentSource[] {
  return documents
    .map((document) => ({ ...document, path: normalizeRepositoryPath(document.path) }))
    .filter((document) => isIndexablePath(document.path))
    .map((document) => ({
      ...document,
      content: extractTextDocument(document.path, document.content),
    }));
}

export function extractTextDocument(path: string, content: string): string {
  const normalizedPath = normalizeRepositoryPath(path);
  if (content.includes("\u0000")) {
    throw new DocumentExtractionError(normalizedPath, "binary content is not indexable.");
  }

  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (text.length === 0) {
    throw new DocumentExtractionError(normalizedPath, "document is empty.");
  }

  return text;
}
