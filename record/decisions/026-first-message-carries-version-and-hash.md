# 026: Every first message carries one version number and a hash of the message crate

The watcher, the core, the helper, the desktop app, and the Community package, with the WASM module in it, carry one version number, which the build writes into each from one place.
Each first message, the module's version slot, and each pilot's join carry that version and a hash of the message crate, both as text.
A core refuses a join whose version or hash differs from its own, and on one machine it logs a component whose version or hash differs from its own.
Decided by the user on 2026-10-09, in node 1.4 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#every-first-message-carries-one-version-number-and-a-hash-of-the-message-crate).

## Context

Both ends of a link have to agree on the bytes of every message, and a binary format with a fixed field order breaks as soon as either side adds or moves a field, so it needs a version check before any data flows ([09-05](../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).
Dual Input's messages cross between two pilots' cores, and between the core and the other components on one PC ([01-spine](../areas/architecture/01-spine.md#versions)).

- Dual Input's programs and its package update together, as one version, and pilots on different versions can't join each other ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).
- A version number nothing reads drifts: fsc-editor's package version sat at 0.0.1 while its module's reached 0.3.0, until its build derived one from the other ([05-03](../learn/foundations/05-03-toolchain-versioning-and-debugging.md#protocol-versioning-between-the-app-and-the-module-packed-structs)).
- Two development builds can carry one version number with different messages, and FS Copilot's check of a hash of each packet type refuses a peer whose types differ ([09-05](../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).

## Options

1. **A version number for each component.**
   A version number nothing reads drifts, as fsc-editor's package's did against its module's.
2. **One version number, and no hash.**
   Two development builds of one version whose messages differ would pass each other's check.
3. **Pilots on different versions flying together.**
   It would need a version both sides speak rather than equal ones, and v1's scope doesn't offer it ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).
4. **One version number for every component, written by the build from one place, with a hash of the message crate beside it, both checked for equality.**
   Pilots on different releases can't fly together, which v1's scope already rules, and the build has to hash the crate in a way that covers each message's encoding.

## Decision

Option 4.
One place writing the version leaves nothing to drift, and the hash tells apart two development builds that carry one version number with different messages ([09-05](../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).
Equality is enough, because Dual Input's programs and its package update together, and v1's scope already keeps pilots on different versions apart ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).

## What it commits us to

- Two development builds of one version whose messages differ refuse each other too ([01-spine](../areas/architecture/01-spine.md#versions)).
- Between cores, each side's first message on a connection opens with a header that no release changes, holding Dual Input's version and the message crate's hash ([01-between-machines](../areas/network/01-between-machines.md#joining)), and the backend refuses a joiner whose version or hash differs from the session's before anyone dials ([decision 034](034-backend-matches-invite-codes.md)).
- The core's log names each component whose version or hash differs from its own ([01-spine](../areas/architecture/01-spine.md#how-the-core-knows-a-component-is-alive)).
- It leaves out pilots on different versions flying together, option 3.
- How the build hashes the message crate is left to the build's stage of step 8 ([01-spine](../areas/architecture/01-spine.md#left-open)).
  The hash has to cover each message's encoding as well as its fields, since FS Copilot's fingerprint covers a type's fields and not its codec, so a codec that wrote them in a new order would pass it ([09-05](../learn/foundations/09-05-versions-and-security.md#serialization-protocol-versioning-and-compatibility-between-app-versions)).
- What the core does with a component on its own machine whose version or hash differs from its own, beyond logging it, is left to the part that designs the core ([01-spine](../areas/architecture/01-spine.md#left-open)).
  One such component is a WASM module the sim loaded at boot from an older package, whose data slots the core would write in a layout the module doesn't read.
