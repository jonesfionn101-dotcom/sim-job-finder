// Guards against the "line problem" (10 Oct 2026): edits that turned \b into an
// invisible backspace, or \n into a real line break inside a string, kept
// breaking the bots. This fails if any code file contains those broken characters,
// so a broken file can never be saved (pre-commit hook) or run (GitHub tests).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {test} from "node:test";

const ROOT = path.join(import.meta.dirname, "..");
const CODE = /\.(mjs|js|ps1|sh|yml|json)$/;
const files = fs.readdirSync(ROOT, {recursive: true})
  .map(String)
  .filter(f => CODE.test(f) && !f.includes("node_modules") && !f.startsWith(".git" + path.sep));

test("no invisible control characters (a \\b that became a backspace, etc.)", () => {
  const broken = files.filter(f => /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(broken, [], `broken characters in: ${broken.join(", ")}`);
});

test("every bot script still loads", async () => {
  const {execFileSync} = await import("node:child_process");
  for (const f of files.filter(f => f.endsWith(".mjs") && !f.includes(path.sep + "tests" + path.sep) && !f.startsWith("tests"))) {
    execFileSync(process.execPath, ["--check", path.join(ROOT, f)], {stdio: "pipe"});
  }
});
