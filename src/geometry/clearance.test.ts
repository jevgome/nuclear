import { describe, expect, it } from 'vitest';
import { defaultSpec } from '../config/screwdriver';
import { profileAt, sectionPolyline, SEC_N } from './shell';

/** Smallest distance from the tool axis to the INNER wall of the shell at station x. */
function innerRadius(x: number) {
  const spec = defaultSpec();
  const pl = sectionPolyline(profileAt(spec.profile, x), spec.body.wall.value);
  let m = Infinity;
  for (let i = 0; i < SEC_N; i++) {
    const ax = pl[i * 2], ay = pl[i * 2 + 1], bx = pl[i * 2 + 2], by = pl[i * 2 + 3];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    m = Math.min(m, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return m;
}

describe('shell facets clear the internals', () => {
  const spec = defaultSpec();
  const motorR = spec.motor.canDiameter.value / 2;
  const housingR = 18.44; // ring root + wall (see model.buildGearbox)
  it('motor can (x 120–158)', () => {
    for (let x = 120; x <= 158; x += 1) expect(innerRadius(x), `x=${x}`).toBeGreaterThan(motorR + 0.3);
  });
  it('mount ring (x 158–162)', () => {
    for (let x = 158; x <= 162; x += 1) expect(innerRadius(x), `x=${x}`).toBeGreaterThan(15.3);
  });
  it('gearbox housing (x 162–181)', () => {
    for (let x = 162; x <= spec.gearbox.housingEndX.value; x += 1) expect(innerRadius(x), `x=${x}`).toBeGreaterThan(housingR + 0.2);
  });
});

describe('grip facets clear the 18650 cell', () => {
  it('cell (x 21–86) stays inside the inner wall', () => {
    const spec = defaultSpec();
    const b = spec.battery, wall = spec.body.wall.value, r = b.diameter.value / 2;
    let bottom = Infinity;
    for (let x = b.startX.value; x <= b.startX.value + b.length.value; x += 2) bottom = Math.min(bottom, profileAt(spec.profile, x).bottom);
    const cy = -(bottom - wall - r - 0.5); // same placement rule as model.buildHandleInternals
    for (let x = b.startX.value + 1; x <= b.startX.value + b.length.value - 1; x += 2) {
      const pl = sectionPolyline(profileAt(spec.profile, x), wall);
      let m = Infinity;
      for (let i = 0; i < SEC_N; i++) {
        const ax = pl[i * 2], ay = pl[i * 2 + 1] - cy, bx = pl[i * 2 + 2], by = pl[i * 2 + 3] - cy;
        const dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
        m = Math.min(m, Math.hypot(ax + dx * t, ay + dy * t));
      }
      expect(m, `x=${x}`).toBeGreaterThan(r + 0.1);
    }
  });
});
