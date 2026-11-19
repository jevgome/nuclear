import type { ScrewdriverSpec } from '../config/screwdriver';
import { ocv } from './battery';
import { totalEfficiency, totalRatio } from './gears';
import { calibrateMotor, rpmToRadS, type MotorModel } from './motor';

export const G = 9.80665;

export type LoadMode = 'none' | 'constant' | 'beam' | 'screw';
export type VoltageMode = 'rated' | 'battery';

export interface LoadSettings {
  mode: LoadMode;
  constantNm: number;
  beamMassKg: number;
  beamLengthM: number;
  screw: { lengthMm: number; pitchMm: number; startNm: number; endNm: number; seatNm: number };
}

export interface Drivetrain {
  motor: MotorModel;
  ratio: number; // current (possibly custom) gearbox
  eta: number;
  stockRatio: number;
  stockEta: number;
  /** Stall torque at the motor shaft implied by the box rating */
  motorStallTorque: number;
  motorNoLoadRpm: number;
}

/** Calibrate the motor from the box ratings + stock gearbox, then apply the current gearbox. */
export function buildDrivetrain(spec: ScrewdriverSpec): Drivetrain {
  const stockRatio = spec.rated.stockRatio.value;
  const stockEta = Math.pow(spec.gearbox.stageEfficiency.value, 2);
  const motorNoLoadRpm = spec.rated.noLoadRpm.value * stockRatio;
  const motorStallTorque = spec.rated.maxTorque.value / (stockRatio * stockEta);
  const motor = calibrateMotor({
    voltage: spec.rated.voltage.value,
    noLoadMotorRadS: rpmToRadS(motorNoLoadRpm),
    stallMotorTorque: motorStallTorque,
    noLoadCurrent: spec.motor.noLoadCurrent.value,
  });
  return {
    motor,
    ratio: totalRatio(spec.stages),
    eta: totalEfficiency(spec.stages),
    stockRatio,
    stockEta,
    motorStallTorque,
    motorNoLoadRpm,
  };
}

/** Output torque–speed line for plotting: returns points (rpm_out, Nm_out, A, efficiency). */
export function outputCurve(d: Drivetrain, V: number, n = 60) {
  const { ke, r, i0 } = d.motor;
  const w0 = (V - i0 * r) / ke;
  const pts: { rpm: number; torque: number; current: number; eff: number; power: number }[] = [];
  for (let k = 0; k <= n; k++) {
    const w = (w0 * k) / n;
    const I = (V - ke * w) / r;
    const Tm = ke * (I - i0);
    const Tout = Tm * d.ratio * d.eta;
    const wOut = w / d.ratio;
    const pOut = Tout * wOut;
    pts.push({ rpm: (wOut * 60) / (2 * Math.PI), torque: Tout, current: I, eff: pOut / (V * I), power: pOut });
  }
  return pts;
}

export interface SimState {
  time: number;
  motorAngle: number; // rad (integrated)
  omega: number; // motor rad/s (signed)
  current: number; // A (signed)
  voltage: number; // terminal V presented to motor (signed)
  soc: number; // 0..1
  trigger: -1 | 0 | 1; // reverse / off / forward
  charging: boolean;
  outputTorque: number; // N·m delivered at bit (signed)
  loadTorque: number; // N·m resisting at bit
  stalled: boolean;
  energyWh: number;
  screwDepthMm: number;
  peakTorque: number;
  dead: boolean;
}

export class Simulator {
  d: Drivetrain;
  st: SimState;
  load: LoadSettings = {
    mode: 'none',
    constantNm: 0.5,
    beamMassKg: 1.097, // reproduces DOC 1.64 N·m on the 6 in beam
    beamLengthM: 0.1524,
    screw: { lengthMm: 25, pitchMm: 1.6, startNm: 0.15, endNm: 0.9, seatNm: 6 },
  };
  voltageMode: VoltageMode = 'rated';
  timeScale = 1;
  constructor(public spec: ScrewdriverSpec) {
    this.d = buildDrivetrain(spec);
    this.st = Simulator.initial();
  }
  static initial(): SimState {
    return {
      time: 0, motorAngle: 0, omega: 0, current: 0, voltage: 0, soc: 1, trigger: 0, charging: false,
      outputTorque: 0, loadTorque: 0, stalled: false, energyWh: 0, screwDepthMm: 0, peakTorque: 0, dead: false,
    };
  }
  rebuild(spec: ScrewdriverSpec) {
    this.spec = spec;
    this.d = buildDrivetrain(spec);
  }
  supplyVoltage(): number {
    const b = this.spec.battery;
    if (this.voltageMode === 'rated') return this.spec.rated.voltage.value;
    return ocv(this.st.soc, b.cutoff.value, b.full.value);
  }
  /** Magnitude of resisting torque at the output for the current state. */
  loadAtOutput(): number {
    const L = this.load;
    switch (L.mode) {
      case 'none': return 0;
      case 'constant': return L.constantNm;
      case 'beam': return L.beamMassKg * G * L.beamLengthM;
      case 'screw': {
        const s = L.screw;
        if (this.st.screwDepthMm >= s.lengthMm) return s.seatNm;
        return s.startNm + ((s.endNm - s.startNm) * Math.max(0, this.st.screwDepthMm)) / s.lengthMm;
      }
    }
  }
  step(dtReal: number) {
    const dtTotal = Math.min(dtReal, 0.05) * this.timeScale;
    const h = 2e-4;
    const n = Math.max(1, Math.ceil(dtTotal / h));
    const dt = dtTotal / n;
    for (let i = 0; i < n; i++) this.substep(dt);
  }
  private substep(dt: number) {
    const st = this.st, d = this.d, m = d.motor, spec = this.spec;
    const J = spec.motor.rotorInertia.value;
    const cap = spec.battery.capacity.value;
    const V = this.supplyVoltage();
    st.dead = this.voltageMode === 'battery' && st.soc <= 0.0005;
    const drive = st.dead ? 0 : st.trigger;
    // electrical
    let I = 0;
    if (drive !== 0) I = (drive * V - m.ke * st.omega) / m.r;
    st.voltage = drive * V;
    const Tem = m.ke * I;
    const Tfric = m.ke * m.i0;
    const Lout = this.loadAtOutput();
    // load reflected to motor; screw load only resists forward drive (reverse unscrews freely-ish)
    const loadActive = this.load.mode === 'screw' ? st.omega > 0 || drive > 0 : true;
    const TLm = loadActive ? Lout / (d.ratio * d.eta) : 0;
    const resist = Tfric + TLm;
    let w = st.omega;
    if (w === 0) {
      // static: breaks away only if electromagnetic torque beats friction + load
      if (Math.abs(Tem) > resist) w = ((Tem - Math.sign(Tem) * resist) / J) * dt;
    } else {
      const wn = w + ((Tem - Math.sign(w) * resist) / J) * dt;
      // friction / load can stop the rotor but never reverse it
      w = Math.sign(wn) !== Math.sign(w) ? 0 : wn;
    }
    st.omega = w;
    st.motorAngle += w * dt;
    st.current = I;
    st.stalled = drive !== 0 && w === 0;
    // torque delivered to the work (what a torque sensor on the bit would read)
    if (drive === 0) st.outputTorque = 0;
    else if (st.stalled) st.outputTorque = Math.sign(Tem) * Math.max(0, Math.abs(Tem) - Tfric) * d.ratio * d.eta;
    else st.outputTorque = Math.sign(w) * (loadActive ? Lout : 0);
    st.loadTorque = Lout;
    st.peakTorque = Math.max(st.peakTorque, Math.abs(st.outputTorque));
    // screw advance
    if (this.load.mode === 'screw') {
      const outRev = (w * dt) / d.ratio / (2 * Math.PI);
      st.screwDepthMm = Math.min(this.load.screw.lengthMm, Math.max(0, st.screwDepthMm + outRev * this.load.screw.pitchMm));
    }
    // battery
    if (this.voltageMode === 'battery') {
      const ledI = drive !== 0 ? spec.electrical.ledCurrent.value : 0;
      st.soc -= ((Math.abs(I) + ledI) * dt) / 3600 / cap;
      if (st.charging) st.soc += (spec.battery.chargeCurrent.value * dt) / 3600 / cap;
      st.soc = Math.min(1, Math.max(0, st.soc));
    }
    st.energyWh += (Math.abs(I * V) * dt) / 3600;
    st.time += dt;
  }
  outputRpm() { return (this.st.omega / this.d.ratio) * 60 / (2 * Math.PI); }
  outputAngle() { return this.st.motorAngle / this.d.ratio; }
}
