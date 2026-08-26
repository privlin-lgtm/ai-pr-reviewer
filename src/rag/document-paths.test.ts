import assert from "node:assert/strict";
import test from "node:test";

import { extractIndexableDocuments } from "./document-extractor.js";
import { DocumentExtractionError } from "./errors.js";
import { selectIndexablePaths } from "./document-paths.js";

test("selects only configured repository standards paths", () => {
  assert.deepEqual(
    selectIndexablePaths([
      "docs/reviewing.md",
      "README.md",
      "src/index.ts",
      "architecture/decisions.md",
      "CONTRIBUTING.md",
      "docs/reviewing.md",
    ]),
    [
      "CONTRIBUTING.md",
      "README.md",
      "architecture/decisions.md",
      "docs/reviewing.md",
    ],
  );
});

test("extracts normalized text only from indexable documents and rejects unsafe paths", () => {
  assert.deepEqual(
    extractIndexableDocuments([
      { path: "README.md", sha: "readme-sha", content: "\uFEFFHello\r\nWorld\r\n" },
      { path: "src/index.ts", sha: "source-sha", content: "const ignored = true;" },
    ]),
    [{ path: "README.md", sha: "readme-sha", content: "Hello\nWorld" }],
  );

  assert.throws(() => selectIndexablePaths(["docs/../secrets.md"]), DocumentExtractionError);
});
