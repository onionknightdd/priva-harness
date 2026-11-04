/** Minimal header for routing/lifecycle tests, not a valid point-data fixture. */
export function copcHeader(): Buffer {
  const header = Buffer.alloc(589)
  header.write('LASF')
  header[24] = 1
  header[25] = 4
  header.writeUInt16LE(375, 94)
  header.write('copc', 377)
  header.writeUInt16LE(1, 393)
  header.writeUInt16LE(160, 395)
  return header
}
