// Mod request search (14 Oct 2026): keeps looking, every hour, for an English Discord server
// where you open a TICKET to ask for an ETS2/ATS (or other sim) mod to be built - for FREE.
// Paid commission shops and cheat servers are skipped. Writes body.md, prints the number found.
import fs from "node:fs";

const QUERIES = [
  "mod requests", "free mod requests", "request a mod", "mod request ticket", "ets2 mods", "ats mods",
  "ets2 modding", "ats modding", "scs mods", "truck mods", "truck simulator mods", "euro truck mods",
  "american truck mods", "truckstyling", "local mods", "sim mods", "simulator modding", "modding team",
  "free modding", "custom mods free", "mod suggestions", "mod ideas", "modders community", "mod hub",
  "farming simulator mods", "fs25 mods", "weather mods", "graphics mods", "sound mods", "tow truck mod",
];
const SIM = /\b(ets2|ats|euro truck|american truck|truck ?sim\w*|scs|truck(ing|s)?|farming sim\w*|fs ?2[25]|simulator)\b/i;
const REQUEST = /\b(mod requests?|requests?|ticket|suggest\w*|ideas?)\b/i;
// Paid work, cheats and things he's ruled out never count.
const SKIP = /commission|paid|price|shop|store|premium|\$|€|£|roblox|fivem|minecraft|gta|save ?edit|console codes|cheat|crack|insanux|truckersfm|universal trucks/i;

// A different slice of searches each hour, so the whole list is covered every few hours.
const hour = Math.floor(Date.now() / 3600000);
const slice = Array.from({length: 6}, (_, i) => QUERIES[(hour * 6 + i) % QUERIES.length]);

const get = url => fetch(url, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "Mozilla/5.0"}})
  .then(r => r.ok ? r.text() : "").catch(() => "");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const pages = new Set();
for (const q of slice) {
  for (const m of (await get(`https://discord.com/servers?query=${encodeURIComponent(q)}`)).matchAll(/\/servers\/[a-z0-9-]+-\d{15,20}/g)) pages.add(m[0]);
  await sleep(2000);
}
const found = [];
for (const page of pages) {
  const html = await get(`https://discord.com${page}`);
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
  const members = Number(((html.match(/([\d,]+) Members/) || [])[1] || "0").replace(/,/g, ""));
  const invite = (html.match(/discord\.gg\/[A-Za-z0-9-]+/) || [])[0];
  if (invite && members >= 500 && SIM.test(desc) && REQUEST.test(desc) && !SKIP.test(desc)) {
    found.push(`- **${page.split("/").pop().replace(/-\d+$/, "").replace(/-/g, " ")}**: https://${invite} (${members.toLocaleString("en-GB")} members) ${desc.slice(0, 160)}`);
  }
  await sleep(1500);
}
const out = [
  "Looking every hour for an English Discord server where you open a ticket to get a sim mod built for free.",
  `Searched this hour: ${slice.join(", ")}.`, "",
  ...(found.length ? ["## Possible matches - check inside for a mod-request ticket", "", ...found] : ["Nothing new yet. Still looking."]),
];
fs.writeFileSync("body.md", out.join("\n"));
console.log(found.length);
