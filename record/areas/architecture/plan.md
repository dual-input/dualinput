# Architecture: plan

This plan designs Crosscheck's v1 architecture, step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), and goes deeper until every detail rests on a fact, by the rule in [When a node is done](#when-a-node-is-done).
It grows as a tree of questions.
A question we can't answer yet gets child questions for what it needs first, so each level's detail comes from the work on the level above it.

## How the tree grows

Each node is a `##` section of this plan, placed in number order, and gives its question, what its parent can't settle without it, what it reads, the document its answer goes in, and an `Exit:` line.
A child's number extends its parent's, so 1.2 is the second child of 1.
A node is done when it has a `Done on` line under its `Exit:` line, and open until then.
A node with children has a line such as `Waits on 1.1 and 1.2.` under its `Exit:` line.
The work stands at the first node that has no `Done on` line, and no `Waits on` line naming a node that's still open.

To work a node:

1. Before proposing anything for the node, read in full each document in `record/` that bears on its question, starting with those the node lists, and search the prior work [CLAUDE.md](../../../CLAUDE.md#prior-work) lists for it.
   You'll know what the record establishes and where it's silent.
2. If the node can't be answered from that, name the questions that have to be answered first, and propose each as a child, with what the node can't settle without it.
   Once the user agrees to a child, add it as a node, and add it to the parent's `Waits on` line.
3. Once its children are done, follow [a session from start to finish](../product/03-v1-scope.md#a-session-from-start-to-finish) through their answers, with the rules of each section it links to.
   Wherever one answer needs something another doesn't give, reopen the child that has to change.
4. Write the node's answer in the document it names.
   Once the answer meets [When a node is done](#when-a-node-is-done) and the user agrees to it, add `Done on <YYYY-MM-DD>.` under its `Exit:` line.

The tree's root is step 7 itself, worked by the same steps, with step 7's exit as its question.
When every top-level node is done, propose the next one, and if step 7's exit needs no more, check the top-level answers as step 3 does, then mark step 7 done in [the product plan](../product/plan.md#7-tech-stack-and-architecture).

## When a node is done

A node can be marked done when both of these hold:

- Every claim its answer rests on is measured, read where it doesn't turn on which code path runs, or knowledge that [Evidence](../../../.claude/rules/writing.md#evidence) lets go unmarked.
  A documented or unverified claim needs a child that settles it, such as a read, a search of our prior work, or a probe in `experiments/`, proposed as step 2 says.
- Every choice the answer leaves open can be made later inside one part of Crosscheck without changing another, as the core's WebSocket library could be if no client sees it (a hypothetical example).

## Where answers go

An answer goes in one of these documents, and this plan holds each node's question, its status, and the notes raised for it:

- a design doc in the area the answer belongs to, such as `record/areas/network/`
- a reference, beside what it describes
- a tentative decision in this area's `decisions.md`

When you mark a node done, write each tentative decision its children settled as a numbered decision in `record/decisions/`, and link the tentative one to it, because step 3 is what tests a decision against its siblings' answers.
A child that serves two nodes gets its decisions numbered when the last of them is done.
When step 7 is marked done, the top-level nodes' tentative decisions get numbered the same way.

A finding that contradicts a done node reopens it, along with every node whose answer rests on that node's answer.
In each one, replace the `Done on` line with `Reopened on <YYYY-MM-DD>, by <link to the finding>.`

A thought about another node, met while working on one, goes under that node as a line headed "Raised elsewhere", or, if no node holds it, gets proposed as a new node, as step 2 says.

## 1. The spine

Question: what does every other part of Crosscheck rest on?
That covers the processes it runs as; how its components communicate, from the core, the desktop app, and the EFB app to our WASM module and the panels; the conventions they share; the language; and where one part ends and the next begins.
Step 7 can't decide a language, frameworks, or a core architecture without it, and every node after it assumes its answer.
It reads [01-aims](../product/01-aims.md), [03-v1-scope](../product/03-v1-scope.md), [04-room-for-later](../product/04-room-for-later.md), step 7 of [the product plan](../product/plan.md#7-tech-stack-and-architecture), and the sync design docs: [01-profile-entries](../sync/01-profile-entries.md), [02-live-sync](../sync/02-live-sync.md), and [03-catch-up](../sync/03-catch-up.md).
Its answer goes in `01-spine.md`, in this area.
That document takes over the leanings in step 7, and step 7 then links to it.
Exit: `01-spine.md` is agreed.
