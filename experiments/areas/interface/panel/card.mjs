/*
 * The mock pre-flight card the floating panel shows in p02: the same markup
 * for the HTML gauge, which draws it live, and for the baked texture, which
 * headless Edge renders to a PNG (build.mjs).
 *
 * 1024 by 512 pixels. The gauge's copy runs in Coherent GT, so the CSS keeps
 * to flexbox, rgba, and border-radius, and names no font the sim may lack.
 * The Start flying button sits at fixed pixels, BUTTON, so p02 can tell from a
 * click's ray whether it landed on it.
 */

export const WIDTH = 1024
export const HEIGHT = 512
export const BUTTON = { left: 694, top: 390, width: 290, height: 82 }

// The panel the card is drawn on, in meters: its size, and the radius it's
// curved to, centered on an eye that distance behind it (build.mjs).
export const PANEL = { width: 0.16, height: 0.08, radius: 0.35 }

export const CARD_CSS = `
.cc-card {
  position: absolute; left: 0; top: 0; width: ${WIDTH}px; height: ${HEIGHT}px;
  box-sizing: border-box; padding: 34px 44px;
  border-radius: 36px; border: 3px solid rgba(160, 190, 255, 0.35);
  background-color: rgba(12, 18, 30, 0.80);
  color: #f2f5fa; font-family: "Roboto", "Segoe UI", sans-serif;
}
.cc-card.cc-opaque { background-color: rgb(12, 18, 30); }
.cc-head { display: flex; flex-direction: row; align-items: center; justify-content: space-between; }
.cc-brand { font-size: 24px; letter-spacing: 6px; color: #9db8ff; font-weight: bold; }
.cc-pill { font-size: 22px; letter-spacing: 3px; padding: 6px 18px; border-radius: 20px; background-color: rgba(157, 184, 255, 0.18); color: #c9d7ff; }
.cc-title { font-size: 44px; margin-top: 26px; font-weight: bold; }
.cc-rows { margin-top: 24px; display: flex; flex-direction: column; }
.cc-row { display: flex; flex-direction: row; align-items: center; font-size: 31px; margin-bottom: 14px; }
.cc-dot { width: 22px; height: 22px; border-radius: 11px; margin-right: 22px; }
.cc-error { background-color: #ff5a4e; }
.cc-warning { background-color: #ffb732; }
.cc-ok { background-color: #3ccf7a; }
.cc-foot { position: absolute; left: 44px; top: 404px; font-size: 25px; color: #a9b3c4; }
.cc-live { margin-top: 8px; font-size: 20px; color: #6f7b90; }
.cc-start {
  position: absolute; left: ${BUTTON.left}px; top: ${BUTTON.top}px; width: ${BUTTON.width}px; height: ${BUTTON.height}px;
  box-sizing: border-box; border-radius: ${BUTTON.height / 2}px; background-color: #3d7bff;
  color: #ffffff; font-size: 33px; font-weight: bold;
  display: flex; align-items: center; justify-content: center;
}
`

// A notice, for p04's rewrite test: a different picture of the same size, with
// the time it was drawn, so a screenshot shows which copy the sim drew.
export function noticeMarkup({ title, body, stamp }) {
  return `
<div class="cc-card">
  <div class="cc-head"><div class="cc-brand">CROSSCHECK</div><div class="cc-pill">NOTICE</div></div>
  <div class="cc-title">${title}</div>
  <div class="cc-rows"><div class="cc-row"><div class="cc-dot cc-warning"></div><div>${body}</div></div></div>
  <div class="cc-foot"><div>Drawn at ${stamp}</div></div>
</div>`
}

export function cardMarkup({ live = false, opaque = false } = {}) {
  return `
<div class="cc-card${opaque ? " cc-opaque" : ""}">
  <div class="cc-head"><div class="cc-brand">CROSSCHECK</div><div class="cc-pill">PRE-FLIGHT</div></div>
  <div class="cc-title">James joined in the right seat</div>
  <div class="cc-rows">
    <div class="cc-row"><div class="cc-dot cc-error"></div><div>Different Baron versions: you 0.1.1, James 0.1.0</div></div>
    <div class="cc-row"><div class="cc-dot cc-warning"></div><div>Different liveries: you N58BK, James N2238Z</div></div>
    <div class="cc-row"><div class="cc-dot cc-ok"></div><div>Same Crosscheck, 0.4.2</div></div>
  </div>
  <div class="cc-foot"><div>Sync starts when you start flying.</div><div class="cc-live" id="crosscheck-live">${live ? "live" : ""}</div></div>
  <div class="cc-start" id="crosscheck-start">Start flying</div>
</div>`
}
