import assert from "node:assert/strict";
import test from "node:test";

import { chunkDocument } from "./chunker.js";

test("chunks documents with deterministic indexes and overlap", () => {
  const chunks = chunkDocument("abcdefghijklmnopqrstuvwx", {
    chunkSize: 10,
    overlap: 3,
  });

  assert.deepEqual(chunks, [
    { chunkIndex: 0, content: "abcdefghij" },
    { chunkIndex: 1, content: "hijklmnopq" },
    { chunkIndex: 2, content: "opqrstuvwx" },
  ]);
});

test("rejects an overlap that cannot make forward progress", () => {
  assert.throws(
    () => chunkDocument("content", { chunkSize: 10, overlap: 10 }),
    RangeError,
  );
});
