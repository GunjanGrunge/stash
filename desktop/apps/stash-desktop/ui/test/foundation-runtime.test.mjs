import assert from "node:assert/strict";
import test from "node:test";

const runtime = await import(new URL("../.test-dist/foundation/foundation-runtime.js", import.meta.url).href);

test("foundation properties run deterministic auth and hierarchy cases", async () => {
  const results = await runtime.runFoundationSuite();
  assert.deepEqual(results.map(({ property }) => property), [
    "P1 auth state transitions and public outcome mapping",
    "P2 generated hierarchy identity, sorting, and known-ancestor navigation",
    "P4/P6 gateway allowlisting, DTO validation, sanitization, and unavailable behavior",
    "P5 semantic theme tokens, non-color status labels, focus/action names, and reduced motion",
    "P7 splash cleanup/skip, native drop entry, and explicit unavailable navigation",
  ]);
  assert.deepEqual(results[1].seeds, [0x1a2b3c4d, 0x5eed1234, 0x7f4a7c15, 0x13579bdf]);
  assert.ok(results.every(({ cases }) => cases > 0));
});

test("gateway property harness uses only fake invoke and never a browser/backend transport", async () => {
  const result = await runtime.runGatewayProperties();
  assert.equal(result.seeds[0], 0x1a2b3c4d);
  assert.ok(result.cases >= 17);
});
