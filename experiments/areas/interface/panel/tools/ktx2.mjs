/*
 * The plainest KTX2 file: one level of uncompressed sRGB RGBA8
 * (VK_FORMAT_R8G8B8A8_SRGB, 43), no supercompression, no key-value data, and
 * the basic data format descriptor the KTX 2.0 specification requires: color
 * model RGBSDA, BT.709 primaries, the sRGB transfer function, and four 8-bit
 * samples, R, G, B, and A, the alpha marked linear.
 *
 *   writeKtx2(rgba, width, height)   rgba: Buffer of width * height * 4 bytes, rows top first
 *
 * The packagers left our PNG out (record/areas/interface/log.md, 2026-10-04),
 * so a Copy asset group ships this where the compiled model looks. Whether the
 * sim takes an uncompressed KTX2 is what the probe asks; the sim's own are
 * compressed (unverified).
 */

const IDENTIFIER = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])
const VK_FORMAT_R8G8B8A8_SRGB = 43

function dfd() {
  const samples = [0, 1, 2, 15] // R, G, B, A
  const blockSize = 24 + 16 * samples.length
  const b = Buffer.alloc(4 + blockSize)
  let o = 0
  b.writeUInt32LE(4 + blockSize, o); o += 4 // dfdTotalSize
  b.writeUInt32LE(0, o); o += 4 // vendor 0, descriptor type 0
  b.writeUInt16LE(2, o); o += 2 // version 2
  b.writeUInt16LE(blockSize, o); o += 2
  b.writeUInt8(1, o++) // KHR_DF_MODEL_RGBSDA
  b.writeUInt8(1, o++) // KHR_DF_PRIMARIES_BT709
  b.writeUInt8(2, o++) // KHR_DF_TRANSFER_SRGB
  b.writeUInt8(0, o++) // straight alpha
  o += 4 // texel block dimensions, all 0 (1x1x1x1)
  b.writeUInt8(4, o); o += 8 // bytesPlane0 = 4, the rest 0
  samples.forEach((channel, i) => {
    b.writeUInt16LE(i * 8, o); o += 2 // bit offset
    b.writeUInt8(7, o++) // bit length minus 1
    b.writeUInt8(channel === 15 ? channel | 0x10 : channel, o++) // alpha: KHR_DF_SAMPLE_DATATYPE_LINEAR
    o += 4 // sample position
    b.writeUInt32LE(0, o); o += 4 // lower
    b.writeUInt32LE(255, o); o += 4 // upper
  })
  return b
}

export function writeKtx2(rgba, width, height) {
  const header = Buffer.alloc(36)
  ;[VK_FORMAT_R8G8B8A8_SRGB, 1, width, height, 0, 0, 1, 1, 0].forEach((v, i) => header.writeUInt32LE(v, i * 4))
  const descriptor = dfd()
  const indexAt = IDENTIFIER.length + header.length
  const levelIndexAt = indexAt + 32
  const dfdAt = levelIndexAt + 24
  const dataAt = Math.ceil((dfdAt + descriptor.length) / 4) * 4
  const index = Buffer.alloc(32)
  index.writeUInt32LE(dfdAt, 0)
  index.writeUInt32LE(descriptor.length, 4)
  // kvd offset and length, sgd offset and length: all 0
  const levelIndex = Buffer.alloc(24)
  levelIndex.writeBigUInt64LE(BigInt(dataAt), 0)
  levelIndex.writeBigUInt64LE(BigInt(rgba.length), 8)
  levelIndex.writeBigUInt64LE(BigInt(rgba.length), 16)
  const pad = Buffer.alloc(dataAt - (dfdAt + descriptor.length))
  return Buffer.concat([IDENTIFIER, header, index, levelIndex, descriptor, pad, rgba])
}
