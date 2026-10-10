// Waiting watch (10 Oct 2026): servers he is waiting on. Each hour it checks their
// public apply page; when the role he wants says "Open", it becomes a job for him.
// Writes the issue body to body.md and prints the number open.
import fs from "node:fs";

const WAITING = [
  {
    name: "TruckStopRadio - Discord Moderator",
    page: "https://truckstopradio.co.uk/apply",
    role: "Discord Moderator",
    note: "Mods must be 16+ and handle tickets. No trial role. Apply as soon as it opens. 10 Oct: Jordan is asking the Station Manager about his free mod-tracker bot.",
  },
];
// Waiting with no public page to watch: shown so he remembers them.
const WAITING_ON_REPLY = [
  "PlayGSL - replied in under 3 hours (passes 24h rule). No bot needed. Everyone starts as Trial Helper, 2-3 months to full Helper. They asked for his ideas to make the server active - he is replying.",
  "TruckStopRadio - Jordan is asking the Station Manager about his mod-tracker bot offer (10 Oct). Waiting - do not chase.",
  "Golden Phoenix Express (GPE) - HR ticket open (10 Oct): offered a free trial staff tracker bot, waiting for their reply.",
  "Line of Energy VTC - Leadership ticket open (10 Oct): asked about outsider staff roles + offered the trial staff tracker bot, waiting for their reply.",
  "WASD - support ticket #157 open (10 Oct): asked about ticket staff roles + offered the tracker bot, waiting for their reply.",
  "Arctic VTC - HR ticket open (10 Oct): asked about outsider staff roles + offered the tracker bot, waiting.",
  "TruckersHub - Event Management ticket open (10 Oct): suggested Convoy-mode events + asked about the tracker bot, waiting.",
  "MrSealyPeeps - suggestion ticket open (10 Oct): offered the tracker bot + asked about staff roles, waiting.",
  "A.P. 101 Gaming - asked in general chat how to contact staff (10 Oct). venda13 [ABOO] offered to help at 3:32 PM - check if staff.",
  "FSC (Farming Simulator Community) - setup bot broken; he reported it in chat and offered to help fix it (10 Oct). Waiting.",
  "VTLog.net - website ticket (Anything else) sent 10 Oct: asked about staff roles + offered the tracker bot. Waiting - check vtlog.net for replies.",
  "Krone Liner - VTC Management ticket open 10 Oct 4:28 PM (General Manager + Owner pinged): asked about non-driver staff roles + offered tracker bot. Told them his power may go off. Waiting.",
  "MB Farms (farming community, 1,238 members) - ticket open 10 Oct; a staff member picked it up straight away. Asked about staff roles + offered tracker bot. Waiting on their reply.",
  "BritishAce Community Server - asked in general chat how to open a ticket (10 Oct); idea: tier-tracker bot for their 3-tier system. Waiting.",
  "Yapton & District (bus sim) - emails checked and look GENUINE (domain is theirs); dylxn gave hiring emails; he asked dylxn 4 checking questions (10 Oct). Waiting.",
  "United Convoys - ticket answered fast (passes 24h rule). Applied via their apply channel (10 Oct); they check applications once a week.",
  "TruckersMP - Addon Team/Artist: applications closed; needs a website login. Their site blocks bots, so check truckersmp.com/recruitment yourself now and then.",
];

const lines = (html) => html.replace(/<[^>]*>/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);
let open = 0;
const out = ["Servers he is waiting on. Checked every hour.", ""];
const closed = [];
for (const w of WAITING) {
  let status = "could not check";
  try {
    const page = lines(await fetch(w.page).then(r => r.text()));
    const at = page.indexOf(w.role);
    // The page shows "Open" or "Closed" just before each role's name.
    if (at > 0) status = /^open$/i.test(page[at - 1]) ? "open" : "closed";
  } catch {}
  if (status === "open") {
    open++;
    out.push(`### ${w.name}`);
    out.push(`- Open: ${w.page}`);
    out.push(`- 🟢 Open job: "${w.role}" now says Open on their apply page (checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)`);
    out.push(`  - Ticket job: yes - mods handle tickets`);
    out.push(`- ${w.note}`);
    out.push("");
  } else closed.push(`- ${w.name}: ${status}`);
}
out.push("## ⏳ Still waiting", "", "His rule (changed 10 Oct): the 24-hour clock starts when the person who decides (e.g. a manager) first replies to him - not when he sends his first message.", "", ...closed, ...WAITING_ON_REPLY.map(l => `- ${l}`), "");
fs.writeFileSync("body.md", out.join("\n"));
console.log(open);
