import { DocumentExtractionError } from "./errors.js";

export function selectIndexablePaths(paths: Iterable<string>): string[] {
  return [...new Set([...paths].map(normalizeRepositoryPath).filter(isIndexablePath))].sort();
}

export function isIndexablePath(path: string): boolean {
  return (
    path === "README.md" ||
    path === "CONTRIBUTING.md" ||
    path.startsWith("docs/") ||
    path.startsWith("architecture/")
  );
}

export function normalizeRepositoryPath(path: string): string {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
    throw new DocumentExtractionError(path, "path must be a non-empty repository-relative POSIX path.");
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new DocumentExtractionError(path, "path contains an unsafe segment.");
  }

  return path;
}
