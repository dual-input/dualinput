// Deploys Dual Input's relays: renders each relay's iroh-relay configuration from its entry in
// relays.toml and its tokens, installs it with n0's build of iroh-relay over SSH, and restarts
// the relay (record/areas/network/02-units.md, "Their configuration").
//
//   node relays/deploy.ts render <region>     prints the relay's configuration
//   node relays/deploy.ts <region>...         deploys each relay
//
// Both read the tokens from a clone of the private repository dual-input/relay-tokens, which
// DUALINPUT_RELAY_TOKENS names, as the network crate's build does. Deploying reaches each relay
// as root@<its host> through your own SSH key, on a droplet running Ubuntu 24.04 whose host
// name already points at it, with TCP 80 and 443 and UDP 7842 open.
//
// A restart drops every relayed connection through the relay until a redial lands, so deploy
// at a quiet hour, and deploy a new token to every relay before the release that carries it
// (record/areas/network/01-between-machines.md, "The relays").

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { parse } from "./toml.ts"

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** n0's own build of the iroh-relay that Cargo.lock pins, as GitHub's release lists it. */
const RELEASE = {
  url: "https://github.com/n0-computer/iroh/releases/download/v1.3.0/iroh-relay-v1.3.0-x86_64-unknown-linux-musl.tar.gz",
  sha256: "677f4c62342a6ba8044459b5fd4302f2b1dcb8402542072e3a4ade5039bc0b9e",
  version: "1.3.0",
}

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
 * HTTPS on 443 with a certificate iroh-relay keeps from Let's Encrypt, QUIC address discovery
 * on UDP 7842, only clients that present one of its tokens, and the cap on what each client
 * sends it.
 */
export function render(relay: Relay): string {
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
    `cert_dir = "/var/lib/iroh-relay/certs"`,
    `prod_tls = true`,
    ``,
    `[limits.client.rx]`,
    `bytes_per_second = ${relay.cap}`,
    ``,
  ].join("\n")
}

/** What runs on the relay, as root: install iroh-relay unless it's there, then the configuration and the service. */
export function script(relay: Relay): string {
  return `set -euo pipefail
id -u iroh-relay >/dev/null 2>&1 || useradd --system --home-dir /var/lib/iroh-relay --create-home iroh-relay
if ! /usr/local/bin/iroh-relay --version 2>/dev/null | grep -q ' ${RELEASE.version}$'; then
  rm -rf /tmp/iroh-relay && mkdir /tmp/iroh-relay
  curl -fsSL ${RELEASE.url} -o /tmp/iroh-relay/release.tar.gz
  echo "${RELEASE.sha256}  /tmp/iroh-relay/release.tar.gz" | sha256sum -c -
  tar -xzf /tmp/iroh-relay/release.tar.gz -C /tmp/iroh-relay
  for f in /tmp/iroh-relay/iroh-relay /tmp/iroh-relay/*/iroh-relay; do [ -f "$f" ] && install -m 755 "$f" /usr/local/bin/iroh-relay && break; done
  /usr/local/bin/iroh-relay --version
fi
install -d -m 750 -o root -g iroh-relay /etc/iroh-relay
cat > /etc/iroh-relay/config.toml.new <<'CONFIG'
${render(relay)}CONFIG
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
sleep 2
systemctl is-active iroh-relay
`
}

function deploy(relay: Relay): void {
  const host = new URL(relay.url).hostname
  console.log(`> deploying ${relay.region} to root@${host}`)
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", `root@${host}`, "bash -s"], { input: script(relay), stdio: ["pipe", "inherit", "inherit"] })
  if (result.status !== 0) throw new Error(`deploying ${relay.region} exited with ${result.status}`)
}

function main(args: string[]): void {
  const folder = process.env.DUALINPUT_RELAY_TOKENS
  if (!folder) throw new Error("set DUALINPUT_RELAY_TOKENS to a clone of dual-input/relay-tokens")
  const all = relays(fs.readFileSync(path.join(HERE, "relays.toml"), "utf8"), fs.readFileSync(path.join(folder, "tokens.toml"), "utf8"))
  const named = (region: string) => {
    const relay = all.find((r) => r.region === region)
    if (!relay) throw new Error(`relays.toml has no relay ${region}; it has ${all.map((r) => r.region).join(", ")}`)
    return relay
  }
  if (args[0] === "render" && args[1]) return void process.stdout.write(render(named(args[1])))
  if (args.length === 0) throw new Error("usage: node relays/deploy.ts render <region> | node relays/deploy.ts <region>...")
  for (const region of args) deploy(named(region))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
