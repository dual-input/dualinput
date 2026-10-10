// p02's analysis: reads the testers' uploads, the peers' logs, and the stations' logs, and
// writes one summary per tester run plus tables across runs. It runs on our side only, so it
// can run again with other thresholds; the raw files hold every packet.
//
//   node analyze.mjs <raw-dir> [--out <dir>]
//
// <raw-dir> holds, anywhere below it, the testers' `*-part*.ndjson(.gz)` uploads, the peers'
// `peer-*.ndjson` logs, and each station's `station.ndjson`. Outputs carry no IP addresses:
// a tester is its run ID, and an address shows only as its kind (private, carrier-grade NAT,
// public), so the summaries can go in the repository.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const rawDir = args[0];
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(rawDir, 'analysis');
if (!rawDir) {
  console.log('usage: node analyze.mjs <raw-dir> [--out <dir>]');
  process.exit(1);
}

// The thresholds 2.3 names, a flight-model delay of 100ms and 0.4s and a 60ms audio buffer,
// with 120ms and 170ms audio buffers beside it for the pass line still to be set.
const FLIGHT_DELAYS_US = [100_000, 400_000];
const AUDIO_BUFFERS_US = [60_000, 120_000, 170_000];
const STREAMS = { 1: 'flight', 2: 'cockpit', 3: 'audio' };
const PERIOD_US = { 1: 50_000, 2: 200_000, 3: 20_000 };

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function read(file) {
  let buf = fs.readFileSync(file);
  if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  const out = [];
  for (const l of buf.toString('utf8').split('\n')) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      // A line cut off by a crash; the rest of the file stands.
    }
  }
  return out;
}

const q = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
const ms = (us) => (us == null ? null : Math.round(us / 100) / 10);
const median = (a) => q([...a].sort((x, y) => x - y), 0.5);

function addrKind(a) {
  if (!a) return null;
  const ip = a.replace(/^\[|\]?:\d+$/g, '').replace(/:\d+$/, '');
  if (ip.includes(':')) return ip.startsWith('fe80') ? 'v6-link-local' : ip.startsWith('fd') || ip.startsWith('fc') ? 'v6-ula' : 'v6-global';
  const [a1, a2] = ip.split('.').map(Number);
  if (a1 === 10 || (a1 === 172 && a2 >= 16 && a2 < 32) || (a1 === 192 && a2 === 168)) return 'private';
  if (a1 === 100 && a2 >= 64 && a2 < 128) return 'cgnat';
  if (a1 === 169 && a2 === 254) return 'link-local';
  return 'public';
}
const portOf = (a) => (a ? Number(a.split(':').pop()) : null);

// ---- loading ----
const testers = new Map(); // run_id -> records, parts merged in order
const peers = []; // { name, file, recs }
const stations = []; // { name, recs }
for (const f of walk(rawDir)) {
  const b = path.basename(f);
  let m;
  if ((m = b.match(/^(?:run-)?([0-9a-f]{16})-part(\d)/))) {
    const recs = read(f);
    const e = testers.get(m[1]) || [];
    e.push({ part: Number(m[2]), recs });
    testers.set(m[1], e);
  } else if ((m = b.match(/^peer-([a-z]+)-\d+\.ndjson/))) {
    peers.push({ name: m[1], file: f, recs: read(f) });
  } else if (b.replace(/\.gz$/, '') === 'station.ndjson') {
    const recs = read(f);
    const start = recs.find((r) => r.k === 'station_start');
    stations.push({ name: start?.name || path.basename(path.dirname(f)), recs });
  }
}
for (const [id, parts] of testers) {
  parts.sort((a, b) => a.part - b.part);
  testers.set(id, parts.flatMap((p) => p.recs));
}

// Every packet any peer sent or received, by tag, for joining with a tester's own records.
// Both ends of a traffic run log it under one tag, so direction comes from which log holds it.
const peerByTag = new Map();
for (const p of peers) {
  for (const r of p.recs) {
    if ((r.k === 'tx' || r.k === 'rx') && r.g != null) {
      let e = peerByTag.get(r.g);
      if (!e) peerByTag.set(r.g, (e = { peer: p.name, tx: [], rx: [], clock: p }));
      e[r.k].push(r);
    }
  }
}
const testerByTag = new Map();
for (const [id, recs] of testers) {
  for (const r of recs) {
    if ((r.k === 'tx' || r.k === 'rx') && r.g != null) {
      let e = testerByTag.get(`${id}/${r.g}`);
      if (!e) testerByTag.set(`${id}/${r.g}`, (e = { tx: [], rx: [] }));
      e[r.k].push(r);
    }
  }
}

// ---- clocks ----
// From the clock exchanges against one station: the exchange with the shortest round trip in
// each burst of eight, its offset (station time at the midpoint minus our counter at the
// midpoint), and a least-squares line through those offsets, whose slope is the counter's
// drift against the station's chrony-disciplined clock.
function clockFit(recs, station) {
  const samples = recs.filter((r) => r.k === 'clock' && (!station || r.st === station));
  if (samples.length < 4) return null;
  const bursts = [];
  let cur = [];
  for (const s of samples) {
    if (cur.length && s.t1 - cur[cur.length - 1].t1 > 2_000_000) {
      bursts.push(cur);
      cur = [];
    }
    cur.push(s);
  }
  if (cur.length) bursts.push(cur);
  const pts = bursts.map((b) => {
    const best = b.reduce((a, s) => (s.t4 - s.t1 < a.t4 - a.t1 ? s : a));
    const mid = (best.t1 + best.t4) / 2;
    const stMid = (Number(best.rx_ns) + Number(best.tx_ns)) / 2 / 1000;
    const wallMid = (best.w1 + best.w4) / 2;
    return { x: mid, y: stMid - mid, wall: wallMid - stMid, rtt: best.t4 - best.t1 };
  });
  const fit = (key) => {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p[key], 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of pts) {
      sxy += (p.x - mx) * (p[key] - my);
      sxx += (p.x - mx) ** 2;
    }
    const slope = sxx ? sxy / sxx : 0;
    const resid = pts.map((p) => p[key] - (my + slope * (p.x - mx)));
    const sd = Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / n);
    return { slope, intercept: my - slope * mx, sd };
  };
  const off = fit('y');
  const wall = fit('wall');
  const span = pts[pts.length - 1].x - pts[0].x;
  return {
    station: station || samples[0].st,
    bursts: pts.length,
    span_s: Math.round(span / 1e6),
    qpc_drift_ppm: Math.round(off.slope * 1e6 * 100) / 100,
    qpc_resid_sd_us: Math.round(off.sd),
    sysclock_vs_station_ppm: Math.round(wall.slope * 1e6 * 100) / 100,
    sysclock_offset_ms: Math.round(median(pts.map((p) => p.wall)) / 100) / 10,
    best_rtt_ms: ms(Math.min(...pts.map((p) => p.rtt))),
    toStation: (mono) => mono + off.intercept + off.slope * mono,
  };
}

// ---- one direction of one traffic run ----
// Excess delay: each packet's one-way delay above the run's floor. The floor is a line through
// the lowest delay in each 10s window, so the two clocks' drift over a run doesn't read as delay.
// A window [t0, t1) is on the tester's clock. For the direction the tester sends, it selects by
// send stamp; for the one it receives, by arrival, and then by the range of sequence numbers
// that arrived in it, so packets lost in the window still count as sent.
function direction(tx, rx, stream, t0, t1, receiverWindow = false) {
  let inWindow = (r) => t0 == null || (r.t >= t0 && r.t < t1);
  if (receiverWindow && t0 != null) {
    const seqs = rx.filter((r) => r.s === stream && r.t >= t0 && r.t < t1).map((r) => r.n);
    const lo = Math.min(...seqs);
    const hi = Math.max(...seqs);
    inWindow = (r) => seqs.length > 0 && r.n >= lo && r.n <= hi;
  }
  const sent = tx.filter((r) => r.s === stream && inWindow(r));
  const sentSeq = new Set(sent.map((r) => r.n));
  const got = rx.filter((r) => r.s === stream && sentSeq.has(r.n));
  if (!sent.length) return null;
  const seen = new Set();
  const uniq = got.filter((r) => (seen.has(r.n) ? false : seen.add(r.n)));
  const d = uniq.map((r) => ({ ts: r.ts, t: r.t, d: r.t - r.ts, n: r.n }));
  d.sort((a, b) => a.ts - b.ts);
  let excess = [];
  if (d.length) {
    const win = new Map();
    for (const p of d) {
      const w = Math.floor((p.ts - d[0].ts) / 10_000_000);
      if (!win.has(w) || win.get(w).d > p.d) win.set(w, p);
    }
    const mins = [...win.values()];
    let slope = 0;
    let icpt = Math.min(...mins.map((p) => p.d));
    if (mins.length >= 3) {
      const mx = mins.reduce((s, p) => s + p.ts, 0) / mins.length;
      const my = mins.reduce((s, p) => s + p.d, 0) / mins.length;
      let sxy = 0;
      let sxx = 0;
      for (const p of mins) {
        sxy += (p.ts - mx) * (p.d - my);
        sxx += (p.ts - mx) ** 2;
      }
      slope = sxx ? sxy / sxx : 0;
      icpt = my - slope * mx;
      const lowest = Math.min(...d.map((p) => p.d - (icpt + slope * p.ts)));
      icpt += lowest;
    }
    excess = d.map((p) => Math.max(0, p.d - (icpt + slope * p.ts)));
  }
  const ex = [...excess].sort((a, b) => a - b);
  // Gaps: arrival gaps longer than three send periods, the stalls a receiver would see.
  const arr = d.map((p) => p.t).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < arr.length; i++) {
    const g = arr[i] - arr[i - 1];
    if (g > 3 * PERIOD_US[stream]) gaps.push(g);
  }
  // Jitter as RTP measures it: the mean change in one-way delay between packets in send order.
  const bySeq = [...d].sort((a, b) => a.n - b.n);
  let jsum = 0;
  for (let i = 1; i < bySeq.length; i++) jsum += Math.abs(bySeq[i].d - bySeq[i - 1].d);
  const out = {
    sent: sent.length,
    received: uniq.length,
    lost: sent.length - uniq.length,
    loss_pct: Math.round((10000 * (sent.length - uniq.length)) / sent.length) / 100,
    excess_ms: { p50: ms(q(ex, 0.5)), p95: ms(q(ex, 0.95)), p99: ms(q(ex, 0.99)), max: ms(ex[ex.length - 1]) },
    jitter_ms: bySeq.length > 1 ? ms(jsum / (bySeq.length - 1)) : null,
    gaps: { n: gaps.length, max_ms: ms(gaps.length ? Math.max(...gaps) : 0), lengths_ms: gaps.map(ms).sort((a, b) => b - a).slice(0, 20) },
  };
  // A late packet and a lost one both leave the receiver without the sample, so each share
  // counts both, over everything sent.
  const share = (n) => Math.round((10000 * n) / sent.length) / 100;
  const lim = stream === 1 ? FLIGHT_DELAYS_US : stream === 3 ? AUDIO_BUFFERS_US : [];
  for (const l of lim) {
    const late = ex.filter((e) => e > l).length;
    out[`late_${l / 1000}ms`] = late;
    out[`missed_${l / 1000}ms_pct`] = share(late + out.lost);
  }
  return out;
}

// The far end of a tag: a peer's log, or, for a side test, the other tester's upload.
function farEnd(runId, tag) {
  if (peerByTag.has(tag)) return peerByTag.get(tag);
  for (const [key, e] of testerByTag) {
    if (key.endsWith(`/${tag}`) && !key.startsWith(`${runId}/`)) return e;
  }
  return { tx: [], rx: [] };
}

function both(runId, tag, t0, t1) {
  const mine = testerByTag.get(`${runId}/${tag}`) || { tx: [], rx: [] };
  const theirs = farEnd(runId, tag);
  const res = {};
  for (const s of [1, 2, 3]) {
    const up = direction(mine.tx, theirs.rx, s, t0, t1);
    const down = direction(theirs.tx, mine.rx, s, t0, t1, true);
    if (up || down) res[STREAMS[s]] = { tester_to_peer: up, peer_to_tester: down };
  }
  return res;
}

// ---- one tester run ----
function analyzeRun(runId, recs) {
  const first = (k) => recs.find((r) => r.k === k);
  const all = (k) => recs.filter((r) => r.k === k);
  const start = first('run_start');
  const sys = first('system');
  const out = { run_id: runId, build: start?.build, windows: sys?.windows };

  // The PC's network: the adapter that carries the default route, its kind and speed, the
  // Wi-Fi signal over the run, IPv6, and every change, sleep, and resume.
  const nets = all('net');
  const active = (n) => (n.adapters || []).filter((a) => a.oper_status === 1 && a.gateways?.length);
  const a0 = nets.length ? active(nets[0])[0] : null;
  const wifiQ = nets.flatMap((n) => (Array.isArray(n.wifi) ? n.wifi : [])).map((w) => w.signal_quality).filter((x) => x != null);
  const rssi = nets.flatMap((n) => (Array.isArray(n.wifi) ? n.wifi : [])).map((w) => w.rssi_dbm).filter((x) => x != null);
  out.network = {
    adapter: a0 ? { kind: a0.if_type === 71 ? 'wifi' : a0.if_type === 6 ? 'wired' : `if_type ${a0.if_type}`, tx_mbps: a0.tx_bps / 1e6, rx_mbps: a0.rx_bps / 1e6, description: a0.description } : null,
    wifi_signal: wifiQ.length ? { min: Math.min(...wifiQ), median: median(wifiQ), max: Math.max(...wifiQ) } : null,
    wifi_rssi_dbm: rssi.length ? { min: Math.min(...rssi), median: median(rssi), max: Math.max(...rssi) } : null,
    ipv6_global: a0 ? (a0.addrs || []).some((x) => addrKind(x.ip) === 'v6-global') : null,
    netchanges: all('netchange').length,
    power: all('power').map((p) => p.what),
    stalls: all('stall').map((s) => s.gap_ms),
  };
  const load = all('load').map((l) => l.cpu_pct).sort((a, b) => a - b);
  out.load = load.length ? { cpu_p50: q(load, 0.5), cpu_p95: q(load, 0.95), cpu_max: load[load.length - 1], own_p95: q(all('load').map((l) => l.own_cpu_pct).sort((a, b) => a - b), 0.95) } : null;
  const ts = first('timesvc');
  out.time_service = ts
    ? {
        running: /RUNNING/.test(ts.service || ''),
        source: ((ts.status || '').match(/^Source:\s*(.+)$/m) || [])[1]?.trim() || null,
      }
    : null;
  const st = first('stations');
  out.stations = st ? { near: st.near, far: st.far, rtts_ms: Object.fromEntries((st.rtts_us || []).map((r) => [r.st, ms(r.rtt_us)])) } : null;

  // The router.
  const stun = all('stun').filter((s) => s.mapped);
  const bySock = {};
  for (const s of stun) (bySock[s.sock] ||= []).push(s);
  const mapping = {};
  for (const [sock, list] of Object.entries(bySock)) {
    const ports = new Set(list.map((s) => portOf(s.mapped)));
    const ips = new Set(list.map((s) => s.mapped.replace(/:\d+$/, '')));
    mapping[sock] = {
      destinations: list.length,
      same_port_everywhere: ports.size === 1,
      same_ip_everywhere: ips.size === 1,
      port_preserved: list.every((s) => portOf(s.mapped) === portOf(s.local)),
      mapped_kind: addrKind(list[0].mapped),
    };
  }
  const filt = all('filter');
  const pmp = all('nat_pmp');
  const pcp = all('pcp');
  const upnp = all('upnp_desc').filter((u) => !u.err);
  const pmpExt = pmp.find((p) => p.raw && p.raw.length >= 24 && p.raw.slice(2, 4) === '80');
  let pmpIp = null;
  if (pmpExt) {
    const b = Buffer.from(pmpExt.raw, 'hex');
    if (b.length >= 12 && b.readUInt16BE(2) === 0) pmpIp = `${b[8]}.${b[9]}.${b[10]}.${b[11]}`;
  }
  const stunIp = stun.find((s) => s.sock === 'map-a')?.mapped?.replace(/:\d+$/, '');
  out.router = {
    mapping,
    v6: (bySock.v6 || []).length ? 'answered' : all('stun').some((s) => s.sock === 'v6' && s.err) ? 'unreachable' : 'none',
    filtering: filt.map((f) => ({ same_port: f.same_port, other_port: f.other_port, other_ip: f.other_ip })),
    nat_pmp: pmp.some((p) => p.raw) ? 'answered' : 'silent',
    pcp: pcp.some((p) => p.raw) ? 'answered' : 'silent',
    upnp: upnp.length ? 'answered' : all('ssdp').length ? 'ssdp only' : 'silent',
    model: upnp[0] ? { manufacturer: upnp[0].manufacturer, model: upnp[0].model_name, number: upnp[0].model_number } : null,
    gateway_oui: (nets[0]?.gateway_oui || []).map((g) => g.oui),
    portmap: first('portmap_probe')?.result,
    portmap_mapping: first('portmap_mapping')?.external ? 'granted' : 'none',
    // A NAT-PMP external address that differs from what STUN servers see means a second NAT
    // past the router, carrier-grade NAT most often.
    double_nat: pmpIp && stunIp ? pmpIp !== stunIp : null,
    wan_kind_from_pmp: pmpIp ? addrKind(pmpIp) : null,
    holds: all('hold').map((h) => ({ gap_s: h.gap_s, woke: h.woke_after_ms != null, same_port_after: h.after?.seen && h.after?.before ? h.after.seen === h.after.before : null, err: h.err })),
  };

  // Connections: per target, how many connected, how many went direct, and how fast.
  const att = all('attempt');
  const targets = {};
  for (const a of att) {
    const t = (targets[a.target] ||= { tries: 0, connected: 0, direct: 0, direct_ms: [], connect_ms: [], errors: [] });
    t.tries++;
    if (a.err) t.errors.push(a.err.slice(0, 120));
    if (a.connect_ms != null) {
      t.connected++;
      t.connect_ms.push(a.connect_ms);
    }
    if (a.direct_ms != null) {
      t.direct++;
      t.direct_ms.push(a.direct_ms);
    }
  }
  for (const t of Object.values(targets)) {
    t.direct_ms = { median: median(t.direct_ms), max: t.direct_ms.length ? Math.max(...t.direct_ms) : null };
    t.connect_ms = { median: median(t.connect_ms) };
  }
  out.connections = targets;

  // The switch to the relay and back, from the tester's own view of the paths, and from the
  // packets: the longest arrival gap on the flight stream after the drop, each way.
  out.switch = all('switch').map((s) => {
    const r = { label: s.label, idle_ms: s.idle_ms, keepalive_ms: s.keepalive_ms, to_relay_ms: s.to_relay_ms, back_after_lift_ms: s.back_ms, err: s.err };
    const conn = recs.find((c) => c.k === 'send_start' && c.c === s.c);
    if (conn && s.drop_t) {
      const res = both(runId, conn.g, null, null);
      const gapAround = (rx) => {
        const arr = rx.filter((p) => p.s === 1 && p.t > s.drop_t - 1_000_000 && p.t < s.drop_t + 60_000_000).map((p) => p.t).sort((a, b) => a - b);
        let g = 0;
        for (let i = 1; i < arr.length; i++) g = Math.max(g, arr[i] - arr[i - 1]);
        return ms(g);
      };
      const mine = testerByTag.get(`${runId}/${conn.g}`);
      const theirs = farEnd(runId, conn.g);
      r.flight_gap_peer_to_tester_ms = mine ? gapAround(mine.rx) : null;
      r.flight_gap_tester_to_peer_ms = theirs ? gapAround(theirs.rx.map((p) => ({ ...p, t: p.ts }))) : null;
      r.loss = { flight: res.flight?.peer_to_tester?.lost };
    }
    return r;
  });

  // Switches nobody caused: on every connection, each change of the selected path between a
  // direct one and a relayed one. A move to the relay counts as caused only inside a switch
  // run, between the firewall's drop and 60s after its lift; a first move from the relay to a
  // direct path is the hole punch, and expected.
  // iroh reports no Selected event for the path the handshake ran on, so the timeline also
  // takes each second's statistics, which mark the selected path.
  const labelOf = new Map(all('conn').map((c) => [c.c, c.label]));
  const kindOf = new Map(all('conn').map((c) => [c.c, c.kind]));
  const sel = new Map();
  const mark = (c, t, kind) => {
    const list = sel.get(c) || [];
    list.push({ t, kind });
    sel.set(c, list);
  };
  for (const e of all('pev')) if (e.ev === 'selected') mark(e.c, e.t, /Relay/.test(e.remote) ? 'relay' : 'direct');
  for (const p of all('path')) if (p.sel && kindOf.get(p.c) === 'iroh') mark(p.c, p.t, p.relay ? 'relay' : 'direct');
  for (const [c, list] of sel) {
    list.sort((a, b) => a.t - b.t);
    sel.set(c, list.filter((x, i) => i === 0 || x.kind !== list[i - 1].kind));
  }
  const windows = all('switch').filter((s) => s.drop_t).map((s) => ({ c: s.c, from: s.drop_t, to: (s.lift_t || s.drop_t) + 60e6 }));
  const uncaused = [];
  let directToRelay = 0;
  for (const [c, list] of sel) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].kind === list[i - 1].kind) continue;
      const toRelay = list[i].kind === 'relay';
      if (toRelay) directToRelay++;
      const caused = windows.some((w) => w.c === c && list[i].t >= w.from && list[i].t <= w.to);
      if (toRelay && !caused) uncaused.push({ c, label: labelOf.get(c), t_s: Math.round((list[i].t - (start?.t || 0)) / 1e6) });
    }
  }
  out.failovers = { connections: sel.size, direct_to_relay: directToRelay, uncaused };

  // Round trips on the real link, from QUIC's estimate on the selected path each second, by
  // what the connection was for.
  const rttBy = {};
  for (const p of all('path')) {
    if (!p.sel) continue;
    const label = labelOf.get(p.c) || '';
    const kind = kindOf.get(p.c) === 'noq' ? 'udp-forwarder' : p.relay ? 'iroh-relay' : 'direct';
    const what = label.replace(/-\d+$/, '').replace(/^(relay-[a-z]+)-(clear|loss|burst)-.*$/, '$1-$2');
    (rttBy[`${what} ${kind}`] ||= []).push(p.rtt_us);
  }
  out.rtt_ms = Object.fromEntries(
    Object.entries(rttBy)
      .filter(([k]) => !/loss|burst/.test(k))
      .map(([k, v]) => {
        const s = [...v].sort((a, b) => a - b);
        return [k, { samples: s.length, p50: ms(q(s, 0.5)), p95: ms(q(s, 0.95)), max: ms(s[s.length - 1]) }];
      }),
  );

  // Signs that the probe or the data went wrong somewhere.
  out.anomalies = {
    clock_lost: all('clock_lost').length,
    tx_errors: all('txerr').length,
    api_errors: all('api').filter((a) => !a.ok).map((a) => `${a.path}: ${String(a.err).slice(0, 100)}`),
    attempt_errors: all('attempt').filter((a) => a.err).map((a) => `${a.target}: ${a.err.slice(0, 100)}`),
    relay_errors: all('relay_run').filter((r) => r.err).map((r) => `${r.label}: ${r.err.slice(0, 100)}`),
    switch_errors: all('switch').filter((s) => s.err).map((s) => `${s.label}: ${s.err}`),
    burst: all('burst_err').map((b) => b.e).concat(all('burst_skipped').map((b) => b.why)),
    stalls: all('stall').map((s) => s.gap_ms),
    stopped: all('stop').length > 0,
    trace_warnings: recs.filter((r) => r.k === 'trace' && /"level":"(WARN|ERROR)"/.test(JSON.stringify(r.e))).length,
  };

  // The relay runs: iroh's relay and the UDP forwarder side by side.
  out.relay = all('relay_run').filter((r) => r.iroh_tag != null).map((r) => ({
    label: r.label,
    target: r.target,
    mode: r.mode,
    pct: r.pct,
    iroh: both(runId, r.iroh_tag),
    udp: both(runId, r.udp_tag),
  }));

  // The upload burst: session traffic before, during, and after four TCP streams fill the
  // upload, and the upload rate they reached.
  const up = all('upload_tx');
  const bl = first('burst_link');
  if (up.length && bl) {
    const b0 = Math.min(...up.map((u) => u.t)) - 100_000;
    const b1 = Math.max(...up.map((u) => u.t));
    const conn = recs.find((c) => c.k === 'send_start' && c.c === bl.c);
    const perSec = new Map();
    for (const u of up) perSec.set(Math.floor((u.t - b0) / 1e6), (perSec.get(Math.floor((u.t - b0) / 1e6)) || 0) + u.bytes);
    const mbps = [...perSec.values()].map((b) => (b * 8) / 1e6).sort((a, c) => a - c);
    const rtt = (lo, hi) => median(recs.filter((p) => p.k === 'path' && p.c === bl.c && p.sel && p.t >= lo && p.t < hi).map((p) => p.rtt_us));
    out.burst = {
      upload_s: Math.round((b1 - b0) / 1e6),
      upload_mbps: { median: Math.round(q(mbps, 0.5)), max: Math.round(mbps[mbps.length - 1]) },
      path_rtt_ms: { before: ms(rtt(b0 - 30e6, b0)), during: ms(rtt(b0, b1)), after: ms(rtt(b1, b1 + 30e6)) },
      before: conn ? both(runId, conn.g, b0 - 30e6, b0) : null,
      during: conn ? both(runId, conn.g, b0, b1) : null,
      after: conn ? both(runId, conn.g, b1, b1 + 30e6) : null,
    };
  }

  // The counter against the stations' clocks.
  out.clock = [...new Set(all('clock').map((c) => c.st))].map((s) => {
    const f = clockFit(recs, s);
    if (!f) return null;
    const { toStation, ...rest } = f;
    return rest;
  });

  out.side = all('side').map((s) => {
    const conn = recs.find((c) => c.k === 'send_start' && c.c === s.c);
    return {
      role: s.role,
      other: s.other,
      connect_ms: s.connect_ms,
      direct_ms: s.direct_ms,
      err: s.err,
      traffic: s.role === 'dial' && conn ? both(runId, conn.g) : undefined,
    };
  });
  return out;
}

fs.mkdirSync(outDir, { recursive: true });
const summaries = [];
for (const [id, recs] of testers) {
  const s = analyzeRun(id, recs);
  summaries.push(s);
  fs.writeFileSync(path.join(outDir, `run-${id}.json`), JSON.stringify(s, null, 2));
}
const peerClocks = peers
  .filter((p) => p.recs.some((r) => r.k === 'clock'))
  .map((p) => {
    const sts = [...new Set(p.recs.filter((r) => r.k === 'clock').map((r) => r.st))];
    return { peer: p.name, clocks: sts.map((s) => clockFit(p.recs, s)).filter(Boolean).map(({ toStation, ...r }) => r) };
  });
fs.writeFileSync(path.join(outDir, 'peers-clock.json'), JSON.stringify(peerClocks, null, 2));

// A plain-text digest across runs, for reading at a glance.
const lines = [];
for (const s of summaries) {
  lines.push(`== run ${s.run_id} (build ${s.build}) near ${s.stations?.near} ${JSON.stringify(s.stations?.rtts_ms)}`);
  lines.push(`network: ${JSON.stringify(s.network?.adapter)} wifi ${JSON.stringify(s.network?.wifi_signal)} v6 ${s.network?.ipv6_global} changes ${s.network?.netchanges} power ${JSON.stringify(s.network?.power)}`);
  lines.push(`router: ${JSON.stringify(s.router?.mapping)} filtering ${JSON.stringify(s.router?.filtering)} pmp ${s.router?.nat_pmp} pcp ${s.router?.pcp} upnp ${s.router?.upnp} double_nat ${s.router?.double_nat}`);
  lines.push(`holds: ${s.router?.holds.map((h) => `${h.gap_s}s:${h.woke ? 'kept' : 'lost'}${h.same_port_after === false ? '(new port)' : ''}`).join(' ')}`);
  for (const [t, c] of Object.entries(s.connections || {})) lines.push(`connect ${t}: ${c.connected}/${c.tries} connected, ${c.direct} direct, direct median ${c.direct_ms.median}ms max ${c.direct_ms.max}ms`);
  for (const w of s.switch || []) lines.push(`switch ${w.label}: to relay ${w.to_relay_ms}ms, back ${w.back_after_lift_ms}ms after lift, flight gap ${w.flight_gap_peer_to_tester_ms}/${w.flight_gap_tester_to_peer_ms}ms`);
  for (const r of s.relay || []) {
    for (const via of ['iroh', 'udp']) {
      const f = r[via].flight;
      const a = r[via].audio;
      const c = r[via].cockpit;
      const fmt = (x, k) => (x ? `${x.loss_pct}% lost, excess p99 ${x.excess_ms.p99}ms max ${x.excess_ms.max}ms${k ? `, late ${x[k]}` : ''}, gaps ${x.gaps.n} max ${x.gaps.max_ms}ms` : '-');
      lines.push(`${r.label} ${via.padEnd(4)} flight↑ ${fmt(f?.tester_to_peer, 'late_100ms')} | flight↓ ${fmt(f?.peer_to_tester, 'late_100ms')}`);
      lines.push(`${' '.repeat(r.label.length)} ${via.padEnd(4)} audio↑ ${fmt(a?.tester_to_peer, 'late_60ms')} | audio↓ ${fmt(a?.peer_to_tester, 'late_60ms')} | cockpit↓ ${fmt(c?.peer_to_tester)}`);
    }
  }
  if (s.burst) lines.push(`burst: ${JSON.stringify(s.burst.upload_mbps)} Mbps, path rtt ${JSON.stringify(s.burst.path_rtt_ms)}, flight↑ excess p95 before/during/after ${s.burst.before?.flight?.tester_to_peer?.excess_ms.p95}/${s.burst.during?.flight?.tester_to_peer?.excess_ms.p95}/${s.burst.after?.flight?.tester_to_peer?.excess_ms.p95}ms`);
  for (const c of s.clock || []) if (c) lines.push(`clock vs ${c.station}: QPC ${c.qpc_drift_ppm} ppm (resid ${c.qpc_resid_sd_us}µs over ${c.span_s}s), system clock ${c.sysclock_vs_station_ppm} ppm, offset ${c.sysclock_offset_ms}ms`);
  if (s.time_service) lines.push(`windows time service: ${s.time_service.running ? 'running' : 'not running'}, source ${s.time_service.source}`);
  for (const d of s.side || []) {
    const f = d.traffic?.flight;
    lines.push(`side ${d.role} ${d.other || ''}: connect ${d.connect_ms}ms direct ${d.direct_ms}ms ${d.err || ''}${f ? ` flight↑ ${f.tester_to_peer?.loss_pct}% lost p99 ${f.tester_to_peer?.excess_ms.p99}ms, flight↓ ${f.peer_to_tester?.loss_pct}% lost p99 ${f.peer_to_tester?.excess_ms.p99}ms` : ''}`);
  }
  lines.push('');
}
for (const p of peerClocks) for (const c of p.clocks) lines.push(`peer ${p.peer} clock vs ${c.station}: QPC ${c.qpc_drift_ppm} ppm over ${c.span_s}s, system clock ${c.sysclock_vs_station_ppm} ppm`);
fs.writeFileSync(path.join(outDir, 'digest.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
console.log(`\n${summaries.length} run(s), ${peers.length} peer log(s), ${stations.length} station log(s); written to ${outDir}`);
