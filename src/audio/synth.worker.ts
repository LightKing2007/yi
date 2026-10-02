/**
 * 在后台线程里合成全部音效与两段背景音乐（不使用任何音频素材）：
 *   落子、悔棋（倒吸的风声接倒放的落子声）、棋罐滑动、界面轻响、
 *   五子棋胜利与围棋终局（太鼓、低音合成器“轰——”、合唱、金属的“锵”、空气声、高音弦，立体声大厅混响）、
 *   菜单与对局两段五声音阶的背景音乐（古筝般的拨弦 + 和声垫底，48 秒无缝循环）
 */
const WIN_HIT = 0.15,
  WIN_STAGGER = 0.075,
  RW_RING_BASE = 0.3;
const TAU = 6.2832;

export interface SynthOut {
  id: string;
  sr: number;
  l: Float32Array;
  r: Float32Array | null;
}

class Lcg {
  constructor(public s: number) {}
  noise() {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return (this.s >>> 9) / 4194304 - 1;
  }
  u01() {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return (this.s >>> 8) / 16777216;
  }
}

/** Schroeder 混响（4 个梳状 + 2 个全通）；spread 让左右声道的延时略有不同 */
function reverb(x: Float32Array, sr: number, mix: number, room: number, spread: number) {
  const n = x.length,
    wet = new Float32Array(n);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const len = Math.floor(((ms * sr) / 1000) * spread),
      buf = new Float32Array(len);
    let lp = 0;
    for (let i = 0, p = 0; i < n; i++, p = (p + 1) % len) {
      const y = buf[p];
      lp += (y - lp) * 0.45;
      buf[p] = x[i] + lp * room;
      wet[i] += y * 0.25;
    }
  }
  for (const ms of [5.0, 1.7]) {
    const len = Math.floor(((ms * sr) / 1000) * spread),
      buf = new Float32Array(len);
    for (let i = 0, p = 0; i < n; i++, p = (p + 1) % len) {
      const bb = buf[p],
        y = -wet[i] * 0.5 + bb;
      buf[p] = wet[i] + bb * 0.5;
      wet[i] = y;
    }
  }
  for (let i = 0; i < n; i++) x[i] = x[i] * (1 - mix * 0.4) + wet[i] * mix;
}

/** 结尾淡出、软限幅（tanh） */
function finish(l: Float32Array, r: Float32Array | null, sr: number, gain: number) {
  const n = l.length,
    fade = Math.min(sr / 3, n / 4 + 1),
    k = 31000 / 32768;
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    l[i] = Math.tanh(l[i] * gain) * k * f * f;
    if (r) r[i] = Math.tanh(r[i] * gain) * k * f * f;
  }
}

function pan(L: Float32Array, R: Float32Array, i: number, v: number, p: number) {
  const th = (p + 1) * 0.785398;
  L[i] += v * Math.cos(th);
  R[i] += v * Math.sin(th);
}

/** 太鼓：音高从 f1 急降到 f0 的正弦，过饱和 */
function taiko(u: number, f0: number, f1: number, ph: { v: number }, sr: number) {
  if (u < 0) return 0;
  ph.v += (TAU * (f0 + (f1 - f0) * Math.exp(-u * 22))) / sr;
  const body = Math.sin(ph.v) * Math.exp(-u * 3);
  return Math.tanh(body * 2.2) * 0.8 + Math.sin(ph.v * 2) * Math.exp(-u * 12) * 0.25;
}

/** 低音合成器的“轰——”：锯齿波强力和弦，过饱和，低通猛地打开再慢慢合上；左右失谐方向相反 */
function braam(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  start: number,
  attack: number,
  decay: number,
  notes: number[],
  cutPeak: number,
  cutEnd: number,
  gain: number,
) {
  const n = L.length,
    det = [0.993, 1.0, 1.007],
    ph = notes.map(() => [0, 0, 0, 0, 0, 0]),
    f1 = [0, 0],
    f2 = [0, 0];
  for (let i = Math.floor(start * sr); i < n; i++) {
    const u = i / sr - start;
    const env = Math.min(1, u / attack) * Math.exp(-u * decay);
    const cut = cutEnd + (cutPeak - cutEnd) * Math.min(1, u / (attack * 0.6 + 0.02)) * Math.exp(-u * 0.9);
    const k = 1 - Math.exp((-TAU * cut) / sr);
    for (let c = 0; c < 2; c++) {
      let v = 0;
      for (let m = 0; m < notes.length; m++)
        for (let j = 0; j < 3; j++) {
          const q = ph[m];
          q[c * 3 + j] += (notes[m] * (c ? det[2 - j] : det[j])) / sr;
          if (q[c * 3 + j] >= 1) q[c * 3 + j] -= 1;
          v += q[c * 3 + j] * 2 - 1;
        }
      v = Math.tanh(v * 0.55);
      f1[c] += (v - f1[c]) * k;
      f2[c] += (f1[c] - f2[c]) * k;
      (c ? R : L)[i] += f2[c] * env * gain;
    }
  }
}

/** 合唱般的“啊——”：锯齿波和弦加颤音，经过两个带通共振峰（约 700 / 1150 Hz） */
function choir(L: Float32Array, R: Float32Array, sr: number, start: number, attack: number, decay: number, notes: number[], gain: number) {
  const n = L.length,
    fc = [700, 1150],
    q = 0.35,
    ph = notes.map(() => [0, 0]),
    lo = [
      [0, 0],
      [0, 0],
    ],
    bd = [
      [0, 0],
      [0, 0],
    ];
  for (let i = Math.floor(start * sr); i < n; i++) {
    const u = i / sr - start,
      env = Math.min(1, u / attack) * Math.exp(-Math.max(u - attack, 0) * decay);
    for (let c = 0; c < 2; c++) {
      let v = 0;
      const vib = 1 + 0.004 * Math.sin(TAU * (5 + 0.4 * c) * u);
      for (let m = 0; m < notes.length; m++) {
        ph[m][c] += (notes[m] * vib * (c ? 1.004 : 0.996)) / sr;
        if (ph[m][c] >= 1) ph[m][c] -= 1;
        v += ph[m][c] * 2 - 1;
      }
      let out = 0;
      for (let k = 0; k < 2; k++) {
        const f = 2 * Math.sin((Math.PI * fc[k]) / sr);
        lo[c][k] += f * bd[c][k];
        const hi = v - lo[c][k] - q * bd[c][k];
        bd[c][k] += f * hi;
        out += bd[c][k] * (k ? 0.7 : 1);
      }
      (c ? R : L)[i] += out * env * gain;
    }
  }
}

/** 冲击时一声明亮的金属“锵” */
function shing(L: Float32Array, R: Float32Array, sr: number, start: number, gain: number) {
  const f = [2960, 3870, 4730, 5910, 7340, 8810];
  for (let i = Math.floor(start * sr); i < L.length; i++) {
    const u = i / sr - start;
    if (u > 1.6) break;
    let l = 0,
      r = 0;
    for (let k = 0; k < 6; k++) {
      const e = (Math.exp(-u * (2.5 + 1.2 * k)) * Math.min(1, u / 0.001)) / (1 + 0.3 * k);
      l += e * Math.sin(TAU * f[k] * u);
      r += e * Math.sin(TAU * f[k] * 1.003 * u + 0.7);
    }
    L[i] += l * gain;
    R[i] += r * gain;
  }
}

/** 空气感的“嘶——”：高通噪声随冲击涌起后慢慢散去 */
function air(L: Float32Array, R: Float32Array, sr: number, start: number, attack: number, decay: number, gain: number, rs: Lcg) {
  const lp = [0, 0],
    lp2 = [0, 0];
  for (let i = Math.floor(start * sr); i < L.length; i++) {
    const u = i / sr - start,
      env = Math.min(1, u / attack) * Math.exp(-Math.max(u - attack, 0) * decay);
    for (let c = 0; c < 2; c++) {
      const nz = rs.noise();
      lp[c] += (nz - lp[c]) * 0.55;
      lp2[c] += (lp[c] - lp2[c]) * 0.12;
      (c ? R : L)[i] += (lp[c] - lp2[c]) * env * gain;
    }
  }
}

/** 弦乐般的长音（正弦加颤音，两个声部一左一右） */
function strings(L: Float32Array, R: Float32Array, sr: number, start: number, attack: number, decay: number, notes: number[], gain: number) {
  for (let i = Math.floor(start * sr); i < L.length; i++) {
    const u = i / sr - start,
      env = Math.min(1, u / attack) * Math.exp(-Math.max(u - attack, 0) * decay);
    if (env < 1e-4 && u > attack) break;
    let l = 0,
      r = 0;
    notes.forEach((f, m) => {
      const vib = 0.003 * Math.sin(TAU * 5.5 * u + m);
      l += Math.sin(TAU * f * (1 + vib) * u * 0.999) + 0.25 * Math.sin(TAU * f * 2 * u);
      r += Math.sin(TAU * f * (1 + vib) * u * 1.001 + 0.4) + 0.25 * Math.sin(TAU * f * 2 * u + 0.9);
    });
    L[i] += l * env * gain;
    R[i] += r * env * gain;
  }
}

/** 五子棋胜利：吸气渐强 → 冲击（太鼓、次低音、土石声、余震）→ 五声低沉的钟 → 呼啸从左扫到右 → 低音铺底 */
function synthWin(sr: number, rs: Lcg): SynthOut {
  const H = WIN_HIT,
    n = Math.floor(sr * 5.5),
    L = new Float32Array(n),
    R = new Float32Array(n);
  const bells = [196, 220, 261.63, 293.66, 329.63];
  const ph1 = { v: 0 },
    ph2 = { v: 0 };
  let sub = 0,
    lpN = 0,
    lpA = 0,
    lpB = 0,
    bp1 = 0,
    bp2 = 0,
    sw1 = 0,
    sw2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr,
      u = t - H,
      nz = rs.noise();
    let c = 0;
    if (u < 0) {
      const k = t / H,
        cut = 0.01 + 0.08 * k * k;
      sw1 += (nz - sw1) * cut;
      sw2 += (sw1 - sw2) * cut;
      c += sw2 * 6 * k * k * k;
    }
    c += taiko(u, 44, 150, ph1, sr) * 1.1;
    c += taiko(u - 0.13, 38, 120, ph2, sr) * 0.8;
    if (u >= 0) {
      sub += (TAU * 36.7) / sr;
      c += Math.sin(sub) * Math.exp(-u * 0.9) * 0.5 * Math.min(1, u / 0.01);
    }
    lpN += (nz - lpN) * 0.08;
    if (u >= 0) c += lpN * Math.exp(-u * 14) * 2;
    lpA += (nz - lpA) * 0.012;
    lpB += (lpA - lpB) * 0.012;
    if (u >= 0) c += lpB * 11 * Math.min(1, u / 0.04) * Math.exp(-u * 1.1);
    for (let k = 0; k < 5; k++) {
      const v = u - k * WIN_STAGGER;
      if (v < 0) continue;
      const env = Math.min(1, v / 0.003) * Math.exp(-v * 1.4),
        f = bells[k];
      const bell =
        env * 0.16 * (Math.sin(TAU * f * v) + 0.3 * Math.sin(TAU * f * 2 * v) * Math.exp(-v * 3) + 0.15 * Math.sin(TAU * f * 2.76 * v) * Math.exp(-v * 5));
      pan(L, R, i, bell, -0.5 + 0.25 * k);
    }
    if (u > 0.03) {
      const fc = 0.015 + 0.05 * Math.exp(-u * 1.4);
      bp1 += (nz - bp1) * fc;
      bp2 += (bp1 - bp2) * fc;
      const wh = (bp1 - bp2) * 3 * Math.min(1, (u - 0.03) / 0.2) * Math.exp(-Math.max(u - 0.4, 0) * 1.8);
      pan(L, R, i, wh, -0.8 + 1.6 * Math.min(1, u / 1.4));
    }
    L[i] += c;
    R[i] += c;
  }
  braam(L, R, sr, H, 0.03, 0.55, [73.42, 110, 146.83], 1500, 220, 0.4);
  braam(L, R, sr, H + 0.9, 1.2, 0.45, [36.71, 73.42], 420, 160, 0.38);
  braam(L, R, sr, H + 0.02, 0.06, 1.1, [146.83, 220, 293.66, 440], 2600, 700, 0.16);
  choir(L, R, sr, H + 0.25, 0.9, 0.85, [293.66, 369.99, 440, 587.33], 0.11);
  shing(L, R, sr, H, 0.14);
  air(L, R, sr, H, 0.08, 1.3, 0.55, rs);
  strings(L, R, sr, H + 0.35, 0.8, 1.1, [1174.66, 1760], 0.022);
  reverb(L, sr, 0.45, 0.86, 1.6);
  reverb(R, sr, 0.45, 0.86, 1.67);
  finish(L, R, sr, 0.8);
  return { id: 'win', sr, l: L, r: R };
}

/** 围棋终局：两记闷鼓，低沉的寺院大钟与慢慢绽开的大锣，渐强的“轰——”，风声从左扫到右 */
function synthGoEnd(sr: number, rs: Lcg): SynthOut {
  const n = Math.floor(sr * 6),
    L = new Float32Array(n),
    R = new Float32Array(n);
  const part = [0.5, 1.0, 1.19, 1.56, 2.0, 2.51, 2.97, 3.76],
    amp = [0.6, 0.5, 0.3, 0.22, 0.16, 0.09, 0.06, 0.04],
    dec = [0.28, 0.42, 0.7, 0.9, 1.3, 1.9, 2.6, 3.4];
  const gong = [1.0, 1.47, 1.83, 2.21, 2.66, 3.02, 3.55, 4.13, 4.87, 5.52];
  const f0 = 110,
    g0 = 55,
    ph1 = { v: 0 },
    ph2 = { v: 0 };
  let b1 = 0,
    b2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr,
      nz = rs.noise();
    let c = taiko(t, 40, 140, ph1, sr) * 1.1 + taiko(t - 0.15, 36, 115, ph2, sr) * 0.85;
    const tb = t - 0.06;
    if (tb > 0) {
      const strike = Math.min(1, tb / 0.002);
      let bl = 0,
        br = 0;
      for (let k = 0; k < 8; k++) {
        const e = amp[k] * Math.exp(-tb * dec[k]) * Math.sin(TAU * f0 * part[k] * tb);
        bl += e * (1 + 0.28 * Math.sin(TAU * (0.7 + 0.3 * k) * tb));
        br += e * (1 + 0.28 * Math.sin(TAU * (0.9 + 0.3 * k) * tb + 1.3));
      }
      L[i] += bl * strike * 0.6;
      R[i] += br * strike * 0.6;
      let gl = 0,
        gr = 0;
      for (let k = 0; k < 10; k++) {
        const bloom = Math.min(1, tb / (0.3 + 0.1 * k)),
          e = (bloom * bloom * Math.exp(-tb * (0.5 + 0.15 * k))) / (1 + 0.5 * k);
        gl += e * Math.sin(TAU * g0 * gong[k] * tb * 0.998);
        gr += e * Math.sin(TAU * g0 * gong[k] * tb * 1.002 + 0.5);
      }
      L[i] += gl * 0.3;
      R[i] += gr * 0.3;
    }
    const fc = 0.01 + 0.04 * Math.exp(-t * 0.9);
    b1 += (nz - b1) * fc;
    b2 += (b1 - b2) * fc;
    pan(L, R, i, (b1 - b2) * 2.6 * Math.min(1, t / 0.25) * Math.exp(-t * 0.9), -0.8 + 1.6 * Math.min(1, t / 1.6));
    L[i] += c;
    R[i] += c;
  }
  braam(L, R, sr, 0, 0.35, 0.45, [65.41, 98, 130.81], 1100, 180, 0.42);
  choir(L, R, sr, 0.4, 1.1, 0.8, [261.63, 329.63, 392, 523.25], 0.11);
  shing(L, R, sr, 0.06, 0.11);
  air(L, R, sr, 0, 0.5, 1.0, 0.5, rs);
  strings(L, R, sr, 0.6, 1.0, 1.0, [1046.5, 1568], 0.02);
  reverb(L, sr, 0.5, 0.87, 1.6);
  reverb(R, sr, 0.5, 0.87, 1.67);
  finish(L, R, sr, 0.8);
  return { id: 'goend', sr, l: L, r: R };
}

/** 界面切换的轻响：像木珠在木槽里轻轻一拨 */
function synthTick(sr: number, rs: Lcg): SynthOut {
  const n = Math.floor(sr * 0.07),
    x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const click = rs.noise() * Math.exp(-t * 1600) * 0.6;
    const wood =
      Math.exp(-t * 95) * (0.45 * Math.sin(TAU * 1850 * t) + 0.22 * Math.sin(TAU * 2900 * t + 0.7)) + Math.exp(-t * 55) * 0.25 * Math.sin(TAU * 640 * t);
    x[i] = click + wood;
  }
  finish(x, null, sr, 0.7);
  return { id: 'tick', sr, l: x, r: null };
}

function synthBasic(sr: number, rs: Lcg): SynthOut[] {
  // 落子：木质的“嗒”
  const n = Math.floor(sr * 0.11),
    clack = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr,
      nz = rs.noise();
    const body = Math.exp(-t * 70) * (0.55 * Math.sin(TAU * 2150 * t) + 0.3 * Math.sin(TAU * 3420 * t + 1.1) + 0.22 * Math.sin(TAU * 1180 * t));
    const wood = Math.exp(-t * 38) * 0.25 * Math.sin(TAU * 420 * t);
    const click = Math.exp(-t * 900) * nz * 0.8;
    clack[i] = Math.max(-1, Math.min(1, (body + wood + click) * 0.55)) * (32000 / 32768);
  }
  // 悔棋音：渐强的“倒吸”风声，在涟漪收拢的一刻接上倒放的落子声
  const hit = Math.floor(sr * RW_RING_BASE),
    rn = hit + Math.floor(sr * 0.1),
    rew = new Float32Array(rn);
  let lp1 = 0,
    lp2 = 0;
  for (let i = 0; i < rn; i++) {
    const t = i / sr,
      tr = t / RW_RING_BASE,
      nz = rs.noise();
    const cut = 0.02 + 0.25 * Math.min(tr, 1) ** 2;
    lp1 += (nz - lp1) * cut;
    lp2 += (lp1 - lp2) * cut;
    const env = i < hit ? Math.pow(tr, 2.5) : Math.exp(-(t - RW_RING_BASE) * 40);
    let v = lp2 * env * 0.9;
    const j = i - (hit - n);
    if (j >= 0 && j < n) v += clack[n - 1 - j] * 0.8;
    rew[i] = Math.tanh(v) * (30000 / 32768);
  }
  // 棋罐移动：提起时木头的一声闷响，随后木底在盘面上滑动的摩擦声，罐里棋子相互碰撞的轻响
  const bn = Math.floor(sr * 1.25),
    acc = new Float32Array(bn);
  let b1 = 0,
    b2 = 0,
    grain = 0;
  for (let i = 0; i < bn; i++) {
    const t = i / sr,
      nz = rs.noise();
    b1 += (nz - b1) * 0.12;
    b2 += (b1 - b2) * 0.12;
    if ((i & 255) === 0) grain = 0.6 + 0.4 * rs.u01();
    const slide = (b1 - b2) * 2.2 * Math.min(1, t / 0.18) * Math.exp(-Math.max(0, t - 0.35) * 3.2) * grain;
    const knock = Math.exp(-t * 38) * (0.7 * Math.sin(TAU * 165 * t) + 0.3 * Math.sin(TAU * 310 * t));
    acc[i] += slide * 0.55 + knock * 0.6;
  }
  for (let k = 0; k < 14; k++) {
    const r1 = rs.u01(),
      at = Math.floor(sr * (0.04 + 0.75 * r1 * r1));
    const f = 2400 + 1600 * rs.u01(),
      amp = 0.08 + 0.18 * rs.u01();
    for (let i = 0; i < Math.floor(sr * 0.04) && at + i < bn; i++) {
      const t = i / sr;
      acc[at + i] += amp * Math.exp(-t * 150) * (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 1.63 * t));
    }
  }
  for (let i = 0; i < bn; i++) acc[i] = Math.tanh(acc[i]) * (30000 / 32768);
  return [
    { id: 'clack', sr, l: clack, r: null },
    { id: 'rewind', sr, l: rew, r: null },
    { id: 'bowl', sr, l: acc, r: null },
  ];
}

// ---------------- 背景音乐 ----------------
const MUS_SR = 32000,
  MUS_LEN = 48;
interface Style {
  bpm: number;
  density: number;
  gliss: number;
  pad: number;
  guqin: number;
  low: number;
  high: number;
  seed: number;
}

/** 五声音阶第 n 级（0 = D3）的频率 */
function penta(n: number) {
  const off = [0, 2, 4, 7, 9];
  const octave = Math.floor(n / 5),
    deg = ((n % 5) + 5) % 5;
  const midi = 50 + 12 * octave + off[deg];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 拨弦（Karplus-Strong）：bend>0 时从低 bend 个半音滑上来，起音后渐起的揉弦让余音微微颤动，像古筝 */
function pluck(L: Float32Array, R: Float32Array, rs: Lcg, t0: number, f: number, vel: number, p: number, bend: number, sustain: number) {
  const n = L.length,
    start = Math.floor(t0 * MUS_SR);
  if (start >= n) return;
  const M = Math.floor(MUS_SR / (f * 0.85)) + 4,
    line = new Float32Array(M),
    len = Math.floor(MUS_SR * sustain);
  const g = Math.pow(0.001, 1 / (sustain * f)),
    gl = 0.5 - 0.35 * p,
    gr = 0.5 + 0.35 * p;
  let prev = 0,
    lpn = 0;
  for (let i = 0; i < len && start + i < n; i++) {
    const t = i / MUS_SR;
    let fb = f * Math.pow(2, (-bend * Math.exp(-t * 14)) / 12);
    fb *= 1 + 0.0055 * Math.sin(TAU * 5.2 * t) * Math.min(1, Math.max(0, t - 0.25) * 2.5);
    const D = MUS_SR / fb,
      rp = i - D;
    let y = 0;
    if (rp >= 0) {
      const a = Math.floor(rp),
        u = rp - a;
      y = line[a % M] * (1 - u) + line[(a + 1) % M] * u;
    }
    let ex = 0;
    if (i < Math.floor(D)) {
      lpn += (rs.u01() * 2 - 1 - lpn) * (0.25 + 0.5 * vel);
      ex = lpn * vel;
    }
    const v = ex + g * 0.5 * (y + prev);
    prev = y;
    line[i % M] = v;
    const env = Math.min(1, t / 0.002);
    L[start + i] += v * env * gl;
    R[start + i] += v * env * gr;
  }
}

/** Freeverb 式混响：4 个带阻尼的梳状滤波 + 2 个全通 */
function freeverb(x: Float32Array, spread: number, mix: number) {
  const n = x.length,
    out = new Float32Array(n);
  const cl = [1116, 1188, 1277, 1356].map(v => Math.floor(((v + spread) * MUS_SR) / 44100)),
    al = [556, 441].map(v => Math.floor(((v + spread) * MUS_SR) / 44100));
  const comb = cl.map(l => new Float32Array(l)),
    ap = al.map(l => new Float32Array(l)),
    store = [0, 0, 0, 0],
    ci = [0, 0, 0, 0],
    ai = [0, 0];
  for (let i = 0; i < n; i++) {
    const inp = x[i] * 0.03;
    let o = 0;
    for (let k = 0; k < 4; k++) {
      const y = comb[k][ci[k]];
      store[k] = y * 0.6 + store[k] * 0.4;
      comb[k][ci[k]] = inp + store[k] * 0.86;
      ci[k] = (ci[k] + 1) % cl[k];
      o += y;
    }
    for (let k = 0; k < 2; k++) {
      const b = ap[k][ai[k]];
      ap[k][ai[k]] = o + b * 0.5;
      o = b - o;
      ai[k] = (ai[k] + 1) % al[k];
    }
    out[i] = o;
  }
  for (let i = 0; i < n; i++) x[i] += out[i] * mix;
}

function renderMusic(st: Style, id: string): SynthOut {
  const body = MUS_LEN * MUS_SR,
    tail = 7 * MUS_SR,
    n = body + tail;
  const L = new Float32Array(n),
    R = new Float32Array(n),
    rs = new Lcg(st.seed),
    beat = 60 / st.bpm;
  // 和声垫底：四个和弦各占 12 秒，缓起缓收，彼此交叠；循环点正好落在和弦交替处
  const chords = [
      [0, 3, 6],
      [-1, 2, 5],
      [1, 4, 7],
      [3, 6, 9],
    ],
    seg = MUS_LEN / 4;
  for (let c = 0; c < 4; c++) {
    for (let v = 0; v < 3; v++) {
      const f = penta(chords[c][v] + 5);
      for (let ch = 0; ch < 2; ch++) {
        const det = ch ? 1.0021 : 0.9979,
          dst = ch ? R : L;
        let ph = 0;
        for (let i = 0, m = Math.floor((seg + 4) * MUS_SR); i < m; i++) {
          const t = i / MUS_SR;
          const env = Math.min(1, t / 3.5) * Math.min(1, Math.max(0, seg + 4 - t) / 4);
          ph += (TAU * f * det) / MUS_SR;
          const w = Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph);
          const at = Math.floor(c * seg * MUS_SR) + i;
          dst[at % body] += w * env * st.pad * (1 + 0.15 * Math.sin(TAU * 0.07 * t + v));
        }
      }
    }
    if (rs.u01() < st.guqin) pluck(L, R, rs, c * seg + 0.3 + rs.u01() * 1.5, penta(chords[c][0] + 5) * 0.5, 0.9, -0.1, 2, 5.5);
  }
  // 旋律：一句 3～7 个音，在音阶上随机游走；句首偶尔来一段上行刮奏；句间长短不一的休止
  let t = 1 + rs.u01() * 2,
    cur = Math.floor((st.low + st.high) / 2);
  const durs = [0.5, 0.75, 1, 1, 1.5, 2];
  while (t < MUS_LEN - 1.5) {
    const notes = 3 + Math.floor(rs.u01() * 5);
    if (rs.u01() < st.gliss) {
      const g = 4 + Math.floor(rs.u01() * 4);
      for (let k = 0; k < g; k++) pluck(L, R, rs, t + k * 0.045, penta(cur - g + k), 0.35 + 0.05 * k, -0.3 + 0.1 * k, 0, 1.6);
      t += g * 0.045;
    }
    for (let k = 0; k < notes && t < MUS_LEN - 1.5; k++) {
      const step = Math.floor(rs.u01() * 5) - 2;
      cur += step === 0 ? 1 : step;
      if (cur < st.low) cur = st.low + 1;
      if (cur > st.high) cur = st.high - 1;
      const bend = rs.u01() < 0.2 ? (rs.u01() < 0.5 ? 1 : 2) : 0;
      pluck(L, R, rs, t, penta(cur), 0.55 + 0.35 * rs.u01(), (rs.u01() - 0.5) * 0.8, bend, 3.2);
      t += durs[Math.floor(rs.u01() * 6)] * beat;
    }
    t += (beat * (1.5 + rs.u01() * 3)) / st.density;
  }
  freeverb(L, 0, 0.55);
  freeverb(R, 23, 0.55);
  for (let i = 0; i < tail; i++) {
    L[i] += L[body + i];
    R[i] += R[body + i];
  } // 把尾音接回开头，循环无缝
  let peak = 1e-6;
  for (let i = 0; i < body; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const sc = 0.7 / peak,
    ol = new Float32Array(body),
    or = new Float32Array(body);
  for (let i = 0; i < body; i++) {
    ol[i] = Math.tanh(L[i] * sc) * (32000 / 32768);
    or[i] = Math.tanh(R[i] * sc) * (32000 / 32768);
  }
  return { id, sr: MUS_SR, l: ol, r: or };
}

self.onmessage = () => {
  const post = (o: SynthOut) => (self as unknown as Worker).postMessage(o, o.r ? [o.l.buffer, o.r.buffer] : [o.l.buffer]);
  const sr = 44100,
    rs = new Lcg(12345);
  for (const o of synthBasic(sr, rs)) post(o);
  post(synthTick(sr, rs));
  post(synthWin(sr, rs));
  post(synthGoEnd(sr, rs));
  post(renderMusic({ bpm: 66, density: 0.8, gliss: 0.35, pad: 0.05, guqin: 0.7, low: 8, high: 19, seed: 20240917 }, 'music-menu'));
  post(renderMusic({ bpm: 56, density: 0.45, gliss: 0.12, pad: 0.04, guqin: 0.4, low: 6, high: 16, seed: 19871023 }, 'music-game'));
};
