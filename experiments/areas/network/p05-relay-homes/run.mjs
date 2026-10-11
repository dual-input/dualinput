// p05's run: the endpoint on the Frankfurt droplet homes at Frankfurt's relay and the one on the
// New York droplet at New York's; each dials the other in turn, and both droplets sample every
// relay socket's byte counters each second with `ss`, so the counters show which relay carried
// each direction. Everything runs in /opt/p05 beside the stations, on ports of its own.
//
//   node run.mjs <linux p05 binary> <raw-dir outside the repository>

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gen = path.join(here, '..', 'p03-home-networks', 'deploy', 'generated');
const hosts = JSON.parse(fs.readFileSync(path.join(gen, 'hosts.json'), 'utf8')).stations;
const ip = Object.fromEntries(hosts.map((h) => [h.name, h.ipv4]));
const [binary, rawDir] = process.argv.slice(2);
if (!binary || !rawDir) throw new Error('usage: node run.mjs <p05 binary> <raw-dir>');
fs.mkdirSync(rawDir, { recursive: true });

const sshBase = (h) => ['-i', path.join(gen, 'id_ed25519'), '-o', `UserKnownHostsFile=${path.join(gen, 'known_hosts')}`, '-o', 'ConnectTimeout=15', `root@${ip[h]}`];
function ssh(h, cmd, allowFail = false) {
  const r = spawnSync('ssh', [...sshBase(h), cmd], { encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw new Error(`ssh ${h}: ${cmd}: ${r.stderr}`);
  return r.stdout;
}
function scpTo(h, local, remote) {
  const r = spawnSync('scp', ['-i', path.join(gen, 'id_ed25519'), '-o', `UserKnownHostsFile=${path.join(gen, 'known_hosts')}`, local, `root@${ip[h]}:${remote}`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('scp failed');
}
function scpFrom(h, remote, local) {
  spawnSync('scp', ['-i', path.join(gen, 'id_ed25519'), '-o', `UserKnownHostsFile=${path.join(gen, 'known_hosts')}`, `root@${ip[h]}:${remote}`, local], { stdio: 'inherit' });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A friend's run in its first five steps uses the stations' relays and loss injection; serving
// testers and the always-on peer only answer side tests, which p05 doesn't touch.
function friendLive() {
  const s = JSON.parse(ssh('fra', 'curl -sk https://127.0.0.1:4443/v1/status'));
  return (s.testers || []).filter((t) => t.seen_s < 60 && t.phase !== 'serving');
}

for (const h of ['fra', 'nyc']) {
  ssh(h, 'mkdir -p /opt/p05/out');
  scpTo(h, binary, '/opt/p05/p05');
  ssh(h, 'chmod +x /opt/p05/p05');
}

const runs = [
  { label: 'fra-dials-nyc', dialer: 'fra', listener: 'nyc' },
  { label: 'nyc-dials-fra', dialer: 'nyc', listener: 'fra' },
];
const names = { fra: 'A', nyc: 'B' };
for (const run of runs) {
  while (friendLive().length) {
    console.log('a friend is mid-test; waiting 60s');
    await sleep(60_000);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const id = `${run.label}-${stamp}`;
  console.log(`== ${id}`);
  // A background command keeps SSH's session open unless all three of its streams are
  // redirected, and `a && b &` backgrounds a whole subshell that keeps them, so each background
  // command stands alone after a `;`.
  for (const h of ['fra', 'nyc']) {
    ssh(h, `nohup bash -c 'for i in $(seq 1 75); do echo "@ $(date +%s%N)"; ss -tinpH "( dport = :443 or sport = :443 )"; sleep 1; done' > /opt/p05/out/ss-${id}-${h}.txt 2>&1 < /dev/null &`);
  }
  ssh(run.listener, `cd /opt/p05; nohup ./p05 listen --name ${names[run.listener]} --deploy /etc/p02/deploy.json --out out/${id}-${run.listener}.ndjson > out/${id}-${run.listener}.stdout 2>&1 < /dev/null &`);
  let addr = null;
  for (let i = 0; i < 40 && !addr; i++) {
    await sleep(500);
    const out = ssh(run.listener, `cat /opt/p05/out/${id}-${run.listener}.stdout`, true);
    const m = out.match(/^ADDR (.+)$/m);
    if (m) addr = m[1];
  }
  if (!addr) throw new Error('listener printed no address');
  const b64 = Buffer.from(addr).toString('base64');
  ssh(run.dialer, `cd /opt/p05 && ./p05 dial --name ${names[run.dialer]} --deploy /etc/p02/deploy.json --out out/${id}-${run.dialer}.ndjson --peer ${b64} --secs 10`);
  await sleep(3000);
  ssh(run.listener, 'pkill -x p05; true', true);
  await sleep(48_000);
  for (const h of ['fra', 'nyc']) {
    for (const f of [`ss-${id}-${h}.txt`, `${id}-${h}.ndjson`]) scpFrom(h, `/opt/p05/out/${f}`, path.join(rawDir, f));
  }
}
console.log(`raw output in ${rawDir}`);
