// p02's stations: certificates, droplets, builds, pushes, status, collection, and teardown.
//
//   node deploy.mjs local                 a one-station bench in WSL, at WSL's address
//   node deploy.mjs create                two droplets, fra1 and nyc1, from DO_TOKEN
//   node deploy.mjs build                 the Linux binaries and the Windows tester and peer
//   node deploy.mjs push [name...]        copies the bundle to each station and runs setup.sh
//   node deploy.mjs status                each station's /v1/status
//   node deploy.mjs collect <dir>         each station's data and relay log, into <dir>
//   node deploy.mjs destroy               deletes the droplets and the SSH key
//   node deploy.mjs ssh <name> <cmd...>   runs one command on a station
//   node deploy.mjs script <name> <file>  runs a local shell script on a station
//
// Everything it makes goes in deploy/generated/, which git ignores: the droplets' addresses,
// our certificate authority and its key, the probe's SSH key, and deploy.json, the file the
// tester builds in. The DigitalOcean token comes from DO_TOKEN or generated/do-token.txt.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const gen = path.join(here, 'generated');
const bundle = path.join(gen, 'bundle');
fs.mkdirSync(gen, { recursive: true });

const TAG = 'crosscheck-p02';
const SIZE = 's-2vcpu-2gb';
const IMAGE = 'ubuntu-24-04-x64';
const REGIONS = [
  { name: 'fra', region: 'fra1', intro: true },
  { name: 'nyc', region: 'nyc1', intro: false },
];
const HOSTS = path.join(gen, 'hosts.json');
const KEY = path.join(gen, 'id_ed25519');
const KNOWN = path.join(gen, 'known_hosts');

function hosts() {
  return JSON.parse(fs.readFileSync(HOSTS, 'utf8'));
}

function token() {
  const t = process.env.DO_TOKEN || (fs.existsSync(path.join(gen, 'do-token.txt')) && fs.readFileSync(path.join(gen, 'do-token.txt'), 'utf8').trim());
  if (!t) throw new Error('set DO_TOKEN or write generated/do-token.txt');
  return t;
}

async function api(method, p, body) {
  const r = await fetch(`https://api.digitalocean.com/v2${p}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

function openssl() {
  const cands = ['openssl', path.join(process.env.USERPROFILE || '', 'scoop/apps/git/current/usr/bin/openssl.exe'), 'C:/Program Files/Git/usr/bin/openssl.exe'];
  for (const c of cands) {
    if (spawnSync(c, ['version']).status === 0) return c;
  }
  throw new Error('no openssl found');
}

// Our certificate authority, and one certificate per station naming its addresses, which the
// tester checks the relay and the API against. Certificates last 30 days, longer than the probe.
function certs(stations) {
  const o = openssl();
  const ca = path.join(gen, 'ca.crt');
  const caKey = path.join(gen, 'ca.key');
  if (!fs.existsSync(ca)) {
    execFileSync(o, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', caKey, '-out', ca, '-days', '30',
      '-subj', '/CN=Crosscheck p02 CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'inherit' });
  }
  for (const s of stations) {
    const key = path.join(gen, `${s.name}.key`);
    const csr = path.join(gen, `${s.name}.csr`);
    const crt = path.join(gen, `${s.name}.crt`);
    const ext = path.join(gen, `${s.name}.ext`);
    const sans = [`IP:${s.ipv4}`].concat(s.ipv6 ? [`IP:${s.ipv6}`] : []).join(',');
    fs.writeFileSync(ext, `subjectAltName=${sans}\nbasicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n`);
    execFileSync(o, ['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=p02 ${s.name}`], { stdio: 'inherit' });
    execFileSync(o, ['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', crt, '-days', '30', '-extfile', ext], { stdio: 'inherit' });
  }
}

function writeDeploy(stations, build) {
  const d = {
    build,
    ca_pem: fs.readFileSync(path.join(gen, 'ca.crt'), 'utf8'),
    stations: stations.map((s) => ({ name: s.name, ipv4: s.ipv4, ipv6: s.ipv6 || null, intro: !!s.intro })),
  };
  fs.writeFileSync(path.join(gen, 'deploy.json'), JSON.stringify(d, null, 2));
  console.log(`deploy.json: build ${build}, stations ${stations.map((s) => `${s.name} ${s.ipv4}`).join(', ')}`);
}

function buildId() {
  return new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
}

function zigEnv() {
  const z = process.env.P02_ZIG_DIR;
  return z ? { ...process.env, PATH: `${z}${path.delimiter}${process.env.PATH}` } : process.env;
}

function build() {
  const ws = path.join(root, 'Cargo.toml');
  const env = zigEnv();
  const run = (args) => {
    const r = spawnSync('cargo', args, { stdio: 'inherit', env });
    if (r.status !== 0) throw new Error(`cargo ${args.join(' ')} failed`);
  };
  run(['zigbuild', '--manifest-path', ws, '--release', '--target', 'x86_64-unknown-linux-gnu.2.35', '-p', 'p02-station', '-p', 'p02-peer']);
  const relaySrc = process.env.P02_RELAY_SRC;
  if (relaySrc) {
    run(['zigbuild', '--manifest-path', path.join(relaySrc, 'Cargo.toml'), '--target-dir', path.join(root, 'target', 'relay'), '--release', '--features', 'server', '--bin', 'iroh-relay', '--target', 'x86_64-unknown-linux-gnu.2.35']);
  }
  run(['build', '--manifest-path', ws, '--release', '-p', 'p02-tester', '-p', 'p02-peer']);
  fs.mkdirSync(bundle, { recursive: true });
  const lin = path.join(root, 'target', 'x86_64-unknown-linux-gnu', 'release');
  fs.copyFileSync(path.join(lin, 'p02-station'), path.join(bundle, 'p02-station'));
  fs.copyFileSync(path.join(lin, 'p02-peer'), path.join(bundle, 'p02-peer'));
  fs.copyFileSync(path.join(root, 'target', 'relay', 'x86_64-unknown-linux-gnu', 'release', 'iroh-relay'), path.join(bundle, 'iroh-relay'));
  fs.copyFileSync(path.join(here, 'setup.sh'), path.join(bundle, 'setup.sh'));
  fs.copyFileSync(path.join(gen, 'deploy.json'), path.join(bundle, 'deploy.json'));
  for (const f of fs.readdirSync(gen)) {
    if (/^(fra|nyc|local)\.(crt|key)$/.test(f)) fs.copyFileSync(path.join(gen, f), path.join(bundle, f));
  }
  console.log(`bundle ready in ${bundle}`);
}

function sshArgs(ip) {
  return ['-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${KNOWN}`, '-o', 'ConnectTimeout=15', `root@${ip}`];
}

function ssh(ip, cmd, opts = {}) {
  const r = spawnSync('ssh', [...sshArgs(ip), cmd], { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`ssh ${ip} '${cmd}' failed: ${r.stderr || ''}`);
  return r.stdout;
}

function scp(ip, files, dest) {
  const a = ['-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${KNOWN}`, ...files, `root@${ip}:${dest}`];
  const r = spawnSync('scp', a, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`scp to ${ip} failed`);
}

async function create() {
  if (fs.existsSync(HOSTS)) throw new Error('hosts.json exists; destroy first');
  if (!fs.existsSync(KEY)) execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', TAG, '-f', KEY], { stdio: 'inherit' });
  const pub = fs.readFileSync(`${KEY}.pub`, 'utf8').trim();
  const key = await api('POST', '/account/keys', { name: `${TAG}-${Date.now()}`, public_key: pub });
  const out = { ssh_key_id: key.ssh_key.id, stations: [] };
  for (const r of REGIONS) {
    const d = await api('POST', '/droplets', {
      name: `${TAG}-${r.name}`, region: r.region, size: SIZE, image: IMAGE, ipv6: true,
      ssh_keys: [key.ssh_key.id], tags: [TAG], monitoring: false,
    });
    out.stations.push({ name: r.name, region: r.region, intro: r.intro, droplet_id: d.droplet.id });
    console.log(`created droplet ${d.droplet.id} in ${r.region}`);
  }
  fs.writeFileSync(HOSTS, JSON.stringify(out, null, 2));
  for (;;) {
    let ready = true;
    for (const s of out.stations) {
      const d = (await api('GET', `/droplets/${s.droplet_id}`)).droplet;
      const v4 = d.networks.v4.find((n) => n.type === 'public');
      const v6 = d.networks.v6.find((n) => n.type === 'public');
      s.ipv4 = v4?.ip_address;
      s.ipv6 = v6?.ip_address;
      if (d.status !== 'active' || !s.ipv4) ready = false;
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 5000));
  }
  fs.writeFileSync(HOSTS, JSON.stringify(out, null, 2));
  certs(out.stations);
  writeDeploy(out.stations, buildId());
  console.log('droplets ready:', out.stations.map((s) => `${s.name} ${s.ipv4} ${s.ipv6 || ''}`).join('; '));
}

function push(names) {
  const h = hosts();
  for (const s of h.stations.filter((x) => !names.length || names.includes(x.name))) {
    for (let i = 0; i < 20; i++) {
      if (spawnSync('ssh', [...sshArgs(s.ipv4), 'true'], { stdio: 'ignore' }).status === 0) break;
      spawnSync(process.platform === 'win32' ? 'timeout' : 'sleep', process.platform === 'win32' ? ['/t', '5', '/nobreak'] : ['5'], { stdio: 'ignore' });
    }
    ssh(s.ipv4, 'mkdir -p /root/p02-bundle');
    scp(s.ipv4, fs.readdirSync(bundle).map((f) => path.join(bundle, f)), '/root/p02-bundle/');
    ssh(s.ipv4, `bash /root/p02-bundle/setup.sh ${s.name} ${s.ipv4} /root/p02-bundle`);
  }
}

async function status() {
  const h = hosts();
  for (const s of h.stations) {
    const out = ssh(s.ipv4, 'curl -sk https://127.0.0.1:4443/v1/status; echo; systemctl is-active p02-relay p02-station p02-peer@eim p02-peer@apdf p02-peer@sym | tr "\\n" " "', { capture: true, allowFail: true });
    console.log(`${s.name} ${s.ipv4}: ${out}`);
  }
}

function collect(dest) {
  if (!dest) throw new Error('collect needs a destination folder outside the repository');
  const h = hosts();
  fs.mkdirSync(dest, { recursive: true });
  for (const s of h.stations) {
    // tar exits 1 when a file grows while it reads it, which the station's live log always
    // does; that's a warning, and the archive holds the file up to that moment.
    ssh(s.ipv4, 'journalctl -u p02-relay -o json --no-pager > /var/lib/p02/relay-journal.ndjson; journalctl -u p02-station -u "p02-peer@*" -o short-iso --no-pager > /var/lib/p02/services.log; tar czf /root/p02-data.tgz -C /var/lib p02; [ $? -le 1 ]');
    const r = spawnSync('scp', ['-i', KEY, '-o', `UserKnownHostsFile=${KNOWN}`, `root@${s.ipv4}:/root/p02-data.tgz`, path.join(dest, `${s.name}-${buildId()}.tgz`)], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`scp from ${s.name} failed`);
  }
  console.log(`collected into ${dest}`);
}

async function destroy() {
  const h = hosts();
  for (const s of h.stations) {
    await api('DELETE', `/droplets/${s.droplet_id}`);
    console.log(`deleted droplet ${s.droplet_id} (${s.name})`);
  }
  if (h.ssh_key_id) await api('DELETE', `/account/keys/${h.ssh_key_id}`);
  fs.renameSync(HOSTS, path.join(gen, `hosts-destroyed-${buildId()}.json`));
}

// The bench: one station called fra at WSL's address, with the relay on 443 and the peers as
// plain processes when WSL has no iptables.
function local() {
  const ip = execFileSync('wsl', ['-d', 'Ubuntu', '-u', 'root', '--exec', 'hostname', '-I'], { encoding: 'utf8' }).trim().split(/\s+/)[0];
  const stations = [{ name: 'fra', ipv4: ip, ipv6: null, intro: true }];
  for (const f of ['fra.crt', 'fra.key']) fs.rmSync(path.join(gen, f), { force: true });
  certs(stations);
  writeDeploy(stations, `local-${buildId()}`);
  fs.writeFileSync(HOSTS + '.local', JSON.stringify({ stations }, null, 2));
  console.log(`bench station fra at ${ip}; run build, then: wsl -d Ubuntu -u root -- bash <bundle>/setup.sh fra ${ip} <bundle> --local`);
}

const [cmd, ...rest] = process.argv.slice(2);
// Runs a local shell script on a station through `bash -s`, which no Windows shell's quoting
// can mangle.
function script(name, file) {
  const s = hosts().stations.find((x) => x.name === name);
  const r = spawnSync('ssh', [...sshArgs(s.ipv4), 'bash -s'], { input: fs.readFileSync(file), stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) process.exitCode = r.status;
}

const cmds = {
  local, create, build, push: () => push(rest), status, collect: () => collect(rest[0]), destroy,
  ssh: () => ssh(hosts().stations.find((s) => s.name === rest[0]).ipv4, rest.slice(1).join(' ')),
  script: () => script(rest[0], rest[1]),
};
if (!cmds[cmd]) {
  console.log('usage: node deploy.mjs local|create|build|push|status|collect|destroy|ssh');
  process.exit(1);
}
await cmds[cmd]();
