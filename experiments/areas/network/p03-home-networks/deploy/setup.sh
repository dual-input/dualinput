#!/usr/bin/env bash
# Sets up one p02 station on a fresh Ubuntu 24.04 droplet, as root: iroh-relay on TCP 443 and
# UDP 7842, the station, and three peers, each in a network namespace behind a NAT this script
# builds from iptables rules. Running it again replaces everything it made.
#
# Usage: setup.sh <station-name> <public-ipv4> <bundle-dir> [--local]
#   --local is for a test bench such as WSL: it skips apt and systemd, starts the programs in
#   the background, and, where iptables is missing, runs the peers without namespaces or NATs.
#
# The three NATs, each keeping its peer's ports in its own range:
#   eim   10.201.0.2  ports 20000-20999  keeps one public port for every destination and
#                                        lets anyone send to it (DNAT over the range)
#   apdf  10.202.0.2  ports 21000-21999  keeps one public port for every destination and lets
#                                        in only replies from where it sent (plain MASQUERADE)
#   sym   10.203.0.2  ports 22000-22999  picks a new public port, from 23000-29999, for each
#                                        destination (MASQUERADE --random-fully)
# A peer reaching the relay or the station on this same host crosses the NAT too: the nat
# table's INPUT chain gives it the public address, so the relay sees the address a peer
# behind a real NAT would show.
set -euo pipefail

NAME="$1"
PUB="$2"
B="$3"
MODE="${4:-}"
WAN=$(ip -4 route show default | awk '{print $5; exit}')

if [ "$MODE" != "--local" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q chrony tcpdump iproute2 iptables
  apt-get install -y -q "linux-modules-extra-$(uname -r)" || true
fi
modprobe ifb numifbs=1 || true
modprobe sch_netem || true
modprobe sch_htb || true

SYSTEMD=0
if [ -d /run/systemd/system ] && [ "$MODE" != "--local" ]; then
  SYSTEMD=1
  systemctl stop p02-station p02-relay 'p02-peer@*' 2>/dev/null || true
else
  pkill -f /opt/p02/ 2>/dev/null || true
  sleep 1
fi
NAT=1
if ! command -v iptables >/dev/null; then
  NAT=0
  echo "no iptables: the peers run without namespaces or NATs"
fi

install -d /opt/p02 /etc/p02 /var/lib/p02 /var/lib/p02/peers
install -m 755 "$B/p02-station" "$B/p02-peer" "$B/iroh-relay" /opt/p02/
install -m 644 "$B/deploy.json" /etc/p02/deploy.json
install -m 644 "$B/$NAME.crt" /etc/p02/relay.crt
install -m 600 "$B/$NAME.key" /etc/p02/relay.key

sysctl -qw net.ipv4.ip_forward=1

nat_setup() {
# The host end is named p02h-*, because systemd-networkd's 80-container-ve.network claims
# every link named ve-* for systemd-nspawn, replacing its address with a DHCP pool.
ns() {
  local short=$1 idx=$2
  local n="p02-$short"
  local h="p02h-$short"
  ip netns del "$n" 2>/dev/null || true
  ip link del "ve-$short" 2>/dev/null || true
  ip link del "$h" 2>/dev/null || true
  ip netns add "$n"
  ip link add "$h" type veth peer name eth0 netns "$n"
  ip addr add "10.20$idx.0.1/24" dev "$h"
  ip link set "$h" up
  ip -n "$n" addr add "10.20$idx.0.2/24" dev eth0
  ip -n "$n" link set eth0 up
  ip -n "$n" link set lo up
  ip -n "$n" route add default via "10.20$idx.0.1"
}
ns eim 1
ns apdf 2
ns sym 3

chain() {
  local table=$1 parent=$2 name=$3
  iptables -t "$table" -N "$name" 2>/dev/null || iptables -t "$table" -F "$name"
  iptables -t "$table" -C "$parent" -j "$name" 2>/dev/null || iptables -t "$table" -I "$parent" 1 -j "$name"
}
chain nat POSTROUTING P02POST
chain nat PREROUTING P02PRE
chain nat INPUT P02HAIR
chain filter INPUT P02DROP

iptables -t nat -A P02POST -s 10.201.0.0/24 -o "$WAN" -j MASQUERADE
iptables -t nat -A P02PRE -i "$WAN" -p udp --dport 20000:20999 -j DNAT --to-destination 10.201.0.2
iptables -t nat -A P02HAIR -s 10.201.0.0/24 -j SNAT --to-source "$PUB"

iptables -t nat -A P02POST -s 10.202.0.0/24 -o "$WAN" -j MASQUERADE
iptables -t nat -A P02HAIR -s 10.202.0.0/24 -j SNAT --to-source "$PUB"

for proto in udp tcp; do
  iptables -t nat -A P02POST -s 10.203.0.0/24 -o "$WAN" -p "$proto" -j MASQUERADE --to-ports 23000-29999 --random-fully
  iptables -t nat -A P02HAIR -s 10.203.0.0/24 -p "$proto" -j SNAT --to-source "$PUB:23000-29999" --random-fully
done

# A home router drops a packet nobody asked for without a word; without this the host would
# answer it with ICMP port unreachable, which Windows turns into an error on the sender's socket.
iptables -A P02DROP -i "$WAN" -p udp -m conntrack --ctstate NEW --dport 20000:29999 -j DROP
}
if [ "$NAT" = 1 ]; then
  nat_setup
fi

cat > /etc/p02/relay.toml <<EOF
enable_relay = true
http_bind_addr = "[::]:80"
enable_quic_addr_discovery = true
enable_metrics = false

[tls]
cert_mode = "Manual"
manual_cert_path = "/etc/p02/relay.crt"
manual_key_path = "/etc/p02/relay.key"
https_bind_addr = "[::]:443"
EOF

cat > /etc/p02/station.json <<EOF
{"name": "$NAME", "data_dir": "/var/lib/p02", "cert": "/etc/p02/relay.crt", "key": "/etc/p02/relay.key",
 "wan_if": "$WAN", "deploy": "/etc/p02/deploy.json",
 "namespaces": [{"name": "eim", "ip": "10.201.0.2"}, {"name": "apdf", "ip": "10.202.0.2"}, {"name": "sym", "ip": "10.203.0.2"}]}
EOF

peer_cfg() {
  cat > "/etc/p02/peer-$1.json" <<EOF
{"name": "$1", "deploy": "/etc/p02/deploy.json", "data_dir": "/var/lib/p02/peers", "stations": ["$NAME"], "clock": [], "port_range": [$2, $3]}
EOF
}
peer_cfg eim 20000 20999
peer_cfg apdf 21000 21999
peer_cfg sym 22000 22999

if [ "$SYSTEMD" = 1 ]; then
  cat > /etc/systemd/system/p02-relay.service <<EOF
[Unit]
Description=p02 iroh relay
After=network-online.target
[Service]
Environment=RUST_LOG=info
ExecStart=/opt/p02/iroh-relay --config-path /etc/p02/relay.toml
Restart=always
RestartSec=2
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
EOF
  cat > /etc/systemd/system/p02-station.service <<EOF
[Unit]
Description=p02 station
After=network-online.target
[Service]
ExecStart=/opt/p02/p02-station /etc/p02/station.json
Restart=always
RestartSec=2
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
EOF
  cat > /etc/systemd/system/p02-peer@.service <<EOF
[Unit]
Description=p02 peer in namespace %i
After=p02-station.service
[Service]
ExecStart=/usr/sbin/ip netns exec p02-%i /opt/p02/p02-peer /etc/p02/peer-%i.json
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now chrony 2>/dev/null || true
  systemctl enable --now p02-relay p02-station p02-peer@eim p02-peer@apdf p02-peer@sym
  sleep 2
  systemctl --no-pager --lines=0 status p02-relay p02-station p02-peer@eim p02-peer@apdf p02-peer@sym | grep -E 'Active|●'
else
  RUST_LOG=info nohup /opt/p02/iroh-relay --config-path /etc/p02/relay.toml >/var/lib/p02/relay.log 2>&1 &
  nohup /opt/p02/p02-station /etc/p02/station.json >/var/lib/p02/station.out 2>&1 &
  sleep 1
  for p in eim apdf sym; do
    if [ "$NAT" = 1 ]; then
      nohup ip netns exec "p02-$p" /opt/p02/p02-peer "/etc/p02/peer-$p.json" >"/var/lib/p02/peer-$p.out" 2>&1 &
    else
      nohup /opt/p02/p02-peer "/etc/p02/peer-$p.json" >"/var/lib/p02/peer-$p.out" 2>&1 &
    fi
  done
  sleep 2
  pgrep -af /opt/p02/
fi
echo "station $NAME on $PUB via $WAN is set up"
