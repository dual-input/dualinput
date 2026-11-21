// A scenario checks behavior on every PC, and its timing budgets only where a timing means
// something: on our development machine, where each stage measures its budgets. A GitHub
// runner shares its machine with other jobs' load, which moves a timing from run to run, so CI's
// bench jobs set DUALINPUT_BENCH_BUDGETS to `report`, and there a missed budget is printed
// and passes (record/areas/build/02-testing.md, "What keeps CI green").
//
// A timer the design sets, such as a link lost no sooner than 5s into a cut, is behavior, and
// stays an assertion.

import assert from "node:assert/strict"

/** Fails the scenario when `met` is false, unless the bench only reports budgets here. */
export function budget(met: boolean, missed: string): void {
  if (met) return
  if (process.env.DUALINPUT_BENCH_BUDGETS === "report") console.log(`budget missed, reported only: ${missed}`)
  else assert.fail(missed)
}
