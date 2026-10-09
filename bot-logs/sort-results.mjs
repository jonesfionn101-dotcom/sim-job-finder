/**
 * Sorts every search result into two folders on the PC:
 *   Job Results\Yes  - passed every rule (one file per server, VTC or job)
 *   Job Results\No   - ruled out, with the reason (internal-only roles land here)
 *
 * Reads the 📋 lists on GitHub. Files are only added or updated, never deleted,
 * so older finds stay. Run by run-latest.ps1 every 15 minutes.
 */

import {execSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = "jonesfionn101-dotcom/sim-job-finder";
const ROOT = process.env.RESULTS_DIR || "G:\\AI_Projects\\Job Results";
const YES = path.join(ROOT, "Yes");
const NO = path.join(ROOT, "No");
[YES, NO].forEach(dir => fs.mkdirSync(dir, {recursive: true}));

const safe = text => text.replace(/[<>:"/\\|?*\u0000-\u001f`]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
const issues = JSON.parse(execSync(`gh issue list --repo ${REPO} --state open --json title,body --limit 50`, {encoding: "utf8"}))
  .filter(issue => issue.title.startsWith("📋"));

let yes = 0, no = 0;
for (const {title, body} of issues) {
  const search = safe(title.replace(/^📋\s*/, "").split(":")[0]);
  const [main, ruledOut = ""] = body.split("<details>");
  for (const section of main.split(/^### /m).slice(1)) {
    const name = safe(section.split("\n")[0].replace(/^\d+\.\s*/, ""));
    fs.rmSync(path.join(NO, `${search} - ${name}.md`), {force: true}); // moved: no longer a no
    fs.writeFileSync(path.join(YES, `${search} - ${name}.md`), `# ✅ ${name}\nFrom: ${search} (${title.match(/\(updated [^)]+\)/)?.[0] || ""})\n\n${section.split("\n").slice(1).join("\n").trim()}\n`);
    yes++;
  }
  for (const line of ruledOut.split("\n").filter(l => l.startsWith("- "))) {
    const [name, ...why] = line.slice(2).split(": ");
    if (!why.length) continue;
    // A key that matches a Yes entry (same search, same name) moves it to No.
    for (const file of fs.readdirSync(YES).filter(f => f.startsWith(`${search} - ${safe(name)}`))) fs.rmSync(path.join(YES, file));
    fs.writeFileSync(path.join(NO, `${search} - ${safe(name)}.md`), `# ❌ ${name}\nFrom: ${search}\n\nWhy not: ${why.join(": ")}\n`);
    no++;
  }
}
console.log(`Sorted ${yes} into Yes and ${no} into No (${ROOT})`);
