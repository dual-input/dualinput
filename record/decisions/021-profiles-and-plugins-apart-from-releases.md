# 021: Profiles and plugins reach pilots apart from Dual Input's releases

Profiles and plugins update apart from Dual Input's releases: on each merge to one public repository, CI builds each profile into a bundle, with its modules merged in and its plugin compiled to JavaScript, and publishes it on GitHub Pages under its hash.
Each time the core starts, it brings its cache of bundles up to date, and a session flies one aircraft and pins one bundle by its hash.
Nothing is signed, and the format and the plugin API share one level, so a release runs every bundle at or below its own level.
Decided by the user on 2026-10-08, 2026-10-11, and 2026-10-12, in nodes 1.3 and 4 of the [architecture plan](../areas/architecture/plan.md), and numbered on 2026-10-13 from its [tentative decision](../areas/architecture/decisions.md#profiles-and-plugins-reach-pilots-apart-from-dual-inputs-releases).

## Context

[03-v1-scope](../areas/product/03-v1-scope.md#plugins) ships plugins with Dual Input, in its installer and its Community package, and updates them with it, so every pilot in a crew runs the same plugins.
A pilot installs a new Dual Input only with the sim closed, and pilots on different versions can't fly together ([installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).
The [preflight match check](../areas/product/03-v1-scope.md#preflight-match-check) already compares each profile by a hash, and the profile registry, a Later pick, would fetch a profile by that hash ([04-room-for-later](../areas/product/04-room-for-later.md#profiles)).
The spine left to node 4 where profiles and plugins are served from, how often the core checks for new versions, and how the plugin API's version relates to Dual Input's ([01-spine](../areas/architecture/01-spine.md#left-open)).

## Options

For when profiles and plugins reach pilots:

1. **With Dual Input's releases,** as 03-v1-scope ships plugins.
   Every fix to one would take a new Dual Input, so after each fix two pilots couldn't fly until both had closed the sim to install it (user, 2026-10-08; [installing and updating](../areas/product/03-v1-scope.md#installing-and-updating)).
2. **Apart from Dual Input's releases.**
   Plugin code runs only in the core ([decision 020](020-plugin-code-runs-only-in-core.md)), so the core can load a new version whenever a session isn't using the old one.

For how a plugin travels with its profile:

1. **Published apart from its profile.**
   A plugin published that way escaped the profile's hash, pin, and level: a merge that changed only the plugin left the hash the same while two pilots ran different plugins, and a plugin needing a newer level could ride beside an older profile (node 4's review, 2026-10-12).
2. **Compiled into its profile's bundle, under a `plugin:` key only the builder writes.**
   One hash and one level cover both, so a pinned profile pins its plugin too ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#plugins)).

For where the core fetches bundles from:

1. **GitHub's REST API,** which allows an unauthenticated address 60 requests an hour (documented, [rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
2. **GitHub Pages,** whose "sites have a soft bandwidth limit of 100 GB per month" (documented, [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)), published by CI from the repository authors edit.

For when the core fetches:

1. **When an aircraft loads.**
   The spine loads a profile when a session starts with the aircraft already loaded, too, and the root's walk through a session found that this fetch missed that case ([architecture plan](../areas/architecture/plan.md#4-profiles-and-plugin-delivery)).
2. **Each time the core starts, into a cache it loads every profile from.**
   A load never waits on the network, and a bundle CI publishes reaches a pilot at their next sim start ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#delivery)).

For trust:

1. **Signed bundles.**
   A signature would help only with a key kept off GitHub, a manual step in every publish (user, 2026-10-11).
2. **Unsigned bundles, checked by hash.**
   A hijacked repository could publish something that spoils flights and nothing more, since neither a profile's script nor a plugin reaches the pilot's files or the network ([decision 020](020-plugin-code-runs-only-in-core.md)).

For versions:

1. **A version and a date each author writes.**
   Versions are hard for an average author (user, 2026-10-11), and a date the author writes is missing from 4 of FS Copilot's 56 profiles (fsc-editor, `docs/sim-vars/18-language-core.md`, `header-updated`).
2. **No version, with the core loading whatever is newest.**
   A strict loader refuses what it doesn't know: our FS Copilot fork's new `pointer:` key "bricks profile loading on older releases" (FS Copilot fork, `record/pointer-forwarding/docs/11-fsc-implementation-plan.md`, item 6).
3. **A hash the core computes, the date CI published, and a level CI works out.**
   It asks nothing of authors (user, 2026-10-11), and a fix published at a higher level reaches only pilots on a release at that level or later ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#levels)).

## Decision

The last option in each group.
Published apart from releases, a fix to a profile or a plugin reaches pilots at their next sim start with no new Dual Input, and one bundle under one hash keeps the match check, the pin, and the level covering the plugin too.
A cache brought up to date at each start lets the core load a profile at any moment a session needs one, such as a session started with the aircraft already loaded, with no wait on the network, and outside a test session, a session changes no bundle midway anyway (user, 2026-10-12).
A core has to know which bundles it can run, and a level CI works out tells it while asking nothing of authors (user, 2026-10-11).
Pages's 100 GB a month covers the load: a pilot downloads each bundle once, so 1,000 pilots taking 50 bundles the size of FS Copilot's merged 58P profile, 59 KB, a hypothetical count, take about 3 GB once, and after that only what CI publishes, plus the index at each start (arithmetic, [01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#delivery)).

## What it commits us to

- Profiles and plugins live in one public repository of flat files, and on each merge CI builds each profile into a bundle, one YAML file with its modules merged in and its plugin compiled to JavaScript, checks it, and works out its level ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#delivery)).
- GitHub Pages holds an index of every published bundle, with its profile's path, the variants it covers, its hash, the date CI published it, and its level, and every bundle under its hash, kept for good.
- Each time the core starts, it fetches the index and downloads the newest bundle of each profile at or below its own level that its cache lacks, checking the bytes against the hash; it never rebuilds a published bundle, and it loads every profile from that cache.
- A session pins its one bundle by hash, which doesn't change mid-session outside a test session, and a pilot whose machine lacks the pinned bundle fetches it by its hash.
- The level is an integer that each release adding to the format or the plugin API raises by 1, and a pilot who doesn't update Dual Input keeps the older bundle, bug included ([01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#levels)).
- A profile carries no version or date of its own.
- For testing, the core builds the same bundle from a local folder, and shows it in the match check as "unpublished".
- This changes [03-v1-scope](../areas/product/03-v1-scope.md#plugins), whose plugins ship and update with Dual Input, and settles the spine's questions of whether profiles reach pilots apart from Dual Input's releases, where they're served from, how often the core checks, and how the plugin API's version relates to Dual Input's.
- This decision leaves to step 8 which pilot's bundle the session pins when two pilots' cores took different ones, and which compiler the core embeds for a local build.
- It also leaves to step 8 test sessions, in which the author's core sends each saved bundle to the crew and every machine reloads it, with the three needs [01-format-and-delivery](../areas/profiles/01-format-and-delivery.md#testing-an-edit) lists.
- It leaves out signing, if a later plugin needs the pilot's files.
