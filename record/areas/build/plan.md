# Build: plan

This plan builds Crosscheck's v1, as [03-v1-scope](../product/03-v1-scope.md) has it, in numbered stages, each ending with an exit you can watch happen.
It's the one place v1's build status lives, for [step 9](../product/plan.md#9-build-test-and-release-v1) of the product plan, whose exit is its last stage's exit.
[Node 8](../architecture/plan.md#8-the-build-order) of the architecture plan designs the stages and their order.

## How a stage reads

Each stage is a `##` section of this plan, placed in the order the stages are built, and gives these lines:

- `Builds:` the units of [the code map](../architecture/02-code-map.md#the-units) it builds, or the parts of them it names, each linked to the section that designs it.
- `Designs first:` what the record left to this stage to design, when it left anything.
- `Needs:` the stages whose output it uses, so two stages that don't need each other can be built at the same time.
- `Tests:` the cases it turns into tests, linked to the sections of the design docs that list them, and each budget it measures.
- `Exit:` what you watch happen when the stage is done.

A stage is done when it has a `Done on` line under its `Exit:` line, and open until then.
The build stands at the first open stage whose `Needs:` line names only done stages, and any other open stage whose needs are done can be built beside it.

## Working a stage

1. Before writing anything for the stage, read each section its `Builds:` and `Tests:` lines link, with the notes at the top of each design doc they're in, since a doc's notes change the text below them ([step 8](../product/plan.md#8-v1-build-plan)).
   You'll know what the stage builds and what proves it.
2. If the stage has a `Designs first:` line, propose that design to the user, and once they agree, write it in the design doc it belongs to.
   You'll see the design in its doc before any of the stage's code.
3. Write the stage's code, and turn its cases into tests, as [left to each stage](02-testing.md#left-to-each-stage) says.
   You'll see CI run its unit tests and bench tests green on its pull request.
4. Ask the user whether to run the `code-reviewer` agent, as [CLAUDE.md](../../../CLAUDE.md#working-rules) says.
   You'll have their answer, and if they want a review, its findings fixed or answered.
5. If the stage's system has cases in the sim, run them, and measure the stage's budgets in the sim, in one session in the sim ([in the sim](02-testing.md#in-the-sim)).
   You'll have each case's report and each measurement.
6. Measure the stage's budgets on the bench, on our development machine, and write each result, from the bench and from the sim, with how it was taken, in the log of the area it belongs to.
   A result that misses its budget goes back to the design that set it, as [left to each stage](02-testing.md#left-to-each-stage) says.
   You'll see a log entry for each budget.
7. Once the stage's exit has happened, add `Done on <YYYY-MM-DD>.` under its `Exit:` line.
   You'll see the `Done on` line, and the next open stage is where the build stands.

## When building shows a design is wrong

1. Propose the change to the user before writing it.
2. Once they agree, write what the stage found in the log of the area the design belongs to.
3. Add a note at the top of the design doc that names the log entry, as [writing.md](../../../.claude/rules/writing.md#design-plan-and-log) has a design doc amended.
4. If the change reverses a numbered decision, write the decision that reverses it, as [writing.md](../../../.claude/rules/writing.md#decisions) says.
