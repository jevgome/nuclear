import { icon } from './icons';

type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
type Child = Node | string | number | null | undefined | false | Child[];

/** Tiny hyperscript helper. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c: Child) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

/** Numeric input with an optional unit suffix rendered inside the field. */
export function numInput(
  value: number, onChange: (v: number) => void,
  o: { step?: number; min?: number; max?: number; unit?: string; w?: string; title?: string } = {},
) {
  const inp = h('input', {
    type: 'number', value: fmtNum(value), step: o.step !== undefined ? String(o.step) : 'any',
    min: o.min !== undefined ? String(o.min) : undefined, max: o.max !== undefined ? String(o.max) : undefined,
    title: o.title,
  });
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) onChange(v);
  });
  const wrap = h('span', { class: 'num' }, inp, o.unit ? h('span', { class: 'unit' }, o.unit) : null);
  if (o.w) wrap.style.width = o.w;
  return wrap;
}
const fmtNum = (v: number) => (Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(2) : String(+v.toPrecision(6)));

export function select<T extends string>(options: [T, string][], value: T, onPick: (v: T) => void, title?: string) {
  const s = h('select', { title }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  s.addEventListener('change', () => onPick(s.value as T));
  return s;
}

export function seg<T extends string>(options: [T, string][], value: T, onPick: (v: T) => void) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  const render = (cur: T) => {
    wrap.replaceChildren(
      ...options.map(([v, label]) =>
        h('button', { class: v === cur ? 'on' : '', role: 'radio', 'aria-checked': String(v === cur), onclick: () => { onPick(v); render(v); } }, label),
      ),
    );
  };
  render(value);
  return { el: wrap, set: render };
}

export function checkbox(checked: boolean, label: string, onChange: (v: boolean) => void, title?: string) {
  const c = h('input', { type: 'checkbox', checked });
  c.addEventListener('change', () => onChange(c.checked));
  return h('label', { class: 'check', title }, c, h('span', {}, label));
}

export function iconBtn(name: string, title: string, onClick: () => void, o: { active?: boolean; cls?: string; label?: string } = {}) {
  return h('button', {
    class: `ibtn${o.active ? ' on' : ''}${o.cls ? ` ${o.cls}` : ''}${o.label ? ' wide' : ''}`, title, 'aria-label': title,
    onclick: () => onClick(),
  }, icon(name), o.label ? h('span', { class: 'lbl' }, o.label) : null);
}

/** Collapsible panel section. */
export function section(title: string, ...children: (Node | null | false | undefined)[]) {
  return sectionEx(title, { open: true }, ...children);
}
/** Remembers sections the user opened/closed, so re-rendering a panel doesn't reset them. */
const sectionState = new Map<string, boolean>();

export function sectionEx(
  title: string, o: { open?: boolean; aside?: Node | null; info?: string; key?: string }, ...children: (Node | null | false | undefined)[]
) {
  const key = o.key ?? title;
  const d = h('details', { class: 'sec', open: sectionState.get(key) ?? o.open !== false });
  d.addEventListener('toggle', () => sectionState.set(key, d.open));
  d.append(
    h('summary', {}, icon('chevron', 12), h('span', { class: 'sec-t' }, title),
      o.info ? h('span', { class: 'info', title: o.info }, icon('info', 13)) : null,
      h('span', { class: 'grow' }), o.aside ?? null),
    h('div', { class: 'sec-b' }, ...children.filter(Boolean) as Node[]),
  );
  return d;
}

/** Property-grid row: label | control. */
export function prop(label: string, control: Node | string, title?: string) {
  if (!label) return h('div', { class: 'prop full', title }, h('span', { class: 'prop-v' }, control));
  return h('div', { class: 'prop', title }, h('span', { class: 'prop-l' }, label), h('span', { class: 'prop-v' }, control));
}

/** Read-only value row (tabular figures). */
export function stat(label: string, value: string, key?: string, store?: Record<string, HTMLElement>) {
  const v = h('span', { class: 'stat-v' }, value);
  if (key && store) store[key] = v;
  return h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, label), v);
}

export const hint = (text: string) => h('p', { class: 'hint' }, text);

export const CONF_LABEL: Record<string, string> = {
  confirmed: 'Confirmed', measured: 'Measured', listing: 'Listing', derived: 'Derived',
  standard: 'Standard', assumed: 'Assumed', uncertain: 'Uncertain',
};
export const CONF_HELP: Record<string, string> = {
  confirmed: 'Stated by the owner or printed on the product / box',
  measured: 'Measured on the unit or from scale-calibrated photos',
  listing: 'From the Amazon product listing',
  standard: 'Industry standard or datasheet for the named part',
  derived: 'Calculated from other values',
  assumed: 'Engineering assumption — not verified on this unit',
  uncertain: 'Conflicting or unknown — needs verification',
};
/** Confidence indicator: small dot + label. */
export const conf = (c: string, withLabel = true) =>
  h('span', { class: `conf c-${c}`, title: `${CONF_LABEL[c]}: ${CONF_HELP[c]}` }, h('i', {}), withLabel ? CONF_LABEL[c] : null);
