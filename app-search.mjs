/**
 * Finds open-source APP projects (trackers, food ordering, delivery, logistics)
 * that are active, take outside contributions and have open issues to pick up.
 *
 * Runs on GitHub's computers alongside the rules search. GitHub API only, read-only.
 * Every lead carries dates, because an old page once sent the user after a job
 * that was already done.
 */

import fs from "node:fs";

import {humanOnlyRule, untestableIssue, untestableProject} from "./auto-rules.mjs";

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const TOPICS = [
  "food-delivery", "delivery-app", "food-ordering", "restaurant-app",
  "habit-tracker", "expense-tracker", "time-tracker", "fitness-tracker",
  "fleet-management", "logistics", "courier", "package-tracking", "route-planning",
  // Truck sim: VTC tools, trackers, TrucklineMP/TruckersMP and SCS game projects.
  "ets2", "ats", "euro-truck-simulator-2", "american-truck-simulator", "truckersmp",
  "trucklinemp", "vtc", "truck-simulator", "scs-sdk",
];
// Plain keyword searches catch truck-sim repos that never set topics.
const KEYWORDS = ["trucklinemp", "truckersmp", "\"virtual trucking company\"", "ets2 vtc", "ets2 telemetry"];
// Food and delivery companies that publish open-source code (Ireland and UK).
const COMPANY_ORGS = ["uber", "justeattakeaway", "justeat", "deliveroo", "doordash", "wolt", "glovo", "grubhub"];
const SKIP = /prettier|wasp-lang|ets2la|crypto|web3|blockchain|nft/i;
const AI_BAN = /(no|not accept|prohibit|ban|forbid)\w*[^.\n]{0,60}\b(AI|LLM|ChatGPT|Copilot|generated)\b|\b(AI|LLM)[- ]generated[^.\n]{0,40}(not|won't|will not) be (accepted|merged)/i;
const ACTIVE_DAYS = 14;
const TRUCK = /truck|ets2|ats|scs|vtc|truckersmp|trucklinemp/i;
const SHORTLIST = 8;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = s => s.slice(0, 10);

async function gh(path, tries = 3) {
  const response = await fetch(`https://api.github.com/${path}`, {signal: AbortSignal.timeout(20000), 
    headers: {authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "app-search"},
  }).catch(() => null);
  if (!response) return null;
  // Rate limited: wait and retry a few times, then give up on this call
  // rather than waiting forever.
  if (response.status === 403 || response.status === 429) {
    if (tries <= 1) return null;
    await sleep(60000);
    return gh(path, tries - 1);
  }
  if (!response.ok) return null;
  return response.json();
}

async function discord(link) {
  const code = link.split("/").pop();
  const response = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0"}}).catch(() => null);
  if (!response) return null;
  const invite = await response.json().catch(() => ({}));
  return invite.guild ? {members: invite.approximate_member_count, online: invite.approximate_presence_count} : null;
}

async function file(repo, path) {
  const data = await gh(`repos/${repo}/contents/${path}`);
  return data?.content ? Buffer.from(data.content, "base64").toString("utf8") : "";
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - ACTIVE_DAYS * 86400000).toISOString().slice(0, 10);
  const seen = new Map();
  for (const topic of TOPICS) {
    for (const lang of ["TypeScript", "JavaScript"]) {
      const result = await gh(`search/repositories?q=topic:${topic}+language:${lang}+pushed:>${since}+stars:>30&sort=stars&per_page=15`);
      (result?.items || []).forEach(r => !SKIP.test(r.full_name) && !r.archived && seen.set(r.full_name, r));
      await sleep(2500);
    }
  }
  for (const words of KEYWORDS) {
    const result = await gh(`search/repositories?q=${encodeURIComponent(words)}+pushed:>${since}&sort=updated&per_page=20`);
    (result?.items || []).forEach(r => !SKIP.test(r.full_name) && !r.archived && seen.set(r.full_name, r));
    await sleep(2500);
  }
  for (const org of COMPANY_ORGS) {
    for (const lang of ["TypeScript", "JavaScript"]) {
      const result = await gh(`search/repositories?q=org:${org}+language:${lang}+pushed:>${since}&sort=stars&per_page=15`);
      (result?.items || []).forEach(r => !r.archived && seen.set(r.full_name, {...r, company: org}));
      await sleep(2500);
    }
  }
  console.error(`checking ${seen.size} active app repos`);

  const kept = [];
  const dropped = [];
  for (const [name, repo] of seen) {
    const issues = (await gh(`repos/${name}/issues?state=open&labels=good%20first%20issue&per_page=10`)) || [];
    const help = (await gh(`repos/${name}/issues?state=open&labels=help%20wanted&per_page=10`)) || [];
    let open = [...issues, ...help].filter((i, n, all) => !i.pull_request && !i.assignee && all.findIndex(x => x.id === i.id) === n);
    // Truck-sim projects rarely label issues: accept any unassigned issue from the last 60 days.
    if (!open.length && TRUCK.test(`${name} ${repo.description} ${(repo.topics || []).join(" ")}`)) {
      const recent = new Date(Date.now() - 60 * 86400000).toISOString();
      open = ((await gh(`repos/${name}/issues?state=open&since=${recent}&per_page=10`)) || [])
        .filter(i => !i.pull_request && !i.assignee && i.created_at >= recent);
    }
    // Rule 11 (9 Oct 2026): old posts can't be trusted, so only issues opened in the last 180 days count.
    const fresh = new Date(Date.now() - 180 * 86400000).toISOString();
    if (open.length && !open.some(i => i.created_at >= fresh)) { dropped.push(`${name}: its open issues are all older than 180 days`); continue; }
    open = open.filter(i => i.created_at >= fresh);
    if (!open.length) { dropped.push(`${name}: no open starter or help-wanted issues`); continue; }

    const pulls = (await gh(`repos/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=30`)) || [];
    const outsider = pulls.find(p => p.merged_at && ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER"].includes(p.author_association) && !/bot/i.test(p.user?.login || ""));
    if (!outsider) { dropped.push(`${name}: no recent merged PR from an outsider`); continue; }

    const rules = (await file(name, "CONTRIBUTING.md")) + (await file(name, ".github/CONTRIBUTING.md")) + (await file(name, ".github/pull_request_template.md")) + (await file(name, "AGENTS.md")) + (await file(name, ".github/agents/pr-and-commit-rules.md"));
    if (AI_BAN.test(rules)) { dropped.push(`${name}: contributing rules restrict AI-written work`); continue; }
    const humanOnly = humanOnlyRule(rules);
    if (humanOnly) { dropped.push(`${name}: needs a person in the loop ("${humanOnly}")`); continue; }
    const cantBuild = untestableProject(await file(name, "package.json"));
    if (cantBuild) { dropped.push(`${name}: ${cantBuild}`); continue; }
    open = open.filter(i => !untestableIssue(i.title, i.body || ""));
    if (!open.length) { dropped.push(`${name}: its open issues all need hardware the local PC doesn't have`); continue; }
    const readme = await file(name, "README.md");
    const invite = (readme.match(/discord\.(?:gg|com\/invite)\/[A-Za-z0-9-]+/) || [])[0];
    // Standing rule: it must have a live Discord community.
    const server = invite ? await discord(invite) : null;
    if (!server) { dropped.push(`${name}: ${invite ? "Discord invite dead" : "no Discord community"}`); continue; }

    kept.push({repo, open, outsider, invite, server, aiNote: /\bAI\b|LLM|Copilot|Claude/i.test(rules) ? "mentions AI — read before using it" : "no AI rule found"});
    await sleep(1000);
  }

  kept.sort((a, b) => b.repo.stargazers_count - a.repo.stargazers_count);
  const out = [`App project search ${today}. ${kept.length} active app projects take outside help, have open issues and a live Discord.`, ""];
  kept.slice(0, SHORTLIST).forEach(({repo, open, outsider, invite, server, aiNote}, i) => {
    out.push(`### ${i + 1}. ${repo.full_name}${repo.company ? ` (company: ${repo.company})` : ""}`);
    out.push(`- ${repo.html_url}`);
    out.push(`- ${repo.description || "(no description)"}`);
    out.push(`- ${repo.stargazers_count} stars · ${repo.license?.spdx_id || "no licence"} · last push ${day(repo.pushed_at)}`);
    out.push(`- Outsider PR merged: #${outsider.number} "${outsider.title}" on ${day(outsider.merged_at)}`);
    out.push(`- Join Discord: https://${invite} (${server.members} members, ${server.online} online, checked ${today})`);
    out.push(`- AI: ${aiNote}`);
    open.slice(0, 3).forEach(issue => out.push(`  - #${issue.number} ${issue.title} (opened ${day(issue.created_at)}, ${issue.comments} comments) ${issue.html_url}`));
    out.push("");
  });
  if (!kept.length) out.push("Nothing qualified today. The next run will try again.", "");
  if (dropped.length) {
    out.push("<details><summary>Ruled out</summary>", "");
    dropped.slice(0, 80).forEach(d => out.push(`- ${d}`));
    out.push("", "</details>");
  }

  const body = out.join("\n");
  console.log(body);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${Math.min(kept.length, SHORTLIST)}\nbody<<APPBODY\n${body}\nAPPBODY\n`);
  }
}

main().catch(error => {
  console.error("app-search failed:", error.message);
  process.exit(1);
});
