/** Minimal line-icon set (24×24 grid, 1.5 px stroke, round caps). */
const P: Record<string, string> = {
  model: 'M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3',
  layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5',
  sim: 'M3 12h4l2-6 4 12 2-6h6',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1',
  parts: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3ZM4 7.5 12 12l8-4.5M12 12v9',
  specs: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  render: 'M3 6h14v12H3zM17 10l4-2v8l-4-2',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  solid: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z',
  xray: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3ZM4 7.5 12 12l8-4.5M12 12v9',
  ghost: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z M8 9.7l.01 0M16 9.7l.01 0M12 15l.01 0',
  iso: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3ZM4 7.5 12 12l8-4.5M12 12v9',
  front: 'M5 5h14v14H5z',
  side: 'M3 8h18v8H3z',
  top: 'M5 5h14v14H5zM12 9v6M9 12h6',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  explode: 'M9 9 4 4M15 9l5-5M9 15l-5 5M15 15l5 5M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4',
  section: 'M4 20 20 4M7 4h13v13',
  swivel: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  play: 'M7 5v14l11-7L7 5Z',
  stop: 'M6 6h12v12H6z',
  chevron: 'M9 6l6 6-6 6',
  x: 'M6 6l12 12M18 6 6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12M7 11l5 5 5-5M4 16v4h16v-4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  focus: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3',
  isolate: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  reset: 'M4 4v6h6M4.5 15a8 8 0 1 0 1.9-8.3L4 10',
  wrench: 'M15 4a5 5 0 0 0-6 6l-6 6 3 3 6-6a5 5 0 0 0 6-6l-3 3-3-3 3-3Z',
};

/** Multi-part icons: extra paths with fill / dash styling. */
const EXTRA: Record<string, { d: string; fill?: number; dash?: string }[]> = {
  solid: [{ d: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z', fill: 0.35 }, { d: 'M4 7.5 12 12l8-4.5M12 12v9' }],
  xray: [{ d: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z' }, { d: 'M4 7.5 12 12l8-4.5M12 12v9' }, { d: 'M4 16.5 12 12M20 16.5 12 12M12 3v9', dash: '1.6 1.8' }],
  ghost: [{ d: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z', dash: '1.4 2' }, { d: 'M4 7.5 12 12l8-4.5M12 12v9', dash: '1.4 2' }],
  section: [{ d: 'M4 8 12 4l8 4v8l-8 4-8-4V8Z' }, { d: 'M4 16 20 8v8l-8 4-8-4Z', fill: 0.35 }],
};

export function icon(name: keyof typeof P | string, size = 16): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ico');
  const parts = EXTRA[name] ?? [{ d: P[name] ?? P.info }];
  for (const part of parts) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', part.d);
    if (part.fill) { path.setAttribute('fill', 'currentColor'); path.setAttribute('fill-opacity', String(part.fill)); }
    if (part.dash) path.setAttribute('stroke-dasharray', part.dash);
    svg.appendChild(path);
  }
  return svg;
}
