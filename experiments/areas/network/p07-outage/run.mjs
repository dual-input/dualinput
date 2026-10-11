// p07's runs. Endpoint A runs in a network namespace of its own on the Frankfurt droplet, `p07a`,
// behind a NAT that keeps its port, and endpoint B beside the New York relay, so the two connect
// directly with both relays as backup. An outage script on the Frankfurt droplet then drops every
// packet to and from the namespace, direct and relay alike, for 10s, 30s, 60s, and 120s, each
// followed by 90s with the link back, and logs the wall time of each change. A gets the lower
// endpoint ID, so A is the one that dials and redials. One run per timer setting, `default` and
// `v1`. Nothing here touches the stations' namespaces, their iptables chains, or the WAN
// interface's queueing rules.
//
//   node run.mjs <linux p07 binary> <raw-dir outside the repository> [default,v1]

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gen = path.join(here, '..', 'p03-home-networks', 'deploy', 'generated');
const hosts = JSON.parse(fs.readFileSync(path.join(gen, 'hosts.json'), 'utf8')).stations;
const ip = Object.fromEntries(hosts.map((h) => [h.name, h.ipv4]));
const [binary, rawDir, timersArg] = process.argv.slice(2);
if (!binary || !rawDir) throw new Error('usage: node run.mjs <p07 binary> <raw-dir> [default,v1]');
const timerSets = (timersArg || 'default,v1').split(',');
fs.mkdirSync(rawDir, { recursive: true });

const OUTAGES_S = [10, 30, 60, 120];
const LEAD_S = 30;
const RECOVERY_S = 90;
const RUN_S = LEAD_S + OUTAGES_S.reduce((a, d) => a + d + RECOVERY_S, 0) + 20;

const key = ['-i', path.join(gen, 'id_ed25519'), '-o', `UserKnownHostsFile=${path.join(gen, 'known_hosts')}`];
function ssh(h, cmd, allowFail = false) {
  const r = spawnSync('ssh', [...key, '-o', 'ConnectTimeout=15', `root@${ip[h]}`, 'bash -s'], { input: cmd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) throw new Error(`ssh ${h}: ${cmd.slice(0, 200)}: ${r.stderr}`);
  return r.stdout;
}
const scp = (args) => spawnSync('scp', [...key, ...args], { stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function friendLive() {
  const s = JSON.parse(ssh('fra', 'curl -sk https://127.0.0.1:4443/v1/status'));
  return (s.testers || []).filter((t) => t.seen_s < 60 && t.phase !== 'serving');
}

// An Ed25519 seed for iroh's `SecretKey::from_bytes`, and the public key that is its endpoint ID.
function keyPair() {
  const jwk = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  return { seed: Buffer.from(jwk.d, 'base64url').toString('hex'), id: Buffer.from(jwk.x, 'base64url').toString('hex') };
}

// The namespace, its veth pair, and a NAT rule in a chain of its own for traffic leaving the
// droplet. Linux's MASQUERADE keeps the source port where it's free, so A sits behind a NAT
// that keeps one public port for every destination, which hole punching gets through.
const SETUP = `
set -e
ip netns del p07a 2>/dev/null || true
ip link del p07h-a 2>/dev/null || true
ip netns add p07a
ip link add p07h-a type veth peer name eth0 netns p07a
ip addr add 10.212.0.1/24 dev p07h-a
ip link set p07h-a up
ip -n p07a addr add 10.212.0.2/24 dev eth0
ip -n p07a link set eth0 up
ip -n p07a link set lo up
ip -n p07a route add default via 10.212.0.1
WAN=$(ip -4 route show default | awk '{print $5; exit}')
iptables -t nat -N P07POST 2>/dev/null || iptables -t nat -F P07POST
iptables -t nat -C POSTROUTING -j P07POST 2>/dev/null || iptables -t nat -A POSTROUTING -j P07POST
iptables -t nat -A P07POST -s 10.212.0.0/24 -o "$WAN" -j MASQUERADE
mkdir -p /opt/p07/out
`;

// Drops everything both ways on the namespace's link, with the link itself left up, so neither
// endpoint's operating system reports a network change: a home connection that goes dead looks
// like this. The trap restores the link however the script ends.
const OUTAGE = `#!/bin/bash
out=$1
mark() { echo "$(date +%s%N) $1 $2" >> "$out"; }
down() { ip netns exec p07a tc qdisc replace dev eth0 root netem loss 100%; tc qdisc replace dev p07h-a root netem loss 100%; }
up() { ip netns exec p07a tc qdisc del dev eth0 root 2>/dev/null; tc qdisc del dev p07h-a root 2>/dev/null; true; }
trap up EXIT
up
mark start 0
sleep ${LEAD_S}
for d in ${OUTAGES_S.join(' ')}; do
  down; mark down $d
  sleep $d
  up; mark up $d
  sleep ${RECOVERY_S}
done
mark end 0
`;

ssh('fra', SETUP);
ssh('fra', `cat > /opt/p07/outage.sh <<'EOF'\n${OUTAGE}EOF\nchmod +x /opt/p07/outage.sh`);
for (const h of ['fra', 'nyc']) {
  ssh(h, 'mkdir -p /opt/p07/out');
  scp([binary, `root@${ip[h]}:/opt/p07/p07`]);
  ssh(h, 'chmod +x /opt/p07/p07');
}

for (const timers of timerSets) {
  while (friendLive().length) {
    console.log('a friend is mid-test; waiting 60s');
    await sleep(60_000);
  }
  const [lo, hi] = [keyPair(), keyPair()].sort((x, y) => (x.id < y.id ? -1 : 1));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const id = `${timers}-${stamp}`;
  console.log(`== ${id}, about ${RUN_S}s`);
  ssh('nyc', `pkill -x p07 || true; cd /opt/p07; nohup ./p07 listen --key ${hi.seed} --deploy /etc/p02/deploy.json --timers ${timers} --out out/${id}-B.ndjson > out/${id}-B.stdout 2>&1 < /dev/null &`);
  let addr = null;
  for (let i = 0; i < 40 && !addr; i++) {
    await sleep(500);
    const m = ssh('nyc', `cat /opt/p07/out/${id}-B.stdout`, true).match(/^ADDR (.+)$/m);
    if (m) addr = m[1];
  }
  if (!addr) throw new Error('listener printed no address');
  const b64 = Buffer.from(addr).toString('base64');
  ssh('fra', `pkill -x p07 || true; cd /opt/p07; nohup ip netns exec p07a ./p07 dial --key ${lo.seed} --deploy /etc/p02/deploy.json --timers ${timers} --peer ${b64} --secs ${RUN_S} --out out/${id}-A.ndjson > out/${id}-A.stdout 2>&1 < /dev/null &`);
  ssh('fra', `nohup /opt/p07/outage.sh /opt/p07/out/${id}-outage.txt > /dev/null 2>&1 < /dev/null &`);
  await sleep((RUN_S + 10) * 1000);
  ssh('nyc', 'pkill -x p07; true', true);
  ssh('fra', 'pkill -x p07; pkill -f /opt/p07/outage.sh; true', true);
  await sleep(2000);
  scp([`root@${ip.fra}:/opt/p07/out/${id}-A.ndjson`, path.join(rawDir, `${id}-A.ndjson`)]);
  scp([`root@${ip.fra}:/opt/p07/out/${id}-outage.txt`, path.join(rawDir, `${id}-outage.txt`)]);
  scp([`root@${ip.nyc}:/opt/p07/out/${id}-B.ndjson`, path.join(rawDir, `${id}-B.ndjson`)]);
}
ssh('fra', 'ip netns exec p07a tc qdisc del dev eth0 root 2>/dev/null; tc qdisc del dev p07h-a root 2>/dev/null; true', true);
console.log(`raw output in ${rawDir}`);
