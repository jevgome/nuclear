export interface Series {
  pts: { x: number; y: number }[];
  color: string;
  width?: number;
  dash?: number[];
  label?: string;
}
export interface Marker {
  x: number;
  y: number;
  color: string;
  label: string;
  shape?: 'dot' | 'ring' | 'hline' | 'vline';
}

export function drawChart(
  cv: HTMLCanvasElement,
  opts: { series: Series[]; markers?: Marker[]; xLabel: string; yLabel: string; xMax?: number; yMax?: number },
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) {
    cv.width = W * dpr;
    cv.height = H * dpr;
  }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--muted').trim() || '#8a93a6';
  const line = css.getPropertyValue('--line').trim() || '#2b2e33';
  const pad = { l: 34, r: 8, t: 8, b: 22 };
  const allX = opts.series.flatMap((s) => s.pts.map((p) => p.x)).concat((opts.markers || []).map((m) => m.x));
  const allY = opts.series.flatMap((s) => s.pts.map((p) => p.y)).concat((opts.markers || []).map((m) => m.y));
  const xMax = opts.xMax ?? niceMax(Math.max(1e-6, ...allX.filter(Number.isFinite)));
  const yMax = opts.yMax ?? niceMax(Math.max(1e-6, ...allY.filter(Number.isFinite)));
  const X = (x: number) => pad.l + (x / xMax) * (W - pad.l - pad.r);
  const Y = (y: number) => H - pad.b - (y / yMax) * (H - pad.t - pad.b);
  g.font = '10px "Inter Variable", Inter, system-ui, sans-serif';
  g.fillStyle = ink;
  g.strokeStyle = line;
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yv = (yMax * i) / 4, xv = (xMax * i) / 4;
    g.beginPath(); g.moveTo(pad.l, Y(yv)); g.lineTo(W - pad.r, Y(yv)); g.stroke();
    g.beginPath(); g.moveTo(X(xv), pad.t); g.lineTo(X(xv), H - pad.b); g.stroke();
    g.textAlign = 'right'; g.fillText(fmt(yv), pad.l - 4, Y(yv) + 3);
    g.textAlign = 'center'; g.fillText(fmt(xv), X(xv), H - pad.b + 12);
  }
  g.textAlign = 'right';
  g.fillText(opts.xLabel, W - pad.r, H - 3);
  g.save(); g.translate(10, pad.t); g.rotate(-Math.PI / 2); g.textAlign = 'right'; g.fillText(opts.yLabel, 0, 0); g.restore();
  g.save();
  g.beginPath(); g.rect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); g.clip();
  for (const s of opts.series) {
    g.strokeStyle = s.color; g.lineWidth = s.width ?? 2; g.setLineDash(s.dash ?? []);
    g.beginPath();
    s.pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
    g.stroke();
  }
  g.setLineDash([]);
  for (const m of opts.markers || []) {
    g.strokeStyle = m.color; g.fillStyle = m.color;
    if (m.shape === 'hline') {
      g.setLineDash([3, 3]); g.beginPath(); g.moveTo(pad.l, Y(m.y)); g.lineTo(W - pad.r, Y(m.y)); g.stroke(); g.setLineDash([]);
      g.textAlign = 'right'; g.fillText(m.label, W - pad.r - 2, Y(m.y) - 3);
    } else if (m.shape === 'vline') {
      g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(m.x), pad.t); g.lineTo(X(m.x), H - pad.b); g.stroke(); g.setLineDash([]);
      g.textAlign = 'left'; g.fillText(m.label, X(m.x) + 3, pad.t + 9);
    } else {
      g.beginPath(); g.arc(X(m.x), Y(m.y), m.shape === 'ring' ? 5 : 4, 0, Math.PI * 2);
      if (m.shape === 'ring') { g.lineWidth = 2; g.stroke(); } else g.fill();
      g.textAlign = 'left'; g.fillText(m.label, X(m.x) + 7, Y(m.y) - 5);
    }
  }
  g.restore();
}

function niceMax(v: number) {
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * e >= v * 1.05) return k * e;
  return 10 * e;
}
function fmt(v: number) {
  if (v === 0) return '0';
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}
