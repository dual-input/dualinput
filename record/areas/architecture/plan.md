# Architecture: plan

This plan designs Crosscheck's v1 architecture, step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), and goes deeper until every detail rests on a fact, by the rule in [When a node is done](#when-a-node-is-done).
It grows as a tree of questions.
A question we can't answer yet gets child questions for what it needs first, so each level's detail comes from the work on the level above it.

## How the tree grows

Each node is a `##` section of this plan, placed in number order, and gives its question, what its parent can't settle without it, what it reads, the document its answer goes in, and an `Exit:` line.
A child's number extends its parent's, so 1.2 is the second child of 1.
A node is done when it has a `Done on` line under its `Exit:` line, and open until then.
A node with children has a line such as `Waits on 1.1 and 1.2.` under its `Exit:` line.
A node may also wait on a node numbered under another parent, when one answer serves both, and names it in its `Waits on` line the same way.
The work stands at the first node that has no `Done on` line, and no `Waits on` line naming a node that's still open.

To work a node:

1. Before proposing anything for the node, read in full each document in `record/` that bears on its question, starting with those the node lists, and search the prior work that [CLAUDE.md](../../../CLAUDE.md#prior-work) lists for anything on the question.
   You'll know what the record establishes and where it's silent.
2. If the node can't be answered from that, propose to the user the questions that have to be answered first, each as a child with what the node can't settle without it, and where a node elsewhere in the tree already asks one of them, propose naming that node instead.
   You'll have a list the user can agree to one child at a time.
3. For each child the user agrees to, add it as a node, and put its number in the parent's `Waits on` line.
   You'll see the child as a `##` section and its number in the parent's `Waits on` line, and by the rule above, the work moves to the first open child.
4. If the node has a `Waits on` line, once every node it names is done, walk each step of [a session from start to finish](../product/03-v1-scope.md#a-session-from-start-to-finish), and at each step check that those nodes' answers together do what that step's linked section requires.
   Wherever one answer needs something another doesn't give, reopen the node that has to change, as [Reopening a node](#reopening-a-node) says.
   You're done with this step when the whole session walks through the answers with nothing reopened.
5. Write the node's answer in the document it names.
6. Once the node's `Exit:` has happened and its answer meets [When a node is done](#when-a-node-is-done), add `Done on <YYYY-MM-DD>.` under its `Exit:` line, and number the tentative decisions its children settled, as [Where answers go](#where-answers-go) says.
   You'll see the `Done on` line, and the next open node is where the work stands.

When working one node turns up something another node has to settle, add it under that node on a line that starts `Raised elsewhere:` and names the node it came from.
That node's answer settles each such line before it's marked done, and a line added under a done node reopens it, as [Reopening a node](#reopening-a-node) says.
If no node covers it, propose a new node for it, as step 2 says.

The tree's root is step 7 of the product plan: its question is step 7's exit, and its children are the top-level nodes.
When every top-level node is done and their answers don't yet give each decision step 7's exit names, propose the next top-level node, as step 2 does.
When they do, check the top-level answers as step 4 does, number their tentative decisions as [Where answers go](#where-answers-go) says, and mark step 7 done in [the product plan](../product/plan.md#7-tech-stack-and-architecture).

## When a node is done

A node is marked done only when all of these hold:

- Every claim its answer rests on is measured, is read in files and doesn't turn on which code path runs, or is knowledge that [Evidence](../../../.claude/rules/writing.md#evidence) lets go unmarked.
  A documented or unverified claim needs a child that settles it, such as a read, a search of our prior work, or a probe in `experiments/`, proposed as step 2 says.
- Every choice the answer leaves open can be made later inside one part of Crosscheck without changing another, as the core's WebSocket library could be if no client sees it (a hypothetical example).
- Its answer settles each `Raised elsewhere:` line under it.

## Where answers go

An answer goes in one of these documents, never in this plan:

- a design doc in the area the answer belongs to, such as `record/areas/network/`
- a reference, beside what it describes
- a tentative decision in this area's `decisions.md`
- an entry in the log of the area the finding belongs to, for a child that's a read, a search, or a probe, which the parent's answer cites

This plan holds each node's question, its status, and its `Raised elsewhere:` lines.

When you mark a node done, write each tentative decision its children settled as a numbered decision in `record/decisions/`, and link the tentative one to it.
A child's decision isn't checked against its siblings' answers until its parent's step 4, and a numbered decision can't be edited, so numbering waits for the parent.
A child that serves two nodes gets its decisions numbered when the last of them is done.

## Reopening a node

A done node reopens when a finding contradicts it, or when its parent's step 4 finds that a sibling needs something its answer doesn't give, and so does every node whose answer rests on its answer.
In each one, replace the `Done on` line with `Reopened on <YYYY-MM-DD>, by <link to the finding, or the node whose answer needs the change>.`
When the node is marked done again, each numbered decision its new answer changes gets a reversing decision, as [Decisions](../../../.claude/rules/writing.md#decisions) says.

## 1 The spine

Question: what does every other part of Crosscheck rest on?
It covers:

- the processes Crosscheck runs as
- how its components talk to each other, on one machine and between machines: the watcher, the core, the desktop app, the EFB app, our WASM module, the panels, the relay, and the report server, and the plugins' code, which may run inside several of them
- the conventions they share
- the language
- the boundaries between its parts

A component is something that runs on its own, such as a process, a document in the sim, or a WASM module.
A part is a piece of Crosscheck's design that a later node works on, such as the sync engine, and it may live in one component or span several.

Step 7 can't decide a language, frameworks, or a core architecture without it, and every node after it assumes its answer.
It reads [01-aims](../product/01-aims.md), [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), and the sync design docs: [01-profile-entries](../sync/01-profile-entries.md), [02-live-sync](../sync/02-live-sync.md), and [03-catch-up](../sync/03-catch-up.md).
Its answer goes in `01-spine.md`, in this area.
`01-spine.md` takes up step 7's paragraphs after its exit, from the headless core proposed on 2026-10-03 to sim awareness, and once the user agrees to it, step 7 links to it in their place.
Exit: the user agrees to `01-spine.md`.
Waits on 1.1, 1.2, 1.3, and 1.4.

## 1.1 Components

Question: what components does Crosscheck run, where does each run, and what does each own?
The spine can't draw a link without its endpoints, and v1's features name endpoints beyond the watcher, the core, and the core's clients that step 7 leans toward.
Pilots bind the take-control key in Crosscheck's settings rather than the sim's ([03-v1-scope](../product/03-v1-scope.md#take-control-key)), so one of our components has to catch the press of that key or hardware button, and the record doesn't say which, nor which components a plugin's code runs in ([03-v1-scope](../product/03-v1-scope.md#plugins)).
It reads what node 1 reads, then the area logs, starting with [interface](../interface/log.md), [avatars](../avatars/log.md) with its [decisions](../avatars/decisions.md), [flight-controls](../flight-controls/log.md), and [flight-model](../flight-model/log.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Waits on 1.1.1 and 1.1.2.

## 1.1.1 Masking priority at sim start

Question: can the core take its masking priority when the sim starts, ahead of any aircraft's module, without holding back the pilot's controls until a session asks it to?
1.1 can't say what the core does from the moment the sim starts without it.
On the A2A PA-24, our masks got ahead of the aircraft's only when they were registered before it loaded ([flight-controls log](../flight-controls/log.md#2026-10-01-the-mask-registered-first-gets-ahead-of-accu-sims)), and soft takeover and mixed flight controls, both Soon picks, need that place on such aircraft ([04-room-for-later](../product/04-room-for-later.md#an-input-layer)).
A probe settles it: register an empty notification group at 10,000,000 before the PA-24 loads, add maskable events to it after the aircraft loads, and see whether our group still sits ahead of the aircraft's.
It reads the [flight-controls log](../flight-controls/log.md), the foundations chapter [04-02](../../learn/foundations/04-02-events.md), and the probe [p01-mask.mjs](../../../experiments/areas/flight-controls/p01-mask.mjs).
Its answer goes in an entry in the flight-controls log, which 1.1's section of `01-spine.md` cites.
Exit: a flight-controls log entry answers the question.

## 1.1.2 Components with no session

Question: what does each component do while no session runs, and what moves it into a session and back?
1.1 can't say what each component owns until it says when.
The core starts with every sim run ([tentative decisions](decisions.md#the-core-starts-with-every-sim-run)), and a pilot may fly the Baron every day and with a crew once a week, so with no session nothing should load a profile, run a plugin, or watch the cockpit (user, 2026-10-07).
That doesn't come for free: FS Copilot's app opened its relay link and its rendezvous registration at launch, session or not (read in the FS Copilot fork, `FsCopilot/Program.cs`, `BuildAvaloniaApp`), and fsc-editor's module streams the sim's `L:` values until the sim exits, because the app never sends it the `stop` command it has (read in fsc-editor, `link/src/module.cpp`).
It reads 1.1's answer and the tentative decisions, the session sections of [03-v1-scope](../product/03-v1-scope.md#session), and sim awareness in step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.

## 1.2 Communication

Question: how do those components communicate?
The spine can't draw the boundaries between parts, or set the conventions they share, until it knows which components exchange what, and by what means.
It reads 1.1's answer, then the [interface](../interface/log.md) and [CommBus](../commbus/log.md) logs, and the foundations chapters on the ways to reach the sim: [04-01](../../learn/foundations/04-01-connection-and-data.md), [04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md), [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md), and [06-04](../../learn/foundations/06-04-websockets-to-localhost.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Raised elsewhere: by 1.1, how a panel finds its own core when two cores run on one machine, since FS Copilot's panels try ports 9020 to 9024 and connect to the first that answers, one reason its test bench must not run beside a live sim (FS Copilot fork, `record/pointer-forwarding/docs/14-test-bench.md`, "Do not run the simulator during a bench run").

## 1.3 Language and toolchains

Question: what language and toolchain does each component's runtime take?
The spine can't pick a language until it knows the runtimes the components run in, and they differ: Coherent GT, the sim's WASM, Node and Electron if step 7's lean holds, and whatever the local speech recognizer and ATC audio capture run in, which the record leaves open ([voice phrases](../product/03-v1-scope.md#voice-phrases), [hearing ATC](../product/03-v1-scope.md#hearing-atc)).
It reads 1.1's answer, then the foundations chapters [05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md), [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md), and [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Raised elsewhere: by 1.1, whether the core's native code for Windows input and audio runs in the core's own process or in a process the core supervises, since a crash in native code inside the core's process would end the pilot's session ([tentative decisions](decisions.md#the-core-catches-the-take-control-key-and-buttons)).

## 1.4 Shared conventions

Question: what conventions does every component share?
1.2 says which components exchange what, and the spine also can't draw the boundaries between parts until it knows the form of the fields every message carries, such as its IDs and its times.
The record leaves two of these to step 7 by name: the form of a pilot ID ([02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)) and of a session ID ([03-v1-scope](../product/03-v1-scope.md#recording-and-bug-reports)).
The sync design implies others.
One is the ID that lets a receiver apply a message once when it arrives directly, through the relay, or both ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice)).
Another is the form of a time, because the sync design gives times in both frames and milliseconds: the duplicate filter's window is 3 frames and at most 200ms, and a write's pace is `every(1, 'frame')` or `every(40, 'ms')` ([02-live-sync](../sync/02-live-sync.md#keeping-a-change-from-applying-twice), [01-profile-entries](../sync/01-profile-entries.md#the-writer-api)).
It reads 1.2's answer, then the foundations chapters [08-01](../../learn/foundations/08-01-replication-models-and-authority.md), [08-03](../../learn/foundations/08-03-ordering-and-classes-of-data.md), [08-05](../../learn/foundations/08-05-position-and-clocks.md), [09-05](../../learn/foundations/09-05-versions-and-security.md), and [09-06](../../learn/foundations/09-06-connection-lifecycle.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
Raised elsewhere: by 1.1, what a pilot's identity is across a core restart, since FS Copilot made a restarted app "a new peer in every respect" (FS Copilot fork, `record/pointer-forwarding/docs/12-pre-pr-review.md`, R03), while [the connection](../product/03-v1-scope.md#the-connection) reconnects a returning pilot from session state saved on their machine.
