---
name: learn
description: Writes one chapter of the Crosscheck learning material, then fact-checks and reviews it, one agent at a time. Use when the user asks for a learning chapter or the next part of the outline, for example "/learn 3".
argument-hint: <part number>
---

# Write a learning chapter

The part to write is $ARGUMENTS.
If no part is given, take the lowest-numbered part in `record/learn/outline.md` whose heading doesn't link to a chapter yet, and tell the user which one you picked.

Run each step's agent alone, and wait for its report before starting the next.
If an agent type isn't available, which happens when its definition was added after the session started, run a general-purpose agent told to read `.claude/agents/<name>.md` and act as that agent.

1. **Write.** Run the `chapter-writer` agent with the part number.
2. **Check the facts.** Run the `fact-checker` agent on the new chapter, and fix every failure it reports.
   Mark each claim it couldn't check as unverified, and add it to the chapter's closing list with what would settle it.
   If a fix turns on a design choice for Crosscheck, ask the user rather than choosing.
3. **Review the prose.** Run the `doc-reviewer` agent on the chapter.
   Tell it the reader is the one `record/learn/outline.md` describes, that a chapter's shape is in `record/learn/chapter-guide.md`, and that the fact-checker has already checked the claims.
   When you apply a rewrite, keep each claim's meaning and its reference.
   If a rewrite changes a claim anyway, run the fact-checker again on that section.
   Run the reviewer again after fixing, up to two more times.
   If the third report still says the chapter isn't ready, stop, and give the user its findings instead of going on.
4. **Link it.** Turn the part's heading in `record/learn/outline.md` into a link to the chapter, or to the first chapter if the part was split.
5. **Commit** the chapter and the outline together.
6. **Hand it over.** Give the user the chapter's path, its word count, and the claims still unverified.
   Don't summarize the chapter, because the user is about to read it.

Stop there, and start the next part only when the user asks.
