// Waiting watch (10 Oct 2026): servers he is waiting on. Each hour it checks their
// public apply page; when the role he wants says "Open", it becomes a job for him.
// Writes the issue body to body.md and prints the number open.
import fs from "node:fs";

const WAITING = [
  {
    name: "TruckStopRadio - Discord Moderator",
    page: "https://truckstopradio.co.uk/apply",
    role: "Discord Moderator",
    note: "Mods must be 16+ and handle tickets. No trial role. Apply as soon as it opens.",
  },
];
// Waiting with no public page to watch: shown so he remembers them.
const WAITING_ON_REPLY = [
  "PlayGSL - Helpers (16+, by ticket): his ticket is open, waiting for their reply.",
  "Golden Phoenix Express (GPE) - HR ticket open (10 Oct): offered a free trial staff tracker bot, waiting for their reply.",
  "Line of Energy VTC - Leadership ticket open (10 Oct): asked about outsider staff roles + offered the trial staff tracker bot, waiting for their reply.",
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
out.push("## ⏳ Still waiting", "", "His rule: staff must reply within 24 hours of a ticket. No reply by then = move it to No.", "", ...closed, ...WAITING_ON_REPLY.map(l => `- ${l}`), "");
fs.writeFileSync("body.md", out.join("\n"));
console.log(open);
