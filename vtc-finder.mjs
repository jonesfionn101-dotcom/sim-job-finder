/**
 * Finds trucking VTCs that are recruiting right now and worth applying to.
 *
 * Runs on GitHub's computers, so it works with the local PC switched off.
 *
 * Two sources, because neither is enough on its own:
 *   - the TruckersMP VTC search pages, which know who has recruitment open
 *   - the official API (api.truckersmp.com/v2/vtc/<id>), which knows the
 *     member count, languages, verified flag and Discord link
 *
 * Hard rule from experience: the user has no administrator rights on the local PC, so a
 * VTC whose only job logging is an installed tracker (TrackSim and friends) is
 * a dead end. Nothing on the API says which tracker a VTC uses, so every
 * shortlisted VTC gets the question printed next to it to ask before applying.
 */

const SEARCH = "https://truckersmp.com/vtc/search";
const API = "https://api.truckersmp.com/v2/vtc";
const PAGES = Number(process.env.VTC_PAGES || 4);
const MIN_MEMBERS = Number(process.env.VTC_MIN_MEMBERS || 60);
// "Well-known": verified by TruckersMP, or at least this big.
const WELL_KNOWN_MEMBERS = Number(process.env.VTC_WELL_KNOWN || 150);
// Only VTCs with a convoy or event within this many days either side of today.
const ACTIVE_DAYS = Number(process.env.VTC_ACTIVE_DAYS || 7);
import {outsiderJobPosts, jobPostLine} from "./job-posts.mjs";
const fs = await import("node:fs");
// VTCs the user has already joined or applied to, by name - not shown again.
// Communities already joined or applied to. Kept in the TRIED_VTCS secret
// (one name per line) so the list stays private in this public repo.
const TRIED = [
  ...JSON.parse(fs.readFileSync(new URL("./tried-vtcs.json", import.meta.url), "utf8")),
  ...(process.env.TRIED_VTCS || "").split(/[\n,]/),
].map(n => n.trim().toLowerCase()).filter(Boolean);
const SHORTLIST = Number(process.env.VTC_SHORTLIST || 10);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function text(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "oss-job-finder (personal job search)"}});
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.text();
}

async function json(url) {
  let response;
  for (let attempt = 1; attempt <= 4; attempt++) {
    response = await fetch(url, {signal: AbortSignal.timeout(20000), headers: {accept: "application/json"}}).catch(() => null);
    // Rate limited: wait and retry, so no VTC is silently skipped.
    if (response?.status !== 429) break;
    await sleep(20000 * attempt);
  }
  if (!response?.ok) return null;
  const body = await response.json();
  return body.error ? null : body.response;
}

/**
 * Recruiting VTC ids.
 *
 * truckersmp.com answers the local PC but returns 403 to datacentre addresses, so the
 * scheduled run reads vtc-watchlist.json, seeded locally, and checks each id
 * through the API instead. Scraping is only a fallback for a local run.
 */
async function recruitingIds() {
  const fs = await import("node:fs");
  if (fs.existsSync("vtc-watchlist.json")) {
    const list = JSON.parse(fs.readFileSync("vtc-watchlist.json", "utf8"));
    if (list.length) {
      console.error(`watchlist: ${list.length} VTCs`);
      return list.map(String);
    }
  }

  const ids = new Set();
  for (const verified of [true, false]) {
    for (let page = 1; page <= PAGES; page++) {
      const url = `${SEARCH}?recruitment=true${verified ? "&verified=true" : ""}&page=${page}`;
      let html;
      try {
        html = await text(url);
      } catch (error) {
        console.error(`skipped ${url}: ${error.message}`);
        continue;
      }
      const found = [...html.matchAll(/vtc\/(\d+)-[a-z0-9-]+/g)].map(m => m[1]);
      if (!found.length) break; // ran past the last page
      found.forEach(id => ids.add(id));
      await sleep(400);
    }
  }
  return [...ids];
}

const speaksEnglish = vtc =>
  (vtc.languages || [vtc.language]).some(l => (l || "").toLowerCase().includes("english"));

const UK = /\b(uk|u\.k\.|united kingdom|british|britain|england|scotland|scottish|wales|welsh|ireland|irish|gmt|bst)\b/i;

function reject(vtc) {
  if (vtc.recruitment !== "Open") return "recruitment closed again";
  if (!speaksEnglish(vtc)) return `${(vtc.languages || []).join("/") || "unknown"} only`;
  if (!vtc.games?.ets && !vtc.games?.ats) return "neither ETS2 nor ATS";
  if (vtc.members_count < MIN_MEMBERS) return `only ${vtc.members_count} members`;
  if (!vtc.verified && vtc.members_count < WELL_KNOWN_MEMBERS) return "not well-known (unverified, under " + WELL_KNOWN_MEMBERS + " members)";
  // Rules 2, 7 and 14 (checked 9 Oct 2026): UK-based, has a website, has a Discord.
  if (!UK.test(`${vtc.name} ${vtc.slogan || ""} ${vtc.information || ""}`) && !/\.uk(\/|$)/i.test(vtc.website || "")) return "not UK-based";
  if (!vtc.website) return "no website";
  if (!vtc.socials?.discord) return "no Discord";
  return null;
}

/** Bigger, verified, and reachable on Discord all count for something. */
const score = vtc =>
  Math.log10(vtc.members_count + 1) * 10 +
  (vtc.verified ? 25 : 0) +
  (vtc.validated ? 10 : 0) +
  (vtc.socials?.discord ? 15 : 0) +
  (vtc.website ? 5 : 0);

const line = vtc => {
  const bits = [
    `${vtc.members_count} members`,
    (vtc.languages || []).join("/"),
    [vtc.games?.ets && "ETS2", vtc.games?.ats && "ATS"].filter(Boolean).join(" + "),
  ];
  if (vtc.verified) bits.push("**verified**");
  if (vtc.validated) bits.push("validated");
  return bits.filter(Boolean).join(" · ");
};

/** The VTC's convoy or event closest to today, if one falls within ACTIVE_DAYS. */
async function recentEvent(id) {
  const events = await json(`${API}/${id}/events`);
  const now = Date.now();
  const near = (events || [])
    .map(event => ({event, gap: Math.abs(Date.parse(`${event.start_at}Z`) - now)}))
    .filter(({gap}) => gap <= ACTIVE_DAYS * 86400000)
    .sort((a, b) => a.gap - b.gap);
  return near[0]?.event || null;
}

async function main() {
  const ids = await recruitingIds();
  console.error(`checking ${ids.length} recruiting VTCs`);

  const kept = [];
  const dropped = [];
  for (const id of ids) {
    const vtc = await json(`${API}/${id}`);
    if (!vtc) continue;
    if (TRIED.some(name => vtc.name.toLowerCase().includes(name))) continue; // private list: skip silently
    const why = reject(vtc);
    const lastEvent = why ? null : await recentEvent(id);
    if (why) dropped.push(`${vtc.name}: ${why}`);
    else if (!lastEvent) dropped.push(`${vtc.name}: no convoy or event within ${ACTIVE_DAYS} days`);
    else kept.push({...vtc, lastEvent, jobs: await outsiderJobPosts(id)});
    await sleep(250);
  }

  kept.sort((a, b) => score(b) - score(a));
  const shortlist = kept.slice(0, SHORTLIST);

  const out = [`VTCs recruiting on ${new Date().toISOString().slice(0, 10)} — ${kept.length} passed the filters.`, ""];
  shortlist.forEach((vtc, index) => {
    out.push(`### ${index + 1}. ${vtc.name} ${vtc.tag ? `\`${vtc.tag}\`` : ""}`);
    out.push(`https://truckersmp.com/vtc/${vtc.id}`);
    out.push(`- ${line(vtc)}`);
    out.push(`- Active: ${vtc.lastEvent.name} (${vtc.lastEvent.start_at.slice(0, 10)})`);
    if (vtc.slogan) out.push(`- "${vtc.slogan.trim()}"`);
    if (vtc.socials?.discord) out.push(`- Discord: ${vtc.socials.discord}`);
    if (vtc.website) out.push(`- Site: ${vtc.website}`);
    vtc.jobs.slice(0, 3).forEach(post => out.push(`- ${jobPostLine(post)}`));
    out.push(`- **Ask first:** "How do you log jobs — TruckersMP logging, a website, or an app I'd have to install?" An installed tracker is a no.`);
    out.push("");
  });

  if (dropped.length) {
    out.push("<details><summary>Ruled out</summary>", "");
    dropped.slice(0, 60).forEach(d => out.push(`- ${d}`));
    out.push("", "</details>");
  }

  const body = out.join("\n");
  console.log(body);
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs");
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `count=${shortlist.length}\nbody<<VTCBODY\n${body}\nVTCBODY\n`
    );
  }
}

main().catch(error => {
  console.error("vtc-finder failed:", error.message);
  process.exit(1);
});
