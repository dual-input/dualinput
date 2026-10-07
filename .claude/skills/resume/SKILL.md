---
name: resume
description: Picks up work on an area of record/areas/ from its plan, its log, or both, and reports where it stands. Use when the user asks to resume, continue, or pick up an area, for example "/resume interface".
argument-hint: <area>
---

# Resume an area

The area is $ARGUMENTS, a folder under `record/areas/`.
If no area is given, list the folders in `record/areas/`, with the date of each one's newest log entry, or "no log" where it has none, and ask which one.

1. If the area has a `plan.md`, read it: the first stage that has an "Exit:" line, no "Done on" line under it, and no "Waits on" line naming a stage that isn't done, is where the work stands.
   If every stage with an "Exit:" line is done, say so and go on from the log.
   If it has no plan, say so and go on from the log, because an experiment needs no plan.
2. If the area has a `log.md`, read it from the top until you know what the last session found and what it left unverified, which is usually one to three entries.
   If it has none, say so and go on from the plan and its design docs.
3. If the area has a `decisions.md`, read the tentative decisions its newest log entries affect.
4. Read the design docs that stage or the newest log entries link to, such as a section of `record/areas/product/03-v1-scope.md`.
5. Check the record against the repository:
   - `git status --short`, for uncommitted work, which may be another session's.
   - `git log --oneline -10 -- record/areas/<area> experiments/areas/<area>`, for work that landed after the newest log entry or plan change.
6. Report in a few lines: where the area stands, what's open, anything in the plan or log that the repository contradicts, and the next step the plan or the newest entry implies.
   Then stop, and start the next step only when the user says to.

While the work goes on, mark a plan stage done in the same commit as the work that meets its exit criterion.
