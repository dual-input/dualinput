// Copies p02's raw logs with every public IP address replaced by a label, so the copy can go in
// the repository while the originals stay outside it.
//
//   node redact.mjs <raw-dir> <out-dir> <deploy.json>
//
// One mapping covers every file, so an address that appears in a tester's upload, a peer's
// log, and a station's log gets one label everywhere and the files still join. Our stations'
// addresses become their names (`fra`, `fra-v6`); other public IPv4 addresses become
// `pub4-<n>`, and global IPv6 addresses `pub6-<n>`. Private, carrier-grade NAT, link-local, and
// loopback addresses stay, since they name nobody and the analysis reads their kind. Fields
// that hold an address in encoded form, the raw STUN, NAT-PMP, and PCP answers, are dropped.
// Packet captures aren't copied; the analysis reads its tables from them.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';

//   --skip-runs <id,...>     leaves out those runs' uploads, such as our own short tests
//   --drop-kinds <k,...>     leaves those record kinds out of every log but the testers'
//                            uploads, such as `trace` and `fwd`, to keep the copy small
const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1].split(',') : []);
const skipRuns = opt('--skip-runs');
const dropKinds = new Set(opt('--drop-kinds'));
const [rawDir, outDir, deployFile] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!rawDir || !outDir || !deployFile) {
  console.log('usage: node redact.mjs <raw-dir> <out-dir> <deploy.json> [--skip-runs <ids>] [--drop-kinds <kinds>]');
  process.exit(1);
}
const deploy = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
const labels = new Map();
for (const s of deploy.stations) {
  labels.set(s.ipv4, s.name);
  if (s.ipv6) labels.set(s.ipv6.toLowerCase(), `${s.name}-v6`);
}
let n4 = 0;
let n6 = 0;

function keep4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || a >= 224;
}

function label4(ip) {
  if (keep4(ip)) return ip;
  if (!labels.has(ip)) labels.set(ip, `pub4-${++n4}`);
  return labels.get(ip);
}

function label6(ip) {
  const l = ip.toLowerCase();
  if (l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd') || l === '::' || l === '::1' || l.startsWith('::ffff:')) {
    return l.startsWith('::ffff:') ? `::ffff:${label4(l.slice(7))}` : ip;
  }
  if (!labels.has(l)) labels.set(l, `pub6-${++n6}`);
  return labels.get(l);
}

const V4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
// An IPv6 address of at least three groups, so a time such as 12:07:04 doesn't match.
const V6 = /(?<![0-9A-Za-z:.])(?:[0-9A-Fa-f]{1,4}:){2,7}(?::|[0-9A-Fa-f]{1,4})(?:(?::[0-9A-Fa-f]{1,4}){0,6})?(?![0-9A-Za-z:])|(?<![0-9A-Za-z:])::ffff:(?:\d{1,3}\.){3}\d{1,3}/g;

// The pattern also catches clock times (12:03:42) and MAC prefixes (98:3f:60); only what Node
// parses as a full IPv6 address gets a label.
// A Windows path under a user's folder names the user; the friends' build replaced its own
// path in firewall rules only where the letter case matched.
const USER_DIR = /([A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/))[^\\/"]+/gi;

function redactText(s) {
  return s
    .replace(V6, (m) => (net.isIPv6(m) ? label6(m) : m))
    .replace(V4, (m) => label4(m))
    .replace(USER_DIR, '$1<user>');
}

const DROP = { stun: ['raw'], nat_pmp: ['raw'], pcp: ['raw'] };

function redactLine(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return redactText(line);
  }
  for (const f of DROP[o.k] || []) if (f in o) o[f] = 'redacted';
  return redactText(JSON.stringify(o));
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
for (const f of walk(rawDir)) {
  const rel = path.relative(rawDir, f);
  if (!/\.(ndjson|log|txt)(\.gz)?$/.test(f) || rel.startsWith('analysis')) continue;
  const upload = /^[0-9a-f]{16}-part\d/.test(path.basename(f)) || /^run-[0-9a-f]{16}-part\d/.test(path.basename(f));
  if (upload && skipRuns.some((id) => path.basename(f).includes(id))) continue;
  let buf = fs.readFileSync(f);
  if (f.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  const keep = (l) => upload || !dropKinds.size || !dropKinds.has((l.match(/"k":"([a-z_]+)"/) || [])[1]);
  const out = buf.toString('utf8').split('\n').filter((l) => !l || keep(l)).map((l) => (l ? redactLine(l) : l)).join('\n');
  const dst = path.join(outDir, rel.replace(/\.gz$/, '') + '.gz');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, zlib.gzipSync(out, { level: 9 }));
  files++;
}
const kinds = { stations: deploy.stations.length, public_v4: n4, public_v6: n6 };
fs.writeFileSync(path.join(outDir, 'redaction.json'), JSON.stringify({ note: 'Public addresses replaced by labels; the mapping itself is kept only outside the repository.', counts: kinds }, null, 2));
fs.writeFileSync(path.join(rawDir, 'redaction-map.json'), JSON.stringify(Object.fromEntries(labels), null, 2));
console.log(`redacted ${files} file(s) into ${outDir}: ${JSON.stringify(kinds)}`);
