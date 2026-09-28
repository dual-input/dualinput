# Writing

```text
Purpose:  How everything an agent writes for this repository is written.
Covers:   The record, code comments, commit messages, and instructions for agents.
Loaded:   Into every main session, through the import in CLAUDE.md.
```

## The test

Can it be read once, at speed, and understood?
A sentence that needs a second pass has failed, however accurate it is.
A reader who has to work stops reading, and a reader who stops reading acts on half a document.

When a rule below disagrees with this test, the test wins.

## Kinds of document

Before the first sentence, know which kind you're writing.
The kind decides who reads it and what shape it takes.

| Kind               | Lives in                                                                 | The reader wants to                                                                    |
| ------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Design             | `record/areas/<area>/NN-<slug>.md`                                       | know what a part is and why it's that way                                              |
| Plan               | `record/areas/<area>/plan.md`                                            | know what's being built and where it stands                                            |
| Log                | `record/areas/<area>/log.md`                                             | know what was found                                                                    |
| Decision           | `record/decisions/NNN-<slug>.md`                                         | know why one option won                                                                |
| Reference          | beside what it describes                                                 | look one thing up                                                                      |
| Outline            | `record/learn/<course>/outline.md`                                       | know what a course covers, in what order and depth, and which parts have a chapter     |
| Chapter            | `record/learn/<course>/NN-<slug>.md`                                     | understand one part of a course well enough to use it                                  |
| Agent instructions | `CLAUDE.md`, `.claude/`, and files `CLAUDE.md` imports, such as this one | act correctly without asking                                                           |

A document that's two kinds at once serves neither reader.
A design doc that also tracks progress goes stale in its progress half and takes the design half down with it.

### Design, plan, and log

These three have different lifetimes, and keeping them apart is what keeps each one true.

**A design doc** says what a part is, and it's stable.
When a result overturns part of it, add a blockquote at the top naming the log entry, and leave the text below as it was.
A design doc that quietly changed is worse than one that's openly out of date.
It opens with three lines, so it can be judged before it's read:

```text
Purpose:     What this part is for, in one line.
Depends on:  The docs it assumes, or "nothing".
Decides:     The questions it settles.
```

**A plan** says what's being built, in stages, each with an exit criterion you can watch happen.
It's the only place project status lives.
An index or design doc that says "not built yet" is a second copy of the status, and it'll be the wrong one.

**A log** says what was found, newest entry first, one dated heading per entry: `## <YYYY-MM-DD>: <what was found>`.
Write the entry when the result arrives, not at the end of the day.
Each entry says what we asked, what we expected, what we found, what changed because of it, and which docs it affects.
A negative result gets the same care as a positive one, because what was tried and abandoned is the part git history can't tell anyone.
Raw output goes in a `results/` folder beside the log and gets committed: the log is the reading, and the results are the evidence.
An experiment's raw output stays beside its probe, in `experiments/areas/<area>/results/`, and the area's log gets an entry only for a finding worth keeping.

### Decisions

One file per decision, numbered, written when the decision is made.
It gives the context that forced a choice, each option with what it would cost, the decision, and what it commits us to.
Once made, a decision isn't edited, except to add a blockquote at the top naming the decision that reverses it.
The reversing decision says what it reverses and links back.

### Reference

Tables and lists, with no argument.
The reasoning lives in a design doc, and the reference links to it.

### Outline and chapters

A course is one body of learning: a folder in `record/learn/` with its own outline and the chapters written from it, such as `foundations`.
A concept we need later, out of the work, gets a new course rather than new parts at the end of an existing outline, because each outline is a sequence meant to be finished.

Outlines and chapters follow [the chapter guide](learn/chapter-guide.md).
It lives apart from this file because only a chapter writer needs it.

## Structure

**Lead with the answer.**
The first paragraph says what the document establishes.
Background, history, and caveats come after the reader knows what they're for.
So no heading is called Overview, Introduction, Summary, or Conclusion: the first paragraph is the overview, and a closing summary repeats the document.

**One document, one job.**
Past about 3,000 words, look for the second job and split it out.

**Write a value down once.**
Everywhere else links to it.
A value written twice is two values that haven't disagreed yet.
This holds for numbers, rules, status, and vocabulary alike.

**Describe the current state, not the edit.**
Don't write "now", "updated to", or "no longer", except in a log, an amendment blockquote, or a decision that reverses another.
Git holds the change, and a reader arriving next year doesn't care what the text used to say.

**Headings name the content.**
Write "Known limits", not "Limits, stated rather than discovered".
Use sentence case, and never a question.

**Procedures are numbered steps.**
Each step is one action and says what you'll see when it worked.
The condition comes before the action, "If the sim is running, close it", so the reader doesn't act before reaching it.

**Delete an empty template section**, unless the emptiness is the information.
"No known traps" is worth a line.

**Links within the repository are relative, and every link's text names the target.**
Write `[09-environment](09-environment.md)`, never "here" or "this doc".

**Files are kebab-case.**
Use a numbered prefix (`01-`) only where order matters, and write dates as `YYYY-MM-DD`.

## Sentences

**One sentence per line** in the source, list items included.
A diff then shows the sentence that changed rather than the paragraph that reflowed, and a sentence that runs off the edge of the editor is visibly too long.
A table cell and a front-matter field are the exceptions, because neither can span lines.

**Show the mechanism, not a property of it.**
Naming a property makes the reader rebuild the concrete case to check the claim.
Showing the case carries the conclusion and costs fewer words.

```text
✗  Echo suppression stops changes from bouncing between the two machines.
✓  We write the other pilot's flap lever, the sim reports that the flaps changed,
   and without a guard we send that change straight back to them.
```

**Be concrete.**
Give a name, a number, a version, or a path.
"Some aircraft" is a claim nobody can check, and naming the aircraft makes it one they can.

**Never invent a specific.**
Every name, number, version, API, and path is real, or is labeled hypothetical where it appears.
The push to be concrete is exactly what makes a plausible fabrication tempting, and a made-up variable name in the record costs a sim session to disprove.

**Main clause first.**
A sentence that opens with three conditions makes the reader hold all three before learning what they're conditions on.
Procedures and agent instructions are the exception: there the condition comes first.

**Name who does it.**
Write "SimConnect drops the event", not "the event is dropped".
The passive hides the fact a debugging reader needs most: which component to blame.

**Say it once.**
A restatement three paragraphs later, dressed to feel like it adds something, is the same sentence twice.
Before calling a paragraph done, ask what the reader loses if it goes.
If the answer is nothing, it goes.

**Cut the trailing clause that restates the sentence.**
The pattern is an em dash, then a clause that sounds like an explanation and repeats the sentence in a more pleased-with-itself register.

```text
✗  The receiver's own hit-testing decides what got pressed — which is what a second
   pilot reaching for the same button would do.
```

"Which is what X would do", where X does no such thing, is the commonest form.

**No rhetoric.**
Don't argue against a doubt nobody raised: "not a matter of trying harder", "not just a sync tool".
Don't ask rhetorical questions.
Don't build suspense: "The catch?" and "The result: nothing" hold back the fact the reader came for.

**One word for one thing.**
Define a term at its first use in each document, then use exactly that term.
Switching between "peer", "the other side", and "the remote" for variety makes the reader wonder whether they're three things.
Expand an acronym at its first use in each document, unless every reader of this repository already knows it: API, SDK, MSFS, UDP, and aviation ones like AGL and IAS.

**Use modal verbs precisely.**
Must is required, should is recommended, and may is optional.
State expected behavior as fact, "the lever moves", because "the lever should move" can't tell a requirement from a prediction.

**Use an analogy only if it predicts correctly**, and say where it stops holding.

**Tense follows time.**
Use the present for how things work, the past for what we did, and the future for plans and consequences.

## Evidence

Our own records have been wrong: one fsc-editor log entry is headed "The `B:` subscription is a change feed; the entry below was wrong" (fsc-editor, `docs/sim-vars/build/v1-log.md`, 2026-09-04).
A design built on a wrong claim fails in the sim weeks later, far from the sentence that caused it.
So every MSFS-specific claim, and any other claim a reader could ask "says who?" about, says where it came from:

- **Measured:** we ran it.
  Name the sim, the date, and the log entry: `(measured on MSFS 2024, <date>, [log](log.md#<entry>))`.
- **Documented:** a vendor or project says so.
  Link the page.
  Before a design leans on a documented claim, we measure it.
- **Unverified:** an inference, a forum post, or a guess.
  Mark it unverified, and if anything depends on it, say what would settle it.

For a source in another of our repositories, cite the repository, the path, and for a log the entry heading, as text, because a link would break for anyone else: `(measured on MSFS 2024, 2026-08-30, FS Copilot fork, record/pointer-forwarding/docs/09-environment.md)`.

Crosscheck targets MSFS 2024, so a claim is about 2024 unless it says otherwise.
When a source describes MSFS 2020, say so, because 2024 may behave differently.

A claim with no marker is knowledge a working developer accepts without a source, like "UDP doesn't guarantee delivery".

Say what we don't know.
A gap that's stated can be closed, and a gap that's skipped is a trap.
A "TBD" says what's unknown and what would settle it.

Quote exactly.
Copy error messages, log lines, and identifiers verbatim, because the reader will search for them.

Code in a document runs as shown, or is labeled a sketch.
Check function and API names against the SDK or the source before they go in.

## Units, identifiers, and numbers

- Every quantity carries its unit.
  Where aviation leaves the unit ambiguous, it also carries its reference: heading true or magnetic, altitude MSL or AGL, speed IAS, TAS, or GS.
- Sim units are named as the sim names them: `radians`, `Position 16k`, `percent over 100`.
- Sim identifiers go in code format, with their namespace prefix, spelled as the sim spells them: `A:PLANE ALTITUDE`, `K:TOGGLE_LAUNCH_BAR_SWITCH`.
- Measurements, and anything a reader might look up or compare, are digits: 3,000 words, 150 lines, 20ms.
  A count under 10 in running prose can be a word, limits included: two pilots, one em dash.
- Time units close up with no space: 20ms, 2s.
- Printed counts handle the singular: "1 profile", never "1 profiles".
- Dates are absolute, like 2026-09-27.
  A fact about the world that's true only for now, such as how a sim version behaves, says "as of" and a date.
  Project status goes in the plan instead.
- Versions are specific: "MSFS 2024", never "the new sim".

## Voice

**We, not I.**
A committed document outlives the session that wrote it, and "I" leaves the reader guessing whether a person or an agent wrote it, and which one.
"We" is the project.
Admissions stay in the first person: "we haven't tested this over the relay" is someone talking, and "this has not been tested" reads as evasion.

**You, for the reader**, in procedures, chapters, and agent instructions: "run the probe", "you'll see the lever move".

**Plain.**
No enthusiasm, no apology, no emoji, and no exclamation marks.
Contractions are fine wherever you'd say them aloud.

**American English**, with the Oxford comma.
Names keep their own spelling.
The product is Crosscheck, capitalized.

## Words and patterns to cut

Each of these usually marks a sentence written on autopilot.
[prose-lint](../scripts/prose-lint.mjs) reads this table and flags every hit outside code, quotation marks, and URLs, including inflected forms (`robustness`, `leveraged`).
The fix is almost always to delete the word or say the concrete thing it stood in for.
A flagged word doing real work can stay: "actually" correcting a belief the text just stated is fine.

<!-- prose-lint: terms -->

| Cut                                                                                                                                                                                                                                               | Why                                                          | Instead                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `genuinely`, `truly`, `really`, `actually`, `honestly`                                                                                                                                                                                            | Sincerity markers imply the rest is less sincere             | Delete                                                                           |
| `crucial`, `importantly`, `critically`, `vital`                                                                                                                                                                                                   | Asserts importance instead of showing it                     | State the consequence                                                            |
| `essentially`, `basically`, `fundamentally`                                                                                                                                                                                                       | Announces an approximation without saying what it leaves out | Say the exact thing                                                              |
| `simply`, `obviously`, `clearly`, `of course`, `straightforward`                                                                                                                                                                                  | Tells the reader how easy it should feel                     | Delete                                                                           |
| `robust`, `seamless`, `powerful`, `elegant`                                                                                                                                                                                                       | Praise that says nothing checkable                           | What it survives or does                                                         |
| `comprehensive`, `holistic`, `nuanced`                                                                                                                                                                                                            | Same                                                         | What it covers                                                                   |
| `leverage`, `utilize`, `utilise`                                                                                                                                                                                                                  | Longer words for "use"                                       | use                                                                              |
| `delve`, `streamline`, `empower`                                                                                                                                                                                                                  | Marketing verbs                                              | The literal verb                                                                 |
| `load-bearing`, `first-class`, `under the hood`, `game-changer`, `game changer`                                                                                                                                                                   | Stock metaphors                                              | What depends on it, or how it works                                              |
| `worth noting`, `note that`, `it's important to`, `it is important to`, `keep in mind`                                                                                                                                                            | Signposts that announce a sentence instead of writing it     | The sentence                                                                     |
| `let's`, `in summary`, `in conclusion`, `to summarize`, `as mentioned`, `as noted above`                                                                                                                                                          | Tour-guide narration                                         | Delete                                                                           |
| `as requested`, `as discussed`, `as you mentioned`, `you asked`                                                                                                                                                                                   | Leftovers from a conversation the reader wasn't in           | Delete                                                                           |
| `don't worry`, `rest assured`, `you might be wondering`, `you may be wondering`                                                                                                                                                                   | Reassurance nobody asked for                                 | Delete                                                                           |
| `in order to`                                                                                                                                                                                                                                     | Two wasted words                                             | to                                                                               |
| `a wide range of`, `a variety of`, `various`                                                                                                                                                                                                      | A quantity nobody counted                                    | Count them or name them                                                          |
| `currently`, `recently`, `at the moment`, `as of now`, `nowadays`                                                                                                                                                                                 | True only on the day it was written                          | A date, or nothing                                                               |
| `may potentially`, `could potentially`, `might potentially`, `could possibly`, `might possibly`                                                                                                                                                   | Stacked hedges                                               | One hedge, or a marker from [Evidence](#evidence)                                |
| `not just`, `not only`, `not merely`                                                                                                                                                                                                              | Argues with a claim nobody made                              | The positive claim                                                               |
| `successfully`                                                                                                                                                                                                                                    | Success is the default, so only failure needs saying         | Delete                                                                           |
| `colour`, `behaviour`, `favour`, `honour`, `neighbour`, `flavour`                                                                                                                                                                                 | British spelling                                             | color, behavior, favor, honor, neighbor, flavor                                  |
| `centre`, `centred`, `metre`, `litre`, `licence`, `defence`, `offence`                                                                                                                                                                            | British spelling                                             | center, meter, liter, license, defense, offense                                  |
| `grey`, `whilst`, `amongst`, `aeroplane`, `manoeuvre`, `tyre`, `aluminium`, `programme`, `analogue`, `catalogue`                                                                                                                                  | British spelling                                             | gray, while, among, airplane, maneuver, tire, aluminum, program, analog, catalog |
| `judgement`, `acknowledgement`, `learnt`, `spelt`                                                                                                                                                                                                 | British spelling                                             | judgment, acknowledgment, learned, spelled                                       |
| `/\b(organi\|recogni\|reali\|normali\|optimi\|initiali\|seriali\|synchroni\|minimi\|maximi\|prioriti\|summari\|customi\|authori\|categori\|finali\|visuali\|standardi\|characteri\|emphasi\|apologi)s(e\|es\|ed\|ing\|er\|ers\|ation\|ations)\b/` | British -ise spelling                                        | -ize: organize, synchronization                                                  |
| `/\b(travel\|cancel\|model\|label\|signal\|fuel\|level\|tunnel\|channel)l(ed\|ing\|er\|ers)\b/`                                                                                                                                                   | British doubled l                                            | traveled, modeling, labeled                                                      |

<!-- prose-lint: end -->

These patterns are beyond the lint, so the `doc-reviewer` agent looks for them:

- **The reflexive three:** three adjectives or clauses where one would do, chosen for rhythm.
- **The punchy restatement:** a paragraph that ends by saying itself again in a shorter sentence.
- **"It's not X, it's Y"** in any wording, when nobody claimed X.
- **Hedging a measurement:** if we measured it, it "does", not "appears to".
- **A missing Oxford comma.**
- **Unparallel lists:** list items, and headings at the same level, share a grammatical form.
  In agent instructions, a trigger heading ("Before writing code that runs in a panel") can sit among noun headings, because the trigger is what gets it followed.

## Formatting

- Use prose for reasoning and lists for parallel items.
  A "because" chain broken into bullets loses its "because".
  Use a list when the items could be reordered without changing the meaning.
- Use a table to compare items on two or more attributes.
  A cell that needs a paragraph means the table is the wrong shape.
- Keep lists to two levels of nesting.
- Fence code blocks and give each a language tag, `text` for anything that isn't code.
  Put one command per block, with no prompt character and no output mixed in.
- Draw a diagram as text in a code block when it fits in 20 lines, and use Mermaid when it doesn't.
  A diagram shows a real mechanism with real names, not boxes labeled "Component A".
- Bold at most one phrase per paragraph: the one a skimmer must catch.
- Use at most one em dash per paragraph, with a space on each side.
  A colon, a period, or a pair of commas usually does better.
- Put a callout box (`> **Note**`, GitHub alerts) only on an amendment pointer or on a warning that costs something if ignored.
- Write paths with placeholders, never a real home folder: `%APPDATA%\Microsoft Flight Simulator 2024\`, `<user>`.
- Quote sources briefly, and link to them or cite them as [Evidence](#evidence) says.
  Don't copy SDK doc pages into the record, because the repository will be public.

## Code comments

The code already states what it does.
A comment earns its place by saying what the code can't: why it's this way, the input that breaks it, the ordering that matters, or the thing that was tried and didn't work.

```text
✗  // Use tagged data.
✓  // SimConnect rejects a data-definition entry for a variable the simulator doesn't have,
   // but only later, so nothing fails where the entry was added. A positional read then
   // shifts every later value onto the wrong variable, and tagged data says which
   // variable each value is. (fsc-editor, docs/sim-vars/build/v1-log.md, "2026-08-23 —
   // The `A:` read crashed the app. Positional reads were the wrong shape.")
```

A workaround for sim behavior cites how we know, the same as a document does: a log entry, another document in `record/`, or an SDK page.
A TODO names the condition that ends it.
No history ("added for the relay change"), since git keeps history, and no commented-out code.

## Commit messages

Until the repository goes public, a commit title only has to say what changed.

## Instructions for agents

`CLAUDE.md`, skills, agent definitions, and prompts are read by a model that follows them literally and can't ask what they meant.

- **Every line changes behavior.**
  Delete a line and ask whether an agent would act differently.
  If not, leave it deleted.
  A new rule's reason sentence names the failure that prompted it.
- **Rule first, then the reason in one sentence.**
  The reason is what lets an agent handle the case the rule didn't name.
- **Name the trigger.**
  "Before writing code that runs in a panel" gets followed, and a free-floating rule is forgotten by the time it applies.
- **No shouting.**
  Capitals, "IMPORTANT", and "you must always" make a model apply a rule to cases it was never meant for.
  A calm rule with a reason is followed more accurately.
- **One example beats three adjectives.**
  A before-and-after pair teaches what "concise" can't.
- **Point, don't paste.**
  Link to the canonical document.
  A rule that must be seen before an action lives inline in `CLAUDE.md`, and then only there.
- **Keep `CLAUDE.md` under 150 lines of its own.**
  It's read at the start of every session, whether or not it's relevant.
  Its imports load with it, so each imported line faces the same deletion test.
- **An agent definition that writes tells its agent to read this file**, rather than relying on the import reaching it.

## Finishing a document

1. Read it once, at speed, as its reader, and note each place you slowed down.
2. Rewrite each of those places.
3. If it makes MSFS claims a design will lean on, run the `fact-checker` agent and fix what it reports.
4. If you wrote or substantially changed a document in `record/`, `CLAUDE.md`, or a Markdown file in `.claude/`, run the `doc-reviewer` agent, unless it's a chapter, which its reader reviews.
   Fix or answer each finding.
   You're done when its report opens by saying the document is ready.

If the document is a log written during an experiment, skip steps 3 and 4.
Run both steps when a finding moves into a design doc or a decision.
