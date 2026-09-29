/* =========================================================================
   RENDER —— 光线投射引擎
   天空(全景贴图) → 地面(逐像素纹理投射) → 墙体(DDA + 烘焙光照 + 动态光) →
   地面贴花 → 精灵(角色/气球/粒子) → 动态光晕 → 后期合成
   ========================================================================= */
'use strict';

const FOGC = packRGB(198, 210, 255);
const R = {
  cv: null, ctx: null, fb: null, fctx: null, img: null, buf: null, zbuf: null,
  SW: 480, SH: 270, scale: 2, dpr: 1,
  projPlane: 333, camZ: 0.5, horizon: 135, planeX: 0, planeY: 0, dirX: 1, dirY: 0,
  lightMap: null, floorMap: null, lq: 3, lmw: 0, lmh: 0,
  drawList: [], skyRow: null, skyCol: null, rowU: null,
  stats: { sprites: 0 },

  init(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
    this.fb = makeCanvas(2, 2); this.fctx = this.fb.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  },

  resize() {
    const w = innerWidth, h = innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = Math.max(2, Math.floor(w * this.dpr));
    this.cv.height = Math.max(2, Math.floor(h * this.dpr));
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    // 整数倍放大，保留像素风格的锐利
    this.scale = clamp(Math.round(Math.min(w / 560, h / 315)), 2, 4);
    this.SW = Math.max(320, (Math.ceil(w / this.scale)) & ~1);
    this.SH = Math.max(180, (Math.ceil(h / this.scale)) & ~1);
    this.fb.width = this.SW; this.fb.height = this.SH;
    this.img = this.fctx.createImageData(this.SW, this.SH);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.zbuf = new Float32Array(this.SW);
    this.skyCol = new Int32Array(this.SW);
    this.skyRow = new Int32Array(this.SH);
    this.rowU = new Int32Array(this.SH);
    this.projPlane = (this.SW / 2) / 0.80;        // 水平视场约 77°
    this.ctx.imageSmoothingEnabled = false;
  },

  /* ---------- 烘焙光照贴图 + 地面材质贴图 ---------- */
  buildMaps() {
    const m = world.map, lq = this.lq;
    this.lmw = m.w * lq; this.lmh = m.h * lq;
    const n = this.lmw * this.lmh;
    const lm = new Float32Array(n), fm = new Float32Array(n);
    const lamps = world.lamps;
    for (let i = 0; i < lamps.length; i++) {
      const L = lamps[i];
      L.i = (L.col === C(0xffe0a0) ? 0.40 : 0.30) * (0.75 + 0.25 * ((i * 37) % 7) / 7);
    }
    for (let sy = 0; sy < this.lmh; sy++) {
      for (let sx = 0; sx < this.lmw; sx++) {
        const wx = (sx + 0.5) / lq, wy = (sy + 0.5) / lq;
        const cx = wx | 0, cy = wy | 0;
        const k = cy * m.w + cx;
        const solid = cx < 0 || cy < 0 || cx >= m.w || cy >= m.h || m.solid[k];
        const o = sy * this.lmw + sx;
        if (solid) { lm[o] = 0; fm[o] = 0; continue; }
        fm[o] = m.fs[k];
        let l = 0.66;                                  // 环境光
        for (let i = 0; i < lamps.length; i++) {
          const L = lamps[i];
          const dx = wx - L.x, dy = wy - L.y, dz = 0.46 - L.z;
          l += L.i / (1 + (dx * dx + dy * dy + dz * dz) * 2.2);
        }
        let occ = 0;                                   // 墙角环境光遮蔽
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const nx = cx + i, ny = cy + j;
          if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || m.solid[ny * m.w + nx]) occ++;
        }
        l *= 1 - occ * 0.030;
        lm[o] = l > 1.35 ? 1.35 : l;
      }
    }
    // 实心格继承相邻「空地」的最大光照（墙面取光点落在墙体内也不会死黑）
    for (let sy = 0; sy < this.lmh; sy++) for (let sx = 0; sx < this.lmw; sx++) {
      const wx = (sx + 0.5) / lq, wy = (sy + 0.5) / lq;
      if (!(m.solid[(wy | 0) * m.w + (wx | 0)])) continue;    // 只处理实心格
      const o = sy * this.lmw + sx;
      let best = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        if (!i && !j) continue;
        const nx = wx + i * 0.8, ny = wy + j * 0.8;
        const cx2 = nx | 0, cy2 = ny | 0;
        if (cx2 < 0 || cy2 < 0 || cx2 >= m.w || cy2 >= m.h) continue;
        if (m.solid[cy2 * m.w + cx2]) continue;
        const v = lm[(Math.min(this.lmh - 1, (ny * lq) | 0)) * this.lmw + Math.min(this.lmw - 1, (nx * lq) | 0)];
        if (v > best) best = v;
      }
      lm[o] = best > 0 ? Math.max(best * 0.94, 0.50) : 0.46;
    }
    this.lightMap = lm; this.floorMap = fm;
  },
  sampleLight(x, y) {
    const lm = this.lightMap; if (!lm) return 1;
    const lq = this.lq, w = this.lmw, h = this.lmh;
    let sx = x * lq - 0.5, sy = y * lq - 0.5;
    sx = sx < 0 ? 0 : (sx > w - 1.001 ? w - 1.001 : sx);
    sy = sy < 0 ? 0 : (sy > h - 1.001 ? h - 1.001 : sy);
    const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
    const w0 = y0 * w + x0, w1 = w0 + w;
    const a = lm[w0] + (lm[w0 + 1] - lm[w0]) * fx;
    const b = lm[w1] + (lm[w1 + 1] - lm[w1]) * fx;
    return a + (b - a) * fy;
  },
  sampleFloor(x, y) {
    const fm = this.floorMap; if (!fm) return 0;
    const lq = this.lq, w = this.lmw, h = this.lmh;
    let sx = x * lq - 0.5, sy = y * lq - 0.5;
    sx = sx < 0 ? 0 : (sx > w - 1.001 ? w - 1.001 : sx);
    sy = sy < 0 ? 0 : (sy > h - 1.001 ? h - 1.001 : sy);
    const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
    const w0 = y0 * w + x0, w1 = w0 + w;
    return fm[(fx > 0.5 ? w0 + 1 : w0) + (fy > 0.5 ? this.lmw : 0)];
  },

  /* ============================ 主渲染 ============================ */
  render(P) {
    const SW = this.SW, SH = this.SH, buf = this.buf, zbuf = this.zbuf;
    const map = world.map;
    if (!map) return;
    const md = map.solid, mw = map.w, mh = map.h;
    const a = P.a;
    const dirX = Math.cos(a), dirY = Math.sin(a);
    const planeS = SW / 2 / this.projPlane;
    const planeX = -dirY * planeS, planeY = dirX * planeS;
    const invDet = 1 / (planeX * dirY - dirX * planeY);   // 相机基行列式（符号决定精灵可见性）
    const px = P.x, py = P.y, camZ = this.camZ, pp = this.projPlane;
    const horizon = (SH * 0.5 + P.bobPix + P.pitchPix) | 0;
    this.dirX = dirX; this.dirY = dirY; this.planeX = planeX; this.planeY = planeY;
    this.horizon = horizon; this.invDet = invDet; this.px = px; this.py = py;
    this.stats.sprites = 0;
    const fr = cr(FOGC), fg = cg(FOGC), fb = cb(FOGC);

    /* ---------- 动态光源（枪口火光 / 爆炸） ---------- */
    const lights = [];
    for (let i = 0; i < fxList.length; i++) {
      const f = fxList[i], t = f.life / f.max;
      lights.push({ x: f.x, y: f.y, z: f.z, r: f.r, cr: cr(f.col), cg: cg(f.col), cb: cb(f.col), p: t * t * f.power });
    }
    if (P.flash > 0) {
      const c = P.flashCol;
      lights.push({ x: px + dirX * 0.7, y: py + dirY * 0.7, z: 0.5, r: 5 + P.flash * 4, cr: cr(c), cg: cg(c), cb: cb(c), p: P.flash * 1.6 });
    }

    /* ---------- 1. 天空 + 地面 ---------- */
    const sky = Art.sky.data;
    const vscale = 150 / pp;
    const skyH0 = SKYH * 0.58;
    const pAnX = -px * 10, pAnY = -py * 10;
    for (let y = 0; y < SH; y++) {
      this.skyRow[y] = ((skyH0 + (y - horizon) * vscale + pAnY) | 0) & (SKYH - 1);
    }
    for (let x = 0; x < SW; x++) this.skyCol[x] = (((2 * x / SW - 1) * 165 + pAnX) | 0) & (SKYW - 1);
    const floors = Art.floors;
    for (let y = 0; y < SH; y++) {
      const rowBase = y * SW;
      if (y < horizon) {
        const sv = this.skyRow[y] * SKYW;
        for (let x = 0; x < SW; x++) buf[rowBase + x] = sky[sv + this.skyCol[x]];
        continue;
      }
      const p = y - horizon;
      const rowDist = camZ * pp / p;
      if (rowDist > 42) {
        const c = packRGB((fr * 0.95) | 0, (fg * 0.96) | 0, (fb * 1.0) | 0);
        for (let x = 0; x < SW; x++) buf[rowBase + x] = c;
        continue;
      }
      let cx = px + rowDist * (dirX - planeX);
      let cy = py + rowDist * (dirY - planeY);
      const stX = rowDist * planeX * 2 / SW, stY = rowDist * planeY * 2 / SW;
      const fogT = clamp(1 - 1 / (1 + rowDist * rowDist * 0.0046), 0, 0.94);
      const ifg = 1 - fogT, ft = fogT;
      const y2r = (y + 1 < SH ? y + 1 : y) * SW;
      for (let x = 0; x < SW; x += 2) {
        const fs = this.sampleFloor(cx, cy);
        const i0 = fs | 0, t = fs - i0;
        const texA = floors[i0 % floors.length].data, texB = floors[(i0 + 1) % floors.length].data;
        const tx = ((cx * TEXW) | 0) & TMASK, ty = ((cy * TEXH) | 0) & TMASK;
        const idx = ty * TEXW + tx;
        const ca = texA[idx], cb2 = texB[idx];
        const l = this.sampleLight(cx, cy);
        const r = ((cr(ca) + (cr(cb2) - cr(ca)) * t) * l) * ifg + fr * ft;
        const g = ((cg(ca) + (cg(cb2) - cg(ca)) * t) * l) * ifg + fg * ft;
        const b = ((cb(ca) + (cb(cb2) - cb(ca)) * t) * l) * ifg + fb * ft;
        const c = packRGB(r > 255 ? 255 : r | 0, g > 255 ? 255 : g | 0, b > 255 ? 255 : b | 0);
        buf[rowBase + x] = c;
        if (x + 1 < SW) buf[rowBase + x + 1] = c;
        if (y + 1 < SH) { buf[y2r + x] = c; if (x + 1 < SW) buf[y2r + x + 1] = c; }
        cx += stX; cy += stY;
      }
    }

    /* ---------- 2. 墙体 ---------- */
    const wallData = Art.walls, nWall = Art.walls.length;
    for (let x = 0; x < SW; x++) {
      const camX = 2 * x / SW - 1;
      const rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
      let mapX = px | 0, mapY = py | 0;
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      const stepX = rdx < 0 ? -1 : 1, stepY = rdy < 0 ? -1 : 1;
      let sdx = (rdx < 0 ? (px - mapX) : (mapX + 1 - px)) * ddx;
      let sdy = (rdy < 0 ? (py - mapY) : (mapY + 1 - py)) * ddy;
      let side = 0, hit = 0, guard = 0, cix = -1, ciy = -1;
      while (guard++ < 160) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; }
        else { sdy += ddy; mapY += stepY; side = 1; }
        if (sdx > 100 && sdy > 100) break;
        if (mapX < 0 || mapY < 0 || mapX >= mw || mapY >= mh) { hit = 1; cix = clamp(mapX, 0, mw - 1); ciy = clamp(mapY, 0, mh - 1); break; }
        if (md[mapY * mw + mapX]) { hit = 1; cix = mapX; ciy = mapY; break; }
      }
      if (!hit) { zbuf[x] = 1e9; continue; }
      let dist = (side === 0 ? sdx - ddx : sdy - ddy);
      if (!(dist > 0.02)) dist = 0.02;
      zbuf[x] = dist;
      const lineH = pp / dist;
      const d0 = horizon - lineH * 0.5, d1 = horizon + lineH * 0.5;
      let wallU = (side === 0 ? py + dist * rdy : px + dist * rdx);
      wallU -= Math.floor(wallU);
      const hx = side === 0 ? cix + (rdx > 0 ? wallU : 1 - wallU) : px + dist * rdx;
      const hy = side === 1 ? ciy + (rdy > 0 ? wallU : 1 - wallU) : py + dist * rdy;
      // 取光点朝相机方向回退一点，落到地面格上
      const lx = hx - rdx * 0.34, ly = hy - rdy * 0.34;
      const y0 = Math.max(0, Math.ceil(d0)), y1 = Math.min(SH, Math.ceil(d1));
      if (y1 <= y0) continue;
      const fogT = clamp(1 - 1 / (1 + dist * dist * 0.0046), 0, 0.95);
      if (fogT > 0.988) { for (let y = y0; y < y1; y++) buf[y * SW + x] = FOGC; continue; }
      const tex = wallData[map.wt[ciy * mw + cix] % nWall];
      const data = tex.data, th = tex.h;
      const base = Math.max(this.sampleLight(lx, ly) * (side === 1 ? 0.72 : 1), side === 1 ? 0.53 : 0.58);
      let lcr = 0, lcg = 0, lcb = 0;
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        const ax = hx - L.x, ay = hy - L.y;
        const d2 = ax * ax + ay * ay;
        if (d2 > L.r * L.r) continue;
        const f = (1 - d2 / (L.r * L.r)) * L.p;
        lcr += L.cr * f; lcg += L.cg * f; lcb += L.cb * f;
      }
      const ifg = 1 - fogT, ft = fogT;
      const texX = ((wallU * TEXW) | 0) & TMASK;
      const yStep = th / lineH;
      for (let y = y0; y < y1; y++) {
        let v = ((y - d0) * yStep) | 0;
        v = v < 0 ? 0 : (v >= th ? th - 1 : v);
        const c = data[v * TEXW + texX];
        const r = cr(c) * base + lcr, g = cg(c) * base + lcg, b = cb(c) * base + lcb;
        const rr = r * ifg + fr * ft, gg = g * ifg + fg * ft, bb = b * ifg + fb * ft;
        buf[y * SW + x] = packRGB(rr > 255 ? 255 : rr | 0, gg > 255 ? 255 : gg | 0, bb > 255 ? 255 : bb | 0);
      }
      // 墙脚接触阴影
      const shRows = Math.min(Math.max(2, lineH * 0.16) | 0, y1 - y0);
      for (let i = 0; i < shRows; i++) {
        const y = y1 - 1 - i;
        if (y < y0) break;
        const c = buf[y * SW + x], s = 1 - (1 - i / shRows) * 0.45;
        buf[y * SW + x] = packRGB(cr(c) * s | 0, cg(c) * s | 0, cb(c) * s | 0);
      }
    }

    /* ---------- 3. 地面贴花（透视压扁） ---------- */
    for (const d of decals) {
      const rx = d.x - px, ry = d.y - py;
      const depth = invDet * (-planeY * rx + planeX * ry);
      if (depth <= 0.14) continue;
      const sxc = (SW / 2) * (1 + invDet * (dirY * rx - dirX * ry) / depth);
      const wpx = d.size * pp / depth;
      const hpx = Math.max(1, wpx * camZ / depth * 1.6);
      const yc = horizon + pp * camZ / depth;
      this.blitSprite(d.spr, sxc, wpx, yc - hpx * 0.5, hpx, 0.75, 0, null, 0, 0, depth);
    }

    /* ---------- 4. 精灵 ---------- */
    const list = this.drawList; list.length = 0;
    const FAR = 46;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead > 0) {
        if (e.dead > 0.16) list.push({ _d: (e.x - px) ** 2 + (e.y - py) ** 2, mode: 'defl', x: e.x, y: e.y, z: e.z, f: 1 - (e.dead - 0.16) / 0.26, type: e.type });
        continue;
      }
      list.push({ _d: (e.x - px) ** 2 + (e.y - py) ** 2, mode: 'actor', art: Art.actors[e.type], frame: e.frame, x: e.x, y: e.y, z: e.z, hurt: e.hurt, type: e.type });
    }
    for (let i = 0; i < balloons.length; i++) {
      const b = balloons[i];
      if (b.popT > 0) continue;
      const art = b.power ? Art.props.power[b.power] : Art.props.balloon[b.bi];
      list.push({ _d: (b.x - px) ** 2 + (b.y - py) ** 2, mode: 'spr', spr: art, x: b.x, y: b.y, z: b.z, w: 0.44, h: 0.66, rot: b.spin });
    }
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i], art = Art.props.pickup[p.kind];
      if (!art) continue;
      list.push({ _d: (p.x - px) ** 2 + (p.y - py) ** 2, mode: 'spr', spr: art, x: p.x, y: p.y, z: p.z + 0.14 + Math.sin(p.t * 3.2) * 0.05, w: 0.36, h: 0.36 });
    }
    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i];
      if (!p.spr) continue;
      list.push({ _d: (p.x - px) ** 2 + (p.y - py) ** 2, mode: 'proj', spr: p.spr, x: p.x, y: p.y, z: p.z, w: 0.44 * p.scale, h: 0.44 * p.scale, rot: p.spin, add: p.enemy === 2 ? 0.6 : 0 });
    }
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i], d2 = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d2 > 900) continue;                       // 30 单位外的碎屑直接丢弃
      if (p.kind === 'smoke') list.push({ _d: d2, mode: 'add', spr: Art.glow, x: p.x, y: p.y, z: p.z, s: p.size * 3.4, col: p.col, a: (p.life / p.max) * 0.45 });
      else if (p.z < 0.05) list.push({ _d: d2, mode: 'flat', x: p.x, y: p.y, s: p.size, col: p.col, rot: p.rot });
      else list.push({ _d: d2, mode: 'solid', x: p.x, y: p.y, z: p.z, s: p.size, col: p.col, rot: p.rot });
    }
    for (let i = 0; i < fxList.length; i++) {
      const f = fxList[i];
      list.push({ _d: (f.x - px) ** 2 + (f.y - py) ** 2, mode: 'add', spr: Art.muzzle, x: f.x, y: f.y, z: f.z, s: f.r * 1.6, col: f.col, a: f.life / f.max });
    }
    list.sort((A, B) => B._d - A._d);

    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      const rx = o.x - px, ry = o.y - py;
      const depth = invDet * (-planeY * rx + planeX * ry);
      if (depth <= 0.12) continue;
      const sxc = (SW / 2) * (1 + invDet * (dirY * rx - dirX * ry) / depth);
      const unit = pp / depth;
      switch (o.mode) {
        case 'actor': {
          const A = o.art, f = A.frames[o.frame % A.frames.length];
          const hpx = 0.92 * A.ph * unit, wpp = hpx * (A.w / A.h);
          this.blitSprite(f, sxc, wpp, horizon - (o.z - camZ) * unit - hpx, hpx, 1, o.hurt, 0, 0, 1, depth);
          break;
        }
        case 'spr': {
          const hpx = o.h * unit, wpp = o.w * unit;
          this.blitSprite(o.spr, sxc, wpp, horizon - (o.z - camZ) * unit - hpx, hpx, 1, 0, null, 0, 0.94, depth, o.rot);
          break;
        }
        case 'proj': {
          const hpx = o.h * unit, wpp = o.w * unit;
          this.blitSprite(o.spr, sxc, wpp, horizon - (o.z - camZ) * unit - hpx * 0.5, hpx, 1, 0, null, 0, 1, depth, o.rot, o.add);
          break;
        }
        case 'add': {
          let s = o.s * unit;
          if (s > 54) s = 54; else if (s < 2) s = 2;
          this.blitSprite(o.spr, sxc, s, horizon - (o.z - camZ) * unit - s * 0.5, s, o.a, 0, null, 0, 1, depth, 0, 1);
          break;
        }
        case 'solid': {
          const s = o.s * unit;
          this.drawSolid(sxc, s, horizon - (o.z - camZ) * unit - s * 0.5, s, o.col, 1, depth, o.rot);
          break;
        }
        case 'flat': {
          const s = o.s * unit, h = Math.max(1, s * camZ / depth * 1.2);
          this.drawSolid(sxc, s, horizon + pp * camZ / depth - h * 0.5, h, o.col, 0.9, depth, o.rot);
          break;
        }
        case 'defl': {
          const sp = Art.deflate[clamp(4 - Math.floor(o.f * 5), 0, 4)];
          const s = 0.55 * unit * (0.5 + o.f * 0.7);
          this.blitSprite(sp, sxc, s, horizon - (o.z - camZ) * unit - s * 0.5, s, 1, 0, null, 0, 0.95, depth, 0, 0.4);
          break;
        }
      }
      this.stats.sprites++;
    }
    // 飘字投影（交给 HUD 画）
    for (let i = 0; i < popups.length; i++) {
      const p = popups[i];
      const rx = p.x - px, ry = p.y - py;
      const depth = invDet * (-planeY * rx + planeX * ry);
      if (depth <= 0.1) { p.sx = -9999; p.sy = -9999; continue; }
      p.sx = (SW / 2) * (1 + invDet * (dirY * rx - dirX * ry) / depth);
      p.sy = horizon - (p.z - camZ) * pp / depth - (p.life * 0.9) * pp / depth;
    }

    this.fctx.putImageData(this.img, 0, 0);
  },

  /* ---------- 带纹理精灵（垂直 billboard，含 z 遮挡测试） ---------- */
  blitSprite(sp, sxc, wpx, yTop, hpx, alpha, hurt, tint, add, lightK, depth, rot, addMode) {
    if (!sp) return;
    const SW = this.SW, SH = this.SH, buf = this.buf, zbuf = this.zbuf;
    if (wpx < 1.1 || hpx < 0.6) return;
    const spw = sp.w, sph = sp.h, data = sp.data;
    const wide = rot ? Math.abs(Math.sin(rot)) * hpx * 0.5 : 0;
    const left = Math.floor(sxc - wpx * 0.5 - wide), right = Math.ceil(sxc + wpx * 0.5 + wide);
    const yb0 = Math.max(0, Math.floor(yTop)), yb1 = Math.min(SH, Math.ceil(yTop + hpx));
    if (left >= SW || right <= 0 || yb1 <= yb0) return;
    const xStep = wpx / spw, yStep = hpx / sph;
    const skew = rot ? Math.tan(rot) * 0.5 : 0;
    const hurtK = hurt && hurt > 0 ? Math.min(1, hurt) : 0;
    if (depth < 0.35) return;
    for (let x = Math.max(0, left); x < Math.min(SW, right); x++) {
      if (zbuf[x] < depth) continue;
      for (let y = yb0; y < yb1; y++) {
        let u = ((x - left) * xStep) | 0;
        let v = ((y - yTop) * yStep) | 0;
        if (rot) u = ((x - sxc + (y - yTop) * skew) * xStep) | 0;
        if (u < 0 || u >= spw || v < 0 || v >= sph) continue;
        const c = data[v * spw + u];
        const al = c >>> 24;
        if (al < 6) continue;
        let r = cr(c) * lightK, g = cg(c) * lightK, b = cb(c) * lightK;
        if (hurtK) { r = r + (255 - r) * hurtK; g = g + (245 - g) * hurtK; b = b + (245 - b) * hurtK; }
        if (tint) { r = r * (1 - tint); g = g * (1 - tint); b = b * (1 - tint) + 255 * tint; }
        const k = y * SW + x, dst = buf[k];
        if (add > 0 || addMode) {
          const k2 = (add > 0 ? add : 0.7) * (al / 255);
          let nr = cr(dst) + r * k2, ng = cg(dst) + g * k2, nb = cb(dst) + b * k2;
          buf[k] = packRGB(nr > 255 ? 255 : nr | 0, ng > 255 ? 255 : ng | 0, nb > 255 ? 255 : nb | 0);
        } else {
          const f = (al / 255) * alpha;
          buf[k] = packRGB((cr(dst) * (1 - f) + r * f) | 0, (cg(dst) * (1 - f) + g * f) | 0, (cb(dst) * (1 - f) + b * f) | 0);
        }
      }
    }
  },
  /* 纯色方块（彩纸 / 乳胶碎片），可旋转 */
  drawSolid(sxc, w, yTop, h, col, light, depth, rot) {
    const SW = this.SW, SH = this.SH, buf = this.buf, zbuf = this.zbuf;
    if (w < 0.6) w = 0.6; if (h < 0.6) h = 0.6;
    const pad = rot ? (Math.abs(Math.cos(rot)) + Math.abs(Math.sin(rot))) * 0.5 : 0;
    const left = Math.floor(sxc - w * (0.5 + pad)), right = Math.ceil(sxc + w * (0.5 + pad));
    const y0 = Math.max(0, Math.floor(yTop - h * pad)), y1 = Math.min(SH, Math.ceil(yTop + h * (0.5 + pad)));
    if (left >= SW || right <= 0 || y1 <= y0) return;
    const near = clamp((depth - 1.0) / 1.1, 0, 1);
    if (near <= 0.01) return;
    const r = cr(col) * light, g = cg(col) * light, b = cb(col) * light;
    const a = 0.94 * near, ia = 1 - a;
    const hw = w * 0.5, hh = h * 0.5;
    const cs = rot ? Math.cos(rot) : 1, sn = rot ? Math.sin(rot) : 0;
    for (let x = Math.max(0, left); x < Math.min(SW, right); x++) {
      if (zbuf[x] < depth) continue;
      for (let y = y0; y < y1; y++) {
        let u = (x - sxc) / hw, v = (y - yTop - hh) / hh;
        if (rot) { const nu = u * cs + v * sn, nv = -u * sn + v * cs; u = nu; v = nv; }
        if (u < -1 || u > 1 || v < -1 || v > 1) continue;
        const k = y * SW + x, d = buf[k];
        buf[k] = packRGB((cr(d) * ia + r * a) | 0, (cg(d) * ia + g * a) | 0, (cb(d) * ia + b * a) | 0);
      }
    }
  },
  present() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.fb, 0, 0, this.cv.width, this.cv.height);
  }
};
