// p07's analysis: for each outage in each run, what the connection did and how long after the
// link came back each direction had fresh data again.
//
// Every record carries the host's `CLOCK_MONOTONIC` in µs, and once a second a `clk` record pairs
// it with the system clock, which chrony keeps on internet time on both droplets. The outage
// script logs the system clock, so each endpoint's stamps go onto the system clock through the
// median of its pairs. A packet is fresh when its sender made it after the link came back, so a
// burst of packets QUIC held through the outage doesn't count as recovery.
//
//   node analyze.mjs <raw-dir> [--out <file>]

import fs from 'node:fs';
import path from 'node:path';

const [rawDir] = process.argv.slice(2);
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;

function read(f) {
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// Adds `wt`, the record's monotonic stamp on the system clock, to every record.
function onWall(log) {
  const offs = log.filter((r) => r.k === 'clk').map((r) => r.w - r.t).sort((a, b) => a - b);
  const off = offs[offs.length >> 1];
  for (const r of log) r.wt = r.t + off;
  return off;
}

const s = (us) => (us == null ? '-' : `${(us / 1e6).toFixed(1)}s`);
const kind = (remote) => (/relay/i.test(remote || '') ? 'relay' : 'direct');

const runs = [...new Set(fs.readdirSync(rawDir).filter((f) => f.endsWith('-outage.txt')).map((f) => f.replace(/-outage\.txt$/, '')))].sort();
const lines = [];
const report = {};
for (const id of runs) {
  const A = read(path.join(rawDir, `${id}-A.ndjson`));
  const B = read(path.join(rawDir, `${id}-B.ndjson`));
  const offA = onWall(A);
  const offB = onWall(B);
  const marks = fs.readFileSync(path.join(rawDir, `${id}-outage.txt`), 'utf8').trim().split('\n').map((l) => {
    const [ns, what, d] = l.split(' ');
    return { w: Number(BigInt(ns) / 1000n), what, d: Number(d) };
  });
  const startA = A.find((r) => r.k === 'start');
  const startB = B.find((r) => r.k === 'start');
  lines.push(`== ${id}: A ${startA.id.slice(0, 8)} dials, B ${startB.id.slice(0, 8)} listens; A's ID is ${startA.id < startB.id ? 'lower' : 'HIGHER'}`);
  const firstConn = A.find((r) => r.k === 'connected');
  lines.push(`  first connection at +${s(firstConn.w - marks[0].w)} from the outage script's start`);
  const outages = [];
  for (const down of marks.filter((m) => m.what === 'down')) {
    const up = marks.find((m) => m.what === 'up' && m.d === down.d);
    const next = marks.find((m) => m.w > up.w && (m.what === 'down' || m.what === 'end'));
    const until = next ? next.w : Infinity;
    const inWin = (r, from, to) => r.wt >= from && r.wt < to;
    // The selected path just before the drop, from each side's per-second path records, since
    // iroh sends no selection event for a connection's first path.
    const selBefore = (log) => {
      const p = log.filter((r) => r.k === 'path' && r.sel && r.wt < down.w).at(-1);
      return p ? (p.relay ? 'relay' : 'direct') : 'none';
    };
    const closed = (log) => log.filter((r) => r.k === 'conn_closed' && r.w >= down.w && r.w < until).map((r) => ({ c: r.c, at: r.w - down.w, reason: r.reason }));
    const home = (log) => log.filter((r) => r.k === 'home' && r.w >= down.w && r.w < until).map((r) => ({ at: r.w - down.w, status: r.status.join('; ') }));
    // The first fresh packet each way after the link came back: made after `up` on the sender's
    // clock, received by the other end.
    // The path is the receiver's selected path in its first per-second record on that connection
    // at or after the packet.
    const fresh = (rxLog, offSender) => {
      const r = rxLog.find((x) => x.k === 'rx' && x.wt >= up.w && x.ts + offSender >= up.w && x.wt < until);
      if (!r) return null;
      const p = rxLog.find((x) => x.k === 'path' && x.sel && x.c === r.c && x.wt >= r.wt);
      return { after_up: r.wt - up.w, c: r.c, path: p ? (p.relay ? 'relay' : 'direct') : 'unknown' };
    };
    const anyRx = (rxLog) => {
      const r = rxLog.find((x) => x.k === 'rx' && x.wt >= up.w && x.wt < until);
      return r ? { after_up: r.wt - up.w, made_before_up: r.ts + (rxLog === A ? offB : offA) < up.w } : null;
    };
    const dials = A.filter((r) => r.k === 'dial' && r.w >= down.w && r.w < until);
    const dialOk = A.filter((r) => r.k === 'dial_ok' && r.w >= down.w && r.w < until);
    const dialErr = A.filter((r) => r.k === 'dial_err' && r.w >= down.w && r.w < until);
    const selAfter = (log) => log.filter((r) => r.k === 'pev' && r.ev === 'selected' && inWin(r, up.w, until)).map((r) => ({ at: r.wt - up.w, path: kind(r.remote) }));
    const selDuring = (log) => log.filter((r) => r.k === 'pev' && r.ev === 'selected' && inWin(r, down.w, up.w)).map((r) => ({ at: r.wt - down.w, path: kind(r.remote) }));
    const o = {
      outage_s: down.d,
      selected_before: { A: selBefore(A), B: selBefore(B) },
      closed: { A: closed(A), B: closed(B) },
      home_A: home(A),
      home_B: home(B),
      first_rx_after_up: { at_B: anyRx(B), at_A: anyRx(A) },
      first_fresh: { A_to_B: fresh(B, offA), B_to_A: fresh(A, offB) },
      dials: dials.length,
      dial_ok: dialOk.map((r) => ({ at: r.w - up.w, attempt: r.attempt, took: r.us })),
      dial_err: dialErr.map((r) => ({ at: r.w - up.w, attempt: r.attempt, e: r.e })),
      selected_during: { A: selDuring(A), B: selDuring(B) },
      selected_after_up: { A: selAfter(A), B: selAfter(B) },
    };
    outages.push(o);
    const conn = (c) => (c.length ? c.map((x) => `conn ${x.c} closed at +${s(x.at)} (${x.reason})`).join(', ') : 'connection survived');
    lines.push(`  -- ${down.d}s outage; before it, A on ${o.selected_before.A}, B on ${o.selected_before.B}`);
    lines.push(`     A: ${conn(o.closed.A)}; B: ${conn(o.closed.B)}`);
    lines.push(`     A's home relay: ${o.home_A.map((h) => `+${s(h.at)} ${h.status}`).join(' | ') || 'no change'}`);
    lines.push(`     B's home relay: ${o.home_B.map((h) => `+${s(h.at)} ${h.status}`).join(' | ') || 'no change'}`);
    lines.push(`     redials: ${o.dials} started, ${o.dial_ok.map((d) => `#${d.attempt} connected ${s(d.at)} after the link came back, taking ${s(d.took)}`).join(', ') || 'none connected'}${o.dial_err.length ? `, ${o.dial_err.length} failed (${[...new Set(o.dial_err.map((d) => d.e))].join('; ')})` : ''}`);
    const f = o.first_fresh;
    const fmtFresh = (x) => (x ? `${s(x.after_up)} on the receiver's conn ${x.c}, ${x.path}` : 'never');
    lines.push(`     fresh data after the link came back: A to B ${fmtFresh(f.A_to_B)}; B to A ${fmtFresh(f.B_to_A)}`);
    const a = o.first_rx_after_up;
    lines.push(`     first packet of any age: at B ${a.at_B ? `${s(a.at_B.after_up)}${a.at_B.made_before_up ? ', made during the outage' : ''}` : 'never'}, at A ${a.at_A ? `${s(a.at_A.after_up)}${a.at_A.made_before_up ? ', made during the outage' : ''}` : 'never'}`);
    lines.push(`     path selections during, from the drop: A ${o.selected_during.A.map((x) => `+${s(x.at)} ${x.path}`).join(', ') || 'none'}; B ${o.selected_during.B.map((x) => `+${s(x.at)} ${x.path}`).join(', ') || 'none'}`);
    lines.push(`     path selections after: A ${o.selected_after_up.A.map((x) => `+${s(x.at)} ${x.path}`).join(', ') || 'none'}; B ${o.selected_after_up.B.map((x) => `+${s(x.at)} ${x.path}`).join(', ') || 'none'}`);
  }
  report[id] = outages;
}
console.log(lines.join('\n'));
if (outFile) fs.writeFileSync(outFile, lines.join('\n') + '\n\n' + JSON.stringify(report, null, 2) + '\n');
