/* VEKTOR — PNG → SVG vectorization engine for GT7 decals. Zero dependencies. */
'use strict';
var Vektor = (function () {

/* ───────────── Color (OKLab) ───────────── */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function toLab(r, g, b, o, k) {
  const lr = LIN[r], lg = LIN[g], lb = LIN[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, t = K3 * L - K1;
  o[k] = (t + Math.sqrt(t * t + 4 * K2 * K3 * L)) / 2; // Ottosson's “toe”: close blacks stay close
  o[k + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  o[k + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
}
const K1 = 0.206, K2 = 0.03, K3 = (1 + K1) / (1 + K2);
function lin2s(x) { x = x <= 0 ? 0 : x >= 1 ? 1 : x; return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); }
function fromLab(Lr, a, b) {
  const L = Lr * (Lr + K1) / (K3 * (Lr + K2));
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [lin2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), lin2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), lin2s(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
function hexOf(rgb) { return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join(''); }
function rgbOfHex(h) { h = h.replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function rgbOfHexArr(a) { return a; }
function shortHex(h) { return (h[1] === h[2] && h[3] === h[4] && h[5] === h[6]) ? '#' + h[1] + h[3] + h[5] : h; }
function labOfHex(h) { const c = rgbOfHex(h), o = [0, 0, 0]; toLab(c[0], c[1], c[2], o, 0); return o; }
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ───────────── Quantification ───────────── */
function kmeans(P, Wt, n, K, iters, rand) {
  K = Math.min(K, n); if (K < 1) return [];
  const C = new Float64Array(K * 3), D = new Float64Array(n).fill(Infinity);
  let tot = 0; for (let i = 0; i < n; i++) tot += Wt[i];
  let r = rand() * tot, idx = 0; for (; idx < n - 1; idx++) { r -= Wt[idx]; if (r <= 0) break; }
  C[0] = P[idx * 3]; C[1] = P[idx * 3 + 1]; C[2] = P[idx * 3 + 2];
  let k = 1;
  for (; k < K; k++) {
    const cx = C[(k - 1) * 3], cy = C[(k - 1) * 3 + 1], cz = C[(k - 1) * 3 + 2]; let s = 0;
    for (let i = 0; i < n; i++) { const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz, d = dx * dx + dy * dy + dz * dz; if (d < D[i]) D[i] = d; s += D[i] * Wt[i]; }
    if (s < 1e-12) break;
    let rr = rand() * s, j = 0; for (; j < n - 1; j++) { rr -= D[j] * Wt[j]; if (rr <= 0) break; }
    C[k * 3] = P[j * 3]; C[k * 3 + 1] = P[j * 3 + 1]; C[k * 3 + 2] = P[j * 3 + 2];
  }
  K = k; const S = new Float64Array(K * 4);
  for (let it = 0; it < iters; it++) {
    S.fill(0);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; let best = 0, bd = Infinity;
      for (let c = 0; c < K; c++) { const dx = x - C[c * 3], dy = y - C[c * 3 + 1], dz = z - C[c * 3 + 2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = c; } }
      const w = Wt[i]; S[best * 4] += x * w; S[best * 4 + 1] += y * w; S[best * 4 + 2] += z * w; S[best * 4 + 3] += w;
    }
    for (let c = 0; c < K; c++) { const w = S[c * 4 + 3]; if (w > 0) { C[c * 3] = S[c * 4] / w; C[c * 3 + 1] = S[c * 4 + 1] / w; C[c * 3 + 2] = S[c * 4 + 2] / w; } }
  }
  const out = []; for (let c = 0; c < K; c++) if (S[c * 4 + 3] > 0) out.push({ c: [C[c * 3], C[c * 3 + 1], C[c * 3 + 2]], w: S[c * 4 + 3] });
  return out;
}
/* agglomerative merge: distance < tol, then Ward down to maxK, then absorption of micro-shades */
function mergeClusters(cl, tol, maxK, minFrac) {
  cl = cl.map(o => ({ c: o.c.slice(), w: o.w, m: o.m || null }));
  const tw = cl.reduce((s, o) => s + o.w, 0);
  const join = (a, b) => { const A = cl[a], B = cl[b], w = A.w + B.w; for (let q = 0; q < 3; q++) A.c[q] = (A.c[q] * A.w + B.c[q] * B.w) / w; A.w = w; cl.splice(b, 1); };
  for (;;) {
    const n = cl.length; if (n <= 1) break;
    let bi = -1, bj = -1, bd = Infinity, wi = -1, wj = -1, wd = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = d3(cl[i].c, cl[j].c); if (d < bd) { bd = d; bi = i; bj = j; }
      const wc = cl[i].w * cl[j].w / (cl[i].w + cl[j].w) * d * d; if (wc < wd) { wd = wc; wi = i; wj = j; }
    }
    if (bd < tol) { join(bi, bj); continue; }
    if (n > maxK) { join(wi, wj); continue; }
    let t = -1; for (let i = 0; i < n; i++) if (cl[i].w < minFrac * tw) { t = i; break; }
    if (t < 0) break;
    let nb = -1, nd = Infinity; for (let j = 0; j < n; j++) if (j !== t) { const d = d3(cl[t].c, cl[j].c); if (d < nd) { nd = d; nb = j; } }
    if (nb < t) join(nb, t); else { join(t, nb); }
  }
  return cl;
}

/* bilateral smoothing (edge-preserving) */
function smoothLab(lab, op, W, H, r) {
  const out = new Float32Array(lab.length), s2 = 1 / (0.05 * 0.05);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!op[i]) continue;
    const L0 = lab[i * 3], A0 = lab[i * 3 + 1], B0 = lab[i * 3 + 2]; let sl = 0, sa = 0, sb = 0, sw = 0;
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const j = yy * W + xx; if (!op[j]) continue;
        const a = lab[j * 3] - L0, b = lab[j * 3 + 1] - A0, c = lab[j * 3 + 2] - B0, w = 1 / (1 + (a * a + b * b + c * c) * s2); const w2 = w * w;
        sl += lab[j * 3] * w2; sa += lab[j * 3 + 1] * w2; sb += lab[j * 3 + 2] * w2; sw += w2; } }
    out[i * 3] = sl / sw; out[i * 3 + 1] = sa / sw; out[i * 3 + 2] = sb / sw;
  }
  return out;
}

/* ───────────── Segmentation ─────────────
   P = { alphaThr, denoise, tol, maxColors, minDetail, antiHalo, gradFlat, up } */
function segment(rgba, W, H, P, progress) {
  progress = progress || (() => {});
  const N = W * H, op = new Uint8Array(N), lab = new Float32Array(N * 3);
  let nOp = 0;
  for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] >= P.alphaThr) { op[i] = 1; nOp++; toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], lab, i * 3); }
  if (!nOp) return { W, H, labels: new Int16Array(N).fill(-1), palette: [], rgba };
  progress('Analyzing colors', 0.05);
  const L = P.denoise > 0 ? smoothLab(lab, op, W, H, P.denoise) : lab;
  const grad = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!op[i]) continue;
    if (x + 1 < W && op[i + 1]) { const d = Math.hypot(L[i * 3] - L[i * 3 + 3], L[i * 3 + 1] - L[i * 3 + 4], L[i * 3 + 2] - L[i * 3 + 5]); if (d > grad[i]) grad[i] = d; if (d > grad[i + 1]) grad[i + 1] = d; }
    if (y + 1 < H && op[i + W]) { const j = i + W, d = Math.hypot(L[i * 3] - L[j * 3], L[i * 3 + 1] - L[j * 3 + 1], L[i * 3 + 2] - L[j * 3 + 2]); if (d > grad[i]) grad[i] = d; if (d > grad[j]) grad[j] = d; }
  }
  const pw = new Float32Array(N); for (let i = 0; i < N; i++) pw[i] = 1 / (1 + 40 * grad[i]);
  // sampling
  const step = Math.max(1, Math.floor(nOp / 70000)); let ns = 0;
  const SP = new Float32Array(Math.ceil(nOp / step) * 3 + 3), SW = new Float32Array(Math.ceil(nOp / step) + 1);
  for (let i = 0, c = 0; i < N; i++) if (op[i]) { if (c++ % step === 0) { SP[ns * 3] = L[i * 3]; SP[ns * 3 + 1] = L[i * 3 + 1]; SP[ns * 3 + 2] = L[i * 3 + 2]; SW[ns] = pw[i]; ns++; } }
  const rand = rng(1337);
  let cl = kmeans(SP, SW, ns, 48, 9, rand);
  const tolFine = Math.max(0.012, P.tol * 0.45);
  cl = mergeClusters(cl, tolFine, 64, 0.00015);
  const K0 = cl.length, CC = new Float64Array(K0 * 3);
  cl.forEach((o, k) => { CC[k * 3] = o.c[0]; CC[k * 3 + 1] = o.c[1]; CC[k * 3 + 2] = o.c[2]; });
  progress('Assigning pixels', 0.2);
  let lb = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (op[i]) {
    const x = L[i * 3], y = L[i * 3 + 1], z = L[i * 3 + 2]; let best = 0, bd = Infinity;
    for (let c = 0; c < K0; c++) { const dx = x - CC[c * 3], dy = y - CC[c * 3 + 1], dz = z - CC[c * 3 + 2], d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = c; } }
    lb[i] = best;
  }
  lb = modeFilter(lb, W, H);
  progress('Regions', 0.35);
  // ── 4-connected regions
  const reg = new Int32Array(N).fill(-1), stack = new Int32Array(N); let R = 0;
  for (let i = 0; i < N; i++) {
    if (lb[i] < 0 || reg[i] >= 0) continue;
    const l = lb[i]; let sp = 0; stack[sp++] = i; reg[i] = R;
    while (sp) { const j = stack[--sp], x = j % W;
      if (x > 0 && reg[j - 1] < 0 && lb[j - 1] === l) { reg[j - 1] = R; stack[sp++] = j - 1; }
      if (x < W - 1 && reg[j + 1] < 0 && lb[j + 1] === l) { reg[j + 1] = R; stack[sp++] = j + 1; }
      if (j >= W && reg[j - W] < 0 && lb[j - W] === l) { reg[j - W] = R; stack[sp++] = j - W; }
      if (j < N - W && reg[j + W] < 0 && lb[j + W] === l) { reg[j + W] = R; stack[sp++] = j + W; } }
    R++;
  }
  const area = new Float64Array(R), sl = new Float64Array(R), sa = new Float64Array(R), sb = new Float64Array(R), sw = new Float64Array(R), per = new Float64Array(R), tE = new Float64Array(R);
  for (let i = 0; i < N; i++) { const r = reg[i]; if (r < 0) continue; area[r]++; const w = pw[i]; sl[r] += lab[i * 3] * w; sa[r] += lab[i * 3 + 1] * w; sb[r] += lab[i * 3 + 2] * w; sw[r] += w; }
  const nb = new Array(R);
  const ds = Math.max(2, Math.ceil(1.5 * (P.up || 1)));
  const pixD = (a, b) => Math.hypot(L[a * 3] - L[b * 3], L[a * 3 + 1] - L[b * 3 + 1], L[a * 3 + 2] - L[b * 3 + 2]);
  const link = (a, b, dp) => {
    let m = nb[a]; if (!m) m = nb[a] = new Map(); let e = m.get(b);
    if (!e) { e = { len: 0, sp: 0 }; m.set(b, e); let mb = nb[b]; if (!mb) mb = nb[b] = new Map(); mb.set(a, e); }
    e.len++; e.sp += dp;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, r = reg[i]; if (r < 0) continue;
    if (x === 0 || reg[i - 1] < 0) { per[r]++; tE[r]++; }
    if (y === 0 || reg[i - W] < 0) { per[r]++; tE[r]++; }
    if (x === W - 1) { per[r]++; tE[r]++; } else { const s = reg[i + 1]; if (s < 0) { per[r]++; tE[r]++; } else if (s !== r) { per[r]++; per[s]++;
      let a = Math.max(0, x - ds + 1), b = Math.min(W - 1, x + ds); let ia = y * W + a, ib = y * W + b; if (!op[ia]) ia = i; if (!op[ib]) ib = i + 1; link(r, s, pixD(ia, ib)); } }
    if (y === H - 1) { per[r]++; tE[r]++; } else { const s = reg[i + W]; if (s < 0) { per[r]++; tE[r]++; } else if (s !== r) { per[r]++; per[s]++;
      let a = Math.max(0, y - ds + 1), b = Math.min(H - 1, y + ds); let ia = a * W + x, ib = b * W + x; if (!op[ia]) ia = i; if (!op[ib]) ib = i + W; link(r, s, pixD(ia, ib)); } }
  }
  const parent = new Int32Array(R); for (let r = 0; r < R; r++) parent[r] = r;
  const alive = new Uint8Array(R).fill(1), removed = new Uint8Array(R);
  const find = r => { while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; } return r; };
  const col = r => [sl[r] / sw[r], sa[r] / sw[r], sb[r] / sw[r]];
  const merge = (a, b) => { // a absorbed by b
    area[b] += area[a]; sl[b] += sl[a]; sa[b] += sa[a]; sb[b] += sb[a]; sw[b] += sw[a]; tE[b] += tE[a];
    const ma = nb[a] || new Map(); let mb = nb[b]; if (!mb) mb = nb[b] = new Map();
    const eab = ma.get(b); per[b] += per[a] - (eab ? 2 * eab.len : 0);
    for (const [n, e] of ma) {
      if (n === b) { mb.delete(a); continue; }
      const mn = nb[n]; mn.delete(a);
      const eb = mb.get(n);
      if (eb) { eb.len += e.len; eb.sp += e.sp; } else { mb.set(n, e); mn.set(b, e); }
    }
    nb[a] = null; parent[a] = b; alive[a] = 0;
  };
  const byArea = () => { const ids = []; for (let r = 0; r < R; r++) if (alive[r]) ids.push(r); ids.sort((p, q) => area[p] - area[q]); return ids; };
  progress('Cleaning up', 0.5);
  // ── anti-aliasing fringes: transition pixels split between the two neighboring colors (pro rata of coverage)
  if (P.antiHalo) {
    const tH = Math.max(1.6, 1.8 * (P.up || 1));
    const off = new Int32Array(R + 1); for (let i = 0; i < N; i++) if (reg[i] >= 0) off[reg[i] + 1]++;
    for (let r = 0; r < R; r++) off[r + 1] += off[r];
    const fill = off.slice(0, R), pix = new Int32Array(off[R]); for (let i = 0; i < N; i++) if (reg[i] >= 0) pix[fill[reg[i]]++] = i;
    const rgbOf = r => fromLab(...col(r));
    for (const r of byArea()) {
      if (!alive[r]) continue; const m = nb[r]; if (!m || !m.size) continue;
      if (2 * area[r] / per[r] >= tH) continue;
      if (m.size === 1) { if (tE[r] > 0.25 * per[r]) merge(r, m.keys().next().value); continue; }
      const C = rgbOf(r);
      const ns = [...m.entries()].sort((p, q) => q[1].len - p[1].len).slice(0, 5).map(e => e[0]);
      let bA = -1, bB = -1, bd = Infinity, bt = 0;
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
        const A = rgbOf(ns[i]), B = rgbOf(ns[j]); const v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; if (vv < 400) continue;
        const t = ((C[0] - A[0]) * v[0] + (C[1] - A[1]) * v[1] + (C[2] - A[2]) * v[2]) / vv; if (t < 0.03 || t > 0.97) continue;
        const dd = Math.hypot(C[0] - A[0] - t * v[0], C[1] - A[1] - t * v[1], C[2] - A[2] - t * v[2]) / Math.sqrt(vv);
        if (dd < 0.3 && dd < bd) { bd = dd; bA = ns[i]; bB = ns[j]; bt = t; }
      }
      if (bA < 0) continue;
      const near = bt < 0.5 ? bA : bB, far = near === bA ? bB : bA;
      const cn = rgbOfHexArr(rgbOf(near)), cf = rgbOfHexArr(rgbOf(far));
      const vx = cf[0] - cn[0], vy = cf[1] - cn[1], vz = cf[2] - cn[2], vv = vx * vx + vy * vy + vz * vz || 1;
      merge(r, near);
      for (let q = off[r]; q < off[r + 1]; q++) { const i = pix[q];
        const t = ((rgba[i * 4] - cn[0]) * vx + (rgba[i * 4 + 1] - cn[1]) * vy + (rgba[i * 4 + 2] - cn[2]) * vz) / vv;
        if (t > 0.5) { const fr = find(far), nr = find(near); reg[i] = far; const w = pw[i];
          area[nr]--; area[fr]++; sl[nr] -= lab[i * 3] * w; sa[nr] -= lab[i * 3 + 1] * w; sb[nr] -= lab[i * 3 + 2] * w; sw[nr] -= w;
          sl[fr] += lab[i * 3] * w; sa[fr] += lab[i * 3 + 1] * w; sb[fr] += lab[i * 3 + 2] * w; sw[fr] += w; } }
    }
  }
  // ── specks
  const s = Math.max(W, H) / 1000, minA = Math.max(1, Math.round(Math.max(Math.pow(P.minDetail * s, 2), 0.7 * (P.up || 1) * (P.up || 1))));
  for (let pass = 0; pass < 2; pass++) for (const r of byArea()) {
    if (!alive[r] || area[r] >= minA) continue; const m = nb[r];
    if (!m || !m.size) { if (tE[r] > 0) { alive[r] = 0; removed[r] = 1; } continue; }
    const C = col(r); let best = -1, bd = Infinity, bl = 0;
    for (const [n, e] of m) { const d = d3(C, col(n)) - 0.0005 * e.len; if (d < bd) { bd = d; best = n; bl = e.len; } }
    merge(r, best);
  }
  // ── gradient flattening (merging soft boundaries)
  if (P.gradFlat > 0) {
    progress('Flattening gradients', 0.6);
    const thr = 0.32 * Math.pow(P.gradFlat / 100, 1.4);
    const heap = new Heap(), ver = new Int32Array(R);
    const push = (a, b) => { const e = nb[a] && nb[a].get(b); if (!e) return; const d = d3(col(a), col(b)); if (d < thr && (e.sp / e.len) < 0.62 * d + 0.004) heap.push(d, a, b, ver[a], ver[b]); };
    for (let a = 0; a < R; a++) if (alive[a] && nb[a]) for (const b of nb[a].keys()) if (b > a) push(a, b);
    while (heap.size) {
      const t = heap.pop(); const a = t[1], b = t[2];
      if (!alive[a] || !alive[b] || ver[a] !== t[3] || ver[b] !== t[4]) continue;
      const big = area[a] >= area[b] ? a : b, sm = big === a ? b : a;
      merge(sm, big); ver[big]++;
      for (const n of nb[big].keys()) push(big, n);
    }
  }
  progress('Final palette', 0.75);
  // ── final palette over the regions
  const ids = []; for (let r = 0; r < R; r++) if (alive[r]) ids.push(r);
  const RP = new Float32Array(ids.length * 3), RW = new Float32Array(ids.length);
  ids.forEach((r, k) => { const c = col(r); RP[k * 3] = c[0]; RP[k * 3 + 1] = c[1]; RP[k * 3 + 2] = c[2]; RW[k] = area[r]; });
  let fc = kmeans(RP, RW, ids.length, 56, 10, rng(7));
  fc = mergeClusters(fc, P.tol, P.maxColors > 0 ? P.maxColors : 64, P.maxColors > 0 ? 0 : 0.00002);
  { // transition micro-shades (residual fringes) → absorbed
    const tw = fc.reduce((a, o) => a + o.w, 0), rgbC = o => fromLab(o.c[0], o.c[1], o.c[2]);
    for (let i = fc.length - 1; i >= 0; i--) { const o = fc[i]; if (o.w > 0.0015 * tw || fc.length <= 2) continue;
      let near = Infinity; for (const q of fc) if (q !== o) near = Math.min(near, d3(o.c, q.c));
      let halo = false; const C = rgbC(o), big = fc.filter(q => q !== o && q.w > o.w * 3);
      for (let a = 0; a < big.length && !halo; a++) for (let b = a + 1; b < big.length && !halo; b++) { const A = rgbC(big[a]), B = rgbC(big[b]), v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; if (vv < 400) continue;
        const t = ((C[0] - A[0]) * v[0] + (C[1] - A[1]) * v[1] + (C[2] - A[2]) * v[2]) / vv; if (t < 0.05 || t > 0.95) continue;
        if (Math.hypot(C[0] - A[0] - t * v[0], C[1] - A[1] - t * v[1], C[2] - A[2] - t * v[2]) / Math.sqrt(vv) < 0.3) halo = true; }
      if (halo || near < 2.2 * P.tol) fc.splice(i, 1); }
  }
  const K = fc.length, rc = new Int16Array(R).fill(-1), acc = new Float64Array(K * 4);
  ids.forEach((r, k) => { const c = [RP[k * 3], RP[k * 3 + 1], RP[k * 3 + 2]]; let best = 0, bd = Infinity; for (let q = 0; q < K; q++) { const d = d3(c, fc[q].c); if (d < bd) { bd = d; best = q; } } rc[r] = best; acc[best * 4] += c[0] * RW[k]; acc[best * 4 + 1] += c[1] * RW[k]; acc[best * 4 + 2] += c[2] * RW[k]; acc[best * 4 + 3] += RW[k]; });
  const labels = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) { const r0 = reg[i]; if (r0 < 0) continue; const r = find(r0); if (removed[r] || !alive[r]) continue; labels[i] = rc[r]; }
  // sort by area
  const cnt = new Float64Array(K), border = new Float64Array(K);
  for (let i = 0; i < N; i++) { const l = labels[i]; if (l >= 0) cnt[l]++; }
  for (let x = 0; x < W; x++) { let l = labels[x]; if (l >= 0) border[l]++; l = labels[(H - 1) * W + x]; if (l >= 0) border[l]++; }
  for (let y = 0; y < H; y++) { let l = labels[y * W]; if (l >= 0) border[l]++; l = labels[y * W + W - 1]; if (l >= 0) border[l]++; }
  const ord = [...Array(K).keys()].filter(k => cnt[k] > 0).sort((p, q) => cnt[q] - cnt[p]), remap = new Int16Array(K).fill(-1);
  ord.forEach((k, i) => remap[k] = i);
  for (let i = 0; i < N; i++) if (labels[i] >= 0) labels[i] = remap[labels[i]];
  const per2 = 2 * (W + H), total = cnt.reduce((a, b) => a + b, 0);
  const palette = ord.map(k => { const w = acc[k * 4 + 3], c = [acc[k * 4] / w, acc[k * 4 + 1] / w, acc[k * 4 + 2] / w], rgb = fromLab(c[0], c[1], c[2]); return { hex: hexOf(rgb), lab: c, area: cnt[k] / total, border: border[k] / per2 }; });
  progress('Segmentation done', 1);
  return { W, H, labels, palette, rgba, regions: ids.length, up: P.up || 1 };
}
function modeFilter(lb, W, H) {
  const out = lb.slice(), nl = new Int16Array(8), nc = new Int8Array(8);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, l = lb[i]; if (l < 0) continue;
    let same = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const v = lb[i + dy * W + dx]; if (v === l) same++; else if (v >= 0) { let f = -1; for (let q = 0; q < k; q++) if (nl[q] === v) { f = q; break; } if (f < 0) { nl[k] = v; nc[k++] = 1; } else nc[f]++; } }
    if (same >= 2 || !k) continue;
    let b = 0; for (let q = 1; q < k; q++) if (nc[q] > nc[b]) b = q; out[i] = nl[b];
  }
  return out;
}
class Heap { constructor() { this.a = []; } get size() { return this.a.length; }
  push(k, ...v) { const a = this.a; a.push([k, ...v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, t = a[0], l = a.pop(); if (a.length) { a[0] = l; let i = 0; for (;;) { const L = 2 * i + 1, R = L + 1; let m = i; if (L < a.length && a[L][0] < a[m][0]) m = L; if (R < a.length && a[R][0] < a[m][0]) m = R; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return t; } }

/* ───────────── Applying palette edits ─────────────
   ops[i] = { del:bool, to:int (fusion), hex:string (recolor),
              bg:bool (only removes the areas of this color touching the border: the background),
              regions:[{ seed:int, del:bool, hex:string }] (edit of a single shape: the 4-connected area
              of this color containing the seed pixel) }
   ops[K] (optional, K = number of colors) = { holes:[{ seed:int, hex:string }] }: filled transparent holes */
function applyOps(seg, ops) {
  const K = seg.palette.length, tgt = new Int16Array(K);
  for (let i = 0; i < K; i++) { let j = i, guard = 0; while (ops[j] && ops[j].to >= 0 && ops[j].to !== j && guard++ < K) j = ops[j].to; tgt[i] = (ops[j] && ops[j].del) ? -1 : j; }
  const hexes = [], idx = new Int16Array(K).fill(-1), byHex = new Map();
  for (let i = 0; i < K; i++) { const j = tgt[i]; if (j < 0) continue; const h = (ops[j] && ops[j].hex) || seg.palette[j].hex; if (!byHex.has(h)) { byHex.set(h, hexes.length); hexes.push(h); } idx[i] = byHex.get(h); }
  const W = seg.W, H = seg.H, N = W * H, L = seg.labels, labels = new Int16Array(N), locked = new Uint8Array(N);   // locked: pixels set by hand (areas, holes, brush)
  for (let p = 0; p < N; p++) { const l = L[p]; labels[p] = l < 0 ? -1 : idx[l]; }
  // per-area edits: 4-connected fill in the original color, from one or more seeds
  const stack = [], seen = new Uint8Array(N);
  const fill = (i, seeds, v, box) => {   // box [x0, y0, x1, y1]: edit limited to a frame (part of a large area)
    seen.fill(0); stack.length = 0;
    const ok = box ? q => { const x = q % W, y = (q / W) | 0; return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]; } : () => true;
    for (const s of seeds) if (s >= 0 && s < N && L[s] === i && !seen[s] && ok(s)) { seen[s] = 1; stack.push(s); }
    while (stack.length) {
      const q = stack.pop(), x = q % W; labels[q] = v;
      if (x > 0 && !seen[q - 1] && L[q - 1] === i && ok(q - 1)) { seen[q - 1] = 1; stack.push(q - 1); }
      if (x < W - 1 && !seen[q + 1] && L[q + 1] === i && ok(q + 1)) { seen[q + 1] = 1; stack.push(q + 1); }
      if (q >= W && !seen[q - W] && L[q - W] === i && ok(q - W)) { seen[q - W] = 1; stack.push(q - W); }
      if (q < N - W && !seen[q + W] && L[q + W] === i && ok(q + W)) { seen[q + W] = 1; stack.push(q + W); }
    }
  };
  const hexIdx = h => { if (!byHex.has(h)) { byHex.set(h, hexes.length); hexes.push(h); } return byHex.get(h); };
  for (let i = 0; i < K; i++) {
    const o = ops[i]; if (!o) continue;
    if (o.bg) {
      const seeds = [];
      for (let x = 0; x < W; x++) seeds.push(x, (H - 1) * W + x);
      for (let y = 0; y < H; y++) seeds.push(y * W, y * W + W - 1);
      fill(i, seeds, -1);
    }
    if (o.regions) for (const r of o.regions) { const v = r.del ? -1 : hexIdx(String(r.hex || seg.palette[i].hex).toLowerCase());
      if (r.pix) { for (const q of r.pix) if (q >= 0 && q < N && L[q] === i) { labels[q] = v; locked[q] = 1; } }   // spike or smudge: exact pixels
      else { fill(i, [r.seed], v, r.box); for (let q = 0; q < N; q++) if (seen[q]) locked[q] = 1; } }
  }
  // ops[K].holes: transparent areas of the image (holes) filled with a color
  const hz = ops[K] && ops[K].holes;
  if (hz) for (const r of hz) if (r.hex) { const v = hexIdx(String(r.hex).toLowerCase()); if (r.pix) { for (const q of r.pix) if (q >= 0 && q < N && L[q] < 0) { labels[q] = v; locked[q] = 1; } } else { fill(-1, [r.seed], v, r.box); for (let q = 0; q < N; q++) if (seen[q]) locked[q] = 1; } }
  // ops[K].paint: brush / eraser strokes on the vector, as runs [start, length, …] (in drawing order)
  const pz = ops[K] && ops[K].paint;
  if (pz) for (const t of pz) { const v = t.hex ? hexIdx(String(t.hex).toLowerCase()) : -1, r = t.r || [];
    for (let i = 0; i + 1 < r.length; i += 2) for (let q = Math.max(0, r[i]), e = Math.min(N, r[i] + r[i + 1]); q < e; q++) { labels[q] = v; locked[q] = 1; } }
  // colors no longer used: removed so no empty layer is produced
  const used = new Uint8Array(hexes.length); for (let p = 0; p < N; p++) if (labels[p] >= 0) used[labels[p]] = 1;
  const remap = new Int16Array(hexes.length).fill(-1), kept = [];
  hexes.forEach((h, k) => { if (used[k]) { remap[k] = kept.length; kept.push(h); } });
  if (kept.length !== hexes.length) for (let p = 0; p < N; p++) if (labels[p] >= 0) labels[p] = remap[labels[p]];
  return { W, H, labels, locked, colors: kept.map(h => ({ hex: h, lab: labOfHex(h) })) };
}

/* ───────────── Contour tracing (pixel fronts) ───────────── */
const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
function traceMask(m, w, h, comp) {
  const Hv = new Uint8Array((h + 1) * w), out = [];
  const px = (x, y) => (x >= 0 && y >= 0 && x < w && y < h) ? m[y * w + x] : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x] || (y > 0 && m[(y - 1) * w + x]) || Hv[y * w + x]) continue;
    let vx = x + 1, vy = y, d = 2; const sx = vx, sy = vy; const pts = [];
    for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
      if (d === 0) Hv[vy * w + vx] = 1; else if (d === 2) Hv[vy * w + vx - 1] = 1;
      pts.push(vx, vy); vx += DX[d]; vy += DY[d];
      let L, R;
      if (d === 0) { L = px(vx, vy - 1); R = px(vx, vy); } else if (d === 1) { L = px(vx, vy); R = px(vx - 1, vy); }
      else if (d === 2) { L = px(vx - 1, vy); R = px(vx - 1, vy - 1); } else { L = px(vx - 1, vy - 1); R = px(vx, vy - 1); }
      if (L && !R) { } else if (!L && !R) d = (d + 3) & 3; else d = (d + 1) & 3;
      if (vx === sx && vy === sy && d === 2) break;
    }
    out.push({ pts: Int32Array.from(pts), comp: comp[y * w + x] });
  }
  return out;
}
function signedArea(p) { let a = 0; const n = p.length; for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; }

/* corners + smoothing → contour ready for fitting */
function prepContour(X, Y, area, cosThr, k, passes) {
  const n = X.length;
  let corners = [];
  if (n <= 2 * k + 2) { for (let i = 0; i < n; i++) corners.push(i); }
  else {
    // light pre-smoothing to estimate angles without staircase noise
    const sx = new Float64Array(n), sy = new Float64Array(n);
    for (let i = 0; i < n; i++) { const a = (i + n - 1) % n, b = (i + 1) % n, a2 = (i + n - 2) % n, b2 = (i + 2) % n; sx[i] = (X[a2] + 4 * X[a] + 6 * X[i] + 4 * X[b] + X[b2]) / 16; sy[i] = (Y[a2] + 4 * Y[a] + 6 * Y[i] + 4 * Y[b] + Y[b2]) / 16; }
    const cosAt = (i, q) => { const a = (i - q + n * 4) % n, b = (i + q) % n; const ax = sx[i] - sx[a], ay = sy[i] - sy[a], bx = sx[b] - sx[i], by = sy[b] - sy[i]; return (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) + 1e-9); };
    const c = new Float64Array(n), k2 = Math.min(2 * k + 1, (n / 4) | 0);
    for (let i = 0; i < n; i++) c[i] = cosAt(i, k);
    for (let i = 0; i < n; i++) { if (c[i] >= cosThr) continue; let ok = true; for (let j = -k; j <= k && ok; j++) { if (!j) continue; const q = c[(i + j + n) % n]; if (q < c[i] || (q === c[i] && j < 0)) ok = false; }
      if (ok && k2 > k && cosAt(i, k2) > 0.97) ok = false; // angle that fully disappears at a larger scale = noise
      if (ok) corners.push(i); }
  }
  // rotation: first corner at 0, end point = start point
  const r0 = corners.length ? corners[0] : 0;
  const XX = new Float64Array(n + 1), YY = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) { XX[i] = X[(i + r0) % n]; YY[i] = Y[(i + r0) % n]; }
  const cs = corners.map(i => (i - r0 + n) % n); cs.push(n);
  // binomial smoothing per segment, fixed corners
  const tx = new Float64Array(n + 1), ty = new Float64Array(n + 1);
  const closedSmooth = cs.length === 1;
  for (let p = 0; p < passes; p++) {
    tx.set(XX); ty.set(YY);
    if (closedSmooth) { for (let i = 0; i < n; i++) { const a = (i + n - 1) % n, b = (i + 1) % n; XX[i] = (tx[a] + 2 * tx[i] + tx[b]) / 4; YY[i] = (ty[a] + 2 * ty[i] + ty[b]) / 4; } XX[n] = XX[0]; YY[n] = YY[0]; }
    else { let s = 0; for (const e of cs) { for (let i = s + 1; i < e; i++) { XX[i] = (tx[i - 1] + 2 * tx[i] + tx[i + 1]) / 4; YY[i] = (ty[i - 1] + 2 * ty[i] + ty[i + 1]) / 4; } s = e; } }
  }
  return { X: XX, Y: YY, n, cs, area };
}

/* ───────────── Bézier fitting (Schneider) ───────────── */
function bz(P, t) { const s = 1 - t, a = s * s * s, b = 3 * s * s * t, c = 3 * s * t * t, d = t * t * t; return [a * P[0] + b * P[2] + c * P[4] + d * P[6], a * P[1] + b * P[3] + c * P[5] + d * P[7]]; }
function fitRange(X, Y, i0, i1, tlx, tly, trx, try_, eps, out, depth) {
  const n = i1 - i0 + 1, ax = X[i0], ay = Y[i0], bx = X[i1], by = Y[i1];
  if (n <= 2) { out.push(0, bx, by); return; }
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), lt = depth ? Math.min(0.22, eps * 0.2) : eps * 0.5;
  if (len > 1e-6) { let md = 0; for (let i = i0 + 1; i < i1; i++) { const d = Math.abs((X[i] - ax) * dy - (Y[i] - ay) * dx) / len; if (d > md) { md = d; if (md > lt) break; } } if (md <= lt) { out.push(0, bx, by); return; } }
  if (n === 3 || depth > 40) { const m = i0 + 1; out.push(0, X[m], Y[m], 0, bx, by); return; }
  const u = new Float64Array(n); u[0] = 0;
  for (let i = 1; i < n; i++) u[i] = u[i - 1] + Math.hypot(X[i0 + i] - X[i0 + i - 1], Y[i0 + i] - Y[i0 + i - 1]);
  const tot = u[n - 1] || 1; for (let i = 1; i < n; i++) u[i] /= tot;
  let B = genBez(X, Y, i0, n, u, tlx, tly, trx, try_), e = maxErr(X, Y, i0, n, u, B); const e2 = eps * eps;
  if (e[0] > e2 && e[0] < 16 * e2) for (let it = 0; it < 6; it++) { reparam(X, Y, i0, n, u, B); B = genBez(X, Y, i0, n, u, tlx, tly, trx, try_); e = maxErr(X, Y, i0, n, u, B); if (e[0] <= e2) break; }
  if (e[0] <= e2) { out.push(1, B[2], B[3], B[4], B[5], B[6], B[7]); return; }
  let sp = i0 + e[1]; if (sp <= i0) sp = i0 + 1; if (sp >= i1) sp = i1 - 1;
  let cx = X[sp - 1] - X[sp + 1], cy = Y[sp - 1] - Y[sp + 1], cl = Math.hypot(cx, cy) || 1; cx /= cl; cy /= cl;
  fitRange(X, Y, i0, sp, tlx, tly, cx, cy, eps, out, depth + 1);
  fitRange(X, Y, sp, i1, -cx, -cy, trx, try_, eps, out, depth + 1);
}
function genBez(X, Y, i0, n, u, t1x, t1y, t2x, t2y) {
  const ax = X[i0], ay = Y[i0], bx = X[i0 + n - 1], by = Y[i0 + n - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < n; i++) { const t = u[i], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const a1x = t1x * b1, a1y = t1y * b1, a2x = t2x * b2, a2y = t2y * b2;
    c00 += a1x * a1x + a1y * a1y; c01 += a1x * a2x + a1y * a2y; c11 += a2x * a2x + a2y * a2y;
    const tx = X[i0 + i] - (ax * (b0 + b1) + bx * (b2 + b3)), ty = Y[i0 + i] - (ay * (b0 + b1) + by * (b2 + b3));
    x0 += a1x * tx + a1y * ty; x1 += a2x * tx + a2y * ty; }
  const det = c00 * c11 - c01 * c01, seg = Math.hypot(bx - ax, by - ay);
  let al = 0, ar = 0; if (Math.abs(det) > 1e-12) { al = (x0 * c11 - x1 * c01) / det; ar = (c00 * x1 - c01 * x0) / det; }
  if (al < 1e-6 * seg || ar < 1e-6 * seg || al > 3 * seg || ar > 3 * seg) { al = ar = seg / 3; }
  return [ax, ay, ax + t1x * al, ay + t1y * al, bx + t2x * ar, by + t2y * ar, bx, by];
}
function maxErr(X, Y, i0, n, u, B) { let m = 0, k = (n / 2) | 0; for (let i = 1; i < n - 1; i++) { const p = bz(B, u[i]), d = (p[0] - X[i0 + i]) ** 2 + (p[1] - Y[i0 + i]) ** 2; if (d > m) { m = d; k = i; } } return [m, k]; }
function reparam(X, Y, i0, n, u, B) {
  for (let i = 1; i < n - 1; i++) { const t = u[i], s = 1 - t;
    const p = bz(B, t);
    const q1x = 3 * (s * s * (B[2] - B[0]) + 2 * s * t * (B[4] - B[2]) + t * t * (B[6] - B[4])), q1y = 3 * (s * s * (B[3] - B[1]) + 2 * s * t * (B[5] - B[3]) + t * t * (B[7] - B[5]));
    const q2x = 6 * (s * (B[4] - 2 * B[2] + B[0]) + t * (B[6] - 2 * B[4] + B[2])), q2y = 6 * (s * (B[5] - 2 * B[3] + B[1]) + t * (B[7] - 2 * B[5] + B[3]));
    const ex = p[0] - X[i0 + i], ey = p[1] - Y[i0 + i], num = ex * q1x + ey * q1y, den = q1x * q1x + q1y * q1y + ex * q2x + ey * q2y;
    if (Math.abs(den) > 1e-12) { const v = t - num / den; if (v > 0 && v < 1) u[i] = v; } }
}
function tangentAt(X, Y, i, j) { let x = X[j] - X[i], y = Y[j] - Y[i], l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function fitContour(c, eps) {
  const { X, Y, n, cs } = c, out = [];
  if (cs.length === 1) { // closed smooth contour: two halves
    const m = n >> 1; if (m < 2) { for (let i = 1; i <= n; i++) out.push(0, X[i], Y[i]); return out; }
    let tx = X[1] - X[n - 1], ty = Y[1] - Y[n - 1], tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    let mx = X[m - 1] - X[m + 1], my = Y[m - 1] - Y[m + 1], ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    fitRange(X, Y, 0, m, tx, ty, mx, my, eps, out, 0); fitRange(X, Y, m, n, -mx, -my, -tx, -ty, eps, out, 0); return out;
  }
  let s = 0;
  for (const e of cs) { const T = Math.min(4, e - s);
    if (e - s <= 1) { out.push(0, X[e], Y[e]); s = e; continue; }
    const tl = tangentAt(X, Y, s, s + T), tr = tangentAt(X, Y, e, e - T);
    fitRange(X, Y, s, e, tl[0], tl[1], tr[0], tr[1], eps, out, 0); s = e; }
  return out;
}

/* ───────────── Compact SVG encoding ───────────── */
function encodeContour(c, segs, ox, oy, g) {
  const R = v => Math.round(v);
  const sx = R((c.X[0] - ox) * g), sy = R((c.Y[0] - oy) * g);
  let s = 'M' + sx + ' ' + sy, last = '', cx = sx, cy = sy, fx = c.X[0], fy = c.Y[0], nodes = 1;
  const num = v => { const t = String(v); const ch = s.charCodeAt(s.length - 1); if (t[0] !== '-' && ch >= 48 && ch <= 57) s += ' '; s += t; };
  const cmd = k => { if (k !== last) { s += k; last = k; } };
  for (let i = 0; i < segs.length;) {
    const t = segs[i];
    if (t === 0) {
      const x = segs[i + 1], y = segs[i + 2]; i += 3;
      const tx = R((x - ox) * g), ty = R((y - oy) * g), dx = tx - cx, dy = ty - cy; fx = x; fy = y;
      if (!dx && !dy) continue;
      if (i >= segs.length && tx === sx && ty === sy) { cx = tx; cy = ty; break; }
      if (!dy) { cmd('h'); num(dx); } else if (!dx) { cmd('v'); num(dy); } else { cmd('l'); num(dx); num(dy); }
      cx = tx; cy = ty; nodes++;
    } else {
      const x1 = segs[i + 1], y1 = segs[i + 2], x2 = segs[i + 3], y2 = segs[i + 4], x = segs[i + 5], y = segs[i + 6]; i += 7;
      const tx = R((x - ox) * g), ty = R((y - oy) * g);
      const qx1 = (3 * x1 - fx) / 2, qy1 = (3 * y1 - fy) / 2, qx2 = (3 * x2 - x) / 2, qy2 = (3 * y2 - y) / 2;
      // close to the chord → line
      const ddx = x - fx, ddy = y - fy, L = Math.hypot(ddx, ddy) || 1e-9;
      const dc1 = Math.abs((x1 - fx) * ddy - (y1 - fy) * ddx) / L, dc2 = Math.abs((x2 - fx) * ddy - (y2 - fy) * ddx) / L;
      if ((dc1 + dc2) * g < 0.7) { const dx = tx - cx, dy = ty - cy; if (dx || dy) { if (!dy) { cmd('h'); num(dx); } else if (!dx) { cmd('v'); num(dy); } else { cmd('l'); num(dx); num(dy); } nodes++; } }
      else if (Math.hypot(qx1 - qx2, qy1 - qy2) * g < 1.1) { const qx = R(((qx1 + qx2) / 2 - ox) * g), qy = R(((qy1 + qy2) / 2 - oy) * g); cmd('q'); num(qx - cx); num(qy - cy); num(tx - cx); num(ty - cy); nodes++; }
      else { cmd('c'); num(R((x1 - ox) * g) - cx); num(R((y1 - oy) * g) - cy); num(R((x2 - ox) * g) - cx); num(R((y2 - oy) * g) - cy); num(tx - cx); num(ty - cy); nodes++; }
      cx = tx; cy = ty; fx = x; fy = y;
    }
  }
  return { s: s + 'z', nodes };
}

/* ───────────── Geometry of a stacked layer ───────────── */
function colorStats(fin, rgba) {
  const { W, H, labels, colors } = fin, K = colors.length;
  const st = colors.map(() => ({ area: 0, per: 0, tE: 0, x0: W, y0: H, x1: -1, y1: -1, nb: new Float64Array(K + 1), acc: [0, 0, 0, 0] }));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, l = labels[i]; if (l < 0) continue; const s = st[l]; s.area++;
    if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
    const nbs = [x > 0 ? labels[i - 1] : -1, x < W - 1 ? labels[i + 1] : -1, y > 0 ? labels[i - W] : -1, y < H - 1 ? labels[i + W] : -1];
    let inner = true;
    for (const q of nbs) if (q !== l) { inner = false; s.per++; if (q < 0) { s.tE++; s.nb[K]++; } else s.nb[q]++; }
    if (inner && rgba) { s.acc[0] += rgba[i * 4]; s.acc[1] += rgba[i * 4 + 1]; s.acc[2] += rgba[i * 4 + 2]; s.acc[3]++; }
  }
  st.forEach((s, k) => { s.rgb = s.acc[3] ? [s.acc[0] / s.acc[3], s.acc[1] / s.acc[3], s.acc[2] / s.acc[3]] : rgbOfHex(colors[k].hex); });
  const gray = labOfHex('#8a8a8a');
  st.forEach((s, k) => { let sw = 0, sd = 0; for (let q = 0; q <= K; q++) { if (!s.nb[q]) continue; const d = d3(colors[k].lab, q === K ? gray : colors[q].lab); sw += s.nb[q]; sd += s.nb[q] * d; } s.contrast = sw ? Math.max(0.02, sd / sw) : 0.2; s.thick = s.area / Math.max(1, s.per); });
  return st;
}
function layerGeom(fin, st, c, above, r, cosThr, k, passes, rgba) {
  const { W, H, labels } = fin, S = st[c];
  const x0 = Math.max(0, S.x0 - r - 1), y0 = Math.max(0, S.y0 - r - 1), x1 = Math.min(W - 1, S.x1 + r + 1), y1 = Math.min(H - 1, S.y1 + r + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h, m = new Uint8Array(n), ab = new Uint8Array(n), own = new Uint8Array(n);
  let anyAb = false;
  for (let y = 0; y < h; y++) { const row = (y + y0) * W + x0; for (let x = 0; x < w; x++) { const L = labels[row + x]; if (L === c) { m[y * w + x] = 1; own[y * w + x] = 1; } else if (L >= 0 && above[L]) { ab[y * w + x] = 1; anyAb = true; } } }
  if (anyAb) {
    if (r > 0) { // dilation under the upper layers (3-4 chamfer)
      const D = new Uint16Array(n).fill(65535), lim = 3 * r;
      for (let i = 0; i < n; i++) if (own[i]) D[i] = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; let v = D[i]; if (!v) continue;
        if (x > 0) v = Math.min(v, D[i - 1] + 3); if (y > 0) { v = Math.min(v, D[i - w] + 3); if (x > 0) v = Math.min(v, D[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, D[i - w + 1] + 4); } D[i] = v; }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; let v = D[i]; if (!v) continue;
        if (x < w - 1) v = Math.min(v, D[i + 1] + 3); if (y < h - 1) { v = Math.min(v, D[i + w] + 3); if (x < w - 1) v = Math.min(v, D[i + w + 1] + 4); if (x > 0) v = Math.min(v, D[i + w - 1] + 4); } D[i] = v; }
      for (let i = 0; i < n; i++) if (ab[i] && D[i] <= lim) m[i] = 1;
    }
    // holes fully covered by the upper layers → filled
    const seen = new Uint8Array(n), st2 = new Int32Array(n); let sp = 0;
    const seed = i => { if (!m[i] && !seen[i]) { seen[i] = 1; st2[sp++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); } for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (sp) { const i = st2[--sp], x = i % w; if (x > 0) seed(i - 1); if (x < w - 1) seed(i + 1); if (i >= w) seed(i - w); if (i < n - w) seed(i + w); }
    for (let i = 0; i < n; i++) if (!m[i] && !seen[i] && ab[i]) m[i] = 1;
  }
  // 8-connected components
  const comp = new Int32Array(n).fill(-1), stk = new Int32Array(n), ownCnt = []; let C = 0;
  for (let i = 0; i < n; i++) { if (!m[i] || comp[i] >= 0) continue; let sp = 0, oc = 0; stk[sp++] = i; comp[i] = C;
    while (sp) { const j = stk[--sp], x = j % w, y = (j / w) | 0; if (own[j]) oc++;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const q = yy * w + xx; if (m[q] && comp[q] < 0) { comp[q] = C; stk[sp++] = q; } } } }
    ownCnt.push(oc); C++; }
  const raw = traceMask(m, w, h, comp), comps = [];
  for (let q = 0; q < C; q++) comps.push({ own: ownCnt[q], outer: null, holes: [] });
  for (const t of raw) { const a = signedArea(t.pts), f = refineContour(t.pts, x0, y0, fin, st, c, above, rgba), pc = prepContour(f[0], f[1], Math.abs(a), cosThr, k, passes); if (a < 0) comps[t.comp].outer = pc; else comps[t.comp].holes.push(pc); }
  return comps.filter(o => o.outer && o.own > 0);
}

/* Sub-pixel refinement: each contour edge (between an “inside” pixel and an “outside” pixel)
   is moved to where the anti-aliasing coverage of the original image crosses 50 %.
   Only visible boundaries (own color ↔ color below / transparent) are refined. */
function refineContour(pts, x0, y0, fin, st, c, above, rgba) {
  const n = pts.length / 2, X = new Float64Array(n), Y = new Float64Array(n), { W, H, labels } = fin, A = st[c].rgb;
  const lab = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -2 : labels[y * W + x];
  const cov = (x, y, lb) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const i = (y * W + x) * 4, al = rgba[i + 3] / 255;
    if (lb < 0) return al;
    const B = st[lb].rgb, vx = A[0] - B[0], vy = A[1] - B[1], vz = A[2] - B[2], vv = vx * vx + vy * vy + vz * vz;
    if (vv < 900) return -1;
    const t = ((rgba[i] - B[0]) * vx + (rgba[i + 1] - B[1]) * vy + (rgba[i + 2] - B[2]) * vz) / vv;
    return Math.max(0, Math.min(1, t));
  };
  let lastOff = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, vx = pts[i * 2] + x0, vy = pts[i * 2 + 1] + y0, dx = pts[j * 2] + x0 - vx, dy = pts[j * 2 + 1] + y0 - vy;
    const mx = vx + dx / 2, my = vy + dy / 2;
    const ax = Math.floor(mx + dy * 0.5), ay = Math.floor(my - dx * 0.5), bx = Math.floor(mx - dy * 0.5), by = Math.floor(my + dx * 0.5);
    let off = 0;
    const la = lab(ax, ay), lb = lab(bx, by);
    // corner pixel (the shape turns right there): its coverage mixes two edges, it would pull the contour
    // inward and make straight edges wavy; keep the neighboring edge offset
    const sx = Math.sign(dx), sy = Math.sign(dy), atCorner = la === c && lb < 0 && (lab(ax - sx, ay - sy) !== c || lab(ax + sx, ay + sy) !== c || lab(bx - sx, by - sy) === c || lab(bx + sx, by + sy) === c);
    if (atCorner) off = i ? lastOff : 0;
    else if (la === c && lb !== c && (lb < 0 || !above[lb])) {
      const ta = cov(ax, ay, lb), tb = cov(bx, by, lb);
      if (ta >= 0 && tb >= 0 && ta - tb > 0.08) { const s2 = Math.max(0, Math.min(1, (ta - 0.5) / (ta - tb))); off = s2 - 0.5; }
    }
    lastOff = off; X[i] = mx - dy * off; Y[i] = my + dx * off;
  }
  return [X, Y];
}

/* ───────────── Rendering & error ───────────── */
function makeTarget(fin, bb, aw, ah) {
  const { W, labels, colors } = fin, bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1, A = new Float64Array(aw * ah * 4), cnt = new Float64Array(aw * ah);
  const rgb = colors.map(c => rgbOfHex(c.hex));
  for (let y = 0; y < bh; y++) { const ay = Math.min(ah - 1, (y * ah / bh) | 0); for (let x = 0; x < bw; x++) { const ax = Math.min(aw - 1, (x * aw / bw) | 0), q = ay * aw + ax; cnt[q]++; const l = labels[(y + bb.y0) * W + x + bb.x0]; if (l < 0) continue; const c = rgb[l]; A[q * 4] += c[0]; A[q * 4 + 1] += c[1]; A[q * 4 + 2] += c[2]; A[q * 4 + 3] += 255; } }
  const T = compLab(A, cnt, aw * ah, true); T.nEdge = edgeCount(T, aw, ah); return T;
}
function edgeCount(T, aw, ah) { let e = 0;
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) { const q = y * aw + x;
    for (const r of [x + 1 < aw ? q + 1 : -1, y + 1 < ah ? q + aw : -1]) { if (r < 0) continue;
      if (Math.abs(T.a[q] - T.a[r]) > 0.3 || Math.hypot(T.lab[q * 3] - T.lab[r * 3], T.lab[q * 3 + 1] - T.lab[r * 3 + 1], T.lab[q * 3 + 2] - T.lab[r * 3 + 2]) > 0.04) { e++; break; } } }
  return Math.max(1, e); }
function makeOrig(rgba, W, bb, aw, ah, thr, labels) {
  const bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1, A = new Float64Array(aw * ah * 4), cnt = new Float64Array(aw * ah);
  for (let y = 0; y < bh; y++) { const ay = Math.min(ah - 1, (y * ah / bh) | 0); for (let x = 0; x < bw; x++) { const ax = Math.min(aw - 1, (x * aw / bw) | 0), q = ay * aw + ax, i = ((y + bb.y0) * W + x + bb.x0) * 4; cnt[q]++; if (rgba[i + 3] < thr || labels[(y + bb.y0) * W + x + bb.x0] < 0) continue; A[q * 4] += rgba[i]; A[q * 4 + 1] += rgba[i + 1]; A[q * 4 + 2] += rgba[i + 2]; A[q * 4 + 3] += 255; } }
  const T = compLab(A, cnt, aw * ah, true); T.nEdge = edgeCount(T, aw, ah); return T;
}
/* composite over grey → OKLab; returns {lab, a} */
function compLab(A, cnt, n, premul) {
  const lab = new Float32Array(n * 3), al = new Float32Array(n), t = [0, 0, 0];
  for (let q = 0; q < n; q++) { const c = premul ? cnt[q] || 1 : 1; const a = A[q * 4 + 3] / c / 255; al[q] = a;
    const r = Math.round(A[q * 4] / c + 128 * (1 - a)), g = Math.round(A[q * 4 + 1] / c + 128 * (1 - a)), b = Math.round(A[q * 4 + 2] / c + 128 * (1 - a));
    toLab(Math.min(255, r), Math.min(255, g), Math.min(255, b), t, 0); lab[q * 3] = t[0]; lab[q * 3 + 1] = t[1]; lab[q * 3 + 2] = t[2]; }
  return { lab, a: al };
}
let _cv = null;
function renderPaths(layers, vw, vh, aw, ah) {
  if (!_cv || _cv.width !== aw || _cv.height !== ah) _cv = new OffscreenCanvas(aw, ah);
  const ctx = _cv.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, aw, ah); ctx.setTransform(aw / vw, 0, 0, ah / vh, 0, 0);
  for (const L of layers) { if (!L.d) continue; ctx.fillStyle = L.hex; ctx.fill(new Path2D(L.d)); }
  const d = ctx.getImageData(0, 0, aw, ah).data, n = aw * ah, A = new Float64Array(n * 4);
  for (let q = 0; q < n; q++) { const a = d[q * 4 + 3] / 255; A[q * 4] = d[q * 4] * a; A[q * 4 + 1] = d[q * 4 + 1] * a; A[q * 4 + 2] = d[q * 4 + 2] * a; A[q * 4 + 3] = d[q * 4 + 3]; }
  return compLab(A, null, n, false);
}
function errorOf(R, T) { const n = T.a.length; let s = 0, c = 0, bad = 0;
  for (let q = 0; q < n; q++) { if (T.a[q] < 0.01 && R.a[q] < 0.01) continue; const d = Math.hypot(R.lab[q * 3] - T.lab[q * 3], R.lab[q * 3 + 1] - T.lab[q * 3 + 1], R.lab[q * 3 + 2] - T.lab[q * 3 + 2]); s += d; c++; if (d > 0.08) bad++; }
  return c ? { mean: s / c, bad: bad / c, edge: s / T.nEdge } : { mean: 0, bad: 0, edge: 0 }; }
/* score normalized by the amount of edges: a very detailed logo is not penalized for its complexity */
const scoreOf = e => Math.max(0, Math.min(100, 100 - 100 * e.edge));

/* ───────────── Centering: small isolated spots ─────────────
   A speck far from the drawing (stray pixel, shadow leftover) enlarges the frame and off-centers the decal in GT7.
   Cluster = 8-connected opaque pixels. A cluster smaller than 0.3 % of the opaque area, entirely outside the frame of
   significant clusters (enlarged by 2 %), is removed. Dots on i's, accents, etc. are inside the frame: kept. */
function dropStraySpecks(fin) {
  const { W, H, labels } = fin, N = W * H, id = new Int32Array(N).fill(-1), cl = [];
  let total = 0;
  for (let p = 0; p < N; p++) {
    if (labels[p] < 0 || id[p] >= 0) continue;
    const k = cl.length, c = { area: 0, x0: W, y0: H, x1: -1, y1: -1 }, stack = [p]; id[p] = k;
    while (stack.length) {
      const q = stack.pop(), x = q % W, y = (q / W) | 0; c.area++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const r = ny * W + nx; if (labels[r] >= 0 && id[r] < 0) { id[r] = k; stack.push(r); }
      }
    }
    cl.push(c); total += c.area;
  }
  if (cl.length < 2) return 0;
  const minA = total * 0.003, bb = { x0: W, y0: H, x1: -1, y1: -1 };
  for (const c of cl) if (c.area >= minA) { bb.x0 = Math.min(bb.x0, c.x0); bb.y0 = Math.min(bb.y0, c.y0); bb.x1 = Math.max(bb.x1, c.x1); bb.y1 = Math.max(bb.y1, c.y1); }
  if (bb.x1 < 0) return 0;
  const mx = Math.round(0.02 * (bb.x1 - bb.x0 + 1)), my = Math.round(0.02 * (bb.y1 - bb.y0 + 1));
  const drop = cl.map(c => c.area < minA && (c.x1 < bb.x0 - mx || c.x0 > bb.x1 + mx || c.y1 < bb.y0 - my || c.y0 > bb.y1 + my));
  let n = 0; for (const d of drop) if (d) n++;
  if (n) for (let p = 0; p < N; p++) if (id[p] >= 0 && drop[id[p]]) labels[p] = -1;
  return n;
}

/* ───────────── Gradients: whole faces ─────────────
   A gradient face has no crisp edge inside: it is found by following nearly identical neighboring pixels
   (outlines, fringes and anti-aliasing make a sharp jump and stop it). If its colors follow a single gradient
   (small deviation from the mean curve along its direction), the whole face becomes a color of its own,
   whatever palette bands were cutting it: it is traced in one piece and gets its full gradient. */
function gradFaces(fin, rgba, keepHex, up) {
  const { W, H, labels: L } = fin, N = W * H, E = 10, edge = new Uint8Array(N), ku = Math.max(1, Math.round(up || 1));
  const df = (p, q) => Math.max(Math.abs(rgba[p * 4] - rgba[q * 4]), Math.abs(rgba[p * 4 + 1] - rgba[q * 4 + 1]), Math.abs(rgba[p * 4 + 2] - rgba[q * 4 + 2]));
  const lk = fin.locked || new Uint8Array(N);
  for (let p = 0; p < N; p++) if (L[p] < 0 || rgba[p * 4 + 3] < 250 || lk[p]) edge[p] = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x;
    if (x < W - 1 && df(p, p + 1) > E) edge[p] = edge[p + 1] = 1; if (y < H - 1 && df(p, p + W) > E) edge[p] = edge[p + W] = 1;
    // upscaled image: a crisp edge spreads over several pixels; also compare at a distance of “one source pixel”
    if (ku > 1) { if (x + ku < W && df(p, p + ku) > E * 1.6) for (let i = 0; i <= ku; i++) edge[p + i] = 1; if (y + ku < H && df(p, p + ku * W) > E * 1.6) for (let i = 0; i <= ku; i++) edge[p + i * W] = 1; } }
  const id = new Int32Array(N).fill(-1), minN = Math.max(600, N * 0.0006), faces = [];
  let nc = 0;
  for (let p0 = 0; p0 < N; p0++) { if (edge[p0] || id[p0] >= 0) continue; const k = nc++, px = [p0]; id[p0] = k;
    for (let i = 0; i < px.length; i++) { const q = px[i], x = q % W;
      if (x > 0 && !edge[q - 1] && id[q - 1] < 0) { id[q - 1] = k; px.push(q - 1); } if (x < W - 1 && !edge[q + 1] && id[q + 1] < 0) { id[q + 1] = k; px.push(q + 1); }
      if (q >= W && !edge[q - W] && id[q - W] < 0) { id[q - W] = k; px.push(q - W); } if (q < N - W && !edge[q + W] && id[q + W] < 0) { id[q + W] = k; px.push(q + W); } }
    if (px.length < minN) continue;
    // thin band (bevel, fringe): kept flat, its outline stays crisp; a gradient face is wide
    { let per = 0; for (const q of px) { const x = q % W; if (x === 0 || x === W - 1 || q < W || q >= N - W || id[q - 1] !== k || id[q + 1] !== k || id[q - W] !== k || id[q + W] !== k) per++; }
      if (2 * px.length / Math.max(1, per) < Math.max(24, 12 * ku)) continue; }
    const f = fitFace(px, W, rgba); if (f) { f.k = k; f.px = px; faces.push(f); } }
  if (!faces.length) return 0;
  const fid = new Int32Array(N).fill(-1), K0 = fin.colors.length;
  faces.forEach((f, i) => { f.lab = K0 + i; for (const p of f.px) { fid[p] = i; L[p] = f.lab; }
    const m = f.mean; const hex = '#' + m.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); fin.colors.push({ hex, lab: labOfHex(hex), face: 1 }); });
  // face edges: smoothed (vote of the 8 neighbors, the edge threshold hesitates where face and fringe look alike),
  // then grown by one pixel to take the anti-aliasing back; otherwise the outline follows steps and scallops
  const setF = (p, i) => { fid[p] = i; L[p] = i < 0 ? L[p] : faces[i].lab; };
  const orig = new Int16Array(L);
  for (let pass = 0; pass < 2; pass++) { const upd = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x, fp = fid[p]; if (L[p] < 0 || lk[p]) continue;
      if (fid[p - 1] === fp && fid[p + 1] === fp && fid[p - W] === fp && fid[p + W] === fp && fid[p - W - 1] === fp && fid[p + W + 1] === fp && fid[p - W + 1] === fp && fid[p + W - 1] === fp) continue;
      const cnt = new Map(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const f = fid[p + dy * W + dx]; cnt.set(f, (cnt.get(f) || 0) + 1); }
      let bf = fid[p], bn = 0; for (const [f, c] of cnt) if (c > bn) { bn = c; bf = f; }
      if (bf !== fid[p] && bn >= 5) upd.push(p, bf); }
    for (let i = 0; i < upd.length; i += 2) { const p = upd[i], f = upd[i + 1]; fid[p] = f; L[p] = f >= 0 ? faces[f].lab : (orig[p] >= K0 ? L[p] : orig[p]); } }
  { const upd = [];
    for (let p = 0; p < N; p++) { if (fid[p] >= 0 || L[p] < 0 || lk[p]) continue; const x = p % W;
      const f = x > 0 && fid[p - 1] >= 0 ? fid[p - 1] : x < W - 1 && fid[p + 1] >= 0 ? fid[p + 1] : p >= W && fid[p - W] >= 0 ? fid[p - W] : p < N - W && fid[p + W] >= 0 ? fid[p + W] : -1;
      if (f >= 0) upd.push(p, f); }
    for (let i = 0; i < upd.length; i += 2) setF(upd[i], upd[i + 1]); }
  // outer edge of an upscaled image: anti-aliasing spans several pixels; those with the gradient color at
  // that spot join the face (otherwise a broken fringe remains and the outline wobbles along straight edges)
  for (let pass = 0; pass < ku + 1; pass++) { const upd = [];
    for (let p = 0; p < N; p++) { if (fid[p] >= 0 || L[p] < 0 || lk[p]) continue; const x = p % W;
      const f = x > 0 && fid[p - 1] >= 0 ? fid[p - 1] : x < W - 1 && fid[p + 1] >= 0 ? fid[p + 1] : p >= W && fid[p - W] >= 0 ? fid[p - W] : p < N - W && fid[p + W] >= 0 ? fid[p + W] : -1;
      if (f < 0) continue; const F = faces[f], pr = facePred(F, x, (p / W) | 0), q = p * 4;
      if (Math.max(Math.abs(rgba[q] - pr[0]), Math.abs(rgba[q + 1] - pr[1]), Math.abs(rgba[q + 2] - pr[2])) <= Math.max(24, F.range * 0.25)) upd.push(p, f); }
    if (!upd.length) break; for (let i = 0; i < upd.length; i += 2) setF(upd[i], upd[i + 1]); }
  // band leftovers enclosed in a face (small islands of another color): given back to the face
  const seen = new Uint8Array(N), lim = Math.max(60, N * 0.00015);   // whole components (a bounded fill would cut a fringe into pieces)
  for (let p0 = 0; p0 < N; p0++) { if (seen[p0] || L[p0] < 0 || fid[p0] >= 0 || lk[p0]) continue; const c = L[p0], px = [p0]; seen[p0] = 1; const touch = new Set(); let fixed = false;
    for (let i = 0; i < px.length; i++) { const q = px[i], x = q % W;
      for (const r of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) { if (r < 0 || r >= N) continue;
        if (fid[r] >= 0) { touch.add(fid[r]); continue; }
        if (!seen[r] && L[r] === c) { seen[r] = 1; px.push(r); if (lk[r]) fixed = true; } } }
    if (fixed || px.length > lim || touch.size !== 1) continue;
    const fi = touch.values().next().value; for (const q of px) { fid[q] = fi; L[q] = faces[fi].lab; } }
  // remaining colors (fringes, outlines): their shade was pulled by the gradient areas taken by the faces;
  // use the median of their core pixels (no anti-aliasing), except for hand-picked colors
  for (let k = 0; k < K0; k++) { if (keepHex && keepHex.has(fin.colors[k].hex)) continue;
    const hs = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]; let n = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; if (L[p] !== k || L[p - 1] !== k || L[p + 1] !== k || L[p - W] !== k || L[p + W] !== k) continue;
      const q = p * 4; hs[0][rgba[q]]++; hs[1][rgba[q + 1]]++; hs[2][rgba[q + 2]]++; n++; }
    if (n < 50) continue;
    const med = hs.map(h => { let a = 0; for (let v = 0; v < 256; v++) { a += h[v]; if (a * 2 >= n) return v; } return 255; });
    const hex = '#' + med.map(v => v.toString(16).padStart(2, '0')).join('');
    if (hex !== fin.colors[k].hex) fin.colors[k] = { hex, lab: labOfHex(hex) }; }
  return faces.length;
}
// Douglas-Peucker on the color curve (offset, r, g, b): stops kept while the deviation exceeds tol
function simplifyStops(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const rec = (i, j) => { if (j - i < 2) return; const a = pts[i], b = pts[j]; let worst = -1, wd = tol;
    for (let k = i + 1; k < j; k++) { const u = (pts[k][0] - a[0]) / (b[0] - a[0] || 1); let dd = 0;
      for (let ch = 1; ch <= 3; ch++) dd = Math.max(dd, Math.abs(pts[k][ch] - (a[ch] + (b[ch] - a[ch]) * u)));
      if (dd > wd) { wd = dd; worst = k; } }
    if (worst >= 0) { keep[worst] = 1; rec(i, worst); rec(worst, j); } };
  rec(0, pts.length - 1); return pts.filter((_, i) => keep[i]);
}
/* center of a round gradient (glow, round shadow, highlight): lightness ≈ a + b·x + c·y + d·(x² + y²) by least
   squares; the apex of this bowl is the center. Too far from the shape: it is a straight gradient. */
function radialCenter(n, X, Y, Lm) {
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += X(i); my += Y(i); } mx /= n; my /= n;
  let s2 = 0; for (let i = 0; i < n; i++) s2 += (X(i) - mx) ** 2 + (Y(i) - my) ** 2; const s = Math.sqrt(s2 / n) || 1;
  const A = new Float64Array(16), b = new Float64Array(4), step = Math.max(1, Math.floor(n / 30000));
  for (let i = 0; i < n; i += step) { const u = (X(i) - mx) / s, v = (Y(i) - my) / s, f = [1, u, v, u * u + v * v], l = Lm(i);
    for (let j = 0; j < 4; j++) { b[j] += f[j] * l; for (let k = 0; k < 4; k++) A[j * 4 + k] += f[j] * f[k]; } }
  for (let c = 0; c < 4; c++) { let pv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(A[r * 4 + c]) > Math.abs(A[pv * 4 + c])) pv = r;
    if (Math.abs(A[pv * 4 + c]) < 1e-9) return null;
    if (pv !== c) { for (let k = 0; k < 4; k++) { const t = A[c * 4 + k]; A[c * 4 + k] = A[pv * 4 + k]; A[pv * 4 + k] = t; } const t = b[c]; b[c] = b[pv]; b[pv] = t; }
    for (let r = 0; r < 4; r++) { if (r === c) continue; const m = A[r * 4 + c] / A[c * 4 + c]; for (let k = c; k < 4; k++) A[r * 4 + k] -= m * A[c * 4 + k]; b[r] -= m * b[c]; } }
  const d = b[3] / A[15]; if (Math.abs(d) < 0.5) return null;   // no clear curvature
  const cu = -(b[1] / A[5]) / (2 * d), cv = -(b[2] / A[10]) / (2 * d); if (!isFinite(cu) || Math.hypot(cu, cv) > 2.5) return null;
  return [mx + cu * s, my + cv * s];
}
function faceT(f, x, y) { return f.rad ? Math.hypot(x - f.cx, y - f.cy) : (x - f.mx) * f.ux + (y - f.my) * f.uy; }
function faceModel(px, W, rgba, f) {
  const n = px.length, ts = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = px[i]; ts[i] = faceT(f, p % W, (p / W) | 0); }
  const srt = ts.slice().sort(), t0 = srt[Math.floor(n * 0.005)], t1 = srt[Math.floor(n * 0.995)]; if (t1 - t0 < 8) return null;
  const B = 32, acc = new Float64Array(B * 4);
  for (let i = 0; i < n; i++) { const b = Math.max(0, Math.min(B - 1, Math.floor((ts[i] - t0) / (t1 - t0) * B))), q = px[i] * 4; acc[b * 4] += rgba[q]; acc[b * 4 + 1] += rgba[q + 1]; acc[b * 4 + 2] += rgba[q + 2]; acc[b * 4 + 3]++; }
  const bins = []; for (let b = 0; b < B; b++) if (acc[b * 4 + 3] > 0) { const c = acc[b * 4 + 3]; bins.push([t0 + (b + 0.5) / B * (t1 - t0), acc[b * 4] / c, acc[b * 4 + 1] / c, acc[b * 4 + 2] / c]); }
  if (bins.length < 4) return null;
  f.bins = bins;
  let range = 0; for (let ch = 1; ch <= 3; ch++) { let lo = 255, hi = 0; for (const b of bins) { lo = Math.min(lo, b[ch]); hi = Math.max(hi, b[ch]); } range = Math.max(range, hi - lo); }
  if (range < 16) return null;
  let err = 0, far = 0; const farT = Math.max(24, range * 0.3);
  for (let i = 0; i < n; i += 3) { const p = px[i], pr = facePred(f, p % W, (p / W) | 0), q = p * 4, e = Math.max(Math.abs(rgba[q] - pr[0]), Math.abs(rgba[q + 1] - pr[1]), Math.abs(rgba[q + 2] - pr[2])); err += e; if (e > farT) far++; }
  const m = Math.ceil(n / 3); f.err = err / m; f.range = range; f.far = far / m; return f;
}
function fitFace(px, W, rgba) {
  const n = px.length; let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sl = 0, sxl = 0, syl = 0, mr = 0, mg = 0, mb = 0;
  const lum = p => 0.3 * rgba[p * 4] + 0.59 * rgba[p * 4 + 1] + 0.11 * rgba[p * 4 + 2];
  for (const p of px) { const x = p % W, y = (p / W) | 0, q = p * 4, l = lum(p);
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sl += l; sxl += x * l; syl += y * l; mr += rgba[q]; mg += rgba[q + 1]; mb += rgba[q + 2]; }
  const mx = sx / n, my = sy / n, ml = sl / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, cxl = sxl / n - mx * ml, cyl = syl / n - my * ml, det = cxx * cyy - cxy * cxy;
  const mean = [mr / n, mg / n, mb / n]; let lin = null;
  if (det >= 1e-6) { const bx = (cyy * cxl - cxy * cyl) / det, by = (cxx * cyl - cxy * cxl) / det, gm = Math.hypot(bx, by);
    if (gm >= 1e-4) lin = faceModel(px, W, rgba, { mx, my, ux: bx / gm, uy: by / gm, mean }); }
  // round gradient: kept if it fits clearly better than the straight one
  const c = radialCenter(n, i => px[i] % W, i => (px[i] / W) | 0, i => lum(px[i])), rad = c ? faceModel(px, W, rgba, { rad: 1, cx: c[0], cy: c[1], mean }) : null;
  const f = rad && (!lin || rad.err < lin.err * 0.8) ? rad : lin; if (!f) return null;
  // a band of another color caught in the face (bevel, fringe blurred by upscaling): a few pixels very far from the gradient
  return f.err < Math.max(5, f.range * 0.07) && f.far < 0.03 ? f : null;
}
function facePred(f, x, y) {
  const t = faceT(f, x, y), B = f.bins;
  if (t <= B[0][0]) return [B[0][1], B[0][2], B[0][3]]; const z = B[B.length - 1]; if (t >= z[0]) return [z[1], z[2], z[3]];
  let i = 1; while (B[i][0] < t) i++; const a = B[i - 1], b = B[i], u = (t - a[0]) / (b[0] - a[0]);
  return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
}

/* ───────────── Gradients: merging bands ─────────────
   A gradient cut into flat colors gives neighboring bands whose boundary is soft in the original image
   (nearly identical pixels on both sides) while their mean colors differ. These neighboring areas
   are joined (color of the largest): the whole shape then gets a single gradient. A real edge
   (outline, fringe) has a sharp jump from one pixel to the next and is not touched. */
function softMerge(fin, rgba, up) {
  const { W, H, labels: L } = fin, N = W * H, id = new Int32Array(N).fill(-1), comps = [], lk = fin.locked;
  for (let p = 0; p < N; p++) { if (L[p] < 0 || id[p] >= 0) continue; const k = comps.length, c = L[p], st = [p]; id[p] = k; let n = 0, r = 0, g = 0, b = 0;
    while (st.length) { const q = st.pop(), x = q % W; n++; r += rgba[q * 4]; g += rgba[q * 4 + 1]; b += rgba[q * 4 + 2];
      if (x > 0 && id[q - 1] < 0 && L[q - 1] === c) { id[q - 1] = k; st.push(q - 1); } if (x < W - 1 && id[q + 1] < 0 && L[q + 1] === c) { id[q + 1] = k; st.push(q + 1); }
      if (q >= W && id[q - W] < 0 && L[q - W] === c) { id[q - W] = k; st.push(q - W); } if (q < N - W && id[q + W] < 0 && L[q + W] === c) { id[q + W] = k; st.push(q + W); } }
    comps.push({ c, n, m: [r / n, g / n, b / n] }); }
  if (lk) for (let p = 0; p < N; p++) if (lk[p] && id[p] >= 0) comps[id[p]].fixed = true;   // edited by hand: not merged
  for (const cp of comps) if (fin.colors[cp.c] && fin.colors[cp.c].face) cp.fixed = true;   // face already rendered by its gradient (bevel included): not merged
  if (comps.length < 2 || comps.length > 20000) return 0;
  const pairs = new Map(), K = comps.length;
  const ku = Math.max(1, Math.round(up || 1));   // upscaled image: the jump is measured over a source pixel, not an upscaled pixel
  const add = (p, q, d, ok) => { const a = id[p], b = id[q]; if (a < 0 || b < 0 || a === b) return; if (rgba[p * 4 + 3] < 128 || rgba[q * 4 + 3] < 128) return;
    const key = a < b ? a * K + b : b * K + a; let e = pairs.get(key); if (!e) { e = [0, 0]; pairs.set(key, e); }
    let r = q; for (let i = 1; i < ku && ok(i); i++) { const t = q + d * i; if (id[t] !== b) break; r = t; }
    e[0]++; e[1] += Math.max(Math.abs(rgba[p * 4] - rgba[r * 4]), Math.abs(rgba[p * 4 + 1] - rgba[r * 4 + 1]), Math.abs(rgba[p * 4 + 2] - rgba[r * 4 + 2])); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (x < W - 1) add(p, p + 1, 1, i => x + 1 + i < W); if (y < H - 1) add(p, p + W, W, i => y + 1 + i < H); }
  const par = new Int32Array(K).map((_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  let n = 0;
  for (const [key, e] of pairs) { if (e[0] < 20) continue; const a = Math.floor(key / K), b = key % K, A = comps[a], B = comps[b]; if (A.fixed || B.fixed) continue;
    const md = Math.max(...[0, 1, 2].map(i => Math.abs(A.m[i] - B.m[i]))), step = e[1] / e[0];
    if (md >= 12 && step < 16 && step < 0.3 * md) { const ra = find(a), rb = find(b); if (ra !== rb) { par[ra] = rb; n++; } } }
  if (!n) return 0;
  const big = new Int32Array(K).fill(-1); for (let i = 0; i < K; i++) { const r = find(i); if (big[r] < 0 || comps[i].n > comps[big[r]].n) big[r] = i; }
  for (let p = 0; p < N; p++) { const k = id[p]; if (k >= 0) L[p] = comps[big[find(k)]].c; }
  return n;
}

/* ───────────── Optimiseur ─────────────
   O = { budget, mode:'auto'|'single'|'fixed', files, maxFiles, target, corners, overlap } */
function optimize(seg, ops, O, progress) {
  progress = progress || (() => {});
  const t0 = Date.now(), fin = applyOps(seg, ops || []), { W, H } = fin; let K = fin.colors.length;
  if (!K) return { files: [], empty: true };
  const specks = O.center === false ? 0 : dropStraySpecks(fin);
  const handHex = new Set(); for (const o of ops || []) { if (!o) continue; if (o.hex) handHex.add(o.hex); for (const l of [o.regions, o.holes, o.paint]) if (l) for (const r of l) if (r.hex) handHex.add(r.hex); }
  const nFaces = O.gradients ? gradFaces(fin, seg.rgba, new Set([...handHex].map(h => String(h).toLowerCase())), seg.up) : 0; K = fin.colors.length;
  if (O.gradients) softMerge(fin, seg.rgba, seg.up);   // gradients: the bands of one gradient become a single shape again
  const st = colorStats(fin, seg.rgba), present = st.map((s, k) => s.area > 0 ? k : -1).filter(k => k >= 0);
  if (!present.length) return { files: [], empty: true };
  const bb = { x0: W, y0: H, x1: -1, y1: -1 };
  for (const k of present) { const s = st[k]; bb.x0 = Math.min(bb.x0, s.x0); bb.y0 = Math.min(bb.y0, s.y0); bb.x1 = Math.max(bb.x1, s.x1); bb.y1 = Math.max(bb.y1, s.y1); }
  const bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1, sc = Math.max(W, H) / 1000;
  const upf = Math.min(4, Math.max(1, 0.55 * (seg.up || 1))), sm = O.smooth != null ? O.smooth : 50, passes = Math.max(1, Math.round((sm / 25) * upf * upf));
  const cosThr = O.corners != null ? O.corners : 0.55, kk = Math.max(2, Math.round(3 * sc * upf)), r = Math.max(1, Math.round((O.overlap != null ? O.overlap : 2) * sc));
  const budget = O.budget || 15360, pBudget = budget - (O.gradients ? budget * 0.15 : 0) - Math.min(budget * 0.1, nFaces * 230);   // room kept for gradients (shapes and faces)
  // “separate” colors (ops[i].grp): their layers go on top and into their own files;
  // the other colors extend underneath (no hole where they sit)
  const grpHex = new Set(), Kp = seg.palette.length;
  for (let i = 0; i < Kp; i++) { const o = ops && ops[i]; if (!o || !o.grp) continue; let j = i, guard = 0; while (ops[j] && ops[j].to >= 0 && ops[j].to !== j && guard++ < Kp) j = ops[j].to; if (ops[j] && ops[j].del) continue; grpHex.add((ops[j] && ops[j].hex) || seg.palette[j].hex); }
  const GRP = fin.colors.map(c => grpHex.has(c.hex) ? 1 : 0), hasG = present.some(c => GRP[c]) && present.some(c => !GRP[c]);
  const part = o => hasG ? [...o.filter(c => !GRP[c]), ...o.filter(c => GRP[c])] : o;

  // ── stacking order
  progress('Layer order', 0.05);
  const geomCache = new Map();
  const getGeom = (c, aboveSet) => { const key = c + ':' + aboveSet.join(','); let g = geomCache.get(key);
    if (!g) { const ab = new Uint8Array(K); for (const q of aboveSet) ab[q] = 1; g = { comps: layerGeom(fin, st, c, ab, r, cosThr, kk, passes, seg.rgba), fit: new Map() }; geomCache.set(key, g); } return g; };
  const epsMid = 1.3 * sc;
  const quickBytes = g => { let b = 0; for (const cp of g.comps) { for (const ct of [cp.outer, ...cp.holes]) { const segs = fitContour(ct, epsMid); b += encodeContour(ct, segs, bb.x0, bb.y0, 1 / epsMid).s.length; } } return b + 30; };
  const layerBytes = (order, p) => { const g = getGeom(order[p], order.slice(p + 1).slice().sort((a, b) => a - b)); if (g.qb == null) g.qb = quickBytes(g); return g.qb; };
  const totalBytes = order => { let s = 0; for (let p = 0; p < order.length; p++) s += layerBytes(order, p); return s; };
  const cands = [
    present.slice().sort((a, b) => st[b].thick - st[a].thick),
    present.slice().sort((a, b) => st[b].area - st[a].area),
    present.slice().sort((a, b) => (st[b].tE / st[b].per) - (st[a].tE / st[a].per) || st[b].area - st[a].area)
  ].map(part);
  let order = cands[0], best = Infinity;
  const tooBig = W * H * present.length > 4.5e7;
  for (const c of (tooBig ? cands.slice(0, 1) : cands)) { const b = totalBytes(c); if (b < best) { best = b; order = c.slice(); } }
  if (present.length <= 14 && !tooBig) {
    for (let pass = 0; pass < 2; pass++) { let imp = false;
      for (let i = 0; i < order.length - 1; i++) { let o2 = order.slice(); [o2[i], o2[i + 1]] = [o2[i + 1], o2[i]]; o2 = part(o2); const b = totalBytes(o2); if (b < best - 8) { best = b; order = o2; imp = true; } progress('Layer order', 0.05 + 0.25 * (pass * order.length + i) / (2 * order.length)); }
      if (!imp) break; }
  }
  const geoms = order.map((c, p) => getGeom(c, order.slice(p + 1).sort((a, b) => a - b)));

  // ── error targets
  const aMax = 380, aw = Math.max(8, Math.round(bw >= bh ? aMax : aMax * bw / bh)), ah = Math.max(8, Math.round(bh >= bw ? aMax : aMax * bh / bw));
  const T = makeTarget(fin, bb, aw, ah), TO = makeOrig(seg.rgba, W, bb, aw, ah, O.alphaThr || 128, fin.labels);

  // ── fitting for one epsilon: items per layer
  const fitAt = eps => {
    const g = Math.min(8, Math.max(0.12, 1.25 / eps)), vw = Math.max(1, Math.round(bw * g)), vh = Math.max(1, Math.round(bh * g));
    const layers = geoms.map((G, p) => {
      const c = order[p], hex = shortHex(fin.colors[c].hex), con = st[c].contrast;
      const items = G.comps.map(cp => {
        const so = fitContour(cp.outer, eps), o = encodeContour(cp.outer, so, bb.x0, bb.y0, g);
        const holes = cp.holes.map(h => { const sh = fitContour(h, eps), e = encodeContour(h, sh, bb.x0, bb.y0, g); return { s: e.s, nodes: e.nodes, imp: h.area * con, on: true, ct: h, segs: sh }; });
        return { s: o.s, nodes: o.nodes, imp: Math.max(cp.own, 1) * con, holes, on: true, ct: cp.outer, segs: so };
      });
      return { c, hex, grp: GRP[c], items };
    });
    return { eps, g, vw, vh, layers };
  };
  const head = (vw, vh) => `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}">`;
  const pOpen = hex => hex === '#000' ? '<path d="' : `<path fill="${hex}" d="`, pClose = '"/>', tail = '</svg>';
  const unitStr = it => it.s + it.holes.filter(h => h.on).map(h => h.s).join('');
  // sequential packing into N files; null if impossible
  const pack = (F, N) => {
    const H0 = head(F.vw, F.vh).length + tail.length, files = []; let cur = null;
    const newFile = () => { cur = { bytes: H0, layers: [] }; files.push(cur); };
    newFile(); cur.grp = F.layers.length ? F.layers[0].grp : 0;
    for (const L of F.layers) {
      const ov = pOpen(L.hex).length + pClose.length; let open = null;
      if (L.grp !== cur.grp) { if (cur.layers.length) { newFile(); if (files.length > N) return null; } cur.grp = L.grp; }   // “separate” group: separate files
      for (const it of L.items) { if (!it.on) continue; const s = unitStr(it), need = s.length + (open ? 0 : ov);
        if (cur.bytes + need > pBudget) { if (H0 + ov + s.length > pBudget) return { fail: 'item' }; newFile(); cur.grp = L.grp; open = null; if (files.length > N) return null; }
        if (!open) { open = { hex: L.hex, c: L.c, d: [], items: [] }; cur.layers.push(open); cur.bytes += ov; }
        open.d.push(s); open.items.push(it); cur.bytes += s.length; }
    }
    return files.length <= N ? files : null;
  };
  // greedy pruning by importance/byte until it fits in N files
  const solve = (F, N) => {
    for (const L of F.layers) for (const it of L.items) { it.on = true; for (const h of it.holes) h.on = true; }
    const H0 = head(F.vw, F.vh).length + tail.length;
    const units = []; let total = 0;
    for (const L of F.layers) { total += pOpen(L.hex).length + pClose.length; for (const it of L.items) { total += it.s.length; units.push({ it, h: null, v: it.imp / it.s.length }); for (const h of it.holes) { total += h.s.length; units.push({ it, h, v: h.imp / h.s.length }); } } }
    const cap = N * (pBudget - H0) - (N - 1) * 40; let pruned = 0, prunedImp = 0, ui = 0;
    units.sort((a, b) => a.v - b.v);
    const drop = () => { while (ui < units.length) { const u = units[ui++]; if (!u.it.on) continue; if (u.h) { if (!u.h.on) continue; u.h.on = false; total -= u.h.s.length; prunedImp += u.h.imp; } else { u.it.on = false; total -= u.it.s.length; for (const h of u.it.holes) if (h.on) total -= h.s.length; prunedImp += u.it.imp; } pruned++; return true; } return false; };
    while (total > cap) if (!drop()) break;
    let files = pack(F, N), guard = 0;
    while ((!files || files.fail) && guard++ < 100000) { if (!drop()) return null; files = pack(F, N); }
    return files && !files.fail ? { files, pruned, prunedImp } : null;
  };
  const renderOf = (F) => { const ls = []; for (const L of F.layers) { const d = L.items.filter(i => i.on).map(unitStr).join(''); ls.push({ hex: L.hex, d }); } return ls; };
  const evalSol = (F, sol) => { const R = renderPaths(renderOf(F), F.vw, F.vh, aw, ah), e = errorOf(R, T); return { err: e, score: scoreOf(e) }; };

  progress('Looking for the best trade-off', 0.3);
  const EPS = [0.32, 0.45, 0.62, 0.82, 1.05, 1.35, 1.75, 2.25, 2.9, 3.7, 4.8, 6.2].map(e => e * sc), fits = [];
  for (let i = 0; i < EPS.length; i++) { fits.push(fitAt(EPS[i])); progress('Fitting curves', 0.3 + 0.35 * (i + 1) / EPS.length); }
  const bestFor = N => {
    let bestR = null;
    const all = [];
    for (const F of fits) { const sol = solve(F, N); if (!sol) continue; const ev = evalSol(F, sol); all.push({ F, sol, ...ev, N }); }
    for (const r of all) if (!bestR || r.err.mean < bestR.err.mean) bestR = r;
    // at nearly equal error, prefer smoother curves (less noise, fewer bytes)
    if (bestR && O.preferSmooth !== false) { const lim = bestR.err.mean * 1.04 + 0.0002; for (const r of all) if (r.err.mean <= lim && r.F.eps > bestR.F.eps && !r.sol.pruned) bestR = r; }
    if (bestR) { // refine around the best epsilon
      const i = EPS.indexOf(bestR.F.eps);
      for (const e of [i > 0 ? (EPS[i - 1] + EPS[i]) / 2 : null, i < EPS.length - 1 ? (EPS[i + 1] + EPS[i]) / 2 : null]) { if (!e) continue; const F = fitAt(e), sol = solve(F, N); if (!sol) continue; const ev = evalSol(F, sol); if (ev.err.mean < bestR.err.mean) bestR = { F, sol, ...ev, N }; }
    }
    return bestR;
  };
  let res = null; const maxF = Math.max(1, Math.min(12, O.maxFiles || 6));
  const minN = hasG ? 2 : 1;   // separate colors: at least one file for them and one for the rest
  if (O.mode === 'single') res = bestFor(minN);
  else if (O.mode === 'fixed') res = bestFor(Math.max(minN, Math.min(12, O.files || 2)));
  else {
    // quality ceiling: finest epsilon without pruning
    const F0 = fits[0]; for (const L of F0.layers) for (const it of L.items) { it.on = true; for (const h of it.holes) h.on = true; }
    const ceil = scoreOf(errorOf(renderPaths(renderOf(F0), F0.vw, F0.vh, aw, ah), T));
    const target = Math.min(O.target || 96, ceil - 0.4); let prev = null;
    for (let N = minN; N <= Math.max(maxF, minN); N++) {
      progress('Trying ' + N + ' file' + (N > 1 ? 's' : ''), 0.7 + 0.28 * N / maxF);
      const r = bestFor(N); if (!r) continue;
      if (r.score >= target) { res = r; break; }
      if (prev && r.score - prev.score < (target >= 94 ? 0.12 : 0.35)) { res = prev; break; }   // maximum quality: keep going while one more file really helps
      prev = r; res = r;
    }
  }
  if (!res) return { files: [], error: 'Cannot fit in the budget: reduce the colors or increase the minimum detail.' };
  // ── re-centering: the final frame hugs the shapes actually kept (a pruned speck near an edge
  //    no longer shifts the drawing); in GT7 the decal is then centered on the drawing itself
  let F = res.F, packed = res.sol.files, crop = { x: bb.x0, y: bb.y0, w: bw, h: bh };
  {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const L of F.layers) for (const it of L.items) { if (!it.on) continue; const X = it.ct.X, Y = it.ct.Y;
      for (let i = 0; i < X.length; i++) { if (X[i] < x0) x0 = X[i]; if (X[i] > x1) x1 = X[i]; if (Y[i] < y0) y0 = Y[i]; if (Y[i] > y1) y1 = Y[i]; } }
    if (x1 > x0 && y1 > y0) {
      const nx = Math.max(bb.x0, Math.floor(x0)), ny = Math.max(bb.y0, Math.floor(y0)), nw = Math.min(bb.x0 + bw, Math.ceil(x1)) - nx, nh = Math.min(bb.y0 + bh, Math.ceil(y1)) - ny;
      if (nw > 0 && nh > 0 && (nx !== bb.x0 || ny !== bb.y0 || nw !== bw || nh !== bh)) {
        const g = F.g, F2 = { eps: F.eps, g, vw: Math.max(1, Math.round(nw * g)), vh: Math.max(1, Math.round(nh * g)),
          layers: F.layers.map(L => ({ c: L.c, hex: L.hex, grp: L.grp, items: L.items.map(it => ({ ...it, s: encodeContour(it.ct, it.segs, nx, ny, g).s,
            holes: it.holes.map(h => ({ ...h, s: encodeContour(h.ct, h.segs, nx, ny, g).s })) })) })) };
        const N = res.sol.files.length, p2 = pack(F2, N);
        if (p2 && !p2.fail) { F = F2; packed = p2; crop = { x: nx, y: ny, w: nw, h: nh }; }
      }
    }
  }
  // ── gradients (option): each shape whose original pixels show a regular color change
  //    gets a gradient instead of its flat color; GT7 displays them. Direction: the one where
  //    lightness changes the most (least squares), ends at the extreme percentiles of the projection.
  const gradCache = new Map();
  const gradFor = (c, it) => {
    const X = it.ct.X, Y = it.ct.Y; let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let i = 0; i < X.length; i++) { if (X[i] < x0) x0 = X[i]; if (X[i] > x1) x1 = X[i]; if (Y[i] < y0) y0 = Y[i]; if (Y[i] > y1) y1 = Y[i]; }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
    const key = c + ':' + x0 + ':' + y0 + ':' + x1 + ':' + y1; if (gradCache.has(key)) return gradCache.get(key);
    const L = fin.labels, R = seg.rgba, ps = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const p = y * W + x; if (L[p] === c && R[p * 4 + 3] >= 128) ps.push(p); }
    const n = ps.length, lum = p => 0.3 * R[p * 4] + 0.59 * R[p * 4 + 1] + 0.11 * R[p * 4 + 2];
    // color curve along the gradient (mean per slice), then as few stops as possible to follow it;
    // the mean deviation from the result is used to choose between straight and round
    const curve = ts => {
      const srt = ts.slice().sort(), ta = srt[Math.floor(n * 0.002)], tb = srt[Math.floor(n * 0.998)]; if (!(tb - ta >= 6)) return null;   // ends kept: the white of a center or a corner only covers a few pixels
      const B = 32, acc = new Float64Array(B * 4);
      for (let i = 0; i < n; i++) { const t = ts[i]; if (t < ta || t > tb) continue; const b = Math.min(B - 1, Math.floor((t - ta) / (tb - ta) * B)), q = ps[i] * 4;
        acc[b * 4] += R[q]; acc[b * 4 + 1] += R[q + 1]; acc[b * 4 + 2] += R[q + 2]; acc[b * 4 + 3]++; }
      const pts = []; for (let b = 0; b < B; b++) { const m = acc[b * 4 + 3]; if (m >= 4) pts.push([(b + 0.5) / B, acc[b * 4] / m, acc[b * 4 + 1] / m, acc[b * 4 + 2] / m]); }
      if (pts.length < 3) return null;
      // a slice gives the color of its middle: the first and last stops are extended to the edge of their slice
      // (otherwise the pure white of a center or corner ends up pinkish or bluish)
      for (const [e, f, s] of [[0, 1, -1], [pts.length - 1, pts.length - 2, 1]]) { const a = pts[e], b = pts[f];
        if (Math.abs(a[0] - b[0]) > 1.5 / B) continue; a[0] += s * 0.5 / B; for (let ch = 1; ch <= 3; ch++) a[ch] = Math.max(0, Math.min(255, a[ch] + (a[ch] - b[ch]) * 0.5)); }
      const o0 = pts[0][0], o1 = pts[pts.length - 1][0]; for (const q of pts) q[0] = (q[0] - o0) / (o1 - o0);
      let d = 0; for (let ch = 1; ch <= 3; ch++) { let lo = 255, hi = 0; for (const q of pts) { lo = Math.min(lo, q[ch]); hi = Math.max(hi, q[ch]); } d = Math.max(d, hi - lo); }
      if (d < 10) return null;
      let keep; for (let tol = 3; ; tol += 1.5) { keep = simplifyStops(pts, tol); if (keep.length <= 6) break; }
      const tA = ta + o0 * (tb - ta), tB = ta + o1 * (tb - ta); let err = 0, m = 0;
      for (let i = 0; i < n; i += 4) { const u = Math.max(0, Math.min(1, (ts[i] - tA) / (tB - tA || 1))); let j = 1; while (j < keep.length - 1 && keep[j][0] < u) j++;
        const a = keep[j - 1], b = keep[j], v = Math.max(0, Math.min(1, (u - a[0]) / (b[0] - a[0] || 1))), q = ps[i] * 4;
        err += Math.max(Math.abs(R[q] - (a[1] + (b[1] - a[1]) * v)), Math.abs(R[q + 1] - (a[2] + (b[2] - a[2]) * v)), Math.abs(R[q + 2] - (a[3] + (b[3] - a[3]) * v))); m++; }
      return { tA, tB, keep, err: err / Math.max(1, m) }; };
    let out = null;
    if (n >= 300) {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sl = 0, sxl = 0, syl = 0;
      for (const p of ps) { const x = p % W, y = (p / W) | 0, l = lum(p); sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sl += l; sxl += x * l; syl += y * l; }
      const mx = sx / n, my = sy / n, ml = sl / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my, cxl = sxl / n - mx * ml, cyl = syl / n - my * ml, det = cxx * cyy - cxy * cxy;
      let lin = null, rad = null;
      if (det > 1e-6) { const bx = (cyy * cxl - cxy * cyl) / det, by = (cxx * cyl - cxy * cxl) / det, gm = Math.hypot(bx, by);
        if (gm > 1e-4) { const ux = bx / gm, uy = by / gm, ts = new Float32Array(n); for (let i = 0; i < n; i++) ts[i] = (ps[i] % W - mx) * ux + (((ps[i] / W) | 0) - my) * uy;
          const k = curve(ts); if (k) lin = { n, p0: [mx + k.tA * ux, my + k.tA * uy], p1: [mx + k.tB * ux, my + k.tB * uy], stops: k.keep.map(q => [q[0], [q[1], q[2], q[3]]]), err: k.err }; } }
      // round gradient (glow, round shadow): center by least squares, stops along the radius
      const cc = radialCenter(n, i => ps[i] % W, i => (ps[i] / W) | 0, i => lum(ps[i]));
      if (cc) { const ts = new Float32Array(n); for (let i = 0; i < n; i++) ts[i] = Math.hypot(ps[i] % W - cc[0], ((ps[i] / W) | 0) - cc[1]);
        const k = curve(ts); if (k && k.tB > 1) rad = { n, rad: 1, c: cc, r: k.tB, stops: k.keep.map(q => [(k.tA + q[0] * (k.tB - k.tA)) / k.tB, [q[1], q[2], q[3]]]), err: k.err }; }
      out = rad && (!lin || rad.err < lin.err * 0.8) ? rad : lin;
      // visual gain (flat deviation minus gradient deviation, × area): under budget pressure, the least useful gradients go first
      if (out) { let mr = 0, mg = 0, mb = 0; for (const p of ps) { mr += R[p * 4]; mg += R[p * 4 + 1]; mb += R[p * 4 + 2]; } mr /= n; mg /= n; mb /= n;
        let e0 = 0, m = 0; for (let i = 0; i < n; i += 4) { const q = ps[i] * 4; e0 += Math.max(Math.abs(R[q] - mr), Math.abs(R[q + 1] - mg), Math.abs(R[q + 2] - mb)); m++; }
        out.gain = n * Math.max(0.5, e0 / m - out.err); }
    }
    gradCache.set(key, out); return out;
  };
  const hx = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  const num = v => (Math.round(v * 10) / 10).toString();
  const off = v => v <= 0 ? '0' : v >= 1 ? '1' : (Math.round(v * 100) / 100).toString().replace(/^0/, '');
  const gradDef = (id, gr) => { const P = q => [(q[0] - crop.x) * F.g, (q[1] - crop.y) * F.g], st = gr.stops.map(([o, c]) => `<stop offset="${off(o)}" stop-color="#${hx(c[0])}${hx(c[1])}${hx(c[2])}"/>`).join('');
    if (gr.rad) { const c = P(gr.c); return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(c[0])}" cy="${num(c[1])}" r="${num(gr.r * F.g)}">` + st + '</radialGradient>'; }
    const a = P(gr.p0), b = P(gr.p1);
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}">` +
      gr.stops.map(([o, c]) => `<stop offset="${off(o)}" stop-color="#${hx(c[0])}${hx(c[1])}${hx(c[2])}"/>`).join('') + '</linearGradient>'; };
  const build = (f, skip) => {
    let defs = '', body = '', gid = 0; const used = [];
    for (const l of f.layers) {
      if (!O.gradients || !l.items) { body += pOpen(l.hex) + l.d.join('') + pClose; continue; }
      const flat = [];
      l.items.forEach((it, k) => { const gr = skip.has(it) ? null : gradFor(l.c, it);
        if (!gr) { flat.push(l.d[k]); return; } const id = 'g' + (gid++).toString(36); defs += gradDef(id, gr); used.push({ it, n: gr.gain || gr.n });
        body += `<path fill="url(#${id})" d="` + l.d[k] + pClose; });
      if (flat.length) body += pOpen(l.hex) + flat.join('') + pClose;
    }
    return { svg: head(F.vw, F.vh) + (defs ? '<defs>' + defs + '</defs>' : '') + body + tail, used };
  };
  // ── final serialization
  let nGrad = 0;
  const files = packed.map((f, i) => {
    const skip = new Set(); let b = build(f, skip), bytes = new TextEncoder().encode(b.svg).length;
    while (bytes > budget && b.used.length) { b.used.sort((u, v) => u.n - v.n); skip.add(b.used[0].it); b = build(f, skip); bytes = new TextEncoder().encode(b.svg).length; }   // too heavy: remove small gradients first
    nGrad += b.used.length;
    return { svg: b.svg, bytes, colors: [...new Set(f.layers.map(l => l.hex))], grp: hasG ? (f.grp || 0) : null };
  });
  const RO = renderPaths(renderOf(res.F), res.F.vw, res.F.vh, aw, ah), eo = errorOf(RO, TO), scoreO = Math.max(0, Math.min(100, 100 - 520 * eo.mean - 60 * eo.bad));
  let nodes = 0, kept = 0, total = 0; for (const L of F.layers) for (const it of L.items) { total++; if (it.on) { kept++; nodes += it.nodes; for (const h of it.holes) if (h.on) nodes += h.nodes; } }
  return {
    files, vw: F.vw, vh: F.vh, eps: F.eps / sc, score: res.score, scoreOrig: scoreO, errEdge: res.err.edge, errMean: res.err.mean, nodes, shapes: kept, shapesTotal: total, pruned: res.sol.pruned,
    order: order.map(c => fin.colors[c].hex), crop, specks, gradients: nGrad, ms: Date.now() - t0
  };
}

return { segment, optimize, applyOps, hexOf, rgbOfHex, labOfHex, fromLab, _d: { traceMask, prepContour, fitContour, encodeContour, signedArea } };
})();
if (typeof module !== 'undefined') module.exports = Vektor;
