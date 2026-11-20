// What the count of wrong codes is kept by. A home on IPv6 usually gets a /64, billions of
// addresses its PCs may switch among freely, so an IPv6 address counts by its /64, and an
// IPv4 address by itself (user, 2026-10-23; record/areas/network/02-units.md, "Codes, lapses,
// and wrong codes").

/** The key an address's wrong codes count under: an IPv4 address whole, an IPv6 one's /64. */
export function counted(address: string): string {
  // An IPv4 address, or one written inside IPv6, as `::ffff:198.51.100.7`, counts whole.
  if (!address.includes(":") || address.includes(".")) return address
  const [head = "", tail] = address.split("::")
  const left = head === "" ? [] : head.split(":")
  const right = tail === undefined || tail === "" ? [] : tail.split(":")
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(":")}::/64`
}
