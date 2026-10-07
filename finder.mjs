/**
 * Finds open-source jobs that match the owner's rules and writes a shortlist.
 *
 * Rules (from G:\AI_Projects\oss-queue and the user's own words):
 *  - opened in the last 7 days
 *  - nobody assigned, no linked pull request, few comments
 *  - a maintainer is involved (author or commenter is OWNER/MEMBER/COLLABORATOR)
 *  - the project has a live Discord
 *  - JavaScript/TypeScript/CSS, so its tests run on the local PC (no Docker, no
 *    compiled Python: scipy and friends are blocked by a policy on the user's machine)
 *  - the project does not demand the PR text be written in the user's own words
 *
 * Runs on GitHub Actions with the built-in token; no secrets needed.
 */
import {humanOnlyRule, untestableIssue, untestableProject} from "./auto-rules.mjs";

const TOKEN = process.env.GITHUB_TOKEN;
const DAYS = Number(process.env.FINDER_DAYS || 7);
const MIN_STARS = Number(process.env.FINDER_MIN_STARS || 300);
const WANTED = 8;

// Projects to skip: already worked on, hostile to outside or AI-assisted PRs,
// or needing software the local PC cannot run.
const BLOCKED = new Set([
  "vitejs/vite",
  "vitest-dev/vitest",
  "actualbudget/actual",
  "openstreetmap/iD",
  "sugarlabs/musicblocks",
  "sugarlabs/musicblocks-v4",
  "lingdojo/kana-dojo",
  "LibrePhotos/librephotos",
  "activepieces/activepieces",
  "tldraw/tldraw",
  "sveltejs/svelte",
  "sveltejs/kit",
  "typescript-eslint/typescript-eslint",
  "pnpm/pnpm",
  "nodejs/node", // fixes need a full Node build to test, which the user declined
  "wasp-lang/wasp", // maintainer turned down our plan under their AI policy (#4908, 29 Sept 2026)
  "prettier/prettier", // the user's call 3 Oct 2026: the slowest jobs, and fixes kept getting beaten to it
]);

const OWN_WORDS_PHRASES = [
  "own words",
  "never let an llm speak for you",
  "we expect to interact with real humans",
  "must be written by a human",
  "not written by an llm",
  "no ai-generated pull requests",
  "ai-generated pull requests are not accepted",
  "contribution farming",
];

/**
 * Projects word AI bans a hundred ways, so exact phrases alone miss most of
 * them - Immich's "we ask you not to open PRs generated with an LLM" got
 * through. These catch the shapes rather than the sentences.
 */
const AI_BAN_PATTERNS = [
  /\bnot (to )?(open|submit|send)[^.]{0,40}\b(generated|written)\b[^.]{0,25}\b(llm|ai|chatgpt|copilot)/,
  /\b(llm|ai)[- ](generated|written|assisted)\b[^.]{0,80}\b(not (be )?(accepted|allowed|welcome)|will be (closed|rejected)|forbidden|prohibited|banned)/,
  /\b(forbidden|prohibited|not allowed|not permitted|banned)\b[^.]{0,60}\b(llm|chatgpt|copilot|generative ai|ai tools?)\b/,
  /\b(llms?|chatgpt|copilot|generative ai|ai tools?)\b[^.]{0,60}\b(forbidden|prohibited|not allowed|not permitted|banned)\b/,
  /\bdo not use (an? )?(llm|ai|chatgpt|copilot)/,
];

/** Where projects put their AI rules. The PR template is the one most often missed. */
const AI_POLICY_FILES = [
  "CONTRIBUTING.md",
  ".github/CONTRIBUTING.md",
  "docs/CONTRIBUTING.md",
  "AI_POLICY.md",
  ".github/AI_POLICY.md",
  ".github/pull_request_template.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "AGENTS.md",
  ".github/agents/pr-and-commit-rules.md",
  "CLAUDE.md",
  "README.md",
];

const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const LANGUAGES = ["TypeScript", "JavaScript", "CSS", "HTML", "Vue", "Svelte"];

const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

// GitHub's search now and then answers with an HTML error page (502/504)
// instead of JSON; one bad answer should not sink the whole morning run.
const GRAPHQL_TRIES = 5;
const GRAPHQL_BACKOFF_MS = 15000;

async function graphql(query, variables = {}) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch("https://api.github.com/graphql", {signal: AbortSignal.timeout(20000), 
      method: "POST",
      headers: {
        authorization: `bearer ${TOKEN}`,
        "content-type": "application/json",
        "user-agent": "oss-job-finder",
      },
      body: JSON.stringify({query, variables}),
    });
    if (response.status === 401) throw new Error("GitHub rejected the token (401) - is GITHUB_TOKEN set?");
    let json;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (json && !json.errors && json.data) return json.data;
    if (attempt >= GRAPHQL_TRIES) {
      throw new Error(json?.errors ? json.errors.map(e => e.message).join("; ") : `GitHub answered ${response.status}, not JSON`);
    }
    await new Promise(resolve => setTimeout(resolve, GRAPHQL_BACKOFF_MS * attempt));
  }
}

async function rest(path) {
  const response = await fetch(`https://api.github.com${path}`, {signal: AbortSignal.timeout(20000), 
    headers: {
      authorization: `bearer ${TOKEN}`,
      accept: "application/vnd.github.raw",
      "user-agent": "oss-job-finder",
    },
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.text();
}

const SEARCH = `
query ($q: String!) {
  search(type: ISSUE, first: 50, query: $q) {
    nodes {
      ... on Issue {
        number title url createdAt body
        labels(first: 15) { nodes { name } }
        author { login }
        authorAssociation
        comments(last: 6) { totalCount nodes { author { login } authorAssociation body } }
        timelineItems(itemTypes: [CONNECTED_EVENT], last: 20) { totalCount }
        crossRefs: timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], last: 25) {
          nodes { ... on CrossReferencedEvent { source { ... on PullRequest { number state } } } }
        }
        repository {
          nameWithOwner stargazerCount pushedAt
          primaryLanguage { name }
        }
      }
    }
  }
}`;

// Projects already checked by hand: active, welcoming to outsiders, tests run
// on the local PC. Searched one by one so a busy day cannot crowd them out of the
// global results, which is how HeroUI #6876 was nearly missed.
const WATCHLIST = [
  "heroui-inc/heroui",
  "wasp-lang/wasp",
  "jellyfin/jellyfin-web",
  "silexlabs/Silex",
  "ETS2LA/ETS2LA",
];

// Household-name projects. The user asked for "well-known things that have actual
// problems" - a merged fix in one of these is worth far more on the user's portfolio
// than ten fixes nobody has heard of. Swept individually so their issues are
// never crowded out, and reported first.
const FAMOUS = [
  "microsoft/vscode",
  "facebook/react",
  "vercel/next.js",
  "tailwindlabs/tailwindcss",
  "prettier/prettier",
  "eslint/eslint",
  "storybookjs/storybook",
  "withastro/astro",
  "mui/material-ui",
  "chakra-ui/chakra-ui",
  "colinhacks/zod",
  "TanStack/table",
  "date-fns/date-fns",
  "axios/axios",
  "expressjs/express",
  "nodejs/node",
  "jestjs/jest",
  "puppeteer/puppeteer",
  "excalidraw/excalidraw",
  "immich-app/immich",
  "n8n-io/n8n",
  "supabase/supabase",
  "calcom/cal.com",
  "shadcn-ui/ui",
];

async function findCandidates() {
  const queries = [
    ...[...FAMOUS, ...WATCHLIST].map(
      repo =>
        `repo:${repo} is:issue is:open no:assignee -linked:pr created:${since}..${today} comments:0..4`
    ),
    `is:issue is:open no:assignee -linked:pr created:${since}..${today} label:"good first issue" comments:0..4`,
    `is:issue is:open no:assignee -linked:pr created:${since}..${today} label:"help wanted" comments:0..4`,
    `is:issue is:open no:assignee -linked:pr created:${since}..${today} label:bug comments:0..4 language:TypeScript`,
    `is:issue is:open no:assignee -linked:pr created:${since}..${today} label:bug comments:0..4 language:JavaScript`,
    // Plenty of real bugs carry no helpful label at all (HeroUI #6876 was
    // labelled only P2/pkg/react), so sweep by language as well.
    `is:issue is:open no:assignee -linked:pr created:${since}..${today} comments:0..4 language:TypeScript stars:>${MIN_STARS} sort:updated-desc`,
    `is:issue is:open no:assignee -linked:pr created:${since}..${today} comments:0..4 language:JavaScript stars:>${MIN_STARS} sort:updated-desc`,
  ];
  const seen = new Map();
  let failed = 0;
  for (const q of queries) {
    let data;
    try {
      data = await graphql(SEARCH, {q});
    } catch (error) {
      // One search GitHub will not answer should not lose the other sweeps.
      failed++;
      console.error(`search failed, carrying on: ${error.message}`);
      continue;
    }
    for (const issue of data.search.nodes) {
      if (!issue?.repository) continue;
      seen.set(issue.url, issue);
    }
  }
  if (failed) console.error(`${failed} of ${queries.length} searches failed`);
  if (failed === queries.length) throw new Error("GitHub answered none of the searches");
  return [...seen.values()];
}

/**
 * Some issues are really a question for the maintainers - "should we drop X?",
 * "is this worth backporting?" - and a pull request before they have decided
 * is wasted work that also reads as pushy. These stay on the list with a note,
 * and the worker does not start them.
 */
const DECISION_LABELS = /^(discussion|needs?[ -]decision|needs?[ -]discussion|proposal|rfc|question|needs?[ -]triage|breaking[ -]change|design|idea|under consideration|awaiting decision)$/i;
const DECISION_TITLE = /^(should|shall|could|would|why|what|is there|do we|can we|rfc\b|proposal\b|discussion\b)|\?\s*$|\b(drop support|deprecat\w*|remove support|breaking change|backport\w*|policy)\b/i;
const DECISION_BODY = /\b(what do (you|people|we) think|thoughts\?|open to (ideas|suggestions)|before (we|anyone) (start|implement)|needs? (a )?decision|up for discussion|not sure (if|whether) we (should|want))\b/i;

function needsDecision(issue) {
  const label = (issue.labels?.nodes || []).map(l => l.name).find(name => DECISION_LABELS.test(name.trim().replace(/^[\w-]+:\s*/, "")));
  if (label) return `labelled "${label}"`;
  const title = issue.title.match(DECISION_TITLE);
  if (title) return `the title is a question or policy change ("${title[0].trim()}")`;
  const body = (issue.body || "").slice(0, 3000).match(DECISION_BODY);
  if (body) return `the issue asks for opinions ("${body[0]}")`;
  return null;
}

function maintainerInvolved(issue) {
  if (MAINTAINER.has(issue.authorAssociation)) {
    return {who: issue.author?.login, how: "opened the issue"};
  }
  const comment = issue.comments.nodes.find(c => MAINTAINER.has(c.authorAssociation));
  if (comment) {
    return {who: comment.author?.login, how: "commented: " + comment.body.slice(0, 140).replace(/\s+/g, " ")};
  }
  return null;
}

// Internal housekeeping, not jobs for an outsider: VS Code files dozens of
// "Test: ..." test-plan items each release, and deps/chore/release chores are
// for the team.
const HOUSEKEEPING = /^(test|deps|chore|release|ci|build|revert|bump)\b\s*[:-]/i;

const CLAIM_WORDS = /(i'?d like to work|can i (work on|take|pick)|could i (work on|take)|may i (work on|take)|i'?ll take this|assign (this |it )?to me|working on this|i am on it|i'?m on it)/i;

async function discordFor(repo) {
  for (const file of ["README.md", "CONTRIBUTING.md", ".github/CONTRIBUTING.md"]) {
    const text = await rest(`/repos/${repo}/contents/${file}`);
    if (!text) continue;
    const match = text.match(/https?:\/\/discord\.(?:gg|com\/invite)\/([A-Za-z0-9-]+)/);
    if (!match) continue;
    const invite = await fetch(
      `https://discord.com/api/v10/invites/${match[1]}?with_counts=true`,
      {signal: AbortSignal.timeout(20000)}
    ).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (invite?.guild) {
      return {
        url: `https://discord.gg/${match[1]}`,
        name: invite.guild.name,
        members: invite.approximate_member_count,
        online: invite.approximate_presence_count,
      };
    }
  }
  return null;
}

/**
 * Everything in a project's rules that changes how a job has to be done.
 * Reading these only after starting cost us twice: Immich bans AI-written PRs,
 * and Wasp closes unagreed non-trivial PRs unread. So every job gets its
 * project's rules read in full before it goes on the list.
 */
const RULE_CHECKS = {
  agreementFirst: [
    /talk to us before writing code/,
    /\b(need|needs|require|requires) (maintainer )?(agreement|approval) (in advance|first|before)/,
    /\bwait for a maintainer to (agree|approve|confirm)/,
    /\b(discuss|propose)[^.]{0,50}\bbefore (you )?(start|starting|writ|open|submit|implement)/,
    /\b(open|create|file) an issue (first|before)/,
    /\bclose[d]? (prs|pull requests) (for|that are|without)[^.]{0,40}(undiscussed|not (been )?discussed|prior discussion)/,
    /\b(must|should) be (approved|accepted|triaged) before/,
  ],
  claimFirst: [/\b(ask|comment|request) to be assigned\b/, /\bget (yourself )?assigned\b/, /\bassigned to you before\b/],
  cla: [/contributor license agreement/, /\bsign (the|our) cla\b/],
  dco: [/developer certificate of origin/, /signed-off-by/, /--signoff\b/, /\bdco\b/],
  tests: [/\b(add|include|write|with) (a |new )?(unit )?tests?\b/, /\bcomes? with a test\b/],
  changeset: [/\bchangesets?\b/],
  conventionalCommits: [/conventional commits?/],
  aiDisclosure: [/\b(describe|disclose|state)\b[^.]{0,60}\b(llm|ai)\b[^.]{0,30}\bused\b/, /\bto which degree[^.]{0,40}\bllm\b/],
};

const RULE_LABELS = {
  agreementFirst: "maintainers must agree the plan before any code - post the plan on the issue first",
  claimFirst: "ask to be assigned before starting",
  cla: "needs a signed CLA",
  dco: "every commit needs a Signed-off-by line (git commit -s)",
  tests: "fixes are expected to come with a test",
  changeset: "needs a changeset file",
  conventionalCommits: "commit messages must follow Conventional Commits",
  aiDisclosure: "the PR must say how much AI was used - answer honestly",
};

async function readProjectRules(repo) {
  const rules = {aiBan: null, found: []};
  const texts = [];
  for (const file of AI_POLICY_FILES) {
    const text = await rest(`/repos/${repo}/contents/${file}`);
    if (!text) continue;
    const lower = text.toLowerCase().replace(/\s+/g, " ");
    texts.push([file, lower]);
    if (!rules.aiBan) {
      const hit = OWN_WORDS_PHRASES.find(phrase => lower.includes(phrase));
      const pattern = AI_BAN_PATTERNS.find(re => re.test(lower));
      if (hit) rules.aiBan = `${file}: "${hit}"`;
      else if (pattern) rules.aiBan = `${file}: "${lower.match(pattern)[0].slice(0, 90)}"`;
    }
  }
  for (const [file, lower] of texts) {
    const quote = humanOnlyRule(lower);
    if (quote) { rules.humanOnly = `${file}: "${quote}"`; break; }
  }
  rules.untestable = untestableProject(await rest(`/repos/${repo}/contents/package.json`));
  for (const [key, patterns] of Object.entries(RULE_CHECKS)) {
    for (const [file, lower] of texts) {
      const pattern = patterns.find(re => re.test(lower));
      if (!pattern) continue;
      rules[key] = true;
      rules.found.push({rule: key, meaning: RULE_LABELS[key], file, quote: lower.match(pattern)[0].slice(0, 100)});
      break;
    }
  }
  rules.filesRead = texts.map(([file]) => file);
  return rules;
}

async function outsiderMerges(repo) {
  const data = await graphql(
    `query ($q: String!) { search(type: ISSUE, first: 20, query: $q) {
       nodes { ... on PullRequest { number title mergedAt author { login } authorAssociation } } } }`,
    {q: `repo:${repo} is:pr is:merged merged:>=${new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)} sort:updated-desc`}
  );
  // "outsider" = not a member/owner/collaborator of the project. The token
  // GitHub Actions provides cannot search other repos pull requests, so an
  // empty result there means "unknown", not "never merges outsiders".
  const nodes = data.search.nodes.filter(Boolean);
  const outsiders = nodes.filter(pr =>
    ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER"].includes(pr.authorAssociation)
  );
  return {outsiders, checked: nodes.length > 0};
}

const rulesCache = new Map();

async function main() {
  const candidates = await findCandidates();
  const picks = [];
  const rejected = [];

  for (const issue of candidates) {
    if (picks.length >= WANTED) break;
    const repo = issue.repository.nameWithOwner;
    const note = reason => rejected.push(`${repo}#${issue.number}: ${reason}`);

    if (BLOCKED.has(repo)) continue;
    if (issue.repository.stargazerCount < MIN_STARS) continue;
    const language = issue.repository.primaryLanguage?.name;
    if (!language || !LANGUAGES.includes(language)) continue;
    if (issue.repository.stargazerCount < MIN_STARS) continue;
    if (issue.timelineItems.totalCount > 0) {
      note("a pull request is already linked to it");
      continue;
    }
    // A PR that only mentions the issue ("see #123") never shows up as a
    // connected event, so check cross-references too: an open or merged one
    // means somebody is already on it.
    const takenBy = issue.crossRefs.nodes.find(n => ["OPEN", "MERGED"].includes(n.source?.state));
    if (takenBy) {
      note(`already has a ${takenBy.source.state.toLowerCase()} pull request (#${takenBy.source.number})`);
      continue;
    }
    if (issue.comments.nodes.some(c => CLAIM_WORDS.test(c.body))) {
      note("already claimed in the comments");
      continue;
    }

    if (HOUSEKEEPING.test(issue.title)) {
      note("looks like internal housekeeping (" + issue.title.split(/[:-]/)[0] + ")");
      continue;
    }

    const maintainer = maintainerInvolved(issue);
    if (!maintainer) continue;

    if (!rulesCache.has(repo)) rulesCache.set(repo, await readProjectRules(repo));
    const rules = rulesCache.get(repo);
    if (rules.aiBan) {
      note(`their rules say PR text must be human-written ("${rules.aiBan}")`);
      continue;
    }

    // Full-auto rules: an AI must be allowed to do the whole job, and the fix
    // must be provable on the local PC.
    if (rules.humanOnly) {
      note(`needs a person in the loop (${rules.humanOnly})`);
      continue;
    }
    if (rules.untestable) {
      note(rules.untestable);
      continue;
    }
    const cantTest = untestableIssue(issue.title, issue.body);
    if (cantTest) {
      note(cantTest);
      continue;
    }

    // Standing rule (7 Oct 2026): every project needs a live Discord, famous or not.
    const discord = await discordFor(repo);
    if (!discord) {
      note("no live Discord community");
      continue;
    }

    const {outsiders: merges, checked} = await outsiderMerges(repo);
    if (checked && merges.length < 1) {
      note("no outsider PRs merged in the last 3 months");
      continue;
    }

    picks.push({
      issue, repo, language, maintainer, discord, merges,
      famous: FAMOUS.includes(repo),
      decision: needsDecision(issue),
      rules,
    });
  }

  // Work that can start today first, then famous before not, then question-shaped ones last.
  picks.sort((a, b) =>
    Number(Boolean(a.decision)) - Number(Boolean(b.decision)) ||
    Number(b.famous) - Number(a.famous)
  );

  const lines = [];
  lines.push(`Shortlist for ${today} — issues opened since ${since}.`, "");
  if (!picks.length) {
    lines.push("Nothing passed every rule today. That happens; the rules are strict on purpose.");
  }
  for (const pick of picks) {
    const {issue, repo, language, maintainer, discord, merges} = pick;
    lines.push(`### ${pick.famous ? "⭐ " : ""}${repo}#${issue.number} — ${issue.title}`);
    lines.push(`${issue.url}`);
    lines.push(`- Opened ${issue.createdAt.slice(0, 10)}, ${issue.comments.totalCount} comment(s), ${issue.repository.stargazerCount} stars, ${language}`);
    lines.push(`- Maintainer involved: **${maintainer.who}** ${maintainer.how}`);
    if (pick.rules.found.length) {
      lines.push(`- 📋 Project rules (read ${pick.rules.filesRead.join(", ")}):`);
      for (const rule of pick.rules.found) lines.push(`  - ${rule.meaning} — ${rule.file}: "${rule.quote}"`);
    }
    if (pick.decision) {
      lines.push(`- ⚖️ **Needs a maintainer decision first** — ${pick.decision}. Ask on the issue; don't open a PR until they say what they want.`);
    }
    lines.push(`- Discord: ${discord.url} — "${discord.name}", ${discord.members} members, ${discord.online} online`);
    lines.push(merges.length ? `- Merges outsiders: ${merges.map(pr => `#${pr.number} (${pr.mergedAt?.slice(0, 10)})`).join(", ")}` : "- Merges outsiders: could not check with this token - verify by hand");
    lines.push("");
  }
  if (rejected.length) {
    lines.push("<details><summary>Ruled out</summary>", "");
    lines.push(...rejected.slice(0, 25).map(r => `- ${r}`));
    lines.push("", "</details>");
  }

  const body = lines.join("\n");
  console.log(body);

  // Machine-readable copy for the worker queue in pr-batcher (work.js pull).
  const fs = await import("node:fs");
  const shortlist = picks.map(({issue, repo, famous, decision, rules}) => ({
    url: issue.url,
    repo,
    number: issue.number,
    title: issue.title,
    opened: issue.createdAt.slice(0, 10),
    famous,
    decision,
    rules: rules.found,
    rulesRead: rules.filesRead,
    found: today,
  }));
  fs.writeFileSync("shortlist.json", JSON.stringify(shortlist, null, 2) + "\n");

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `body<<FINDER_EOF\n${body}\nFINDER_EOF\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${picks.length}\n`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
