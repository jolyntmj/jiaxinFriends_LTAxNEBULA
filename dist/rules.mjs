/** Calendar and scoring constants shared by solver and presentation code. */
export const MILLISECONDS_PER_DAY = 86_400_000;
export const DAYS_PER_WEEK = 7;
export const STANDARD_ACCESS_UNITS = 1;
export const EXTENDED_ACCESS_UNITS = 1.5;
export const EXTRA_ACCESS_PENALTY = 7;
export const ECLO_PENALTY = 5;

/** @param {{eclo: number|boolean}} access @returns {number} Delivered work units. */
export function accessUnits(access) {
  return access.eclo ? EXTENDED_ACCESS_UNITS : STANDARD_ACCESS_UNITS;
}
