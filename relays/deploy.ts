// Deploys Dual Input's relays: renders each relay's iroh-relay configuration from its entry in
// relays.toml and its tokens, installs it with n0's build of iroh-relay over SSH, restarts the
// relay, and checks that it answers over HTTPS (record/areas/network/02-units.md, "Their
// configuration").
//
//   node relays/deploy.ts render <region>     prints the relay's configuration
//   node relays/deploy.ts <region>...         deploys each relay
//
// Both read the tokens from a clone of the private repository dual-input/relay-tokens, which
// DUALINPUT_RELAY_TOKENS names, as the network crate's build does, and the address Let's Encrypt
// writes to about the relays' certificates from DUALINPUT_RELAY_CONTACT, since no file in this
// repository may hold an email address. Deploying reaches each relay as root@<its host> through
// your own SSH key, on a droplet running Ubuntu 24.04 whose host name already points at it, with
// TCP 80 and 443 and UDP 7842 open.
//
// A restart drops every relayed connection through the relay until a redial lands, so deploy
// at a quiet hour, and deploy a new token to every relay before the release that carries it
// (record/areas/network/01-between-machines.md, "The relays").

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

import { parse } from "./toml.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** n0's own build of the iroh-relay that Cargo.lock pins, as GitHub's release lists it. */
const RELEASE = {
  url: "https://github.com/n0-computer/iroh/releases/download/v1.3.0/iroh-relay-v1.3.0-x86_64-unknown-linux-musl.tar.gz",
  sha256: "677f4c62342a6ba8044459b5fd4302f2b1dcb8402542072e3a4ade5039bc0b9e",
  version: "1.3.0",
}

/**
 * How long a restarted relay has to answer `/ping` over HTTPS. iroh-relay orders its
 * certificate from Let's Encrypt only once it runs, so a relay whose DNS or port 443 is wrong
 * runs and never answers.
 */
const ANSWER_WITHIN_MS = 60_000

export type Relay = { region: string; url: string; cap: number; tokens: string[] }

/** Each relay in relays.toml, with its tokens, newest first, from tokens.toml. */
export function relays(list: string, tokens: string): Relay[] {
  const byRegion = parse(tokens).top
  return (parse(list).tables.get("relay") ?? []).map((t) => {
    const region = t.get("region")
    const url = t.get("url")
    const cap = t.get("cap")
    if (typeof region !== "string" || typeof url !== "string" || typeof cap !== "number") {
      throw new Error("each relay in relays.toml needs a region, a URL, and a cap")
    }
    const held = byRegion.get(region)
    if (!Array.isArray(held) || held.length === 0) throw new Error(`tokens.toml holds no token for the relay ${region}`)
    return { region, url, cap, tokens: held }
  })
}

/**
 * The relay's iroh-relay configuration (read in iroh-relay 1.3.0, src/main.rs, `Config`):
 * HTTPS on 443 with a certificate iroh-relay keeps from Let's Encrypt, which refuses to start
 * without a hostname and a contact (`load_cert_config`), QUIC address discovery on UDP 7842,
 * only clients that present one of its tokens, and the cap on what each client sends it.
 */
export function render(relay: Relay, contact: string): string {
  const host = new URL(relay.url).hostname
  return [
    `# Written by relays/deploy.ts from relays/relays.toml; edit that file, not this one.`,
    `enable_relay = true`,
    `http_bind_addr = "[::]:80"`,
    `enable_quic_addr_discovery = true`,
    `enable_metrics = false`,
    `access.shared_token = [${relay.tokens.map((t) => JSON.stringify(t)).join(", ")}]`,
    ``,
    `[tls]`,
    `cert_mode = "LetsEncrypt"`,
    `hostname = ${JSON.stringify(host)}`,
    `contact = ${JSON.stringify(contact)}`,
    `cert_dir = "/var/lib/iroh-relay/certs"`,
    `prod_tls = true`,
    ``,
    `[limits.client.rx]`,
    `bytes_per_second = ${relay.cap}`,
    ``,
  ].join("\n")
}

/**
 * What runs on the relay, as root: keep the running iroh-relay and configuration as the
 * previous ones, install iroh-relay unless it's there, then the configuration and the service.
 */
export function script(relay: Relay, contact: string): string {
  return `set -euo pipefail
id -u iroh-relay >/dev/null 2>&1 || useradd --system --home-dir /var/lib/iroh-relay --create-home iroh-relay
install -d -m 750 -o root -g iroh-relay /etc/iroh-relay
[ -f /usr/local/bin/iroh-relay ] && cp -p /usr/local/bin/iroh-relay /usr/local/bin/iroh-relay.previous
[ -f /etc/iroh-relay/config.toml ] && cp -p /etc/iroh-relay/config.toml /etc/iroh-relay/config.toml.previous
if ! /usr/local/bin/iroh-relay --version 2>/dev/null | grep -q ' ${RELEASE.version}$'; then
  rm -rf /tmp/iroh-relay && mkdir /tmp/iroh-relay
  curl -fsSL ${RELEASE.url} -o /tmp/iroh-relay/release.tar.gz
  echo "${RELEASE.sha256}  /tmp/iroh-relay/release.tar.gz" | sha256sum -c -
  tar -xzf /tmp/iroh-relay/release.tar.gz -C /tmp/iroh-relay
  for f in /tmp/iroh-relay/iroh-relay /tmp/iroh-relay/*/iroh-relay; do [ -f "$f" ] && install -m 755 "$f" /usr/local/bin/iroh-relay && break; done
  /usr/local/bin/iroh-relay --version | grep -q ' ${RELEASE.version}$' || { echo "the release held no iroh-relay ${RELEASE.version}"; exit 1; }
fi
cat > /etc/iroh-relay/config.toml.new <<'CONFIG'
${render(relay, contact)}CONFIG
install -m 640 -o root -g iroh-relay /etc/iroh-relay/config.toml.new /etc/iroh-relay/config.toml
rm /etc/iroh-relay/config.toml.new
cat > /etc/systemd/system/iroh-relay.service <<'UNIT'
[Unit]
Description=Dual Input's relay, iroh-relay ${RELEASE.version}
After=network-online.target
Wants=network-online.target
[Service]
User=iroh-relay
AmbientCapabilities=CAP_NET_BIND_SERVICE
WorkingDirectory=/var/lib/iroh-relay
ExecStart=/usr/local/bin/iroh-relay --config-path /etc/iroh-relay/config.toml
Restart=always
RestartSec=2
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable iroh-relay >/dev/null
systemctl restart iroh-relay
`
}

/** What runs on a relay that didn't answer: its previous iroh-relay and configuration, if it had any. */
const ROLLBACK = `set -euo pipefail
if [ -f /etc/iroh-relay/config.toml.previous ]; then
  cp -p /etc/iroh-relay/config.toml.previous /etc/iroh-relay/config.toml
  [ -f /usr/local/bin/iroh-relay.previous ] && cp -p /usr/local/bin/iroh-relay.previous /usr/local/bin/iroh-relay
  systemctl restart iroh-relay
  echo "the previous iroh-relay and configuration are back"
else
  echo "the relay had no previous configuration to go back to"
fi
journalctl -u iroh-relay -n 20 --no-pager
`

function ssh(host: string, script: string): number | null {
  return spawnSync("ssh", ["-o", "BatchMode=yes", `root@${host}`, "bash -s"], { input: script, stdio: ["pipe", "inherit", "inherit"] }).status
}

/** Whether the relay answers `/ping` over HTTPS with a certificate Node trusts, within the minute. */
async function answers(relay: Relay): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < ANSWER_WITHIN_MS) {
    try {
      if ((await fetch(new URL("/ping", relay.url), { signal: AbortSignal.timeout(5_000) })).ok) return true
    } catch {
      // Not up yet, or no certificate yet.
    }
    await sleep(3_000)
  }
  return false
}

async function deploy(relay: Relay, contact: string): Promise<void> {
  const host = new URL(relay.url).hostname
  console.log(`> deploying ${relay.region} to root@${host}`)
  const installed = ssh(host, script(relay, contact)) === 0
  if (installed && (await answers(relay))) return console.log(`> ${relay.region} answers at ${relay.url}`)
  console.log(`> ${relay.region} ${installed ? `didn't answer over HTTPS within ${ANSWER_WITHIN_MS / 1000}s` : "didn't install"}; putting its previous iroh-relay back`)
  ssh(host, ROLLBACK)
  throw new Error(`deploying ${relay.region} failed`)
}

async function main(args: string[]): Promise<void> {
  const folder = process.env.DUALINPUT_RELAY_TOKENS
  if (!folder) throw new Error("set DUALINPUT_RELAY_TOKENS to a clone of dual-input/relay-tokens")
  const contact = process.env.DUALINPUT_RELAY_CONTACT
  if (!contact) throw new Error("set DUALINPUT_RELAY_CONTACT to the address Let's Encrypt writes to about the relays' certificates")
  const all = relays(fs.readFileSync(path.join(HERE, "relays.toml"), "utf8"), fs.readFileSync(path.join(folder, "tokens.toml"), "utf8"))
  const named = (region: string) => {
    const relay = all.find((r) => r.region === region)
    if (!relay) throw new Error(`relays.toml has no relay ${region}; it has ${all.map((r) => r.region).join(", ")}`)
    return relay
  }
  if (args[0] === "render" && args[1]) return void process.stdout.write(render(named(args[1]), contact))
  if (args.length === 0) throw new Error("usage: node relays/deploy.ts render <region> | node relays/deploy.ts <region>...")
  for (const region of args) await deploy(named(region), contact)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
