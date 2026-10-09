// One test per wanted role: the community search must spot a real open job
// for that role, and must NOT list servers that only mention the word.
// Add a case here every time a new role is added to the search.
import assert from "node:assert/strict";
import {test} from "node:test";

import {openJob} from "../community-search.mjs";

const OPEN = {
  "staff": "UK FS22 server. Staff applications are open, apply in #apply!",
  "moderator": "Friendly ETS2 community, we are looking for moderators.",
  "support": "Gaming hub. Looking for support staff to answer tickets.",
  "HR": "Truck VTC: looking for HR staff to help with recruitment.",
  "admin": "Minecraft UK SMP - admins wanted, open a ticket.",
  "developer": "FiveM UK server looking for developers to join the team.",
  "bot developer": "Farming community, bot developer wanted for our Discord.",
  "website": "Sim racing league looking for web developers.",
  "media": "Truck sim radio. Media team applications open!",
  "events": "Convoy community looking for event staff.",
  "helper": "Helpers needed for our new FS22 server!",
  "recruitment": "VTC recruitment team applications are open.",
  "application reviewer": "Looking for application reviewers to help our staff.",
  "ticket route: apply": "UK ETS2 community. Want to join the team? Open a ticket to apply!",
  "ticket route: get a job": "FS22 server - open a ticket to get a job with our staff.",
  "ticket route: tickets for roles": "Gaming hub, tickets for staff roles in #support.",
};

const NOT_OPEN = {
  "friendly staff only": "Official Discord with friendly staff and weekly events.",
  "no job at all": "Official Farming Simulator server by GIANTS Software",
  "hiring but no role he wants": "Pokemon restock alerts, we are hiring!",
  "ticket for help only": "Need help? Open a ticket in #support and our team will reply.",
};

for (const [role, description] of Object.entries(OPEN)) {
  test(`spots an open ${role} job`, () => {
    assert.ok(openJob(description), `missed: "${description}"`);
  });
}

for (const [why, description] of Object.entries(NOT_OPEN)) {
  test(`does not list: ${why}`, () => {
    assert.equal(openJob(description), null, `wrongly listed: "${description}"`);
  });
}
