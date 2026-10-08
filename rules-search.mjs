/**
 * Community job search that follows the user's standing rules (community-search-rules).
 *
 * Runs on GitHub's computers three times a day, so it works with the local PC off.
 * Candidates are every UK company on Trucky (country GB); rules-watchlist.json
 * keeps the last list in case Trucky refuses a run. Everything is checked
 * through public APIs only - nothing is joined or posted.
 *
 * Rules checked automatically:
 *   - UK-based                      (Trucky country = GB)
 *   - has a website
 *   - Discord invite live           (Discord's public invite lookup, with counts)
 *   - staff count                   (Trucky roster members whose role has management powers),
 *                                    sliding 50 -> 40 -> 30 -> 20 -> 15 -> 10
 *   - management active             (newest news post or convoy, with dates)
 *   - verification type             (Discord's own click-to-agree screen, if visible)
 * Rules that can only be checked from inside (voice chat, ticket applications,
 * written brief, captcha bots) are printed as questions to check.
 */

import fs from "node:fs";

const API = "https://api.truckersmp.com/v2/vtc";
const STEPS = [50, 40, 30, 20, 15, 10];
const ACTIVE_DAYS = 2;
const SHORTLIST = 8;

// Communities already joined or applied to. Kept in the TRIED_VTCS secret
// (one name per line) so the list stays private in this public repo.
const TRIED = [
  ...JSON.parse(fs.readFileSync(new URL("./tried-vtcs.json", import.meta.url), "utf8")),
  ...(process.env.TRIED_VTCS || "").split(/[\n,]/),
].map(n => n.trim().toLowerCase()).filter(Boolean);
const IDS = JSON.parse(fs.readFileSync(new URL("./rules-watchlist.json", import.meta.url), "utf8")).map(String);


const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = ms => new Date(ms).toISOString().slice(0, 10);
const ago = ms => {
  const days = Math.floor((Date.now() - ms) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
};

async function api(path) {
  const response = await fetch(`${API}/${path}`, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0", accept: "application/json"}}).catch(() => null);
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null);
  return body && !body.error ? body.response : null;
}

async function discord(link) {
  const code = (link || "").replace(/^https?:\/\//, "").replace(/^(www\.)?(discord\.gg|discord(app)?\.com\/invite)\//, "").split(/[/?#]/)[0];
  if (!code || /discord\.com/.test(code)) return null;
  const response = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0"}}).catch(() => null);
  if (!response) return null;
  const invite = await response.json().catch(() => ({}));
  if (!invite.guild) return null;
  return {
    code,
    name: invite.guild.name,
    members: invite.approximate_member_count,
    online: invite.approximate_presence_count,
    clickToAgree: (invite.guild.features || []).includes("MEMBER_VERIFICATION_GATE_ENABLED"),
  };
}

/** Newest management sign of life: a news post or a convoy that already started. */
async function lastActivity(id) {
  const [news, events] = [await api(`${id}/news`), await api(`${id}/events`)];
  const now = Date.now();
  const dates = [
    ...(news?.news || []).map(n => ({what: `news "${n.title}"`, at: Date.parse(`${n.published_at}Z`)})),
    ...(events || []).map(e => ({what: `convoy "${e.name}"`, at: Date.parse(`${e.start_at}Z`)})),
  ].filter(d => d.at && d.at <= now).sort((a, b) => b.at - a.at);
  // Public job posts (8 Oct 2026): news posts that advertise a role, with the date each was posted.
  const jobs = (news?.news || [])
    .filter(n => JOB_POST.test(`${n.title} ${n.content_summary || ""}`))
    .map(n => ({title: n.title, role: (`${n.title} ${n.content_summary || ""}`.match(JOB_ROLE) || ["role not named"])[0], at: Date.parse(`${n.published_at}Z`), url: `https://truckersmp.com/vtc/${id}/news/${n.id}`}))
    .filter(j => j.at)
    .sort((a, b) => b.at - a.at);
  return dates[0] ? {...dates[0], jobs} : (jobs.length ? {jobs} : null);
}
const JOB_POST = /\b(hiring|recruit\w*|vacanc\w*|positions? (open|available)|applications? (are )?open|looking for|join (our|the) (staff|team)|wanted|needed)\b/i;
const JOB_ROLE = /\b(drivers?|staff|moderators?|admins?|hr|human resources|recruit(ers|ment)|event (team|staff)|media( team)?|developers?|designers?|managers?|support|dispatch\w*|convoy (control|team))\b/i;

const TRUCKY = "https://e.truckyapp.com/api/v1";
const truckyHeaders = {"user-agent": "Mozilla/5.0 (rules-search; personal job search)", accept: "application/json"};

async function trucky(path) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${TRUCKY}/${path}`, {signal: AbortSignal.timeout(20000), headers: truckyHeaders}).catch(() => null);
    if (response?.ok) return response.json().catch(() => null);
    await sleep(5000 * (attempt + 1));
  }
  return null;
}

/** Every UK company on Trucky. Falls back to the last saved copy if Trucky refuses. */
async function ukCompanies() {
  const all = [];
  for (let page = 1; ; page++) {
    const data = await trucky(`companies?country_code=GB&page=${page}`);
    if (!data) break;
    all.push(...data.data);
    if (page >= data.last_page) break;
    await sleep(1200);
  }
  const cache = new URL("./rules-watchlist.json", import.meta.url);
  if (all.length) fs.writeFileSync(cache, JSON.stringify(all.map(c => c.id)));
  else console.error("Trucky list unavailable, using saved ids");
  return all.length ? all : (await Promise.all(IDS.map(id => trucky(`company/${id}`)))).filter(Boolean);
}

/** Roster members whose Trucky role has management powers (or is owner/management). */
async function staffCount(id) {
  const roles = await trucky(`company/${id}/roles`);
  if (!Array.isArray(roles)) return 0;
  // Owners, management, and roles with real "Manage ..." powers. The default
  // role new drivers get never counts, even if it has small permissions.
  const staffRoles = new Set(roles
    .filter(r => !r.new_member_default_role)
    .filter(r => r.owner || r.management || (r.permissions || []).some(p => /^manage/i.test(p.name)))
    .map(r => r.id));
  let count = 0;
  for (let page = 1; page <= 20; page++) {
    const data = await trucky(`company/${id}/members?page=${page}`);
    if (!data?.data) break;
    count += data.data.filter(m => staffRoles.has(m.role_id)).length;
    if (page >= data.last_page) break;
    await sleep(600);
  }
  return count;
}

async function main() {
  const companies = await ukCompanies();
  console.error(`checking ${companies.length} UK companies`);
  const candidates = [];
  const dropped = [];

  for (const company of companies) {
    const name = company.name;
    if (String(company.recruitment).toLowerCase() !== "open") continue; // most are closed; not worth listing
    const why =
      !company.website ? "no website" :
      null;
    if (TRIED.some(n => name.toLowerCase().includes(n))) continue; // private list: skip silently
    if (why) { dropped.push(`${name}: ${why}`); continue; }

    const server = await discord(company.discord);
    if (!server) { dropped.push(`${name}: Discord invite missing or dead`); continue; }

    const staff = await staffCount(company.id);
    const tmp = company.external_system === "truckersmp" ? company.external_id : null;
    const active = tmp ? await lastActivity(tmp) : null;
    await sleep(500);
    candidates.push({
      vtc: {name, id: tmp, website: company.website, members_count: company.members_count, trucky: company.public_url || `https://hub.truckyapp.com/vtc/${company.slug}`},
      server, staff, active,
    });
  }

  // Sliding staff number: use the highest step that finds at least one.
  let step = STEPS.at(-1);
  let kept = [];
  for (const s of STEPS) {
    kept = candidates.filter(c => c.staff >= s);
    if (kept.length) { step = s; break; }
  }
  kept.sort((a, b) => (b.active?.at || 0) - (a.active?.at || 0) || b.staff - a.staff);

  const today = day(Date.now());
  const out = [
    `Rules search ${today}. ${candidates.length} recruiting UK VTCs with a website and a live Discord; ` +
      (kept.length ? `${kept.length} found at the **${step}+ staff** level.` : `none had even ${STEPS.at(-1)} staff.`),
    "",
  ];
  kept.slice(0, SHORTLIST).forEach(({vtc, server, staff, active}, i) => {
    const fresh = active && Date.now() - active.at <= ACTIVE_DAYS * 86400000;
    out.push(`### ${i + 1}. ${vtc.name}`);
    out.push(`- Trucky: ${vtc.trucky}`);
    if (vtc.id) out.push(`- TruckersMP: https://truckersmp.com/vtc/${vtc.id}`);
    out.push(`- Join Discord: https://discord.gg/${server.code} (${server.members} members, ${server.online} online, checked ${today})`);
    out.push(`- Website: ${vtc.website}`);
    out.push(`- Staff on the roster: ${staff} (${vtc.members_count} members in total)`);
    out.push(`- Management last active: ${active?.at ? `${active.what}, ${day(active.at)} (${ago(active.at)})` : "no news or convoys found"} ${fresh ? "✅" : "⚠️ older than 2 days"}`);
    if (active?.jobs?.length) active.jobs.slice(0, 3).forEach(j => out.push(`- 📢 Job post: "${j.title}" (${j.role}), posted ${day(j.at)} (${ago(j.at)}) — ${j.url}`));
    else out.push(`- 📢 Job post: none public — ask in their Discord which roles are open`);
    out.push(`- Verification: ${server.clickToAgree ? "Discord's click-to-agree rules screen ✅" : "can't see from outside — leave if it asks for maths"}`);
    out.push(`- Check inside: voice channels? apply by ticket? will they give a written brief?`);
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
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${Math.min(kept.length, SHORTLIST)}\nstep=${step}\nbody<<RULESBODY\n${body}\nRULESBODY\n`);
  }
}

main().catch(error => {
  console.error("rules-search failed:", error.message);
  process.exit(1);
});
