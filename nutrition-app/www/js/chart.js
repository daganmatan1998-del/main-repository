// Minimal dependency-free SVG line chart for weight / body-fat history.

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// points: [{ x: dayNumber, y: value, label }], target: number|null
export function lineChart(points, { target = null, unit = '', height = 180, digits = 1 } = {}) {
  const W = 340;
  const H = height;
  const pad = { l: 36, r: 12, t: 14, b: 24 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', dir: 'ltr' });

  if (points.length === 0) return svg;
  const ys = points.map((p) => p.y).concat(target !== null ? [target] : []);
  let ymin = Math.min(...ys);
  let ymax = Math.max(...ys);
  if (ymax - ymin < 2) { ymin -= 1; ymax += 1; }
  const span = ymax - ymin;
  ymin -= span * 0.12;
  ymax += span * 0.12;
  const xs = points.map((p) => p.x);
  let xmin = Math.min(...xs);
  let xmax = Math.max(...xs);
  if (xmax === xmin) { xmin -= 1; xmax += 1; }

  const X = (x) => pad.l + ((x - xmin) / (xmax - xmin)) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - ymin) / (ymax - ymin)) * (H - pad.t - pad.b);

  for (let i = 0; i <= 3; i++) {
    const v = ymin + ((ymax - ymin) * i) / 3;
    const y = Y(v);
    svg.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: 'grid' }));
    const t = el('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end', class: 'axis' });
    t.textContent = v.toFixed(digits === 0 ? 0 : 1);
    svg.appendChild(t);
  }

  if (target !== null) {
    const y = Y(target);
    svg.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: 'target' }));
    // RTL label anchored at its right edge, so Hebrew text never runs off the chart.
    const t = el('text', { x: W - pad.r, y: y - 5, 'text-anchor': 'start', direction: 'rtl', class: 'axis target-label' });
    t.textContent = `יעד ${target}${unit}`;
    svg.appendChild(t);
  }

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  if (points.length > 1) {
    const area = `${d} L${X(points[points.length - 1].x).toFixed(1)},${H - pad.b} L${X(points[0].x).toFixed(1)},${H - pad.b} Z`;
    svg.appendChild(el('path', { d: area, class: 'area' }));
  }
  svg.appendChild(el('path', { d, class: 'line' }));
  for (const p of points) {
    svg.appendChild(el('circle', { cx: X(p.x), cy: Y(p.y), r: 3.5, class: 'dot' }));
  }
  const first = points[0];
  const last = points[points.length - 1];
  for (const [p, anchor] of [[first, 'start'], [last, 'end']]) {
    if (p === first && points.length === 1 && anchor === 'end') continue;
    const t = el('text', { x: X(p.x), y: H - 6, 'text-anchor': points.length === 1 ? 'middle' : anchor, class: 'axis' });
    t.textContent = p.label;
    svg.appendChild(t);
    if (points.length === 1) break;
  }
  return svg;
}
