import { describe, expect, it } from 'vitest';
import { defaultSpec, STOCK_STAGE } from '../config/screwdriver';
import { ocv, socAt } from './battery';
import { poseStages, requiredSunShift, stageRatio, totalRatio, validateStage } from './gears';
import { radSToRpm, steadyState } from './motor';
import { buildDrivetrain, G, Simulator } from './sim';

describe('gearbox', () => {
  it('stock gearbox is 81:1 (owner: ring 48, sun 6, two identical stages)', () => {
    const spec = defaultSpec();
    expect(stageRatio(spec.stages[0])).toBe(9);
    expect(totalRatio(spec.stages)).toBe(81);
  });
  it('flags the 19-tooth planet geometry mismatch but allows equal spacing', () => {
    const issues = validateStage(STOCK_STAGE('s'));
    expect(issues.some((i) => i.severity === 'error')).toBe(false);
    expect(issues.some((i) => i.message.includes('= 21 teeth'))).toBe(true);
    expect(requiredSunShift(STOCK_STAGE('s'))).toBeCloseTo(2, 5);
  });
  it('rejects unequal planet spacing', () => {
    const s = { ...STOCK_STAGE('s'), ring: 49 };
    expect(validateStage(s).some((i) => i.severity === 'error')).toBe(true);
  });
  it('kinematics: carrier turns 1/9 of the sun per stage', () => {
    const spec = defaultSpec();
    const a = poseStages(spec.stages, 81 * 2 * Math.PI);
    expect(a[1].carrier).toBeCloseTo(2 * Math.PI, 9);
  });
});

describe('motor calibration (box ratings)', () => {
  const spec = defaultSpec();
  const d = buildDrivetrain(spec);
  it('reproduces 220 rpm no-load at 3.6 V', () => {
    const s = steadyState(d.motor, 3.6, 0);
    expect(radSToRpm(s.omega) / 81).toBeCloseTo(220, 6);
  });
  it('reproduces 3 N·m stall at 3.6 V', () => {
    const Ts = d.motor.ke * (3.6 / d.motor.r - d.motor.i0);
    expect(Ts * 81 * 0.81).toBeCloseTo(3.0, 6);
  });
});

describe('battery', () => {
  it('OCV is monotonic and inverts', () => {
    expect(ocv(1)).toBeCloseTo(4.18, 3);
    expect(ocv(0)).toBeCloseTo(3.0, 3);
    expect(ocv(socAt(3.7))).toBeCloseTo(3.7, 4);
  });
});

describe('simulator', () => {
  it('spins up to rated no-load speed', () => {
    const sim = new Simulator(defaultSpec());
    sim.st.trigger = 1;
    for (let i = 0; i < 100; i++) sim.step(0.02);
    expect(sim.outputRpm()).toBeCloseTo(220, 0);
  });
  it('reverse spins the other way', () => {
    const sim = new Simulator(defaultSpec());
    sim.st.trigger = -1;
    for (let i = 0; i < 100; i++) sim.step(0.02);
    expect(sim.outputRpm()).toBeCloseTo(-220, 0);
  });
  it('stalls on the 6-in beam above the rated torque and reads ≈3 N·m', () => {
    const sim = new Simulator(defaultSpec());
    sim.load.mode = 'beam';
    sim.load.beamMassKg = 3.2 / (G * 0.1524);
    sim.st.trigger = 1;
    for (let i = 0; i < 50; i++) sim.step(0.02);
    expect(sim.st.stalled).toBe(true);
    expect(sim.st.outputTorque).toBeCloseTo(3.0, 2);
  });
  it('a third stock stage multiplies stall torque by 9 × η', () => {
    const spec = defaultSpec();
    spec.stages.push(STOCK_STAGE('stage-3'));
    const d = buildDrivetrain(spec);
    expect(d.ratio).toBe(729);
    const Ts = d.motor.ke * (3.6 / d.motor.r - d.motor.i0) * d.ratio * d.eta;
    expect(Ts).toBeCloseTo(3 * 9 * 0.9, 6);
  });
});
