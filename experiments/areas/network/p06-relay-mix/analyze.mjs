// p06's analysis: for each run, each channel in each direction, how many messages the sender made,
// replaced in its slot (variant b), handed to QUIC, and the receiver got, and how late they came.
//
// Late is one-way delay above the direction's floor, the lowest delay of any one-off packet that
// way in the run, so it's what a playout buffer would have to absorb. A near run's two endpoints
// share the Frankfurt droplet's `CLOCK_MONOTONIC`, so its floor is the true one-way delay; a far
// run's endpoints are on two droplets, so its floor also holds the offset between their clocks
// and only the lateness counts. A delivered packet's lateness runs from when it was made, so time
// it waited in a slot or in QUIC's buffer counts. The session round trip runs on the dialer's
// clock alone.
//
//   node analyze.mjs <raw-dir> [--out <file>]

import fs from 'node:fs';
import path from 'node:path';

const [rawDir] = process.argv.slice(2);
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const NAMES = { 1: 'flight', 2: 'cockpit', 3: 'audio', 4: 'controls', 5: 'avatar', 6: 'batch', 7: 'session req', 8: 'session rep' };
const STREAMS = new Set([2, 7, 8]);
const D2L = [1, 4, 5, 6, 3, 2, 7];
const L2D = [5, 8];

function read(f) {
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null);
const ms = (us) => (us == null ? '-' : (us / 1000).toFixed(us < 10_000 ? 1 : 0));

// One direction of one run: per channel, counts and lateness in µs above the floor.
function direction(sendLog, recvLog, tag, chans) {
  const tx = {};
  const sup = {};
  const rx = {};
  let txerr = 0;
  for (const r of sendLog) {
    if (r.k === 'tx') (tx[r.s] ||= new Map()).set(r.n, r);
    else if (r.k === 'sup') (sup[r.s] ||= new Set()).add(r.n);
    else if (r.k === 'txerr') txerr++;
  }
  for (const r of recvLog) if (r.k === 'rx' && r.g === tag && !rx[r.s]?.has(r.n)) (rx[r.s] ||= new Map()).set(r.n, r);
  const oneWay = (r) => r.t - r.ts;
  let floor = Infinity;
  for (const c of chans) if (!STREAMS.has(c)) for (const r of rx[c]?.values() || []) floor = Math.min(floor, oneWay(r));
  const out = {};
  for (const c of chans) {
    const t = tx[c] || new Map();
    const s = sup[c] || new Set();
    const got = rx[c] || new Map();
    const seqs = [...t.keys(), ...s];
    const produced = seqs.length ? Math.max(...seqs) + 1 : 0;
    const late = [...got.values()].map((r) => oneWay(r) - floor).sort((a, b) => a - b);
    const arrivals = [...got.values()].map((r) => r.t).sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < arrivals.length; i++) maxGap = Math.max(maxGap, arrivals[i] - arrivals[i - 1]);
    const handedLost = [...t.keys()].filter((n) => !got.has(n)).length;
    const waited = STREAMS.has(c) ? [] : [...t.values()].map((r) => r.t - r.p).sort((a, b) => a - b);
    out[c] = {
      produced,
      superseded: s.size,
      handed: t.size,
      received: got.size,
      lost_after_handing: handedLost,
      late_p50: pct(late, 50),
      late_p99: pct(late, 99),
      late_max: late.at(-1) ?? null,
      max_gap: maxGap,
      slot_wait_p99: pct(waited, 99),
    };
  }
  return { floor, txerr, chans: out };
}

function sessionRtt(dial) {
  const req = new Map();
  const rtt = [];
  for (const r of dial) if (r.k === 'tx' && r.s === 7) req.set(r.n, r.t);
  for (const r of dial) if (r.k === 'rx' && r.s === 8 && req.has(r.n)) rtt.push(r.t - req.get(r.n));
  rtt.sort((a, b) => a - b);
  return { n: rtt.length, p50: pct(rtt, 50), p99: pct(rtt, 99), max: rtt.at(-1) ?? null };
}

// The QUIC datagram buffer's fill, from the per-second path records: the most it held.
function bufferPeak(log, start) {
  const size = start.dgram_buffer;
  let minSpace = size;
  for (const r of log) if (r.k === 'path' && r.sel && typeof r.dgbuf === 'number') minSpace = Math.min(minSpace, r.dgbuf);
  return size - minSpace;
}

// What QUIC itself saw on the relay path by the run's end: packets it counted lost, congestion
// events, and its smallest congestion window. The relay's TCP resends what `tc netem` drops, so
// QUIC sees a late packet where TCP saw a lost one.
function quicView(log) {
  const paths = log.filter((r) => r.k === 'path' && r.sel);
  if (!paths.length) return null;
  const last = paths.at(-1);
  return { lost: last.lost, cong: last.cong, min_cwnd: Math.min(...paths.map((r) => r.cwnd)), max_rtt_ms: Math.max(...paths.map((r) => r.rtt_us)) / 1000 };
}

const ids = [...new Set(fs.readdirSync(rawDir).filter((f) => f.endsWith('-dial.ndjson')).map((f) => f.replace(/-dial\.ndjson$/, '')))];
const order = (id) => {
  const [where, loss, mix, v] = id.split('-');
  return [where === 'near' ? 0 : 1, parseInt(loss, 10), mix === 'quiet' ? 0 : 1, v].join('.');
};
ids.sort((a, b) => (order(a) < order(b) ? -1 : 1));

const lines = [];
const report = {};
for (const id of ids) {
  const dial = read(path.join(rawDir, `${id}-dial.ndjson`));
  const listen = read(path.join(rawDir, `${id}-listen.ndjson`));
  if (!dial || !listen) {
    lines.push(`== ${id}: missing a log`);
    continue;
  }
  const traffic = dial.find((r) => r.k === 'traffic');
  if (!traffic) {
    lines.push(`== ${id}: the dialer never started its traffic`);
    continue;
  }
  const tag = traffic.start.tag;
  const d2l = direction(dial, listen, tag, D2L);
  const l2d = direction(listen, dial, tag, L2D);
  const rtt = sessionRtt(dial);
  const peaks = { dialer: bufferPeak(dial, dial.find((r) => r.k === 'start')), listener: bufferPeak(listen, listen.find((r) => r.k === 'start')) };
  const quic = { dialer: quicView(dial), listener: quicView(listen) };
  report[id] = { d2l, l2d, session_rtt: rtt, dgram_buffer_peak_bytes: peaks, quic };
  const absolute = id.startsWith('near');
  lines.push(`== ${id}: floor ${ms(d2l.floor)}ms dialer to listener, ${ms(l2d.floor)}ms back${absolute ? ' (one-way, one clock)' : ' (includes the clocks\' offset)'}; session round trip p50 ${ms(rtt.p50)}ms p99 ${ms(rtt.p99)}ms max ${ms(rtt.max)}ms over ${rtt.n}; QUIC datagram buffer peak ${peaks.dialer} B dialer, ${peaks.listener} B listener; send errors ${d2l.txerr + l2d.txerr}`);
  lines.push(`  QUIC on the relay path, dialer: ${JSON.stringify(quic.dialer)}; listener: ${JSON.stringify(quic.listener)}`);
  lines.push('  channel       way   made  replaced  handed  got    lost  late p50  p99    max    gap max  slot wait p99');
  for (const [way, dir] of [['d>l', d2l], ['l>d', l2d]]) {
    for (const [c, v] of Object.entries(dir.chans)) {
      lines.push(
        `  ${NAMES[c].padEnd(12)}  ${way}  ${String(v.produced).padStart(5)}  ${String(v.superseded).padStart(8)}  ${String(v.handed).padStart(6)}  ${String(v.received).padStart(5)}  ${String(v.lost_after_handing).padStart(4)}  ${ms(v.late_p50).padStart(8)}  ${ms(v.late_p99).padStart(5)}  ${ms(v.late_max).padStart(5)}  ${ms(v.max_gap).padStart(7)}  ${ms(v.slot_wait_p99).padStart(13)}`,
      );
    }
  }
}

// One line per run for the comparisons the log draws: the streams against the one-off channels.
lines.push('');
lines.push('summary, late in ms (p99 / max); loss is of what the sender made, replaced ones included');
lines.push('run                      flight      audio       batch loss  cockpit       session rtt   avatar back');
for (const id of ids) {
  const r = report[id];
  if (!r) continue;
  const c = r.d2l.chans;
  const lossPct = (v) => (v.produced ? ((100 * (v.produced - v.received)) / v.produced).toFixed(1) + '%' : '-');
  const pm = (v) => `${ms(v.late_p99)}/${ms(v.late_max)}`;
  lines.push(
    `${id.padEnd(24)} ${pm(c[1]).padEnd(11)} ${pm(c[3]).padEnd(11)} ${lossPct(c[6]).padEnd(11)} ${pm(c[2]).padEnd(13)} ${`${ms(r.session_rtt.p99)}/${ms(r.session_rtt.max)}`.padEnd(13)} ${pm(r.l2d.chans[5])}`,
  );
}

console.log(lines.join('\n'));
if (outFile) fs.writeFileSync(outFile, lines.join('\n') + '\n\n' + JSON.stringify(report, null, 2) + '\n');
