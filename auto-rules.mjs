/**
 * Rules for jobs that are picked up, done and sent fully automatically
 * (the rule from 7 Oct 2026: "pick up the job, do the job, send the job").
 *
 * Shared by finder.mjs and app-search.mjs so both searches agree:
 *   1. the project must allow an AI to do the whole thing - no "a human must
 *      test it / fill in the template / write the comments" rule;
 *   2. the fix must be provable on the local PC - a JS test runner that works there,
 *      a Node version it has, and nothing that needs hardware the local PC lacks.
 */

// Node on the local PC. Raise this when it is upgraded.
export const LOCAL_NODE = [24, 12, 0];

const HUMAN_ONLY = [
  /human who (tested|tests)/,
  /never fill in the (pr|pull request) template/,
  /(must|has to|needs to) be (tested|verified|reviewed) by a human/,
  /a human (must|has to|needs to) (test|verify|fill|write)/,
  /(comments?|replies|descriptions?|pr text|chat) (must|should) be (written by a )?human/,
  /do not (paste|post) (ai|llm)[- ]generated (comments|replies|descriptions)/,
  /no (fully )?(ai|llm)[- ](generated|authored) (pull requests|prs|contributions)/,
];

/** Quote of the rule that needs a person in the loop, or null. */
export function humanOnlyRule(text) {
  const lower = text.toLowerCase().replace(/\s+/g, " ");
  const hit = HUMAN_ONLY.find(re => re.test(lower));
  return hit ? lower.match(hit)[0] : null;
}

// Things that can't be tried on a Windows desktop with no touchscreen.
const UNTESTABLE = /\b(touch(screen)?|gestures?|swipe|pinch|haptic|ios|iphone|ipad|android|safari|macos|mac os|linux[- ]only|wayland|bluetooth|nfc|printer|webcam|gpu|vr|steam deck)\b/i;

/** Why an issue can't be proven here, or null. */
export function untestableIssue(title, body = "") {
  const hit = `${title}\n${body}`.match(UNTESTABLE);
  return hit ? `needs "${hit[0]}", which can't be tested on the local PC` : null;
}

function nodeOk(range) {
  const need = (range.match(/>=?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/) || []).slice(1).map(n => Number(n || 0));
  if (!need.length) return true;
  for (let part = 0; part < 3; part++) {
    if (LOCAL_NODE[part] > need[part]) return true;
    if (LOCAL_NODE[part] < need[part]) return false;
  }
  return true;
}

/** Why the project can't be built and tested on the local PC, or null. */
export function untestableProject(packageJsonText) {
  if (!packageJsonText) return "no package.json at the root";
  let pkg;
  try { pkg = JSON.parse(packageJsonText); } catch { return "package.json could not be read"; }
  const node = pkg.engines?.node;
  if (node && !nodeOk(node)) return `needs Node ${node}, the local PC has ${LOCAL_NODE.join(".")}`;
  const scripts = Object.values(pkg.scripts || {}).join(" ");
  const deps = Object.keys({...pkg.devDependencies, ...pkg.dependencies}).join(" ");
  if (!/vitest|jest|mocha|node --test|ava|playwright test|lage test|turbo (run )?test|nx (run-many )?.*test/.test(`${scripts} ${deps}`)) {
    return "no JavaScript test runner to prove the fix";
  }
  return null;
}
