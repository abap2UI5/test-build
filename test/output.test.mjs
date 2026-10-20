import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { badge, lintConfig, renamedSrc } from "../rename.mjs";

// abaplint --rename writes <output>/<absolute path of the checkout>/src; a
// checkout whose own path has a folder named src (~/src/abap2UI5) must not
// be taken for it
test("the renamed src of a checkout below a folder named src", () => {
  const root = mkdtempSync(join(tmpdir(), "test-build-"));
  try {
    const checkout = join(root, "src", "abap2UI5");
    const output = join(root, "output");
    const expected = join(output, checkout, "src");
    mkdirSync(join(expected, "00"), { recursive: true });
    assert.equal(renamedSrc(output, checkout), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no renamed src at all", () => {
  const root = mkdtempSync(join(tmpdir(), "test-build-"));
  try {
    mkdirSync(join(root, "output"), { recursive: true });
    assert.equal(renamedSrc(join(root, "output"), join(root, "abap2UI5")), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// the branch's own config and the shields.io endpoint of its badge
test("the lint config of the result", () => {
  const cfg = JSON.parse(lintConfig());
  assert.equal(cfg.global.files, "/src/**/*.*");
  assert.equal(cfg.syntax.errorNamespace, ".");
  assert.ok(cfg.dependencies.every((d) => d.folder.startsWith("/deps/")));
});

test("the badge", () => {
  assert.deepEqual(JSON.parse(badge(0)), { schemaVersion: 1, label: "abaplint", message: "passing", color: "brightgreen" });
  assert.equal(JSON.parse(badge(1)).message, "1 issue");
  assert.equal(JSON.parse(badge(3)).message, "3 issues");
  assert.equal(JSON.parse(badge(3)).color, "red");
});
