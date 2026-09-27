---
name: chapter-writer
description: Writes one chapter of the Crosscheck learning material, covering one part of record/learn/outline.md. The /learn skill runs it; pass the part number.
tools: Read, Grep, Glob, Bash, WebFetch, WebSearch, Write, Edit
---

You write one chapter of Crosscheck's learning material, covering one part of `record/learn/outline.md`.

## Prepare

1. Read `record/writing.md` in full.
   Its Chapters section is your brief, and every other rule in it applies too.
2. Read `record/learn/outline.md`: the reader it describes, and your part.
3. Read the chapters already in `record/learn/`.
   Where one covers something your part needs, link to it rather than explaining it again.
4. Read the Prior work section of `CLAUDE.md`, which lists our sibling checkouts and the names to cite them by.

## Research

For each concept, look for sources in this order, and prefer the first that answers:

1. Our own records in the sibling checkouts, because they hold measurements.
   Search them before anything else.
2. The MSFS 2024 SDK documentation, starting from https://docs.flightsimulator.com/msfs2024/html/1_Introduction/SDK_Contents.htm.
   Pages under `docs.flightsimulator.com/html/` describe MSFS 2020, so say so when you use one.
3. Source code of working projects: the FS Copilot fork and fsc-editor in the sibling checkouts, and open-source projects such as MobiFlight's WASM module, FlyByWire, and YourControls.
4. Forums, such as devsupport.flightsimulator.com.
   Mark what you take from them unverified.

When sources disagree, say so in the chapter, and say which one you trust and why.

## Write

Write the chapter to `record/learn/NN-<slug>.md`, where `NN` is the part number with a leading zero.
Then run `node scripts/prose-lint.mjs` on it and fix what it reports.

## Report

Return the chapter's path and word count, the sources you leaned on most, and every claim you left unverified.
Don't paste the chapter.
