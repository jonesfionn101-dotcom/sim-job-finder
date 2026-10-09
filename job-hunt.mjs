/**
 * Keeps searching TruckersMP VTCs, newest first, until it has TARGET staff
 * jobs that outsiders can apply for (rules in job-posts.mjs), or it has
 * checked MAX_VTCS VTCs. One gentle request at a time.
 *
 *   node job-hunt.mjs            (results go to job-hunt-results.md)
 */

import fs from "node:fs";
import {outsiderJobPosts, jobPostLine} from "./job-posts.mjs";

const API = "https://api.truckersmp.com/v2/vtc";
const TARGET = Number(process.env.TARGET || 10);
const MAX_VTCS = Number(process.env.MAX_VTCS || 20000);
const MIN_MEMBERS = 15;
const OUT = process.env.OUT || "job-hunt-results.md";
const TRIED = (process.env.TRIED_VTCS || "").split(/[\n,]/).map(n => n.trim().toLowerCase()).filter(Boolean);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${API}/${path}`, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0", accept: "application/json"}}).catch(() => null);
    if (response?.status === 429) { await sleep(30000); continue; }
    if (!response?.ok) return null;
    const body = await response.json().catch(() => null);
    return body && !body.error ? body.response : null;
  }
  return null;
}

/** Highest VTC id that exists, found by stepping up from a known one. */
async function newestId(from) {
  let id = from;
  for (let step = 2000; step >= 1; step = Math.floor(step / 2)) {
    while (await api(`${id + step}`)) id += step;
  }
  return id;
}

async function main() {
  const top = await newestId(Number(process.env.START_ID || 90000));
  const found = [];
  const write = (done) => fs.writeFileSync(OUT, [
    `# Staff jobs open to outsiders (${found.length} of ${TARGET})`,
    `Searched TruckersMP VTCs from #${top} down. ${done ? "Finished." : "Still searching..."} Updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    "",
    ...found.flatMap(({vtc, posts}, i) => [
      `## ${i + 1}. ${vtc.name}`,
      `- https://truckersmp.com/vtc/${vtc.id} (${vtc.members_count} members${vtc.language ? `, ${vtc.language}` : ""})`,
      `- Discord: ${vtc.socials?.discord || "not listed"}`,
      ...posts.slice(0, 2).map(p => `- ${jobPostLine(p)}`),
      "",
    ]),
  ].join("\n"));

  let checked = 0;
  for (let id = top; id > 0 && checked < MAX_VTCS && found.length < TARGET; id--, checked++) {
    if (checked % 250 === 0) { console.log(`checked ${checked} VTCs (at #${id}), ${found.length} jobs so far`); write(false); }
    const news = (await api(`${id}/news`))?.news;
    await sleep(600);
    if (!news?.length) continue;
    const posts = await outsiderJobPosts(id, news);
    if (!posts.length) continue;
    const vtc = await api(`${id}`);
    if (!vtc || vtc.members_count < MIN_MEMBERS || !vtc.socials?.discord) continue;
    if (TRIED.some(name => vtc.name.toLowerCase().includes(name))) continue;
    found.push({vtc, posts});
    console.log(`FOUND ${found.length}: ${vtc.name} - ${posts[0].title}`);
  }
  write(true);
  console.log(`done: ${found.length} jobs after checking ${checked} VTCs`);
}

main().catch(error => { console.error("job-hunt failed:", error.message); process.exit(1); });
