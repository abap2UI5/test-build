import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveNames } from "../rename.mjs";

test("a customer name", () => {
  const n = deriveNames("ZABAP2UI5Z");
  assert.equal(n.prefix, "zabap2ui5z_");
  assert.equal(n.frontendName, "ZABAP2UI5Z");
  assert.equal(n.endpoint, "/sap/bc/zabap2ui5z");
  assert.equal(n.branch, "rename_zabap2ui5z");
});

test("a registered namespace, in both spellings", () => {
  for (const input of ["/abap2ui5/", "/ABAP2UI5/", "#abap2ui5#"]) {
    const n = deriveNames(input);
    assert.equal(n.prefix, "/abap2ui5/");
    assert.equal(n.frontendName, "/ABAP2UI5/");
    assert.equal(n.endpoint, "/sap/bc/abap2ui5/ui5");
    assert.equal(n.branch, "rename_abap2ui5");
  }
});

test("refused names", () => {
  assert.throws(() => deriveNames("z2ui5"), /original name/);
  assert.throws(() => deriveNames("zabap2ui5zz"), /at most 10/);
  assert.throws(() => deriveNames("/abap2ui5x/"), /at most 10/);
  assert.throws(() => deriveNames("/abap2ui5"), /neither/);
  assert.throws(() => deriveNames("2abap"), /neither/);
  assert.throws(() => deriveNames(""), /needed/);
});
