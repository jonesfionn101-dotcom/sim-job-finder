/**
 * Staff job posts on a VTC's TruckersMP news page that an outsider can apply for.
 *
 * Rules (9 Oct 2026): only posts from the last 30 days (older ones go stale and
 * may since have become internal), each post read in full, and roles kept for
 * the VTC's own staff or drivers are dropped.
 */

const API = "https://api.truckersmp.com/v2/vtc";
const POST_DAYS = 30;

const JOB_POST = /\b(hiring|recruit\w*|vacanc\w*|positions? (open|available)|applications? (are )?open|looking for|join (our|the) (staff|team)|wanted|needed|open (a|an) ticket to (apply|join)|apply (via|through|by|in) (a )?tickets?)\b/i;
// Staff roles only: an ordinary driver opening isn't a behind-the-scenes job.
export const STAFF_ROLE = /\b(staff|moderators?|admins?|hr|human resources|recruit(ers|ment)|event (team|staff|managers?)|media( team)?|developers?|designers?|managers?|support|dispatch\w*|convoy (control|team))\b/i;
export const INTERNAL = /\b(internal(ly)?|existing (staff|members|drivers)|current (staff|members|drivers)|(staff|drivers|members) only|only (open )?(to|for) (our )?(staff|drivers|members)|must (already )?be (a |an )?(driver|member|employee) (of|at|with))\b/i;
export const EXTERNAL = /\b(external|anyone|everyone|non[- ]?members?|outside (applicants|people)|open to all|not essential|don'?t (need|have) to be (a )?(driver|member))\b/i;

async function api(path) {
  let response;
  for (let attempt = 1; attempt <= 4; attempt++) {
    response = await fetch(`${API}/${path}`, {signal: AbortSignal.timeout(20000), headers: {"user-agent": "curl/8.0", accept: "application/json"}}).catch(() => null);
    if (response?.status !== 429) break;
    await new Promise(r => setTimeout(r, 20000 * attempt));
  }
  if (!response?.ok) return null;
  const body = await response.json().catch(() => null);
  return body && !body.error ? body.response : null;
}

/** [{title, role, at, url, outsiders}] newest first; outsiders = the post says outsiders may apply. */
export async function outsiderJobPosts(vtcId, news, internalOut = []) {
  news ??= (await api(`${vtcId}/news`))?.news || [];
  const now = Date.now();
  const posts = [];
  for (const item of news) {
    const at = Date.parse(`${item.published_at}Z`);
    const headline = `${item.title} ${item.content_summary || ""}`;
    if (!at || now - at > POST_DAYS * 86400000 || !JOB_POST.test(headline)) continue;
    const full = `${item.title} ${(await api(`${vtcId}/news/${item.id}`))?.content || item.content_summary || ""}`;
    const role = full.match(STAFF_ROLE);
    if (!role) continue;
    // Internal-only roles go on the NO list instead of vanishing.
    if (INTERNAL.test(full)) { internalOut.push({title: item.title, role: role[0], at, url: `https://truckersmp.com/vtc/${vtcId}/news/${item.id}`}); continue; }
    posts.push({title: item.title, role: role[0], at, url: `https://truckersmp.com/vtc/${vtcId}/news/${item.id}`, outsiders: EXTERNAL.test(full)});
  }
  return posts.sort((a, b) => b.at - a.at);
}

export function jobPostLine(post) {
  const date = new Date(post.at).toISOString().slice(0, 10);
  const days = Math.round((Date.now() - post.at) / 86400000);
  return `📢 Staff job: "${post.title}" (${post.role}) ${post.outsiders ? "✅ says outsiders can apply" : "❓ doesn't say if outsiders can apply, ask first"}, posted ${date} (${days} days ago): ${post.url}`;
}
