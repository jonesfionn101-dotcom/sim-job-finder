/**
 * Lead feeder: keeps the searches supplied with NEW leads, so Claude doesn't
 * have to. Runs on GitHub every hour, with the owner's PC off.
 *
 *   1. A free AI (Pollinations) suggests new search phrases and Discodus tags
 *      for English-speaking UK gaming/sim communities that hire staff.
 *   2. Each suggested Discodus tag page is checked (it must load and list servers).
 *   3. GitHub code search finds Discord invites in public files that mention
 *      UK communities and staff applications; each invite is checked live.
 *   4. Everything that passes is added to seeds.json for the next search.
 *
 * Sites that block tools (Disboard, top.gg, discord.me...) are never used.
 */

import {execSync} from "node:child_process";
import fs from "node:fs";

const AI_URL = process.env.AI_URL || "https://text.pollinations.ai/openai";
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const sh = cmd => execSync(cmd, {encoding: "utf8", stdio: "pipe"});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const seeds = JSON.parse(fs.readFileSync("seeds.json", "utf8"));
const known = {
  queries: new Set(seeds.community.queries),
  invites: new Set(seeds.community.invites),
  pages: new Set(seeds.community.listPages || []),
};
const added = {queries: [], invites: [], pages: []};

async function ask(prompt) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(AI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: {"content-type": "application/json"},
      body: JSON.stringify({model: "openai", messages: [{role: "user", content: prompt}]}),
    }).catch(() => null);
    if (response?.ok) {
      const text = (await response.json().catch(() => null))?.choices?.[0]?.message?.content || "";
      try { return JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}"); } catch { return {}; }
    }
    await sleep(20000 * attempt);
  }
  return {};
}

async function invite(code) {
  const data = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0"}})
    .then(r => r.ok ? r.json() : null).catch(() => null);
  await sleep(1500);
  return data?.guild ? data : null;
}

// 1 + 2: AI ideas, checked.
const ideas = await ask(`I look for English-speaking UK or Irish Discord communities (farming sim, truck sim, sim racing, FiveM/GTA RP, UK gaming) that are hiring staff right now (moderators, support, ticket team, HR, admin assistant, events, media, developers) and accept outsiders.
Already tried phrases: ${[...known.queries].slice(-60).join("; ")}.
Reply with ONLY JSON: {"queries": [10 new 2-5 word search phrases], "tags": [8 single-word or hyphenated tags a Discord server list site might use, e.g. "staff-applications"]}`);
for (const query of (ideas.queries || []).map(q => String(q).toLowerCase().trim()).filter(q => q && q.length <= 60 && !known.queries.has(q)).slice(0, 10)) {
  added.queries.push(query);
}
for (const tag of (ideas.tags || []).map(t => String(t).toLowerCase().trim().replace(/[^a-z0-9-]/g, "")).filter(Boolean).slice(0, 8)) {
  const page = `https://discodus.com/servers/tag/${tag}`;
  if (known.pages.has(page)) continue;
  const html = await fetch(page, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0"}}).then(r => r.ok ? r.text() : "").catch(() => "");
  if ((html.match(/href="\/server\/\d{15,20}"/g) || []).length >= 3) added.pages.push(page);
  await sleep(1500);
}

// 3: invites in public GitHub files about UK communities hiring staff.
const SEARCHES = ['"discord.gg" "staff applications" uk', '"discord.gg" "we are hiring" uk gaming', '"discord.gg" ets2 uk community staff', '"discord.gg" fs22 uk server staff', '"discord.gg" fivem uk staff applications'];
for (const q of SEARCHES) {
  if (!TOKEN) break;
  const result = await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=20`, {
    signal: AbortSignal.timeout(30000),
    headers: {authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github.text-match+json", "user-agent": "sim-job-finder lead feeder"},
  }).then(r => r.ok ? r.json() : null).catch(() => null);
  for (const item of result?.items || []) {
    for (const match of (item.text_matches || []).flatMap(t => [...t.fragment.matchAll(/discord(?:\.gg|(?:app)?\.com\/invite)\/([A-Za-z0-9-]{2,32})/g)])) {
      const code = match[1];
      if (known.invites.has(code) || added.invites.includes(code)) continue;
      const data = await invite(code);
      if (data && data.approximate_member_count >= 100) added.invites.push(code);
    }
  }
  await sleep(7000); // code search allows about 10 requests a minute
}

const total = added.queries.length + added.invites.length + added.pages.length;
console.log(`Lead feeder: ${added.queries.length} phrases, ${added.pages.length} list pages, ${added.invites.length} live servers`);
if (!total) process.exit(0);

// Save on top of the newest seeds.json; retry if something else saved at the same time.
sh(`git config user.name "github-actions[bot]" && git config user.email "41898282+github-actions[bot]@users.noreply.github.com"`);
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    sh("git fetch -q origin main && git reset -q --hard origin/main");
    const latest = JSON.parse(fs.readFileSync("seeds.json", "utf8"));
    const c = latest.community;
    c.queries.push(...added.queries.filter(q => !c.queries.includes(q)));
    c.invites.push(...added.invites.filter(i => !c.invites.includes(i)));
    c.listPages = [...new Set([...(c.listPages || []), ...added.pages])];
    fs.writeFileSync("seeds.json", `${JSON.stringify(latest, null, 2)}\n`);
    sh(`git add seeds.json && git commit -qm "Lead feeder: ${total} new leads (${added.queries.length} phrases, ${added.pages.length} list pages, ${added.invites.length} servers)" && git push -q origin HEAD:main`);
    break;
  } catch (error) {
    console.error(`saving leads failed (try ${attempt} of 3): ${error.message.split("\n")[0]}`);
  }
}
