import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
test("the generated frontend has a typed React root and migrated app shell", async () => { const [html, entry, app] = await Promise.all([read("../src/index.html"), read("../src/main.tsx"), read("../src/app/App.tsx")]); assert.match(html, /<div id="root"><\/div>/); assert.match(html, /<script type="module" src="\.\/main\.tsx"><\/script>/); assert.match(entry, /createRoot\(rootElement\)\.render/); assert.match(app, /TitleBar/); assert.match(app, /restoreSession/); assert.doesNotMatch(app, /foundation is ready|migration continues/); });
