import { defaultSpec, type ScrewdriverSpec } from './screwdriver';
import type { Param } from './types';

const KEY = 'nuclear.spec.v3'; // v3: nose re-profiled, F/R moved (yaw-corrected listing photos)

/** Merge a saved/imported spec onto the defaults so new fields added later still appear. */
export function mergeSpec(saved: unknown): ScrewdriverSpec {
  const base = defaultSpec();
  if (!saved || typeof saved !== 'object') return base;
  const s = saved as Record<string, unknown>;
  for (const group of Object.keys(base) as (keyof ScrewdriverSpec)[]) {
    const g = s[group];
    if (g === undefined) continue;
    if (group === 'stages' || group === 'profile' || group === 'customParts') {
      if (Array.isArray(g)) (base as unknown as Record<string, unknown>)[group] = g;
      continue;
    }
    const bg = base[group] as unknown as Record<string, Param>;
    const sg = g as Record<string, Partial<Param>>;
    for (const k of Object.keys(bg)) {
      if (sg[k] && typeof sg[k].value === 'number') {
        bg[k] = { ...bg[k], value: sg[k].value as number };
        if (sg[k].confidence && sg[k].confidence !== bg[k].confidence && sg[k].source) {
          bg[k].confidence = sg[k].confidence!;
          bg[k].source = sg[k].source!;
        }
      }
    }
  }
  return base;
}

export function loadSpec(): ScrewdriverSpec {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return mergeSpec(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt → defaults */
  }
  return defaultSpec();
}

export function saveSpec(spec: ScrewdriverSpec) {
  try {
    localStorage.setItem(KEY, JSON.stringify(spec));
  } catch {
    /* ignore (quota / private mode) */
  }
}

export function clearSaved() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function download(name: string, data: string, mime = 'application/json') {
  const a = document.createElement('a');
  a.href = data.startsWith('data:') || data.startsWith('blob:') ? data : URL.createObjectURL(new Blob([data], { type: mime }));
  a.download = name;
  a.click();
}
