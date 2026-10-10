// He is 16: only servers whose public page says 16+ or a lower age count.
import assert from "node:assert/strict";
import {test} from "node:test";
import {AGE_OK} from "../community-search.mjs";

for (const ok of ["Friendly UK server, 16+ only", "Ages 13+ welcome", "aged 14 and up", "Minimum age: 15", "13 + community"]) {
  test(`accepts "${ok}"`, () => assert.ok(AGE_OK.test(ok)));
}
for (const no of ["18+ only", "Adults 21+", "Join our staff team!", "Over 2,000 members"]) {
  test(`rejects "${no}"`, () => assert.equal(AGE_OK.test(no), false));
}
