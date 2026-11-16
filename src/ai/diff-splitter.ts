export interface DiffPart {
  content: string;
  paths: string[];
}

export interface SplitDiffResult {
  parts: DiffPart[];
  skippedPaths: string[];
}

interface DiffPiece {
  content: string;
  path: string;
}

const FILE_HEADER = /^diff --git /m;
const HUNK_HEADER = /^@@ /m;

/**
 * Splits a unified diff into parts of at most `maximumCharacters` each, without
 * breaking a hunk. Files are kept whole when they fit; a file that does not fit
 * is split between hunks, and each piece repeats the file header so hunk line
 * numbers stay meaningful. A single hunk that is larger than the limit cannot be
 * reviewed, and its file is reported in `skippedPaths`. At most `maximumParts`
 * parts are returned; files that do not fit in them are also reported. A path in
 * `skippedPaths` was not reviewed in full, though some of its hunks may have been.
 */
export function splitDiff(
  diff: string,
  maximumCharacters: number,
  maximumParts: number,
): SplitDiffResult {
  const skipped = new Set<string>();
  const pieces: DiffPiece[] = [];

  for (const file of splitAt(diff, FILE_HEADER)) {
    const path = readPath(file);
    if (file.length <= maximumCharacters) {
      pieces.push({ content: file, path });
      continue;
    }

    const firstHunk = file.search(HUNK_HEADER);
    if (firstHunk === -1) {
      skipped.add(path);
      continue;
    }

    const header = file.slice(0, firstHunk);
    const hunks = splitAt(file.slice(firstHunk), HUNK_HEADER);
    let current = header;
    for (const hunk of hunks) {
      if (header.length + hunk.length > maximumCharacters) {
        skipped.add(path);
        continue;
      }
      if (current.length + hunk.length > maximumCharacters) {
        pieces.push({ content: current, path });
        current = header;
      }
      current += hunk;
    }
    if (current !== header) {
      pieces.push({ content: current, path });
    }
  }

  const parts: DiffPart[] = [];
  for (const piece of pieces) {
    const last = parts.at(-1);
    if (last !== undefined && last.content.length + piece.content.length <= maximumCharacters) {
      last.content += piece.content;
      if (!last.paths.includes(piece.path)) {
        last.paths.push(piece.path);
      }
      continue;
    }

    if (parts.length >= maximumParts) {
      skipped.add(piece.path);
      continue;
    }
    parts.push({ content: piece.content, paths: [piece.path] });
  }

  return { parts, skippedPaths: [...skipped] };
}

function splitAt(text: string, header: RegExp): string[] {
  const flags = header.flags.includes("g") ? header.flags : `${header.flags}g`;
  const starts = [...text.matchAll(new RegExp(header.source, flags))].map(
    (match) => match.index,
  );
  if (starts.length === 0) {
    return [text];
  }

  const sections: string[] = [];
  if (starts[0]! > 0) {
    sections.push(text.slice(0, starts[0]));
  }
  starts.forEach((start, index) => {
    sections.push(text.slice(start, starts[index + 1] ?? text.length));
  });
  return sections;
}

function readPath(file: string): string {
  const match = /^diff --git a\/(.*?) b\//.exec(file);
  return match?.[1] ?? "<unknown>";
}
