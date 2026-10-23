// The droplet run: v1's busy mix between two of tools/bench/droplet's programs over a direct
// path, at 0%, 1%, and 3% loss through `tc netem`, as p06 ran it, from the Frankfurt droplet to
// itself and to the New York droplet (record/areas/network/02-units.md, "Cases for the bench").
// It runs one build of the program, under a name of your choosing, and prints the report of
// every build in the folder, so a second build run into the same folder sits beside the first.
//
//   node tools/bench/droplet/run.ts <program> <build> <Frankfurt host> <New York host> <folder> [secs]
//
// <program> is tools/bench/droplet built for x86_64-unknown-linux-musl, which runs on the
// droplets' Ubuntu whatever its glibc. The run reaches each droplet as root@<host> through your
// own SSH key, as src/relays/deploy.ts does, and needs TCP 3340, the listener's relay, and UDP
// open between the two droplets. Each run takes <secs>, 60 unless given, plus about 15s.
//
// The dialer, which sends the mix, runs in a network namespace of its own on the Frankfurt
// droplet, whose link alone carries `tc netem`, losing packets each way at the run's rate. A near
// run's listener runs on the Frankfurt droplet itself, with 11ms added each way on the
// namespace's link for a pilot about 22ms away; a far run's runs on the New York droplet, about
// 80ms away across the Atlantic. The run leaves each droplet as it found it: it touches no
// iptables chain but its own, and puts back IP forwarding, which the namespace's way out needs.

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

import { report } from "./report.ts"

const NAMESPACE = "droplet"
/** Where the program and each run's folders go on the droplets. */
const REMOTE = "/opt/dualinput-droplet"

const SETUP = `set -e
modprobe sch_netem
[ -f /run/droplet-ip-forward ] || cat /proc/sys/net/ipv4/ip_forward > /run/droplet-ip-forward
sysctl -qw net.ipv4.ip_forward=1
ip netns del ${NAMESPACE} 2>/dev/null || true
ip link del ${NAMESPACE}-h 2>/dev/null || true
ip netns add ${NAMESPACE}
ip link add ${NAMESPACE}-h type veth peer name eth0 netns ${NAMESPACE}
ip addr add 10.213.0.1/24 dev ${NAMESPACE}-h
ip link set ${NAMESPACE}-h up
ip -n ${NAMESPACE} addr add 10.213.0.2/24 dev eth0
ip -n ${NAMESPACE} link set eth0 up
ip -n ${NAMESPACE} link set lo up
ip -n ${NAMESPACE} route add default via 10.213.0.1
WAN=$(ip -4 route show default | awk '{print $5; exit}')
iptables -t nat -N DROPLET 2>/dev/null || iptables -t nat -F DROPLET
iptables -t nat -C POSTROUTING -j DROPLET 2>/dev/null || iptables -t nat -A POSTROUTING -j DROPLET
iptables -t nat -A DROPLET -s 10.213.0.0/24 -o "$WAN" -j MASQUERADE
`

const TEARDOWN = `pkill -x bench-droplet
ip netns del ${NAMESPACE} 2>/dev/null
ip link del ${NAMESPACE}-h 2>/dev/null
iptables -t nat -D POSTROUTING -j DROPLET 2>/dev/null
iptables -t nat -F DROPLET 2>/dev/null
iptables -t nat -X DROPLET 2>/dev/null
[ -f /run/droplet-ip-forward ] && sysctl -qw net.ipv4.ip_forward=$(cat /run/droplet-ip-forward) && rm /run/droplet-ip-forward
true
`

/** The namespace's link, on both its ends, delaying and losing packets each way. */
function netem(delayMs: number, lossPct: number): string {
  const rule = `${delayMs ? `delay ${delayMs}ms ` : ""}loss ${lossPct}% limit 10000`
  return `set -e
ip netns exec ${NAMESPACE} tc qdisc replace dev eth0 root netem ${rule}
tc qdisc replace dev ${NAMESPACE}-h root netem ${rule}
`
}

/** The droplet's address on the internet, which its own address on the default route is. */
const ADDRESS = `ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}'`

function ssh(host: string, script: string, allowFail = false): string {
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", `root@${host}`, "bash -s"], { input: script, encoding: "utf8" })
  if (r.status !== 0 && !allowFail) throw new Error(`root@${host} failed at: ${script.split("\n")[0]}\n${r.stderr}`)
  return r.stdout
}

function scp(args: string[]): void {
  const r = spawnSync("scp", ["-q", "-o", "BatchMode=yes", ...args], { stdio: "inherit" })
  if (r.status !== 0) throw new Error(`scp ${args.join(" ")} failed`)
}

type Where = { name: string; host: string; delayMs: number }

async function once(where: Where, lossPct: number, fra: string, secs: number, folder: string): Promise<void> {
  const id = `${where.name}-${lossPct}pct`
  console.log(`> ${id}, ${new Date().toISOString()}`)
  ssh(fra, netem(where.delayMs, lossPct))
  ssh(
    where.host,
    `cd ${REMOTE} && rm -rf ${id} && mkdir -p ${id}/listen && pkill -x bench-droplet; nohup ./bench-droplet listen ${id}/listen $(${ADDRESS}) ${secs} > ${id}/listen/stdout 2> ${id}/listen/log < /dev/null &`,
  )
  let peer: string | undefined
  for (let i = 0; i < 40 && !peer; i++) {
    await sleep(500)
    peer = /^peer (.+)$/m.exec(ssh(where.host, `cat ${REMOTE}/${id}/listen/stdout`, true))?.[1]
  }
  if (!peer) throw new Error(`the ${where.name} listener printed no peer line; see ${REMOTE}/${id}/listen/log on root@${where.host}`)
  ssh(fra, `cd ${REMOTE} && rm -rf ${id}/dial && mkdir -p ${id}/dial && ip netns exec ${NAMESPACE} timeout ${secs + 60} ./bench-droplet dial ${id}/dial ${peer} ${secs} 2> ${id}/dial/log`, true)
  ssh(where.host, `for i in $(seq 1 30); do pgrep -x bench-droplet >/dev/null || exit 0; sleep 1; done; echo "the listener ran past its mix"`, true)
  const into = path.join(folder, id)
  fs.mkdirSync(into, { recursive: true })
  scp(["-r", `root@${where.host}:${REMOTE}/${id}/listen`, into])
  scp(["-r", `root@${fra}:${REMOTE}/${id}/dial`, into])
}

async function main(args: string[]): Promise<void> {
  const [program, build, fra, nyc, folder, secsArg] = args
  if (!program || !build || !fra || !nyc || !folder) {
    throw new Error("usage: node tools/bench/droplet/run.ts <program> <build> <Frankfurt host> <New York host> <folder> [secs]")
  }
  const secs = Number(secsArg ?? 60)
  const into = path.join(folder, build)
  if (fs.existsSync(into)) throw new Error(`${into} already holds a run of the build ${build}; name the build anew or move it`)
  for (const host of [fra, nyc]) {
    ssh(host, `mkdir -p ${REMOTE}`)
    scp([program, `root@${host}:${REMOTE}/bench-droplet`])
    ssh(host, `chmod +x ${REMOTE}/bench-droplet`)
  }
  ssh(fra, SETUP)
  try {
    const places: Where[] = [
      { name: "near", host: fra, delayMs: 11 },
      { name: "far", host: nyc, delayMs: 0 },
    ]
    for (const where of places) for (const loss of [0, 1, 3]) await once(where, loss, fra, secs, into)
  } finally {
    ssh(fra, TEARDOWN, true)
    ssh(nyc, `pkill -x bench-droplet; true`, true)
  }
  console.log(report(folder))
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
