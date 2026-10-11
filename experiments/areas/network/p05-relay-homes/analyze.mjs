// p05's analysis: for each run and each phase, how many bytes each endpoint's socket to each relay
// sent and received, from `ss` on both droplets, and which relay path iroh reported selected. An
// endpoint's relay sockets are the ones `ss` lists as owned by the process `p05`.
//
//   node analyze.mjs <raw-dir> <deploy.json> [--out <file>]

import fs from 'node:fs';
import path from 'node:path';

const [rawDir, deployFile] = process.argv.slice(2);
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const deploy = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
// Addresses in the originals, station names in the redacted copy.
const relayName = Object.fromEntries(deploy.stations.flatMap((s) => [[s.ipv4, s.name], [s.name, s.name]]));
const read = (f) => fs.readFileSync(path.join(rawDir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Each sample: wall ns, then per p05 socket to a relay: relay name, local port, bytes sent and received.
function ssSamples(file) {
  const out = [];
  let cur = null;
  let lastHead = null;
  for (const line of fs.readFileSync(path.join(rawDir, file), 'utf8').split('\n')) {
    if (line.startsWith('@ ')) {
      cur = { w: Number(BigInt(line.slice(2)) / 1000n), socks: {} };
      out.push(cur);
    } else if (/^\S/.test(line)) {
      lastHead = line;
    } else if (lastHead && cur && /users:\(\("p05"/.test(lastHead)) {
      const parts = lastHead.trim().split(/\s+/);
      const peer = parts[4].replace(/^\[::ffff:/, '').replace(/\]/, '');
      const [peerIp, peerPort] = [peer.slice(0, peer.lastIndexOf(':')), peer.slice(peer.lastIndexOf(':') + 1)];
      if (peerPort !== '443') continue;
      const sent = Number((line.match(/bytes_sent:(\d+)/) || [])[1] || 0);
      const recv = Number((line.match(/bytes_received:(\d+)/) || [])[1] || 0);
      const local = parts[3].slice(parts[3].lastIndexOf(':') + 1);
      cur.socks[`${relayName[peerIp] || 'other'}:${local}`] = { relay: relayName[peerIp] || 'other', sent, recv };
      lastHead = null;
    }
  }
  return out;
}

// Bytes each socket moved between two wall times: the sample at or after `to` less the one before `from`.
function delta(samples, from, to) {
  const before = [...samples].reverse().find((s) => s.w <= from) || samples[0];
  const after = samples.find((s) => s.w >= to) || samples[samples.length - 1];
  const d = {};
  for (const [k, v] of Object.entries(after.socks)) {
    const b = before.socks[k] || { sent: 0, recv: 0 };
    const r = (d[v.relay] ||= { sent: 0, recv: 0 });
    r.sent += v.sent - b.sent;
    r.recv += v.recv - b.recv;
  }
  return d;
}

const runs = [...new Set(fs.readdirSync(rawDir).filter((f) => f.endsWith('.ndjson')).map((f) => f.replace(/-(fra|nyc)\.ndjson$/, '')))];
const lines = [];
const report = [];
for (const run of runs.sort()) {
  const host = { fra: read(`${run}-fra.ndjson`), nyc: read(`${run}-nyc.ndjson`) };
  const ss = { fra: ssSamples(`ss-${run}-fra.txt`), nyc: ssSamples(`ss-${run}-nyc.txt`) };
  const dialerHost = run.startsWith('fra-dials') ? 'fra' : 'nyc';
  const listenerHost = dialerHost === 'fra' ? 'nyc' : 'fra';
  const phases = host[dialerHost].filter((r) => r.k === 'phase');
  const at = (what) => phases.find((p) => p.what === what)?.w;
  const windows = [
    { what: `${dialerHost} sends to ${listenerHost}`, from: at('dialer sends'), to: at('quiet'), sender: dialerHost },
    { what: `${listenerHost} sends to ${dialerHost}`, from: at('dialer asks listener to send') + 500_000, to: at('end') - 2_000_000, sender: listenerHost },
  ];
  const home = (h) => host[h].filter((r) => r.k === 'home').map((r) => r.status.join(', ')).pop();
  const entry = { run, home: { fra: home('fra'), nyc: home('nyc') }, phases: [] };
  lines.push(`== ${run}: endpoint on fra homes at ${home('fra')}; endpoint on nyc homes at ${home('nyc')}`);
  for (const w of windows) {
    const receiver = w.sender === 'fra' ? 'nyc' : 'fra';
    const sd = delta(ss[w.sender], w.from, w.to);
    const rd = delta(ss[receiver], w.from, w.to);
    const sel = (h) => [...new Set(host[h].filter((r) => r.k === 'paths' && r.w >= w.from && r.w <= w.to).flatMap((r) => r.paths.filter((p) => p.sel).map((p) => p.remote)))];
    const fmt = (d, k) => Object.entries(d).map(([r, v]) => `${r} ${v[k]} B`).join(', ');
    entry.phases.push({ what: w.what, sender_sent_by_relay: sd, receiver_received_by_relay: rd, sender_selected: sel(w.sender), receiver_selected: sel(receiver) });
    lines.push(`  ${w.what}: sender's relay sockets sent ${fmt(sd, 'sent')}; receiver's relay sockets received ${fmt(rd, 'recv')}`);
    lines.push(`    paths selected: sender ${sel(w.sender).join(' ')}, receiver ${sel(receiver).join(' ')}`);
  }
  report.push(entry);
}
console.log(lines.join('\n'));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n\n' + lines.join('\n') + '\n');
