/**
 * Searches Discord's public server directory for communities beyond trucking:
 * farming sims, other sims, and UK/Irish gaming communities.
 *
 * Read-only: it only reads discord.com/servers listings (name, description,
 * member count). Nothing is joined. Ranks servers that look UK/Irish and that
 * mention staff applications or hiring in their description.
 */

import fs from "node:fs";

const QUERIES = {
  // FS22 first, plus any farming-sim community; the jobs wanted are server-side
  // (bots, websites, Discord setup, staff), so no need to play the game.
  "🚜 Farming": ["fs22", "fs22 uk", "farming simulator 22", "fs22 multiplayer", "fs22 server", "farming simulator uk", "farming simulator community", "farming sim discord"],
  "🚚 Trucking & transport": ["ets2 uk", "truckersmp uk", "american truck simulator", "bus simulator", "train sim uk", "omsi"],
  "🏎️ Other sims": ["sim racing uk", "iracing uk", "flight simulator uk", "msfs uk", "police simulator", "construction simulator"],
  "🎮 UK & Irish gaming": ["uk gaming community", "uk gamers", "irish gaming", "ireland gaming", "fivem uk", "gta rp uk", "minecraft uk"],
};
// Must be about games or sims, so "UK" searches don't pull in shops or government.
const GAMING = /\b(gam(e|es|ing|ers?)|sim(ulator|ulation|s)?|farming|fs2[25]|ets2|ats|truck\w*|vtc|convoy|racing|iracing|assetto|f1|flight|msfs|bus|train|rail|police|roleplay|rp|fivem|gta|minecraft|smp|esports?|stream\w*|youtube\w*|creator)\b/i;
// Sort each server by what it is about, not by which search found it.
const GROUP_OF = [
  // Farming-SIM communities only (not mobile farm games like Farm Merge Valley).
  ["🚜 Farming", /\b(farming sim\w*|fs ?2[25]|ls ?2[25]|landwirtschafts\w*|farm(ing)? (community|server|rp|roleplay|vtc)|agri\w*)\b/i],
  ["🚚 Trucking & transport", /\b(truck\w*|ets2|ats|vtc|convoys?|haul\w*|bus(es)?|trains?|rail\w*|transit|omsi)\b/i],
  ["🏎️ Other sims", /\b(sim(ulator|ulation|s)?|racing|iracing|assetto|flight|msfs|police|construction)\b/i],
];
const groupFor = text => (GROUP_OF.find(([, re]) => re.test(text)) || ["🎮 UK & Irish gaming"])[0];
// STRICT MODE (8 Oct 2026): a server is only listed when its own description
// says it has an open job of a kind he wants. These searches look for exactly
// those descriptions, per group.
const JOB_WORDS = ["staff applications open", "looking for staff", "hiring staff", "looking for moderators", "bot developer", "looking for developers",
  // Application-reviewing jobs (added 8 Oct 2026): recruitment / HR teams.
  "recruitment team", "hr team", "application reviewers"];
const TOPIC_OF = {
  "🚜 Farming": ["fs22", "farming simulator"],
  "🚚 Trucking & transport": ["ets2", "truckersmp"],
  "🏎️ Other sims": ["sim racing", "simulator"],
  "🎮 UK & Irish gaming": ["uk", "ireland"],
};
// "Don't stop until it finds something" (8 Oct 2026): when a run finds no open
// job, the workflow re-runs with WIDEN=1, then WIDEN=2, which search more
// topics. The rules for what counts as an open job never get looser.
const WIDEN = Number(process.env.WIDEN || 0);
const MORE_TOPICS = [
  {"🚜 Farming": ["fs22 uk", "farm sim 22"], "🚚 Trucking & transport": ["ats", "vtc", "bus simulator"], "🏎️ Other sims": ["assetto corsa", "flight sim"], "🎮 UK & Irish gaming": ["fivem uk", "minecraft uk"]},
  {"🚜 Farming": ["farming community", "agriculture"], "🚚 Trucking & transport": ["trucking", "convoy", "train sim"], "🏎️ Other sims": ["police roleplay", "racing league"], "🎮 UK & Irish gaming": ["gta rp", "roblox uk", "gaming community", "esports"]},
];
for (const extra of MORE_TOPICS.slice(0, WIDEN)) {
  for (const [group, topics] of Object.entries(extra)) TOPIC_OF[group].push(...topics);
}
// Starter leads from Claude's own research (seeds.json): extra searches and specific servers.
const SEEDS = JSON.parse(fs.readFileSync(new URL("./seeds.json", import.meta.url), "utf8")).community;
QUERIES["🎮 UK & Irish gaming"].push(...SEEDS.queries);
for (const [group, topics] of Object.entries(TOPIC_OF)) {
  for (const topic of topics) for (const words of JOB_WORDS) QUERIES[group].push(`${topic} ${words}`);
}
// The kinds of job he wants (all server-side, no gameplay needed).
const WANTED_ROLE = /\b(staff|moderators?|mods|admins?|support|helpers?|hr|human resources|developers?|devs?|bot|web(site)?|designers?|media|events?|community managers?|managers?|team|recruit(ers?|ment)|application reviewers?|reviewers?|secretar(y|ies)|(admin|staff) assistants?|note[- ]?takers?|minute[- ]?takers?|transcri\w+|documentation|ticket (team|staff|handlers?|loggers?|managers?)|clerks?)\b/i;
// Communities already joined (private TRIED_VTCS secret): never listed.
const TRIED = (process.env.TRIED_VTCS || "").split(/[\n,]/).map(n => n.trim().toLowerCase()).filter(Boolean);
// Freelance/hire-me marketplaces are not jobs he wants (10 Oct 2026).
const SKIP = /web3|crypto|nft|blockchain|nsfw|18\+|adult|dating|freelanc\w*|commissions?|fiverr|upwork|hire me|for hire|paid work|gigs?\b/i;
// TICKET JOBS ONLY for now (10 Oct 2026): the server must say you apply or get
// the job by opening a ticket. Other roles get added back later, one at a time.
const TICKET_ONLY = process.env.TICKET_ONLY !== "0";
const TICKET_WORD = /\btickets?\b/i;
// Anywhere in Europe (widened from UK-only on 10 Oct 2026); English is still required.
const LOCAL = /\b(uk|u\.k\.|united kingdom|british|britain|england|scotland|wales|ireland|irish|northern ireland|gmt|bst|europe|european|eu|euw|eune|cet|cest|eet|germany|german|france|french|netherlands|dutch|belgium|spain|spanish|portugal|italy|italian|poland|polish|sweden|swedish|norway|norwegian|denmark|danish|finland|finnish|austria|switzerland|swiss|czech|slovakia|hungary|romania|greece|croatia|baltic|nordic|scandinavia\w*)\b/i;
const HIRING = /\b(staff applications?|staff apps|apply for staff|we('re| are) (hiring|recruiting)|hiring|recruiting (staff|mods?|moderators|helpers|developers?)|looking for (an? )?(secretar(y|ies)|(admin|staff) assistants?|note[- ]?takers?|minute[- ]?takers?|ticket (team|staff|handlers?|managers?)|staff|mods?|moderators|helpers|developers?|admins?|support( staff)?|hr( staff)?|media( team)?|event (staff|team)|recruiters?|application reviewers?|bot (devs?|developers?)|web ?(designers?|developers?))|bot developers? (wanted|needed)|(discord )?(managers?|admins?|moderators|mods|helpers) (wanted|needed)|join (our|the) (staff|team)|(staff|mod|moderator|support|hr|media|event|recruitment|helper) (team )?applications? (are )?open|applications? (are )?open)\b/i;
// Ticket route (9 Oct 2026): servers where you open a ticket to apply or to be given a job.
const TICKET_JOB = /\b(open (a|an) (ticket|application) to (apply|join|get (a )?(job|role|task))|apply (via|through|by|in) (a )?tickets?|tickets? (to|for) (apply|applications?|staff|jobs?|roles?))\b/i;
const MIN_MEMBERS = 100;
// Loosened 10 Oct 2026 (he gave permission, to start applying today):
// - location: a server passes unless it says it's OUTSIDE Europe (most never say where they are);
// - hiring: being listed under a hiring tag on a server list (e.g. "looking-for-staff") counts too.
const OUTSIDE_EUROPE = /\b(usa|u\.s\.a?|united states|america|american|canada|canadian|na server|north america|latam|mexico|brazil|brasil|india|indian|pakistan|bangladesh|philippines|pinoy|indonesia|malaysia|singapore|asia|asian|sea server|oce|australia|aussie|new zealand|africa|nigeria|egypt|arab|middle east|china|chinese|japan|korea)\b/i;
const HIRING_TAG = /\/tag\/(looking-for-staff|hiring-staff|staff-applications?|staff-wanted|mod-applications|helpers|recruiting-staff|hiring-mods|applications-open)\b/;
const PARALLEL = 2;
const SHARD = Number(process.env.SHARD || 0);
const SHARDS = Number(process.env.SHARDS || 1);
/** Description is written in English (most of its words are everyday English ones). */
export function english(text) {
  const words = text.toLowerCase().match(/\p{L}+/gu) || [];
  const common = words.filter(w => ENGLISH_WORDS.has(w)).length;
  return words.length > 0 && common >= Math.min(3, words.length) * 0.6 && common / words.length >= 0.15;
}
const ENGLISH_WORDS = new Set("the and for our with you your to of is are a an we in on join community server friendly staff looking all be can this that it from by or as at come play games gaming new welcome".split(" "));
const SHORTLIST = 100;
const PER_GROUP = 25;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function listings(query) {
  let response;
  for (let attempt = 1; attempt <= 4; attempt++) {
    response = await fetch(`https://discord.com/servers?query=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(20000),
      headers: {"user-agent": "Mozilla/5.0", "accept-language": "en-GB"},
    }).catch(() => null);
    // Too many requests: back off as Discord asks, then try again.
    if (response?.status !== 429) break;
    await sleep(Math.max(Number(response.headers.get("retry-after")) || 0, 15 * attempt) * 1000);
  }
  if (!response?.ok) return [];
  const html = await response.text();
  const servers = [];
  for (const block of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let data;
    try { data = JSON.parse(block[1]); } catch { continue; }
    for (const entry of data.itemListElement || data.mainEntity?.itemListElement || []) {
      const item = entry.item || {};
      if (!item.url) continue;
      servers.push({
        name: item.name,
        url: item.url,
        description: item.description || "",
        members: item.interactionStatistic?.userInteractionCount || 0,
      });
    }
  }
  return servers;
}

/**
 * The open-job evidence in a server description, or null. A job counts only
 * when the description both advertises hiring AND names a role he wants.
 * Every role has tests in tests/roles.test.mjs.
 */
export function openJob(description) {
  const hiring = description.match(HIRING) || description.match(TICKET_JOB);
  return hiring && WANTED_ROLE.test(description) ? hiring[0] : null;
}

async function main() {
  const seen = new Map();
  let failed = 0;
  const queryCount = Object.values(QUERIES).flat().length;
  // Several searches at once (9 Oct 2026), each worker still pausing between its own requests.
  // Several computers at once: SHARD i of SHARDS takes every SHARDS-th search.
  const jobs = Object.entries(QUERIES).flatMap(([group, queries]) => queries.map(query => ({group, query})))
    .filter((_, i) => i % SHARDS === SHARD);
  if (process.env.MERGE) jobs.length = 0;
  const worker = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const found = await listings(job.query);
      if (!found.length) failed++;
      found.forEach(server => {
        const known = seen.get(server.url);
        // A server keeps the first group that found it.
        seen.set(server.url, {...server, group: known?.group || job.group, queries: [...(known?.queries || []), job.query]});
      });
      await sleep(1500);
    }
  };
  await Promise.all(Array.from({length: PARALLEL}, worker));
  // Merge step: combine what every computer collected.
  if (process.env.MERGE) for (const file of fs.readdirSync(process.env.MERGE, {recursive: true}).filter(f => String(f).endsWith(".json"))) {
    for (const server of JSON.parse(fs.readFileSync(`${process.env.MERGE}/${file}`, "utf8"))) {
      const known = seen.get(server.url);
      seen.set(server.url, {...server, group: known?.group || server.group, queries: [...(known?.queries || []), ...server.queries]});
    }
  }
  // Deep dive (9 Oct 2026): Claude finds web pages that LIST servers; the bot reads
  // every invite on them and checks each server itself.
  const listed = [];
  // Each of the computers takes its share of list pages and starter servers (shard 0 alone timed out).
  const mine = (_, i) => i % SHARDS === SHARD;
  for (const page of !process.env.MERGE ? (SEEDS.listPages || []).filter(mine) : []) {
    const html = await fetch(page, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0"}}).then(r => r.ok ? r.text() : "").catch(() => "");
    listed.push(...[...html.matchAll(/discord(?:\.gg|(?:app)?\.com\/invite)\/([A-Za-z0-9-]+)/g)].map(m => m[1]));
    // List sites with their own server pages (e.g. Discodus /server/<id>): read each page's
    // text gently. Their /join/ links are off-limits in robots.txt, so the page itself is the link.
    const origin = new URL(page).origin;
    for (const id of [...new Set([...html.matchAll(/href="\/server\/(\d{15,20})"/g)].map(m => m[1]))].slice(0, 60)) {
      const url = `${origin}/server/${id}`;
      if (seen.has(url)) continue;
      const body = await fetch(url, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0"}}).then(r => r.ok ? r.text() : "").catch(() => "");
      const name = (body.match(/<meta property="og:title" content="([^"]+)/) || [])[1]?.replace(/ Discord Server$/, "");
      // Only the server's OWN description counts. The page around it has the site's
      // menus and tags ("hiring" etc.), which made false matches (10 Oct 2026).
      const raw = (body.match(/serverData:\{[\s\S]*?description:"((?:[^"\\]|\\.)*)"/) || [])[1];
      if (!raw) { await sleep(1500); continue; }
      const text = raw.replace(/\\n/g, " ").replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, "$1").replace(/\s+/g, " ").slice(0, 3000);
      // The page shows only how many are online; treat 20+ online as big enough.
      const online = Number((body.match(/onlineCount:(\d+)/) || [])[1]) || 0;
      const members = online >= 20 ? MIN_MEMBERS : 0;
      if (name) seen.set(url, {name, url, description: text, members, group: "🎮 UK & Irish gaming", queries: [`list page ${origin}`], hiringTag: HIRING_TAG.test(page) ? page.split("/tag/")[1].split("?")[0] : null});
      await sleep(1500);
    }
  }
  if (listed.length) console.error(`${new Set(listed).size} servers read from ${SEEDS.listPages.length} list pages`);
  for (const code of !process.env.MERGE ? [...new Set([...SEEDS.invites.filter(mine), ...listed])] : []) {
    const invite = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0"}})
      .then(r => r.ok ? r.json() : null).catch(() => null);
    if (!invite?.guild) continue;
    const url = `https://discord.gg/${code}`;
    if (!seen.has(url)) seen.set(url, {name: invite.guild.name, url, description: invite.guild.description || "", members: invite.approximate_member_count || 0, group: "🎮 UK & Irish gaming", queries: ["Claude's starter lead"]});
    await sleep(1500);
  }
  console.error(`${seen.size} servers from ${queryCount} searches and ${SEEDS.invites.length} starter leads (${failed} searches returned nothing)`);

  if (process.env.COLLECT_ONLY) { fs.writeFileSync(process.env.COLLECT_ONLY, JSON.stringify([...seen.values()])); return; }

  const scored = [...seen.values()]
    // English-speaking UK/Irish servers only (9 Oct 2026).
    .filter(s => (process.env.WORLDWIDE || LOCAL.test(`${s.name} ${s.description}`) || !OUTSIDE_EUROPE.test(`${s.name} ${s.description}`)) && english(s.description)) // WORLDWIDE=1: test run without the UK rule
    .filter(s => s.members >= MIN_MEMBERS && GAMING.test(`${s.name} ${s.description}`) && !SKIP.test(`${s.name} ${s.description}`))
    // Strict: the description itself must advertise an open job he wants.
    .filter(s => openJob(s.description) || s.hiringTag)
    .filter(s => !TICKET_ONLY || TICKET_JOB.test(s.description) || TICKET_WORD.test(s.description))
    .filter(s => !TRIED.some(name => s.name.toLowerCase().includes(name)))
    .map(s => {
      const text = `${s.name} ${s.description}`;
      const local = (text.match(LOCAL) || [])[0];
      const hiring = (text.match(HIRING) || [])[0] || (s.hiringTag && `listed under "${s.hiringTag}"`);
      return {...s, local, hiring, group: groupFor(text), score: (hiring ? 100 : 0) + (local ? 50 : 0) + Math.log10(s.members) * 5};
    })
    .sort((a, b) => b.score - a.score);

  const today = new Date().toISOString().slice(0, 10);
  const hiringCount = scored.filter(s => s.hiring).length;
  const out = [
    `Strict community job search ${today}. Only servers whose own description advertises an open job are listed: ${scored.length} found.`,
    "",
  ];
  for (const group of Object.keys(QUERIES)) {
    const inGroup = scored.filter(s => s.group === group).slice(0, PER_GROUP);
    out.push(`## ${group}`, "");
    if (!inGroup.length) out.push("No open jobs found in this group today.", "");
    inGroup.forEach((s, i) => {
      out.push(`### ${i + 1}. ${s.name}`);
      out.push(`- Open: ${s.url} (${s.members.toLocaleString("en-GB")} members, listing read ${today})`);
      out.push(`- ${s.description.replace(/\s+/g, " ").slice(0, 200) || "(no description)"}`);
      out.push(`- 🟢 Open job: their description says "${s.hiring}" (read ${today}; Discord doesn't show when it was written)`);
      // Key facts (10 Oct 2026): what he needs before deciding yes or no.
      out.push(`  - Posted: not shown by Discord (seen open on ${today})`);
      out.push(`  - How long you have: no closing date given - apply soon`);
      out.push(`  - Who to talk to: their staff or HR team${TICKET_JOB.test(s.description) ? " - by opening a ticket" : ""}`);
      out.push(`  - Ticket job: ${TICKET_JOB.test(s.description) || /\bticket\b/i.test(s.description) ? "yes - their description mentions a ticket" : "not stated - check their apply/ticket channel"}`);
      out.push(`- ${s.local ? `Looks UK/Irish ("${s.local}")` : "Country not stated"} · found by: ${s.queries.slice(0, 3).join(", ")}`);
      out.push(`- Check inside: voice channels, ticket applications, age rule, button-only verification${group === "🚜 Farming" ? ", and ask if they need anything built (bot, website, Discord setup) — no gameplay needed" : ""}`);
      out.push("");
    });
  }
  if (!scored.length) out.push(`Nothing found. ${failed} of ${queryCount} searches got no answer from Discord.`);

  const body = out.join("\n");
  console.log(body);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${Math.min(scored.length, SHORTLIST)}\nhiring=${hiringCount}\nbody<<COMMBODY\n${body}\nCOMMBODY\n`);
  }
}

// Only search when run directly (the tests import openJob without searching).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("community-search.mjs")) main().catch(error => {
  console.error("community-search failed:", error.message);
  process.exit(1);
});
