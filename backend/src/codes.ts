// Invite codes: six characters from the 30-character alphabet that leaves out I, L, O, U, 0,
// and 1, since a pilot reads a code aloud and types it while looking at a sim
// (record/areas/product/03-v1-scope.md, "Invite code").

export const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
export const LENGTH = 6

/** Fills a byte array with random bytes, as `crypto.getRandomValues` does. */
export type Fill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

/** How many codes to draw before giving up, when each meets a code a session holds. */
export const ATTEMPTS = 5

/**
 * Draws a code from `random`. A byte at 240 or above, past the largest multiple of 30 under
 * 256, is drawn again, so every character is equally likely.
 */
export function draw(random: Fill): string {
  let code = ""
  const byte = new Uint8Array(1)
  while (code.length < LENGTH) {
    const b = random(byte)[0] ?? 255
    if (b < 240) code += ALPHABET[b % ALPHABET.length]
  }
  return code
}

/**
 * Draws codes until `take` keeps one, up to `ATTEMPTS` times. `take` inserts the session
 * under the code and says whether the insert took, since the code is the sessions table's
 * key and an insert that meets a held code takes nothing.
 */
export async function claim(random: Fill, take: (code: string) => Promise<boolean>): Promise<string | null> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const code = draw(random)
    if (await take(code)) return code
  }
  return null
}

/** Whether `code` could be a code at all, after upper-casing it. */
export function wellFormed(code: string): boolean {
  return code.length === LENGTH && [...code].every((c) => ALPHABET.includes(c))
}
