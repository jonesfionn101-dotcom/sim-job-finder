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
const SKIP = /web3|crypto|nft|blockchain|nsfw|18\+|adult|dating/i;
const LOCAL = /\b(uk|u\.k\.|united kingdom|british|britain|england|scotland|wales|ireland|irish|northern ireland|gmt|bst)\b/i;
const HIRING = /\b(staff applications?|staff apps|apply for staff|we('re| are) (hiring|recruiting)|hiring|recruiting (staff|mods?|moderators)|looking for (staff|mods?|moderators|helpers|developers?|admins?|bot (devs?|developers?)|web ?(designers?|developers?))|bot developers? (wanted|needed)|discord (managers?|admins?) (wanted|needed)|join (our|the) (staff|team)|applications? (are )?open)\b/i;
const MIN_MEMBERS = 300;
const SHORTLIST = 20;
const PER_GROUP = 5;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function listings(query) {
  const response = await fetch(`https://discord.com/servers?query=${encodeURIComponent(query)}`, {
    signal: AbortSignal.timeout(20000),
    headers: {"user-agent": "Mozilla/5.0", "accept-language": "en-GB"},
  }).catch(() => null);
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

async function main() {
  const seen = new Map();
  let failed = 0;
  const queryCount = Object.values(QUERIES).flat().length;
  for (const [group, queries] of Object.entries(QUERIES)) {
    for (const query of queries) {
      const found = await listings(query);
      if (!found.length) failed++;
      found.forEach(server => {
        const known = seen.get(server.url);
        // A server keeps the first group that found it.
        seen.set(server.url, {...server, group: known?.group || group, queries: [...(known?.queries || []), query]});
      });
      await sleep(1500);
    }
  }
  console.error(`${seen.size} servers from ${queryCount} searches (${failed} searches returned nothing)`);

  const scored = [...seen.values()]
    .filter(s => s.members >= MIN_MEMBERS && GAMING.test(`${s.name} ${s.description}`) && !SKIP.test(`${s.name} ${s.description}`))
    .map(s => {
      const text = `${s.name} ${s.description}`;
      const local = (text.match(LOCAL) || [])[0];
      const hiring = (text.match(HIRING) || [])[0];
      return {...s, local, hiring, group: groupFor(text), score: (hiring ? 100 : 0) + (local ? 50 : 0) + Math.log10(s.members) * 5};
    })
    .sort((a, b) => b.score - a.score);

  const today = new Date().toISOString().slice(0, 10);
  const hiringCount = scored.filter(s => s.hiring).length;
  const out = [
    `Community search ${today}. ${scored.length} communities with ${MIN_MEMBERS}+ members; ${hiringCount} mention staff or hiring in their description.`,
    "",
  ];
  for (const group of Object.keys(QUERIES)) {
    const inGroup = scored.filter(s => s.group === group).slice(0, PER_GROUP);
    out.push(`## ${group}`, "");
    if (!inGroup.length) out.push("Nothing found in this group today.", "");
    inGroup.forEach((s, i) => {
      out.push(`### ${i + 1}. ${s.name}`);
      out.push(`- Open: ${s.url} (${s.members.toLocaleString("en-GB")} members, listing read ${today})`);
      out.push(`- ${s.description.replace(/\s+/g, " ").slice(0, 200) || "(no description)"}`);
      out.push(`- ${s.hiring ? `🟢 Description says "${s.hiring}"` : "No staff call in the description — check #announcements inside"}`);
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

main().catch(error => {
  console.error("community-search failed:", error.message);
  process.exit(1);
});
