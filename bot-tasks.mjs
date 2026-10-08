/**
 * Works through "bot-task" issues in THIS repo: problems with the bots
 * themselves, queued so they get worked on while the owner's PC is off.
 *
 * For one task at a time it asks GitHub's free AI models for a fix, checks
 * it (syntax check plus the task's own "Test command:"), and opens a pull
 * request in this repo. It never merges: every bot PR is reviewed first.
 * A task the bot can't fix gets a comment saying why, and the label
 * "bot-tried" so it isn't retried every run.
 */

import {execSync} from "node:child_process";
import fs from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GH_TOKEN;

const MAX_FILE_CHARS = 20000;

const sh = (cmd, opts = {}) => execSync(cmd, {stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts});
const trySh = (cmd, opts = {}) => {
  try { return {ok: true, out: sh(cmd, opts)}; } catch (error) { return {ok: false, out: `${error.stdout || ""}${error.stderr || ""}`}; }
};
const tail = (text, n = 40) => text.split("\n").slice(-n).join("\n");

// Free AI with no key: Pollinations (anonymous tier). GitHub Models, the
// original choice, was retired on 30 July 2026. Override with AI_URL/AI_MODEL.
const AI_URL = process.env.AI_URL || "https://text.pollinations.ai/openai";
const AI_MODEL = process.env.AI_MODEL || "openai";

async function ask(messages) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(AI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(300000),
      headers: {"content-type": "application/json"},
      body: JSON.stringify({model: AI_MODEL, messages}),
    }).catch(error => ({ok: false, status: 0, statusText: error.message}));
    if (response.ok) {
      const text = await response.text();
      try { return JSON.parse(text).choices?.[0]?.message?.content || ""; }
      catch { throw new Error(`AI reply was not JSON: ${text.slice(0, 80)}`); }
    }
    // Anonymous tier is rate limited: wait and try again a few times.
    if (attempt < 3) await new Promise(r => setTimeout(r, 30000 * attempt));
    else throw new Error(`AI service: ${response.status} ${response.statusText}`);
  }
}

function extractDiff(text) {
  const fenced = text.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
  const diff = (fenced ? fenced[1] : text).trim();
  return diff.includes("--- ") && diff.includes("+++ ") ? `${diff}\n` : null;
}

function giveUp(issue, why) {
  fs.writeFileSync("task-note.md", `🤖 The fixing bot tried this task and could not finish it:\n\n${why}\n\nIt won't retry on its own. Remove the \`bot-tried\` label to let it try again.`);
  sh(`gh issue comment ${issue.number} --repo ${REPO} --body-file task-note.md`);
  sh(`gh issue edit ${issue.number} --repo ${REPO} --add-label bot-tried`);
}

async function main() {
  const tasks = JSON.parse(sh(`gh issue list --repo ${REPO} --state open --label bot-task --json number,title,body,labels --limit 50`))
    .filter(t => !t.labels.some(l => l.name === "bot-tried"));
  if (!tasks.length) { console.log("No bot-tasks waiting."); return; }
  const issue = tasks.sort((a, b) => a.number - b.number)[0];
  globalThis.currentIssue = issue;
  console.log(`Working on bot-task #${issue.number}: ${issue.title}`);

  const files = [...new Set((issue.body.match(/^Files?: (.+)$/m)?.[1] || "").split(/[,\s]+/).filter(f => f && fs.existsSync(f)))];
  const testCommand = issue.body.match(/^Test command: `?([^`\n]+)`?$/m)?.[1]?.trim();
  if (!files.length) return giveUp(issue, "The task doesn't name any files that exist (add a line `Files: a.mjs, b.yml`).");

  const context = files.map(f => `=== ${f} ===\n${fs.readFileSync(f, "utf8").slice(0, MAX_FILE_CHARS)}`).join("\n\n");
  const messages = [
    {role: "system", content: "You improve small automation scripts. Reply with ONLY a unified diff (git format, a/ and b/ prefixes, paths relative to the repo root) inside one ```diff block. Make the smallest correct change and match the existing style."},
    {role: "user", content: `Task #${issue.number}: ${issue.title}\n\n${issue.body}\n\nFiles:\n\n${context}`},
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const reply = await ask(messages);
    sh("git checkout -- . && git clean -fdq -e task-note.md");
    const diff = extractDiff(reply);
    if (!diff) { messages.push({role: "assistant", content: reply}, {role: "user", content: "Reply with only the diff in a ```diff block."}); continue; }
    fs.writeFileSync("/tmp/task.patch", diff);
    const applied = trySh("git apply --recount --whitespace=nowarn /tmp/task.patch");
    if (!applied.ok) { messages.push({role: "assistant", content: reply}, {role: "user", content: `git apply failed:\n${tail(applied.out, 15)}\nSend a corrected diff.`}); continue; }

    const changed = sh("git diff --name-only").split("\n").filter(Boolean);
    const checks = [];
    for (const file of changed.filter(f => f.endsWith(".mjs"))) checks.push(trySh(`node --check ${file}`));
    for (const file of changed.filter(f => f.endsWith(".ps1"))) checks.push(trySh(`pwsh -NoProfile -Command "$null = [scriptblock]::Create((Get-Content -Raw '${file}'))"`));
    if (testCommand) checks.push(trySh(testCommand, {timeout: 20 * 60000, env: process.env}));
    const failed = checks.find(c => !c.ok);
    if (failed) { messages.push({role: "assistant", content: reply}, {role: "user", content: `The check failed:\n${tail(failed.out)}\nSend a corrected diff.`}); continue; }

    const branch = `bot-task-${issue.number}-${Date.now()}`;
    sh(`git switch -c ${branch}`);
    sh(`git -c user.name="sim-job-finder bot" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -am ${JSON.stringify(`Bot fix for #${issue.number}: ${issue.title}`)}`);
    sh(`git push origin ${branch}`);
    fs.writeFileSync("task-note.md", `🤖 Suggested fix for #${issue.number}, made by a free AI (${AI_MODEL} via Pollinations) on attempt ${attempt} of 3.\n\n**Not merged.** It must be checked before it goes live.\n\nChecks run: syntax check${testCommand ? ` and \`${testCommand}\`` : ""} — all passed.\n\nCloses #${issue.number}`);
    sh(`gh pr create --repo ${REPO} --head ${branch} --title ${JSON.stringify(`🤖 Bot fix: ${issue.title}`)} --body-file task-note.md`);
    sh(`gh issue edit ${issue.number} --repo ${REPO} --add-label bot-tried`);
    console.log(`Opened a pull request for #${issue.number}`);
    return;
  }
  giveUp(issue, "GitHub's free AI could not produce a change that passed the checks in 3 tries.");
}

/** Keep going instead of idling: next bot-task if any are left, otherwise go find outside jobs. */
function handOver() {
  const left = JSON.parse(sh(`gh issue list --repo ${REPO} --state open --label bot-task --json labels --limit 50`))
    .filter(t => !t.labels.some(l => l.name === "bot-tried")).length;
  const next = left ? "bot-tasks.yml" : "autofix.yml";
  trySh(`gh workflow run ${next} --repo ${REPO}`);
  console.log(left ? `${left} bot-task(s) left: starting the next one.` : "Queue empty: handing over to the job drafter.");
}

main()
  .then(() => handOver())
  .catch(error => {
    console.error("bot-tasks failed:", error.message);
    process.exitCode = 1;
    // Never retry the same task in a loop: mark it tried and stop the chain.
    if (globalThis.currentIssue) trySh(`gh issue edit ${globalThis.currentIssue.number} --repo ${REPO} --add-label bot-tried`);
  });
