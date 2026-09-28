import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
// Comments and strings can't hold braces that matter here, but strip comments
// so a brace in prose never skews the count.
const source = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Nesting depth of the first `selector {` for each top-level rule we rely on. */
function depthOf(selector) {
  const at = source.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${selector} rule is missing`);
  let depth = 0;
  for (const ch of source.slice(0, at)) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth;
}

test("stylesheet braces are balanced", () => {
  let depth = 0;
  for (const [index, ch] of [...source].entries()) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    assert.ok(depth >= 0, `unexpected "}" near character ${index}`);
  }
  assert.equal(depth, 0, "a block is left open; every rule after it is swallowed");
});

test("screen styles apply at every window size, not inside a media query", () => {
  for (const selector of [".welcome-layout", ".welcome-card", ".search-bar", ".button-primary", ".stash-overlay"]) {
    assert.equal(depthOf(selector), 0, `${selector} is nested inside another block`);
  }
});
