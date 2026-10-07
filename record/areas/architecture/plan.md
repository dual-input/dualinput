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
2. If the node can't be answered from that, propose to the user the questions that have to be answered first, each as a child with what the node can't settle without it.
   You'll have a list the user can agree to one child at a time.
3. For each child the user agrees to, add it as a node, and put its number in the parent's `Waits on` line.
   You'll see the child as a `##` section, and its number in the parent's `Waits on` line.
4. If the node has children, once they're done, walk each step of [a session from start to finish](../product/03-v1-scope.md#a-session-from-start-to-finish), and at each step check that the children's answers together do what that step's linked section requires.
   Wherever one answer needs something another doesn't give, reopen the child that has to change, as [Reopening a node](#reopening-a-node) says.
   You're done with this step when the whole session walks through the answers with nothing reopened.
5. Write the node's answer in the document it names.
6. Once the node's `Exit:` has happened and its answer meets [When a node is done](#when-a-node-is-done), add `Done on <YYYY-MM-DD>.` under its `Exit:` line, and number the tentative decisions its children settled, as [Where answers go](#where-answers-go) says.
   You'll see the `Done on` line, and the next open node is where the work stands.

When working one node turns up something another node has to settle, add it under that node on a line that starts `Raised elsewhere:` and names the node it came from.
If no node covers it, propose a new node for it, as step 2 says.

The tree's root is step 7, a node whose question is step 7's exit and whose children are the top-level nodes, worked by the same steps.
When every top-level node is done and step 7's exit needs more, propose the next top-level node, as step 2 does.
When it needs no more, check the top-level answers as step 4 does, number their tentative decisions as [Where answers go](#where-answers-go) says, and mark step 7 done in [the product plan](../product/plan.md#7-tech-stack-and-architecture).

## When a node is done

A node is marked done only when both of these hold:

- Every claim its answer rests on is measured, is read in files and doesn't turn on which code path runs, or is knowledge that [Evidence](../../../.claude/rules/writing.md#evidence) lets go unmarked.
  A documented or unverified claim needs a child that settles it, such as a read, a search of our prior work, or a probe in `experiments/`, proposed as step 2 says.
- Every choice the answer leaves open can be made later inside one part of Crosscheck without changing another, as the core's WebSocket library could be if no client sees it (a hypothetical example).

## Where answers go

An answer goes in one of these documents, never in this plan:

- a design doc in the area the answer belongs to, such as `record/areas/network/`
- a reference, beside what it describes
- a tentative decision in this area's `decisions.md`

This plan holds each node's question, its status, and its `Raised elsewhere:` lines.

When you mark a node done, write each tentative decision its children settled as a numbered decision in `record/decisions/`, and link the tentative one to it.
A child's decision isn't checked against its siblings' answers until its parent's step 4, and a numbered decision can't be edited, so numbering waits for the parent.
A child that serves two nodes gets its decisions numbered when the last of them is done.

## Reopening a node

A finding that contradicts a done node reopens it, along with every node whose answer rests on that node's answer.
In each one, replace the `Done on` line with `Reopened on <YYYY-MM-DD>, by <link to the finding, or the node whose answer needs the change>.`

## 1 The spine

Question: what does every other part of Crosscheck rest on?
It covers:

- the processes Crosscheck runs as
- how its components talk to each other: the core, the desktop app, the EFB app, our WASM module, and the panels
- the conventions they share
- the language
- the boundaries between its parts

Step 7 can't decide a language, frameworks, or a core architecture without it, and every node after it assumes its answer.
It reads [01-aims](../product/01-aims.md), [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), and the sync design docs: [01-profile-entries](../sync/01-profile-entries.md), [02-live-sync](../sync/02-live-sync.md), and [03-catch-up](../sync/03-catch-up.md).
Its answer goes in `01-spine.md`, in this area.
When `01-spine.md` is agreed, the leanings in step 7 move into it, and step 7 links to it in their place.
Exit: the user agrees to `01-spine.md`.
Waits on 1.1, 1.2, 1.3, and 1.4.

## 1.1 Components

Question: what components does Crosscheck run, where does each run, and what does each own?
The spine can't draw a link without its endpoints, and v1's features name more of them than the core and its clients that step 7 leans toward.
Some have no home yet, such as whatever reads the take-control key, which pilots bind in Crosscheck's settings rather than the sim's ([03-v1-scope](../product/03-v1-scope.md#take-control-key)), and the record leaves open where each part of a plugin runs ([03-v1-scope](../product/03-v1-scope.md#plugins)).
It reads what node 1 reads, then the area logs, starting with [interface](../interface/log.md), [avatars](../avatars/log.md) with its [decisions](../avatars/decisions.md), [flight-controls](../flight-controls/log.md), and [flight-model](../flight-model/log.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.

## 1.2 Communication

Question: how do those components communicate?
The spine can't draw the boundaries between parts, or set the conventions they share, until it knows which components exchange what, and by what means.
It reads 1.1's answer, then the [interface](../interface/log.md) and [CommBus](../commbus/log.md) logs, and the foundations chapters on the ways to reach the sim: [04-01](../../learn/foundations/04-01-connection-and-data.md), [04-03](../../learn/foundations/04-03-client-data-ai-and-throughput.md), [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md), and [06-04](../../learn/foundations/06-04-websockets-to-localhost.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.

## 1.3 Language and toolchains

Question: what language and toolchain does each component's runtime take?
The spine can't pick a language until it knows the runtimes the components run in, and they differ: Node, Electron, Coherent GT, the sim's WASM, and whatever native code audio capture and speech recognition need.
It reads 1.1's answer, then the foundations chapters [05-01](../../learn/foundations/05-01-kinds-lifecycle-and-apis.md), [05-03](../../learn/foundations/05-03-toolchain-versioning-and-debugging.md), and [06-01](../../learn/foundations/06-01-the-engine-and-instruments.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.

## 1.4 Shared conventions

Question: what conventions does every component share?
The spine can't fix where one part ends and the next begins until the parts agree on what crosses between them.
Step 7 owes two of these by name, the form of a pilot ID ([02-live-sync](../sync/02-live-sync.md#when-two-pilots-change-one-entry)) and of a session ID ([03-v1-scope](../product/03-v1-scope.md#recording-and-bug-reports)), and the sync design docs imply more, such as the message ID every transport filters duplicates by, and time given in both frames and milliseconds.
It reads 1.2's answer, then the foundations chapters [08-01](../../learn/foundations/08-01-replication-models-and-authority.md), [08-03](../../learn/foundations/08-03-ordering-and-classes-of-data.md), [08-05](../../learn/foundations/08-05-position-and-clocks.md), [09-05](../../learn/foundations/09-05-versions-and-security.md), and [09-06](../../learn/foundations/09-06-connection-lifecycle.md).
Its answer goes in its own section of `01-spine.md`.
Exit: the user agrees to that section.
