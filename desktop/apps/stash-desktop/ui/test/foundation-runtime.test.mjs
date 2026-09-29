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

test("Files breadcrumb follows Figma: STASH root, parent links, current folder, item count", () => {
  const root = runtime.renderBreadcrumb([], 3);
  assert.match(root, /<nav class="ui-breadcrumb" aria-label="Folder path">/);
  assert.match(root, /<span class="ui-breadcrumb-root" aria-current="page"><img[^>]*>STASH<\/span>/);
  assert.match(root, /3 items<\/span>/);
  assert.doesNotMatch(root, /<button/);

  const deep = runtime.renderBreadcrumb([{ id: "a", name: "Sample Libraries" }, { id: "b", name: "KSHMR Vol 5" }, { id: "c", name: "Kicks" }], 1);
  assert.match(deep, /<button type="button" class="ui-breadcrumb-root"><img[^>]*>STASH<\/button>/);
  assert.equal((deep.match(/<button/g) ?? []).length, 3, "root and both parents are links back");
  assert.match(deep, /<span aria-current="page" title="Kicks">Kicks<\/span>/);
  assert.match(deep, /1 item<\/span>/);
  assert.doesNotMatch(runtime.renderBreadcrumb([{ id: "a", name: "A" }]), /ui-breadcrumb-count/, "no count while the folder is loading");
});

test("Search filters are built only from the returned files and narrow them", () => {
  const hit = (fileId, extension, key, bpm) => ({ fileId, name: `${fileId}.${extension}`, path: `Pack/${fileId}.${extension}`, sizeBytes: 1, kind: "audio", extension, key, bpm, resolution: null, fps: null });
  const hits = [hit("a", "wav", "G#", 128), hit("b", "wav", "G#", 124), hit("c", "mp3", "Am", null)];
  assert.deepEqual(runtime.facetGroups(hits), [
    { id: "type", title: "File type", values: [{ label: "WAV", count: 2 }, { label: "MP3", count: 1 }] },
    { id: "key", title: "Key", values: [{ label: "G#", count: 2 }, { label: "Am", count: 1 }] },
    { id: "tempo", title: "Tempo", values: [{ label: "124 BPM", count: 1 }, { label: "128 BPM", count: 1 }] },
  ]);
  assert.deepEqual(runtime.applyFacets(hits, { type: "WAV", tempo: "128 BPM" }).map((h) => h.fileId), ["a"]);
  assert.equal(runtime.applyFacets(hits, {}).length, 3);
  assert.deepEqual(runtime.facetGroups([]), [], "no files, no made-up filters");
});

test("previews stream only known types, from the app's own stash.localhost", () => {
  assert.equal(runtime.previewKindOf("Kick_G#_128.WAV"), "audio");
  assert.equal(runtime.previewKindOf("brief.pdf"), "pdf");
  assert.equal(runtime.previewKindOf("setup.exe"), null);
  assert.equal(runtime.previewUrl("k1", "Kick.wav", 4800), "http://stash.localhost/k1/4800/wav");
  assert.equal(runtime.previewUrl("../x", "Kick.wav", 4800), null, "an id can't escape its path");
  assert.equal(runtime.previewUrl("k1", "notes.docx", 10), null);
  assert.equal(runtime.previewUrl("k1", "Kick.wav", 0), null);
});

test("the player shows Figma time and a waveform from real samples", () => {
  assert.equal(runtime.clock(2.46), "00:02.46");
  assert.equal(runtime.clock(125.5), "02:05.50");
  assert.equal(runtime.clock(Number.NaN), "00:00.00");
  const loudThenQuiet = new Float32Array(3200).map((_, i) => (i < 1600 ? 0.8 : 0.2));
  const bars = runtime.peaks([loudThenQuiet], 2);
  assert.deepEqual(bars.map((b) => Math.round(b * 100)), [100, 25]);
  assert.deepEqual(runtime.peaks([new Float32Array(0)], 10), []);
});

test("Back and Forward move through visited places like Explorer", () => {
  let history = runtime.startHistory("STASH");
  assert.equal(runtime.canGoBack(history), false);
  history = runtime.visit(history, "Samples");
  history = runtime.visit(history, "Samples/Kick.wav details");
  history = runtime.goBack(history);
  assert.equal(runtime.currentPlace(history), "Samples");
  assert.equal(runtime.canGoForward(history), true);
  history = runtime.goForward(history);
  assert.equal(runtime.currentPlace(history), "Samples/Kick.wav details");
  assert.equal(runtime.goForward(history), history, "nothing ahead: forward stays put");
  // Going somewhere new from the middle drops what was ahead, like a browser.
  history = runtime.visit(runtime.goBack(runtime.goBack(history)), "Loops");
  assert.deepEqual(history.entries, ["STASH", "Loops"]);
  assert.equal(runtime.canGoForward(history), false);
  let long = runtime.startHistory(0);
  for (let i = 1; i <= 150; i += 1) long = runtime.visit(long, i);
  assert.equal(long.entries.length, 100, "history is capped");
  assert.equal(runtime.currentPlace(long), 150);
});

test("Back / Forward buttons are named and disabled when there's nowhere to go", () => {
  const html = runtime.renderHistoryButtons(true, false);
  assert.match(html, /<div class="ui-history" role="group" aria-label="Navigation">/);
  assert.match(html, /<button type="button" aria-label="Back" title="Back \(Alt\+←\)">/);
  assert.match(html, /<button type="button" aria-label="Forward" title="Forward \(Alt\+→\)" disabled="">/);
});

test("a Search breadcrumb finds folders by name, stopping at the deepest one found", async () => {
  const tree = {
    ROOT: [{ entity: "FOLDER", folderId: "f1", name: "Sample Libraries" }, { entity: "FILE", fileId: "x", name: "KSHMR Vol 5" }],
    f1: [{ entity: "FOLDER", folderId: "f2", name: "KSHMR Vol 5" }],
    f2: [],
  };
  const listChildren = async (id) => ({ items: tree[id] });
  assert.deepEqual(await runtime.resolveFolders(listChildren, ["sample libraries", "KSHMR Vol 5"]), [{ id: "f1", name: "Sample Libraries" }, { id: "f2", name: "KSHMR Vol 5" }]);
  assert.deepEqual(await runtime.resolveFolders(listChildren, ["Sample Libraries", "Gone", "KSHMR Vol 5"]), [{ id: "f1", name: "Sample Libraries" }]);
  assert.deepEqual(await runtime.resolveFolders(listChildren, []), []);
});

test("gateway property harness uses only fake invoke and never a browser/backend transport", async () => {
  const result = await runtime.runGatewayProperties();
  assert.equal(result.seeds[0], 0x1a2b3c4d);
  assert.ok(result.cases >= 17);
});
