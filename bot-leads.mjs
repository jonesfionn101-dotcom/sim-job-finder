// Bot leads (10 Oct 2026): communities that might want his free trial staff tracker bot.
// Reads public Discord lists (e.g. Farming Simulator's official community list), then
// checks every invite's REAL member and online count. Keeps only servers with
// 1,000+ members and 100+ online that aren't on his skip lists. Writes body.md.
import fs from "node:fs";

const SOURCES = [
  "https://www.farmsimgame.com/Discords",
];
const SEEDS = JSON.parse(fs.readFileSync("seeds.json", "utf8"));
const SKIP = (SEEDS.skip || []).map(s => s.toLowerCase());
// His rules: nothing adult, Roblox, money or brand new.
const BAD = /nsfw|18\+|adult|roblox\w*|minecraft|crypto|nft|gambl\w*|brand new/i;
// Sim communities only, medium-sized: huge servers already have their own developers.
const SIM = /farm\w*|fs ?2[25]|ets ?2|ats\b|truck\w*|vtc|convoy|logistic\w*|bus\b|train|rail\w*|sim\w*|racing|assetto|flight|aviation|transport/i;
const MAX_MEMBERS = 20000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const codes = new Set(SEEDS.community?.invites || []);
for (const url of SOURCES) {
  try {
    const page = await fetch(url).then(r => r.text());
    for (const m of page.matchAll(/discord\.(?:gg|com\/invite)\/([A-Za-z0-9-]+)/g)) codes.add(m[1]);
  } catch {}
}

const leads = [];
for (const code of codes) {
  try {
    const res = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {headers: {"user-agent": "sim-job-finder"}});
    if (res.status === 429) { await sleep(5000); continue; }
    const j = await res.json();
    const g = j.guild;
    if (!g) continue;
    const text = `${g.name} ${g.description || ""}`;
    const members = j.approximate_member_count, online = j.approximate_presence_count;
    if (members < 1000 || members > MAX_MEMBERS || online < 100 || BAD.test(text) || !SIM.test(text)) continue;
    if (SKIP.some(s => g.name.toLowerCase().includes(s))) continue;
    leads.push({name: g.name, code, members, online, about: (g.description || "").replace(/\s+/g, " ").slice(0, 120)});
  } catch {}
  await sleep(1500);
}
leads.sort((a, b) => b.online - a.online);
fs.writeFileSync("body.md", [
  `Communities that might want his free trial staff tracker bot (${new Date().toISOString().slice(0, 10)}). All checked live: 1,000+ members, 100+ online. Offer the bot in a ticket and ask for a manager.`,
  "",
  ...(leads.length ? leads.map(l => `- ${l.name}: https://discord.gg/${l.code} (${l.members.toLocaleString("en-GB")} members, ${l.online.toLocaleString("en-GB")} online) ${l.about}`) : ["- none this run"]),
  "",
].join("\n"));
console.log(leads.length);
