import type { Bucket } from "./api"

export interface Accumulated {
  lit: number
  retail: number
  inst: number
  block: number
  blockCount: number
}

export function runningTotals(buckets: Bucket[], upToEpoch: number): Accumulated {
  let lit = 0
  let retail = 0
  let inst = 0
  let block = 0
  let blockCount = 0
  for (const b of buckets) {
    if (b.t > upToEpoch) break
    lit += b.lv
    retail += b.drv
    inst += b.div
    block += b.dbv
    blockCount += b.dbc
  }
  return { lit, retail, inst, block, blockCount }
}
