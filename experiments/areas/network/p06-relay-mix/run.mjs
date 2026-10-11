// p06's runs. The lossy end, the dialer, runs in a network namespace of its own on the Frankfurt
// droplet, `p06a`, whose link alone carries `tc netem`; the listener runs beside the relay under
// test. Near: Frankfurt's relay, with 11ms added each way on the namespace's link for a pilot about
// 22ms away. Far: New York's relay, about 75ms away across the Atlantic. Nothing here touches the
// stations' namespaces, their iptables chains, or the WAN interface's queueing rules.
//
//   node run.mjs <linux p06 binary> <raw-dir outside the repository> [secs per run, default 60]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gen = path.join(here, '..', 'p03-home-networks', 'deploy', 'generated');
const hosts = JSON.parse(fs.readFileSync(path.join(gen, 'hosts.json'), 'utf8')).stations;
const ip = Object.fromEntries(hosts.map((h) => [h.name, h.ipv4]));
const [binary, rawDir, secsArg] = process.argv.slice(2);
const secs = Number(secsArg || 60);
if (!binary || !rawDir) throw new Error('usage: node run.mjs <p06 binary> <raw-dir> [secs]');
fs.mkdirSync(rawDir, { recursive: true });

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

// The namespace, its veth pair, and a NAT rule in a chain of its own for traffic leaving the
// droplet; a relay on the same droplet is reached by local delivery, which needs no NAT.
const SETUP = `
set -e
ip netns del p06a 2>/dev/null || true
ip link del p06h-a 2>/dev/null || true
ip netns add p06a
ip link add p06h-a type veth peer name eth0 netns p06a
ip addr add 10.211.0.1/24 dev p06h-a
ip link set p06h-a up
ip -n p06a addr add 10.211.0.2/24 dev eth0
ip -n p06a link set eth0 up
ip -n p06a link set lo up
ip -n p06a route add default via 10.211.0.1
WAN=$(ip -4 route show default | awk '{print $5; exit}')
iptables -t nat -N P06POST 2>/dev/null || iptables -t nat -F P06POST
iptables -t nat -C POSTROUTING -j P06POST 2>/dev/null || iptables -t nat -A POSTROUTING -j P06POST
iptables -t nat -A P06POST -s 10.211.0.0/24 -o "$WAN" -j MASQUERADE
mkdir -p /opt/p06/out
`;

function netem(delayMs, lossPct) {
  const d = delayMs ? `delay ${delayMs}ms` : '';
  return `ip netns exec p06a tc qdisc replace dev eth0 root netem ${d} loss ${lossPct}% limit 10000
tc qdisc replace dev p06h-a root netem ${d} loss ${lossPct}% limit 10000
echo "netem $(date +%s%N) delay=${delayMs} loss=${lossPct}"`;
}

ssh('fra', SETUP);
for (const h of ['fra', 'nyc']) {
  ssh(h, 'mkdir -p /opt/p06/out');
  scp([binary, `root@${ip[h]}:/opt/p06/p06`]);
  ssh(h, 'chmod +x /opt/p06/p06');
}

const relays = [
  { name: 'fra', label: 'near', delay: 11, listenerHost: 'fra' },
  { name: 'nyc', label: 'far', delay: 0, listenerHost: 'nyc' },
];
const runs = [];
for (const r of relays) for (const loss of [0, 1, 3]) for (const mix of ['quiet', 'busy']) for (const variant of ['a', 'b']) runs.push({ ...r, loss, mix, variant });

const events = [];
for (const run of runs) {
  while (friendLive().length) {
    console.log('a friend is mid-test; waiting 60s');
    await sleep(60_000);
  }
  const id = `${run.label}-${run.loss}pct-${run.mix}-${run.variant}`;
  console.log(`== ${id} ${new Date().toISOString()}`);
  events.push({ id, netem: ssh('fra', netem(run.delay, run.loss)).trim() });
  ssh(run.listenerHost, `pkill -x p06 || true; cd /opt/p06; nohup ./p06 listen --deploy /etc/p02/deploy.json --relay ${run.name} --variant ${run.variant} --out out/${id}-listen.ndjson > out/${id}-listen.stdout 2>&1 < /dev/null &`);
  let addr = null;
  for (let i = 0; i < 40 && !addr; i++) {
    await sleep(500);
    const m = ssh(run.listenerHost, `cat /opt/p06/out/${id}-listen.stdout`, true).match(/^ADDR (.+)$/m);
    if (m) addr = m[1];
  }
  if (!addr) {
    console.log(`  ${id}: listener printed no address; skipped`);
    continue;
  }
  const b64 = Buffer.from(addr).toString('base64');
  const out = ssh('fra', `cd /opt/p06; ip netns exec p06a ./p06 dial --deploy /etc/p02/deploy.json --relay ${run.name} --variant ${run.variant} --mix ${run.mix} --secs ${secs} --peer ${b64} --out out/${id}-dial.ndjson 2>&1 | tail -3`, true);
  if (out.trim()) console.log(`  dialer: ${out.trim()}`);
  await sleep(4000);
  for (const [h, role] of [[run.listenerHost, 'listen'], ['fra', 'dial']]) {
    scp([`root@${ip[h]}:/opt/p06/out/${id}-${role}.ndjson`, path.join(rawDir, `${id}-${role}.ndjson`)]);
  }
}
ssh('fra', netem(0, 0));
fs.writeFileSync(path.join(rawDir, 'netem-events.json'), JSON.stringify(events, null, 2));
console.log(`raw output in ${rawDir}`);
