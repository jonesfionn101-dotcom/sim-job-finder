/**
 * Drafts a fix for one job from the latest search lists, using GitHub's free
 * AI models, and proves it with the project's own tests. It NEVER sends
 * anything to the project: a passing fix is saved as a "needs check" issue
 * here, and Claude reviews it with the user before any pull request is opened.
 *
 * Runs on GitHub's computers (PC can be off). Needs no keys: GitHub Models is
 * reached with the workflow's own token (permission "models: read").
 */

import {execSync} from "node:child_process";
import fs from "node:fs";

import {humanOnlyRule, untestableIssue, untestableProject} from "./auto-rules.mjs";

const TOKEN = process.env.GH_TOKEN;
const HOME = process.env.GITHUB_REPOSITORY;
const MODEL = process.env.AUTOFIX_MODEL || "openai/gpt-4.1";
const WORK = "work";
const MAX_FILES = 6;
const MAX_FILE_CHARS = 12000;

const sh = (cmd, opts = {}) => execSync(cmd, {stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts});
const trySh = (cmd, opts = {}) => {
  try { return {ok: true, out: sh(cmd, opts)}; } catch (error) { return {ok: false, out: `${error.stdout || ""}${error.stderr || ""}`}; }
};
const tail = (text, n = 60) => text.split("\n").slice(-n).join("\n");

async function gh(path, init = {}) {
  const response = await fetch(`https://api.github.com/${path}`, {
    ...init,
    signal: AbortSignal.timeout(30000),
    headers: {authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "autofix", ...init.headers},
  }).catch(() => null);
  return response?.ok ? response.json() : null;
}

async function raw(repo, path) {
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    signal: AbortSignal.timeout(30000),
    headers: {authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github.raw", "user-agent": "autofix"},
  }).catch(() => null);
  return response?.ok ? response.text() : "";
}

/** Issue links from the newest job and app lists, best first. */
async function candidates() {
  const lists = (await gh(`repos/${HOME}/issues?state=open&per_page=30`)) || [];
  const recent = lists.filter(i => /^📋 (Job shortlist|App project search):/.test(i.title)).slice(0, 4);
  const done = new Set(lists.filter(i => i.title.startsWith("🔧")).map(i => i.title.match(/: (\S+#\d+)/)?.[1]));
  const links = [];
  for (const list of recent) {
    for (const m of (list.body || "").matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/g)) {
      const key = `${m[1]}#${m[2]}`;
      if (!done.has(key) && !links.some(l => l.key === key)) links.push({key, repo: m[1], number: Number(m[2])});
    }
  }
  return links;
}

async function ask(messages) {
  const response = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(180000),
    headers: {authorization: `Bearer ${TOKEN}`, "content-type": "application/json"},
    body: JSON.stringify({model: MODEL, messages, temperature: 0.2}),
  }).catch(error => ({ok: false, statusText: error.message}));
  if (!response.ok) throw new Error(`GitHub Models: ${response.status || ""} ${response.statusText}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

/** Files most likely to need the change: ones whose text matches words from the issue. */
function relevantFiles(issue) {
  const words = [...new Set(`${issue.title} ${issue.body || ""}`.match(/[A-Za-z][A-Za-z0-9_]{4,}/g) || [])]
    .filter(w => !/^(should|would|could|there|which|about|issue|description|expected|actual|behaviou?r|screenshot|steps|reproduce|version)$/i.test(w))
    .slice(0, 25);
  const scores = new Map();
  for (const word of words) {
    const hits = trySh(`git grep -l -i -F -- ${JSON.stringify(word)} -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.vue' '*.css' '*.scss'`, {cwd: WORK});
    for (const file of hits.out.split("\n").filter(Boolean)) {
      if (/node_modules|dist\/|build\/|\.min\.|\.d\.ts$|__snapshots__/.test(file)) continue;
      scores.set(file, (scores.get(file) || 0) + 1);
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_FILES).map(([file]) => file);
}

function installAndTestCommands() {
  const pkg = JSON.parse(fs.readFileSync(`${WORK}/package.json`, "utf8"));
  const pm = fs.existsSync(`${WORK}/pnpm-lock.yaml`) ? "pnpm" : fs.existsSync(`${WORK}/yarn.lock`) ? "yarn" : "npm";
  const install = {pnpm: "corepack enable && pnpm install --frozen-lockfile", yarn: "corepack enable && yarn install --immutable || yarn install --frozen-lockfile", npm: "npm ci || npm install"}[pm];
  const test = pkg.scripts?.["test:unit"] ? `${pm} run test:unit` : `${pm} test`;
  return {install, test};
}

function extractDiff(text) {
  const fenced = text.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
  const diff = (fenced ? fenced[1] : text).trim();
  return diff.includes("--- ") && diff.includes("+++ ") ? `${diff}\n` : null;
}

async function draftFix(job) {
  const issue = await gh(`repos/${job.repo}/issues/${job.number}`);
  if (!issue || issue.state !== "open" || issue.assignee || issue.pull_request) return {skip: "issue closed, taken or not an issue"};
  const why = untestableIssue(issue.title, issue.body || "");
  if (why) return {skip: why};
  const rules = (await raw(job.repo, "CONTRIBUTING.md")) + (await raw(job.repo, "AGENTS.md")) + (await raw(job.repo, ".github/pull_request_template.md"));
  const human = humanOnlyRule(rules);
  if (human) return {skip: `needs a person in the loop ("${human}")`};
  const cant = untestableProject(await raw(job.repo, "package.json"));
  if (cant) return {skip: cant};

  fs.rmSync(WORK, {recursive: true, force: true});
  sh(`git clone --depth 1 https://github.com/${job.repo}.git ${WORK}`);
  const {install, test} = installAndTestCommands();
  const installed = trySh(install, {cwd: WORK, timeout: 15 * 60000});
  if (!installed.ok) return {skip: `could not install the project\n${tail(installed.out, 20)}`};
  const before = trySh(test, {cwd: WORK, timeout: 15 * 60000, env: {...process.env, CI: "true"}});
  if (!before.ok) return {skip: `the project's tests already fail before any change\n${tail(before.out, 20)}`};

  const files = relevantFiles(issue);
  if (!files.length) return {skip: "could not find the code the issue is about"};
  const context = files.map(f => `=== ${f} ===\n${fs.readFileSync(`${WORK}/${f}`, "utf8").slice(0, MAX_FILE_CHARS)}`).join("\n\n");
  const messages = [
    {role: "system", content: "You fix bugs in open-source projects. Reply with ONLY a unified diff (git format, paths relative to the repo root, a/ and b/ prefixes) inside one ```diff block. Make the smallest correct change, match the existing code style, and add or update a test when the project has tests near the changed code."},
    {role: "user", content: `Repository: ${job.repo}\nIssue #${job.number}: ${issue.title}\n\n${(issue.body || "").slice(0, 6000)}\n\nRelevant files:\n\n${context}`},
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const reply = await ask(messages);
    const diff = extractDiff(reply);
    sh("git checkout -- . && git clean -fdq", {cwd: WORK});
    if (!diff) {
      messages.push({role: "assistant", content: reply}, {role: "user", content: "That was not a unified diff. Reply with only the diff in a ```diff block."});
      continue;
    }
    fs.writeFileSync("fix.patch", diff);
    const applied = trySh("git apply --recount --whitespace=nowarn ../fix.patch", {cwd: WORK});
    if (!applied.ok) {
      messages.push({role: "assistant", content: reply}, {role: "user", content: `git apply failed:\n${tail(applied.out, 15)}\nSend a corrected diff against the files exactly as shown.`});
      continue;
    }
    const after = trySh(test, {cwd: WORK, timeout: 15 * 60000, env: {...process.env, CI: "true"}});
    if (after.ok) return {issue, diff, attempt, testCommand: test, testLog: tail(after.out, 40), files};
    messages.push({role: "assistant", content: reply}, {role: "user", content: `The tests failed with your change:\n${tail(after.out, 40)}\nSend a corrected diff.`});
  }
  return {skip: "the free AI could not produce a fix that passes the tests in 3 tries"};
}

async function main() {
  const jobs = await candidates();
  console.error(`${jobs.length} jobs on the latest lists`);
  const tried = [];
  for (const job of jobs.slice(0, 5)) {
    let result;
    try { result = await draftFix(job); } catch (error) { result = {skip: `error: ${error.message}`}; }
    if (result.skip) { tried.push(`- ${job.key}: ${result.skip.split("\n")[0]}`); console.error(job.key, result.skip); continue; }

    const body = [
      `**Draft fix for https://github.com/${job.repo}/issues/${job.number}** — "${result.issue.title}"`,
      "",
      "⚠️ Made by GitHub's free AI (" + MODEL + "). **Not sent.** Claude must check it before any pull request.",
      "",
      `- Files looked at: ${result.files.join(", ")}`,
      `- Tests: \`${result.testCommand}\` passed before and after the change (attempt ${result.attempt} of 3)`,
      "",
      "```diff",
      result.diff.trim(),
      "```",
      "",
      "<details><summary>Last lines of the test run</summary>",
      "",
      "```",
      result.testLog,
      "```",
      "</details>",
    ].join("\n");
    fs.writeFileSync("draft-body.md", body);
    sh(`gh issue create --repo ${HOME} --title ${JSON.stringify(`🔧 Fix draft – needs check: ${job.key}`)} --body-file draft-body.md`);
    console.log(`drafted ${job.key}`);
    return;
  }
  const note = ["No fix drafted today. Jobs tried:", ...tried].join("\n");
  console.log(note);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, note + "\n");
}

main().catch(error => {
  console.error("autofix failed:", error.message);
  process.exit(1);
});
