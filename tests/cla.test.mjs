import {test} from "node:test";
import assert from "node:assert";
import {humanOnlyRule} from "../auto-rules.mjs";

test("projects that need a signed CLA are skipped", () => {
  assert.ok(humanOnlyRule("Before we can merge your first PR, you must sign our Individual CLA."));
  assert.ok(humanOnlyRule("PRs without a signed Contributor License Agreement"));
  assert.ok(humanOnlyRule("This project requires a CLA."));
});
test("ordinary contributing text is not caught", () => {
  assert.equal(humanOnlyRule("Fork the repo, make a branch and open a pull request. Classes are welcome."), null);
});
