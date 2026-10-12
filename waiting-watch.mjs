// Waiting watch (10 Oct 2026): servers he is waiting on. Each hour it checks their
// public apply page; when the role he wants says "Open", it becomes a job for him.
// Writes the issue body to body.md and prints the number open.
import fs from "node:fs";

const WAITING = [
  {
    name: "TruckStopRadio - Discord Moderator",
    page: "https://truckstopradio.co.uk/apply",
    role: "Discord Moderator",
    note: "Mods must be 16+ and handle tickets. No trial role. Apply as soon as it opens. Bot offer: no (11 Oct).",
  },
];
// Waiting with no public page to watch: shown so he remembers them.
const WAITING_ON_REPLY = [
  "PlayGSL - replied in under 3 hours (passes 24h rule). No bot needed. Everyone starts as Trial Helper, 2-3 months to full Helper. They asked for his ideas to make the server active - he is replying.",
  "Golden Phoenix Express (GPE) - bot: NO. Event Assistant application SENT 12 Oct; answer expected ~14 Oct. Do not chase.",
  "Line of Energy VTC - 11 Oct: staff application UNDER REVIEW with project management. Do not chase.",
  "WASD - support ticket #157 open (10 Oct): asked about ticket staff roles + offered the tracker bot, waiting for their reply.",
  "Arctic VTC - bot: NO. 12 Oct: contact ticket asking about Event Planner: open to outsiders (no driver needed). Ava passed him to the Event Department - WAITING for them. Application is short. Tracker = TruckersHub. HR closed. HR closed. Never mention the bot.",
  "TruckersHub - Event Management ticket open (10 Oct): suggested Convoy-mode events + asked about the tracker bot, waiting.",
  "MrSealyPeeps - suggestion ticket open (10 Oct): offered the tracker bot + asked about staff roles, waiting.",
  "A.P. 101 Gaming - asked in general chat how to contact staff (10 Oct). venda13 [ABOO] offered to help at 3:32 PM - check if staff.",
  "FSC (Farming Simulator Community) - setup bot broken; he reported it in chat and offered to help fix it (10 Oct). Waiting.",
  "VTLog.net - website ticket (Anything else) sent 10 Oct: asked about staff roles + offered the tracker bot. Waiting - check vtlog.net for replies.",
  "Krone Liner - REPLIED 10 Oct 7:50 PM: Burakofficial asked why he builds free bots. Talking.",
  "BritishAce Community Server - asked in general chat how to open a ticket (10 Oct); idea: tier-tracker bot for their 3-tier system. Waiting.",
  "Yapton & District (bus sim) - emails checked and look GENUINE (domain is theirs); dylxn gave hiring emails; he asked dylxn 4 checking questions (10 Oct). Waiting.",
  "United Convoys - ticket answered fast (passes 24h rule). Applied via their apply channel (10 Oct); they check applications once a week.",
  "Global Trucking - HR passed his bot offer to the COO (BooSter2285) 11 Oct. Do NOT tag staff there. Waiting.",
  "At The Mile Logistics - asked in general chat how to open a ticket (11 Oct). Waiting.",
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
