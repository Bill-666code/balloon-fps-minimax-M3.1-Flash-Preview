/* =========================================================================
   ART —— 全部程序化美术：贴图 / 天空 / 角色精灵 / 道具 / 武器视图模型
   没有一张外部图片，全部靠 Canvas 2D / 像素循环现画现算。
   ========================================================================= */
'use strict';

/* ============================ 贴图工具 ============================ */
const TEXW = 64, TEXH = 64, TMASK = 63;
function newTex(w, h) { return { w, h, data: new Uint32Array(w * h) }; }

/** 圆角矩形有符号距离场（画充气鼓包用） */
function sdRoundBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}
function hsvP(h, s, v) { const c = hsv(h, s, v); return packRGB(c[0], c[1], c[2]); }

/* ---------- 墙面样式 ---------- */
const WALL_STYLES = 6;
const WALL_PAL = [
  { a: hsvP(0.95, 0.62, 0.98), b: hsvP(0.08, 0.80, 1.0) },  // 红/黄 充气城堡
  { a: hsvP(0.55, 0.60, 0.98), b: hsvP(0.80, 0.70, 1.0) },  // 蓝/粉
  { a: hsvP(0.33, 0.60, 0.92), b: hsvP(0.12, 0.75, 1.0) },  // 绿/黄绿
  { a: hsvP(0.78, 0.45, 0.95), b: hsvP(0.92, 0.55, 1.0) },  // 紫/粉
  { a: hsvP(0.10, 0.55, 1.0), b: hsvP(0.60, 0.50, 0.98) },  // 橙/天蓝
  { a: hsvP(0.02, 0.50, 0.96), b: hsvP(0.72, 0.55, 0.96) }   // 珊瑚/藕紫
];

/** 充气墙：鼓包 + 接缝 + 铆钉 + 表面噪声 */
function makeWallTex(style, variant) {
  const t = newTex(TEXW, TEXH);
  const pal = WALL_PAL[style % WALL_PAL.length];
  const base = mixC(pal.a, pal.b, variant * 0.5);
  const dark = shade(base, 0.55);
  const seam = shade(base, 0.62);
  const hi = shade(base, 1.35);
  const nseed = variant * 37.3 + style * 11.1;
  for (let y = 0; y < TEXH; y++) {
    for (let x = 0; x < TEXW; x++) {
      // 一个 64px 贴图 = 2x2 个鼓包，充气城堡的拼块感
      const u = (x % 32) / 32 - 0.5, v = (y % 32) / 32 - 0.5;
      const d = sdRoundBox(u, v, 0.5, 0.5, 0.22);
      const e = clamp((d + 0.04) / 0.42, 0, 1);
      let b = 0.48 + 0.36 * smoothstep(e);
      b += 0.14 * Math.exp(-Math.pow((v + 0.20) / 0.16, 2));      // 顶部高光
      b -= 0.15 * Math.exp(-Math.pow((v - 0.30) / 0.20, 2));      // 底部阴影
      b -= 0.30 * (1 - smoothstep(clamp(-d / 0.05, 0, 1)));        // 拼缝
      let c = shade(base, b);
      // 铆钉
      const rx = ((x % 32) - 3.5), ry = ((y % 32) - 3.5);
      if (Math.abs(rx) < 1.4 && Math.abs(ry) < 1.4) c = mixC(c, hi, 0.55);
      // 表面橡胶颗粒
      const n = fbm(x * 0.55 + nseed, y * 0.55 + nseed, 3);
      c = shade(c, 0.93 + n * 0.14);
      // 风格图案
      if (style % 3 === 1) { // 糖果竖条
        if (x % 16 < 8) c = mixC(c, pal.b, 0.30);
        if (x % 16 === 0) c = shade(c, 0.8);
      } else if (style % 3 === 2) { // 波点
        const dx = ((x + 8) % 16) - 8, dy = ((y + 8) % 16) - 8;
        if (dx * dx + dy * dy < 5.5) c = mixC(c, pal.b, 0.42);
      }
      if (style === 5) { // 星星
        const dx = ((x + 8) % 32) - 16, dy = ((y + 8) % 32) - 16;
        if (starMask(dx, dy, 5)) c = mixC(c, hi, 0.55);
      }
      if (y < 3) c = shade(c, 0.75);
      if (y > TEXH - 4) c = shade(c, 0.8);
      if (x < 2 || x > TEXW - 3) c = shade(c, 0.88);
      t.data[y * TEXW + x] = c;
    }
  }
  return t;
}
function starMask(dx, dy, r) {
  const a = Math.atan2(dy, dx), k = 2.6;
  const rr = r * (0.62 + 0.38 * Math.cos(k * a));
  return dx * dx + dy * dy < rr * rr;
}

/* ---------- 地面样式 ---------- */
const FLOOR_STYLES = 4;
function makeFloorTex(style) {
  const t = newTex(TEXW, TEXH);
  for (let y = 0; y < TEXH; y++) {
    for (let x = 0; x < TEXW; x++) {
      let c;
      if (style === 0) {                       // 棋盘乙烯地板
        const chk = ((x >> 5) + (y >> 5)) & 1;
        const a = chk ? hsvP(0.90, 0.35, 1.0) : hsvP(0.58, 0.45, 1.0);
        c = shade(a, 0.80);
        if ((x & 31) < 1 || (y & 31) < 1) c = shade(c, 0.7);
        c = mixC(c, hsvP(0.14, 0.8, 1.0), 0.10);
      } else if (style === 1) {                // 彩纸地毯
        c = hsvP(0.02, 0.10, 0.98);
        if ((x & 31) < 1 || (y & 31) < 1) c = shade(c, 0.88);
        const hh = hash2((x / 4) | 0, (y / 4) | 0);
        if (hh > 0.90) c = mixC(c, rainbowC(hh * 3.3), 0.75);
      } else if (style === 2) {                // 糖果条纹
        const k = ((x >> 5) & 1);
        c = k ? hsvP(0.99, 0.45, 0.92) : mixC(packRGB(255, 255, 255), hsvP(0.10, 0.25, 1.0), 0.35);
        c = shade(c, 0.88);
        if ((x & 31) < 1) c = shade(c, 0.78);
        if (((x + 16) & 31) < 2) c = mixC(c, packRGB(255, 255, 255), 0.35);
      } else {                                 // 气泡软垫
        const dx = ((x + 16) % 32) - 16, dy = ((y + 16) % 32) - 16;
        const d = Math.hypot(dx, dy);
        c = hsvP(0.44, 0.42, 0.99);
        if (d < 13) {
          const e = 1 - d / 13;
          c = mixC(c, packRGB(255, 255, 255), 0.16 * e);
          c = shade(c, 0.9 + 0.35 * Math.exp(-Math.pow((dy + 5) / 5, 2)));
          if (d > 12) c = shade(c, 0.72);
        }
        if ((x & 31) < 1 || (y & 31) < 1) c = shade(c, 0.78);
      }
      const n = fbm(x * 0.4 + style * 9, y * 0.4, 2);
      t.data[y * TEXW + x] = shade(c, 0.70 + n * 0.12);
    }
  }
  return t;
}

/* ---------- 天空 ---------- */
const SKYW = 512, SKYH = 256, SKYWM = 511, SKYHM = 255;
function makeSky() {
  const t = newTex(SKYW, SKYH);
  // 远处气球群（代码生成的剪影）
  const blobs = [];
  for (let i = 0; i < 26; i++) {
    blobs.push({ x: rnd() * SKYW, y: 20 + rnd() * 110, r: 5 + rnd() * 9, c: rainbowC(rnd()), layer: rnd() < 0.4 ? 0 : 1 });
  }
  for (let y = 0; y < SKYH; y++) {
    const v = y / SKYH;
    for (let x = 0; x < SKYW; x++) {
      let r, g, b;
      if (v < 0.62) {                      // 上层天蓝
        const k = v / 0.62;
        r = lerp(44, 132, k); g = lerp(124, 194, k); b = lerp(222, 236, k);
      } else {                             // 地平线暖粉
        const k = (v - 0.62) / 0.38;
        r = lerp(138, 236, k); g = lerp(200, 186, k); b = lerp(236, 214, k);
      }
      // 云：fbm，靠近地平线压扁
      const cy = y * (v < 0.62 ? 0.055 : 0.11);
      let n = fbm(x * 0.018, cy * 1.6 + 12, 5, 0.55);
      n += 0.3 * fbm(x * 0.05 + 40, cy * 3 + 7, 3);
      let cloud = clamp((n - 0.635) * 3.0, 0, 1) * clamp(1 - Math.abs(v - 0.30) * 2.2, 0, 1);
      r = lerp(r, 255, cloud); g = lerp(g, 255, cloud); b = lerp(b, 255, cloud);
      // 阳光
      const sx = x - 372, sy = y - 46;
      const sd = Math.hypot(sx, sy);
      const glow = Math.exp(-sd / 44) * 0.85;
      r = lerp(r, 255, glow); g = lerp(g, 244, glow * 0.9); b = lerp(b, 170, glow * 0.6);
      const core = clamp(1 - sd / 15, 0, 1);
      r = lerp(r, 255, core); g = lerp(g, 250, core); b = lerp(b, 205, core);
      t.data[y * SKYW + x] = packRGB(r | 0, g | 0, b | 0);
    }
  }
  // 远景气球叠加
  for (const bl of blobs) {
    const rad = bl.r * (bl.layer ? 1.15 : 0.75);
    const R = rad, S = rad * 1.18;
    const top = bl.y - S, bot = bl.y + S + 6;
    for (let y = Math.max(0, top | 0); y < Math.min(SKYH, bot); y++) {
      for (let x = 0; x < SKYW; x++) {
        let dx = x - bl.x; if (dx > SKYW / 2) dx -= SKYW; else if (dx < -SKYW / 2) dx += SKYW;
        const dy = (y - bl.y) / 1.06;
        const d = (dx * dx + dy * dy) / (R * R);
        if (d < 1) {
          const sh = 0.78 + 0.3 * clamp(((-dy - R * 0.4) / R) * 0.5 + 0.5, 0, 1);
          // 球体明暗
          const nz = Math.sqrt(Math.max(0, 1 - d));
          const lam = clamp(0.45 + (dx * -0.5 + dy * -0.6 + nz * 0.7) / R * 0.55, 0, 1);
          let c = mixC(bl.c, packRGB(255, 255, 255), 0.55 * Math.pow(lam, 3));
          c = shade(c, 0.5 + 0.7 * lam);
          const t2 = t.data[y * SKYW + (x & SKYWM)];
          const a = clamp((1 - d) * 3.2, 0, 1) * 0.92;
          t.data[y * SKYW + (x & SKYWM)] = mixC(t2, c, a);
        } else if (dy > 0 && Math.abs(dx) < 2.4 && y > bl.y + S) {
          // 气球线
          t.data[y * SKYW + (x & SKYWM)] = mixC(t.data[y * SKYW + (x & SKYWM)], packRGB(210, 210, 220), 0.35);
        }
      }
    }
    // 打结
    for (let y = (bl.y + S) | 0; y < (bl.y + S + 5) && y < SKYH; y++) {
      for (let x = ((bl.x - 2) | 0); x < bl.x + 3; x++) {
        if (starMask(x - bl.x, (y - bl.y - S) * 1.2, 2.4)) {
          t.data[y * SKYW + (x & SKYWM)] = mixC(t.data[y * SKYW + (x & SKYWM)], shade(bl.c, 0.7), 0.8);
        }
      }
    }
  }
  return t;
}

/* ============================ Canvas 绘制工具 ============================ */
function gclear(g, w, h) { g.clearRect(0, 0, w, h); }
function limb(g, x0, y0, x1, y1, w, color) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * w * 0.5, ny = dx / L * w * 0.5;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x0 + nx, y0 + ny); g.lineTo(x1 + nx, y1 + ny);
  g.arc(x1, y1, w * 0.5, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  g.lineTo(x0 - nx, y0 - ny);
  g.arc(x0, y0, w * 0.5, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  g.closePath(); g.fill();
}
/** 气球轮廓（带底部小尖） */
function balloonPath(g, cx, cy, rx, ry) {
  g.beginPath();
  g.moveTo(cx, cy - ry);
  g.bezierCurveTo(cx + rx * 1.06, cy - ry, cx + rx * 1.02, cy + ry * 0.72, cx, cy + ry);
  g.bezierCurveTo(cx - rx * 1.02, cy + ry * 0.72, cx - rx * 1.06, cy - ry, cx, cy - ry);
  g.closePath();
}
/** 画一个漂亮的乳胶气球 */
function drawBalloon(g, cx, cy, rx, ry, col, opts = {}) {
  const { knot = true, string = 0, shine = 1, face = false, symbol = null, squash = 0, rot = 0 } = opts;
  g.save();
  g.translate(cx, cy);
  if (rot) g.rotate(rot);
  g.scale(1 + squash, 1 - squash * 0.9);
  // 高光渐变
  const lit = mixC(col, packRGB(255, 255, 255), 0.45);
  const dark = shade(col, 0.45);
  const grd2 = g.createRadialGradient(-rx * 0.3, -ry * 0.4, rx * 0.05, 0, 0, rx * 1.3);
  grd2.addColorStop(0, '#' + hex(lit));
  grd2.addColorStop(0.42, '#' + hex(col));
  grd2.addColorStop(1, '#' + hex(dark));
  balloonPath(g, 0, 0, rx, ry);
  g.fillStyle = grd2; g.fill();
  // 边缘内反射
  g.save(); g.clip();
  g.globalAlpha = 0.35 * shine;
  g.fillStyle = '#' + hex(mixC(col, packRGB(255, 255, 255), 0.8));
  g.beginPath(); g.ellipse(rx * 0.45, ry * 0.42, rx * 0.36, ry * 0.5, -0.5, 0, TAU); g.fill();
  g.restore();
  // 主高光
  if (shine > 0) {
    g.globalAlpha = 0.9 * shine;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath(); g.ellipse(-rx * 0.36, -ry * 0.44, rx * 0.19, ry * 0.26, -0.5, 0, TAU); g.fill();
    g.globalAlpha = 0.5;
    g.beginPath(); g.ellipse(-rx * 0.05, -ry * 0.62, rx * 0.09, ry * 0.1, -0.3, 0, TAU); g.fill();
    g.globalAlpha = 1;
  }
  if (symbol) { g.save(); g.globalAlpha = 0.95; g.fillStyle = 'rgba(255,255,255,0.95)'; drawSymbol(g, symbol, 0, 0, rx * 0.82); g.restore(); }
  if (face) drawFace(g, rx, ry, opts.mood || 0);
  g.restore();
  if (knot) {
    g.fillStyle = '#' + hex(shade(col, 0.85));
    g.beginPath();
    g.moveTo(cx - rx * 0.13, cy + ry * 0.92);
    g.lineTo(cx + rx * 0.13, cy + ry * 0.92);
    g.lineTo(cx + rx * 0.05, cy + ry * 1.22);
    g.lineTo(cx - rx * 0.05, cy + ry * 1.22);
    g.closePath(); g.fill();
  }
  if (string > 0) {
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(0.6, rx * 0.045);
    g.beginPath();
    g.moveTo(cx, cy + ry * 1.22);
    for (let i = 1; i <= 4; i++) {
      const t = i / 4, yy = cy + ry * 1.22 + string * t;
      g.lineTo(cx + Math.sin(t * 7 + opts.seed || 0) * rx * 0.22 * t, yy);
    }
    g.stroke();
  }
}
function hex(c) { return ((cr(c) << 16) | (cg(c) << 8) | cb(c)).toString(16).padStart(6, '0'); }
function drawSymbol(g, kind, x, y, r) {
  g.save(); g.translate(x, y); g.lineCap = 'round'; g.lineJoin = 'round';
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.strokeStyle = 'rgba(255,255,255,0.95)';
  if (kind === 'cross') { g.fillRect(-r * 0.16, -r * 0.5, r * 0.32, r); g.fillRect(-r * 0.5, -r * 0.16, r, r * 0.32); }
  else if (kind === 'plus') { g.fillRect(-r * 0.14, -r * 0.55, r * 0.28, r * 1.1); g.fillRect(-r * 0.55, -r * 0.14, r * 1.1, r * 0.28); }
  else if (kind === 'star') {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, rr = i % 2 ? r * 0.42 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath(); g.fill();
  } else if (kind === 'bolt') {
    g.beginPath();
    g.moveTo(r * 0.18, -r * 0.62); g.lineTo(-r * 0.34, r * 0.06); g.lineTo(-r * 0.02, r * 0.06);
    g.lineTo(-r * 0.18, r * 0.62); g.lineTo(r * 0.34, -r * 0.08); g.lineTo(r * 0.02, -r * 0.08);
    g.closePath(); g.fill();
  } else if (kind === 'ammo') {
    g.fillRect(-r * 0.5, -r * 0.34, r * 0.3, r * 0.9); g.fillRect(-r * 0.1, -r * 0.34, r * 0.3, r * 0.9);
    g.fillRect(-r * 0.5, -r * 0.5, r * 0.3, r * 0.18); g.fillRect(-r * 0.1, -r * 0.5, r * 0.3, r * 0.18);
  }
  g.restore();
}
function drawFace(g, rx, ry, mood = 0) {
  const ex = rx * 0.34, ey = -ry * 0.06, er = rx * 0.24;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(-ex, ey, er, er * 1.08, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(ex, ey, er, er * 1.08, 0, 0, TAU); g.fill();
  g.fillStyle = '#1b1d2a';
  const pr = er * 0.52;
  g.beginPath(); g.arc(-ex + mood * er * 0.2, ey + er * 0.12, pr, 0, TAU); g.fill();
  g.beginPath(); g.arc(ex + mood * er * 0.2, ey + er * 0.12, pr, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.arc(-ex + mood * er * 0.2 - pr * 0.35, ey + pr * 0.1, pr * 0.3, 0, TAU); g.fill();
  g.beginPath(); g.arc(ex + mood * er * 0.2 - pr * 0.35, ey + pr * 0.1, pr * 0.3, 0, TAU); g.fill();
  // 嘴
  g.strokeStyle = '#1b1d2a'; g.lineWidth = Math.max(0.7, rx * 0.07); g.lineCap = 'round';
  g.beginPath();
  const my = ry * 0.36;
  if (mood > 0.5) g.arc(0, my - rx * 0.16, rx * 0.3, 0.15 * PI, 0.85 * PI);
  else g.arc(0, my + rx * 0.3, rx * 0.28, 1.15 * PI, 1.85 * PI);
  g.stroke();
}

/* ============================ 角色（气球人） ============================ */
const ACTOR_DEFS = {
  boinger: {
    label: '弹弹兵', head: C(0xff4d63), body: C(0xffd93d), trim: C(0x2b2d42), pat: 'dots',
    headR: 0.21, bodyW: 0.30, bodyH: 0.25, leg: 0.11, arm: 0.15, z: 0, r: 0.30,
    speed: 2.35, hp: 24, score: 15, frames: 6, bob: 1.4, swing: 0.10, armSwing: 0.08, eye: 'big', mood: 1
  },
  floaty: {
    label: '飘飘怪', head: C(0x4dc9ff), body: C(0x8b5cf6), trim: C(0x1b1d2a), pat: 'stripe',
    headR: 0.27, bodyW: 0.20, bodyH: 0.20, leg: 0.05, arm: 0.20, z: 0.34, r: 0.30,
    speed: 2.0, hp: 30, score: 20, frames: 4, bob: 3.0, swing: 0.05, armSwing: 0.16, eye: 'big', mood: 0
  },
  darter: {
    label: '吹镖手', head: C(0xffd93d), body: C(0x2ec4b6), trim: C(0x073b3a), pat: 'band',
    headR: 0.22, bodyW: 0.26, bodyH: 0.24, leg: 0.10, arm: 0.17, z: 0, r: 0.30,
    speed: 1.85, hp: 34, score: 30, frames: 6, bob: 1.0, swing: 0.09, armSwing: 0.09, eye: 'small', mood: 1
  },
  bomber: {
    label: '爆爆球', head: C(0x6ee7a0), body: C(0xff8fab), trim: C(0x14532d), pat: 'stripe',
    headR: 0.25, bodyW: 0.34, bodyH: 0.27, leg: 0.08, arm: 0.13, z: 0, r: 0.34,
    speed: 3.5, hp: 18, score: 25, frames: 6, bob: 2.2, swing: 0.13, armSwing: 0.05, eye: 'small', mood: 1
  },
  chonk: {
    label: '胖墩墩', head: C(0xb06cff), body: C(0x4a3aff), trim: C(0x1e1b4b), pat: 'dots',
    headR: 0.23, bodyW: 0.46, bodyH: 0.32, leg: 0.09, arm: 0.12, z: 0, r: 0.42,
    speed: 1.25, hp: 90, score: 60, frames: 6, bob: 1.0, swing: 0.07, armSwing: 0.05, eye: 'small', mood: 1
  },
  boss: {
    label: '气球王', head: C(0xff4d63), body: C(0xffd93d), trim: C(0x2b2d42), pat: 'royal',
    headR: 0.20, bodyW: 0.42, bodyH: 0.30, leg: 0.10, arm: 0.18, z: 0, r: 0.60,
    speed: 1.7, hp: 520, score: 800, frames: 6, bob: 1.6, swing: 0.09, armSwing: 0.08, eye: 'big', mood: 1
  }
};

function drawActorFrame(g, W, H, P, type, fr) {
  gclear(g, W, H);
  const t = (fr / P.frames) * TAU;
  const s = H / 64;
  const gx = W / 2, groundY = H - 1.5;
  const bob = Math.sin(t) * P.bob * s;
  const swing = Math.sin(t) * P.swing * H;
  const armSw = -Math.sin(t) * P.armSwing * H;
  const legH = P.leg * H, bodyH = P.bodyH * H, bodyW = P.bodyW * H, headR = P.headR * H;
  const armW = Math.max(2, 0.062 * H), legW = Math.max(2, 0.07 * H);
  const hipY = groundY - legH;
  const bodyTop = hipY - bodyH + bob;
  const bodyCY = bodyTop + bodyH * 0.5;
  const headCY = bodyTop - headR * 0.72;
  const bodyCol = '#' + hex(P.body), headCol = '#' + hex(P.head);
  const dark = n => '#' + hex(shade(n, 0.72));

  // 腿
  const legX = bodyW * 0.22;
  limb(g, gx - legX, hipY, gx - legX + swing, groundY, legW, dark(P.body));
  limb(g, gx + legX, hipY, gx + legX - swing, groundY, legW, bodyCol);
  // 鞋
  g.fillStyle = dark(P.trim);
  g.beginPath(); g.ellipse(gx - legX + swing, groundY - legW * 0.15, legW * 0.95, legW * 0.6, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(gx + legX - swing, groundY - legW * 0.15, legW * 0.95, legW * 0.6, 0, 0, TAU); g.fill();

  // 远侧手臂
  limb(g, gx - bodyW * 0.42, bodyTop + bodyH * 0.22, gx - bodyW * 0.62, bodyTop + bodyH * 0.22 + P.arm * H - armSw * 0.5, armW, dark(P.body));
  // 身体
  g.save();
  const bw = bodyW * 0.5, bh = bodyH * 0.5, r = Math.min(bw, bh) * 0.55;
  g.beginPath();
  g.moveTo(gx - bw, bodyCY - bh);
  g.lineTo(gx + bw, bodyCY - bh);
  g.quadraticCurveTo(gx + bw * 1.1, bodyCY + bh, gx, bodyCY + bh * 1.05);
  g.quadraticCurveTo(gx - bw * 1.1, bodyCY + bh, gx - bw, bodyCY - bh);
  g.closePath();
  const bg = g.createLinearGradient(gx - bw, 0, gx + bw, 0);
  bg.addColorStop(0, dark(P.body)); bg.addColorStop(0.42, bodyCol); bg.addColorStop(1, '#' + hex(shade(P.body, 0.82)));
  g.fillStyle = bg; g.fill();
  g.save(); g.clip();
  // 衣服花纹
  g.globalAlpha = 0.5;
  if (P.pat === 'dots') { g.fillStyle = '#' + hex(mixC(P.body, packRGB(255, 255, 255), 0.75));
    for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) { g.beginPath(); g.arc(gx + i * bodyW * 0.3, bodyCY + j * bodyH * 0.34, bodyW * 0.05, 0, TAU); g.fill(); } }
  else if (P.pat === 'stripe') { g.fillStyle = '#ffffff';
    for (let i = -3; i <= 3; i++) g.fillRect(gx + i * bodyW * 0.22 - bodyW * 0.05, bodyTop - 2, bodyW * 0.1, bodyH + 4); }
  else if (P.pat === 'band') { g.fillStyle = '#' + hex(mixC(P.body, packRGB(255, 255, 255), 0.85));
    g.fillRect(gx - bodyW, bodyCY - bodyH * 0.06, bodyW * 2, bodyH * 0.16); }
  else if (P.pat === 'royal') { g.fillStyle = '#' + hex(mixC(P.body, packRGB(255, 255, 255), 0.8));
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(gx + i * bodyW * 0.5, bodyTop - 2); g.lineTo(gx + i * bodyW * 0.5 - bodyW * 0.14, bodyTop - 2 + bodyH * 0.3); g.lineTo(gx + i * bodyW * 0.5 + bodyW * 0.14, bodyTop - 2 + bodyH * 0.3); g.closePath(); g.fill(); } }
  g.restore();
  g.globalAlpha = 0.35; g.strokeStyle = '#ffffff'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(gx - bw * 0.5, bodyTop - 1); g.lineTo(gx - bw * 0.5, bodyCY + bh * 0.6); g.stroke();
  g.restore();
  g.globalAlpha = 1;

  // 近侧手臂 + 手套
  const hx = gx + bodyW * 0.42, hy = bodyTop + bodyH * 0.24;
  const hx2 = gx + bodyW * 0.66, hy2 = bodyTop + bodyH * 0.24 + P.arm * H + armSw * 0.5;
  limb(g, hx, hy, hx2, hy2, armW, bodyCol);
  g.fillStyle = '#' + hex(mixC(P.head, packRGB(255, 255, 255), 0.3));
  g.beginPath(); g.arc(hx2, hy2, armW * 0.72, 0, TAU); g.fill();

  // 头（气球）
  drawBalloon(g, gx, headCY, headR, headR * 1.04, P.head, { knot: false, shine: 1, mood: P.mood });
  // 脖子小结
  g.fillStyle = '#' + hex(shade(P.head, 0.8));
  g.beginPath();
  g.moveTo(gx - headR * 0.12, headCY + headR * 0.92);
  g.lineTo(gx + headR * 0.12, headCY + headR * 0.92);
  g.lineTo(gx + headR * 0.05, headCY + headR * 1.2);
  g.lineTo(gx - headR * 0.05, headCY + headR * 1.2);
  g.closePath(); g.fill();

  // 类型专属装饰
  if (type === 'darter') {           // 吹镖：长鼻子 + 额带
    g.fillStyle = '#e0e6ff';
    g.beginPath(); g.moveTo(gx + headR * 0.2, headCY - headR * 0.1); g.lineTo(gx + headR * 1.5, headCY + headR * 0.16); g.lineTo(gx + headR * 0.2, headCY + headR * 0.3); g.closePath(); g.fill();
    g.fillStyle = '#ff4d63'; g.fillRect(gx - headR, headCY - headR * 0.72, headR * 2, headR * 0.22);
  } else if (type === 'bomber') {   // 引信
    g.strokeStyle = '#7c4a03'; g.lineWidth = Math.max(1, headR * 0.1);
    g.beginPath(); g.moveTo(gx, headCY - headR); g.quadraticCurveTo(gx + headR * 0.3, headCY - headR * 1.4, gx + headR * 0.05, headCY - headR * 1.55); g.stroke();
    g.fillStyle = '#ffd93d';
    g.beginPath(); g.arc(gx + headR * 0.05, headCY - headR * 1.6, headR * 0.14, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath(); g.arc(gx + headR * 0.02, headCY - headR * 1.64, headR * 0.06, 0, TAU); g.fill();
  } else if (type === 'chonk') {    // 胡子
    g.fillStyle = '#3a2a1a';
    g.beginPath(); g.moveTo(gx - headR * 0.55, headCY + headR * 0.2);
    g.quadraticCurveTo(gx, headCY + headR * 0.62, gx + headR * 0.55, headCY + headR * 0.2);
    g.quadraticCurveTo(gx, headCY + headR * 0.34, gx - headR * 0.55, headCY + headR * 0.2);
    g.closePath(); g.fill();
  } else if (type === 'boss') {     // 小皇冠 + 墨镜
    g.fillStyle = '#ffd93d';
    g.beginPath();
    const cw = headR * 0.72, cy0 = headCY - headR * 0.9;
    g.moveTo(gx - cw, cy0);
    g.lineTo(gx - cw * 0.8, cy0 - headR * 0.4); g.lineTo(gx - cw * 0.4, cy0 - headR * 0.1);
    g.lineTo(gx, cy0 - headR * 0.5); g.lineTo(gx + cw * 0.4, cy0 - headR * 0.1);
    g.lineTo(gx + cw * 0.8, cy0 - headR * 0.4); g.lineTo(gx + cw, cy0);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(30,30,50,0.92)';
    g.beginPath(); g.roundRect ? g.roundRect(gx - headR * 0.72, headCY - headR * 0.2, headR * 0.66, headR * 0.34, 3) : g.rect(gx - headR * 0.72, headCY - headR * 0.2, headR * 0.66, headR * 0.34);
    g.fill();
    g.beginPath(); g.roundRect ? g.roundRect(gx + headR * 0.06, headCY - headR * 0.2, headR * 0.66, headR * 0.34, 3) : g.rect(gx + headR * 0.06, headCY - headR * 0.2, headR * 0.66, headR * 0.34);
    g.fill();
    g.strokeStyle = '#2b2d42'; g.lineWidth = Math.max(1, headR * 0.07);
    g.beginPath(); g.moveTo(gx - headR * 0.08, headCY - headR * 0.04); g.lineTo(gx + headR * 0.08, headCY - headR * 0.04); g.stroke();
  } else if (type === 'floaty') {   // 小翅膀
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const s of [-1, 1]) {
      g.save(); g.translate(gx + s * headR * 0.9, headCY); g.rotate(s * 0.5 + Math.sin(t) * 0.3);
      g.beginPath(); g.ellipse(s * headR * 0.3, 0, headR * 0.42, headR * 0.18, 0, 0, TAU); g.fill();
      g.restore();
    }
  }
  if (type === 'boinger' || type === 'darter') {   // 领结
    g.fillStyle = '#ff4d63';
    const by = bodyTop + 2;
    g.beginPath(); g.moveTo(gx, by); g.lineTo(gx - bodyW * 0.28, by - bodyW * 0.16); g.lineTo(gx - bodyW * 0.28, by + bodyW * 0.16); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(gx, by); g.lineTo(gx + bodyW * 0.28, by - bodyW * 0.16); g.lineTo(gx + bodyW * 0.28, by + bodyW * 0.16); g.closePath(); g.fill();
  }
}

/** 爆裂/漏气动画帧 */
function drawDeflateFrame(g, W, H, fr, col) {
  gclear(g, W, H);
  const t = fr / 4;
  const cx = W / 2, cy = H / 2;
  const rx = (1 - t * 0.55) * W * 0.42, ry = (1 - t * 0.55) * H * 0.42;
  g.save(); g.translate(cx, cy); g.rotate(t * 2.2); g.scale(1, 1 - t * 0.82);
  const grd = g.createRadialGradient(-rx * 0.3, -ry * 0.4, rx * 0.05, 0, 0, rx * 1.2);
  grd.addColorStop(0, '#' + hex(mixC(col, packRGB(255, 255, 255), 0.5)));
  grd.addColorStop(1, '#' + hex(shade(col, 0.7)));
  balloonPath(g, 0, 0, Math.max(1, rx), Math.max(1, ry));
  g.fillStyle = grd; g.fill();
  g.globalAlpha = 1 - t * 0.6;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.ellipse(-rx * 0.35, -ry * 0.42, rx * 0.18, ry * 0.26, -0.5, 0, TAU); g.fill();
  g.restore();
  g.globalAlpha = 1;
}

/* ---------- 预生成所有精灵表 ---------- */
const Art = { walls: [], floors: [], sky: null, actors: {}, deflate: [], props: {}, glow: null, muzzle: null };
const BALLOON_COLORS = [C(0xff4d63), C(0xff9f43), C(0xffd93d), C(0x6ee7a0), C(0x4dc9ff), C(0xb06cff), C(0xff8fab)];

function buildArt() {
  seedRand(20240613);
  for (let s = 0; s < WALL_STYLES; s++)
    for (let v = 0; v < 2; v++) Art.walls.push(makeWallTex(s, v));
  for (let s = 0; s < FLOOR_STYLES; s++) Art.floors.push(makeFloorTex(s));
  Art.sky = makeSky();

  // 角色
  for (const key in ACTOR_DEFS) {
    const P = ACTOR_DEFS[key];
    const isBoss = key === 'boss';
    const H = isBoss ? 104 : 68, W = Math.ceil(H * (isBoss ? 1.0 : 0.78));
    const cv = makeCanvas(W, H), g = cv.getContext('2d');
    const frames = [];
    for (let f = 0; f < P.frames; f++) {
      drawActorFrame(g, W, H, P, key, f);
      frames.push(extractSprite(cv));
    }
    // 阴影贴图（椭圆）
    const scv = makeCanvas(32, 16), sg = scv.getContext('2d');
    sg.fillStyle = 'rgba(20,10,40,0.42)';
    sg.beginPath(); sg.ellipse(16, 8, 15, 6.5, 0, 0, TAU); sg.fill();
    Art.actors[key] = { frames, w: W, h: H, ph: isBoss ? 1.5 : 1.0, shadow: extractSprite(scv) };
  }
  // 漏气
  for (let f = 0; f < 5; f++) {
    const cv = makeCanvas(40, 46), g = cv.getContext('2d');
    drawDeflateFrame(g, 40, 46, f, packRGB(255, 90, 110));
    Art.deflate.push(extractSprite(cv));
  }
  // 气球（7 色 + 道具气球）
  const bc = BALLOON_COLORS;
  Art.props.balloon = bc.map((c, i) => {
    const cv = makeCanvas(34, 52), g = cv.getContext('2d');
    drawBalloon(g, 17, 20, 13, 15, c, { string: 16, shine: 1, seed: i });
    return extractSprite(cv);
  });
  const POW = { health: { sym: 'cross', col: C(0x4ade80) }, ammo: { sym: 'ammo', col: C(0xfbbf24) }, nade: { sym: 'bolt', col: C(0xf87171) }, rapid: { sym: 'star', col: C(0x38bdf8) }, shield: { sym: 'plus', col: C(0xa78bfa) } };
  Art.props.power = {};
  for (const k in POW) {
    const cv = makeCanvas(40, 60), g = cv.getContext('2d');
    drawBalloon(g, 20, 22, 15.5, 18, POW[k].col, { string: 18, shine: 1.2, symbol: POW[k].sym });
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2; g.setLineDash([4, 4]);
    g.beginPath(); g.ellipse(20, 22, 18, 20.5, 0, 0, TAU); g.stroke();
    g.setLineDash([]);
    Art.props.power[k] = extractSprite(cv);
  }
  // 掉落物
  const mk = (w, h, fn) => { const cv = makeCanvas(w, h), g = cv.getContext('2d'); fn(g, w, h); return extractSprite(cv); };
  Art.props.pickup = {
    health: mk(30, 30, (g, w, h) => {
      g.fillStyle = '#f8fafc'; g.beginPath(); g.roundRect(6, 12, 18, 12, 3); g.fill();
      g.fillStyle = '#94a3b8'; g.fillRect(13, 5, 4, 9);
      g.fillStyle = '#ef4444'; g.beginPath(); g.roundRect(9, 5, 12, 8, 3); g.fill();
      g.fillStyle = '#fff'; g.fillRect(13.5, 6.5, 3, 5);
      g.fillStyle = '#22c55e'; g.beginPath(); g.roundRect(10, 15, 10, 6, 2); g.fill();
    }),
    ammo: mk(30, 30, (g, w, h) => {
      g.fillStyle = '#f59e0b'; g.beginPath(); g.roundRect(4, 10, 22, 15, 3); g.fill();
      g.fillStyle = '#b45309'; g.fillRect(4, 10, 22, 4);
      g.fillStyle = '#fff7ed';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.roundRect(7 + i * 6, 4, 4, 9, 2); g.fill(); g.fillStyle = '#fb7185'; g.beginPath(); g.arc(9 + i * 6, 5, 2.2, 0, TAU); g.fill(); g.fillStyle = '#fff7ed'; }
    }),
    nade: mk(28, 28, (g, w, h) => {
      g.fillStyle = '#ef4444'; g.beginPath(); g.arc(14, 17, 9, 0, TAU); g.fill();
      g.fillStyle = '#b91c1c'; g.beginPath(); g.arc(14, 17, 9, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.arc(11, 14, 3, 0, TAU); g.fill();
      g.fillStyle = '#fde047'; g.fillRect(12, 4, 4, 6);
      g.fillStyle = '#22c55e'; g.beginPath(); g.moveTo(14, 4); g.lineTo(10, 0); g.lineTo(18, 0); g.closePath(); g.fill();
    })
  };
  // 飞镖 / 炮弹
  Art.props.dart = mk(18, 10, (g) => {
    g.fillStyle = '#f472b6'; g.beginPath(); g.moveTo(17, 5); g.lineTo(6, 1); g.lineTo(2, 5); g.lineTo(6, 9); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.fillRect(6, 3, 6, 4);
    g.fillStyle = '#22d3ee'; g.beginPath(); g.moveTo(0, 5); g.lineTo(4, 2); g.lineTo(4, 8); g.closePath(); g.fill();
  });
  Art.props.shell = mk(20, 20, (g) => {
    g.fillStyle = '#fb923c'; g.beginPath(); g.arc(10, 10, 8, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(7, 7, 3, 0, TAU); g.fill();
    g.fillStyle = '#fde047'; g.fillRect(8, 2, 4, 4);
  });
  // 光晕 / 枪口火光
  Art.glow = mk(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,190,0.75)');
    gr.addColorStop(0.6, 'rgba(255,180,90,0.22)'); gr.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  Art.muzzle = mk(96, 96, (g, w, h) => {
    g.translate(48, 48);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 46);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,236,170,0.9)');
    gr.addColorStop(0.5, 'rgba(255,150,60,0.35)'); gr.addColorStop(1, 'rgba(255,90,30,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 46, 0, TAU); g.fill();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + 0.3, L = 20 + Math.random() * 26;
      g.strokeStyle = 'rgba(255,225,160,0.75)'; g.lineWidth = 3 + Math.random() * 4; g.lineCap = 'round';
      g.beginPath(); g.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.stroke();
    }
  });
  // 弹孔 / 乳胶疤
  Art.props.hole = mk(16, 16, (g) => {
    const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, 'rgba(40,20,50,0.75)'); gr.addColorStop(0.6, 'rgba(60,30,70,0.35)'); gr.addColorStop(1, 'rgba(60,30,70,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
  });
}

/* ============================ 武器视图模型 ============================ */
const WEAPON_DEFS = {
  popper: {
    name: '吹针爆珠枪', short: 'POPPER', ammoType: 'needle', mag: 12, reserveMax: 180, reload: 1.1,
    dmg: 26, rpm: 320, auto: false, pellets: 1, spread: 0.006, speed: 46, recoil: 0.7, range: 60,
    desc: '半自动高压气针，一针一个泡。'
  },
  pump: {
    name: '气泵霰弹枪', short: 'PUMPER', ammoType: 'air', mag: 6, reserveMax: 90, reload: 0.55, shells: true,
    dmg: 13, rpm: 78, auto: false, pellets: 8, spread: 0.085, speed: 40, recoil: 2.2, range: 34,
    desc: '一次压八颗气，霰射面铺开，专治成群的气球人。'
  },
  cannon: {
    name: '彩带加农炮', short: 'CONFETTI', ammoType: 'shell', mag: 4, reserveMax: 40, reload: 1.5,
    dmg: 60, rpm: 70, auto: false, pellets: 1, spread: 0.01, speed: 22, recoil: 2.6, range: 40, grenade: true,
    desc: '抛射彩带榴弹，落地炸出一整片派对。'
  },
  blaster: {
    name: '纸带连发', short: 'STREAMER', ammoType: 'tape', mag: 60, reserveMax: 400, reload: 1.7,
    dmg: 11, rpm: 780, auto: true, pellets: 1, spread: 0.035, speed: 55, recoil: 0.35, range: 50,
    desc: '抽丝带连发，泼水式覆盖压制。'
  }
};
const WEAPON_ORDER = ['popper', 'pump', 'cannon', 'blaster'];

/** 画玩家的气球手套（两个） */
function drawHands(g, W, H, st, col, recoil) {
  const s = st.s;
  // 气球手套：气球本体 + 下面的小提手
  const put = (x, y, r, rot) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.strokeStyle = '#' + hex(shade(col, 0.92));
    g.lineWidth = r * 0.20; g.lineCap = 'round';
    g.beginPath(); g.arc(0, r * 0.60, r * 0.42, -0.15 * PI, 1.15 * PI); g.stroke();
    g.scale(r / 26, r / 26);
    drawBalloon(g, 0, 0, 21, 24, col, { knot: false, shine: 1 });
    g.restore();
  };
  const cx = W * 0.53;
  put(cx - 32 * s, H * 0.965 + st.bob * 5 * s, 27 * s, 0.30);      // 左手扣扳机
  put(cx + 72 * s, H * 0.935 + st.bob * 5 * s, 27 * s, -0.30);     // 右手托机匣
}

/* 武器：全部用矢量路径现场画（第一人称透视，枪口朝画面深处） */
const GUN_X = 0.60, GUN_Y = 1.02;
const GUN_MUZZLE = { popper: [2, -242], pump: [-6, -262], cannon: [0, -206], blaster: [0, -214] };

/** 近宽远窄的透视管体（枪管/炮管） */
function perspTube(g, cx, wNear, wFar, yNear, yFar, c0, c1, r) {
  const grd = g.createLinearGradient(cx - wNear, 0, cx + wNear, 0);
  grd.addColorStop(0, c0); grd.addColorStop(0.38, c1); grd.addColorStop(1, c0);
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(cx - wNear, yNear); g.lineTo(cx + wNear, yNear);
  g.lineTo(cx + wFar, yFar); g.lineTo(cx - wFar, yFar);
  g.closePath(); g.fill();
  if (r) { g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1.4; g.stroke(); }
}
/** 带高光的圆角盒 */
function metalBox(g, x, y, w, h, r, c0, c1) {
  const grd = g.createLinearGradient(x, y, x + w, y);
  grd.addColorStop(0, c0); grd.addColorStop(0.32, c1); grd.addColorStop(1, c0);
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.22)';
  g.beginPath(); g.moveTo(x + r * 0.7, y + 1.5); g.lineTo(x + w * 0.62, y + 1.5);
  g.lineTo(x + w * 0.5, y + h * 0.34); g.lineTo(x + r * 0.7, y + h * 0.3);
  g.closePath(); g.fill();
}

const GunArt = {
  /* 吹针爆珠枪：细长针管 + 气球气室 */
  popper(g, W, H, st) {
    const s = st.s, cx = W * 0.60 + st.sway * 12 * s, by = H * GUN_Y + st.recoil * 17 * s;
    g.save(); g.translate(cx, by); g.scale(s, s);
    g.rotate(-0.03 + st.reload * 0.55);
    // 握把
    g.save(); g.translate(-26, -34); g.rotate(0.18);
    metalBox(g, -20, 0, 40, 76, 9, '#3f2618', '#7a4f35');
    g.restore();
    // 木质机匣
    const bg = g.createLinearGradient(-36, 0, 44, 0);
    bg.addColorStop(0, '#6b4225'); bg.addColorStop(0.34, '#c08a53'); bg.addColorStop(1, '#5c3a1f');
    g.fillStyle = bg;
    g.beginPath(); g.moveTo(-34, -44); g.lineTo(42, -44); g.quadraticCurveTo(48, -80, 36, -118);
    g.lineTo(-28, -118); g.quadraticCurveTo(-40, -80, -34, -44); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,220,170,0.25)'; g.fillRect(-26, -112, 10, 62);
    // 针管（透视收窄）
    perspTube(g, 2, 11, 7, -112, -236, '#8b9bb0', '#e8eef6', true);
    // 管箍
    g.fillStyle = '#64748b'; g.fillRect(-11, -140, 24, 9); g.fillRect(-9, -186, 20, 7);
    // 针尖
    g.fillStyle = '#f8fafc';
    g.beginPath(); g.moveTo(-4, -234); g.lineTo(10, -252); g.lineTo(8, -230); g.closePath(); g.fill();
    // 准星环
    g.strokeStyle = '#fbbf24'; g.lineWidth = 4;
    g.beginPath(); g.ellipse(2, -216, 17, 6, 0, 0, TAU); g.stroke();
    // 气球气室
    g.save(); g.translate(50, -84);
    drawBalloon(g, 0, 0, 27, 30, C(0xff4d63), { shine: 1.1 });
    g.restore();
    g.strokeStyle = '#e11d48'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(26, -96); g.quadraticCurveTo(14, -108, 12, -96); g.stroke();
    g.restore();
  },
  /* 气泵霰弹枪：粗双管 + 泵柄 + 压力表 */
  pump(g, W, H, st) {
    const s = st.s, cx = W * 0.60 + st.sway * 14 * s, by = H * GUN_Y + st.recoil * 20 * s;
    g.save(); g.translate(cx, by); g.scale(s, s);
    g.rotate(-0.02 + st.reload * 0.6);
    // 枪托
    g.save(); g.translate(44, -30); g.rotate(0.22);
    metalBox(g, -26, 0, 52, 84, 12, '#5a2206', '#a1440f');
    g.restore();
    // 握把
    g.save(); g.translate(-30, -40); g.rotate(0.2);
    metalBox(g, -19, 0, 38, 70, 10, '#2f1a10', '#5d3a22');
    g.restore();
    // 机匣
    const mg = g.createLinearGradient(-62, 0, 72, 0);
    mg.addColorStop(0, '#9a3412'); mg.addColorStop(0.3, '#f97316'); mg.addColorStop(0.62, '#fb923c'); mg.addColorStop(1, '#7c2d12');
    g.fillStyle = mg;
    g.beginPath(); g.moveTo(-60, -46); g.lineTo(70, -46); g.lineTo(58, -124); g.lineTo(-52, -124); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(-52, -118, 96, 10);
    // 双管
    perspTube(g, -20, 34, 19, -118, -252, '#334155', '#94a3b8', true);
    g.fillStyle = '#0f172a';
    g.beginPath(); g.ellipse(-20, -252, 19, 7, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(-46, -240, 12, 3);
    // 管箍
    g.fillStyle = '#1e293b'; g.fillRect(-54, -150, 68, 11);
    // 气泵柄
    const py = -128 + st.pumpAnim * 20;
    const pg = g.createLinearGradient(-70, 0, 10, 0);
    pg.addColorStop(0, '#475569'); pg.addColorStop(0.4, '#cbd5e1'); pg.addColorStop(1, '#475569');
    g.fillStyle = pg;
    g.beginPath(); g.moveTo(-68, py); g.lineTo(4, py - 4); g.lineTo(4, py + 20); g.lineTo(-68, py + 24); g.closePath(); g.fill();
    // 压力表
    g.fillStyle = '#f8fafc'; g.beginPath(); g.arc(26, -138, 17, 0, TAU); g.fill();
    g.strokeStyle = '#cbd5e1'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = '#dc2626'; g.lineWidth = 3.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(26, -138); g.lineTo(35, -147); g.stroke();
    g.restore();
  },
  /* 彩带加农炮：粗炮管 + 彩带弹鼓 + 派对尖帽 */
  cannon(g, W, H, st) {
    const s = st.s, cx = W * 0.60 + st.sway * 16 * s, by = H * GUN_Y + st.recoil * 19 * s;
    g.save(); g.translate(cx, by); g.scale(s, s);
    g.rotate(-0.02 + st.reload * 0.62);
    // 握把
    g.save(); g.translate(-34, -30); g.rotate(0.2);
    metalBox(g, -22, 0, 44, 76, 12, '#27272a', '#71717a');
    g.restore();
    // 弹鼓
    g.save(); g.translate(26, -66);
    g.fillStyle = '#92400e'; g.beginPath(); g.arc(0, 0, 52, 0, TAU); g.fill();
    g.fillStyle = '#fde047';
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + st.spin; g.beginPath(); g.arc(Math.cos(a) * 32, Math.sin(a) * 32, 13, 0, TAU); g.fill(); }
    g.fillStyle = '#a16207'; g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.ellipse(-16, -20, 16, 9, -0.6, 0, TAU); g.fill();
    g.restore();
    // 炮管
    perspTube(g, 0, 52, 31, -104, -196, '#4c1d95', '#c4b5fd', true);
    g.fillStyle = '#2e1065'; g.beginPath(); g.ellipse(0, -196, 31, 10, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(-42, -186, 16, 5);
    // 管箍
    g.fillStyle = '#5b21b6'; g.fillRect(-48, -134, 96, 14);
    // 派对尖帽
    g.fillStyle = '#f8fafc';
    g.beginPath(); g.moveTo(-34, -196); g.lineTo(34, -196); g.lineTo(4, -300); g.closePath(); g.fill();
    for (let i = 0; i < 3; i++) {
      g.fillStyle = ['#ef4444', '#fbbf24', '#22c55e'][i];
      g.beginPath(); g.moveTo(-30 + i * 20, -196); g.lineTo(-18 + i * 20, -206); g.lineTo(-6 + i * 20, -196); g.closePath(); g.fill();
    }
    g.fillStyle = '#fbbf24'; g.beginPath(); g.arc(4, -304, 9, 0, TAU); g.fill();
    g.restore();
  },
  /* 纸带连发：喇叭口 + 旋转彩带轮 */
  blaster(g, W, H, st) {
    const s = st.s, cx = W * 0.60 + st.sway * 16 * s, by = H * GUN_Y + st.recoil * 15 * s;
    g.save(); g.translate(cx, by); g.scale(s, s);
    g.rotate(-0.03 + st.reload * 0.55);
    // 握把
    g.save(); g.translate(-32, -34); g.rotate(0.2);
    metalBox(g, -20, 0, 40, 74, 10, '#075985', '#38bdf8');
    g.restore();
    // 机匣
    const bg = g.createLinearGradient(-60, 0, 62, 0);
    bg.addColorStop(0, '#0e7490'); bg.addColorStop(0.32, '#67e8f9'); bg.addColorStop(0.7, '#22d3ee'); bg.addColorStop(1, '#155e75');
    g.fillStyle = bg;
    g.beginPath(); g.moveTo(-56, -44); g.lineTo(58, -44); g.lineTo(46, -120); g.lineTo(-48, -120); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-46, -114, 84, 9);
    // 喇叭口
    g.fillStyle = '#0e7490';
    g.beginPath(); g.moveTo(-48, -118); g.lineTo(46, -118); g.lineTo(66, -206); g.lineTo(-68, -206); g.closePath(); g.fill();
    g.fillStyle = '#155e75';
    g.beginPath(); g.moveTo(-68, -206); g.lineTo(66, -206); g.lineTo(60, -194); g.lineTo(-62, -194); g.closePath(); g.fill();
    g.fillStyle = 'rgba(125,211,252,0.4)'; g.fillRect(-40, -196, 20, 4);
    // 旋转彩带轮
    g.save(); g.translate(64, -74); g.rotate(st.spin * 2.6);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = ['#f472b6', '#fde047', '#4ade80', '#60a5fa', '#c084fc'][i];
      g.save(); g.rotate(i / 5 * TAU);
      g.beginPath(); g.moveTo(-7, -30); g.lineTo(7, -30); g.lineTo(5, 26); g.lineTo(-5, 26); g.closePath(); g.fill();
      g.restore();
    }
    g.fillStyle = '#083344'; g.beginPath(); g.arc(0, 0, 13, 0, TAU); g.fill();
    g.fillStyle = '#67e8f9'; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
    g.restore();
    g.restore();
  }
};

/** 卡通手套：气球乳胶掌 + 四指 + 拇指 */
function drawGlove(g, r, col, flip) {
  const f = flip ? -1 : 1;
  g.save(); g.scale(f, 1);
  // 手指（抓握）
  const fg = g.createLinearGradient(0, -r * 1.15, 0, -r * 0.3);
  fg.addColorStop(0, '#' + hex(mixC(col, C(0xffffff), 0.35)));
  fg.addColorStop(1, '#' + hex(shade(col, 0.82)));
  g.fillStyle = fg;
  for (let i = 0; i < 4; i++) {
    const x = -r * 0.62 + i * r * 0.42;
    const h = r * (0.95 - Math.abs(i - 1.2) * 0.14);
    g.beginPath(); g.roundRect(x, -r * 1.18, r * 0.34, h, r * 0.17); g.fill();
  }
  // 拇指
  g.save(); g.translate(-r * 0.62, -r * 0.55); g.rotate(-0.7);
  g.beginPath(); g.roundRect(-r * 0.16, -r * 0.62, r * 0.32, r * 0.9, r * 0.16); g.fill();
  g.restore();
  // 掌部
  const pg = g.createRadialGradient(-r * 0.3, -r * 0.5, r * 0.1, 0, 0, r * 1.3);
  pg.addColorStop(0, '#' + hex(mixC(col, C(0xffffff), 0.5)));
  pg.addColorStop(0.55, '#' + hex(col));
  pg.addColorStop(1, '#' + hex(shade(col, 0.6)));
  g.fillStyle = pg;
  g.beginPath();
  g.moveTo(-r * 0.86, -r * 0.42);
  g.quadraticCurveTo(-r * 0.98, r * 0.55, 0, r * 0.82);
  g.quadraticCurveTo(r * 0.98, r * 0.55, r * 0.86, -r * 0.42);
  g.quadraticCurveTo(r * 0.5, -r * 0.78, -r * 0.86, -r * 0.42);
  g.closePath(); g.fill();
  // 高光
  g.globalAlpha = 0.75; g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.ellipse(-r * 0.3, -r * 0.2, r * 0.24, r * 0.34, -0.4, 0, TAU); g.fill();
  g.globalAlpha = 1;
  g.restore();
}

/** 玩家双手：气球乳胶手套 */
function drawHands(g, W, H, st, col, recoil) {
  const s = st.s;
  const put = (x, y, r, rot, flip) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    drawGlove(g, r, col, flip);
    g.restore();
  };
  const cx = W * GUN_X, rk = (recoil || 0) * 26 * s;
  put(cx - 30 * s, H * (GUN_Y - 0.085) + st.bob * 5 * s + rk, 32 * s, 0.20, false);   // 左手扣扳机
  put(cx + 60 * s, H * (GUN_Y - 0.115) + st.bob * 5 * s + rk, 32 * s, -0.20, true);  // 右手托机匣
}

/** 屏幕上的一只气球手套（3D 里玩家看不见自己，用于 HUD 装饰） */
function makeHandIcon() {
  return mkIcon(48, 48, (g) => { g.save(); g.translate(24, 22); drawBalloon(g, 0, 0, 15, 17, C(0xff4d63), { shine: 1 }); g.restore(); });
}
function mkIcon(w, h, fn) {
  const cv = makeCanvas(w, h), g = cv.getContext('2d'); fn(g, w, h);
  const d = g.getImageData(0, 0, w, h).data, out = new Uint32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) out[i] = (d[j + 3] << 24) | (d[j + 2] << 16) | (d[j + 1] << 8) | d[j];
  const c2 = makeCanvas(w, h), g2 = c2.getContext('2d');
  const im = new ImageData(new Uint8ClampedArray(out.buffer), w, h);
  g2.putImageData(im, 0, 0);
  return c2;
}
