/**
 * Open-circuit voltage of a generic Li-ion (NMC/LCO) 18650 vs state of charge.
 * ASSUMED typical curve — the cell's datasheet is unknown. Scaled so that 0 % → cutoff
 * and 100 % → full-charge voltage from the spec.
 */
const OCV_TABLE: [number, number][] = [
  [0, 3.0], [0.05, 3.3], [0.1, 3.45], [0.2, 3.55], [0.3, 3.62], [0.4, 3.67],
  [0.5, 3.72], [0.6, 3.78], [0.7, 3.85], [0.8, 3.94], [0.9, 4.05], [1, 4.18],
];

export function ocv(soc: number, cutoff = 3.0, full = 4.18): number {
  const s = Math.min(1, Math.max(0, soc));
  let v = OCV_TABLE[OCV_TABLE.length - 1][1];
  for (let i = 1; i < OCV_TABLE.length; i++) {
    if (s <= OCV_TABLE[i][0]) {
      const [s0, v0] = OCV_TABLE[i - 1], [s1, v1] = OCV_TABLE[i];
      v = v0 + ((v1 - v0) * (s - s0)) / (s1 - s0);
      break;
    }
  }
  // rescale between table end-points and spec end-points
  return cutoff + ((v - 3.0) * (full - cutoff)) / (4.18 - 3.0);
}

/** SoC at which OCV equals v (inverse, by bisection). */
export function socAt(v: number, cutoff = 3.0, full = 4.18): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ocv(mid, cutoff, full) < v) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
