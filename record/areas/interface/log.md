# Interface: log

What our experiments found about showing Dual Input to the pilot inside the sim, such as the notification banner and the EFB app, newest entry first.
The probes and their raw output are in [experiments/areas/interface](../../../experiments/areas/interface), with the results in its `results/` folder.

## 2026-11-04: The desktop window's memory figure matches Windows' to within 0.4 MB, the app and its WebView2 read about 95 MB to 114 MB with the window open, and a window can follow its content frame by frame

**Asked:** whether the desktop window's figures agree with what a pilot would see in Task Manager, what the window costs while it's open, and whether a native window can follow content easing open.

**Expected:** about 73 MB for the window, from the seven processes [the install log](../install/log.md#2026-10-18-a-tauri-2-app-idles-as-a-tray-icon-in-22-mb-and-gives-back-webview2s-69-mb-once-its-window-is-destroyed-but-not-while-its-hidden) measured with a static page on 2026-10-18, and a jittering window edge, since each frame resizes a native window with WebView2 inside it.

**Found:** on our development machine, with a debug build:

- The app recorded 113.8 MB when Windows' `Win32_PerfFormattedData_PerfProc_Process`, whose `WorkingSetPrivate` is Task Manager's Memory column, read 113.4 MB for the same seven processes, 4s apart.
  `PrivateWorkingSetSize` in `PROCESS_MEMORY_COUNTERS_EX2` is the field that matches.
- With the window open, the tree read 94.8 MB to 113.8 MB, of which the app alone was 4.3 MB to 4.6 MB.
  That's 22 MB to 41 MB above the 72.7 MB a static page took, which we take to be React, the kit, and the fonts (unverified: this is a debug build, and a release build's figures would help settle it).
- WebView2's first process is a child of our program, and the walk finds the rest below it, while twelve other `msedgewebview2.exe` processes on the PC, the Claude app's among them, stay out.
- The user watched the window's edge follow the kit's 220ms ease, resized on each `ResizeObserver` callback, and said it "feels good", so no fallback was needed.
  That's a judgment by eye on a debug build, with no timing taken.
- A page that scrolled while it grew flashed a scrollbar until the window caught up, which narrowed its text and jumped its layout, so the page's `overflow` stays hidden, and only a screen too short for the window scrolls.
- Asked over the local port as the EFB app asks, the real app wrote the `Run` value, reported `on`, deleted it, and reported `off`.
  The local port refuses a page's origin unless it's the sim's, so no dev page can reach the real app, and the EFB app's row with its warning was checked on the stand-in in the debugger.

**Changed:** [the desktop app's screens](decisions.md#the-desktop-app-shows-velopacks-windows-and-its-own-figures-and-the-build-designs-the-rest) count the window's own processes, so its chart agrees with Task Manager.

What we haven't checked: a release build's figures, and the first-run window when the sim hasn't run, which only the stand-in has shown.

## 2026-11-02: A third session in the sim passes the heads, a changed window, a card's click with no core, and a joiner's preflight card

**Asked:** whether the fixes from [the second session](#2026-11-02-a-second-session-in-the-sim-confirms-bootmode-2-restart-and-a-load-from-the-world-map-and-finds-a-large-l-value-reads-0-and-a-canvas-repaints-only-when-its-element-changes) hold.

**Expected:** each to pass.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the Baron 58P, with a bench core running beside the real sim's core:

- The heads followed the cursor on the preflight page.
- A changed window took the banner back to the screen's corner.
- With the core killed and the EFB closed, a click on the "Dual Input service isn't running" card opened the EFB.
- A joiner under a pilot flying in a flight saw the preflight card.
- The EFB app, the banner, and the menu script joined the real sim's core, and none joined the bench core, whose one client was the fake desktop app the bench's own code opens, which answers [stage 5's case](../build/plan.md#11b-the-apps).
- The banner's page connected 0.45s to 2.05s after a session started, in nine hosts, so about the 2s [budget](01-apps.md#budgets), which counts from the EFB app's first call, up to 100ms after the session starts.
- The EFB app joined the core 18s after the menu script in this start, and at the same moment in the last, so how soon it joins varies, though both are long before a pilot can open the EFB.
- A core started again came back to its session and its pages joined within 140ms of its start.

**Changed:** nothing.

**Not tried:** the portrait's hands in the sim, which the pilot didn't look at, though the debugger shows them holding the edge with the EFB's rules loaded.
The pilot's report of "another subtle figure rendering issue" stays open: we couldn't tell what they saw, and the flat runs we found on a ball's edges show on a flat fill too, so they're how the engine draws a circle this small.

**Affects:** [the apps' cases](01-apps.md#cases-for-the-bench) and [the apps' budgets](01-apps.md#budgets).

## 2026-11-02: A second session in the sim confirms `BootMode` 2, Restart, and a load from the world map, and finds a large `L:` value reads 0 and a canvas repaints only when its element changes

**Asked:** whether the fixes from the entries below hold in the sim, with the real app as the EFB's only Dual Input app.

**Expected:** each to pass, since the debugger now loads the sim's rules.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the Baron 58P:

- With the sample in Community too, the sample registered first on one sim start and the real app on another, from the same order of scripts, since the EFB takes whichever registers first.
  So nothing that run tried tested the fixes, and the sample comes out of Community before a try of the real package.
- `BootMode` 2 holds: the EFB app joined the core in the menu, at the same moment as the menu script, with the EFB never opened and nothing drawn yet.
  Its first opening showed setup from its start, with no flash.
- The banner came back after a Restart, and after a load from the world map, its page connecting 4.2s after Ready to Fly.
- A click directly below the cards, inside the panel, reached the cockpit's switch, which answers [the case in the sim](01-apps.md#cases-for-the-bench).
- The preflight summary hid while our app was on screen: `L:DUALINPUT_EFB_ON_SCREEN` read 1 and the banner's text was empty.
- The failure box's lines compute `text-align: center`.
- `SimVar.SetSimVarValue` with `Date.now()`, 1,793,641,814,417, on an `L:` variable read back 0, in the writing document and the other, while 7 and 123,456 read back right, so a click on a card with no core, and a changed window, never reached the EFB app.
  We didn't measure where between 123,456 and that value the limit lies.
- The heads in preflight kept their first look on screen though their look followed the cursor: 865 mouse moves reached the page, the head's `look` went to where its code aims it, and it drew 286 times, while pictures of the sim with the cursor at two far corners showed the same head.
  Changing the canvas's `opacity` between 1 and 0.999 each frame made the head show each look.
  In the debugger the heads followed with no such change.
- The EFB's `svg { width: 100%; height: 100%; }` beat the `width` and `height` of the portrait's drawing of its hands, in a box with no size of its own, so the hands drew too small and too high.
- `FenixBootstrapper.exe`, which the sim starts when Fenix's package is installed, outlived the sim, and Steam refused every launch until it was killed.

**Changed:** each ask of the banner's adds one to its variable.
Each draw of a head changes its canvas's `opacity`.
The kit's reset gives an `svg` `width: auto` and `height: auto`, so it keeps its own size.
The tab bar's tooltips, which drew, are gone (user: "they work now, but I hate them visually").
The card's words stay "Dual Input service isn't running" (user, asked about "crashed": "Keep isn't running").

**Not tried:** a card's click with no core, a changed window, and the heads, since their fixes came after this session; and a joiner's preflight card, since the bench's stand-in sim ends after 10 minutes, and the second pilot's had.

**Affects:** [Coherent GT's measured limits](../architecture/coherent-gt.md), and [the names the sim shares](../architecture/02-code-map.md#names-the-sim-shares).

## 2026-11-02: The first whole EFB app and banner in the sim pass their clicks, drag, fade, and frame rate, on a local backend, relay, and second pilot

**Asked:** whether the real EFB app and banner, on the real core with a session, do what the debugger showed, in stage 11b's hand check.

**Expected:** a look at sizes and motion, since the debugger had run every screen.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the Baron 58P, with the core's data folder under `target/` and a bench core as the second pilot:

- The EFB's document drew 15 frames a second with our app open and idle, at 66.7ms p50, 70.2ms p99, and 71.3ms at most, against 30 a second in the toolbar's document, the same half the world map showed ([entry below](#2026-11-01-the-efbs-document-draws-15-frames-a-second-at-the-world-map-half-the-rate-of-the-sims-other-documents-so-a-quick-click-often-lands-between-two-frames)).
  With its tabs changing each second it held 15, at 87ms at most.
- A code field with the focus gave the keyboard back on Tab: the keys moved the camera, and on Tab again the field held what it had.
- A click on a control half under the fade at the foot of a scrolled page landed, with the tablet turned to landscape, since no page scrolled in portrait.
- A card dragged right and let go outside the panel let go.
- With the core killed, the banner said "Dual Input service isn't running" within 13s, and the EFB app its screen for that.
  A core started again came back to the session from its session file, and the EFB app, the banner, and the menu script joined it within 133ms of its start.
- A click on a cockpit switch beside the cards reached the switch, which answers [the case in the sim](01-apps.md#cases-for-the-bench) only as far as it was inside the panel, which we didn't note.
- A joiner's banner paints nothing while its pilot flying has no sim: the panel opened, 480 by 520, and preflight wasn't running.

The pilot called the figures good enough for now.

**Changed:** nothing, for these.

**Not tried:** a joiner's preflight card under a pilot flying who is in a flight, and a second flight load from the world map.

**Affects:** [the apps' cases](01-apps.md#cases-for-the-bench).

**Evidence:** [the frame rates](../../../experiments/areas/interface/results/p26-frame-rate-2026-11-02-17-14-21.txt), and [the session's stack](../../../experiments/areas/interface/p26-sim-session/stack.ts).

## 2026-11-02: The sim sizes a panel only as it opens, the toolbar's open call changes nothing on an open panel, and a load's old page closes after a short load has ended

**Asked:** why the banner sat far in from the screen's corner after the pilot made the sim's window bigger, and why it stayed away after a Restart.

**Expected:** a panel in percents of the screen to follow the screen, and a load to take the page down in time for the EFB app's next call ([the panel's calls](01-apps.md#the-banner)).

**Found:** on MSFS 2024 SunRise 12.2.282174.999:

- Our panel asks for 33.33 by 36.11, which opened in an 1,844 by 1,316 window at about 438 wide, and in a 5,120 by 1,440 window at 480 by 520.
  Going from the first window to the second without closing it left the panel 1,218 by 520: its height followed the screen, and its width scaled with the window's, as 438.6 x 5,120 / 1,844 is 1,218.
  So our box, at the panel's left, sat about 790px in from the screen's right, and a window made smaller should leave the panel narrower than the box (unverified).
- `TOOLBAR_BUTTON_TOGGLE` with `false` then `true`, from the EFB's document, gave a new page at 480 by 520.
  It did so with the second call 0ms, 150ms, and 500ms after the first, and 3s.
- `true` on a panel already open kept the same page, unreloaded, at the same size.
  That answers [the case in the sim](01-apps.md#cases-for-the-bench) on what the call does to a panel in the state it's given.
- In a Restart, the sim went to `Loading`, then to `ReadyToFly` 8.8s later, and the banner page's socket closed 0.4s after that, 9.2s into the load.
  The core closes a socket quiet for 8s, on a tick every 2s, so the page died around the load's start and its socket outlived a load this short.
  The EFB app's code saw an open page as the load ended, took that page for this flight's, and heard the close as the pilot's, so the panel stayed closed.

**Changed:**

- A load's end calls the toolbar, whatever the slice says, and a page that closes within 12s of it counts as the load's, so the calls go on until a page connects.
- A page whose shape differs by over 1% from the one it opened with, 300ms after the window's last change, writes `L:DUALINPUT_BANNER_RESIZED`, and the EFB app closes and opens the panel.

**Affects:** [the banner's box](decisions.md#the-banner-is-a-box-of-opaque-cards-at-the-screens-top-right), [the names the sim shares](../architecture/02-code-map.md#names-the-sim-shares), and [the apps' cases](01-apps.md#cases-for-the-bench).

## 2026-11-02: The sim's stylesheets set text-align, size, and font on bare elements around our pages, and Coherent GT draws no `title`

**Asked:** why the banner's lines drew at about twice their size in the sim, why the EFB app's failure box drew its title and body off center, and why the tab bar showed no tooltips, none of which the debugger showed.

**Expected:** our reset, scoped to our root, to stand between our pages and the sim's stylesheets.

**Found:** read through the inspector, on MSFS 2024 SunRise 12.2.282174.999:

- The banner's `p` lines computed to 24px under a 12px parent, since the panels' `/SCSS/common.css` has `p { font-weight: 400; font-size: var(--fontSizeParagraph); line-height: 1; color: var(--textColor); }`, and `--fontSizeParagraph` is 24px on a 1,440-line screen.
- The failure box computed `text-align: center` and its `p`s `left`, since the EFB's `efb_os/Assets/reset.css` gives nearly every element `text-align: left`, along with `font-size: inherit`, which is why nothing else there showed.
  So a centered parent centers nothing in the EFB unless each child says so.
- `efb_os.css` has `h2 { font-size: 16px; font-family: Roboto-Bold, ...; color: white; }` and `svg { width: 100%; height: 100%; }`.
- The EFB's document holds 16 stylesheets, one for each app's.
- A pilot resting the mouse on a tab saw no tooltip, so Coherent GT draws no `title`.

The debugger loads none of these, which is why it matched the sim's engine on [1,159 of 1,170 CSS items](#2026-11-01-the-sdks-coherentgt-debugger-runs-our-pages-in-coherent-gt-with-no-sim-and-matches-the-sims-efb-on-1159-of-p14s-1170-css-items-and-on-repeated-work-in-a-loaded-page) and still drew these differently.

**Changed:** the kit's reset sets `text-align: inherit` on everything in our root, and the inherited font properties on `p` and headings.
`tools/lib/sim-css.ts` restates the rules, and the dev loop loads them under our stylesheet, so the debugger shows this kind of difference.
The tab bar took the kit's `Tooltip`, until the pilot saw it ([entry above](#2026-11-02-a-second-session-in-the-sim-confirms-bootmode-2-restart-and-a-load-from-the-world-map-and-finds-a-large-l-value-reads-0-and-a-canvas-repaints-only-when-its-element-changes)).

**Affects:** [Coherent GT's measured limits](../architecture/coherent-gt.md).

## 2026-11-02: An EFB app with `BootMode` 1 starts at its first opening, and only 2 starts with the EFB

**Asked:** why the EFB app's first opening flashed "Dual Input service isn't running" for about a second before setup.

**Expected:** a link long up by then, since our app sets `BootMode` 1, which we took to run our code from the sim's start ([entry below](#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)).

**Found:** the EFB's document registered our app in the menu at 17:39:07, and the app's socket joined the core at 17:42:37, as the pilot opened it, 1m44s after Ready to Fly.
In fs-base-efb's `efb_ui/efb_os/efb_os.js`, `registerApp` calls an app's `render()` for `BootMode` 1, WARM, and 2, HOT, and runs `initAppEntry`, which draws the view and so calls its `onAfterRender`, for HOT only.
p09 set `BootMode` 1 too, but its polling ran in its script's top level, outside the view, so its run says nothing of a view.
A page with no core heard says the service isn't running, which is the flash.

That breaks more than the flash: the EFB app's code opens the banner, so a pilot back in a session after restarting the sim, who hadn't opened the app, would get no banner.

**Changed:** our app sets `BootMode` 2.

**Affects:** [the EFB app's registration](decisions.md#the-efb-app-touches-the-framework-only-to-register).

## 2026-11-02: A `discord:` link opens an invite in the Discord app, from closed

**Asked:** whether the EFB app's Discord links can reach a pilot's Discord app rather than their browser, and what form an invite takes in the app's link scheme, which Discord documents nowhere we found.

**Expected:** a browser to hand off to the app at best, since the invite page is what a browser opens.

**Found:** opening our invite in a browser with no Discord login shows a form to create an account, with "Log in" under it.
On our development machine, on Discord 1.0.9266, the app registers `discord` under `HKCU\Software\Classes`, whose `shell\open\command` runs `Discord.exe --url -- "%1"`.
With no Discord process running, `explorer discord:///invite/<code>` started the app, whose log says `transitionTo - Transitioning to /invite/<code>`, and whose window title became `discord.com/invite/<code> - Discord`.
`discord://-/invite/<code>` gave the same line in the log.
We didn't measure whether a normal browser hands off to a running app by itself, since the browser we read the page in is cut off from the rest of the PC.

**Changed:** `clients.open-discord` opens `discord:///invite/<code>` when the registry names a program for the scheme and that file exists, and otherwise the https link.

**Affects:** [the header's help line](decisions.md).

## 2026-11-01: A flex item with only absolute children keeps its height in Coherent GT until told `min-height: 0`

**Asked:** why, in the debugger, a refusal growing the start card pushed the standing figure down over the tab bar.

**Expected:** the figure's room to shrink from its top, as `flex: 1` does in a browser when a flex item's children are all out of flow, so the figure would stay put.

**Found:** in the SDK's CoherentGT Debugger, the room stayed 331px tall while its parent shrank to 170px, and it ran that far past its parent's foot.
With `min-height: 0` on the room it shrank to 189px, and the figure stayed where it was.
We first blamed `bottom` on an absolute SVG and wrote that into a comment; testing it showed `bottom` holds, so the comment and the box it justified came back out.

**Changed:** the figure's room has `min-h-0`.

**Affects:** [Coherent GT's layout](../architecture/coherent-gt.md#css).

## 2026-11-01: Coherent GT's canvas takes no pixels, so a figure drawn by rays can't reach the screen at any size above a head's, while the fold, its pin, and its masks all work

**Asked:** whether what the frames lean on draws in Coherent GT, now that the EFB app's sample runs there: the pilots' heads and figures, the pinned card, and the folds.

**Expected:** `putImageData` to work, since the frames' heads and figures use it in Chromium, and the pin and the masks to be the risk, which [the list of checks](decisions.md#stage-11b-checks-in-coherent-gt-what-the-frames-lean-on) names.

**Found:** in the SDK's CoherentGT Debugger, on the sample and on a canvas of each kind beside it:

- **Pixels:** `putImageData` draws nothing, from `createImageData` or `new ImageData` alike, and `drawImage` from another canvas draws nothing.
  `getImageData` throws `NotSupportedError`, and `toDataURL` returns an empty string.
- **What draws:** `fillRect` with a solid or alpha color, `clearRect`, paths, arcs, strokes, linear gradients, and a radial gradient with both circles at one center.
  A radial gradient with its inner circle off center drew nothing on a canvas, where a CSS `radial-gradient` and an SVG `radialGradient` drew it.
  Inset `box-shadow`s and `filter: blur()` draw too.
- **The cost of drawing by pixels:** 1,250 alpha pixels through `fillRect` took 2.2ms of JavaScript in the debugger, each pixel building its color string, so a 28px head at 1,000 pixels costs under 2ms a frame while it turns, and a figure 260px wide would cost tens of milliseconds.
- **The pin and the folds:** `position: -webkit-sticky` pins the session card in a box that scrolls, and a card's fold, through `-webkit-clip-path` and `-webkit-mask-image` set each frame, draws as the frames do, with the row's parts gliding by transforms.
- **Two claims we made while finding these were wrong:** a context taken before a canvas is sized draws, and a scrolling box's bottom padding counts toward its scroll, each tested once we doubted it.
- **No 3D context (user, 2026-11-01: "are you sure we can't live render 3d models?"):** `getContext` returns null for `webgl`, `experimental-webgl`, `webgl2`, and `experimental-webgl2`, `WebGLRenderingContext` and `OffscreenCanvas` aren't defined, and the engine names itself `CoherentGT/2.0` in its user agent.
  CSS's `preserve-3d`, `perspective`, and `rotate3d` parse, and we haven't looked at how they draw.
- **SVG strokes have no dashes:** `stroke-dasharray` and `stroke-dashoffset` change nothing, by attribute or style, so the countdown's ring stayed full, while a path's arc draws and redraws when its `d` changes.
- **Another clock:** a `requestAnimationFrame` timestamp read 2,104,645 where `performance.now()` read 1,171,353, so the heads, which compared the two, never nodded or glanced, and the sim's EFB showed them not following the cursor at all (user, 2026-11-01).

The user then tried the sample in the sim's EFB, which showed what the debugger's first pass had missed, each reproduced and fixed here: the start card clipping a refusal once a turn had run, since the turn's last timer was canceled with the render it caused; a band of what scrolled under showing above the pinned card; a click lost when the cursor crossed between a row's children, which every child of a pressable thing now ignores the mouse for; and the bottom fade missing until a first scroll, since nothing measured again once a font or a child's slice changed the page's height.

- **SVG against the tracer (p26):** with its gradients sampled from the tracer's own shading, a ball and nose in SVG match the traced head almost exactly at 180px and stay a little stepped at 44px, where four ways to smooth them failed: a hairline stroke, drawing larger and scaling down, a CSS ball, and a blur, whose least radius softens the whole picture.
  The whole figure matches closely too, once limbs draw behind the body's balls and a contact shadow is a gradient on a circle the size of its ball.

**Changed:** a head draws each of its pixels with a 1px `fillRect`, as a canvas pixel for each real pixel, and the countdown's ring redraws an arc each frame.
The standing figure and the portrait draw as SVG (user, 2026-11-01: "I hope this doesn't compromise on visuals", which is why heads stay traced).
A dropped pilot's head dims by mixing with its window, so its nose stays solid, and keeps inside the cone a watching head turns in (user, 2026-11-01).

What we haven't run: `fillRect`'s cost to the GPU in the sim's EFB, its rate in a flight, and the no-3D result in the sim's own documents.

**Affects:** `src/platform/efb-shell/src/heads/`, `src/platform/efb-shell/src/session/`, and the standing figure and the portrait.

## 2026-11-01: The EFB's document draws 15 frames a second at the world map, half the rate of the sim's other documents, so a quick click often lands between two frames

**Asked:** why a quick click on the kit's page in the sim showed no press, and why hover felt late (user, 2026-11-01).

**Expected:** our 150ms ease to be part of it, with the sim's share unknown.

**Found:** on MSFS 2024 1.9.21, at Free flight's world map, with p24's recorder in the EFB's document while the user clicked and swept the mouse for 15s:

- **The frame rate:** `requestAnimationFrame` ran every 66.6ms, the longest gap 69.6ms in 226 frames, and at another moment 66.7ms, while the world map's `atlas`, `mainUi`, and the toolbar ran every 33.3ms to 33.4ms.
  `GlassCockpitsRefreshRate` is at its highest, `Quality 2`, so that setting doesn't explain it, and we haven't changed it to see.
- **The presses:** mouse events arrived on a 33ms grid, each press held 33ms to 68ms.
  Of the 9 presses on a button, the down and the up fell inside one frame on 3, `:active` showed on a frame on 6, and the button had moved on a frame on 1, since the 1px nudge eased in over 150ms.
- **Hover:** a button's color took three frames to arrive, 68ms, 135ms, and 201ms after the mouse entered, through the same 150ms ease.

**Changed:** the kit holds a press itself, through `data-pressed`, for as long as the mouse does and 134ms at least, two of those frames, with the nudge instant.
A hover's color arrives and leaves at once, and a field's focus ring too, since a 150ms fade is about two of these frames and read as a late step (user, 2026-11-01).
In the debugger the quickest click, a down and an up posted with no wait, then showed for 95ms to 135ms, moved on every frame.
Every motion the frames draw runs at this rate in the EFB, so a 220ms ease is about three frames.

What we haven't run: the fix in the sim, which the user tries on the sample; the EFB's rate in a flight, which [the list of checks](decisions.md#stage-11b-checks-in-coherent-gt-what-the-frames-lean-on) holds; and the delay between a pilot's hand and the page's event, which the page can't see.

**Affects:** the kit, and the frames' motion in the EFB.

**Evidence:** `experiments/areas/interface/results/p24-efb-scale-press-2026-11-01-16-49-26.txt`.

## 2026-11-01: In the sim's own EFB, zoom lays out and hit-tests as in the debugger, the EFB's status bar covers the view's top 25px, and a picture taken with the sim's HDR on reads about twice too bright

**Asked:** whether `zoom` holds in the EFB's own document, with our app away from the document's corner, before any screen is built on it, since [p24 in the debugger](#2026-11-01-in-the-sdks-debugger-zoom-scales-a-page-with-sharp-text-and-its-layout-motion-scrolling-and-real-input-in-step-where-a-transform-blurs-its-text) couldn't show that.

**Expected:** the debugger's answers, with faded text the open question.

**Found:** on MSFS 2024 1.9.21, in a 1,844 by 1,316 window at Free flight's world map, the kit's page as an EFB app, registered and scaled by `src/platform/efb-shell`:

| Tablet size | `PanelSize` | The view | Scale | The root's layout |
| --- | --- | --- | --- | --- |
| Small | 447 by 667 | 447 by 632 | 0.866 | 516 by 729 |
| Medium | 537 by 799 | 537 by 759 | 1.041 | 516 by 729 |
| Large | 621 by 925 | 621 by 879 | 1.203 | 516 by 730 |

- **Zoom holds:** the view's shorter side over 516 gave the root the frames' width at every size, and `DualInput Geist` loaded from our package, a test string 230 units wide against 210 in `serif`.
- **A rect reads as the window's pixels over the zoom,** the root's left edge 81.96 for a view at 71 at 0.866, so a rect times the zoom is where the element is on screen.
  At Small, `elementFromPoint` there found the switch, the select, the field, and the slider, each itself.
- **The EFB's status bar sits over the view:** `div.status-bar`, 25px tall at Small, `z-index` 998, covers the view's top, and draws its notifications at the left and the date at the right, over whatever our page has there.
  It's about 29 of our units at each size, so our app has about 700 of them for its height, against the frames' 716.
  Presses fall through it to our page, except on its `notifications`, 25px by 15px.
- **HDR doubles a picture, not the page:** with the sim's HDR on, a picture read the whole window about twice too bright and clipped, the world map's buttons too, while our page's computed colors were right.
  With it off, the same picture matched our CSS within JPEG's noise:

  | Color | Our CSS | HDR on | HDR off |
  | --- | --- | --- | --- |
  | `secondary` | 38, 38, 38 | 76, 76, 76 | 38, 38, 38 |
  | `muted-foreground` | 161, 161, 161 | 255, 255, 255 | 160, 160, 158 |
  | `primary` | 116, 212, 255 | 213, 254, 255 | 121, 209, 255 |
  | `warning` | 241, 190, 77 | 255, 254, 148 | 244, 186, 86 |

  We first blamed the capture method and then the EFB's brightness setting; `SET_MANUAL_BRIGHTNESS` from 0.1 to 1 changed no pixel of a picture here, and the user found it was HDR (user, 2026-11-01).

**Changed:** [the app fits its view with `zoom`](decisions.md#the-efb-app-fits-its-view-with-zoom-on-its-root), and the shell starts below the status bar.
A probe that reads color from a picture needs the sim's HDR off, which `experiments/tools/shot.mjs` says.

What we haven't run: a pilot's real presses under `zoom`, which the user does on the sample; faded text in the sim, since a picture is scaled down too far to show it; what `zoom` costs a frame; and what a pilot's screen shows with HDR on, since only a picture read too bright.

**Affects:** the EFB shell ([the frames' height](decisions.md#the-efb-app-fits-its-view-with-zoom-on-its-root)).

**Evidence:** `experiments/areas/interface/results/p24-efb-scale-efb-2026-11-01-16-27-54.txt`, and in `p24-efb-scale-efb-pictures/`, the EFB cropped from the sim's window at Small and Large with HDR on, and at Small with it off.

## 2026-11-01: In the SDK's debugger, zoom scales a page with sharp text and its layout, motion, scrolling, and real input in step, where a transform blurs its text

**Asked:** how one number should fit the EFB app to its view, since [p21](#2026-10-30-in-landscape-an-efb-apps-view-is-its-portrait-view-turned-on-its-side-about-696-by-433-in-the-efbs-own-units-against-468-by-660) found that view 456px to 632px wide at the tablet's three sizes in one window, and the frames are drawn 516 wide.
The kit's sizes and the frames' motion both depend on the answer (user, 2026-11-01: "what for?", answered as fitting the app to any tablet).

**Expected:** a transform to do it most cheaply, and `calc()` around a variable, which is how `efb_os.css` sizes itself, to be the fallback.
We expected nothing of `zoom`.

**Found:** in a copy of the SDK's CoherentGT Debugger, with no run yet in the sim's EFB, p24 drew the same card three ways at scales of 0.72, 0.884, 1.056, and 1.225:

- **A transform blurs:** the engine draws text at its unscaled size and resamples it, so a card under `transform: scale()` reads doubled at every one of the four.
- **`zoom` and `calc()` both draw sharp text**, and wrap words alike at each scale.
- **`zoom` keeps every number in frame units.** With `zoom` on a root at 0.884 and at 1.225, in the units of the root:
  - `offsetLeft`, `offsetWidth`, `getBoundingClientRect()`, computed `left`, and `scrollTop` all read about what the CSS wrote, within a unit, so a 50px box reads 49 or 50.
  - `translateX(50px)` moved a box 50 units, so 61px on screen at 1.225, and `-webkit-sticky` stuck 10 units from its scroller's top, with `scrollTop` set to 60.
  - Hit testing takes the window's pixels: `elementFromPoint` found a box at 125 units at 125 times the zoom.
  - A real click and a real wheel posted to the window reached the right element, and `clientX` read in the window's pixels, 111 for a box's middle at 125 units at 0.884.
- **The kit agrees:** every live component of the kit's page, its select, popover, confirm, dialog, and toasts, took real clicks at 1, 0.884, and 1.225, with each popup against its anchor.
- **A line under 1px vanishes:** at a zoom below 1, a 1px height and a 1px `box-shadow` spread both round down to nothing, while a border keeps its pixel.
  So the kit's hairlines are borders, and its root sets `--hair`, the length of one real pixel at its scale, which `ring-1` takes.
- **`width: max-content` comes out short under `border-box`,** by the box's padding: 115px where the words and padding take 139px.
  An absolute box with its width left alone gave 139px, and took `max-width`.
- **A rounded button cuts what it holds:** a link's underline, a border on an inline span inside a `<button>` with a 10px radius and a height of 20px, stopped about 3.5px short at each end, though the span's rect was the button's full width and the button's `overflow` read `visible`.
  With no radius on the button, the line ran the word's whole width.
- **`text-underline-offset` is dropped,** and a plain underline hugs the letters, so a link's underline is a border on an inline element, which sits at the foot of the font's own box and takes no room from the line.
- **Faded text can glitch at any scale:** text inside an element with `opacity` below 1 lost its bottom edge at some positions under `zoom` at 0.72, and at the same scale drew a ghost line above it under `calc()`, and in a column at 1:1 with no scaling.
  The same three columns at 1.225 drew clean, so it doesn't follow from `zoom`; we don't know what it does follow from, and whether the sim's own build of the engine does it.
- **A WebSocket from a page in the debugger** to a server on 127.0.0.1 connected and echoed, as the development loop needs to reach a bench core.
- **The picture is flaky:** `PrintWindow` came back all white about half the time just after input was posted to the window, at any zoom and with `calc()` alike, 7 of 10 under `zoom` and 7 of 12 under `calc()`, so a white picture says nothing about the page.
  Taking it again a moment later gives the page.

**Changed:** [the kit fits its root with `zoom`](decisions.md#the-efb-app-fits-its-view-with-zoom-on-its-root), and every size in the frames carries over unchanged.
What we haven't run: any of this in the sim's EFB, whose engine is another build ([p22](#2026-11-01-the-sdks-coherentgt-debugger-runs-our-pages-in-coherent-gt-with-no-sim-and-matches-the-sims-efb-on-1159-of-p14s-1170-css-items-and-on-repeated-work-in-a-loaded-page)), and what `zoom` costs a frame.

**Affects:** the kit, the EFB shell, and the frames' motion, which reads offsets and scrolls in frame units; [Coherent GT's JavaScript and CSS](../architecture/coherent-gt.md#css).

**Evidence:** in `experiments/areas/interface/results/`, `p24-efb-scale-2026-11-01-15-17-29.txt` and its picture of the three ways, the `p24-efb-scale-zoom-*` files, and the three `p24-efb-scale-opacity-*` pictures. The white pictures from narrowing down the flaky one are left out.

## 2026-11-01: React 19 runs in the EFB's own document and takes a pilot's real click, wheel, and typing, and on a card-sized change it stays within 0.1ms of FSComponent

**Asked:** FSComponent's components don't re-render, so would the frames' motion turn into a mess there, and would bundling React be worth it instead (user, 2026-11-01)?
The frames' motion is mostly not the trouble, since their per-frame work is already direct DOM.
What they lean on is content that changes shape: across 8,370 lines they hold 148 `useState` calls, 137 effects, about 116 conditional blocks, and 65 lists, and `@microsoft/msfs-sdk` 2.3.3 has neither conditional rendering nor a keyed list (read in its `msfssdk.d.ts`).

**Expected:** React to run, since the Synaptic A220 ships `react-dom` 19.2.7 with `createRoot` (read in synaptic-aircraft-a220 1.0.11, `CTP/instrument.js`), and to cost visibly more than FSComponent, with Preact the lighter choice.

**Found:** on MSFS 2024 1.9.21, p23 built one DOM with each framework and ran one harness on it:

- **React in the EFB's own document:** registered through the EFB API with one FSComponent host element, it took the pilot's real input.
  One click reached its handler and opened a room to its measured height, the wheel scrolled a list, and focus and blur reached the field's handlers.
  Typing abc into a controlled field gave the changes `a`, `ab`, and `abc` in order, with state, field, and mirror all `abc`, using the field the kit's rule describes ([the kit follows what the sim gives an EFB app](decisions.md#the-kit-follows-what-the-sim-gives-an-efb-app)).
- **The checks:** React and FSComponent each passed all 11 of the harness's, in the debugger and in the EFB's document, among them a click, a keyed reverse that keeps its elements, a conditional part, and a room that measures after it renders.
- **Preact 11.1.1 fails as shipped:** it calls `queueMicrotask`, which Coherent GT lacks, so clicks and typing stopped updating state and 3 of its 11 checks failed in the debugger.
  The Coherent GT check named it before the run.
  We didn't try a polyfill, and we didn't run Preact in the EFB.
- **The bundle:** React and React DOM minify to 196.0 KB, 61.8 KB gzipped, and pass the Coherent GT check with no findings.
  FSComponent's page is 7.5 KB there, since it draws with the EFB's own `msfssdk`.
- **Speed:** in the EFB's own document at Free flight's world map, with no flight loaded, the sim in front for all 6 pages, and the sim keeping 1.31 to 1.73 cores busy, in milliseconds, as JavaScript + forced layout, the median of the later bursts inside 3 loads of each page.
  A median of an even count is the higher middle value:

  | What | React 19.2.7 | FSComponent |
  | --- | --- | --- |
  | Parse and first run, each load | 1.7 to 1.9 | 0.5 to 0.8 |
  | Mounting the page's shell, once | 12.5 to 13.3 | 1 to 1.2 |
  | 29-element part mounted in a 168-element card | 0.2 + 0.8 | 0.2 + 0.8 |
  | That part removed | 0.2 + 0.1 | 0.1 + 0.1 |
  | One row of 1,000 updated | 0.5 + 0.5 | 0 + 0.4 |
  | All 1,000 rows updated | 5.5 + 51 | 4 + 50.3 |
  | 1,000 rows created | 9.8 + 90.8 | 25.4 + 94.1 |
  | 1,000 rows reversed | 24.2 + 73.8 | 21.2 + 74.8 |
  | 1,000 rows cleared | 20 + 0.1 | 18.4 + 0.2 |

  In each load's first burst, before the engine warmed up, 1,000 rows took React 45.1 to 46.8ms of JavaScript and FSComponent 25.7 to 27.9ms.
  Layout outweighs either framework's JavaScript on everything but clearing, and is the same under both.
  The debugger gave the same picture with no sim, within about 3ms on most operations, and its FSComponent page bundled 28.4 KB of the framework.
- **A window in front empties layout:** in a round the user discarded, with another window in front, the app's room and the first load's rows measured 0px and forced layout took about 0.1ms, so a timing there can miss layout altogether.
  p23 now runs a page again if another window comes to the front during it.

**Changed:** the user moved the kit from FSComponent to React the same day ([the kit's decision](decisions.md#the-apps-draw-with-a-kit-of-our-own-components-styled-with-tailwind-3)), and the EFB app touches the framework only to register ([the framework](decisions.md#the-efb-app-touches-the-framework-only-to-register-through-the-efbs-own-copy)).

**Left open:**

- The same times under a flight's load.
  p22's 1,000 rows read 29ms of JavaScript inside one page in the EFB under a heavy flight, against FSComponent's 25.4ms here, so we expect little change (inference); a run in a flight settles it.
- Text from the sim's own keyboard, `SetInputTextFromOS`, which never came in this run.
- How the code reads in each, which timing can't show: `app-fsc.tsx` holds the small layer of kept rows and hand-mounted parts we'd own, on a page far simpler than the frames.

**Affects:** the notes atop [decision 028](../../decisions/028-desktop-pages-react-vite-tailwind.md), [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md), [the apps](01-apps.md), [the spine](../architecture/01-spine.md), and [the code map](../architecture/02-code-map.md); and [the banner's decision](decisions.md#the-banner-draws-with-react-and-the-kit), which the user moved to React too.

**Evidence:** [the probe](../../../experiments/areas/interface/p23-page-frameworks/p23-page-frameworks.mjs), [its run in the debugger](../../../experiments/areas/interface/results/p23-page-frameworks-debugger-2026-11-01-14-17-28.txt), [its run in the EFB](../../../experiments/areas/interface/results/p23-page-frameworks-efb-2026-11-01-14-44-45.txt), and [a screenshot of the app](../../../experiments/areas/interface/results/p23-page-frameworks-2026-11-01-14-42-50/01-react-in-efb.jpg).
The real input came from a run moments before the timed one, in the same load of the EFB, and the app kept it; that run's timings were lost when the inspector refused a connection before the report saved.

## 2026-11-01: The SDK's CoherentGT Debugger runs our pages in Coherent GT with no sim, and matches the sim's EFB on 1,159 of p14's 1,170 CSS items and on repeated work in a loaded page

**Asked:** can we develop pages for Coherent GT with quick reloads in an environment that mimics the sim (user, 2026-11-01), since a browser draws what the engine drops ([the Coherent GT check](decisions.md#the-coherent-gt-check-covers-the-css-we-ship-into-the-sim)), and reloading the real app in the sim needs the sim running?

**Expected:** no prediction: we had used the SDK's CoherentGT Debugger, the debugger from here on, only to read the sim's inspector.

**Found:** on MSFS 2024 1.9.21, with the debugger of SDK 1.7.3 and 1.8.1, whose `.dll` and `.exe` files are identical:

- **It's a host of its own:** `Tools\CoherentGT Debugger\Debugger.exe` draws `coui://html/debugger.html` from the `html` folder beside it, with the engine in its `assembly` folder.
  That page's address bar sets a frame's `src`.
  p22 replaces the page in a copy of the folder with frames of our pages from 127.0.0.1, which run with no sim.
- **It's another build of the engine:** every engine file but the three ICU ones differs from the sim's, such as `CoherentGTCore.dll` at 28,304,896 bytes against the sim's 30,513,152, though both report `CoherentGT/2.0`.
  SDK 1.8.1 is the newest for this sim as of 2026-11-01, so no update closes the gap.
- **The sim's engine doesn't run in it:** with the sim's 8 files, `Debugger.exe` exited with 0xC0000005 inside `CoherentUIGT.dll` 2.9.5.0.
  With the sim's files and the SDK's `CoherentUIGT.dll`, it loaded no page in 90s.
- **CSS and layout:** on p14's catalog, the debugger gave the answers the sim's EFB document gave on 2026-10-25 for 1,159 of 1,170 items, all 81 layout cases among them.
  - The sim keeps two properties the debugger drops: `-webkit-tap-highlight-color` and `touch-action`.
  - The debugger keeps four selectors the sim drops: `:future`, `:past`, `::cue`, and `::cue()`.
  - Five hover and pointer media queries differ: the sim reports no hover and no fine pointer, and the debugger reports both.
  - Against the sim's `mainUi` and toolbar documents, 1,156 are the same.
    Three more differ there and not in the EFB's document: two media queries on the frame's shape, and one layout case on `box-sizing`, which we take to be those documents' own stylesheets (unverified).
- **JavaScript:** a frame in the debugger and a frame in the EFB's document agree on 24 of 25 features, `TouchEvent` being the one only the EFB's has.
  Neither has `PointerEvent`, `ResizeObserver`, `IntersectionObserver`, `globalThis`, `Promise.prototype.finally`, `Coherent`, `engine`, or `SimVar`.
  p18's 10 checks pass in both.
- **Speed:** p18's 1,000 rows, in one flight the user loaded as a heavy one, which we didn't record, in milliseconds.
  A median of an even count is the higher middle value:

  | Where and how | The sim's window | First | Later, each run's median | Later, range |
  | --- | --- | --- | --- | --- |
  | Debugger, page reloaded | No sim | 48.4 | 47.2 | 46.7 to 56.7 |
  | Debugger, page reloaded | Behind the debugger | 65.8, 69.3, 87.1 | 72.7, 72.8, 82.4 | 62.4 to 90.6 |
  | EFB, page reloaded | Behind another window | 48.9, 55.2, 60.6 | 110.2, 111.1, 114.1 | 98.2 to 138.8 |
  | EFB, page reloaded | In front | 53.2 | 103.7 | 102.8 to 111.2 |
  | EFB, a new frame each load | Behind another window | 54.1, 58 | 87.4, 91.1 | 78.3 to 171.5 |
  | EFB, a new frame each load | In front | 54.1 | 101 | 86 to 132.3 |
  | EFB, repeated inside one page | Behind another window | 54.8 | 28.8 | 19.1 to 42.8 |
  | EFB, repeated inside one page | In front | 54.1 | 29 | 20 to 35.4 |
  | Debugger, repeated inside one page | Behind the debugger | 66.1, 66.4 | 28.2, 35.9 | 22.9 to 54.4 |

  - The sim kept 3.5 to 4.6 cores busy at the median of every run that logged it, in front or behind, so it doesn't ease off behind another window, and that window made no consistent difference to the EFB's times.
  - An EFB app at the world map took 51.3ms for its one load ([p19](#2026-10-25-inside-an-efb-app-clicks-the-wheel-hover-focus-and-typing-reach-our-elements-and-a-127001-frame-as-mouse-and-keyboard-events-geist-loads-as-ttf-but-not-woff2-and-p18s-page-renders-there-with-tailwind-3)), close to the first loads here.

**Changed:** a copy of the debugger can stand in for the sim while we develop the kit, for layout, CSS, and the speed of work inside a loaded page, even with the sim running.
A frame there has no sim globals, which the kit's pages need none of, since [they use no framework but React](decisions.md#the-efb-app-touches-the-framework-only-to-register-through-the-efbs-own-copy).
What needs the sim still needs it: `Coherent` calls, the EFB's own styles, and the last check.
A time taken in the EFB after repeated loads reads 3 to 4 times what the same work takes once a page has run it a few times, so a timing there should load once and measure inside that page.
Stage 11b's design of the kit's development loop decides whether to use it.

We don't know why later loads in the EFB run up to twice as long as its first, or what layout and paint cost in either host, since the timed stretch builds page elements and forces no layout.
Every EFB time here comes from an off screen frame in the EFB's document, not from an EFB app.
What the debugger's `--webdriver` switch does, a string in `Debugger.exe`, is unknown.

**Affects:** how stage 11b builds the kit's development loop ([build plan](../build/plan.md#11b-the-apps)).

**Evidence:** in `results/`, `p22-sdk-coherent-host-engine-2026-11-01-09-57-20.txt` with its screenshot and p14's answers, `p22-sdk-coherent-host-features-2026-11-01-09-57-26.txt`, the three `p22-sdk-coherent-host-loads-2026-11-01-*.txt`, the two `p22-sdk-coherent-host-burst-2026-11-01-*.txt`, and `p22-sdk-coherent-host-before-the-probe-2026-11-01.txt`, which holds the runs with the sim in front, the run with no sim, and the engine swaps.

## 2026-10-30: In landscape, an EFB app's view is its portrait view turned on its side, about 696 by 433 in the EFB's own units against 468 by 660

**Asked:** what an EFB app's page gets when the pilot turns the EFB to landscape, at each of its sizes, since stage 11b's EFB app frames are drawn at a fixed 516 by 716, in portrait only (user, 2026-10-30).

**Expected:** from the EFB's code, a layout that turns with the EFB's window: portrait when the window is no wider than tall, sized from a 516 by 716 base, and landscape from a 716 by 516 one, with the app area published as `window.PanelSize` and the orientation as `window.PanelInfo.orientation` (read in fs-base-efb 0.1.10, `efb_os.js`, `sizeUpdate`).
The orientation setting applies only to the 2D EFB, not popped out.

**Found:** on MSFS 2024, at Free flight's world map in a 1,874 by 1,316 window, p21 sent the EFB's own setting events, `SET_2D_ORIENTATION` and `SET_2D_SIZE`, from its document, and the EFB took every one, with the Settings app open:

| Orientation | Size | The EFB's window | `PanelSize` | The app's view, `efb-view` | Scale, `--panel-width` over `--base-width` |
| --- | --- | --- | --- | --- | --- |
| Vertical | Small | 598 by 793 | 456 by 679 | 456 by 644 | 504 / 516 |
| Vertical | Medium | 695 by 928 | 545 by 810 | 545 by 770 | 601 / 516 |
| Vertical | Large | 790 by 1,060 | 632 by 940 | 632 by 893 | 696 / 516 |
| Horizontal | Small | 793 by 598 | 679 by 456 | 679 by 421 | 699 / 716 |
| Horizontal | Medium | 928 by 695 | 810 by 545 | 810 by 505 | 834 / 716 |
| Horizontal | Large | 1,060 by 790 | 940 by 632 | 940 by 585 | 966 / 716 |

- **Landscape turns portrait on its side:** at each size, the window and `PanelSize` swap width and height, and the scale stays the same, about 0.98 at Small, 1.16 at Medium, and 1.35 at Large.
- **In the EFB's own units**, a pixel count divided by that scale, which is how `efb_os.css` sizes everything, an app's view is about 468 by 660 in portrait and 696 by 433 in landscape, at every size.
  The rest of `PanelSize` is the dock under the view, 35px tall at Small and 47px at Large.
- **The pilot's switch** is in the Settings app's General section: Tablet size, with Small, Medium, and Large, and Tablet orientation, with Vertical and Horizontal.
  The sim's own Settings app keeps its type size in landscape and lays its rows out wider, with fewer on screen.
- **`efb_os.css`'s media queries** match on the EFB's window: `orientation: landscape` in each Horizontal layout, and `max-height: 716px` at Horizontal Small and Medium, whose windows are 598px and 695px tall; `max-width: 516px` matched none of the six.
- **What an app hears:** each change fired three or four `resize` events on the window, an orientation change passing through a square 790 by 790 window, and then `PanelSize`'s width and height changed, 8ms to 16ms after the last `resize`.
  `PanelInfo.orientation` changed once, at the turn to Horizontal.
- **The screenshots** came from the sim's window drawing itself, through `PrintWindow` with `PW_RENDERFULLCONTENT`, with the sim behind other windows, after Windows refused to bring it forward for the probe.

**Changed:** an EFB app's page is narrower and shorter than 516 by 716: about 468 by 660 in the EFB's units in portrait, and 696 by 433 in landscape, which the pilot can choose at any size.
So an app that reads its size from `PanelSize`, or from its own box after the last `resize`, and has a layout for each shape, fits every setting the EFB offers.
What our EFB app's frames do in landscape is for stage 11b's design.

What we haven't run: an EFB app of ours in landscape, the EFB popped out, the tablet in a cockpit, and any other window size, so whether the EFB's window keeps to about 60%, 70%, and 80% of the sim window's height at the three sizes is unverified.

**Affects:** the EFB app's frames, which [stage 11b](../build/plan.md#11b-the-apps) designs.

**Evidence:** `results/p21-efb-landscape-2026-10-30-17-36-53.txt`, with a screenshot of each layout, cropped to the EFB; `results/p21-efb-landscape-2026-10-30-17-32-58.txt`, the run before, measured the same sizes and saved no screenshots.
## 2026-10-25: The SDK as npm ships it loads in a browser once four of the sim's globals have stand-ins

**Asked:** can the UI import `@microsoft/msfs-sdk` the usual way and still run outside the sim, for development in a browser and tests, rather than taking FSComponent's modules apart from the package as p18's modules variant does ([entry below](#2026-10-25-fscomponent-runs-in-edge-when-a-bundle-takes-only-the-sdk-modules-it-needs-in-81-kb-while-the-sdk-as-npm-ships-it-throws-on-load-outside-the-sim))?
The user prefers the usual import, since a new developer knows it (user, 2026-10-25).

**Expected:** a few stand-ins, since the first load error named one global, `SimVar`.

**Found:** adding a stand-in for each global the load next failed on took four: `SimVar`, `RunwayDesignator`, `Avionics`, and `BaseInstrument`.
Each stand-in is a function whose every property is another stand-in, so the SDK's top-level code can assign to it, read from it, and extend it.
With them defined before the bundle, the SDK's 2,466 KB npm build loaded in headless Edge 156 and passed all 10 of p18's checks, and without them it threw before any ran.

**Changed:** the UI can import the SDK as npm ships it, and a page or test outside the sim defines the four stand-ins first.
A stand-in answers any call with nothing, so code that reads the sim gets no data outside it, and outside the sim we need only the UI's rendering.

**Affects:** the apps' [tentative decisions](decisions.md), and how stage 11b builds the apps ([build plan](../build/plan.md#11b-the-apps)).

**Evidence:** `results/p18-fscomponent-2026-10-25-14-34-47.txt`.

## 2026-10-25: The EFB's document can't make Go to's requests on the world map, and no add-on's script runs in the toolbar's there, so an EFB app's Go to still needs the menu script

**Asked:** can code in the EFB's document choose the world map's departure airport and stand, as Go to needs, so an EFB app could run Go to without the menu script our copy of BlurPage brings in ([decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md))?
The user is weighing a Dual Input whose only window is its EFB app (user, 2026-10-25).

**Expected:** yes for the stand, since the [2026-10-05 entry](#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight) says the request selected one from "the document of Atlas, the EFB's map app".

**Found:** p20 made each request from one document at Free flight's world map of MSFS 2024, and read the departure back from the store in `mainUi`, the menu's document, across three runs:

| Document | Has | Airport, by the search | Airport, by its world location | Stand, by `requestData` |
| --- | --- | --- | --- | --- |
| `mainUi` | `engine` and the store | chosen in 203ms to 330ms | not tried | chosen in 30ms and 101ms |
| The toolbar's, `Global/Panel.html` | `engine` and the store | no answer in 4s | chosen in 205ms | chosen in 30ms and 100ms |
| The world map's `Global/atlas.html` | `engine` and the store | no answer in 4s | not tried | chosen in 24ms and 103ms |
| The EFB's, `efb_ui.html` | `engine`, `Coherent`, and `common.js`, no store | no answer in 4s, sent bare or through a `RegisterViewListener` of its own | no change, sent with `engine.trigger` | `engine.call` rejected; `engine.trigger` changed nothing |

- **The EFB's `engine.call` rejected `requestData`:** `NoSuchMethod: requestData not bound. Call engine.trigger instead of engine.call if you do not bind nor need the result.`, and the same request sent with `engine.trigger` changed nothing in 3s.
- **The airport search answers only `mainUi`.**
  The other route, `requestData` on `game/worldmap/worldLocations/fromICAO` with KPDX, then on `game/currentFlight/setFreeflightDeparture` with the location's `uID`, 4452, chose KPDX from the toolbar's document.
- **The 2026-10-05 entry's "Atlas, the EFB's map app" was the world map's own atlas page**, `Global/atlas.html`, whose title is `atlas`: it has `engine` and the store, as the EFB's document doesn't.
- **At the world map, the toolbar's document had loaded only the sim's own 14 scripts**, with ChasePlane installed, whose worker its toolbar icon loads there in flight ([2026-10-04 entry](#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).
  So the way our banner's icon brings a script into the toolbar's document doesn't put one where Go to happens.

**Changed:** an EFB app can't make Go to's requests itself, so its Go to button works as any client's does: it sends `go-to`'s command, and the core runs the world map's requests through the menu script, which our copy of BlurPage brings into `mainUi` ([Go to](../session/02-units.md#go-to)).
So a Dual Input whose only window is its EFB app keeps BlurPage and [decision 003](../../decisions/003-watcher-keeps-blurpage-copy-current.md).
The menu script may also choose the airport by its world location rather than through the search, which needs no listener.

**Affects:** the apps' [tentative decisions](decisions.md), and Go to in [the v1 scope](../product/03-v1-scope.md#preflight).

**Evidence:** `results/p20-efb-go-to-2026-10-25-13-36-25.txt`, the run with every route, and `results/p20-efb-go-to-2026-10-25-13-32-29.txt`, `-13-33-42.txt`, and `-13-35-05.txt`, the three before it.

## 2026-10-25: Inside an EFB app, clicks, the wheel, hover, focus, and typing reach our elements and a 127.0.0.1 frame as mouse and keyboard events, Geist loads as TTF but not WOFF2, and p18's page renders there with Tailwind 3

**Asked:** what an EFB app of ours gets from the pilot's mouse and keyboard, which font files it can load, and whether p18's page, FSComponent from the SDK's own modules, renders inside an app, for the one front end the user is weighing ([entry below](#2026-10-25-fscomponent-runs-in-edge-when-a-bundle-takes-only-the-sdk-modules-it-needs-in-81-kb-while-the-sdk-as-npm-ships-it-throws-on-load-outside-the-sim)).

**Expected:** that a plain input wouldn't take typing, since the EFB's own text box cancels the press, focuses its input itself, and asks the sim for the keyboard with `Coherent.trigger("FOCUS_INPUT_FIELD", {...})` (read in MSFS 2024's `efb_os.js`, the text box's `onmousedown` and `onFocusIn`), as Fenix's EFB app's does (read in fnx-aircraft-320 2.4.0.4720, `FenixSimEfbApp.js`).

**Found:** at the world map of MSFS 2024, p19 ran three times.
The first put a panel into the EFB's document from outside, appended to its body over the app area, and the mouse's moves and wheel reached it but no press did: every `mousedown` and `click` landed on the EFB's own app tiles, so no field took focus and the keys went to `BODY`.
The other two ran inside an EFB app of ours, `Dual Input P19`, which p19's `build.mjs` packages, where every step passed:

| Step | What arrived |
| --- | --- |
| Click a box | `mousedown`, `mouseup`, and `click` on the box |
| Wheel over a list with `overflow-y: auto` | `wheel` events, and the list scrolled 648px |
| Click a plain input and type abc | `focus`, then `keydown`, `keypress`, and `input` for each key: "abc", with no call to the sim |
| Click an input focused the EFB's way and type abc | the same, with `FOCUS_INPUT_FIELD` on focus and `UNFOCUS_INPUT_FIELD` on blur |
| Click a box in a frame from 127.0.0.1 | `mousedown`, `mouseup`, and `click` in the frame |
| Click the frame's input and type abc | "abc", after the frame posted `FOCUS` to the app, which called the trigger's five-argument form, as Fenix's frame does |

- **Mouse events only:** `PointerEvent` is undefined, and no touch event came, though `TouchEvent` exists.
- **Keys carry `keyCode` and `charCode`:** `key` is null, so A comes as `keyCode` 65 on `keydown` and 97 on `keypress`.
- **`:hover` applies:** the box's background under the mouse read `rgb(42, 134, 182)`, its `:hover` color.
- **The EFB loads no app's CSS:** each app adds its own link at install, as CIVA's does through efb_api's `loadCss` (read in MSFS 2024's `WTCivaApp.js`), and the second run, without one, drew everything unstyled.
- **Fonts:** Geist Regular's TTF drew from the package's `coui://` path, from 127.0.0.1, and as a `data:` URL, and its WOFF2 drew from none, by each line's width against the monospace it falls back to.
- **p18's page inside the app:** all 10 of its checks passed, beside the EFB's own copy of the SDK, and its Tailwind 3 CSS, scoped to `#dualinput-p18` and without Tailwind's reset, drew the cards, the chips, the primary button, and the bound bar, but no borders, since the reset is what sets `border-style`.
- **Colors** read brighter in the screenshots than their hex, because the sim runs in HDR on our development machine (user, 2026-10-25).

**Changed:** one front end on FSComponent and Tailwind 3 can be an EFB app, if its kit listens for mouse events and reads keys by `keyCode`, the app links its own CSS, its fonts ship as TTF, and the kit carries a reset scoped to its own root.
A plain input takes typing, but whether the sim also acted on those keys we didn't see, so a text field should ask for the keyboard the way the EFB's own does.
A frame from 127.0.0.1 inside an app also gets the pilot's input, so an app could still show a page the core serves, as Fenix's and Navigraph's apps show theirs.

**Affects:** the apps' [tentative decisions](decisions.md), and how stage 11b builds the apps ([build plan](../build/plan.md#11b-the-apps)).

**Evidence:** `results/p19-efb-input-2026-10-25-11-59-33.txt` (the panel from outside), `results/p19-efb-input-2026-10-25-12-22-00.txt` (the app, unstyled), and `results/p19-efb-input-2026-10-25-12-28-43.txt` with its screenshot of p18's page in the app.

## 2026-10-25: FSComponent runs in Edge when a bundle takes only the SDK modules it needs, in 81 KB, while the SDK as npm ships it throws on load outside the sim

**Asked:** can a front end on the MSFS Avionics Framework also be the desktop app's, whose window WebView2 draws ([decision 028](../../decisions/028-desktop-pages-react-vite-tailwind.md)), so the EFB app, the banner, and the desktop window show one bundle?

**Expected:** yes, since FSComponent only builds DOM nodes, though `@microsoft/msfs-sdk` is one 4 MB module for the sim's instruments.

**Found:** p18 built one small app with FSComponent, `Subject`, `MappedSubject`, and `ArraySubject` from `@microsoft/msfs-sdk` 2.3.3, at ES2017 with Tailwind 3 tuned as p17 tuned it, two ways, and opened each in headless Edge 156, the engine WebView2 embeds:

| Build | Bundle | Of it, the SDK | Coherent GT check | In Edge |
| --- | --- | --- | --- | --- |
| The SDK's `msfssdk.js`, as npm ships it | 2,466 KB | 2,455 KB | no findings | throws on load: `ReferenceError: SimVar is not defined` |
| 16 of the SDK's own modules, from the package's source map | 94 KB | 81 KB | no findings | all 10 of the page's checks pass |

- **The npm build throws** because its top-level code assigns `SimVar.GetSimVarValue`, and esbuild keeps 2.4 MB of it, since one module's top-level statements can't be shaken apart.
- **The source map carries all 459 modules** as compiled ES modules, `../build/components/FSComponent.js` among them, and with a `package.json` marking them free of side effects, esbuild kept the 16 the app reaches, which name none of `SimVar`, `Coherent`, and `BaseInstrument`.
- **The checks that pass:** text bound to a `MappedSubject` follows a click, a class bound to a subject follows it, a class record and a style record bind, a list driven by an `ArraySubject` adds and removes rows in order, typing reaches a subject and a subject reaches the field, and 1,000 rows render in 19.6ms and clear.
- **FSComponent has no `onClick`:** it sets every JSX prop with `setAttribute`, so a component listens through a ref after it renders (read in `msfssdk.js`, `FSComponent.buildComponent`).
- **A binding outlives its element:** FSComponent keeps no handle on the subscription a bound prop makes, so a removed element bound to a subject that lives on still updates, and holds memory until the subject goes.

**Changed:** one bundle can run in the sim and in the desktop window if it imports the SDK's modules rather than its npm build, and a kit on it writes its own list component and its own event handling, and ties each binding to its component's life.
Where the kit gets those modules, from the package's source map or from the [mirror's source](https://github.com/microsoft/msfs-avionics-mirror), is open, as is the user's choice of a front end.
The same page in Coherent GT waits on p19, which shows it in the EFB.

**Affects:** the apps' [tentative decisions](decisions.md), and how stage 11b builds the apps ([build plan](../build/plan.md#11b-the-apps)).

**Evidence:** `results/p18-fscomponent-2026-10-25-11-33-44.txt`.

## 2026-10-25: By p14's measurements, Coherent GT keeps 82% of Tailwind 3's output with its colors written as rgba() and autoprefixer's -webkit- twins, and every common variant but focus-visible and has

**Asked:** can Tailwind 3 style one front end that the EFB, the banner, and the desktop app's window all show, since Tailwind 4's output draws nothing in Coherent GT ([architecture log](../architecture/log.md#2026-10-25-coherent-gt-keeps-304-of-the-554-css-properties-chromium-152-keeps-and-lays-out-flexbox-and-grid-as-chromium-does-but-for-gap-justify-content-end-and-subgrid))?
The user is weighing that one front end, on the MSFS Avionics Framework, against the two the apps' design has: shadcn's on the desktop and a kit of our own in the sim (user, 2026-10-25).

**Expected:** most of it kept, since Working Title's CIVA app ships Tailwind-made CSS in the sim (read in workingtitle-instruments-civa 1.1.0, `WTCivaApp.css`), and Tailwind 3 compiles its layers away.

**Found:** with no sim, p17 built Tailwind 3.4.19, then autoprefixer 10.6.1 for Chrome 49 and Safari 10, and graded every declaration against p14's results from MSFS 2024's main menu, counting a value the engine parses and ignores in layout, such as `gap`, as dropped:

| Build | Declarations | Kept | Covered by a kept `-webkit-` twin | Dropped | Untested |
| --- | --- | --- | --- | --- | --- |
| Every utility, through a safelist of everything | 28,327 | 22,400 | 704 | 4,890 | 333 |
| shadcn Nova's components, unported | 759 | 597 | 4 | 141 | 17 |

- **Colors:** Tailwind 3 writes a hex color as `rgb()` with spaces and a slash, which the engine drops, so the config writes each color as `rgba(var(--primary-rgb), <alpha-value>)`, and `bg-primary/80` comes out as `rgba(var(--primary-rgb), 0.8)`, which it keeps.
- **Autoprefixer** turned 576 dropped declarations into covered ones, such as `user-select` beside `-webkit-user-select` and `text-decoration-line` beside its `-webkit-` form, so `select-none` and `underline` work.
- **Dropped utilities fall in about 25 families:** the logical ones (`ps-`, `me-`, `start-`, `border-s-`, `rounded-e-`); `gap-`, `gap-x-`, and `gap-y-`; `inset-`; `aspect-`; `backdrop-`; `accent-` and `caret-`; the `scroll-` margins, paddings, and snaps; `overscroll-`; `contain-`; `decoration-` thickness, color, and style; `underline-offset-`; `text-wrap` and `text-balance`; `h-dvh` and the other new viewport units; `sticky`; `flow-root`; `contents`; `grid-cols-subgrid`; `overflow-clip`; and `touch-none`.
- **Variants:** `hover`, `focus`, `focus-within`, `active`, `disabled`, `checked`, `first`, `last`, `odd`, `even`, `group-hover`, `peer-checked`, `before`, `after`, `aria-*`, `data-[...]`, `supports-[...]`, `motion-safe`, `motion-reduce`, the breakpoints, `print`, `portrait`, `landscape`, and `*` are kept.
  `focus-visible`, `has-[...]`, `marker`, `dark`, `contrast-more`, `forced-colors`, `rtl`, and `ltr` are dropped, the last two for the `:where()` they write; `file` is untested.
- **Nova's classes:** of its 558 class names, Tailwind 3 builds 354, and the 204 it doesn't know are Tailwind 4's own syntax: bare data variants such as `data-open:`, `has-data-*`, `in-data-*`, `not-*`, `**:`, a custom property as `p-(--card-spacing)`, `ring-3`, `outline-hidden`, `rounded-4xl`, and container queries.
  Of what it builds, the 141 dropped declarations are mostly `:has()`, `:focus-visible`, `gap`, `dark:`, `min()`, and `inset`.

**Changed:** Tailwind 3 can style a page in the sim if the config writes colors as `rgba()` around a triplet, autoprefixer adds the `-webkit-` twins, and the Coherent GT check fails the dropped families, which `space-x-`, `space-y-`, and `top-0 left-0` replace.
Porting Nova to it rewrites much of each component's class list, since 37% of Nova's class names are Tailwind 4's syntax and much of its state styling rests on `:has()` and `:focus-visible`.
Both read the engine's parse and layout, not its paint, and the user's choice of a front end is still open.

**Affects:** the apps' [tentative decisions](decisions.md), and how stage 11b builds the apps ([build plan](../build/plan.md#11b-the-apps)).

**Evidence:** `results/p17-tailwind3-2026-10-25-11-05-39.txt` and `.json`.

## 2026-10-24: The apps' wiring calls notices notifications, gives the banner's socket a slice of its own, and passes a development core's data folder to the desktop app

**Asked:** what the names and behaviors [stage 11a](../build/plan.md#11a-the-apps-wiring)'s wiring needs, and the record leaves open, should be: the message crate's names, where the slice that says whether a banner page's socket is open goes, what the core passes the desktop app's program, how the bench sees that start, and what a click does when its notice has cleared or no EFB app is connected.

**Expected:** the answers we proposed, which the user took, adding two of their own: the rename, and the pause in the time before an app hides a notification.
One of ours, a slice of its own for the banner's socket, departs from [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md#what-a-unit-registers-and-calls), which has the notifications' slice say it.

**Found:** the user's calls, on 2026-10-24:

- Notices are called notifications, in the code and in the record, as "a lot more understandable".
- The message crate names the EFB app's component `efb-app` and the banner's `banner`, the commands `clients.notification-clicked` and `clients.bring-desktop-forward`, and the order `EfbAppOrder`, whose one value is `{ "t": "open-efb" }`.
- Whether a banner page's socket is open is a slice of `clients`' own, `banner`, rather than part of the notifications' slice.
  Its one reader we know of, the EFB app's code that calls the toolbar until the banner connects, has no need of the notifications.
- The core starts `dualinput-desktop.exe` with `--data <folder>` when it runs on a data folder other than the pilot's, and with no argument otherwise, so the EFB app's button, on a development core, opens the desktop app on that core's data folder.
- A notification's unit can clear it while the pilot's click is on its way, and the click still opens the EFB, since the pilot asked to look.
  An app that hides a notification after a time pauses that time while the pointer is over it, so the notification stays as the pilot reaches for it.
- With no EFB app connected, a click's command is still taken, and the log says no EFB app got the order.
  A failed start of the desktop app's program goes to the run's log, since the command is answered before the start.
- The bench copies a stand-in program beside the bench core as `dualinput-desktop.exe`, which writes down each start's arguments.

**Changed:** the code and the record say notification, and stage 11a builds the rest.

**Affects:** [02-clients-and-panel-bridge](../core/02-clients-and-panel-bridge.md)'s notifications, which its note of 2026-10-24 amends; [01-apps](01-apps.md)' notifications and bringing the desktop app forward.

## 2026-10-24: The sim's EFB styles its apps' controls through `--efb-` variables sized from a 516 by 716 base, and an app gets the controls by bundling the SDK's EFB API

**Asked:** what the sim's own EFB stylesheet defines that Dual Input's EFB app and banner could reuse (user, 2026-10-24)?

**Expected:** no prediction.

**Found:** in the sim's files on disk, on our Steam install, with no sim running:

- `steamapps\common\Limitless\Packages\fs-base-efb` 0.1.10 holds the EFB's document, `html_ui/efb_ui/efb_os/efb_ui.html`, its stylesheet `efb_os.css`, 3,280 lines, and its fonts.
- `efb_os.css` defines 71 custom properties and reads them 691 times.
  The theme is the `--efb-` ones, such as `--efb-primary-color: #00b4ff`, `--efb-button-primary-base: 19, 144, 227`, `--efb-button-important-base: 255, 222, 3`, `--efb-button-emergency-background: 236, 64, 64`, `--efb-full-page-background: 30, 40, 54`, `--efb-border-radius: 0px`, and `--efb-component-transition-delay: 0.18s`.
  Most colors are RGB triplets, read as `rgba(var(--efb-button-primary-base), 1)`.
- Every size is written for a 516 by 716 page and scaled to the EFB's, as `calc(10px * var(--panel-width) / var(--base-width, 516))`, and its 67 `@media` rules switch on `max-height: 716px`, `max-width: 516px`, and `orientation: landscape`.
- Its 23 `@font-face` rules declare Roboto and Roboto Mono from TTF files in the package, one family for each weight, such as `Roboto-Regular`, `Roboto-Medium`, `Roboto-Bold`, and `RobotoMono-Regular`, and its text falls back to Meiryo UI, Noto Sans SC, and Malgun for Japanese, Chinese, and Korean.
- Its rules style the EFB's own controls by class: notifications (48 rules), tooltips, the status bar, buttons, text boxes, sliders, paging, circular progress, tabs, dropdowns, steppers, panels, tags, the dock, search, switches, scroll bars, text areas, accordions, timers, lists, and progress bars.
- An app gets those controls by bundling them: A2A's tablet app defines `_Button`, `_AbstractButton`, `_DropdownButton`, `_IconButton`, and more, and puts out the `abstract-button` class `efb_os.css` styles (read in a2a-aircraft-pa24 2.1.3, `A2ATabletAppComanche250.js`).
  The SDK ships them as the EFB API, in the samples' `PackageSources\efb_api` folder, which an app installs with `npm install` (documented, [the EFB API](https://docs.flightsimulator.com/msfs2024/retail/programming-apis/efb/electronic-flight-bag-api/)); no npm package publishes it, and our SDK 1.7.3 install has no samples.
- What the sim's own CSS uses, it can draw: custom properties with fallbacks, `calc()` around `var()`, flexbox, grid with `grid-gap`, `gap`, and media queries on size and orientation.
  It uses no `hsl()`, `oklch()`, `color-mix()`, `rem`, `vh`, `@supports`, or `@keyframes`, so those stay for p13 to measure.
  p13 found `gap` dropped, which `efb_os.css` never writes ([architecture log](../architecture/log.md#2026-10-25-coherent-gt-drops-layer-oklch-color-mix-and-every-gap-but-grid-gap-so-tailwind-4s-output-cant-style-a-page-there)).
- The sim's menus and in-game panels have a theme of their own, 201 custom properties in `fs-base-ui` 0.1.10's `html_ui/SCSS/common.css`, such as `--color-yellow: #FFD300`, `--primaryColor`, `--accentColor`, and `--filterBlur`.

**Changed:** our EFB app can build on the EFB API's controls and look like the sim's own apps, styled by `efb_os.css` with nothing of ours, and our hand-written CSS can read the `--efb-` variables and the sim's Roboto faces.
The banner runs in a page of its own, outside the EFB's document, so it gets neither unless its page links `efb_os.css` itself, which no run has tried.
Whether Dual Input takes the sim's look or one of its own is the user's to decide.

**Affects:** the apps' look, which stage 11b designs ([build plan](../build/plan.md#11b-the-apps)), and [decision 029](../../decisions/029-in-sim-interface-on-msfs-avionics-framework.md)'s pinned copy of the framework, which the EFB API's controls would have to work with.

**Evidence:** the files above, read on our development machine on 2026-10-24; their contents are Asobo's and A2A's, so none is copied into the tree.

## 2026-10-09: Installed from the Community folder, our toolbar script loads at the flight load, and it and our EFB app's code each open the banner when the client asks over the CommBus

**Asked:** does the toolbar script run outside a Build and Mount, and open the banner's panel after a flight loads and when a session starts mid-flight; and can our EFB app's code open it instead ([architecture plan](../architecture/plan.md#15-a-flight-with-dual-inputs-rust-pieces), node 1.5)?
The answer decides whether the toolbar script is one of Dual Input's components at all.

**Expected:** no prediction: the toolbar script had run only after a Build and Mount ([entry below](#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click)).

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the A2A PA-24 parked, in architecture's probe p08, with two packages in the Community folder before the sim started, and no Build and Mount:

- `crosscheck-p08-banner` held p05's panel as the Project Editor compiled it on 2026-10-04, and a toolbar icon that loads `p08-toolbar.js` into the toolbar's document.
- `crosscheck-p08-efb` held one EFB app whose code listens on the CommBus.

Both scripts, asked by p08's client over the CommBus, call `TOOLBAR_BUTTON_TOGGLE` for the panel and answer the client over the CommBus.

- The toolbar script was running in the flight's toolbar document, having loaded about when `FLIGHT_START` and `RTC_START` came, 58s before Ready to fly.
  It took the CommBus through `ADD_VIEW_LISTENER`, because neither `RegisterCommBusListener` nor `RegisterViewListenerT` with `Coherent` was defined when it loaded, and `Coherent.call` worked when it later opened the panel.
  Whether it loaded in the main menu's toolbar the run can't say, because the client's call there came before the sim's open reply.
- The EFB app's code loaded while the main menu loaded its aircraft, took the CommBus through the sim's `Services/CommBus.js`, and answered each call.
  It answered "ready" twice, 0.1s apart, and which two listeners sent them is unverified.
- 177s after Ready to fly, and again 279s after, each script called `TOOLBAR_BUTTON_TOGGLE`, and each call resolved.
  The toolbar's own record listed the panel `Detached`, and the inspector listed the panel's page.
  Asked to close it, each script closed the panel, and the inspector stopped listing the page.
- Screenshots after three of the four openings show p05's pre-flight card at the left of the screen.
  Before the first one was taken, the user had clicked the card's Start flying, which hides it.

**Changed:** our package opens the banner from code, with no Build and Mount, after a flight load and mid-flight, from the toolbar script or from the EFB app's code, so either can be the component that opens it.

What we haven't run: opening the panel during the load, between `FLIGHT_START` and Ready to fly; a second flight load in the same run of the sim; and the toolbar script in the main menu.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner), whose open question asks whether the toolbar script opens the panel at every flight load; node 1.5 of the architecture plan; and the toolbar script's row in the spine's [components](../architecture/01-spine.md#components).

**Evidence:** `experiments/areas/architecture/results/p08-flight-2026-10-09-17-12-31.txt`, `.ndjson`, and a folder of screenshots.

## 2026-10-08: A page's WebSocket stays open after the page is gone, and the CommBus reaches every page we use in the menu and every cockpit panel

**Asked:** what the [entry below](#2026-10-08-every-page-we-use-reaches-the-core-by-websocket-and-by-the-commbus-but-the-menus-page-cant-read-an-l-variable-and-a-flight-load-resets-one) left unmeasured that node 1.2's answer leans on: whether a page's WebSocket closes when the page goes away; the CommBus handshake in the main menu and in every cockpit panel, and from a page that asks before its listener reports ready; and whether Node's own WebSocket client sends an `Origin`, which decides whether the core's check on it lets our apps in.

**Expected:** a page's socket closing with the page, as a browser closes a page's sockets when it unloads.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, with crosscheck-p13-links installed, p15 started at the main menu, ran in the A2A PA-24 parked, then watched the pilot leave for the main menu:

- None of the 18 sockets the probe watched closed: no close frame came and no connection ended.
  - `VCockpit37 - GNS_DISABLED`'s stayed open for the 23s left in the run after the panel ran `location.reload()`.
  - All 16 cockpit panels' were still open when the run ended, 11s after the prompt to leave the flight, as the inspector stopped listing cockpit panels; the sim sent `FLIGHT_END` and `BACK_TO_MAIN_MENU` 4s after the prompt.
  - Our banner panel's stayed open for the 35s left after the toolbar's page toggled the panel closed, which destroyed its page in an [earlier run](#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page); this run didn't check that the page was gone.
- Node v22.23.1's built-in WebSocket sent no `Origin`, and its socket sent a close frame and ended as soon as it closed.
  p16, run the same day with no sim, found no `Origin` from Electron 43.4.0, whose Node is 24.18.1, run as Node and as its main process.
- In the main menu, 13 of the 14 pages heard the probe's CommBus calls, 12 of 12, and reached its subscription, and "transition" again couldn't call `COMM_BUS_SIMCONNECT_CALLBACK`.
  mainUi, the toolbar, and the EFB were among the 13: the toolbar has no `Coherent` in the menu, so it took the calls as mainUi does, and the EFB loaded the sim's `Services/CommBus.js` first.
- In the flight, 29 of 31 pages did both, all 16 cockpit panels among them, each hearing 12 or 13 calls.
  The toolbar heard 13, but its listener still hadn't reported ready when the probe read it, about 7s after it registered, and the one call it made 1.5s in never reached the probe or settled; in p14 its listener reported ready, and its call arrived.
  The pages that called before ready through `engine`, as mainUi does, all reached the probe but "transition".

**Changed:**

- The core can't take a socket's close to mean its page went away, so it has to hear from each page and close a socket that falls silent.
- A page can't count on calling the core over the CommBus, while every page we use heard the core's calls, so the core announces itself to pages rather than waiting for them to ask.
- An app that connects through Node's or Electron's built-in WebSocket passes an `Origin` check that lets through a connection with none.

What we haven't run: how long the sim keeps a socket open after its page is gone, past 35s.

**Affects:** node 1.2's answer in [01-spine](../architecture/01-spine.md#communication); and the foundations chapter [06-04](../../learn/foundations/06-04-websockets-to-localhost.md), which expects a socket to drop when its document reloads.

**Evidence:** `results/p15-links-coverage-2026-10-08-14-54-27.txt` and `.ndjson`, and `results/p16-client-origin-2026-10-08-15-13-38.txt`.

## 2026-10-08: Every page we use reaches the core by WebSocket and by the CommBus, but the menu's page can't read an `L:` variable, and a flight load resets one

**Asked:** node 1.2.1 of the [architecture plan](../architecture/plan.md#121-links-from-the-sims-pages): can each kind of page our components run in read an `L:` variable the core writes and hold a WebSocket to the core, and what do sockets in every cockpit panel cost in frame time?
The design under test has the core announce its port in an `L:` variable, and a cockpit panel connect only while a session flag is 1 (user, 2026-10-08).
After the first run found the menu's page couldn't read the variable, we also asked whether a page can ask the core for its port over the CommBus and hear the answer.

**Expected:** a WebSocket from every page, since the EFB's, the toolbar's, a cockpit panel's, and two of Parallel 42's in-game panels held one ([entry below](#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)); an `L:` read wherever the sim's `simvar.js` loads; and no frame time we could measure.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the A2A PA-24 parked, with crosscheck-p13-links, one in-game panel of ours, installed, p13 and p14 ran their code in every page through the inspector:

- All 14 pages the inspector listed in the main menu, and all 32 in the flight, opened a WebSocket to the probe on 127.0.0.1 and got its echo, mainUi, our panel, the toolbar, the EFB, and the PA-24's 16 cockpit panels among them.
  Every one sent `Origin: coui://html_ui`.
- `SimConnect_SetDataOnSimObject` wrote `L:CROSSCHECK_P13_PORT` in the main menu, and SimConnect read it back.
  After a flight loaded, the same read returned 0, and a write in the flight held for the rest of the run.
- Where a page could read the variable, `SimVar.GetSimVarValue` and the sim's native `simvar.getValue` read the same value:

  | Page | In the main menu | In the flight |
  | --- | --- | --- |
  | mainUi | Can't: no `SimVar`, `simvar`, or `Coherent` | Can't |
  | The toolbar | Can't, for the same reason | Reads it |
  | The EFB | Reads it | Reads it |
  | Our in-game panel | Not open | Reads it |
  | The 16 cockpit panels | None loaded | Read it |
  | atlas, notifications, transition, Mission Steps, Shared variables | Can't | Can't |

- Pollers in the 16 cockpit panels, reading `L:CROSSCHECK_P13_SESSION` every 500ms, connected 36ms to 547ms after the probe wrote 1, in four tries over the two p13 runs, and closed their sockets when it wrote 0.
- With the frame rate capped at 30 fps, every 10s window read 31.0 fps, so the cap hid any cost.
  Uncapped, at about 83 fps, the two windows with nothing of ours read 12.25ms and 12.07ms a frame.
  The pollers alone, and 16 sockets idle, renewed every 2s, or taking 30 messages a second each, read 12.00ms to 12.07ms.
  All 11,653 messages the probe sent arrived and parsed.
- In the flight, p13 and p14 tried the CommBus in the 16 pages that aren't cockpit panels and in one cockpit panel.
  A page's call to `COMM_BUS_SIMCONNECT_CALLBACK` reached the probe's `SimConnect_SubscribeToCommBusEvent` subscription from each of them but "transition", which answered "COMM_BUS_SIMCONNECT_CALLBACK not bound. Call engine.trigger instead of engine.call if you do not bind nor need the result."
  mainUi made the call with `engine.call`.
- The probe's `SimConnect_CallCommBusEvent` for JavaScript reached each of the same pages but "transition", 12 calls of 12, by one of two routes:
  - `RegisterCommBusListener`, in the pages that have the sim's `common.js`, after loading the sim's `Services/CommBus.js` where the page hadn't, as in the toolbar and our panel;
  - `EVENT_FROM_VIEW_LISTENER` for `JS_LISTENER_COMM_BUS`, in mainUi and the other pages without `Coherent`, once the page triggered `ADD_VIEW_LISTENER`, which is how mainUi's own view listeners take events (read in fs-base-ui 0.1.10, `html_ui/Global/lib.js`, `ViewListenerMgr`).
    No call arrived as an event of its own name, which is all p13's first try listened for, so that try heard nothing in those pages.

**Changed:**

- An `L:` variable can't carry the core's port: the menu's page can't read one, and a flight load resets it.
- The CommBus can, in every page we tried: a page asks the core on it and hears the answer.
  A page would then learn the port with no fixed port and no value a load resets, and a core that isn't a SimConnect client of the pilot's sim, such as a development core with a stand-in sim, has no way to answer on that sim's CommBus.
  Which way node 1.2 takes is for its answer.
- Sockets in every cockpit panel, and pollers reading a variable every 500ms, cost no frame time this run could measure.
- Any `L:` variable the core relies on has to be written again after each flight load.

What this entry didn't run, the CommBus in the main menu and in the other 15 cockpit panels, and a page asking before its listener reports ready, the [entry above](#2026-10-08-a-pages-websocket-stays-open-after-the-page-is-gone-and-the-commbus-reaches-every-page-we-use-in-the-menu-and-every-cockpit-panel) ran.
Nobody has run an aircraft with many more cockpit panels than the PA-24's 16.

**Affects:** node 1.2 of the [architecture plan](../architecture/plan.md#12-communication); the foundations chapters [03-01](../../learn/foundations/03-01-units-and-variables.md), on how long an `L:` value lasts, [04-01](../../learn/foundations/04-01-connection-and-data.md) and [05-02](../../learn/foundations/05-02-simconnect-and-the-commbus.md), on SimConnect and the CommBus, and [06-04](../../learn/foundations/06-04-websockets-to-localhost.md), on the `Origin`; and the per-lever hold flags in [soft takeover](../product/ideas.md#soft-takeover-on-handover).

**Evidence:** `results/p13-sim-links-2026-10-08-13-39-22` (the menu, the flight load, and the capped frame time), `results/p13-sim-links-2026-10-08-13-54-50` (the flight, the first CommBus try, and the uncapped frame time), and `results/p14-commbus-pages-2026-10-08-14-05-05`, each `.txt` and `.ndjson`.

## 2026-10-06: Code in the menu's document tells which page is up, and nothing we found takes the menu home without the sim in front

**Asked:** a Join that starts wherever the pilot is needs to know which page is up, and on a page outside its path, could it first bring the menu home?

**Expected:** the page components on screen name the page, and `SHOW_WORLDMAP_HOMEPAGE`, the flow event the start screen's Start button sends (read in fs-base-ui 0.1.10, `html_ui/Global/pkg/base.bundle.js`, `StartPageManipulator.setButtons`), might take the menu home from any page.
A flow event is the sim's own: the menu's code sends one by name to the native state machine that decides which screen comes next, with `engine.trigger("LAUNCH_FLOW_EVENT_FROM_VIEW", ...)` (read in `html_ui/Global/lib.js`, `LaunchFlowEvent`).

**Found:** on MSFS 2024 SunRise 12.2.282174.999, through the inspector in mainUi, standing in for our script there ([entry below](#2026-10-06-our-copy-of-blurpage-brings-our-script-into-the-menu-from-the-first-screen-and-from-there-it-runs-the-whole-join-to-ready-to-fly)):

- The master page tells the main menu from a flight: `MasterPage` in the menu, and `MasterPage_InGame` in a flight, with `MasterPage_Pause` on top while the pause menu is open.
- The large page components on screen name the page: `Startpage`, `Homepage`, `FreeFlightPage` for the world map, `OptionsPage` for Settings, `InstallPage` for the first-boot setup, and `Career_ConfirmationPage` for Ready to fly.
- `SHOW_WORLDMAP_HOMEPAGE`, sent as the Start button sends it, left the main menu's Settings and the pause menu's as they were for 10s.
- The menu has no Home button: its bar holds profile, notifications, settings, the marketplace, communications, and friends.
  Its back is the input action `KEY_MENU_SR_BACK`, whose button in the menu's input bar has a callback that leaves it to the sim (read in `base.bundle.js` and `lib.js`), and SimConnect refused `MENU_SR_BACK` and `KEY_MENU_SR_BACK` with `NAME_UNRECOGNIZED`.
- Escape, pressed into the sim's window after our code brought it to the front, took Settings to the home page in one press.

**Changed:** a Join can read where the pilot is, and on a page outside its path it shows the pilot an error rather than trying to get home: Escape works only with the sim in front, which is too fragile to count on (user, 2026-10-06).
A part of the core that knows where the sim is, which features read, is proposed in [the plan](../product/plan.md)'s step 7.

**Affects:** the idea [the PF's spot on the world map](../product/ideas.md#the-pfs-spot-on-the-world-map).

**Evidence:** `results/p12-menu-navigate.ndjson`; the back and Escape tests ran from scratch scripts, with no run file.

## 2026-10-06: Our copy of BlurPage brings our script into the menu from the first screen, and from there it runs the whole join to Ready to fly

**Asked:** p07 and p08 set the world map through the inspector ([entry below](#2026-10-05-code-in-the-menus-document-sets-the-world-maps-departure-stand-aircraft-and-livery-and-starts-the-flight)).
Can a package of ours put that code into the menu's documents, which was unverified for ours ([entry below](#2026-10-05-a-package-reaches-the-menus-document-by-shipping-its-own-copy-of-one-of-the-sims-ui-components))?
And from a closed sim, can that code run the whole join: Start, Free flight, the departure, stand, aircraft, and livery, Fly, and Ready to fly ([the plan](../product/plan.md)'s step 6)?

**Expected:** our toolbar icon's script, since the toolbar's document is one of the world map's documents with the store (same entry); if not, our own copy of one of the sim's UI components, as Flow Pro ships.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, with crosscheck-p10-menu, whose script polls p10 on 127.0.0.1 and runs the steps p10 sends, as Dual Input's core would:

- In the menu, the toolbar's document draws no panel buttons, so on the first visit our icon's script loaded nowhere.
  It loaded during a flight and stayed in the toolbar's document back in the menu, but there the airport search answered nothing, sent as it was or after the script registered the search's listener itself.
- Our EFB app runs in the menu ([entry below](#2026-10-06-our-efb-apps-own-code-opens-the-efb-onto-it-wherever-it-sits-in-a-crowded-efb-and-runs-while-the-efb-is-closed)), but the EFB's document isn't allowed the world map's requests: `engine.call` refused `requestData` and `requestArrayElements` with "NoSuchMethod: requestData not bound", and `engine.trigger("requestData", ...)` changed nothing, while the same request from the toolbar's document changed the aircraft.
- No script in the menu can read a UI component: an XHR for `coui://cookedcomps/` errored, and the inspector listed none among mainUi's resources.
  The sim's own copies are files in its install folder, `Packages/fs-base-ui/cookedcomps/{GUID}.html` and `.json`, under `steamapps/common/Limitless` on Steam, and Flow Pro's copy of the start page has older element ids than the sim's today, so a copy shipped once falls behind the sim's updates.
- Our copy of MenuBarPage, `{37E4C836-61EF-469A-BDF6-DB44BAAE15B5}`, made from the stock file with a hidden `<svg><foreignObject><img src onerror>` before its last closing tag, as Flow Pro's has, put our script into mainUi on the first menu visit, and the script set KSEA, the stand PARKING 294 -- RAMP GA MEDIUM, and the Baron 58P in 1,747ms.
  In the run before, a minute earlier, the airport search answered nothing, for a reason we didn't find.
- p11 listed every component mainUi loads: 21 on the start screen, 18 of them also on the home page and the world map.
  None is a divider, spacer, or decoration of its own, since those are plain elements inside components.
  BlurPage, `{8B92BB9A-4176-4F1A-A9CE-CB1195C4E952}`, is the smallest: 973 bytes, with a 142-byte `.json` and no animations, exposed children, or states, placed by MasterPage itself.
  The only Community package that copies any of the 18 is Flow Pro, with the start page and the shortcut block.
- With only our copy of BlurPage installed, p10 ran the whole join from a closed sim, with nobody at it:

  | From the launch | Step |
  | --- | --- |
  | 0s | Steam asked to start the sim |
  | 132.1s | our script in mainUi, with the start screen up |
  | 133.0s | pressed Start |
  | 134.4s | pressed Free flight, on the home page |
  | 141.5s | KSEA, PARKING 294 -- RAMP GA MEDIUM, the Baron 58P, and its livery N515MR |
  | 142.2s | `launchFlight` |
  | 142.4s | `FlightLoaded` |
  | 163.9s | the Ready to fly button up |
  | 164.5s | pressed Ready to fly, and `RTC_END` at once |

  The loaded flight's `TITLE` was "Black Square Baron 58P Professional N515MR".
- Our script pressed each button with mouse events at its center, found by the names its page exposes, as the menu's own code finds them: the start page's `Button_Start`, the home page's `Tiles` and their `FreeflightButton`, and `Career_ConfirmationPage`'s `ReadyButton`, the career page that free flight reuses for Ready to fly.
  Element names mislead: on the start screen the element named `TileButton_Start` is Accessibility, and a press by that name opened the first-boot accessibility setup.
- After Ready to fly, the sim put the pilot in walkaround mode beside the aircraft, its default; an option to start in the cockpit may exist (unverified).

**Changed:**

- Dual Input's way into the menu is a copy of BlurPage, because it's the smallest component loaded from the first screen and the plainest, with nothing a mod would change (user, 2026-10-06).
- The core makes the copy on the pilot's machine from the sim's own file, at install, at each start, and before it launches the sim, whenever the stock file's hash differs from the one the copy was made from, so the copy never falls behind a sim update.
- There's no fallback: if BlurPage is gone, no longer placed by MasterPage, or copied by another package, the core writes no copy, and a button that needs the menu, such as Go to, is unavailable and says why, until we pick another component deliberately (user, 2026-10-06).
- A Join starts from wherever the pilot is, so it reads where the sim is, takes the next step from there, confirms each step arrived, and shows the pilot an error when a step fails or the page is one it doesn't know (user, 2026-10-06; [entry above](#2026-10-06-code-in-the-menus-document-tells-which-page-is-up-and-nothing-we-found-takes-the-menu-home-without-the-sim-in-front)).
  Ready to fly is the flight's start, not a seat in the cockpit.
- Loading a pilot's flight for them stays out of v1 ([03-v1-scope](../product/03-v1-scope.md#preflight)).

What we haven't run: the Microsoft Store edition, whose install folder may not be readable; whether a sim update can change `fs-base-ui` while the sim boots, after the core's check; and a Join from anywhere but a closed sim.

**Affects:** [preflight](../product/03-v1-scope.md#preflight)'s Go to button, and the idea [the PF's spot on the world map](../product/ideas.md#the-pfs-spot-on-the-world-map).

**Evidence:**

- The toolbar's script: `results/p10-menu-package-2026-10-06-17-55-26` and `-18-20-50`.
- The MenuBarPage copy: `-18-33-40` and `-18-34-11`.
- The press by element name: `-18-48-39.ndjson`.
- The join to `FlightLoaded`, with two copies: `-18-56-13`.
- The BlurPage join: `-19-37-47`, and the Ready to fly press, `results/p10-ready-2026-10-06-19-11-16`.
- The component list: `results/p11-menu-components-2026-10-06-19-28-51.txt` and the three `.json` beside it.

The EFB's document and the XHR were tried from scratch scripts, with no run file.

## 2026-10-06: Our EFB app's own code opens the EFB onto it, wherever it sits in a crowded EFB, and runs while the EFB is closed

**Asked:** a click on a notification opens our EFB app ([entry below](#2026-10-04-a-click-on-a-notice-in-our-panel-opens-the-efb-onto-another-app-whether-the-efb-was-open-or-closed)), but that chain ran from a stand-in put into the EFB's document through the inspector, pressing GSX's button on the dock.
Does it work when our app is on neither the dock nor the first page of the app list, and does the app's own code run while the EFB is closed ([the plan](../product/plan.md)'s step 6)?

**Expected:** the EFB's document opens an app when it hears `OPEN_BY_KEY(app, page, args)` (read in fs-base-efb, `html_ui/efb_ui/efb_os/efb_os.js`), and the sim's `engine.trigger` calls the document's own handlers before it reaches the sim (read in mainUi's `coui://html_UI/JS/AsoboCoherent.js`), so our app's code could fire it.

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the Baron 58P, with crosscheck-p09-efb: one app of ours, "ZZ Dual Input P09", and 48 filler apps, each registered with `window.EFB_API.use` in the shape of the EFB API's App and AppView (read in fsdreamteam-gsx-efb, `GSX_EFB.js.map`, efb_api 1.0.3), with p09 playing the core over HTTP on 127.0.0.1:

- The EFB installed our 49 among 61 apps in all, and drew our app nowhere in its document, while "Filler 01" was there.
- Our app's code ran from the sim's start, in the menu and in the flight, and polled every 333ms with the EFB closed and never opened.
- Our app's own code ran `Coherent.call("TOGGLE_EFB")` if the EFB was closed, then `engine.trigger("OPEN_BY_KEY", "ZzCrosscheckP09", "", "")`, and the EFB opened onto our app from each state:
  - closed and never opened: the app's view reported onOpen and onResume 640ms after p09 sent the steps;
  - open on another app: onResume after 385ms;
  - closed after use, with our app still the EFB's current one: the view got the page key and showed, with no onResume, since closing the EFB doesn't pause the app on screen.
- The view drew black, because our app never loaded its stylesheet, as Navigraph's does in `install()`.

**Changed:** a click on a notification opens Dual Input's EFB app wherever the app sits in the EFB, from the app's own code, with no button to find and no list to page through.
The click reaches the app through the core, and an EFB app loaded the sim's way reaches the core on 127.0.0.1 by HTTP, as code in the EFB's document did ([entry below](#2026-10-05-an-efb-app-the-toolbar-and-in-game-panels-each-reach-a-program-on-the-same-pc-by-websocket-and-http-and-can-show-a-page-it-serves)).

**Affects:** the [EFB app](../product/03-v1-scope.md#efb-app) and the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** `results/p09-crowded-efb-2026-10-06-18-17-46`, `.txt`, `.ndjson`, and a folder of screenshots.

## 2026-10-05: Code in the menu's document sets the world map's departure, stand, aircraft, and livery, and starts the flight

**Asked:** can anything outside the sim set the world map's departure ([the plan](../product/plan.md)'s step 6), which decides whether [the PF's spot on the world map](../product/ideas.md#the-pfs-spot-on-the-world-map) is in v1?
Then the aircraft, its livery, and Fly.

**Expected:** none of SimConnect's documented functions sets the world map, and no add-on we know sets a stand.
The world map's own code makes each change as a request to its store: picking a stand sends `Et.game.currentFlight.setDepartureTaxiIndex.request(`${taxi.ID}`)`, and the store's `request()` is `engine.call("requestData", path, arg)` (read in fs-base-ui 0.1.10, `html_ui/Global/pkg/base.bundle.js`, `FreeflightPlanCombobox`, and `html_ui/Global/lib.js`, `GlobalDataListener.request`).

**Found:** on MSFS 2024 SunRise 12.2.282174.999, from Free flight's world map, with code the inspector ran in the menu's document, `mainUi`, which has `engine` and the store but no `Coherent`:

- The departure airport: the airport search's events, sent as `engine.trigger("EVENT_TO_VIEW_LISTENER", "JS_LISTENER_AIRPORT_SEARCH", "AIRPORT_INPUT_TEXT", <uid>, "KSEA", "ON_DEPARTURE_AIRPORT_SELECTED")`, came back as `ResultsUpdated` with 4 results, and `ON_DEPARTURE_AIRPORT_SELECTED` with the result's index and database set KSEA in 553ms, with its 145 stands and 6 runways in `game/currentFlight/gameFlight/departure`.
- The stand: `game/currentFlight/setDepartureTaxiIndex` with the stand's `ID`, not its place in the list, selected GATE N 17 in 28ms.
  The same request from the document of Atlas, the EFB's map app, then selected PARKING 140 in 36ms.
  8 of the world map's 14 documents have `engine` and the store, the toolbar's among them, and the EFB's has `engine` but not the store.
- After Fly, the flight file's `[Departure]` read `GateName=PARKING; GateNumber=140`, and the aircraft stood at a cargo ramp.
- The aircraft: `game/aircraft/configurator/setAircraftForConfigurator` with `"<aircraftId>||<variationIndex>"`, taken from `game/aircraft/aircraftList`, changed `game/aircraft/currentAircraft` from the A380 to the A220-300 within 1s, and the world map showed the A220.
  The list is read the way the world map's list fetcher reads it: `requestArrayElements` answers with its length, 138, and each entry is at `game/aircraft/aircraftList/<index>`.
- The livery: `game/aircraft/configurator/saveVariationId` with an id from `game/aircraft/configurator/liveries`, 12 for the A220, set Air Canada's.
- Fly: `game/currentFlight/launchFlight` with `""` started the flight, with `FlightLoaded` 0.7s later, and SimConnect then read `TITLE` "A220-300" and `LIVERY NAME` "Air Canada A220-300", at KSEA gate N 17.
- With no departure set, `launchFlight` brought up the sim's "Unexpected error" dialog, "You cannot launch this flight and enter the sim.", and Start flight stays disabled.
- The search results reached p07, which listened on both `ResultsUpdated` and `EVENT_FROM_VIEW_LISTENER`, and not p08's first version, which listened on `ResultsUpdated` alone, so they come through `EVENT_FROM_VIEW_LISTENER`, or both.

**Changed:** Dual Input can put a joining pilot at the PF's airport and stand, in the PF's aircraft and livery, and start the flight, from a script in the menu's document.
Flow Pro clicks the menu's Start and Free Flight buttons on this machine, so the path from the sim starting to Ready to fly could run with no clicks, which nobody has run as one chain; it gets probed and scoped when the feature is built (user, 2026-10-05).

**Affects:** [the PF's spot on the world map](../product/ideas.md#the-pfs-spot-on-the-world-map).

**Evidence:** `results/p07-world-map-2026-10-05-18-02-58` and `results/p08-world-map-aircraft-2026-10-05-19-29-24` (no departure), `-19-31-33` (the aircraft and livery), and `-19-32-47` (the whole chain), each `.txt`, `.ndjson`, and a folder of screenshots.

## 2026-10-05: A package reaches the menu's document by shipping its own copy of one of the sim's UI components

**Asked:** p07 and p08 ran through the inspector, which we won't ship on, so how would a script of ours get into the menu's document?

**Expected:** a DevSupport moderator wrote on 2025-03-12 that MSFS 2024 can't override the base sim's HTML ([thread](https://devsupport.flightsimulator.com/t/can-html-instruments-be-overridden-as-per-the-docs-in-msfs-2024/13488)), though our `VCockpit.js` override works ([02-01-installs-and-packages](../../learn/foundations/02-01-installs-and-packages.md)).

**Found:** no sim ran:

- Flow Pro ships `cookedcomps/{3A799C8C-BED8-48DE-B7D4-D30472668E33}.html`, which is fs-base-ui's start page component, 2,666 bytes there and 3,128 in Flow Pro's.
  Flow Pro's copy is the stock markup plus a hidden `<svg><foreignObject><img src onerror="…">`, whose handler appends a script from Flow Pro's `InGamePanels` folder to the document's `<head>`, the trick [our toolbar icon](#2026-10-04-our-toolbar-icon-loads-a-script-of-ours-into-the-toolbars-document-and-it-opens-our-panel-with-no-click) uses (read in p42-util-flow-pro 26.33.5).
- It copies three more of fs-base-ui's components the same way: a nameplate, a HUD waypoint, and a shortcut button.
- The user has seen Flow Pro click the menu's Start and Free Flight buttons and select the departure on our machine, as its [product page](https://parallel42.com/products/flow-pro) advertises, so its script runs in the menu.

**Changed:** a script of ours can reach the menu's document the same way, so the world map's requests need no inspector, which is unverified for a package of our own.
It costs two things: two packages that copy the same component load one copy, so ours must copy one that no add-on we know copies; and our copy hides the sim's own, so it has to follow each sim update that changes that component.

**Affects:** [the PF's spot on the world map](../product/ideas.md#the-pfs-spot-on-the-world-map).

**Evidence:** the two packages' files, read 2026-10-05.

## 2026-10-05: An EFB app, the toolbar, and in-game panels each reach a program on the same PC by WebSocket and HTTP, and can show a page it serves

**Asked:** can an EFB app and the notification banner's in-game panel each hold a WebSocket to a program on the same PC, as a cockpit panel can, or show a page that program serves, as the Fenix's tablet app does ([the plan](../product/plan.md)'s step 6; [04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client))?

**Expected:** yes, since a cockpit document can hold a WebSocket to loopback (measured on MSFS 2024, 2026-08-30, FS Copilot fork, `record/pointer-forwarding/docs/build/log.md`, "2026-08-30 - Q08 yes: a cockpit document can hold a WebSocket to loopback").

**Found:** on MSFS 2024 SunRise 12.2.282174.999, in the iniBuilds A380 on EGLL runway 27R, p06 served a page and a WebSocket endpoint on 127.0.0.1:47806, and code the inspector ran in each document, standing in for an app's, tried three things:

| Document | WebSocket, with the echo back | HTTP request | A hidden iframe of the served page, whose own WebSocket connected back |
| --- | --- | --- | --- |
| The EFB's, "Electronic Flight Bag" | yes | 200 | yes |
| The toolbar's | yes | 200 | yes |
| Flow Pro's in-game panel | yes | 200 | yes |
| ChasePlane's overlay panel | yes | 200 | yes |
| An A380 cockpit panel, `VCockpit126 - iniFAPa380` | yes | 200 | yes |

- Code in a document connected from origin `coui://html_ui`, and the served page's own script from `http://127.0.0.1:47806`.
- All five finished within 0.7s.

**Changed:** every kind of client, an EFB app, an in-game panel, and a cockpit panel, can talk to the core over one loopback WebSocket, or show a page the core serves.
What we haven't run is an EFB app loaded the sim's way, rather than code in the EFB's document, and an in-game panel of our own, rather than two of Parallel 42's.

**Affects:** [04-room-for-later](../product/04-room-for-later.md#one-protocol-for-every-client).

**Evidence:** `results/p06-websocket-2026-10-05-19-17-38.txt`.

## 2026-10-04: A click on a notice in our panel opens the EFB onto another app, whether the EFB was open or closed

**Asked:** can a notification on our panel open the EFB onto a given app, after the toolbar's calls put nothing on screen ([entry below](#2026-10-04-code-in-the-efbs-document-switches-the-efb-to-another-app-but-no-call-we-found-puts-the-efb-on-screen))?

**Expected:** the sim's own flow events would do it, since its interface opens the EFB onto a page with `LaunchFlowEvent("UI_EFB_OPEN", "")` and `LaunchFlowEvent("UI_EFB_OPEN_PAGE", "", "<app>", "<page>")` (read in fs-base-ui, `html_ui/Global/pkg/base.bundle.js`, and fs-base-efb-app-atlas, `AtlasApp.js`).

**Found:** on MSFS 2024 SU6, in the Black Square Baron 58P, parked, with GSX standing in for our app:

- With the EFB opened by Tab, the toolbar still listed `PANEL_EFB` as `"Invisible"`; the only change we found was the EFB's action bar losing the class `panel-ui-actions--hidden`, which it carries exactly while the EFB is closed.
- Neither the flow events above nor ChasePlane's `document.querySelector("ui-panel").m_listener.setPanelOpened(id, true)` did anything to the EFB, run in our panel's document or the toolbar's.
- `Coherent.call("TOGGLE_EFB")`, the call behind the toolbar's `ToolBarListener.toggleEFB` (read in fs-base-ui, `html_ui/Global/lib.js`), opens and closes the EFB from our panel's document and from the EFB's own.
- The EFB's document hears `OPEN_BY_KEY(app, page, args)` from the sim and opens that app (read in fs-base-efb, `html_ui/efb_ui/efb_os/efb_os.js`), so the sim has some way to open the EFB onto an app, which we haven't found.
- The chain, installed through the inspector, with a stand-in for our EFB app in the EFB's document:
  1. A click on the notification raises `L:CROSSCHECK_P05_EFB_APP`.
  2. The stand-in, polling it every 200ms, calls `TOGGLE_EFB` only if the action bar says the EFB is closed, then presses GSX's dock button.
  3. With the EFB open on Atlas, it stayed open and switched to GSX; with it closed after the pilot left it on Atlas, it opened onto GSX.
  4. GSX's button was pressed 73ms to 240ms after each of five clicks.
- A first version that called `TOGGLE_EFB` from the panel closed an open EFB, as a toggle does.
- ChasePlane keeps its full-screen overlay closed in VR, reading `globalVars.vrMode` in the toolbar's document (read in p42-util-chaseplane 2026.39.1.16, `HTML_UI/icons/toolbar/P42_PANEL_CHASEPLANE_OVERLAY.svg`).

**Changed:** the hybrid works: notifications on our panel, and a click on one opens our EFB app, whatever state the EFB is in.
It rests on two things only measured with code installed through the inspector: our EFB app's code running while the EFB is closed, and pressing our app's button, which may be off the dock and off the app list's first page.

**Affects:** the [EFB app](../product/03-v1-scope.md#efb-app) and the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** inspector reads, the screenshots after each call, and the pilot's report; no run file.

## 2026-10-04: Our toolbar icon loads a script of ours into the toolbar's document, and it opens our panel with no click

**Asked:** can Dual Input open its in-game panel by itself, from code we ship and control, with no click and no EFB app ([entry below](#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page))?
The core can't make the call: `Coherent` exists only inside the sim's documents, and the inspector on port 19999, though it works with DevMode off (FS Copilot fork, `record/pointer-forwarding/docs/09-environment.md`), is a debugger we won't ship on.

**Expected:** Parallel 42's add-ons run code in the toolbar's document, and the toolbar's document can open panels, so their way in would be ours too.

**Found:** on MSFS 2024 SU6, in the Black Square Baron 58P, parked:

- The toolbar's document loads a script from four add-ons' `InGamePanels` folders, such as `P42ChasePlane_worker.js` and FS Reborn's `toolbar_bridge.js`, and the sim's own files name none of them.
- The way in is the panel's toolbar icon: the toolbar inlines the icon's SVG into its own document, and ChasePlane's icon holds `<img src onerror="…">`, whose handler appends ChasePlane's script to the toolbar's `<head>` (read in p42-util-chaseplane 2026.39.1.16, `HTML_UI/icons/toolbar/P42_PANEL_CHASEPLANE.svg`).
  ChasePlane's overlay icon also opens the overlay from there, which is how it opens without a click.
  Parallel 42 publish the method under MIT as [parallel42/msfs-toolbar-interop](https://github.com/parallel42/msfs-toolbar-interop).
- Our blank toolbar button came from our icon's path: the 2020 template's `html_ui/Textures/Menu/toolbar/`, where 2024 looks in `html_ui/icons/toolbar/`.
- p05's icon, at the 2024 path with the same `img` ([ingame/build.mjs](../../../experiments/areas/interface/ingame/build.mjs)), loaded our `p05-toolbar.js` into the toolbar's document straight after a Build and Mount, with no flight reload.
- The script called `Coherent.call("TOOLBAR_BUTTON_TOGGLE", "PANEL_CROSSCHECK_P05", true)` 3s after loading, with no error.
  After the first Build and Mount the panel stayed closed; after the next two the pilot saw it open by itself.
- A Build and Mount gave the toolbar a fresh document, holding one copy of our script and none of the flags we had set in it, but the script it ran was the copy from the first build, so the toolbar's document keeps its first files as our panel's does.
- Opened from code, from the toolbar's document or the EFB's, our 48-wide column sat at the left of the screen, not the right.

**Changed:** Dual Input can open its panel itself, from code in its own package, with no EFB app and no click.
The trick isn't a sim feature: it rests on the toolbar inlining icon markup, which an update could stop.
Why the first call left the panel closed is unknown; a script that calls until the toolbar lists the panel as open is built but hasn't run, because the sim kept serving the first copy.
Putting the column back on the right when code opens it is untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) and the [EFB app](../product/03-v1-scope.md#efb-app) in the v1 scope.

**Evidence:** inspector reads of the toolbar's document, the toolbar's own record of each panel's state, and the pilot's report; no run file.

## 2026-10-04: Code in the EFB's document switches the EFB to another app, but no call we found puts the EFB on screen

**Asked:** can a notification on our panel open the EFB on Dual Input's own app, so the EFB app holds the controls and the panel only shows notifications?

**Expected:** the EFB is a toolbar panel, so the toolbar call would open it, and the EFB's code would have a way to pick an app.

**Found:** on MSFS 2024 SU6, in the Black Square Baron 58P, parked, with GSX and iniJetways installed as stand-ins for our app:

- The EFB is the toolbar panel `PANEL_EFB`, and its document, titled "Electronic Flight Bag", stays loaded while the EFB is closed.
- `TOOLBAR_BUTTON_TOGGLE` for `PANEL_EFB` set the toolbar's record of it to `"Detached"` when called from our panel's document or the toolbar's, and back to `"Invisible"` when closed from the toolbar's; no EFB showed on screen in either case.
  How Tab opens the EFB is untested.
- The EFB opens an app through `efbViewService.openApp(name)`, which no global exposes, and an app is handed the EFB's bus, settings, notification manager, and onboarding manager, but not the view service (read in fs-base-efb, `html_ui/efb_ui/efb_os/efb_os.js`, `EFBViewService` and `Container.use`).
- Pressing an app's button from code works: mouse events on GSX's dock button switched the EFB's view to `GSX_EFB`, and on IniJetways in the home page's app list to `MultiJetwayControllerApp`, while the EFB was closed.
  The app list pages, so an app off its first page needs paging first.

**Changed:** the hybrid, with notifications on our panel and controls in an EFB app, would need a way to put the EFB on screen that we haven't found; switching it to our app once it's open is solved, by a trick.

**Affects:** the [EFB app](../product/03-v1-scope.md#efb-app) and the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** inspector reads and the screenshots taken after each call; no run file.

## 2026-10-04: An in-game panel's size is a percent of the screen's height, capped at 150% of it, so ours can't span a wide screen, though Parallel 42's panels do

**Asked:** can p05's always-open panel ([entry below](#2026-10-04-an-in-game-panel-of-ours-takes-clicks-and-opens-from-code-in-the-toolbars-and-the-efbs-pages-but-not-in-a-cockpit-page)) cover the whole screen, as ChasePlane's overlay does, so its notifications can go anywhere on it?

**Expected:** `defaultWidth="100"` and `defaultHeight="100"` would fill the screen, since the template's sizes are percents of the screen.

**Found:** in a 2,401 by 1,360 window, p05's definition gave these pages, measured through the inspector:

| `defaultWidth` | `defaultHeight` | `defaultTop`, `defaultRight` | Page | Where |
| --- | --- | --- | --- | --- |
| 22 | 42 | 22, 1 | not measured | the right |
| 100 | 100 | 0, 0 | 1,360 by 1,360 | the left |
| 1000 | 100 | 0, 0 | 2,040 by 1,360 | the left |
| 48 | 100 | 0, 0 | 665 by 1,360 | the right |

- So width counts in percents of the screen's height, about, and the sim caps it at 150% of the height.
  Why the two wide panels sat at the left, with `defaultRight="0"`, is unknown.
- ChasePlane's overlay and Parallel 42's Flow each report a page and an `ingame-ui` box of 2,401 by 1,360, the whole window.
  Their `ingame-ui` carries our attributes plus the classes `no-header no-background collapsible`, `min-width="5"`, and `min-height="5"`, and the toolbar's page lists both, and ours, in the state `"Detached"`.
- Their compiled definitions, such as `InGamePanels/p42-util-chaseplane-overlay.spb`, are in a binary format we couldn't read, so how they reach the full width is unknown.
- Each Parallel 42 package ships `html_ui/pages/ToolBar/toolbar_interop.js`, a file in the sim's toolbar folder that the sim itself doesn't ship, so its code runs in the toolbar's page: ChasePlane's `window.p42_chaseplane_core` lives there, and their scripts wait on the events `TOOLBAR_READY`, `TOOLBAR_CONNECTED`, and `toolbar_attached` (read in p42-util-chaseplane 2026.39.1.16 and p42-util-flow-pro 26.33.5).
- Flow ships a second panel for VR, `PANEL_FLOW_VR`, named "//42 Flow - Popout", which the toolbar lists as `"Invisible"`.
- The sim's frame script tells the sim the frame's rectangle with `Coherent.trigger("UPDATE_PANEL_RECT", this.panelID, rect.left, rect.right, rect.top, bottom)` (read in fs-base-ui 0.1.10, `html_ui/templates/ingameUi/ingameUi.js`).

**Changed:** p05 uses the full-height column 48 wide on the right, which is where the scope puts notifications.
Full screen would take guessed definition attributes, each costing a Build and Mount, or Parallel 42's toolbar file, through which we found no size call.
Whether clicks on the column's clear part reach the cockpit is untested; if they don't, reporting only the card's rectangle with `UPDATE_PANEL_RECT` might let them through (unverified).

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope, and [ingame/build.mjs](../../../experiments/areas/interface/ingame/build.mjs).

**Evidence:** [the three pages' sizes and attributes](../../../experiments/areas/interface/results/p05-ingame-panel-sizes-2026-10-04.txt), read with the column live; the 100 and 1000 widths weren't saved.

## 2026-10-04: An in-game panel of ours takes clicks, and opens from code in the toolbar's and the EFB's pages, but not in a cockpit page

**Asked:** can an in-game panel of ours, see-through and pinned to the right of the screen, show the pre-flight card, take clicks on its Start flying button, and open without the pilot clicking the toolbar?

**Expected:** see-through and clicks, yes, since ChasePlane's overlay is such a panel; opening from code, no prediction.

**Found:** in the Black Square Baron 58P, parked, on MSFS 2024 SU6, SunRise 12.2.282174.999:

- p05's package ([ingame/build.mjs](../../../experiments/areas/interface/ingame/build.mjs)) copies the format of a working MSFS 2020 template (bymaximus/msfs2020-toolbar-window-template): a `SimBase.Document Type="InGamePanels"` compiled by an `SPB` asset group, and its page by a `Copy` group.
  The Project Editor asked for an order hint before it built, and we gave it `UI_PATCH`.
- Build and Mount mounted it with the sim running, and the toolbar listed "Dual Input", with a blank square where our icon should be.
- Opened from the toolbar, it sat on the right, see-through around the card.
  The page's `vh` counts the panel's own height, not the screen's, so the first column, 42% of the screen's height, drew everything 2.4 times too small.
- The panel counted 4 presses of Start flying into `L:CROSSCHECK_P05_CLICKS` before we drove it from code, which we take to be the pilot's.
- `Coherent.call("TOOLBAR_BUTTON_TOGGLE", "PANEL_CROSSCHECK_P05", open)` opened and closed the panel when run in the toolbar's page and in the "Electronic Flight Bag" page, and did nothing in the Baron's tablet page or in `VLogic`; `mainUi` has no `Coherent` to call it with.
- Closing the panel destroyed its page, and opening it made a new one.
- An open panel kept serving its first `p05.js` after a Build and Mount, and after closing and opening it, until `location.reload(true)` through the inspector.
- Kept open, the page slid the card and six notifications in and out with CSS transitions, driven through `window.CROSSCHECK_P05` from the inspector, and a screenshot showed the card and a notification with sharp text.
- The sim blurs whatever lies behind the panel's painted pixels: under a see-through pink layer, the instruments showed as a smooth blur, not tinted pink.
  A pink background on the page's `html` element never showed, and a full-size element of the page did.

**Changed:** the banner can be an in-game panel with its own buttons, left open, that shows and hides its elements by CSS without toggling the panel.
Dual Input's EFB app could open it, since the EFB's page can; whether the app's code runs while the EFB is closed is untested.
The panel must paint nothing outside its elements, or it blurs that part of the cockpit.
Clicks through its clear part, outside views, VR, and the icon are untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) and the EFB app in the v1 scope.

**Evidence:** inspector sessions run by hand; no run file, and the screenshots weren't kept.

## 2026-10-04: A banner drawn on an object of ours smears in motion and is clipped behind the cockpit, so we parked it for an in-game panel

**Asked:** how does a banner drawn on an object of ours, held 35cm ahead of the eye, look in use?

**Expected:** like a pair of AR glasses, with a slight lag that reads as inertia.

**Found:** the pilot, looking around the Black Square Baron 58P with the card and a banner up ([entries below](#2026-10-04-a-texture-we-write-ourselves-shows-on-our-panel-an-uncompressed-dds-shipped-by-a-copy-asset-group-with-its-ktx2json)), judged that its text smears while the view moves and that parts of the cockpit sometimes cut into it.
The panel that had loaded the broken KTX2 at the end of the eviction run showed the missing-texture checkerboard on a later spawn, though its file then held a good DDS, so the sim kept that failed read too.

**Changed:** the user parked the object route for the banner (2026-10-04) for a see-through in-game panel pinned to the right of the screen, which the sim draws in screen space and which takes clicks, so the banner can carry its own buttons again.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** the pilot's report; no run file.

## 2026-10-04: The sim lets go of a texture somewhere between 30s and 3.5 minutes after its object is removed

**Asked:** does the sim ever let go of a loaded texture, so that a texture file can carry a new picture again ([entry below](#2026-10-04-a-picture-written-over-a-texture-file-before-the-sim-first-loads-it-shows-on-the-next-spawn-and-once-loaded-the-sim-keeps-it))?
Every notification with new content, such as a seat that James holds now and Greg later, needs a texture the sim will read afresh.

**Expected:** no prediction.

**Found:** p04 wrote a notification stamped with the time over `CROSSCHECK_P02_Baked2`'s texture, which had loaded the 10:25:14 notification, and spawned the panel, three times:

- After the panel had been gone about 3.5 minutes, since 10:25:22: the new notification, drawn at 10:29:02, showed.
- After it had been gone 30s: the notification drawn at 10:29:07 didn't show, and the panel kept 10:29:02.
- After 120s: no result, because the sim wasn't in front and the screenshot caught the desktop instead; the screenshot tool saves nothing in that case since ([shot.mjs](../../../experiments/tools/shot.mjs)).

**Changed:** a texture file can carry a new picture once its panel has been gone long enough, between 30s and 3.5 minutes, so a banner can reuse a pool of texture files rather than spend one per notification for a whole flight.
The exact time, and whether anything other than time lets a texture go, are untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** [p04's run from 08:29:02](../../../experiments/areas/interface/results/p04-texture-rewrite-2026-10-04-08-29-02.txt) and its first two screenshots.

## 2026-10-04: A picture written over a texture file before the sim first loads it shows on the next spawn, and once loaded the sim keeps it

**Asked:** can the floating panel's picture change while the sim runs, by writing over its texture file, so that Dual Input's app could draw any notification and the banner show it?

**Expected:** a fresh spawn would read the file again.

**Found:** in the Black Square Baron 58P, parked, p04 wrote a notification, "You've lost the connection", stamped with the time it was drawn, as an uncompressed DDS of the same size over the texture file in both copies of the package, the one Build and Mount mounted and the one in Community:

- Over the card's texture, which the panel had loaded: the panel kept showing the card, 1s and 5s after the write while it was up, and after it was removed and spawned again 4s later.
- Over `CROSSCHECK_P02_Baked2`'s texture, which had never loaded, since the sim had refused our KTX2 there ([entry below](#2026-10-04-a-texture-we-write-ourselves-shows-on-our-panel-an-uncompressed-dds-shipped-by-a-copy-asset-group-with-its-ktx2json)), padded with zeros to that file's size: the first spawn after the write showed the notification with its stamp, 10:25:14, written 1.5s before the spawn.
- The package builder logged no error during either run.

**Changed:** the sim reads a texture file the first time it needs it, sees a mounted file's new contents, and doesn't keep a failed load, but keeps a loaded texture after its object is removed.
So a banner can show a picture the app draws while the sim runs, once per texture file; whether a loaded texture is ever let go, which would let a file be used again, is untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** p04's runs [over the loaded texture](../../../experiments/areas/interface/results/p04-texture-rewrite-2026-10-04-08-24-19.txt) and [over the one never loaded](../../../experiments/areas/interface/results/p04-texture-rewrite-2026-10-04-08-25-14.txt), each with its screenshots in the folder of the same name.

## 2026-10-04: A texture we write ourselves shows on our panel: an uncompressed DDS, shipped by a Copy asset group with its .KTX2.json

**Asked:** how does a texture get into a package of ours, when both packagers left our PNG out ([entry below](#2026-10-04-build-and-mount-loads-a-new-module-with-no-sim-restart-leaves-png-textures-out-and-a-program-can-click-it))?

**Expected:** fspackagetool run with the sim closed would convert the PNG where the in-sim Build and Mount didn't.

**Found:**

- fspackagetool, run with the sim closed, also left the PNG out of `texture/`, while it took a `texture.cfg` from the same folder, and reported no error.
- A `.PNG.json` of flags beside the PNG, in the form ChasePlane's built textures carry (read in p42-util-chaseplane 2026.39.1.16, `P42_FLASHLIGHT_BODY_ALBEDO.PNG.KTX2.json`), didn't make either packager take it.
- The same DDS written straight into the mounted package after Build and Mount, under the name below and with a `layout.json` entry ([drop-texture.mjs](../../../experiments/areas/interface/panel/tools/drop-texture.mjs)), still showed the checkerboard on a fresh spawn; whether the sim fixes a package's files when it mounts it, or kept the texture it had already failed to find, is unknown.
- The compiled model points at `..\TEXTURE\CROSSCHECK_P02_CARD.PNG.KTX2` whatever happens to the PNG, so we shipped files under that name through `Copy` asset groups, listed after the SimObject groups:
  - Package validation refused both with "Can't find associate json for ktx2 texture" until each had a `.KTX2.json` beside it; we gave ours `{"Version":2,"SourceFileDate":…,"Flags":[],"HasTransp":true}`.
  - An uncompressed 32-bit DDS, 1024x512 with alpha and one level ([png-to-dds.ps1](../../../experiments/areas/interface/panel/tools/png-to-dds.ps1)), showed the card on the panel, held 35cm ahead of the eye: see-through, its text sharp, and the cockpit and the hangar visible through it.
  - An uncompressed KTX2 we wrote, sRGB RGBA8 with one level ([ktx2.mjs](../../../experiments/areas/interface/panel/tools/ktx2.mjs)), showed the missing-texture checkerboard, so the sim reads a texture by its contents rather than its name, and something in our KTX2 doesn't suit it.
- The sim writes the package builder's errors, though not its warnings, to `%APPDATA%\Microsoft Flight Simulator 2024\BuilderLogError.txt`; the validation errors above came from it.
- The builder watches the project's folder and tries to reload an asset group for every file that changes in it.

**Changed:** a floating panel of ours can show a picture we make, without the sim's texture conversion.
How to have the packager convert a PNG properly, compressed and with mipmaps, is still unknown, and a shipped banner wants it, since our uncompressed texture is 2MB.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope, and [panel/build.mjs](../../../experiments/areas/interface/panel/build.mjs).

**Evidence:** p02's runs [for the DDS](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-08-19-38.txt) and [the KTX2](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-08-19-54.txt), each with its screenshot in the folder of the same name.

## 2026-10-04: Livery paintings show on the pilot's own aircraft, and on none of six kinds of object we spawned

**Asked:** does a livery painting land on objects of other kinds than a StaticObject ([entry below](#2026-10-04-a-livery-painting-on-an-object-of-our-own-opens-its-document-but-nothing-it-draws-reaches-the-objects-material))?

**Expected:** on an aircraft at least, since FSLTL's AI traffic paints its registrations that way.

**Found:** in the Black Square Baron 58P, parked:

- p02 put the same painting, `location=exterior` on the see-through material with `RegistrationNumberLoaded`, on a StaticObject, a Boat, a GroundVehicle, a Viewer, a Human, and a minimal aircraft of our own with no engine, each in the folder its kind ships in.
  Each spawned, the sim stayed up, and each opened its painting document, which redrew about once a second; none showed anything on its panel.
- An AI copy of the Baron, held side-on 15m ahead, showed no side number, with the Baron's tablet option "Show Dynamic Registration" on.
  Whether a copy has an `ATC ID` for the Baron's script to paint is unknown, so this doesn't settle AI aircraft.
- The pilot's own Baron, seen from outside with that option on, showed "N513LW" in the painting's red, `0xA50000`, outlined in its `0xD0D0D0`, so paintings draw in this build, SunRise 12.2.282174.999.
  The tablet's label for the option says it is "Still Awaiting Fix in SU4", and the pilot says this build is SU6.
- The package builder warned of keys it doesn't know in our files: `[VERSION]` in a `panel.cfg`, `editable` in the aircraft's `[GENERAL]`, and `panel` in `[fltsim.0]` of a `sim.cfg`, so the sim doesn't recognize a panel on an object that isn't an aircraft, though it opened the paintings' documents.

**Changed:** we stopped the painting route: we found no object we can spawn that shows one.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** [p02's run from 07:58:18](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-58-18.txt) and its screenshots, and [p03's run from 08:05:18](../../../experiments/areas/interface/results/p03-ai-gauges-2026-10-04-08-05-18.txt), whose screenshot shows the copy; the screenshot of the pilot's own Baron wasn't kept.

## 2026-10-04: A livery painting on an object of our own opens its document, but nothing it draws reaches the object's material

**Asked:** can an object of our own, held in front of the pilot's view, show HTML through a livery painting, the `[VPaintingNN]` kind of `panel.cfg` section the sim opened for an AI copy of the Baron ([entry below](#2026-10-04-an-ai-copy-of-the-pilots-aircraft-opens-its-livery-painting-and-none-of-its-cockpit-gauges))?

**Expected:** the painting would land on the material its `texture` names, as the Baron's tail number lands on `$RegistrationNumberExt` (read in bksq-aircraft-baronpro 0.1.1, `panel.N513LW/PANEL.CFG`, `[VPainting01]`).

**Found:** in the Black Square Baron 58P, parked, p02 spawned a StaticObject of ours with the card as a painting in its own `panel.cfg`, and held it 35cm ahead of the eye with the module.

- The sim opened a document for each, titled `VLiveryNN - CrosscheckP02Painting`, and handed it `globalLiveryData` with the painting's URL and size, 1024x512, and `uContainerID` 0, as it hands the Baron's own painting.
- Every painting document ran its frame loop about once every 2s, the Baron's own included: 14 frames to 15 in 2,034ms.
- Nothing the painting drew reached the panel in any of four variants: the panel showed its material's plain base color, or, on the Baron's registration material, the cockpit behind it washed out.

  | Variant | `location` | Material | Call after drawing |
  | --- | --- | --- | --- |
  | 1 | `exterior` | see-through, white | `RegistrationNumberLoaded`, the Baron's |
  | 2 | `exterior` | opaque, white | `VLIVERY_DATA_LOADED` with `false`, Asobo's live VDGS display's |
  | 3 | `interior` | see-through, white | `RegistrationNumberLoaded` |
  | 4 | `exterior` | the Baron's `$RegistrationNumberExt` recipe | `RegistrationNumberLoaded` |

  The calls come from the sim's own paintings: Asobo's VDGS display, which updates live, calls `VLIVERY_DATA_LOADED` with `false` 100ms after it connects, and its banner and text layer, drawn once, call it with `true` (read in asobo-vliveries, `pages/vlivery/paint/vdgs/vdgsdisplay.js`, `banner/banner.js`, and `textlayer/textlayer.js`).
- A removed object's painting document stayed open until the flight reloaded.

**Changed:** a livery painting on a StaticObject of ours doesn't show, and even where one shows it gets no input and runs about once every 2s, so the user dropped paintings for an interactive panel.
FSLTL's AI traffic paints its registrations with the sim's own `Registration.html` (read in fsltl-traffic-base, `FSLTL_LJ25/panel/panel.cfg`), and Asobo's VDGS paints onto some scenery object, so paintings do land on some objects that aren't the pilot's aircraft; which kinds is untested.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** p02's runs [from 07:14:52](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-14-52.txt) and [07:17:57](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-17-57.txt) for variant 1, and [from 07:39:42](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-39-42.txt) for variants 2 to 4, each with its screenshots in the folder of the same name; the variants are in [panel/build.mjs](../../../experiments/areas/interface/panel/build.mjs).

## 2026-10-04: An AI copy of the pilot's aircraft opens its livery painting and none of its cockpit gauges

**Asked:** does the sim run an aircraft's cockpit gauges on a copy of it that isn't the pilot's, which decides whether a floating panel of ours could carry a gauge by being an aircraft?

**Expected:** no prediction.

**Found:** with the pilot in the Black Square Baron 58P, p03 spawned a second Baron 58P as an AI object 40m ahead.
The inspector on 127.0.0.1:19999 listed 20 cockpit pages, `VCockpitNN - …`, before and after; the only page added was `VLivery02 - BksqBaronLiveryRegistration`, the copy's tail-number painting.

**Changed:** together with the [entry below](#2026-10-04-an-object-of-our-own-gets-no-gauge-from-its-own-panelcfg-and-a-gauges-texture-doesnt-reach-it-by-name), we infer that the sim runs cockpit gauges, HTML and WASM alike, only on the pilot's own aircraft (unverified beyond a StaticObject and an AI aircraft, and no SDK page we found says so).
An attachment's gauges do run as the pilot's aircraft's own: A2A's Aerostar 600 attaches its GTNs, KLN90B, and tablet as attachments that carry their own `panel.cfg` (read in a2a-aircraft-aerostar600 1.0.6, `presets/a2a/Base/config/attached_objects.cfg` and `attachments/a2a/*/panel/panel.cfg`), and the SDK says the sim "loads both _VPaintings_ and _VCockpits_" from an attachment's panel ([Modular SimObject Merging](https://docs.flightsimulator.com/msfs2024/html/5_Content_Configuration/Modular_SimObjects/Modular_SimObject_Merging.htm)).
The aircraft's own preset lists its attachments, and the user ruled out adding or overriding a file per aircraft for the panel.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope.

**Evidence:** [p03's run](../../../experiments/areas/interface/results/p03-ai-gauges-2026-10-04-07-09-26.txt), whose record has both lists of page titles.

## 2026-10-04: An object of our own gets no gauge from its own panel.cfg, and a gauge's texture doesn't reach it by name

**Asked:** can an object of our own, held in front of the pilot's view by a module, carry an HTML gauge, a full panel like an EFB of our own?

**Expected:** unknown: an aircraft's screen is a material named in its `panel.cfg`, and nothing we'd read said whether the sim loads a `panel.cfg` for an object that isn't an aircraft.

**Found:** in the Black Square Baron 58P, parked:

- p02 spawned a StaticObject of ours whose material `$CROSSCHECK_P02_PANEL` follows the Baron's GTN screen recipe, with `[VCockpit01]` in its own `panel.cfg` putting an HTML gauge on it (read in bksq-aircraft-baronpro 0.1.1, `BaronProfessional_Base_INT.gltf` and `panel.CGVGI/PANEL.CFG`).
  The panel showed solid black, the inspector listed no page for the gauge, and the gauge's frame counter, `L:CROSSCHECK_P02_GAUGE_FRAMES`, stayed at 0, in two runs.
- The same panel with its material named `$TabletScreen`, the Baron's tablet screen, stayed black; the pilot says the tablet's gauge draws while the tablet is stowed.
- The module `crosscheck-p02-panel` held the panel 35cm ahead of the eye every frame, placed from `fsCameraGet` in the `SIMOBJECT` referential and the aircraft's pose led by 1 frame, with no errors over 2,264 frames in one run, and nothing in the cockpit hid it.

The WASM drawing calls don't help either: each takes a gauge's `FsContext`, such as `fsRenderCreateTexture(FsContext ctx, …)`, which a standalone module doesn't have (read in MSFS 2024 SDK 1.7.3, `MSFS_Render.h`).

**Changed:** a floating object of ours can't carry an interactive HTML panel, so the user split the job (2026-10-04): the floating banner shows notifications and the pre-flight summary with no interaction, and the EFB app and the desktop app take the input.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) and the [EFB app](../product/03-v1-scope.md#efb-app) in the v1 scope.

**Evidence:** p02's runs [from 07:13:12](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-13-12.txt) and [07:20:01](../../../experiments/areas/interface/results/p02-floating-panel-2026-10-04-07-20-01.txt), and the first run's record, `p02-floating-panel-2026-10-04-07-05-20.ndjson`, which was stopped before its report; the module's source is [panel/src/panel.cpp](../../../experiments/areas/interface/panel/src/panel.cpp).

## 2026-10-04: Build and Mount loads a new module with no sim restart, leaves PNG textures out, and a program can click it

**Asked:** how fast can a probe package with a module, models, and HTML change while the sim runs?

**Expected:** models with no restart, as for the avatar figure ([avatars log](../avatars/log.md#2026-10-03-build-and-mount-gives-a-freshly-spawned-figure-a-rebuilt-model-with-no-restart)), and a module only after a restart.

**Found:**

- After Build and Mount of `crosscheck-p02-panel` from the Project Editor, its module ran at once with no restart, and each Build and Mount after that restarted it: `L:CROSSCHECK_P02_ALIVE` started over from 0.
- Build and Mount built two asset groups added to the package definition only after the project was closed and opened again; before that the sim answered `CREATE_OBJECT_FAILED` for their objects.
- Build and Mount left our PNG out of the package, whether it sat in `texture/` or beside the model, and listed it in neither its inputs nor its errors, while it rewrote the model to point at `CROSSCHECK_P02_CARD.PNG.KTX2`; the panel showed the sim's missing-texture checkerboard.
- After one Build and Mount, the painting documents of objects removed earlier were gone and the pilot's view had moved, as when the flight reloads.
- A program can run Build and Mount with nobody at the machine: [click.mjs](../../../experiments/tools/click.mjs) clicked an empty part of the Project Editor to bring the sim forward, right-clicked the package, and clicked "Build and mount crosscheck-p02-panel".

**Changed:** a probe's package changes in about a minute with no restart, module included, as long as its asset groups stay the same.
How to get a texture into a package is open, and the baked card is parked.

**Affects:** [panel/build.mjs](../../../experiments/areas/interface/panel/build.mjs).

**Evidence:** p02's runs above, and the package's build output, read after each build.

## 2026-10-04: SimConnect_Text reports its texts as displayed, and the pilot didn't catch any of them

**Asked:** does `SimConnect_Text` show the pilot a notification, as a candidate for the [notification banner](../product/03-v1-scope.md#notification-banner), and can its menu type carry a choice such as "Disconnect and take control"?

**Expected:** a line of text on screen for the print and scroll types, and a menu with two choices for the menu type.

**Found:** in the Black Square Baron 58P, p01 sent three texts, each opened by a beep for the pilot to watch:

- `SIMCONNECT_TEXT_TYPE_PRINT_WHITE` for 6s: the sim answered `SIMCONNECT_TEXT_RESULT_DISPLAYED` at once.
- `SIMCONNECT_TEXT_TYPE_SCROLL_YELLOW` for 8s: the sim answered `SIMCONNECT_TEXT_RESULT_QUEUED`, and never `DISPLAYED`.
- `SIMCONNECT_TEXT_TYPE_MENU` for 15s, with a title, a prompt, and two choices: the sim answered `DISPLAYED`, and neither a selection nor `SIMCONNECT_TEXT_RESULT_TIMEOUT` followed.

The pilot, watching the screen at each beep, didn't catch anything appear; they didn't know where or how a text would show.

The MSFS 2020 SDK calls `SimConnect_Text` "deprecated and cannot be used in Microsoft Flight Simulator" ([SimConnect_Text](https://docs.flightsimulator.com/html/Programming_Tools/SimConnect/API_Reference/General/SimConnect_Text.htm)); we found no MSFS 2024 page for it, and the function is still in the 2024 SDK's `SimConnect.h` (read in MSFS 2024 SDK 1.7.3).

**Changed:** we dropped `SimConnect_Text` as a banner candidate without testing further, because an object of our own carrying an HTML gauge gives us control of how a notification looks and where it sits (decided by the user, 2026-10-04).
Whether the sim draws the texts somewhere stays unknown.

**Affects:** the [notification banner](../product/03-v1-scope.md#notification-banner) in the v1 scope, and the step 6 banner probe in the [plan](../product/plan.md#6-probes-that-retire-architecture-risks).

**Evidence:** [p01's run](../../../experiments/areas/interface/results/p01-simconnect-text-2026-10-04-05-50-31.txt).
