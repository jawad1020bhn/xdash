/* =============================================================================
   charts v3 — hand-rolled SVG. No dependency, no canvas, crisp at any DPR,
   and every shape animates in with the product's own motion tokens.
   ========================================================================== */

import { h } from "./dom.js";
import { reducedMotion } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/* ------------------------------------------------------------ sparkline -- */

export function sparkline(values, { w = 76, h = 26, color = "currentColor", fill = true } = {}) {
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, "aria-hidden": "true" });
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 2 - ((v - min) / span) * (h - 5)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");

  if (fill) {
    const area = svgEl("path", {
      d: `${d} L${w} ${h} L0 ${h} Z`,
      fill: color, opacity: ".16", stroke: "none",
    });
    svg.append(area);
  }
  const line = svgEl("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" });
  svg.append(line);
  const last = pts[pts.length - 1];
  if (last) svg.append(svgEl("circle", { cx: last[0], cy: last[1], r: 2.4, fill: color }));
  animateStroke(line);
  return svg;
}

function animateStroke(path) {
  if (reducedMotion()) return;
  requestAnimationFrame(() => {
    const len = path.getTotalLength?.() || 0;
    if (!len) return;
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    path.style.transition = "stroke-dashoffset 900ms cubic-bezier(.16,1,.3,1)";
    requestAnimationFrame(() => { path.style.strokeDashoffset = "0"; });
  });
}

/* ----------------------------------------------------------- area chart -- */

/**
 * Stacked 12-month save activity. Pointer anywhere on the plot snaps a guide
 * line + tooltip to the nearest month.
 */
export function areaChart(buckets, { height = 210 } = {}) {
  /* Build the viewBox at the width it will actually render, so type and
     strokes keep their true size on a phone and on a 1440px desk alike. */
  const W = Math.max(320, Math.min(760, (typeof window !== "undefined" ? window.innerWidth : 640) - 96));
  const H = height, PAD_L = 4, PAD_B = 22, PAD_T = 10;
  const innerH = H - PAD_B - PAD_T;
  const max = Math.max(...buckets.map((b) => b.total), 1);
  const step = W / Math.max(buckets.length - 1, 1);

  const wrap = h("div.chart");
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Posts saved per month over the last year" });
  svg.style.height = `${H}px`;

  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", { id: "agrad", x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(
    svgEl("stop", { offset: "0", "stop-color": "var(--brand-1)", "stop-opacity": ".42" }),
    svgEl("stop", { offset: "1", "stop-color": "var(--brand-2)", "stop-opacity": ".03" }),
  );
  defs.append(grad);
  svg.append(defs);

  const y = (v) => PAD_T + innerH - (v / max) * innerH;
  const x = (i) => i * step;

  /* gridlines + y labels */
  for (let g = 0; g <= 3; g++) {
    const v = Math.round((max / 3) * g);
    const yy = y(v);
    svg.append(svgEl("line", { x1: 0, x2: W, y1: yy, y2: yy, stroke: "var(--line)", "stroke-width": 1 }));
    if (g) {
      const t = svgEl("text", { x: 2, y: yy - 4, fill: "var(--text-3)", "font-size": 10, "font-weight": 700 });
      t.textContent = String(v);
      svg.append(t);
    }
  }

  const photoPath = buckets.map((b, i) => `${i ? "L" : "M"}${x(i)} ${y(b.photos)}`).join(" ");
  const totalPath = buckets.map((b, i) => `${i ? "L" : "M"}${x(i)} ${y(b.total)}`).join(" ");
  const areaPath = `${totalPath} L${x(buckets.length - 1)} ${y(0)} L0 ${y(0)} Z`;

  svg.append(svgEl("path", { d: areaPath, fill: "url(#agrad)", stroke: "none", class: "chart__area" }));
  const lineTotal = svgEl("path", { d: totalPath, fill: "none", stroke: "var(--brand-1)", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" });
  const linePhoto = svgEl("path", { d: photoPath, fill: "none", stroke: "var(--brand-2)", "stroke-width": 2, "stroke-dasharray": "1 5", "stroke-linecap": "round", opacity: ".9" });
  svg.append(linePhoto, lineTotal);
  animateStroke(lineTotal);

  /* month labels */
  const every = buckets.length > 9 ? 2 : 1;
  buckets.forEach((b, i) => {
    if (i % every) return;
    const t = svgEl("text", { x: x(i), y: H - 6, fill: "var(--text-3)", "font-size": 10, "font-weight": 700, "text-anchor": i === 0 ? "start" : "middle" });
    t.textContent = b.label;
    svg.append(t);
  });

  /* hover guide */
  const guide = svgEl("line", { y1: PAD_T, y2: PAD_T + innerH, stroke: "var(--line-2)", "stroke-width": 1, opacity: 0 });
  const dot = svgEl("circle", { r: 4, fill: "var(--brand-1)", stroke: "var(--bg)", "stroke-width": 2, opacity: 0 });
  svg.append(guide, dot);

  const tip = h("div.chart__tip");
  wrap.append(svg, tip);

  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const rel = ((clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(buckets.length - 1, Math.round(rel / step)));
    const b = buckets[i];
    guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i)); guide.setAttribute("opacity", 1);
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(b.total)); dot.setAttribute("opacity", 1);
    tip.innerHTML = "";
    tip.append(`${b.total} saved`, h("small", { text: `${b.label} ${b.y} · ${b.photos} photos · ${b.videos} videos` }));
    tip.classList.add("is-in");
    const px = (x(i) / W) * rect.width;
    tip.style.left = `${px}px`;
    tip.style.top = `${(y(b.total) / H) * rect.height}px`;
  };
  svg.addEventListener("pointermove", (e) => move(e.clientX));
  svg.addEventListener("pointerdown", (e) => move(e.clientX));
  svg.addEventListener("pointerleave", () => {
    guide.setAttribute("opacity", 0);
    dot.setAttribute("opacity", 0);
    tip.classList.remove("is-in");
  });

  return wrap;
}

/* ---------------------------------------------------------------- donut -- */

export function donut(parts, { size = 132, thickness = 16 } = {}) {
  const total = parts.reduce((s, p) => s + p.n, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const svg = svgEl("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": "Media mix" });
  const g = svgEl("g", { transform: `rotate(-90 ${size / 2} ${size / 2})` });
  svg.append(g);

  g.append(svgEl("circle", { cx: size / 2, cy: size / 2, r, fill: "none", stroke: "var(--surface-3)", "stroke-width": thickness }));

  let offset = 0;
  const colors = ["var(--brand-1)", "var(--brand-2)", "var(--ok)", "var(--warn)"];
  parts.forEach((p, i) => {
    const frac = p.n / total;
    const arc = svgEl("circle", {
      cx: size / 2, cy: size / 2, r, fill: "none",
      stroke: colors[i % colors.length],
      "stroke-width": thickness,
      "stroke-linecap": "butt",
      "stroke-dasharray": `${Math.max(frac * c - 2, 0.5)} ${c}`,
      "stroke-dashoffset": -offset * c,
    });
    if (!reducedMotion()) {
      arc.style.transition = `stroke-dasharray var(--t-slow) var(--ease-out) ${i * 60}ms`;
    }
    g.append(arc);
    offset += frac;
  });

  const label = svgEl("text", {
    x: size / 2, y: size / 2 - 2, "text-anchor": "middle",
    fill: "var(--text)", "font-size": size * 0.17, "font-weight": 800,
  });
  label.textContent = fmt(total);
  const sub = svgEl("text", {
    x: size / 2, y: size / 2 + size * 0.13, "text-anchor": "middle",
    fill: "var(--text-3)", "font-size": size * 0.078, "font-weight": 700,
  });
  sub.textContent = "ITEMS";
  svg.append(label, sub);
  return svg;
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

/* ------------------------------------------------------------ bar meter -- */

/** An animated horizontal meter; width is set on the next frame so it grows. */
export function meter(frac, { hue = "var(--brand)" } = {}) {
  const bar = h("span.mix__bar", h("i", { style: { background: hue } }));
  requestAnimationFrame(() => {
    bar.firstElementChild.style.width = `${Math.round(Math.max(0.02, Math.min(1, frac)) * 100)}%`;
  });
  return bar;
}
