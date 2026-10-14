// Site fault check (14 Oct 2026): looks at the PUBLIC pages of sim radio stations he can
// contact on Discord, and lists links that are broken, so he has a real fault to report in a
// "Developer Support" ticket. Only reads what any visitor sees - one request per link, no scanning.
// Writes the issue body to body.md and prints the number of faults.
import fs from "node:fs";

// TruckersFM is left out on purpose: he was kicked from it (14 Oct 2026).
// His order (14 Oct 2026): radio station faults first, then any other server's faults.
// Each fault gets its own ticket in that server.
const SITES = [
  {group: "📻 Radio stations (first)", name: "Simulator Radio", url: "https://simulatorradio.com/", discord: "https://discord.gg/radio"},
  {group: "📻 Radio stations (first)", name: "TruckStopRadio", url: "https://truckstopradio.co.uk/", discord: "https://discord.gg/truckstopradio-700853105985716237"},
  // GPE said no to bots: report a fault only, never offer to build them anything.
  {group: "🚛 Other servers he's in (second)", name: "Arctic VTC", url: "https://arcticvtc.com/", discord: "https://discord.gg/epR7GYNmt4"},
  {group: "🚛 Other servers he's in (second)", name: "Golden Phoenix Express", url: "https://goldenphoenixexpressvtc.com/", discord: "https://discord.com/channels/714176690024087575"},
];
// Social sites block tools, so a "broken" link there is not a real fault.
// Same for Ko-fi, Twitch and Cloudflare's own /cdn-cgi/ links (checked by hand 14 Oct 2026).
// TruckersMP blocks tools too, and "${...}" links are filled in by the page's own script later.
const IGNORE = /facebook\.com|instagram\.com|twitter\.com|x\.com|tiktok\.com|linkedin\.com|paypal\.me|ko-fi\.com|twitch\.tv|truckersmp\.com|\/cdn-cgi\/|cdn\.|fonts\.|iconscout|\$\{|%7B/i;

const get = (url, method = "GET") => fetch(url, {method, redirect: "follow", signal: AbortSignal.timeout(15000), headers: {"user-agent": "Mozilla/5.0"}});
const status = async url => {
  try {
    let r = await get(url, "HEAD");
    if (r.status === 405 || r.status === 403) r = await get(url);
    return r.status;
  } catch (e) {
    // A page that keeps redirecting to itself is a real fault ("too many redirects" in a browser).
    return /redirect/i.test(String(e?.cause?.message || e?.message)) ? "redirect loop" : "no answer";
  }
};

const out = ["Public pages checked on radio stations he can reach on Discord. A fault here = something to report in their Developer Support ticket.", ""];
let faults = 0;
let group = "";
for (const site of SITES) {
  if (site.group !== group) out.push(`## ${group = site.group}`, "", "One ticket per fault, in that server.", "");
  out.push(`### ${site.name} (${site.url})`, `- Discord: ${site.discord}`);
  let html = "";
  try { html = await get(site.url).then(r => r.ok ? r.text() : ""); } catch {}
  if (!html) { faults++; out.push("- ❌ Homepage did not load.", ""); continue; }
  const links = [...new Set([...html.matchAll(/href="([^"#]+)"/g)].map(m => new URL(m[1], site.url).href))]
    .filter(u => u.startsWith("http") && !IGNORE.test(u)).slice(0, 60);
  const broken = [];
  for (const link of links) {
    const s = await status(link);
    if (typeof s === "string" || s >= 400) broken.push(`${link} (${s})`);
  }
  faults += broken.length;
  out.push(`- ${links.length} links checked.`, ...(broken.length ? broken.map(b => `- ❌ Broken: ${b}`) : ["- ✅ No broken links."]), "");
}
fs.writeFileSync("body.md", out.join("\n"));
console.log(faults);
