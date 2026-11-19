import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ScrewdriverSpec } from '../config/screwdriver';
import type { Confidence, CustomPart, StageSpec, Station } from '../config/types';
import { carrierRadius, MATERIALS, poseStages, requiredSunShift } from '../physics/gears';
import {
  discGeometry, externalGearGeometry, hexGeometry, ringGearGeometry, socketTubeGeometry,
} from '../geometry/gearShape';
import {
  profileAt, sectionPoint, seamNormal, seamPlateGeometry, seamX, shellHalfGeometry, type SeamDef,
} from '../geometry/shell';
import { labelTexture, shellTextures } from '../geometry/textures';
import { plateCorners, plateGeometry, plateTexture, reliefItems, ribGeometry } from '../geometry/relief';

export type PartGroup = 'Shell' | 'Motor' | 'Gearbox' | 'Output' | 'Electrical' | 'Controls' | 'Custom';
export type XrayRole = 'shell' | 'housing' | 'internal';
export type BitType = 'PH2' | 'PH1' | 'SL6' | 'SL5' | 'D3' | 'D2';
export const BIT_TYPES: { id: BitType; name: string }[] = [
  { id: 'PH2', name: 'Phillips PH2' }, { id: 'PH1', name: 'Phillips PH1' },
  { id: 'SL6', name: 'Slotted 6 mm' }, { id: 'SL5', name: 'Slotted 5 mm' },
  { id: 'D3', name: 'Twist drill 3.0 mm' }, { id: 'D2', name: 'Twist drill 2.0 mm' },
];

export interface PartInfo {
  id: string;
  name: string;
  group: PartGroup;
  desc: string;
  confidence: Confidence;
  source: string;
  dims?: string;
}
export interface Part {
  info: PartInfo;
  obj: THREE.Object3D;
  base: THREE.Vector3;
  explode: THREE.Vector3;
  role: XrayRole;
  wire?: boolean;
}

/* ---------- materials (tuned against the listing photos) ---------- */
const std = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...o });
const MAT = {
  shellTex: (side: 1 | -1, stations: Station[]) => {
    const t = shellTextures(stations, side, JSON.stringify(stations));
    return std({
      color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, roughness: 1, bumpMap: t.bumpMap, bumpScale: 1.6,
      specularIntensity: 0.6,
    });
  },
  shell: () => std({ color: 0x1e1f21, roughness: 0.6, specularIntensity: 0.6 }),
  relief: () => new THREE.MeshPhysicalMaterial({ color: 0x202123, roughness: 0.55, specularIntensity: 0.7, flatShading: true }),
  plate: (side: 1 | -1) => std({ color: 0xffffff, map: plateTexture(side), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
  plateEdge: () => std({ color: 0x0a0a0b, roughness: 0.2, clearcoat: 1, flatShading: true }),
  shellInner: () => std({ color: 0x141416, roughness: 0.75 }),
  red: () => std({ color: 0xd3121c, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
  housing: () => std({ color: 0xcfe6d6, roughness: 0.3, transparent: true, opacity: 0.78 }),
  clear: () => std({ color: 0xe6eef2, roughness: 0.15, transparent: true, opacity: 0.55 }),
  ivory: (c = 0xf1e6cc) => std({ color: c, roughness: 0.55 }),
  chrome: () => std({ color: 0xf2f2f4, metalness: 1, roughness: 0.07 }),
  steel: () => std({ color: 0xa9adb3, metalness: 1, roughness: 0.3 }),
  satin: () => std({ color: 0xb9bcc1, metalness: 1, roughness: 0.42 }),
  blackOxide: () => std({ color: 0x26272a, metalness: 0.85, roughness: 0.38 }),
  can: () => std({ color: 0xc9cbce, metalness: 0.9, roughness: 0.38 }),
  white: () => std({ color: 0xf2f2ee, roughness: 0.6 }),
  black: () => std({ color: 0x0c0c0d, roughness: 0.6 }),
  purple: () => std({ color: 0x9a2fc4, roughness: 0.35, clearcoat: 0.6 }),
  pcb: () => std({ color: 0x1f6b3a, roughness: 0.5 }),
  copper: () => std({ color: 0xb8733a, metalness: 0.9, roughness: 0.35 }),
  magnet: () => std({ color: 0x3a3a3c, roughness: 0.7 }),
  brass: () => std({ color: 0xc9a94a, metalness: 0.9, roughness: 0.3 }),
  wire: (c: number) => std({ color: c, roughness: 0.5 }),
  led: (c: number) => {
    const m = std({ color: c, roughness: 0.08, transparent: true, opacity: 0.9, emissive: 0x000000 });
    m.userData.led = true;
    return m;
  },
};

/** Cylinder along +X from x0 to x0+len (r = rear radius, r2 = front radius) */
const cylX = (r: number, len: number, x0: number, seg = 40, r2 = r) =>
  new THREE.CylinderGeometry(r2, r, len, seg).rotateZ(-Math.PI / 2).translate(x0 + len / 2, 0, 0);
/** Map gear-shape angle t to world (y,z) */
export const polarYZ = (r: number, t: number) => new THREE.Vector2(r * Math.sin(t), -r * Math.cos(t));

/** Rounded "stadium" button extruded along +Z, centred; long axis along Y. */
function stadium(len: number, wid: number, depth: number, bevel = 0.8) {
  const r = wid / 2 - bevel;
  const h = len / 2 - wid / 2;
  const s = new THREE.Shape();
  s.absarc(0, h, r, 0, Math.PI, false);
  s.absarc(0, -h, r, Math.PI, Math.PI * 2, false);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.1, depth - 2 * bevel), bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 20 });
  g.translate(0, 0, -depth / 2 + bevel);
  g.computeVertexNormals();
  return g;
}

/** Polygon in the XY plane extruded symmetrically along Z, with soft bevels. */
function extrudeXY(pts: [number, number][], width: number, bevel = 0.8) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  g.computeVertexNormals();
  return g;
}

interface StageMeshes {
  spec: StageSpec;
  sun: THREE.Mesh;
  planets: THREE.Mesh[];
  planetParts: Part[];
  carrier: THREE.Group;
  a: number;
  x0: number;
  explodeX: number;
}

export interface BuildOptions {
  extendShell: boolean;
  showBit: boolean;
  bit: BitType;
}

export class ScrewdriverModel {
  /** Display wrapper: stands the tool grip-down in pistol mode (as in the listing photos). */
  display = new THREE.Group();
  root = new THREE.Group();
  handle = new THREE.Group();
  headPivot = new THREE.Group();
  head = new THREE.Group();
  spindle = new THREE.Group();
  rotor = new THREE.Group();
  parts: Part[] = [];
  stages: StageMeshes[] = [];
  seam!: SeamDef;
  overflow = 0;
  xEnd = 203;
  headAngle = 0;
  explode = 0;
  /** control state for animation */
  triggerPressed = false;
  direction: 1 | -1 = 1;
  showWires = true;
  /** Skip drawing parts that are fully enclosed by the shell (solid view, assembled). */
  occlude = false;
  /** When set, only this part (and its ancestors) is shown. */
  isolateId: string | null = null;
  whiteLed?: THREE.Mesh;
  pilotLed?: THREE.Mesh;
  ledLight = new THREE.SpotLight(0xfff6e8, 0, 600, Math.PI / 9, 0.55, 1.4);
  trigger = new THREE.Group();
  frButton = new THREE.Group();
  pushButton = new THREE.Group();
  spec!: ScrewdriverSpec;
  private triggerPivot = new THREE.Vector3();
  private pendingLoads: Promise<void>[] = [];

  constructor() {
    this.display.add(this.root);
    this.root.add(this.handle, this.headPivot);
    this.headPivot.add(this.head);
  }

  /* ======================================================================= */
  build(spec: ScrewdriverSpec, opts: BuildOptions) {
    this.spec = spec;
    this.clear();
    const S = spec;
    const beta = (S.body.seamAngle.value * Math.PI) / 180;
    this.seam = { x0: S.body.seamCenter.value, beta };

    // ---------- gearbox axial budget ----------
    const gb = S.gearbox;
    const ct = gb.carrierThickness.value, gap = gb.stageGap.value;
    const pitches = S.stages.map((s) => s.faceWidth + ct + gap);
    const gearStart = gb.housingStartX.value + gap;
    const gearsEnd = gearStart + pitches.reduce((a, b) => a + b, 0);
    // gears must end inside the full-diameter part of the housing; the nose (spindle bearing) follows
    const need = gearsEnd + 1;
    this.overflow = Math.max(0, need - gb.housingEndX.value);
    const shift = opts.extendShell ? this.overflow : 0;
    const shiftX = (x: number) => (x > 150 ? x + shift : x);
    const stations: Station[] = S.profile.map((st) => ({ ...st, x: shiftX(st.x) }));
    this.xEnd = S.body.bodyLength.value + shift;
    const housingEnd = gb.housingEndX.value + shift;

    this.headPivot.position.set(this.seam.x0, 0, 0);
    this.head.position.set(-this.seam.x0, 0, 0);

    this.buildShell(stations, S.body.wall.value, shift);
    this.buildHandleInternals(S, stations);
    this.buildControls(S, stations, shift);
    this.buildMotor(S);
    this.buildGearbox(S, gearStart, pitches, housingEnd, gearsEnd);
    this.buildOutput(S, gearsEnd, opts);
    this.buildHeadElectrics(S, stations, shift);
    this.buildCustomParts(S.customParts);
    this.applyLayout();
    this.updateKinematics(0, 0);
    return Promise.all(this.pendingLoads);
  }

  private clear() {
    for (const g of [this.handle, this.head, this.spindle, this.rotor, this.trigger, this.frButton, this.pushButton]) {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      g.clear();
    }
    this.parts = [];
    this.stages = [];
    this.pendingLoads = [];
    this.ledState = '';
    this.head.add(this.spindle, this.rotor);
  }

  private add(
    parent: THREE.Object3D,
    obj: THREE.Object3D,
    info: PartInfo,
    explode: [number, number, number],
    role: XrayRole = 'internal',
    wire = false,
  ): Part {
    parent.add(obj);
    obj.userData.partId = info.id;
    obj.traverse((o) => {
      o.userData.partId = info.id;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const part: Part = { info, obj, base: obj.position.clone(), explode: new THREE.Vector3(...explode), role, wire };
    this.parts.push(part);
    return part;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.Material) {
    return new THREE.Mesh(g, m);
  }

  /* ---------- shell: 4 halves (DOC "outer casing made up of 4 main components") ---------- */
  private buildShell(stations: Station[], wall: number, shift = 0) {
    const seam = this.seam;
    const halves: ['handle' | 'head', 1 | -1][] = [['handle', 1], ['handle', -1], ['head', 1], ['head', -1]];
    for (const [part, side] of halves) {
      const g = new THREE.Group();
      const shell = this.mesh(shellHalfGeometry(stations, part, side, seam, this.xEnd, wall), MAT.shellTex(side, stations));
      const plate = this.mesh(
        seamPlateGeometry(stations, side, seam, wall * 0.6, part === 'handle' ? -0.35 : 0.35, 9),
        MAT.relief(),
      );
      g.add(shell, plate);
      // ---- raised relief: ribs, slats, ledges, frame bands (real geometry, flat-shaded) ----
      const sx = (x: number) => (x > 150 ? x + shift : x);
      const ribGeos: THREE.BufferGeometry[] = [];
      const C = this.spec.controls;
      for (const it of reliefItems(stations, { start: C.triggerStart.value, end: C.triggerEnd.value, width: C.triggerWidth.value }, seam,
        { x: C.frX.value, y: C.frY.value, length: C.frLength.value, width: C.frWidth.value })) {
        if (it.part !== part) continue;
        const path = it.path.map(([x, y]) => [sx(x), y] as [number, number]);
        ribGeos.push(ribGeometry(stations, path, side, it.w, it.h, it.profile, it.widths));
      }
      // one draw call per shell half for all of its relief
      if (ribGeos.length) {
        const merged = mergeGeometries(ribGeos, false);
        ribGeos.forEach((r) => r.dispose());
        if (merged) g.add(this.mesh(merged, MAT.relief()));
      }
      if (part === 'head') {
        const pg = plateGeometry(stations, plateCorners(seam).map(([x, y]) => [sx(x), y] as [number, number]), side, 0.75, 0.6);
        g.add(this.mesh(pg.top, MAT.plate(side)), this.mesh(pg.walls, MAT.plateEdge()));
      }
      if (part === 'handle') {
        // flat butt end face (Micro-USB port lives here — PHOTO "Lightweight and Portable" inset)
        const pr = profileAt(stations, 0.01);
        const pts: number[] = [];
        const N = 36;
        for (let j = 0; j <= N; j++) {
          const q = sectionPoint(pr, j / N, side);
          pts.push(0.01, q.y, q.z);
        }
        const cap = new THREE.BufferGeometry();
        const verts = [0.01, (pr.top - pr.bottom) / 2, 0, ...pts];
        const idx: number[] = [];
        for (let j = 0; j < N; j++) idx.push(0, j + 1, j + 2);
        cap.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        cap.setIndex(idx);
        cap.computeVertexNormals();
        g.add(this.mesh(cap, MAT.shell()));
      }
      const sideName = side > 0 ? 'left' : 'right';
      this.add(
        part === 'handle' ? this.handle : this.head,
        g,
        {
          id: `shell-${part}-${sideName}`,
          name: `${part === 'handle' ? 'Handle (grip)' : 'Head (barrel)'} shell — ${sideName} half`,
          group: 'Shell',
          desc:
            part === 'handle'
              ? 'Textured matte-black clamshell half of the grip: diagonal side grooves, ribbed back panel, butt hook with lanyard hole. Holds the 18650 cell, trigger switch, F/R button and charge PCB.'
              : 'Clamshell half of the swivel barrel: glossy logo/label plate, stepped lower grooves, faceted nose, LED chin. Holds motor and gearbox.',
          confidence: 'measured',
          source: 'Side profile traced from the listing photos (straight-mode image, 4.72 px/mm, ±1.5 mm) and pistol-mode grip. Widths and wall thickness assumed (no top view).',
          dims: part === 'handle' ? '≈110 mm to seam centre' : '≈93 mm seam centre → nose',
        },
        [0, 0, side * 95],
        'shell',
      );
    }
  }

  /* ---------- handle internals (cell along the BACK, switch under the trigger) ---------- */
  private buildHandleInternals(S: ScrewdriverSpec, stations: Station[]) {
    const b = S.battery;
    const br = b.diameter.value / 2;
    const bx = b.startX.value;
    const wall = S.body.wall.value;
    let bottom = Infinity;
    for (let x = bx; x <= bx + b.length.value; x += 2) bottom = Math.min(bottom, profileAt(stations, x).bottom);
    const by = -(bottom - wall - br - 0.5);
    const cell = new THREE.Group();
    cell.add(this.mesh(cylX(br, b.length.value - 1, bx + 0.5), MAT.purple()));
    cell.add(this.mesh(cylX(br * 0.95, 0.5, bx), MAT.steel()));
    cell.add(this.mesh(cylX(3, 1.2, bx + b.length.value - 0.5), MAT.steel()));
    cell.position.y = by;
    this.add(this.handle, cell, {
      id: 'battery', name: '18650 Li-ion cell', group: 'Electrical',
      desc: 'Single purple-wrapped 18650 cell, 3.6 V nominal (4.2 V full). Printed capacity "1500mAh". Runs along the back of the grip.',
      confidence: 'measured', source: 'TEARDOWN photo label & position; BOX 3.6 V', dims: `Ø${b.diameter.value} × ${b.length.value} mm, ${b.capacity.value * 1000} mAh`,
    }, [0, -55, 0]);

    // Charge PCB with Micro-USB (butt end face) + bi-colour pilot LED (front of the butt hook)
    const pcb = new THREE.Group();
    pcb.add(this.mesh(new THREE.BoxGeometry(24, 9, 1.2).translate(14, 0, 0), MAT.pcb()));
    pcb.add(this.mesh(new THREE.BoxGeometry(5.5, 2.6, 7.6).translate(3.2, -1, 0), MAT.steel())); // micro-USB receptacle
    pcb.add(this.mesh(new THREE.BoxGeometry(0.4, 1.6, 5.6).translate(0.5, -1, 0), MAT.black())); // port mouth
    pcb.add(this.mesh(new THREE.BoxGeometry(4, 1.6, 3).translate(15, 1, 1.4), MAT.black())); // charger IC (unidentified)
    const pilot = this.mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 16).translate(0, 1.6, 0), MAT.led(0xffd9d9));
    pilot.add(this.mesh(new THREE.SphereGeometry(1.5, 16, 8).translate(0, 3.2, 0), pilot.material as THREE.Material));
    const topAt7 = profileAt(stations, 7).top;
    pcb.position.set(0.5, 12, 0);
    pilot.position.set(6.5, topAt7 - 12 - 4.6, 0);
    pcb.add(pilot);
    this.pilotLed = pilot;
    this.add(this.handle, pcb, {
      id: 'pcb', name: 'Charge PCB + Micro-USB + pilot lamp', group: 'Electrical',
      desc: 'Green board in the butt. Micro-USB input on the butt end face; the pilot lamp shines out of the front of the butt hook — red while charging, green when full (LISTING).',
      confidence: 'measured', source: 'TEARDOWN (board, LED); LISTING ("Micro USB", "Pilot Lamp", "Red: Charging / Green: Fully Charged")',
      dims: '≈24 × 9 mm',
    }, [-30, 35, 0]);

    // Trigger micro-switch block (under the trigger)
    const top76 = profileAt(stations, 76).top;
    const sw = new THREE.Group();
    sw.add(this.mesh(new THREE.BoxGeometry(20, 12, 12), MAT.black()));
    sw.add(this.mesh(new THREE.BoxGeometry(20, 1, 12).translate(0, -6.5, 0), MAT.white()));
    sw.add(this.mesh(new THREE.CylinderGeometry(2.5, 2.5, 3, 20).translate(-4, 7.5, 0), MAT.black())); // plunger
    sw.position.set(74, top76 - wall - 6 - 2.5, 0);
    this.add(this.handle, sw, {
      id: 'switch', name: 'Trigger switch + F/R contacts', group: 'Controls',
      desc: 'Black switch block under the trigger (plunger toward the trigger). The F/R push-through button beside it reverses motor polarity.',
      confidence: 'measured', source: 'TEARDOWN photo (black block with round plunger); function from LISTING control labels',
      dims: '≈20 × 12 × 12 mm',
    }, [0, 40, 0]);

    // swivel collar socket (handle side)
    const n = seamNormal(this.seam);
    const socket = this.mesh(
      new THREE.CylinderGeometry(S.controls.collarRadius.value + 1.6, S.controls.collarRadius.value + 1.6, S.controls.collarDepth.value + 1, 48, 1, true),
      MAT.shellInner(),
    );
    socket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    socket.position.set(this.seam.x0, 0, 0).addScaledVector(n, -(S.controls.collarDepth.value + 1) / 2 - 1.2);
    this.add(this.handle, socket, {
      id: 'collar-socket', name: 'Swivel socket (handle side)', group: 'Shell',
      desc: 'Round socket molded into the handle halves that receives the head collar.',
      confidence: 'assumed', source: 'Inferred: the head must rotate 180° about the seam normal; not visible in photos',
    }, [0, 0, 0]);

    // wiring (handle side): cell → switch/F-R → collar centre; PCB → cell
    const jx = this.seam.x0;
    const bEnd = bx + b.length.value;
    this.wire(this.handle, 'wire-bat-pos', 0xd01818, [[bEnd + 1, by, 3], [bEnd + 4, by + 6, 4], [82, 6, 5]]);
    this.wire(this.handle, 'wire-bat-neg', 0x111111, [[bx - 1, by, -3], [bx - 4, by + 8, -3], [12, 9, -1.5]]);
    this.wire(this.handle, 'wire-pcb-blue', 0x1d4fd0, [[22, 10, 1.5], [40, 4, 3], [bx + 10, by + br + 0.6, 3]]);
    this.wire(this.handle, 'wire-pcb-red', 0xd01818, [[24, 11, -1.5], [45, 6, -3], [66, 7, -4]]);
    this.wire(this.handle, 'wire-mot-pos', 0xd01818, [[84, 4, 4], [97, 1, 3], [jx - 1, 0.5, 1.2]]);
    this.wire(this.handle, 'wire-mot-neg', 0x111111, [[84, 3, -4], [97, -1, -3], [jx - 1, -0.5, -1.2]]);
  }

  private wire(parent: THREE.Object3D, id: string, color: number, pts: [number, number, number][]) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const m = this.mesh(new THREE.TubeGeometry(curve, 32, 0.6, 8), MAT.wire(color));
    this.add(parent, m, {
      id, name: 'Hook-up wire', group: 'Electrical',
      desc: 'Wiring between cell, PCB, switch, motor and LED. Routing is approximate.',
      confidence: 'assumed', source: 'Colours from TEARDOWN; exact routing not traced',
    }, [0, 0, 0], 'internal', true);
  }

  /* ---------- external controls ---------- */
  private buildControls(S: ScrewdriverSpec, stations: Station[], _shift: number) {
    const C = S.controls;
    // --- Trigger ("Switch Button"): red paddle on the +Y (front) face of the grip ---
    const t0 = C.triggerStart.value, t1 = C.triggerEnd.value, th = C.triggerHeight.value;
    const base = (x: number) => profileAt(stations, x).top - 2.5;
    const tp: [number, number][] = [
      [t1, base(t1)], [t1, base(t1) + 3.8], [t1 - 6, base(t1 - 6) + 5.2],
      [t0 + 3, th], [t0 + 0.6, th - 0.4], [t0, th - 2], [t0, base(t0)],
    ];
    const tg = this.trigger;
    tg.add(this.mesh(extrudeXY(tp, C.triggerWidth.value, 0.9), MAT.red()));
    // pivot near the F/R end (paddle swings in at its tip)
    this.triggerPivot.set(t1 - 1, base(t1) + 1.5, 0);
    tg.position.copy(this.triggerPivot);
    tg.children[0].position.copy(this.triggerPivot).multiplyScalar(-1);
    this.add(this.handle, tg, {
      id: 'trigger', name: 'Trigger ("Switch Button")', group: 'Controls',
      desc: 'Red paddle on the front of the grip (top in straight mode). Momentary: hold to run; the LED headlamp lights automatically while running (LISTING / OWNER).',
      confidence: 'measured', source: 'PHOTO-S (54–86 mm, tip 31 mm above axis); LISTING label "Switch Button". Width assumed.',
      dims: `${(t1 - t0).toFixed(0)} mm long, ${C.triggerWidth.value} mm wide`,
    }, [0, 45, 0]);

    // --- F/R push-through button ("Positive and Negative Switch") ---
    const fr = this.frButton;
    const prF = profileAt(stations, C.frX.value);
    const half = prF.half - prF.sd;
    const capG = stadium(C.frLength.value, C.frWidth.value, 3.2, 1.0);
    const arrows = labelTexture('▶▶', { w: 256, h: 128, bg: '#d3121c', color: '#3a0306', size: 70 });
    for (const sd of [1, -1] as const) {
      const cap = this.mesh(capG, MAT.red());
      cap.position.set(0, 0, sd * (half - 0.4));
      fr.add(cap);
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(C.frLength.value * 0.55, C.frWidth.value * 0.55), new THREE.MeshBasicMaterial({ map: arrows, transparent: false }));
      lbl.rotation.set(0, sd > 0 ? 0 : Math.PI, Math.PI / 2 * (sd > 0 ? 1 : -1));
      lbl.position.set(0, 0, sd * (half + 1.25));
      fr.add(lbl);
    }
    fr.add(this.mesh(new THREE.BoxGeometry(4, 6, half * 2 - 2), MAT.red()));
    fr.position.set(C.frX.value, C.frY.value, 0);
    this.add(this.handle, fr, {
      id: 'fr-button', name: 'F/R button ("Positive and Negative Switch")', group: 'Controls',
      desc: 'Red push-through pill above the trigger, visible on both sides; push from one side for forward, the other for reverse. Marked ▶▶.',
      confidence: 'measured', source: 'PHOTO-S position (front edge level with the trigger front, yaw-corrected ≈84.5–91.5 mm; PHOTO-P agrees), 2.5–15 mm above axis; both sides visible in listing photos; TEARDOWN red ▲▲ part',
      dims: `${C.frLength.value} × ${C.frWidth.value} mm pill`,
    }, [0, 0, 60]);

    // --- PUSH swivel-release button on the head (top, just ahead of the seam) ---
    const pb = this.pushButton;
    const px = C.pushX.value;
    const ptop = profileAt(stations, px).top;
    const pushG = stadium(C.pushWidth.value, 7, 5, 1.2);
    pushG.rotateX(Math.PI / 2);
    const pm = this.mesh(pushG, MAT.red());
    pb.add(pm);
    const pushLbl = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), new THREE.MeshBasicMaterial({ map: labelTexture('PUSH', { w: 256, h: 128, bg: '#d3121c', color: '#4a0408', size: 72 }) }));
    pushLbl.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    pushLbl.position.set(0, 2.55, 0);
    pb.add(pushLbl);
    const coil = new THREE.CatmullRomCurve3(Array.from({ length: 80 }, (_, i) => {
      const t = i / 79;
      return new THREE.Vector3(1.6 * Math.cos(t * Math.PI * 12), -3 - t * 6, 1.6 * Math.sin(t * Math.PI * 12));
    }));
    pb.add(this.mesh(new THREE.TubeGeometry(coil, 200, 0.25, 6), MAT.steel()));
    pb.position.set(px, ptop + 0.4, 0);
    this.add(this.head, pb, {
      id: 'push-button', name: 'PUSH swivel-release button ("Rotary Switch")', group: 'Controls',
      desc: 'Spring-loaded red latch on top of the head next to the ⟳ icon. Press and hold to swivel the head; it pops up when the head locks (LISTING).',
      confidence: 'measured', source: 'PHOTO-S/PHOTO-P position; LISTING "Press and hold the PUSH switch…"; TEARDOWN red part with spring',
      dims: `${C.pushWidth.value} × 7 mm`,
    }, [0, 45, 0]);
  }
  /* ---------- motor ---------- */
  private buildMotor(S: ScrewdriverSpec) {
    const mo = S.motor;
    const r = mo.canDiameter.value / 2;
    const x = mo.startX.value;
    const ec = mo.endcapLength.value;
    const L = mo.canLength.value;
    const can = new THREE.Group();
    const canMesh = this.mesh(new THREE.CylinderGeometry(r, r, L, 56, 1, true).rotateZ(-Math.PI / 2).translate(x + ec + L / 2, 0, 0), MAT.can());
    can.add(canMesh);
    can.add(this.mesh(discGeometry(r, 0.6, 1.4).translate(x + ec + L - 0.6, 0, 0), MAT.can()));
    can.add(this.mesh(cylX(5, 1.8, x + ec + L), MAT.can())); // front bearing boss
    can.add(this.mesh(cylX(r - 0.3, ec, x), MAT.white())); // rear end-cap (brush holder)
    for (const s of [-1, 1]) {
      can.add(this.mesh(new THREE.BoxGeometry(1.2, 4, 3).translate(x - 0.6, s * 7, 0), MAT.brass())); // terminals
      can.add(this.mesh(new THREE.BoxGeometry(9, 3, 0.4).translate(x + ec + 8, 0, s * (r + 0.05)), MAT.black())); // vent slots
    }
    // permanent magnets (visible in ghost mode)
    for (const s of [0, Math.PI]) {
      const mg = new THREE.CylinderGeometry(r - 0.6, r - 0.6, L - 6, 24, 1, true, s - 1.1, 2.2).rotateZ(-Math.PI / 2);
      can.add(this.mesh(mg.translate(x + ec + L / 2, 0, 0), MAT.magnet()));
    }
    this.add(this.head, can, {
      id: 'motor', name: 'Motor — RS-380SA (DC 3.6 V)', group: 'Motor',
      desc: 'Brushed permanent-magnet DC motor, stamped "RS380SA DC3.6V". Calibrated so the stock 81:1 gearbox gives the box ratings (220 rpm no-load, 3 N·m max).',
      confidence: 'confirmed', source: 'TEARDOWN stamp; OWNER confirmed RS-380SA; can dims = RS-380 standard',
      dims: `Ø${mo.canDiameter.value} × ${mo.canLength.value} mm can, Ø${mo.shaftDiameter.value} mm shaft`,
    }, [-50, 0, 0]);

    // rotor: shaft + 3-pole armature + commutator (spins with motor)
    const rot = this.rotor;
    rot.add(this.mesh(cylX(mo.shaftDiameter.value / 2, ec + L + 2 + mo.shaftProtrusion.value + 2, x - 1.5, 16), MAT.steel()));
    // 3-pole armature: core + arms + pole shoes
    const aL = L - 10, ax = x + ec + 5;
    rot.add(this.mesh(cylX(3.2, aL, ax, 20), MAT.steel()));
    for (let i = 0; i < 3; i++) {
      const t = (i * 2 * Math.PI) / 3;
      const arm = new THREE.BoxGeometry(aL, r - 4, 3.2).translate(ax + aL / 2, (r - 4) / 2 + 1, 0);
      const armM = this.mesh(arm, MAT.copper());
      armM.rotation.x = t;
      rot.add(armM);
      const shoe = new THREE.CylinderGeometry(r - 1.4, r - 1.4, aL, 14, 1, false, t - 0.75, 1.5)
        .rotateZ(-Math.PI / 2).translate(ax + aL / 2, 0, 0);
      rot.add(this.mesh(shoe, MAT.steel()));
    }
    rot.add(this.mesh(cylX(3, 4, x + ec - 1, 12), MAT.brass())); // commutator
    this.add(this.head, rot, {
      id: 'rotor', name: 'Motor armature + shaft', group: 'Motor',
      desc: 'Three-pole wound armature, commutator and output shaft (standard RS-380 construction). The stage-1 sun gear is pressed onto the shaft.',
      confidence: 'standard', source: 'RS-380 construction; internal winding not inspected',
    }, [-50, 0, 0]);

    // black mount ring between motor and gearbox
    const ring = this.mesh(discGeometry(15, 4, 5.2).translate(x + ec + L, 0, 0), MAT.black());
    this.add(this.head, ring, {
      id: 'mount-ring', name: 'Motor / gearbox mount ring', group: 'Motor',
      desc: 'Black ring seating the motor face against the gearbox housing.',
      confidence: 'measured', source: 'TEARDOWN photo', dims: '≈Ø30 × 4 mm',
    }, [-15, 0, 0]);
  }

  /* ---------- gearbox ---------- */
  private buildGearbox(S: ScrewdriverSpec, gearStart: number, pitches: number[], housingEnd: number, gearsEnd: number) {
    const gb = S.gearbox;
    const ringOuter = Math.max(...S.stages.map((s) => (s.module * s.ring) / 2 + 1.25 * s.module + 0.8));
    const hOut = Math.max(gb.housingDiameter.value / 2, ringOuter + 0.8);
    const nose = gb.noseDiameter.value / 2;
    const spR = S.spindle.outerDiameter.value / 2;
    const hs = gb.housingStartX.value;
    const front = gearsEnd + 0.6;
    const prof = [
      new THREE.Vector2(ringOuter, hs), new THREE.Vector2(hOut, hs), new THREE.Vector2(hOut, housingEnd),
      new THREE.Vector2(hOut - 2.5, housingEnd + 2.5), new THREE.Vector2(nose + 1.5, housingEnd + 5), new THREE.Vector2(nose, housingEnd + 6),
      new THREE.Vector2(nose, this.xEnd - 1.5), new THREE.Vector2(spR + 0.3, this.xEnd - 1.5),
      new THREE.Vector2(spR + 0.3, front + 1.5), new THREE.Vector2(ringOuter, front), new THREE.Vector2(ringOuter, hs),
    ];
    const lathe = new THREE.LatheGeometry(prof, 72).rotateZ(-Math.PI / 2);
    // LatheGeometry maps (r, h) → (r·sin, h, r·cos); after rotateZ(-90°) h → +x, r → −y (symmetric)
    const housing = this.mesh(lathe, MAT.housing());
    const hPart = this.add(this.head, housing, {
      id: 'housing', name: 'Gearbox housing (translucent)', group: 'Gearbox',
      desc: 'Translucent pale-green plastic housing with the ring gears molded inside; the nose carries the spindle bearing.',
      confidence: 'measured', source: 'TEARDOWN / image9 photos; Ø and length from photo scale',
      dims: `Ø${(hOut * 2).toFixed(1)} mm body, ${(housingEnd - hs).toFixed(0)} mm long + nose`,
    }, [0, 75, 0], 'housing');
    void hPart;

    let x = gearStart;
    S.stages.forEach((s, k) => {
      const mat = MATERIALS[s.material];
      const a = carrierRadius(s);
      const fw = s.faceWidth;
      const tag = s.stock ? 'stock' : 'CUSTOM';
      const explodeX = 30 * (k + 1);
      // ring (molded into housing)
      const ring = this.mesh(ringGearGeometry(s.ring, s.module, fw + 1, ringOuter).translate(x - 0.5, 0, 0), MAT.housing());
      this.add(this.head, ring, {
        id: `ring-${k}`, name: `Ring gear — stage ${k + 1} (${s.ring}T)`, group: 'Gearbox',
        desc: `Internal ring gear, fixed (molded into housing). ${tag} stage.`,
        confidence: s.stock ? 'confirmed' : 'derived', source: s.stock ? 'OWNER: ring 48 teeth' : 'User-defined custom stage',
        dims: `${s.ring} teeth, m ${s.module}, pitch Ø ${(s.module * s.ring).toFixed(1)} mm`,
      }, [0, 75, 0], 'housing');

      // sun
      const shiftSun = Math.max(0, requiredSunShift(s));
      const sunBore = k === 0 ? S.motor.shaftDiameter.value / 2 : 0;
      const sun = this.mesh(externalGearGeometry(s.sun, s.module, fw, sunBore, shiftSun), MAT.ivory(k === 0 ? 0xf7f4ec : mat.color));
      sun.position.set(x, 0, 0);
      this.add(this.head, sun, {
        id: `sun-${k}`, name: `Sun gear — stage ${k + 1} (${s.sun}T)`, group: 'Gearbox',
        desc:
          (k === 0 ? 'Pinion pressed on the motor shaft. ' : `Molded onto the stage-${k} carrier (assumed one piece). `) +
          (shiftSun > 0.01 ? `Drawn with +${shiftSun.toFixed(2)}·m profile shift so it reaches the ${s.planet}T planets (see geometry check).` : ''),
        confidence: s.stock ? 'confirmed' : 'derived', source: s.stock ? 'OWNER: sun 6 teeth' : 'User-defined custom stage',
        dims: `${s.sun} teeth, m ${s.module}, face ${fw} mm`,
      }, [explodeX - 8, 0, 0]);

      // carrier (plate + pins) — clear plastic
      const carrier = new THREE.Group();
      const plateX = x + fw + 0.5;
      const pinR = 1.9;
      carrier.add(this.mesh(discGeometry(a + 4.2, gb.carrierThickness.value, 0).translate(plateX, 0, 0), MAT.clear()));
      for (let i = 0; i < s.planets; i++) {
        const v = polarYZ(a, (2 * Math.PI * i) / s.planets);
        carrier.add(this.mesh(cylX(pinR, fw + 1, x - 0.6, 16).translate(0, v.x, v.y), MAT.clear()));
      }
      const isLast = k === S.stages.length - 1;
      if (!isLast) {
        const nextX = x + pitches[k];
        carrier.add(this.mesh(cylX(2.4, nextX - (plateX + gb.carrierThickness.value), plateX + gb.carrierThickness.value, 20), MAT.clear()));
      }
      carrier.position.set(0, 0, 0);
      this.add(this.head, carrier, {
        id: `carrier-${k}`, name: `Planet carrier — stage ${k + 1}${isLast ? ' (output)' : ''}`, group: 'Gearbox',
        desc: isLast ? 'Output carrier; drives the hex spindle.' : `Carries the stage ${k + 1} planets and drives the stage ${k + 2} sun.`,
        confidence: 'measured', source: 'Clear 3-hole carrier disc in image9; plate thickness assumed',
      }, [explodeX + 6, 0, 0]);

      // planets
      const planets: THREE.Mesh[] = [];
      const pParts: Part[] = [];
      for (let i = 0; i < s.planets; i++) {
        const g = externalGearGeometry(s.planet, s.module, fw, 2.0);
        const pm = this.mesh(g, MAT.ivory(mat.color));
        // raised hub (notebook: hub Ø 0.9 cm, bore 0.4 cm)
        pm.add(this.mesh(discGeometry(Math.min(4.5, (s.module * s.planet) / 2 - 1.5 * s.module), 0.4, 2.0).translate(-0.4, 0, 0), MAT.ivory(mat.color)));
        pm.add(this.mesh(discGeometry(Math.min(4.5, (s.module * s.planet) / 2 - 1.5 * s.module), 0.4, 2.0).translate(fw, 0, 0), MAT.ivory(mat.color)));
        planets.push(pm);
        pParts.push(
          this.add(this.head, pm, {
            id: `planet-${k}-${i}`, name: `Planet gear — stage ${k + 1} #${i + 1} (${s.planet}T)`, group: 'Gearbox',
            desc: `Planet on a carrier pin. Material: ${mat.name}${s.stock ? ' (stock material not identified — ivory plastic, assumed POM)' : ''}.`,
            confidence: s.stock ? 'uncertain' : 'derived',
            source: s.stock ? 'DOC notebook "# teeth on gear: 19", Ø14 mm, 4 mm thick, 4 mm bore. Tooth count conflicts with 48/6 geometry (21 expected).' : 'User-defined',
            dims: `${s.planet} teeth, m ${s.module}, OD ${(s.module * (s.planet + 2)).toFixed(1)} mm`,
          }, [explodeX, 0, 0]),
        );
      }
      this.stages.push({ spec: s, sun, planets, planetParts: pParts, carrier, a, x0: x, explodeX });
      x += pitches[k];
    });
  }

  /* ---------- spindle (chuck) + bit ---------- */
  private buildOutput(S: ScrewdriverSpec, gearsEnd: number, opts: BuildOptions) {
    const sp = S.spindle;
    const r = sp.outerDiameter.value / 2;
    const xs = gearsEnd - 0.2;
    const xe = this.xEnd + sp.exposedLength.value;
    const g = this.spindle;
    g.add(this.mesh(cylX(r, this.xEnd - 6 - xs, xs, 48), MAT.chrome()));
    g.add(this.mesh(socketTubeGeometry(r, sp.hexAF.value + 0.15, xe - (this.xEnd - 6)).translate(this.xEnd - 6, 0, 0), MAT.chrome()));
    g.add(this.mesh(new THREE.TorusGeometry(r - 0.35, 0.35, 8, 48).rotateY(Math.PI / 2).translate(xe - 0.35, 0, 0), MAT.chrome()));
    g.add(this.mesh(discGeometry(sp.hexAF.value / Math.sqrt(3) + 0.3, 0.6).translate(xe - sp.socketDepth.value - 0.6, 0, 0), MAT.magnet()));
    this.add(this.head, g, {
      id: 'spindle', name: 'Hex chuck / spindle', group: 'Output',
      desc: 'Chrome spindle with magnetic 1/4" hex socket ("Durable Chuck", magnet shown in LISTING), driven by the output carrier. DOC notes the bit wobbles.',
      confidence: 'measured', source: 'DOC: OD 1.2 cm, ID 0.8 cm, 1.2 cm exposed; LISTING (magnetic); socket depth assumed',
      dims: `Ø${sp.outerDiameter.value} mm, 1/4" hex, ${sp.exposedLength.value} mm exposed`,
    }, [30 * (S.stages.length + 1) + 20, 0, 0]);

    if (opts.showBit) {
      const b0 = xe - sp.socketDepth.value;
      const { group, info } = buildBit(opts.bit, S.bit.length.value, S.bit.hexAF.value);
      group.position.x = b0;
      this.add(g, group, info, [45, 0, 0]);
    }
  }

  /* ---------- LED chin, white LED, swivel collar, head wiring ---------- */
  private buildHeadElectrics(S: ScrewdriverSpec, stations: Station[], shift: number) {
    const C = S.controls;
    const c0 = C.chinStart.value + shift, c1 = C.chinEnd.value + shift, cd = C.chinDepth.value;
    const b0 = -profileAt(stations, c0).bottom + 1.5, b1 = -profileAt(stations, c1).bottom + 1.5;
    const chinPts: [number, number][] = [[c0 - 2, b0], [c0 + 3, -cd + 0.5], [c0 + 4.5, -cd], [c1 - 1.2, -cd], [c1, -cd + 1.4], [c1 + 0.6, b1]];
    const chin = this.mesh(extrudeXY(chinPts, 17, 1.2), MAT.shell());
    // black nose lip closing the shell around the chuck (PHOTO: chuck exits a black cone)
    const noseR = profileAt(stations, this.xEnd).top;
    const noseLip = this.mesh(discGeometry(noseR, 1.6, S.spindle.outerDiameter.value / 2 + 0.35).translate(this.xEnd - 1.6, 0, 0), MAT.shell());
    this.add(this.head, noseLip, {
      id: 'nose-lip', name: 'Nose lip', group: 'Shell',
      desc: 'Black lip where the chuck exits the nose cone.',
      confidence: 'measured', source: 'Listing photos (nose Ø ≈21 mm at the tip, PHOTO-S)',
    }, [40, 0, 0], 'shell');
    this.add(this.head, chin, {
      id: 'chin', name: 'LED headlamp housing (chin)', group: 'Shell',
      desc: 'Protrusion under the barrel that carries the white LED, aimed forward at the bit tip.',
      confidence: 'measured', source: 'PHOTO-S (163–178 mm, 27 mm below axis); LISTING label "LED headlamp". Width assumed.',
    }, [0, -40, 0], 'shell');

    const led = this.mesh(cylX(1.6, 3, 0, 20), MAT.led(0xf8f8ff));
    led.add(this.mesh(new THREE.SphereGeometry(1.6, 20, 10).translate(3, 0, 0), led.material as THREE.Material));
    led.position.set(c1 - 3.2, -cd + 4.2, 0);
    led.rotation.z = 0.2; // tilted up toward the bit tip
    led.add(this.ledLight);
    this.ledLight.position.set(3.5, 0, 0);
    const tgt = new THREE.Object3D();
    tgt.position.set(80, 0, 0);
    led.add(tgt);
    this.ledLight.target = tgt;
    this.whiteLed = led;
    this.add(this.head, led, {
      id: 'led-white', name: 'White LED headlamp', group: 'Electrical',
      desc: 'Lights automatically while the trigger is held (LISTING / OWNER). Mounted in the chin under the barrel.',
      confidence: 'measured', source: 'LISTING ("LED headlamp", "automatically activates during use"); TEARDOWN loose LED at ≈155–165 mm',
    }, [0, -60, 0]);

    // swivel collar (head side), rotates with the head
    const n = seamNormal(this.seam);
    const collar = new THREE.Group();
    const cr = C.collarRadius.value, cdp = C.collarDepth.value;
    const tube = this.mesh(new THREE.CylinderGeometry(cr, cr, cdp + 3, 56, 1, true), MAT.shellInner());
    const lip = this.mesh(new THREE.TorusGeometry(cr, 0.9, 8, 56).rotateX(Math.PI / 2).translate(0, -(cdp + 3) / 2, 0), MAT.shellInner());
    collar.add(tube, lip);
    collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    collar.position.set(this.seam.x0, 0, 0).addScaledVector(n, 1.5 - (cdp + 3) / 2);
    this.add(this.head, collar, {
      id: 'collar', name: 'Swivel collar (head side)', group: 'Shell',
      desc: 'Round bearing collar centred on the swivel axis; reaches into the handle socket so the head can turn 180° and lets the motor end-cap sit across the seam plane.',
      confidence: 'assumed', source: 'Inferred from the 36° seam + motor position; not visible in any photo',
      dims: `R ${cr} mm, ${cdp} mm into handle`,
    }, [0, 0, 0]);

    const jx = this.seam.x0;
    const mx = S.motor.startX.value;
    this.wire(this.head, 'wire-mot-pos-h', 0xd01818, [[jx + 1, 0.5, 1.2], [mx - 3, 4, 3], [mx - 0.6, 7, 0.5]]);
    this.wire(this.head, 'wire-mot-neg-h', 0x111111, [[jx + 1, -0.5, -1.2], [mx - 3, -4, -3], [mx - 0.6, -7, -0.5]]);
    this.wire(this.head, 'wire-led', 0xd01818, [[jx + 1, -1.5, 2], [125, -12, 9], [155, -19.3, 5], [c1 - 6, led.position.y, 1]]);
    void seamX;
  }

  /* ---------- custom parts ---------- */
  private buildCustomParts(list: CustomPart[]) {
    for (const c of list) {
      const holder = new THREE.Group();
      const mat = std({ color: new THREE.Color(c.color), roughness: 0.5 });
      let geo: THREE.BufferGeometry | null = null;
      const sz = c.size;
      switch (c.kind) {
        case 'box': geo = new THREE.BoxGeometry(sz[0] || 10, sz[1] || 10, sz[2] || 10); break;
        case 'cylinder': geo = cylX(sz[0] || 5, sz[1] || 10, -(sz[1] || 10) / 2, 40); break;
        case 'tube': geo = discGeometry(sz[0] || 6, sz[1] || 10, sz[2] || 3).translate(-(sz[1] || 10) / 2, 0, 0); break;
        case 'sphere': geo = new THREE.SphereGeometry(sz[0] || 5, 32, 16); break;
        case 'gear': geo = externalGearGeometry(Math.max(4, Math.round(sz[0] || 12)), sz[1] || 0.667, sz[2] || 4, 1); break;
        case 'mesh': break;
      }
      if (geo) holder.add(new THREE.Mesh(geo, mat));
      else if (c.meshData) this.pendingLoads.push(this.loadMesh(c, holder, mat));
      holder.position.set(...c.position);
      holder.rotation.set(...(c.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]));
      const parent = c.attach === 'handle' ? this.handle : c.attach === 'head' ? this.head : c.attach === 'spindle' ? this.spindle : this.root;
      this.add(parent, holder, {
        id: `custom-${c.id}`, name: c.name, group: 'Custom',
        desc: c.note || `User-added ${c.kind} attached to ${c.attach}.`,
        confidence: 'derived', source: 'User-defined custom part', dims: `${c.kind} [${c.size.join(', ')}] · ${c.massG} g`,
      }, [0, 30, 0]);
    }
  }

  private async loadMesh(c: CustomPart, holder: THREE.Group, mat: THREE.Material) {
    try {
      const res = await fetch(c.meshData!);
      if (c.meshFormat === 'stl') {
        const g = new STLLoader().parse(await res.arrayBuffer());
        g.computeVertexNormals();
        holder.add(new THREE.Mesh(g, mat));
      } else if (c.meshFormat === 'obj') {
        const o = new OBJLoader().parse(await res.text());
        o.traverse((m) => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).material = mat; });
        holder.add(o);
      } else {
        const gltf = await new GLTFLoader().parseAsync(await res.arrayBuffer(), '');
        holder.add(gltf.scene);
      }
      holder.traverse((o) => (o.userData.partId = `custom-${c.id}`));
    } catch (e) {
      console.error('custom mesh load failed', e);
    }
  }

  /* ======================================================================= */
  applyLayout() {
    const t = this.explode;
    for (const p of this.parts) {
      p.obj.position.copy(p.base).addScaledVector(p.explode, t);
      let vis = true;
      if (p.wire) vis = this.showWires && t < 0.02;
      if (this.occlude && ScrewdriverModel.ENCLOSED.test(p.info.id)) vis = false;
      if (this.isolateId) vis = p.info.id === this.isolateId || this.isAncestorOfIsolated(p.obj);
      p.obj.visible = vis;
    }
    const n = seamNormal(this.seam);
    const ease = this.headAngle < 0.5 ? 2 * this.headAngle ** 2 : 1 - (-2 * this.headAngle + 2) ** 2 / 2;
    this.headPivot.quaternion.setFromAxisAngle(n, Math.PI * ease);
    // stand the tool up: grip vertical in pistol mode, horizontal when straight
    this.display.rotation.z = (Math.PI / 2) * ease;
    const cs = new THREE.Vector3((this.xEnd + 12) / 2, 0, 0), cp = new THREE.Vector3(this.seam.x0 - 10, 38, 0);
    this.root.position.copy(cs.lerp(cp, ease)).multiplyScalar(-1);
    this.headPivot.position.set(this.seam.x0, 0, 0).addScaledVector(n, 40 * t);
    const swivelling = this.headAngle > 0.002 && this.headAngle < 0.998;
    // PUSH is held down while swivelling and pops up when locked (LISTING)
    this.pushButton.position.y -= swivelling ? 2.2 : 0;
    // trigger swings in when pressed
    this.trigger.rotation.z = this.triggerPressed ? 0.11 : 0;
    // F/R pill shifts toward the pressed side
    this.frButton.position.z += this.direction > 0 ? 1.1 : -1.1;
  }

  updateKinematics(motorAngle: number, outputAngle: number) {
    this.rotor.rotation.x = motorAngle;
    const poses = poseStages(this.stages.map((s) => s.spec), motorAngle);
    this.stages.forEach((st, k) => {
      const pose = poses[k];
      st.sun.rotation.x = pose.sun;
      st.carrier.rotation.x = pose.carrier;
      st.planets.forEach((pm, i) => {
        const v = polarYZ(st.a, pose.planetOrbit[i]);
        const part = st.planetParts[i];
        part.base.set(st.x0, v.x, v.y);
        const dir = v.clone().normalize();
        part.explode.set(st.explodeX, dir.x * 12, dir.y * 12);
        pm.position.copy(part.base).addScaledVector(part.explode, this.explode);
        pm.rotation.x = pose.planets[i];
      });
    });
    this.spindle.rotation.x = poses.length ? poses[poses.length - 1].carrier : outputAngle;
  }

  private ledState = '';
  /** white: headlamp on; pilot: 'off' | 'red' (charging) | 'green' (full, on charger) */
  setLeds(white: boolean, pilot: 'off' | 'red' | 'green') {
    const key = `${white}|${pilot}`;
    if (key === this.ledState) return;
    this.ledState = key;
    const set = (m: THREE.Mesh | undefined, on: boolean, c: number) => {
      if (!m) return;
      const mat = m.material as THREE.MeshPhysicalMaterial;
      mat.emissive.setHex(on ? c : 0x000000);
      mat.emissiveIntensity = on ? 3 : 0;
    };
    set(this.whiteLed, white, 0xffffff);
    set(this.pilotLed, pilot !== 'off', pilot === 'green' ? 0x20ff40 : 0xff1010);
    this.ledLight.intensity = white ? 60000 : 0;
  }

  /** Parts completely hidden inside the closed shell. */
  static ENCLOSED = /^(battery|switch|collar|collar-socket|motor|rotor|mount-ring|housing|ring-\d+|sun-\d+|carrier-\d+|planet-\d+-\d+|wire-.*)$/;
  private isAncestorOfIsolated(obj: THREE.Object3D) {
    let o: THREE.Object3D | null = this.partById(this.isolateId!)?.obj ?? null;
    while (o) { if (o === obj) return true; o = o.parent; }
    return false;
  }

  partById(id: string) {
    return this.parts.find((p) => p.info.id === id);
  }
}

/* ======================================================================= */
/*  Bits — the 6 accessories in the listing: PH1, PH2, slotted 5 & 6, twist drills 2.0 & 3.0 */
/* ======================================================================= */
function buildBit(type: BitType, screwLen: number, af: number): { group: THREE.Group; info: PartInfo } {
  const g = new THREE.Group();
  const isDrill = type === 'D2' || type === 'D3';
  const hexLen = isDrill ? 22 : 25;
  // hex shank with power groove
  g.add(new THREE.Mesh(hexGeometry(af, 9), MAT.satin()));
  g.add(new THREE.Mesh(cylX(af / 2 - 0.55, 1.6, 9, 24), MAT.satin()));
  g.add(new THREE.Mesh(hexGeometry(af, hexLen - 10.6).translate(10.6, 0, 0), MAT.satin()));
  let total = screwLen;
  if (!isDrill) {
    const shaftLen = screwLen - hexLen - 7;
    g.add(new THREE.Mesh(cylX(2.2, 3, hexLen, 24, af / 2 - 0.2).rotateY(0), MAT.satin()));
    g.add(new THREE.Mesh(cylX(2.4, shaftLen - 3, hexLen + 3, 32), MAT.satin()));
    const tip = new THREE.Group();
    tip.position.x = hexLen + shaftLen;
    if (type === 'PH2' || type === 'PH1') {
      const R = type === 'PH2' ? 2.4 : 1.9, L = type === 'PH2' ? 7 : 6;
      // 4 tapered blades + core cone (Phillips cruciform)
      const blade = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, R), new THREE.Vector2(L * 0.55, R * 0.8), new THREE.Vector2(L, 0.25), new THREE.Vector2(L, 0)]);
      for (let i = 0; i < 4; i++) {
        const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.95, bevelEnabled: false }).translate(0, 0, -0.475);
        const m = new THREE.Mesh(bg, MAT.satin());
        m.rotation.x = (i * Math.PI) / 2 + Math.PI / 4;
        tip.add(m);
      }
      tip.add(new THREE.Mesh(cylX(1.1, L, 0, 16, 0.15), MAT.satin()));
    } else {
      const w = type === 'SL6' ? 6 : 5;
      const blade = new THREE.Shape([new THREE.Vector2(0, -1.4), new THREE.Vector2(0, 1.4), new THREE.Vector2(7, 0.35), new THREE.Vector2(7, -0.35)]);
      const bg = new THREE.ExtrudeGeometry(blade, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2);
      tip.add(new THREE.Mesh(bg, MAT.satin()));
    }
    g.add(tip);
  } else {
    const d = type === 'D3' ? 3 : 2;
    total = type === 'D3' ? 85 : 77;
    // chrome sleeve adapter (marked 3.0 / 2.0 in the listing photo)
    g.add(new THREE.Mesh(cylX(3.3, 14, hexLen, 32), MAT.chrome()));
    g.add(new THREE.Mesh(cylX(3.3, 3, hexLen + 14, 32, d / 2 + 0.2), MAT.chrome()));
    const fl = total - hexLen - 17 - 2;
    // fluted body: radius modulated by a double helix
    const body = new THREE.CylinderGeometry(d / 2, d / 2, fl, 48, 160, false);
    const pos = body.attributes.position as THREE.BufferAttribute;
    const pitch = d * 3.2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const th = Math.atan2(z, x);
      const rr = Math.hypot(x, z);
      if (rr < 1e-6) continue;
      const ph = th * 2 - ((y + fl / 2) / pitch) * Math.PI * 2 * 2;
      const k = 1 - 0.32 * Math.max(0, Math.cos(ph)) ** 2;
      pos.setXYZ(i, (x / rr) * rr * k, y, (z / rr) * rr * k);
    }
    body.computeVertexNormals();
    body.rotateZ(-Math.PI / 2).translate(hexLen + 17 + fl / 2, 0, 0);
    g.add(new THREE.Mesh(body, MAT.blackOxide()));
    g.add(new THREE.Mesh(cylX(d / 2, 2, hexLen + 17 + fl, 32, 0.05), MAT.blackOxide())); // 118° point
  }
  const name = BIT_TYPES.find((b) => b.id === type)!.name;
  return {
    group: g,
    info: {
      id: 'bit', name: `Bit — ${name}`, group: 'Output',
      desc: `One of the 6 included accessories (LISTING photo: 3.0 & 2.0 twist drills, slotted 5 & 6, PH1, PH2). Select another bit in the View tab.`,
      confidence: isDrill ? 'listing' : 'measured',
      source: isDrill ? 'LISTING photo (types); length estimated from photo proportions' : 'LISTING (types); length from TEARDOWN photo (≈50 mm)',
      dims: `${total} mm, 1/4" hex shank`,
    },
  };
}
