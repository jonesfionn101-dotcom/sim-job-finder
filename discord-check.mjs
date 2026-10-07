#!/usr/bin/env node
/**
 * Checks a Discord invite link from the outside:
 *
 *   node discord-check.mjs discord.gg/aQhvCp5aKG [more links...]
 *
 * Uses only Discord's public invite lookup - no login, nothing joined. That
 * lookup shows the server's name, size, age and description, but not its
 * channels or roles, so "open roles" can only be spotted when the server
 * mentions them in its description. Anything else needs a look inside.
 */

const HIRING = /\b(hiring|recruit\w*|staff (applications?|apps|positions?|roles?)|apply (for|to be)|applications? (are )?open|looking for (staff|mods?|moderators|hr|admins?|helpers?)|join (our|the) (staff|team))\b/i;
const NOT_ENGLISH = /[^\x00-ɏ\s\p{Emoji}\p{P}\p{S}]/u;

const codeOf = link => link.trim().replace(/^https?:\/\//, "").replace(/^(www\.)?(discord\.gg|discord(app)?\.com\/invite)\//, "").split(/[/?#]/)[0];
const createdAt = id => new Date(Number(BigInt(id) >> 22n) + 1420070400000);

async function check(link) {
  const code = codeOf(link);
  const response = await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true&with_expiration=true`);
  const invite = await response.json();
  if (!invite.guild) return `${link}\n  ✗ invite not valid (expired, or the server is gone)`;

  const {guild} = invite;
  const description = guild.description || "";
  const hiring = description.match(HIRING);
  const lines = [
    `${guild.name}  (discord.gg/${code})`,
    `  members: ${invite.approximate_member_count}, online now: ${invite.approximate_presence_count}`,
    `  made: ${createdAt(guild.id).toISOString().slice(0, 10)}`,
    `  invite expires: ${invite.expires_at ? invite.expires_at.slice(0, 10) : "never"}`,
    `  description: ${description || "(none)"}`,
    `  English: ${NOT_ENGLISH.test(guild.name + description) ? "maybe not - check" : "looks English"}`,
    hiring
      ? `  open roles: ✓ description mentions "${hiring[0]}"`
      : "  open roles: not mentioned outside - look for #applications or a ticket panel once inside",
  ];
  return lines.join("\n");
}

const links = process.argv.slice(2);
if (!links.length) {
  console.log("usage: node discord-check.mjs discord.gg/<code> [more links...]");
  process.exit(1);
}
for (const link of links) console.log(await check(link), "\n");
