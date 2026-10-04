---
name: learn
description: Writes one chapter of the Crosscheck learning material, and fact-checks its full-depth sections. Use when the user asks for a learning chapter or the next part of a course's outline, for example "/learn foundations 3".
argument-hint: <course> [part number]
---

# Write a learning chapter

The course and part to write are $ARGUMENTS.
A course is a folder in `record/learn/` with its own `outline.md`.
If no course is given and `record/learn/` has only one, use it; if it has more, ask the user which, listing them.
If no part is given, take the lowest-numbered part in the course's `outline.md` whose heading doesn't link to a chapter yet, and tell the user which one you picked.

Run each step's agent alone, and wait for its report before starting the next.

1. **Write.** Run the `chapter-writer` agent with the course and the part number.
2. **Check the facts at full depth.** If any of the part is at full depth, run the `fact-checker` agent on those sections, and fix every failure it reports.
   Mark each claim it couldn't check as unverified, and add it to the chapter's closing list with what would settle it.
   If a fix turns on a design choice for Crosscheck, ask the user rather than choosing.
   Brief and refresher sections skip this step, because a fact check took longer than writing them.
3. **Link it.** Turn the part's heading in the course's `outline.md` into a link to the chapter, or to the first chapter if the part was split.
4. **Commit** the chapter and the outline together.
5. **Hand it over.** Give the user the chapter's path, its word count, and the claims still unverified.
   Don't summarize the chapter, because the user is about to read it.

The user's reading is the chapter's review.
When they find prose that doesn't work, fix the chapter, and if the problem could recur, add a rule to `.claude/rules/chapter-guide.md`.

Stop there, and start the next part only when the user asks.
