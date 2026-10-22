---
name: stage-map
description: Makes a build stage's map, the private page the user reads before the stage's diff, at step 7 of "Working a stage" in record/areas/build/plan.md. Use when a stage's exit has happened, or when the user asks for a stage's map, for example "/stage-map 4".
argument-hint: <stage number>
---

# Make a stage's map

A stage's map lets the user learn what the stage's code does in one quick read, then go to the diff for the technical side.
Read the stage's lines in [the plan](../../../record/areas/build/plan.md), the design sections they link, and the stage's code: its uncommitted diff, or its commit once it's done.

Three things are the same in every map:

- **The look:** copy the style block of `template.html`, stage 3's map, beside this file.
- **The writing:** [writing.md](../../rules/writing.md), as for anything written for people.
  Name each thing by the record's and the code's own name, such as "the bench's socket", never a nickname such as "the back door".
  Keep the text short, since the diagrams carry the detail, and write no lines on how to read the page.
- **What, Why, and How for each part,** each label on its own line above its block:
  - **What:** what the part is and does, in at most two short sentences.
  - **Why:** the problem it solves, in at most two short sentences.
    Say what would go wrong without it, not what it gives.
  - **How:** how it works, drawn so the reader sees the mechanism, and tied to the files and lines that do it.

Everything else is yours to choose for this stage: what the page opens with, how it shows the parts connecting, which diagram suits each part, and what else the reader needs, such as measured numbers.
Choose the clearest way to show this stage's code, which may look nothing like the template, since the template is one stage's answer.
A diagram draws the mechanism, not boxes in a row, and a chart draws the stage's measured data with a script, never made-up values.

Before publishing:

- check every file and line against the code
- check that the page's tags balance
- strip the page to its text and run `tools/prose-lint.mjs` on it

Write the page in the session's scratchpad, and publish it with the Artifact tool, titled "Dual Input stage N", with the icon "map".
After a change, publish to the same link.
Show the user the link beside the diff, and add it to the stage-maps note in memory.
