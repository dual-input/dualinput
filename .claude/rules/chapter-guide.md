---
paths:
  - "record/learn/**"
---

# Chapter guide

A chapter teaches one part of a course's outline to the reader that outline describes.
A course is a folder in `record/learn/` with its own outline, such as [foundations](../../record/learn/foundations/outline.md), and its chapters go in that folder.
It wastes none of the reader's time, and it skips none of the steps they need to understand.
When those pull against each other, understanding wins: a skipped step saves the writer one sentence and costs the reader minutes.
Everything in [writing.md](writing.md) applies too.

1. After the title, list the chapter's sections as links, so a reader can skip what they know.
   This list stands in for the opening answer, and each section leads with its own.
2. Give each outline bullet its own section, in outline order.
   A full section has four parts:
   1. The answer, in one or two sentences, so a reader who already knows it can move on.
   2. The mechanism, shown with one real example, taken from our records where one exists, with the one sentence of context the reader needs to follow it.
   3. What it changes for Crosscheck, in one to three sentences: a constraint on the design or a question it opens, never a choice between designs.
   4. Its traps.
3. Pitch each section at the depth the outline gives it, whether for the whole part or for a group of bullets.
   A part with no depth is full.
   - Brief: the answer, and what it changes for Crosscheck.
   - Refresher: all four parts, with the mechanism stated as facts rather than built up.
   - Full: all four parts, building the mechanism from what the reader already knows, with the opening answer in terms the reader already has.
4. When a section needs something another part teaches, give the one sentence it needs, and link to that part's chapter, or name the part if its chapter isn't written yet.
5. Leave out what the outline says the reader already knows.
6. Use a table or diagram wherever it replaces a paragraph, such as which namespaces each API can read.
7. Mark each claim that needs evidence with a numbered reference to the source list, like `[3]`, and mark an unverified claim `(unverified)`.
8. End with the sources as a numbered list, each with its [Evidence](writing.md#evidence) marker, then the claims nobody has verified, each with what would settle it.
9. A part that runs past 3,000 words splits into chapters of whole sections, in outline order, named `NN-MM-<slug>.md`.

A course's outline is its plan.
A part's heading links to its chapter, or to the first of its chapters, once it's written, and those links are the only record of which parts are done.
