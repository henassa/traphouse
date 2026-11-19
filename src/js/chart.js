import { fmt } from './ui.js';

const W = 340, H = 150, PAD_T = 10, PAD_B = 20, PAD_R = 44;

// Courbe SVG simple, valeurs nulles ignorées. Retourne le markup ; bindChart() ajoute le survol.
export function lineChart(dates, values, format = fmt) {
  const pts = values.map((v, i) => (v == null ? null : [i, v])).filter(Boolean);
  if (pts.length < 2) {
    return `<div class="grid h-[150px] place-items-center text-[14px] muted">Pas encore assez d’historique</div>`;
  }
  let min = Math.min(...pts.map((p) => p[1]));
  let max = Math.max(...pts.map((p) => p[1]));
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.08; max += span * 0.08;

  const n = values.length - 1 || 1;
  const x = (i) => (i / n) * (W - PAD_R);
  const y = (v) => PAD_T + (1 - (v - min) / (max - min)) * (H - PAD_T - PAD_B);
  const path = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${path}L${x(pts.at(-1)[0]).toFixed(1)},${H - PAD_B}L${x(pts[0][0]).toFixed(1)},${H - PAD_B}Z`;
  const [li, lv] = pts.at(-1);
  const grid = [0, 0.5, 1].map((k) => {
    const v = max - (max - min) * k;
    const gy = y(v);
    return `<line x1="0" x2="${W - PAD_R}" y1="${gy}" y2="${gy}" stroke="var(--shade-light)" stroke-width="0.5" stroke-dasharray="2 3"/>
      <text x="${W - PAD_R + 6}" y="${gy + 4}" font-size="11" fill="var(--muted)">${format(v)}</text>`;
  }).join('');
  const label = (d) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00Z'));

  return `<div class="relative" data-chart='${JSON.stringify({ dates, values, min, max })}'>
    <svg viewBox="0 0 ${W} ${H}" class="block w-full touch-pan-y select-none" role="img">
      ${grid}
      <path d="${area}" fill="var(--accent)" opacity="0.18"/>
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(li)}" cy="${y(lv)}" r="3.5" fill="var(--accent)" stroke="var(--primary-dark)" stroke-width="2"/>
      <text x="0" y="${H - 4}" font-size="11" fill="var(--muted)">${label(dates[0])}</text>
      <text x="${W - PAD_R}" y="${H - 4}" font-size="11" text-anchor="end" fill="var(--muted)">${label(dates.at(-1))}</text>
      <g class="scrub" style="display:none">
        <line y1="${PAD_T - 6}" y2="${H - PAD_B}" stroke="var(--muted)" stroke-width="1"/>
        <circle r="4.5" fill="var(--accent)" stroke="var(--primary-dark)" stroke-width="2"/>
      </g>
    </svg>
    <div class="scrub-label pointer-events-none absolute -top-1 sunken px-2 text-[12px] font-bold accent tabular-nums" style="display:none"></div>
  </div>`;
}

export function bindChart(root, format = fmt) {
  const box = root.querySelector('[data-chart]');
  if (!box) return;
  const { dates, values, min, max } = JSON.parse(box.dataset.chart);
  const svg = box.querySelector('svg');
  const g = box.querySelector('.scrub');
  const tip = box.querySelector('.scrub-label');
  const n = values.length - 1 || 1;

  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let i = Math.round((px / (W - PAD_R)) * n);
    i = Math.max(0, Math.min(n, i));
    while (i > 0 && values[i] == null) i--;
    if (values[i] == null) return;
    const cx = (i / n) * (W - PAD_R);
    const cy = PAD_T + (1 - (values[i] - min) / (max - min)) * (H - PAD_T - PAD_B);
    g.style.display = '';
    g.querySelector('line').setAttribute('x1', cx);
    g.querySelector('line').setAttribute('x2', cx);
    g.querySelector('circle').setAttribute('cx', cx);
    g.querySelector('circle').setAttribute('cy', cy);
    const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(dates[i] + 'T12:00:00Z'));
    tip.textContent = `${format(values[i])} · ${day}`;
    tip.style.display = '';
    const left = (cx / W) * r.width;
    tip.style.left = `${Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2))}px`;
  };
  const hide = () => { g.style.display = 'none'; tip.style.display = 'none'; };
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') hide(); });
}
