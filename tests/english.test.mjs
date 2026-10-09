import assert from "node:assert/strict";
import {test} from "node:test";
import {english} from "../community-search.mjs";

test("English descriptions pass", () => assert.ok(english("Friendly UK FS22 community, we are looking for staff")));
test("German is skipped", () => assert.equal(english("Wir sind eine deutsche Community für Farming Simulator"), false));
test("Spanish is skipped", () => assert.equal(english("Comunidad española de ETS2, buscamos moderadores"), false));
