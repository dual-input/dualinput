// A live view of p02 in the console: which testers are running, their step, how long they've
// run, the peers each station hears from, and the uploads that have arrived. It only reads the
// stations' /v1/status and lists the upload folder over SSH, so it disturbs nothing.
//
//   node watch.mjs [seconds between refreshes, default 5]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gen = path.join(here, 'generated');
const deploy = JSON.parse(fs.readFileSync(path.join(gen, 'deploy.json'), 'utf8'));
const every = Number(process.argv[2] || 5) * 1000;
process.title = 'p02 live view';

// What each phase a tester reports means, in the window's own step numbers.
const PHASES = {
  checks: '1/5 router checks',
  burst: '2/5 full upload',
  connect: '3/5 connecting to peers',
  switch: '4/5 losing the direct link',
  relay: '5/5 relay servers',
  serving: 'done, serving as a peer',
};

function status(st) {
  return new Promise((resolve) => {
    const req = https.get(
      { host: st.ipv4, port: 4443, path: '/v1/status', ca: deploy.ca_pem, timeout: 4000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ error: `bad answer (${res.statusCode})` });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (e) => resolve({ error: e.message }));
  });
}

let uploads = [];
let uploadsAt = 0;
function listUploads() {
  const intro = deploy.stations.find((s) => s.intro) || deploy.stations[0];
  const r = spawnSync(
    'ssh',
    ['-i', path.join(gen, 'id_ed25519'), '-o', `UserKnownHostsFile=${path.join(gen, 'known_hosts')}`, '-o', 'ConnectTimeout=5', `root@${intro.ipv4}`, 'ls -l --time-style=+%s /var/lib/p02/uploads/'],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return;
  uploads = r.stdout
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 7 && p[6].endsWith('.gz'))
    .map((p) => ({ size: Number(p[4]), at: Number(p[5]) * 1000, name: p[6] }));
  uploadsAt = Date.now();
}

const dur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`);
const clock = (ms) => new Date(ms).toLocaleTimeString();

async function draw() {
  const res = await Promise.all(deploy.stations.map(status));
  if (Date.now() - uploadsAt > 30_000) listUploads();
  const now = Date.now();
  const out = [`Crosscheck network test: live view   ${clock(now)}   (build ${deploy.build}, refresh ${every / 1000}s, Ctrl+C to quit)`, ''];

  // The intro station hears every tester's registration; the others only their own.
  const testers = new Map();
  for (const r of res) for (const t of r.testers || []) {
    const prev = testers.get(t.run_id);
    if (!prev || t.seen_s < prev.seen_s) testers.set(t.run_id, t);
  }
  const live = [...testers.values()].filter((t) => t.seen_s < 60);
  const gone = [...testers.values()].filter((t) => t.seen_s >= 60);
  out.push(`TESTERS RUNNING NOW: ${live.length}`);
  if (live.length) {
    out.push('  run               near  step                          running   last heard');
    for (const t of live.sort((a, b) => a.run_id.localeCompare(b.run_id))) {
      const started = parseInt(t.run_id.slice(0, 10), 16) * 1000;
      out.push(`  ${t.run_id}  ${t.near.padEnd(4)}  ${(PHASES[t.phase] || t.phase).padEnd(28)}  ${dur((now - started) / 1000).padEnd(8)}  ${t.seen_s}s ago`);
    }
  }
  out.push('');
  out.push('PEERS EACH STATION HEARS FROM (seconds since last poll)');
  deploy.stations.forEach((st, i) => {
    const r = res[i];
    if (r.error) out.push(`  ${st.name}: unreachable: ${r.error}`);
    else out.push(`  ${st.name}: ${(r.peers || []).sort().map(([n, s]) => `${n} ${s}s${s > 60 ? ' (quiet!)' : ''}`).join('   ')}`);
  });
  out.push('');
  const runs = new Map();
  for (const u of uploads) {
    const m = u.name.match(/^([0-9a-f]{16})-part(\d)/);
    if (!m) continue;
    const e = runs.get(m[1]) || { parts: [], at: 0, size: 0 };
    e.parts.push(m[2]);
    e.at = Math.max(e.at, u.at);
    e.size += u.size;
    runs.set(m[1], e);
  }
  out.push(`UPLOADS RECEIVED: ${runs.size} run(s)`);
  for (const [id, e] of [...runs].sort((a, b) => b[1].at - a[1].at)) {
    out.push(`  ${id}  part ${e.parts.sort().join('+')}  ${(e.size / 1e6).toFixed(1)} MB  at ${clock(e.at)}`);
  }
  const stopped = gone.filter((t) => t.phase !== 'serving' && !runs.has(t.run_id));
  if (stopped.length) {
    out.push('');
    out.push('STOPPED MID-TEST, NOTHING UPLOADED YET (it retries on its next launch):');
    for (const t of stopped) out.push(`  ${t.run_id}  last heard ${dur(t.seen_s)} ago in ${PHASES[t.phase] || t.phase}`);
  }
  process.stdout.write('\x1b[2J\x1b[H' + out.join('\n') + '\n');
}

await draw();
setInterval(draw, every);
