import assert from "node:assert/strict";
import test from "node:test";
import { analyzeClinicalAccount } from "../lib/rules/chilean-account.ts";
import { OBSERVED_CHILEAN_ACCOUNT_CORPUS } from "../lib/rules/observed-corpus.ts";
import { generateSyntheticAccountSuite } from "../lib/synthetic/synthetic-accounts.ts";

test("la batería sintética cubre el corpus completo y es reproducible", () => {
  const first = generateSyntheticAccountSuite({
    corpus: OBSERVED_CHILEAN_ACCOUNT_CORPUS,
    count: 12,
    seed: "suite-de-prueba",
  });
  const second = generateSyntheticAccountSuite({
    corpus: OBSERVED_CHILEAN_ACCOUNT_CORPUS,
    count: 12,
    seed: "suite-de-prueba",
  });

  assert.equal(first.sourcePatternCount, 664);
  assert.equal(first.sourceObservationCount, 1468);
  assert.equal(first.generatedPatternCount, 664);
  assert.equal(first.generatedObservationCount, 1468);
  assert.equal(first.accounts.length, 12);
  assert.ok(new Set(first.accounts.map((account) => account.profileId)).size >= 8);
  assert.deepEqual(first.accounts, second.accounts);
  assert.ok(first.accounts.every((account) => account.lines.length > 1));
  assert.ok(first.accounts.every((account) => account.lines.every((line) => line.confidence === 0.98 || line.confidence === 1)));
  assert.equal(first.fragmentationScenarioCount, 12);
  assert.equal(first.generatedLineCount, first.accounts.reduce((sum, account) => sum + account.lines.length, 0));
  assert.ok(first.accounts.every((account) => {
    const analysis = analyzeClinicalAccount(account.lines, undefined, OBSERVED_CHILEAN_ACCOUNT_CORPUS);
    return analysis.accountSignals.some((signal) => signal.type === "possible_selective_itemization");
  }));
});
