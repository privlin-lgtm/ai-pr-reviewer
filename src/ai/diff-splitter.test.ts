import assert from "node:assert/strict";
import test from "node:test";

import { splitDiff } from "./diff-splitter.js";

function fileDiff(path: string, hunks: string[]): string {
  return [
    `diff --git a/${path} b/${path}\n`,
    `--- a/${path}\n`,
    `+++ b/${path}\n`,
    ...hunks,
  ].join("");
}

function hunk(start: number, body: string): string {
  return `@@ -${start},1 +${start},1 @@\n-old\n+${body}\n`;
}

test("keeps a diff that fits in one part unchanged", () => {
  const diff = fileDiff("src/a.ts", [hunk(1, "a")]) + fileDiff("src/b.ts", [hunk(1, "b")]);

  const result = splitDiff(diff, diff.length, 4);

  assert.deepEqual(result.parts, [{ content: diff, paths: ["src/a.ts", "src/b.ts"] }]);
  assert.deepEqual(result.skippedPaths, []);
});

test("splits between files and keeps every file whole when it fits", () => {
  const a = fileDiff("src/a.ts", [hunk(1, "a".repeat(40))]);
  const b = fileDiff("src/b.ts", [hunk(1, "b".repeat(40))]);

  const result = splitDiff(a + b, Math.max(a.length, b.length), 4);

  assert.deepEqual(
    result.parts.map((part) => part.content),
    [a, b],
  );
  assert.deepEqual(result.skippedPaths, []);
});

test("splits a large file between hunks and repeats its header", () => {
  const first = hunk(1, "x".repeat(30));
  const second = hunk(50, "y".repeat(30));
  const file = fileDiff("src/big.ts", [first, second]);
  const header = file.slice(0, file.indexOf("@@"));

  const result = splitDiff(file, header.length + Math.max(first.length, second.length), 4);

  assert.deepEqual(
    result.parts.map((part) => part.content),
    [header + first, header + second],
  );
  assert.deepEqual(result.skippedPaths, []);
});

test("reports a hunk larger than the limit and files beyond the part limit", () => {
  const small = fileDiff("src/small.ts", [hunk(1, "s")]);
  const huge = fileDiff("src/huge.ts", [hunk(1, "h".repeat(500))]);
  const late = fileDiff("src/late.ts", [hunk(1, "l".repeat(small.length))]);

  const result = splitDiff(small + huge + late, small.length + 5, 1);

  assert.deepEqual(result.parts, [{ content: small, paths: ["src/small.ts"] }]);
  assert.deepEqual(result.skippedPaths, ["src/huge.ts", "src/late.ts"]);
});
