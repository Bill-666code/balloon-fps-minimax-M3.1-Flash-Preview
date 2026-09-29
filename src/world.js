/* =========================================================================
   WORLD —— 程序化地图构建 / 敌人 AI / 气球物理 / 弹道 / 粒子
   ========================================================================= */
'use strict';

const world = {
  map: null, name: '', lamps: [], w: 0, h: 0,
  fx: 0, fz: 0, fy: 0              // 雾颜色
};
let enemies = [], balloons = [], pickups = [], projectiles = [], particles = [], decals = [], popups = [], floaters = [];

/* ============================ 地图构建器 ============================ */
function MapB(w, h) {
  this.w = w; this.h = h;
  this.solid = new Uint8Array(w * h).fill(1);
  this.fs = new Uint8Array(w * h);      // 地面样式
  this.ws = new Uint8Array(w * h);      // 墙面样式
  this.wt = new Uint8Array(w * h);      // 墙面贴图索引
}
MapB.prototype.idx = function (x, y) { return y * this.w + x; };
MapB.prototype.open = function (x, y, w, h, fs) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
    const k = this.idx(i, j); this.solid[k] = 0; if (fs !== undefined) this.fs[k] = fs;
  }
};
MapB.prototype.block = function (x, y, w, h, fs) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
    const k = this.idx(i, j); this.solid[k] = 1; if (fs !== undefined) this.fs[k] = fs;
  }
};
MapB.prototype.pillar = function (x, y) { this.block(x, y, 1, 1); };
MapB.prototype.border = function () { this.block(0, 0, this.w, 1); this.block(0, this.h - 1, this.w, 1); this.block(0, 0, 1, this.h); this.block(this.w - 1, 0, 1, this.h); };
/** 收尾：把贴图附近的实心格按最近的地面样式上色 */
MapB.prototype.finalize = function (startX, startY) {
  for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
    const k = this.idx(x, y);
    if (!this.solid[k]) continue;
    let style = 0, best = -1;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    for (const [dx, dy] of nb) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const nk = this.idx(nx, ny);
      if (this.solid[nk]) continue;
      const s = this.fs[nk];
      if (s === style) { best += 2; } else { if (best < 2) { best = 1; style = s; } }
    }
    this.ws[k] = style;
    const hv = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    this.wt[k] = style * 2 + (hv % 3 === 0 ? 1 : 0);
  }
  this.start = { x: startX + 0.5, y: startY + 0.5 };
  this.floors = [];
  for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (!this.solid[this.idx(x, y)]) this.floors.push({ x: x + 0.5, y: y + 0.5, s: this.fs[this.idx(x, y)] });
  return this;
};

/* ---------- 三个关卡（全部代码构建） ---------- */
function mapCastle() {
  const M = new MapB(46, 34);
  M.border();
  M.open(14, 8, 18, 18, 0);            // 中央大厅
  M.open(3, 3, 9, 9, 1);               // 四角塔
  M.open(34, 3, 9, 9, 2);
  M.open(3, 22, 9, 9, 2);
  M.open(34, 22, 9, 9, 3);
  M.open(11, 7, 3, 2, 0); M.open(11, 25, 3, 2, 0);   // 塔↔大厅 走廊
  M.open(32, 7, 3, 2, 0); M.open(32, 25, 3, 2, 0);
  M.open(3, 14, 40, 3, 1);             // 横向长廊
  M.open(21, 3, 3, 28, 2);             // 纵向长廊
  // 大厅立柱
  for (const [x, y] of [[17, 11], [25, 11], [17, 22], [25, 22], [21, 15], [21, 18]]) M.pillar(x, y);
  // 塔内小柱
  for (const [x, y] of [[6, 6], [39, 6], [6, 28], [39, 28]]) M.pillar(x, y);
  // 装饰性短墙（增加掩体与走位）
  M.block(10, 10, 1, 4); M.block(35, 10, 1, 4);
  M.block(10, 20, 1, 4); M.block(35, 20, 1, 4);
  return M.finalize(22, 17);
}
function mapArena() {
  const M = new MapB(40, 32);
  M.border();
  M.open(2, 2, 36, 28, 0);
  // 中央环形
  for (let a = 0; a < 360; a += 30) {
    const r = 7.2, x = Math.round(20 + Math.cos(a * PI / 180) * r), y = Math.round(16 + Math.sin(a * PI / 180) * r * 0.8);
    M.pillar(x, y);
  }
  // 四角掩体
  for (const [cx, cy] of [[7, 7], [32, 7], [7, 25], [32, 25]]) {
    M.block(cx - 1, cy - 2, 3, 1); M.block(cx - 1, cy + 2, 3, 1);
    M.block(cx - 2, cy - 1, 1, 3); M.block(cx + 2, cy - 1, 1, 3);
  }
  // 侧向掩体条
  M.block(12, 4, 1, 5); M.block(27, 4, 1, 5); M.block(12, 23, 1, 5); M.block(27, 23, 1, 5);
  M.block(4, 15, 6, 1); M.block(30, 15, 6, 1);
  M.open(19, 2, 2, 28, 1);            // 中央十字通道（另一种地面）
  M.open(2, 15, 36, 2, 1);
  return M.finalize(20, 16);
}
function mapMaze(seed) {
  const W = 45, H = 37;
  const M = new MapB(W, H);
  M.border();
  const r = mulberry32(seed);
  // 递归回溯挖通道（1 格宽走廊，交汇处开成 2x2 更好走）
  const seen = new Uint8Array(W * H);
  const st = [[2, 2]]; seen[2 * W + 2] = 1; M.open(2, 2, 1, 1, 0);
  const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  while (st.length) {
    const [cx, cy] = st[st.length - 1];
    const opts = dirs.filter(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      return nx > 1 && ny > 1 && nx < W - 2 && ny < H - 2 && !seen[ny * W + nx];
    });
    if (!opts.length) { st.pop(); continue; }
    const [dx, dy] = opts[Math.floor(r() * opts.length)];
    const nx = cx + dx, ny = cy + dy;
    seen[ny * W + nx] = 1;
    M.open(cx + dx / 2, cy + dy / 2, Math.abs(dx) || 1, Math.abs(dy) || 1, 0);
    M.open(nx, ny, 1, 1, 0);
    if (r() < 0.22) M.open(nx - 1, ny - 1, 2, 2, r() < 0.5 ? 1 : 2);  // 随机开小广场
    st.push([nx, ny]);
  }
  // 起点挖一个小广场，避免开局对着墙
  M.open(1, 1, 5, 5, 0);
  M.pillar(2, 4); M.pillar(4, 2);
  // 打通几个环路，避免纯死胡同
  for (let i = 0; i < 14; i++) {
    const x = 3 + Math.floor(r() * (W - 6)), y = 3 + Math.floor(r() * (H - 6));
    if (M.solid[y * W + x]) { M.open(x, y, 2, 1, 1); M.open(x, y, 1, 2, 1); }
  }
  return M.finalize(1, 1);
}

const LEVELS = [
  { name: '充气城堡', sub: 'BOUNCE CASTLE', build: mapCastle, sky: 0, waves: 1 },
  { name: '派对竞技场', sub: 'PARTY ARENA', build: mapArena, sky: 1, waves: 4 },
  { name: '气球迷宫', sub: 'BALLOON MAZE', build: () => mapMaze(97531), sky: 2, waves: 7 }
];

function loadLevel(i) {
  const L = LEVELS[i % LEVELS.length];
  const M = L.build();
  world.map = M; world.name = L.name; world.sub = L.sub; world.w = M.w; world.h = M.h;
  world.skyIdx = L.sky;
  world.levelIndex = i;
  // 灯：贴墙的暖色串灯
  world.lamps = [];
  for (let y = 1; y < M.h - 1; y++) for (let x = 1; x < M.w - 1; x++) {
    const k = y * M.w + x;
    if (M.solid[k]) continue;
    if (M.solid[k - 1] || M.solid[k + 1] || M.solid[k - M.w] || M.solid[k + M.w]) {
      const h = hash2(x, y);
      if (h > 0.70) world.lamps.push({ x: x + 0.5, y: y + 0.5, z: 0.42, r: 2.6 + h, col: h > 0.75 ? C(0xffe0a0) : C(0xffd0f0) });
    }
  }
  // 重置实体
  enemies = []; balloons = []; pickups = []; projectiles = []; particles = []; decals = []; popups = [];
  // 布置气球
  const rndB = mulberry32(1000 + i * 77);
  for (const f of M.floors) {
    if (rndB() < 0.10) spawnBalloon(f.x + (rndB() - 0.5) * 0.4, f.y + (rndB() - 0.5) * 0.4, rndB);
  }
  return M.start;
}

/* ============================ 碰撞与视线 ============================ */
function isSolid(x, y) {
  const m = world.map;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return 1;
  return m.solid[y * m.w + x];
}
function blockedAt(x, y, r) {
  return isSolid(x - r, y - r) || isSolid(x + r, y - r) || isSolid(x - r, y + r) || isSolid(x + r, y + r);
}
function moveWithCollision(o, dx, dy) {
  if (!blockedAt(o.x + dx, o.y, o.r)) o.x += dx;
  else o.hitX = 1;
  if (!blockedAt(o.x, o.y + dy, o.r)) o.y += dy;
  else o.hitY = 1;
}
/** DDA 视线检测 */
function losClear(x0, y0, x1, y1) {
  let dx = x1 - x0, dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d < 0.001) return true;
  dx /= d; dy /= d;
  let t = 0, step = 0.08;
  while (t < d) {
    if (isSolid(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
    t += step;
  }
  return true;
}
/** 圆与墙体射线求交（返回 {dist, hit}），用于子弹 */
function castRay(px, py, dx, dy, maxD) {
  let mapX = Math.floor(px), mapY = Math.floor(py);
  const deltaX = Math.abs(1 / dx), deltaY = Math.abs(1 / dy);
  const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
  let sideDistX = dx < 0 ? (px - mapX) * deltaX : (mapX + 1 - px) * deltaX;
  let sideDistY = dy < 0 ? (py - mapY) * deltaY : (mapY + 1 - py) * deltaY;
  let side = 0, guard = 0;
  while (guard++ < 256) {
    if (sideDistX < sideDistY) { sideDistX += deltaX; mapX += stepX; side = 0; }
    else { sideDistY += deltaY; mapY += stepY; side = 1; }
    if (sideDistX > maxD && sideDistY > maxD) return { dist: maxD, hit: 0, x: px + dx * maxD, y: py + dy * maxD };
    if (mapX < 0 || mapY < 0 || mapX >= world.w || mapY >= world.h || world.map.solid[mapY * world.map.w + mapX])
      return { dist: side === 0 ? sideDistX - deltaX : sideDistY - deltaY, hit: 1, x: px + dx * (side === 0 ? sideDistX - deltaX : sideDistY - deltaY), y: py + dy * (side === 0 ? sideDistX - deltaX : sideDistY - deltaY), side };
  }
  return { dist: maxD, hit: 0, x: px + dx * maxD, y: py + dy * maxD };
}

/* ============================ 实体 ============================ */
function spawnBalloon(x, y, r = Math.random, power = null) {
  const bi = Math.floor(r() * 7);
  balloons.push({
    x, y, z: 0.28 + r() * 0.28, vz: 0, vx: (r() - 0.5) * 0.25, vy: (r() - 0.5) * 0.25,
    r: 0.22, ph: r() * TAU, col: BALLOON_COLORS[bi], bi, power, hp: 1, alive: true, t: r() * 10
  });
}
function spawnEnemy(type, x, y) {
  const D = ACTOR_DEFS[type];
  const e = {
    type, D, x, y, z: D.z, vx: 0, vy: 0, r: D.r * 0.55, hp: D.hp, maxhp: D.hp,
    frame: 0, ft: Math.random() * 10, dead: 0, hurt: 0, atkCd: rand(0.4, 1.4),
    jink: Math.random() * TAU, jinkCd: 0, shootCd: rand(0.6, 2), burst: 0, phase: 0, ph: Math.random() * TAU,
    kb: 0, kbx: 0, kby: 0, touchCd: 0, st: 0
  };
  enemies.push(e);
  return e;
}
/** 随机掉落一个道具气球 */
function spawnPowerBalloon(x, y) {
  const bc = Object.keys(Art.props.power);
  spawnBalloon(x, y, Math.random, bc[Math.floor(Math.random() * bc.length)]);
}
function spawnPickup(kind, x, y, z = 0) {
  pickups.push({ kind, x, y, z: z || 0, vy: 2.2, t: 0, life: 26, taken: 0 });
}
function spawnProjectile(o) {
  projectiles.push(Object.assign({ x: 0, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, dmg: 10, life: 3, enemy: 0, r: 0.12, arcing: 0, spr: null, scale: 1, spin: 0, trail: 0 }, o));
}
function spawnParticle(o) {
  if (particles.length > 560) particles.shift();
  const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 1, size: 0.06, col: C(0xffffff), grav: 1, drag: 0.9, kind: 'bit', spin: 0, rot: 0, glow: 0 };
  for (const k in o) if (o[k] !== undefined && o[k] !== null) p[k] = o[k];
  particles.push(p);
}
function spawnDecal(x, y, spr, size, life = 30, col = C(0xffffff)) {
  if (decals.length > 120) decals.shift();
  decals.push({ x, y, spr, size, life, max: life, rot: rand(TAU), col });
}
function spawnPopup(x, y, z, text, col, size, life = 1.0) {
  popups.push({ x, y, z, text, col, size, life, max: life });
}

/* ---------- 爆裂特效 ---------- */
function popFx(x, y, z, col, big = 1, quiet = false) {
  const n = Math.min(26, 8 + big * 10);
  for (let i = 0; i < n; i++) {
    const a = rand(TAU), sp = rand(0.6, 3.4) * big;
    spawnParticle({
      x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.6, 3.2) * big,
      life: rand(0.5, 1.1), max: 1.1, size: rand(0.022, 0.058), col: rainbowC(rnd()), grav: 0.85, kind: 'confetti', spin: rand(-12, 12)
    });
  }
  for (let i = 0; i < 6; i++) {   // 乳胶碎片
    const a = rand(TAU), sp = rand(1, 3) * big;
    spawnParticle({
      x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.4, 2.2),
      life: rand(0.4, 0.9), max: 0.9, size: rand(0.04, 0.10), col, grav: 0.9, kind: 'latex', spin: rand(-8, 8)
    });
  }
  for (let i = 0; i < 2; i++) {   // 雾气
    const a = rand(TAU), sp = rand(0.2, 1.2);
    spawnParticle({
      x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.2, 0.9),
      life: rand(0.35, 0.7), max: 0.7, size: rand(0.1, 0.2), col: C(0xffffff), grav: -0.05, drag: 0.86, kind: 'smoke', spin: rand(-2, 2)
    });
  }
  if (!quiet) Sound.pop(panFor(x, y), big, 0.45);
}
function panFor(x, y) {
  if (!window.P) return 0;
  const dx = x - P.x, dy = y - P.y;
  const d = Math.hypot(dx, dy) || 1;
  const c = Math.cos(P.a), s = Math.sin(P.a);
  return clamp(((dx * c - dy * s) / d) * 0.8, -1, 1);
}

/* ============================ 敌人 AI ============================ */
const AI = {
  boinger: { spd: 1.0, touch: 13, atkCd: 0.9, kb: 7 },
  floaty: { spd: 1.15, touch: 11, atkCd: 0.9, kb: 6, hover: 1 },
  darter: { spd: 0.95, touch: 7, atkCd: 1.0, kb: 5, range: 8, shootCd: 1.7, burst: 3 },
  bomber: { spd: 1.55, touch: 0, atkCd: 9, kb: 10, explode: 46, radius: 2.1, fuse: 0.45 },
  chonk: { spd: 0.8, touch: 27, atkCd: 1.15, kb: 12 },
  boss: { spd: 0.95, touch: 24, atkCd: 1.0, kb: 8, range: 9, shootCd: 2.0, burst: 5 }
};

function updateEnemies(dt) {
  const alive = [];
  for (const e of enemies) {
    if (e.dead > 0) { e.dead -= dt; if (e.dead > 0) { updateDeflate(e, dt); continue; } }
    const A = AI[e.type];
    const dx = P.x - e.x, dy = P.y - e.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const nx = dx / dist, ny = dy / dist;
    e.ft += dt * (e.D.speed * 2.2);
    e.hurt = Math.max(0, e.hurt - dt * 4);
    e.touchCd = Math.max(0, e.touchCd - dt);
    e.atkCd = Math.max(0, e.atkCd - dt);
    e.shootCd = Math.max(0, e.shootCd - dt);
    e.jinkCd -= dt;
    if (e.jinkCd <= 0) { e.jinkCd = rand(0.6, 1.8); e.jink = rand(-0.9, 0.9); }

    let spd = e.D.speed * A.spd;
    let mx = nx, my = ny;

    switch (e.type) {
      case 'darter': {
        // 保持距离 + 侧移
        const want = A.range;
        if (dist < want * 0.65) { mx = -nx; my = -ny; }
        else if (dist < want * 0.95) { mx = -ny + e.jink; my = nx - e.jink; }
        else { mx = -ny + e.jink; my = nx - e.jink; }
        const L = Math.hypot(mx, my) || 1; mx /= L; my /= L;
        if (e.shootCd <= 0 && losClear(e.x, e.y, P.x, P.y)) {
          e.shootCd = A.shootCd; e.burst = A.burst; e.burstT = 0;
        }
        break;
      }
      case 'boss': {
        e.phaseT = (e.phaseT || 0) + dt;
        const ph = Math.floor(e.hp / e.maxhp * 3);  // 0..2 阶段
        if (e.phaseT > 4.5 - ph * 0.8) {
          e.phaseT = 0;
          if (ph >= 1 && e.summons < 3 + ph) {
            e.summons++; spawnEnemy('boinger', e.x + rand(-1.2, 1.2), e.y + rand(-1.2, 1.2));
            for (let i = 0; i < 4; i++) popFx(e.x, e.y, 0.4, C(0xffd93d), 0.6, true);
          }
        }
        if (dist < A.range) { mx = -nx * 0.8 - ny * 0.6; my = -ny * 0.8 + nx * 0.6; }
        if (e.shootCd <= 0 && losClear(e.x, e.y, P.x, P.y)) { e.shootCd = A.shootCd; e.burst = A.burst; e.burstT = 0; }
        break;
      }
      case 'bomber': {
        if (dist < 1.0 && e.atkCd <= 0) { explodeEnemy(e, A); continue; }
        if (dist < A.radius && e.atkCd > 0.6) { /* 接近后引信开始滴答 */ }
        break;
      }
    }
    // 连发
    if (e.burst > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burstT = 0.13; e.burst--;
        const a = Math.atan2(ny, nx) + rand(-0.07, 0.07);
        spawnProjectile({
          x: e.x, y: e.y, z: 0.42, vx: Math.cos(a) * 11, vy: Math.sin(a) * 11, dmg: 9, enemy: 1,
          spr: Art.props.dart, scale: 1, spin: a, life: 2.6, r: 0.18
        });
        Sound.shootPopper(panFor(e.x, e.y) * 0.5);
      }
    }
    // 避障：前方受阻则绕行
    const probe = 0.55;
    if (blockedAt(e.x + mx * probe, e.y + my * probe, e.r)) {
      const a1 = Math.atan2(my, mx) + 1.1, a2 = Math.atan2(my, mx) - 1.1;
      const t1 = [Math.cos(a1), Math.sin(a1)], t2 = [Math.cos(a2), Math.sin(a2)];
      const ok1 = !blockedAt(e.x + t1[0] * probe, e.y + t1[1] * probe, e.r);
      mx = ok1 ? t1[0] : t2[0]; my = ok1 ? t1[1] : t2[1];
    }
    e.vx = mx * spd + e.kbx; e.vy = my * spd + e.kby;
    e.kbx *= Math.pow(0.02, dt); e.kby *= Math.pow(0.02, dt);
    moveWithCollision(e, e.vx * dt, e.vy * dt);
    // 悬浮高度
    if (A.hover) e.z = D_hover(e, dt);
    // 接触伤害
    if (A.touch > 0 && dist < 0.75 + e.r && e.touchCd <= 0) {
      e.touchCd = A.atkCd;
      damagePlayer(A.touch, nx, ny, e.type === 'chonk' ? A.kb : 3);
      e.kbx = -nx * A.kb; e.kby = -ny * A.kb;
    }
    e.frame = Math.floor((e.ft / TAU * e.D.frames) % e.D.frames);
    e.sx = e.x; e.sy = e.y;
    alive.push(e);
  }
  enemies = alive;
}
function D_hover(e, dt) {
  return 0.34 + Math.sin(perfNow * 2 + e.ph) * 0.06;
}
let perfNow = 0;

function explodeEnemy(e, A) {
  e.dead = 0.001; e.exploding = 1;
  // 范围伤害
  const d = Math.hypot(P.x - e.x, P.y - e.y);
  if (d < A.radius) {
    const f = 1 - d / A.radius;
    damagePlayer(A.explode * f, (P.x - e.x) / (d || 1), (P.y - e.y) / (d || 1), 8 * f);
  }
  for (let i = 0; i < 16; i++) {
    const a = rand(TAU), sp = rand(1, 5);
    spawnParticle({ x: e.x, y: e.y, z: 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(1, 4), life: rand(0.3, 0.7), max: 0.7, size: rand(0.03, 0.07), col: rainbowC(rnd()), grav: 0.7, kind: 'confetti', spin: rand(-10, 10), glow: 1 });
  }
  Sound.explosion(panFor(e.x, e.y), 0.6);
  game.shake(9, 0.3);
  fxAdd({ x: e.x, y: e.y, z: 0.5, r: 3.2, life: 0.28, max: 0.28, col: C(0xffc46b), power: 1.6 });
  for (let i = 0; i < 4; i++) {
    const a = rand(TAU);
    spawnProjectile({ x: e.x, y: e.y, z: 0.3, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, vz: rand(1, 3), dmg: 0, enemy: 2, life: 0.5, arcing: 1, spr: Art.props.shell, scale: 0.7, spin: rand(10) });
  }
  killEnemy(e, false, 0.6);
}
function killEnemy(e, byPlayer = true, chainScale = 1) {
  if (e.dead > 0) return;
  e.dead = 0.42;
  const big = e.type === 'boss' ? 3.2 : (e.type === 'chonk' ? 1.8 : 1);
  popFx(e.x, e.y, 0.45, e.D.head, big);
  game.onEnemyKilled(e, byPlayer);
  if (e.type === 'boss') { game.shake(16, 0.7); Sound.explosion(0, 0.9); }
}
function updateDeflate(e, dt) {
  e.z = Math.max(0, e.z - dt * 1.1);
  e.x += e.kbx * dt * 0.3; e.y += e.kby * dt * 0.3;
}

/* ============================ 气球 ============================ */
function updateBalloons(dt) {
  const out = [];
  for (const b of balloons) {
    if (b.popT > 0) { b.popT -= dt; if (b.popT > 0) continue; }
    b.t += dt;
    b.ph += dt;
    b.z = 0.30 + Math.sin(b.ph * 1.3) * 0.09;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (blockedAt(b.x, b.y, 0.1)) { b.vx *= -1; b.vy *= -1; b.x += b.vx * dt; b.y += b.vy * dt; }
    b.vx *= Math.pow(0.6, dt); b.vy *= Math.pow(0.6, dt);
    b.spin = Math.sin(b.ph * 0.9) * 0.16;
    out.push(b);
  }
  balloons = out;
}

/* ============================ 掉落物 ============================ */
function updatePickups(dt) {
  const out = [];
  for (const p of pickups) {
    p.t += dt; p.life -= dt;
    if (p.life <= 0) continue;
    if (p.vy > 0 || p.z > 0) { p.vy -= 12 * dt; p.z += p.vy * dt; if (p.z < 0) { p.z = 0; p.vy = Math.abs(p.vy) * 0.35; if (p.vy < 0.4) p.vy = 0; } }
    const d = Math.hypot(p.x - P.x, p.y - P.y);
    if (d < 1.1 && p.z < 1.0) {                       // 磁吸
      const a = Math.atan2(P.y - p.y, P.x - p.x);
      p.x += Math.cos(a) * dt * 4.5; p.y += Math.sin(a) * dt * 4.5;
    }
    if (d < 0.45) { collect(p); continue; }
    out.push(p);
  }
  pickups = out;
}
function collect(p) {
  switch (p.kind) {
    case 'health': P.hp = Math.min(P.maxhp, P.hp + 34); Sound.heal(); game.toast('+34 生命', C(0x4ade80)); break;
    case 'ammo': for (const k of WEAPON_ORDER) game.ammo[k] = Math.min(WEAPON_DEFS[k].reserveMax, game.ammo[k] + (k === 'blaster' ? 120 : k === 'pump' ? 18 : k === 'cannon' ? 8 : 40)); Sound.pickup(); game.toast('弹药补给', C(0xfbbf24)); break;
    case 'nade': game.nades = Math.min(6, game.nades + 2); Sound.pickup(); game.toast('+2 彩带榴弹 (G 投掷)', C(0xf87171)); break;
    case 'shield': P.shield = Math.min(100, P.shield + 60); Sound.pickup(); game.toast('+60 护盾', C(0xa78bfa)); break;
  }
}

/* ============================ 弹道 ============================ */
function updateProjectiles(dt) {
  const out = [];
  for (const p of projectiles) {
    p.life -= dt;
    if (p.life <= 0) { if (p.enemy === 2) confettiBurst(p); continue; }
    if (p.arcing) { p.vz -= 9 * dt; }
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = (p.z || 0) + (p.vz || 0) * dt;
    if (p.arcing) p.z = nz;
    // 撞墙
    if (isSolid(Math.floor(nx), Math.floor(ny))) {
      if (p.enemy === 2) { p.x = p.x; p.y = p.y; p.z = Math.max(0.05, p.z); confettiBurst(p); }
      else if (p.enemy === 1) { Sound.splat(panFor(p.x, p.y), 0.25); spawnDecal(p.x, p.y, Art.props.hole, 0.18, 8); }
      else { burstShell(p); }
      continue;
    }
    if (p.arcing && p.z <= 0.02) { confettiBurst(p); continue; }
    p.x = nx; p.y = ny;
    if (p.enemy === 1) {
      const d = Math.hypot(p.x - P.x, p.y - P.y);
      if (d < 0.42 && p.z < 1.2) { damagePlayer(p.dmg, p.vx, p.vy, 2); Sound.splat(0, 0.3); continue; }
      // 打敌人
      for (const e of enemies) {
        if (e.dead > 0) continue;
        if (Math.hypot(p.x - e.x, p.y - e.y) < 0.45 + e.r) { popFx(p.x, p.y, p.z, e.D.head, 0.6, true); continue; }
      }
    } else {
      if (p.z > 0.1 && p.z < 1.0) {
        for (const e of enemies) {
          if (e.dead > 0) continue;
          if (Math.hypot(p.x - e.x, p.y - e.y) < 0.42 + e.r && p.z < 1.1 + e.D.headR) { game.hitEnemy(e, p.dmg, p.vx, p.vy, 'cannon'); confettiBurst(p); break; }
        }
        if (projectiles.indexOf(p) === -1) continue;
        for (const b of balloons) {
          if (b.popT > 0) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) < 0.3) { popBalloon(b, 'shell'); confettiBurst(p); break; }
        }
      }
      if (projectiles.indexOf(p) === -1) continue;
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = 0.02;
        spawnParticle({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0.1, life: 0.35, max: 0.35, size: 0.09, col: C(0xffffff), grav: 0, kind: 'smoke', drag: 0.9 });
      }
    }
    out.push(p);
  }
  projectiles = out;
}
function confettiBurst(p) {
  for (let i = 0; i < 22; i++) {
    const a = rand(TAU), sp = rand(1, 6);
    spawnParticle({ x: p.x, y: p.y, z: Math.max(0.1, p.z), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.5, 4), life: rand(0.6, 1.3), max: 1.3, size: rand(0.025, 0.065), col: rainbowC(rnd()), grav: 0.8, kind: 'confetti', spin: rand(-14, 14) });
  }
  for (let i = 0; i < 3; i++) {
    const a = rand(TAU), sp = rand(0.4, 2.4);
    spawnParticle({ x: p.x, y: p.y, z: Math.max(0.1, p.z), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.3, 1.6), life: rand(0.3, 0.7), max: 0.7, size: rand(0.09, 0.18), col: C(0xffffff), grav: -0.1, drag: 0.85, kind: 'smoke' });
  }
  Sound.explosion(panFor(p.x, p.y), 0.34);
  game.shake(5, 0.2);
  fxAdd({ x: p.x, y: p.y, z: 0.5, r: 2.6, life: 0.22, max: 0.22, col: C(0xfff0a0), power: 1.3 });
  game.onShellHit(p);
}
function burstShell(p) { confettiBurst(p); }

function popBalloon(b, by = 'shot') {
  if (b.popT > 0) return;
  b.popT = 0.001;
  popFx(b.x, b.y, b.z, b.col, 0.55);
  game.onBalloonPopped(b, by);
  if (b.power) {
    const kinds = { health: 'health', ammo: 'ammo', nade: 'nade', rapid: 'rapid', shield: 'shield' };
    spawnPickup(kinds[b.power], b.x, b.y, 0.1);
  }
}
function popBalloonFxOnly(b) { popBalloon(b, 'chain'); }

/* ============================ 粒子 / 特效 ============================ */
let fxList = [];
function fxAdd(f) { if (fxList.length < 20) fxList.push(Object.assign({ power: 1 }, f)); }
function updateParticles(dt) {
  const out = [];
  for (const p of particles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.vz -= 9.8 * p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.z < 0.012) {
      p.z = 0.012; p.vz = 0;
      p.vx *= 0.62; p.vy *= 0.62; p.grav = 0;
      if (p.kind === 'smoke') { p.life -= dt * 3; if (p.life <= 0) continue; }
    }
    p.vx *= Math.pow(p.drag, dt * 3); p.vy *= Math.pow(p.drag, dt * 3);
    p.rot += p.spin * dt;
    if (p.kind === 'confetti' && p.life < p.max * 0.3) p.col = p.col;   // 保持颜色
    out.push(p);
  }
  particles = out;
  for (const d of decals) d.life -= dt;
  for (let i = decals.length - 1; i >= 0; i--) if (decals[i].life <= 0) decals.splice(i, 1);
  for (let i = popups.length - 1; i >= 0; i--) { popups[i].life -= dt; if (popups[i].life <= 0) popups.splice(i, 1); }
  const f = [];
  for (const q of fxList) { q.life -= dt; if (q.life > 0) f.push(q); }
  fxList = f;
}

function damagePlayer(amount, dirx, diry, kb = 0) {
  if (game.god) return;
  let dmg = amount;
  if (P.shield > 0) { const a = Math.min(P.shield, dmg); P.shield -= a; dmg -= a; if (a > 0) game.toast('护盾抵挡', C(0xa78bfa)); }
  if (dmg > 0) P.hp -= dmg;
  game.shake(3 + dmg * 0.35, 0.25);
  game.hurtFlash = Math.min(1, game.hurtFlash + dmg / 45);
  P.kbx = (dirx || 0) * kb; P.kby = (diry || 0) * kb;
  if (P.hp <= 0) { P.hp = 0; game.gameOver(); }
  else Sound.hurt(0.35);
}
