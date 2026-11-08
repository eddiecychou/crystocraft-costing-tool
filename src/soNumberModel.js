import { ocYear } from './ocTime.js'

// Same historical JES seeds shared by browser and server allocation.
export const JES_SEED_BY_YEAR = {
  26: 27, // JES max SO260027, verified 2026-07-20
  25: 42 // JES max SO250042
}
export const soYear = (d = new Date()) => String(ocYear(d) % 100).padStart(2, '0')
export const formatSoNo = (yy, n) => `SO${yy}${String(n).padStart(4, '0')}`
