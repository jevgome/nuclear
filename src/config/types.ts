/**
 * Every physical value in Nuclear is a `Param`: a number plus where it came from
 * and how much we trust it. Change values in `screwdriver.ts` (or live in the
 * app's "Specs" tab, which can export/import JSON).
 */
export type Confidence =
  | 'confirmed' // stated by the owner / printed on the product or box
  | 'measured' // physically measured by the team (doc / photos)
  | 'listing' // from the Amazon product listing
  | 'derived' // calculated from other values (formula given in `note`)
  | 'standard' // industry standard / manufacturer datasheet for the named part
  | 'assumed' // engineering assumption, NOT verified on this unit
  | 'uncertain'; // conflicting or unknown — needs verification

export interface Param {
  value: number;
  unit: string;
  label: string;
  source: string;
  confidence: Confidence;
  note?: string;
  min?: number;
  max?: number;
  step?: number;
}

export const p = (
  value: number,
  unit: string,
  label: string,
  confidence: Confidence,
  source: string,
  note?: string,
  range?: { min?: number; max?: number; step?: number },
): Param => ({ value, unit, label, confidence, source, note, ...range });

export interface StageSpec {
  id: string;
  /** Sun teeth */
  sun: number;
  /** Ring (internal) teeth */
  ring: number;
  /** Planet teeth */
  planet: number;
  /** Number of planets */
  planets: number;
  /** Gear module, mm */
  module: number;
  /** Face width of planets/sun, mm */
  faceWidth: number;
  /** Mesh efficiency of this stage (0..1) */
  efficiency: number;
  /** Material key for strength estimate */
  material: MaterialKey;
  /** true for stock stages, false for user-added */
  stock: boolean;
}

export type MaterialKey = 'POM' | 'PA66' | 'PLA' | 'PETG' | 'Steel';

export interface Station {
  /** mm along the tool axis from the butt (straight configuration) */
  x: number;
  /** mm above the axis (side profile) */
  top: number;
  /** mm below the axis */
  bottom: number;
  /** half-width, mm (perpendicular to the parting plane) */
  half: number;
  /** body squareness: superellipse exponent (2 = round) */
  e?: number;
  /** flat side-panel cut depth, mm */
  sd?: number;
  /** upper chamfer facet cut depth, mm */
  ct?: number;
  /** lower chamfer facet cut depth, mm */
  cb?: number;
  /** upper / lower chamfer normal angle, degrees from horizontal */
  at?: number;
  ab?: number;
  /** hard break: interpolate linearly on both sides of this station */
  sharp?: boolean;
}

export interface CustomPart {
  id: string;
  name: string;
  kind: 'box' | 'cylinder' | 'tube' | 'sphere' | 'gear' | 'mesh';
  attach: 'handle' | 'head' | 'spindle' | 'world';
  color: string;
  /** size: box = [x,y,z]; cylinder/tube = [radius, length, innerRadius]; sphere = [r]; gear = [teeth, module, face] */
  size: number[];
  position: [number, number, number];
  rotation: [number, number, number]; // degrees
  massG: number;
  /** For imported meshes: data URL of STL/OBJ/GLB */
  meshData?: string;
  meshFormat?: 'stl' | 'obj' | 'glb';
  note?: string;
}
