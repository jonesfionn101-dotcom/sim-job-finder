/**
 * When a search comes back empty ("stuck"):
 *   1. Ask for Claude: open (or update) a "🆘 Stuck" issue. Claude reads these at
 *      the start of every session, does fresh research and adds leads to seeds.json.
 *   2. Meanwhile, hand it to another AI: a free model (Pollinations) is told what
 *      was already searched and suggests new search phrases, which are added to
 *      seeds.json so the very next run tries them.
 *
 *   node stuck-help.mjs "<search name>"
 */

import {execSync} from "node:child_process";
import fs from "node:fs";

const NAME = process.argv[2] || "Community search";
const REPO = process.env.GITHUB_REPOSITORY;
const AI_URL = process.env.AI_URL || "https://text.pollinations.ai/openai";
const sh = cmd => execSync(cmd, {encoding: "utf8", stdio: "pipe"});

const seeds = JSON.parse(fs.readFileSync("seeds.json", "utf8"));
const tried = seeds.community.queries;

async function askAnotherAI() {
  const prompt = `I search Discord's public server directory (discord.com/servers?query=...) for English-speaking UK or Irish gaming/sim communities (farming sim, truck sim, sim racing, UK gaming) whose description says they are hiring RIGHT NOW for a staff role an outsider can apply for: moderator, support, HR, ticket team, secretary, admin assistant, note taker, developer, media, events. Also servers that say "open a ticket to apply".
These search phrases found nothing: ${tried.slice(-40).join("; ")}.
Suggest 10 NEW short search phrases (2-5 words each) likely to find such servers. Reply with ONLY a JSON array of strings.`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(AI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(120000),
      headers: {"content-type": "application/json"},
      body: JSON.stringify({model: "openai", messages: [{role: "user", content: prompt}]}),
    }).catch(() => null);
    if (response?.ok) {
      const text = (await response.json().catch(() => null))?.choices?.[0]?.message?.content || "";
      const list = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || "[]");
      return list.filter(q => typeof q === "string" && q.length <= 60).map(q => q.toLowerCase().trim());
    }
    await new Promise(r => setTimeout(r, 20000 * attempt));
  }
  return [];
}

const fresh = (await askAnotherAI().catch(() => [])).filter(q => !tried.includes(q)).slice(0, 10);
if (fresh.length) {
  seeds.community.queries.push(...fresh);
  fs.writeFileSync("seeds.json", `${JSON.stringify(seeds, null, 2)}\n`);
  sh(`git config user.name "github-actions[bot]" && git config user.email "41898282+github-actions[bot]@users.noreply.github.com"`);
  sh(`git add seeds.json && git commit -qm "Stuck help: another AI added ${fresh.length} search phrases" && git pull -q --rebase && git push -q`);
}

const note = [
  `🆘 **${NAME} came back empty** (${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC).`,
  "",
  "**Step 1 – Claude:** next session, do fresh research and add leads (queries or invite codes) to `seeds.json`.",
  `**Step 2 – another AI:** ${fresh.length ? `Pollinations suggested ${fresh.length} new phrases, already added for the next run: ${fresh.join(", ")}` : "the free AI didn't answer this time; the next empty run will ask again."}`,
].join("\n");
fs.writeFileSync("stuck-note.md", note);
const open = sh(`gh issue list --repo ${REPO} --state open --search "\\"🆘 Stuck: ${NAME}\\" in:title" --json number -q ".[0].number"`).trim();
if (open) sh(`gh issue comment ${open} --repo ${REPO} --body-file stuck-note.md`);
else sh(`gh issue create --repo ${REPO} --title "🆘 Stuck: ${NAME}" --body-file stuck-note.md`);
console.log(note);
