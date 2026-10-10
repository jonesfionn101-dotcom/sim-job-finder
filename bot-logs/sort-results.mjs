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
// 10 Oct 2026: the bots never decide for him. Jobs that pass every rule wait in
// "To check" until HE says yes or no (pop-up buttons move them to Yes or No).
// Jobs the bots rule out go to "Ruled out by bots". Yes and No hold only his answers.
const YES = path.join(ROOT, "To check");
const NO = path.join(ROOT, "Ruled out by bots");
const HIS_YES = path.join(ROOT, "Yes");
const HIS_NO = path.join(ROOT, "No");
[YES, NO, HIS_YES, HIS_NO].forEach(dir => fs.mkdirSync(dir, {recursive: true}));
// Searches that can produce ticket jobs. Others (code jobs, app projects) are
// ruled out while the focus is ticket jobs; add them back here when he asks.
const TICKET_SEARCHES = /^(Community search|VTC shortlist|UK VTC search|Waiting watch)$/;
const decided = file => fs.existsSync(path.join(HIS_YES, file)) || fs.existsSync(path.join(HIS_NO, file));

// Plain filenames only: brackets, # and dashes like "—" made files impossible to move.
const safe = text => text.replace(/[^A-Za-z0-9 &()._,'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
const issues = JSON.parse(execSync(`gh issue list --repo ${REPO} --state open --json title,body --limit 50`, {encoding: "utf8"}))
  .filter(issue => issue.title.startsWith("📋") && !issue.title.includes("Worldwide test")); // test results never go in Yes/No

let yes = 0, no = 0;
for (const {title, body} of issues) {
  const search = safe(title.replace(/^📋\s*/, "").split(":")[0]);
  const [main, ruledOut = ""] = body.split("<details>");
  // Results from Claude's own fresh searches are labelled so they stand out.
  const fresh = body.startsWith("🆕") ? `🆕 New information (searched by Claude, ${title.match(/updated ([^)]+)/)?.[1] || "today"})\n` : "";
  for (const section of main.split(/^### /m).slice(1)) {
    const name = safe(section.split("\n")[0].replace(/^\d+\.\s*/, ""));
    if (decided(`${search} - ${name}.md`)) continue; // he has already answered this one
    // Ticket jobs only (10 Oct 2026): code and app projects never reach "To check" for now.
    if (!TICKET_SEARCHES.test(search)) {
      fs.writeFileSync(path.join(NO, `${search} - ${name}.md`), `# ❌ ${name}\nFrom: ${search}\n\nWhy not: not a ticket job (ticket jobs only for now)\n`);
      no++;
      continue;
    }
    fs.rmSync(path.join(NO, `${search} - ${name}.md`), {force: true}); // moved: no longer a no
    fs.writeFileSync(path.join(YES, `${search} - ${name}.md`), `# ✅ ${name}\n${fresh}From: ${search} (${title.match(/\(updated [^)]+\)/)?.[0] || ""})\n\n${section.split("\n").slice(1).join("\n").trim()}\n`);
    yes++;
  }
  for (const line of ruledOut.split("\n").filter(l => l.startsWith("- "))) {
    const [name, ...why] = line.slice(2).split(": ");
    if (!why.length) continue;
    // A key that matches a Yes entry (same search, same name) moves it to No.
    for (const file of fs.readdirSync(YES).filter(f => f.startsWith(`${search} - ${safe(name)}`))) fs.rmSync(path.join(YES, file));
    fs.writeFileSync(path.join(NO, `${search} - ${safe(name)}.md`), `# ❌ ${name}\n${fresh}From: ${search}\n\nWhy not: ${why.join(": ")}\n`);
    no++;
  }
}
console.log(`Sorted ${yes} into Yes and ${no} into No (${ROOT})`);

// Second check (9 Oct 2026): a separate pass re-reads every Yes file against the
// rules, in case a search bot put something in the wrong folder. Anything that
// fails moves to No with the reason. Entries from Claude's notes are left alone.
const CHECKS = [
  [/^VTC shortlist|^UK VTC search/, text => /📢 (Staff job|Job post): "/.test(text) && !/none public/.test(text), "no staff job open to outsiders"],
  // Ticket jobs only (10 Oct 2026): results from older rule sets must say it's a ticket job.
  [/^Community search/, text => /🟢 Open job/.test(text) && (/Ticket job: yes/.test(text) || /Rules dropped: /.test(text)), "not a ticket job, or no open job in the server's description"],
  [/^Job shortlist|^App project search/, text => {
    const dates = [...text.matchAll(/[Oo]pened (\d{4}-\d{2}-\d{2})/g)].map(m => Date.parse(m[1]));
    return dates.some(d => Date.now() - d <= 180 * 86400000) && !/plan before any code|could not check/.test(text);
  }, "old issue, plan-first rule, or outsider fixes not checked"],
];
let moved = 0;
for (const file of fs.readdirSync(YES).filter(f => !f.startsWith("Notes - "))) {
  const text = fs.readFileSync(path.join(YES, file), "utf8");
  const check = CHECKS.find(([which]) => which.test(file));
  if (!check || check[1](text)) continue;
  fs.writeFileSync(path.join(NO, file), text.replace(/^# ✅/, "# ❌") + `\nWhy not (second check): ${check[2]}\n`);
  fs.rmSync(path.join(YES, file));
  moved++;
  console.log(`  moved: ${file}`);
}
if (moved) console.log(`Second check moved ${moved} wrong Yes entries to No`);

// Last in the line (9 Oct 2026): every result must sit in exactly ONE folder.
// If the same entry is in both, the stricter answer (No) wins.
for (const file of fs.readdirSync(YES).filter(f => fs.existsSync(path.join(NO, f)))) {
  fs.rmSync(path.join(YES, file));
  console.log(`  in both folders, kept in No: ${file}`);
}
console.log(`Final check: ${fs.readdirSync(YES).length} to check, ${fs.readdirSync(NO).length} ruled out by bots, none in both.`);

// One file for Claude (9 Oct 2026): what every bot did, in one place, so the
// session-start update only needs to read this. Lives in "Job Results\AI only".
const AI = path.join(ROOT, "AI only");
fs.mkdirSync(AI, {recursive: true});
const runs = JSON.parse(execSync(`gh run list --repo ${REPO} --limit 60 --json workflowName,status,conclusion,createdAt`, {encoding: "utf8"}));
const latest = new Map();
for (const run of runs) if (!latest.has(run.workflowName)) latest.set(run.workflowName, run);
const failedToday = runs.filter(r => r.conclusion === "failure" && r.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10));
const stuck = JSON.parse(execSync(`gh issue list --repo ${REPO} --state open --json number,title,updatedAt --limit 50`, {encoding: "utf8"}))
  .filter(i => i.title.startsWith("🆘"));
fs.writeFileSync(path.join(AI, "bot-summary.md"), [
  `# Bot summary for Claude (updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)`,
  "",
  "## Every bot's latest run",
  ...[...latest.values()].map(r => `- ${r.workflowName}: ${r.conclusion || r.status} at ${r.createdAt.slice(0, 16).replace("T", " ")}`),
  `- Failed runs today: ${failedToday.length}${failedToday.length ? ` (${[...new Set(failedToday.map(r => r.workflowName))].join(", ")})` : ""}`,
  "",
  "## Lists",
  ...issues.map(i => `- ${i.title.replace(/^📋\s*/, "")}`),
  "",
  "## Stuck (needs Claude's research)",
  ...(stuck.length ? stuck.map(i => `- #${i.number} ${i.title} (last update ${i.updatedAt.slice(0, 16).replace("T", " ")})`) : ["- nothing stuck"]),
  "",
  "## Folders",
  `- To check (waiting for him): ${fs.readdirSync(YES).join(", ") || "empty"}`,
  `- His Yes: ${fs.readdirSync(HIS_YES).join(", ") || "empty"}`,
  `- His No: ${fs.readdirSync(HIS_NO).length} entries`,
  `- Ruled out by bots: ${fs.readdirSync(NO).length} entries`,
  "",
].join("\n"));
console.log(`Summary for Claude written to ${path.join(AI, "bot-summary.md")}`);

// The search log (search-log.md on GitHub, pulled to this PC) as a document in Job Results.
const LOG = new URL("../search-log.md", import.meta.url);
if (fs.existsSync(LOG)) fs.copyFileSync(LOG, path.join(ROOT, "Search log.md"));

// "Servers to join.md": one list of every server waiting in To check, with its join link (10 Oct 2026).
// The bot sorts each one itself: Best match (every rule passed) or Close match (some rules dropped).
const best = [], close = [];
for (const f of fs.readdirSync(YES).filter(f => f.endsWith(".md"))) {
  const text = fs.readFileSync(path.join(YES, f), "utf8");
  const link = (text.match(/https:\/\/discord\.(gg|com\/invite)\/[^\s)]+/) || text.match(/https?:\/\/[^\s)]+/) || ["no link"])[0];
  const dropped = (text.match(/Rules dropped: ([^\n]+)/) || [])[1];
  (dropped ? close : best).push(`- ${f.replace(/\.md$/, "")}: ${link}${dropped ? ` (check yourself: ${dropped.replace(/ - check these yourself$/, "")})` : ""}`);
}
const waiting = [
  "## ✅ Best match (every rule passed)", "", ...(best.length ? best : ["None yet."]), "",
  "## 🟡 Close match (some rules dropped)", "", ...(close.length ? close : ["None yet."]), "",
  // Waiting (10 Oct 2026): servers he is waiting on, from the Waiting watch bot.
  "## ⏳ Waiting", "",
  ...((issues.find(i => i.title.startsWith("📋 Waiting watch"))?.body || "").split("## ⏳ Still waiting")[1] || "- (waiting watch has not run yet)")
    .split("\n").filter(l => l.startsWith("- ")),
];
fs.writeFileSync(path.join(ROOT, "Servers to join.md"), [
  `# Servers to join (updated ${new Date().toLocaleString("en-IE", {timeZone: "Europe/Dublin"})})`,
  "",
  "The bots put each server in the right list. Check #announcements first: a staff post in the last 1-2 days = active management.",
  "",
  ...(waiting.length ? waiting : ["Nothing yet. No server has passed every rule so far. The bots keep looking."]),
  "",
].join("\n"));

// "Build leads.md" (10 Oct 2026): servers he could offer to build an admin/staff app for.
const buildIssue = issues.find(i => i.title.startsWith("📋 Build leads"));
// The Bot leads helper (10 Oct 2026): sim communities checked live for size and activity.
const botIssue = issues.find(i => i.title.startsWith("📋 Bot leads"));
fs.writeFileSync(path.join(ROOT, "Build leads.md"), [
  "# Build leads", "",
  "## Checked live (Bot leads helper, every 3 hours)", "", botIssue ? botIssue.body : "The first list comes after the helper's next run.", "",
  "## From the community search", "", buildIssue ? buildIssue.body : "The first list comes after the next community search.", "",
].join("\n"));
