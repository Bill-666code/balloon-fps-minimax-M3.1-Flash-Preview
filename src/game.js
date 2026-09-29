/* =========================================================================
   GAME —— 玩家 / 武器 / 波次 / HUD / 状态机
   ========================================================================= */
'use strict';

const P = {
  x: 2.5, y: 2.5, z: 0.55, vz: 0, a: 0, pitch: 0,
  vx: 0, vy: 0, kbx: 0, kby: 0, r: 0.30,
  hp: 100, maxhp: 100, shield: 0,
  onGround: true, bobT: 0, bob: 0, bobPix: 0, pitchPix: 0,
  fireT: 0, reloadT: 0, weapon: 0, nades: 3,
  flash: 0, flashCol: C(0xfff0c0),
  stepT: 0, hurtDir: 0, hurtT: 0,
  vw: { recoil: 0, bob: 0, sway: 0, reload: 0, pump: 0, pumpT: 0, spin: 0, flash: 0 }
};

const game = {
  state: 'menu',          // menu | play | pause | over
  wave: 0, kills: 0, score: 0, chain: 0, chainT: 0, bestChain: 0,
  mag: {}, ammo: {},
  shakeT: 0, shakeA: 0, hurtFlash: 0, hitMark: 0, hitMarkKill: 0,
  toasts: [], banner: null, bannerT: 0,
  spawnQueue: [], spawnT: 0, waveState: 'idle', waveTimer: 0, cleared: 0,
  god: false, showFps: false, fps: 60, _fpsAcc: 0, _fpsN: 0,
  totalPops: 0, totalShots: 0, totalHits: 0, startTime: 0,

  reset(full) {
    this.mag = {}; this.ammo = {};
    for (const k of WEAPON_ORDER) { this.mag[k] = WEAPON_DEFS[k].mag; this.ammo[k] = Math.round(WEAPON_DEFS[k].reserveMax * 0.55); }
    if (full) {
      this.wave = 0; this.kills = 0; this.score = 0; this.chain = 0; this.bestChain = 0;
      this.totalPops = 0; this.totalShots = 0; this.totalHits = 0; this.startTime = performance.now();
    }
    P.hp = P.maxhp; P.shield = 0; P.z = 0.55; P.vz = 0; P.weapon = 0;
    P.reloadT = 0; P.fireT = 0; P.pitch = 0; P.nades = 3;
    this.hurtFlash = 0; this.toasts.length = 0;
  },
  addScore(n) { this.score += n; },
  shake(amt, dur) { this.shakeA = Math.max(this.shakeA, amt); this.shakeT = Math.max(this.shakeT, dur); },
  toast(text, col) { this.toasts.push({ text, col: col || C(0xffffff), life: 2.2 }); if (this.toasts.length > 5) this.toasts.shift(); },
  showBanner(title, sub, dur) { this.banner = { title, sub }; this.bannerT = dur || 2.6; },

  /* ---- 世界回调 ---- */
  onEnemyKilled(e, byPlayer) {
    this.kills++;
    const base = e.D.score;
    this.bumpChain();
    const gained = Math.round(base * (1 + (this.chain - 1) * 0.5));
    this.addScore(gained);
    spawnPopup(e.x, e.y, 1.1, '+' + gained, C(0xffe066), 1);
    this.hitMark = 0.12; this.hitMarkKill = 0.3;
    if (e.type === 'boss') {
      this.showBanner('气球王 炸了！', 'BONUS +5000', 3);
      this.addScore(5000);
      for (let i = 0; i < 6; i++) spawnPowerBalloon(e.x + rand(-2, 2), e.y + rand(-2, 2));
    }
  },
  onBalloonPopped(b, by) {
    this.totalPops++;
    this.bumpChain();
    const gained = 10 * this.chain;
    this.addScore(gained);
    if (this.chain > 1) Sound.chain(this.chain);
    if (by === 'chain') popBalloonFxOnly(b);
  },
  onShellHit(p) { },
  hitEnemy(e, dmg, kx, ky, src) {
    if (e.dead > 0) return;
    e.hp -= dmg; e.hurt = 1;
    const kl = src === 'cannon' ? 3 : 5;
    const l = Math.hypot(kx, ky) || 1;
    e.kbx += kx / l * kl; e.kby += ky / l * kl;
    this.hitMark = 0.1;
    spawnPopup(e.x, e.y, 0.9, Math.round(dmg), C(0xffffff), 0.7, 0.7);
    if (e.hp <= 0) killEnemy(e, true);
  },
  bumpChain() {
    if (this.chainT > 0) this.chain++; else this.chain = 1;
    this.chainT = 1.5;
    if (this.chain > this.bestChain) this.bestChain = this.chain;
  },
  gameOver() {
    if (this.state === 'over') return;
    this.state = 'over';
    Music.setIntensity(0);
    Sound.gameover();
    if (document.pointerLockElement) document.exitPointerLock();
    showOverScreen();
  }
};

/* ============================ 玩家更新 ============================ */
function updatePlayer(dt) {
  const wkey = WEAPON_ORDER[P.weapon], W = WEAPON_DEFS[wkey];
  // 视角
  const m = Input.takeMouse();
  P.a += m.dx;
  P.pitch = clamp(P.pitch - m.dy * 0.9, -1, 1);
  const wheel = Input.takeWheel();
  if (wheel) switchWeapon(P.weapon + wheel);
  // 移动
  let ix = 0, iy = 0;
  if (Input.key('KeyW')) iy += 1;
  if (Input.key('KeyS')) iy -= 1;
  if (Input.key('KeyA')) ix -= 1;
  if (Input.key('KeyD')) ix += 1;
  const l = Math.hypot(ix, iy) || 1;
  const sprint = Input.key('ShiftLeft') || Input.key('ShiftRight');
  const spd = (sprint ? 5.4 : 3.5) * (P.reloadT > 0 ? 0.72 : 1);
  const c = Math.cos(P.a), s = Math.sin(P.a);
  const wx = (ix * c - iy * s) / l * spd * (ix || iy ? 1 : 0);
  const wy = (ix * s + iy * c) / l * spd * (ix || iy ? 1 : 0);
  P.vx = wx; P.vy = wy;
  P.kbx *= Math.pow(0.0001, dt); P.kby *= Math.pow(0.0001, dt);
  moveWithCollision(P, (wx + P.kbx) * dt, (wy + P.kby) * dt);
  // 跳跃
  if (Input.key('Space') && P.onGround) { P.vz = 3.5; P.onGround = false; }
  P.vz -= 11 * dt;
  P.z += P.vz * dt;
  if (P.z <= 0.55) { P.z = 0.55; P.vz = 0; P.onGround = true; }
  // 视角摇晃
  const moving = (ix || iy) ? 1 : 0;
  P.bobT += dt * (moving ? (sprint ? 15 : 10.5) : 0);
  P.bob += (moving - P.bob) * Math.min(1, dt * 8);
  P.bobPix = Math.sin(P.bobT) * 5.5 * P.bob * R.SH / 270;
  P.bobPix += Math.abs(Math.cos(P.bobT)) * 1.6 * P.bob * R.SH / 270;
  P.pitch = clamp(P.pitch - (P.kick || 0) * dt * 6, -1, 1);
  P.pitchPix = (-P.pitch * 0.5 + (P.kick || 0) * 2.2) * R.SH;
  // 脚步声
  if (moving) {
    P.stepT -= dt * (sprint ? 1.5 : 1.1);
    if (P.stepT <= 0) { P.stepT = 0.42; Sound.step(0, 0.07); }
  }
  // 生命
  if (P.shield > 0) P.shield = Math.max(0, P.shield - dt * 1.2);
  // 武器
  P.fireT -= dt;
  P.flash = Math.max(0, P.flash - dt * 9);
  P.vw.recoil = Math.max(0, P.vw.recoil - dt * 11);
  P.kick = Math.max(0, (P.kick || 0) - dt * 3.2);
  P.vw.sway += (0 - P.vw.sway) * Math.min(1, dt * 4);
  P.vw.spin += dt * (sprint ? 26 : 8);
  P.vw.flash = Math.max(0, P.vw.flash - dt * 14);
  P.hurtT = Math.max(0, P.hurtT - dt);
  if (P.reloadT > 0) {
    P.reloadT -= dt;
    P.vw.reload = clamp(1 - P.reloadT / (W.reload * 0.8), 0, 1);
    if (P.reloadT <= 0) finishReload();
  } else P.vw.reload = Math.max(0, P.vw.reload - dt * 5);
  if (P.vw.pumpT > 0) { P.vw.pumpT -= dt * 4.2; if (P.vw.pumpT < 0) P.vw.pumpT = 0; }
  // 开火
  const wantFire = W.auto ? Input.mouse.left : (Input.mouse.left && !P.wasFire);
  P.wasFire = Input.mouse.left;
  if (wantFire && P.fireT <= 0 && P.reloadT <= 0) fire();
  // 换弹 / 道具 / 换枪
  if (keysPressedThisFrame.has('KeyR')) startReload();
  if (keysPressedThisFrame.has('KeyG') && P.nades > 0) throwNade();
  for (let i = 0; i < 4; i++) if (keysPressedThisFrame.has('Digit' + (i + 1))) switchWeapon(i);
  keysPressedThisFrame.clear();
  // 手雷瞄准指示
  if (Input.mouse.right && P.nades > 0) P.aiming = 1; else P.aiming = 0;
}
let keysPressedThisFrame = new Set();

function switchWeapon(i) {
  i = ((i % WEAPON_ORDER.length) + WEAPON_ORDER.length) % WEAPON_ORDER.length;
  if (i === P.weapon) return;
  P.weapon = i; P.fireT = 0.25; P.reloadT = 0;
  P.vw.reload = 0;
  Sound.swap(); game.toast(WEAPON_DEFS[WEAPON_ORDER[i]].name, C(0x9ad5ff));
}
function startReload() {
  const k = WEAPON_ORDER[P.weapon], W = WEAPON_DEFS[k];
  if (P.reloadT > 0 || game.mag[k] >= W.mag || game.ammo[k] <= 0) return;
  P.reloadT = W.reload;
  Sound.reload();
}
function finishReload() {
  const k = WEAPON_ORDER[P.weapon], W = WEAPON_DEFS[k];
  const need = W.mag - game.mag[k];
  const take = W.shells ? 1 : Math.min(need, game.ammo[k]);
  if (W.shells) {
    if (game.ammo[k] > 0) { game.ammo[k]--; game.mag[k]++; }
    if (game.mag[k] < W.mag && game.ammo[k] > 0) { P.reloadT = W.reload * 0.7; return; }
  } else {
    game.mag[k] += take; game.ammo[k] -= take;
  }
  if (W.ammoType === 'air' && game.mag[k] > 0 && game.ammo[k] > 0 && Input.mouse.left) P.reloadT = W.reload * 0.8;
}
function throwNade() {
  if (P.nades <= 0) return;
  P.nades--;
  const c = Math.cos(P.a), s = Math.sin(P.a);
  spawnProjectile({
    x: P.x + c * 0.5, y: P.y + s * 0.5, z: P.z, vx: c * 13, vy: s * 13, vz: 3.4,
    dmg: 70, enemy: 2, life: 3, arcing: 1, spr: Art.props.shell, scale: 0.9, spin: 10
  });
  Sound.shootCannon(0);
  P.vw.recoil = Math.min(1.7, P.vw.recoil + 0.8); P.flash = 0.7; P.flashCol = C(0xffb070);
  game.shake(3, 0.12);
}

/* ---------- 射线命中检测 ---------- */
function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const ex = cx - ox, ey = cy - oy;
  const proj = ex * dx + ey * dy;
  if (proj < 0) return -1;
  const d2 = ex * ex + ey * ey - proj * proj;
  if (d2 > r * r) return -1;
  const t = proj - Math.sqrt(r * r - d2);
  return t < 0 ? (proj < 0 ? -1 : 0.1) : t;
}
function traceShot(ox, oy, dx, dy, maxD) {
  const wall = castRay(ox, oy, dx, dy, maxD);
  let best = { dist: wall.dist, kind: 'wall' };
  const pz = P.z;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead > 0) continue;
    const t = rayCircle(ox, oy, dx, dy, e.x, e.y, 0.34 + e.r);
    if (t > 0 && t < best.dist) {
      if (pz <= e.z + 0.95 && pz >= e.z - 0.25) best = { dist: t, kind: 'enemy', obj: e };
    }
  }
  for (let i = 0; i < balloons.length; i++) {
    const b = balloons[i];
    if (b.popT > 0) continue;
    const t = rayCircle(ox, oy, dx, dy, b.x, b.y, 0.26);
    if (t > 0 && t < best.dist) {
      if (pz <= b.z + 0.35 && pz >= b.z - 0.3) best = { dist: t, kind: 'balloon', obj: b };
    }
  }
  return best;
}
function fire() {
  const k = WEAPON_ORDER[P.weapon], W = WEAPON_DEFS[k];
  if (game.mag[k] <= 0) { Sound.dry(); startReload(); return; }
  game.mag[k]--;
  P.fireT = 60 / W.rpm;
  game.totalShots++;
  P.vw.flash = 1; P.vw.recoil = Math.min(1.7, P.vw.recoil + W.recoil * 0.45);
  P.flash = 1; P.flashCol = W.ammoType === 'cannon' ? C(0xffc070) : C(0xfff0c0);
  game.shake(W.recoil * 1.5 + 0.6, 0.13);
  const pan = 0;
  if (k === 'popper') Sound.shootPopper(pan);
  else if (k === 'pump') { Sound.shootShotgun(pan); P.vw.pumpT = 1; }
  else if (k === 'cannon') Sound.shootCannon(pan);
  else Sound.shootBlaster(pan);

  if (W.grenade) {
    const c = Math.cos(P.a), s = Math.sin(P.a);
    spawnProjectile({
      x: P.x + c * 0.5, y: P.y + s * 0.5, z: P.z, vx: c * W.speed, vy: s * W.speed, vz: 3.2,
      dmg: W.dmg, enemy: 0, life: 4, arcing: 1, spr: Art.props.shell, scale: 1.0, spin: 9
    });
    return;
  }
  const spread = W.spread * (Input.mouse.right && W.ammoType === 'blaster' ? 0.35 : 1) * (P.onGround ? 1 : 1.6);
  const dirX = Math.cos(P.a), dirY = Math.sin(P.a);
  let anyHit = false;
  for (let i = 0; i < W.pellets; i++) {
    const a = P.a + rand(-spread, spread) + (P.vw.recoil * 0.004);
    const hit = traceShot(P.x, P.y, Math.cos(a), Math.sin(a), W.range);
    const hx = P.x + Math.cos(a) * hit.dist, hy = P.y + Math.sin(a) * hit.dist;
    if (hit.kind === 'enemy') {
      anyHit = true; game.totalHits++;
      game.hitEnemy(hit.obj, W.dmg, Math.cos(a), Math.sin(a), k);
      spawnDecal(hx, hy, Art.props.hole, 0.16, 6);
    } else if (hit.kind === 'balloon') {
      anyHit = true; game.totalHits++;
      popBalloon(hit.obj, 'shot');
    } else {
      // 墙面弹孔 + 溅射
      if (i === 0 || W.pellets > 4) {
        spawnDecal(hx, hy, Art.props.hole, 0.2 + Math.random() * 0.1, 10);
        for (let j = 0; j < 3; j++) {
          const sa = Math.atan2(hy - P.y, hx - P.x) + rand(-1, 1);
          spawnParticle({ x: hx, y: hy, z: 0.45, vx: Math.cos(sa) * rand(1, 4), vy: Math.sin(sa) * rand(1, 4), vz: rand(0.5, 2), life: 0.35, max: 0.35, size: rand(0.03, 0.06), col: C(0xfff2c0), grav: 1, kind: 'confetti', spin: 10, glow: 1 });
        }
        fxAdd({ x: hx, y: hy, z: 0.45, r: 1.1, life: 0.1, max: 0.1, col: C(0xfff0b0), power: 0.9 });
      }
    }
  }
  if (anyHit) game.hitMark = 0.1;
}

/* ============================ 波次 ============================ */
const UNLOCK = { boinger: 1, floaty: 2, darter: 3, bomber: 4, chonk: 5, boss: 5 };
function startWave(n) {
  game.wave = n;
  let wantLevel = 0;                      // 取「门槛 <= n」的最高关卡
  for (let i = 0; i < LEVELS.length; i++) if (LEVELS[i].waves <= n) wantLevel = i;
  if (wantLevel !== world.levelIndex && world.map) {
    const st = loadLevel(wantLevel);
    P.x = st.x; P.y = st.y; P.z = 0.55;
    R.buildMaps();
    game.showBanner(world.name, world.sub, 3);
    Sound.wave();
  } else if (!world.map) {
    loadLevel(0);
  }
  game.spawnQueue.length = 0;
  const isBoss = n % 5 === 0;
  if (isBoss) {
    game.spawnQueue.push('boss');
    game.showBanner('第 ' + n + ' 波', '⚠ 气球王登场 ⚠', 3);
  } else {
    let count = Math.round(3 + n * 1.9);
    for (let i = 0; i < count; i++) {
      const pool = ['boinger', 'boinger', 'boinger'];
      if (n >= UNLOCK.floaty) pool.push('floaty');
      if (n >= UNLOCK.darter) pool.push('darter');
      if (n >= UNLOCK.bomber) pool.push('bomber');
      if (n >= UNLOCK.chonk) pool.push('chonk');
      game.spawnQueue.push(pool[Math.floor(rnd() * pool.length)]);
    }
    game.showBanner('第 ' + n + ' 波', count + ' 个气球人来了', 2.2);
  }
  Sound.wave();
  game.waveState = 'fighting';
  game.spawnT = 0.6;
  game.spawnIdx = 0;
  // 奖励气球
  const bc = Object.keys(Art.props.power);
  for (let i = 0; i < 1 + Math.min(2, n / 4); i++) {
    const f = world.map.floors[Math.floor(rnd() * world.map.floors.length)];
    spawnBalloon(f.x, f.y, rnd, bc[Math.floor(rnd() * bc.length)]);
  }
  Music.setIntensity(clamp(0.25 + n * 0.08, 0.2, 1));
}
function updateWaves(dt) {
  if (game.waveState === 'fighting') {
    game.spawnT -= dt;
    if (game.spawnT <= 0 && game.spawnIdx < game.spawnQueue.length) {
      const type = game.spawnQueue[game.spawnIdx++];
      const pos = findSpawn(type);
      if (pos) {
        spawnEnemy(type, pos.x, pos.y);
        for (let i = 0; i < 5; i++) spawnParticle({ x: pos.x, y: pos.y, z: 0.3, vx: rand(-1, 1), vy: rand(-1, 1), vz: rand(0.5, 2), life: 0.5, max: 0.5, size: 0.05, col: C(0xffffff), grav: 1, kind: 'smoke' });
      }
      game.spawnT = Math.max(0.28, 1.1 - game.wave * 0.06);
    }
    if (game.spawnIdx >= game.spawnQueue.length && enemies.length === 0) {
      game.waveState = 'clear';
      game.waveTimer = 4.0;
      game.cleared = game.wave;
      const bonus = 300 + game.wave * 120;
      game.addScore(bonus);
      game.showBanner('清场！', '奖励 +' + bonus, 2.6);
      for (let i = 0; i < 3; i++) {
        const f = world.map.floors[Math.floor(rnd() * world.map.floors.length)];
        spawnBalloon(f.x, f.y, rnd, null);
      }
    }
  } else if (game.waveState === 'clear') {
    game.waveTimer -= dt;
    if (game.waveTimer <= 0) startWave(game.wave + 1);
  }
}
function findSpawn(type) {
  const m = world.map;
  let best = null, bestD = 1e9;
  for (let i = 0; i < 60; i++) {
    const f = m.floors[Math.floor(rnd() * m.floors.length)];
    const d = Math.hypot(f.x - P.x, f.y - P.y);
    if (d < 7) continue;
    if (d < bestD) { bestD = d; best = f; }
    if (d > 14) return f;
  }
  return bestD < 1e9 ? best : null;
}

/* ============================ HUD ============================ */
function drawHUD(ctx, dt) {
  const W = innerWidth, H = innerHeight;
  const u = Math.min(W, H) / 720;            // HUD 缩放基准
  ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  ctx.save();
  ctx.textBaseline = 'middle';

  /* --- 准星 --- */
  const cx = W / 2, cy = H / 2;
  const spread = 4 + P.vw.recoil * 3 + (P.reloadT > 0 ? 8 : 0);
  ctx.globalAlpha = 0.9; ctx.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? '#fff' : 'rgba(0,0,0,0.6)';
    ctx.lineWidth = (pass ? 2 : 3.6) * u;
    for (let i = 0; i < 4; i++) {
      const a = i * PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * spread * u, cy + Math.sin(a) * spread * u);
      ctx.lineTo(cx + Math.cos(a) * (spread + 7) * u, cy + Math.sin(a) * (spread + 7) * u);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - 1 * u, cy - 1 * u, 2 * u, 2 * u);
  if (game.hitMark > 0) {
    ctx.globalAlpha = clamp(game.hitMark * 8, 0, 1);
    ctx.strokeStyle = game.hitMarkKill > 0 ? '#ff4d63' : '#fff';
    ctx.lineWidth = 2.4 * u;
    for (let i = 0; i < 4; i++) {
      const a = PI / 4 + i * PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 5 * u, cy + Math.sin(a) * 5 * u);
      ctx.lineTo(cx + Math.cos(a) * 12 * u, cy + Math.sin(a) * 12 * u);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  /* --- 受击方向指示 --- */
  if (P.hurtT > 0) {
    ctx.globalAlpha = clamp(P.hurtT * 1.6, 0, 1) * 0.75;
    const da = P.hurtDir - P.a;
    ctx.translate(cx, cy); ctx.rotate(da);
    const grd = ctx.createRadialGradient(0, 0, H * 0.16, 0, 0, H * 0.42);
    grd.addColorStop(0, 'rgba(255,0,40,0)');
    grd.addColorStop(1, 'rgba(255,20,60,0.85)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, H * 0.45, -PI * 0.30, PI * 0.30); ctx.closePath(); ctx.fill();
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  const k = WEAPON_ORDER[P.weapon], WD = WEAPON_DEFS[k];
  const low = P.hp < 30;
  /* --- 左下：生命 --- */
  const bx = 26 * u, by = H - 86 * u, bw = 230 * u, bh = 18 * u;
  panel(ctx, bx, by, bw, bh + 40 * u, 0.42);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
  const hpw = bw * clamp(P.hp / P.maxhp, 0, 1);
  const hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  if (low) { hg.addColorStop(0, '#ff2d55'); hg.addColorStop(1, '#ff8a5b'); }
  else { hg.addColorStop(0, '#4ade80'); hg.addColorStop(1, '#a3e635'); }
  ctx.fillStyle = hg;
  roundRect(ctx, bx, by, Math.max(hpW(hpw, bh), bh), bh, bh / 2); ctx.fill();
  if (P.shield > 0) {
    const sw = bw * clamp(P.shield / 100, 0, 1);
    ctx.fillStyle = 'rgba(167,139,250,0.9)';
    roundRect(ctx, bx, by - 8 * u, Math.max(sw, 4 * u), 6 * u, 3 * u); ctx.fill();
  }
  ctx.fillStyle = '#fff'; ctx.font = `700 ${15 * u}px ui-sans-serif,system-ui,sans-serif`;
  ctx.fillText('♥ ' + Math.ceil(P.hp), bx + 2 * u, by + bh + 16 * u);
  if (P.shield > 0) { ctx.fillStyle = '#c4b5fd'; ctx.fillText('◈ ' + Math.ceil(P.shield), bx + 92 * u, by + bh + 16 * u); }
  // 榴弹
  ctx.fillStyle = '#fca5a5'; ctx.font = `700 ${13 * u}px ui-sans-serif,system-ui,sans-serif`;
  for (let i = 0; i < P.nades; i++) { ctx.beginPath(); ctx.arc(bx + 4 * u + i * 11 * u, by + bh + 32 * u, 4.5 * u, 0, TAU); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `600 ${10 * u}px ui-sans-serif`;
  ctx.fillText('G 投掷', bx + 4 * u + P.nades * 11 * u + 6 * u, by + bh + 32 * u);

  /* --- 右下：武器 --- */
  const wx = W - 26 * u - 210 * u, wy = H - 86 * u;
  panel(ctx, wx, wy, 210 * u, 62 * u, 0.42);
  ctx.fillStyle = '#7dd3fc'; ctx.font = `700 ${13 * u}px ui-sans-serif,system-ui,sans-serif`;
  ctx.fillText(WD.name, wx + 12 * u, wy + 16 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = `600 ${9.5 * u}px ui-sans-serif`;
  ctx.fillText(WD.desc, wx + 12 * u, wy + 30 * u);
  const magTxt = String(game.mag[k]).padStart(2, '0');
  ctx.fillStyle = game.mag[k] === 0 ? '#ff5470' : '#fff';
  ctx.font = `800 ${34 * u}px ui-sans-serif,system-ui,sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(magTxt, W - 38 * u, wy + 24 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `700 ${16 * u}px ui-sans-serif`;
  ctx.fillText('/ ' + game.ammo[k], W - 38 * u, wy + 48 * u);
  ctx.textAlign = 'left';
  // 换弹进度
  if (P.reloadT > 0) {
    const p = 1 - P.reloadT / WD.reload;
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; roundRect(ctx, wx + 10 * u, wy + 52 * u, 190 * u, 4 * u, 2 * u); ctx.fill();
    ctx.fillStyle = '#fbbf24'; roundRect(ctx, wx + 10 * u, wy + 52 * u, 190 * u * p, 4 * u, 2 * u); ctx.fill();
  }
  // 武器栏
  for (let i = 0; i < WEAPON_ORDER.length; i++) {
    const ik = WEAPON_ORDER[i], x = W - 26 * u - (WEAPON_ORDER.length - i) * 26 * u;
    const on = i === P.weapon;
    ctx.fillStyle = on ? 'rgba(125,211,252,0.9)' : 'rgba(255,255,255,0.13)';
    roundRect(ctx, x, wy - 26 * u, 20 * u, 20 * u, 5 * u); ctx.fill();
    ctx.fillStyle = on ? '#08203a' : 'rgba(255,255,255,0.6)';
    ctx.font = `800 ${11 * u}px ui-sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x + 10 * u, wy - 16 * u);
    ctx.textAlign = 'left';
  }

  /* --- 左上：分数/波次 --- */
  panel(ctx, 26 * u, 24 * u, 250 * u, 70 * u, 0.42);
  ctx.fillStyle = '#fff'; ctx.font = `800 ${30 * u}px ui-sans-serif,system-ui,sans-serif`;
  ctx.fillText(String(game.score).padStart(6, '0'), 38 * u, 48 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `600 ${10 * u}px ui-sans-serif`;
  ctx.fillText('得分 SCORE', 38 * u, 68 * u);
  ctx.fillStyle = '#ffd93d'; ctx.font = `800 ${19 * u}px ui-sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('第 ' + game.wave + ' 波', 264 * u, 44 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `600 ${10 * u}px ui-sans-serif`;
  ctx.fillText(world.name + ' · 剩 ' + enemies.length, 264 * u, 66 * u);
  ctx.textAlign = 'left';

  /* --- 小地图 --- */
  drawMinimap(ctx, W - 26 * u - 132 * u, 24 * u, 132 * u);

  /* --- 连击 --- */
  if (game.chain > 1) {
    const t = clamp(game.chainT / 1.5, 0, 1);
    ctx.save();
    ctx.translate(cx, H * 0.68);
    ctx.scale(1 + (1 - t) * 0.2, 1 + (1 - t) * 0.2);
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.min(1, t * 2.2);
    ctx.fillStyle = '#ff4d63';
    ctx.font = `900 ${46 * u}px ui-sans-serif,system-ui,sans-serif`;
    ctx.fillText('×' + game.chain, 0, 0);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `700 ${13 * u}px ui-sans-serif`;
    ctx.fillText('CHAIN  连爆', 0, 30 * u);
    // 连击条
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(ctx, -60 * u, 42 * u, 120 * u, 5 * u, 2.5 * u); ctx.fill();
    ctx.fillStyle = '#ff4d63'; roundRect(ctx, -60 * u, 42 * u, 120 * u * t, 5 * u, 2.5 * u); ctx.fill();
    ctx.restore();
  }

  /* --- 飘字 --- */
  const sx = W / R.SW, sy = H / R.SH;
  ctx.textAlign = 'center';
  for (const p of popups) {
    if (p.sx < -1000) continue;
    const a = clamp(p.life / p.max * 1.6, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#' + hex(p.col);
    ctx.font = `800 ${Math.max(15, (p.size || 1) * 26) * u}px ui-sans-serif,system-ui,sans-serif`;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3 * u;
    ctx.strokeText(p.text, p.sx * sx, p.sy * sy);
    ctx.fillText(p.text, p.sx * sx, p.sy * sy);
  }
  ctx.globalAlpha = 1;

  /* --- 提示条 --- */
  ctx.textAlign = 'center';
  for (let i = 0; i < game.toasts.length; i++) {
    const t = game.toasts[i];
    const a = clamp(t.life / 0.6, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#' + hex(t.col);
    ctx.font = `700 ${15 * u}px ui-sans-serif,system-ui,sans-serif`;
    ctx.fillText(t.text, cx, H * 0.80 + i * 20 * u);
  }
  ctx.globalAlpha = 1;

  /* --- 横幅 --- */
  if (game.banner && game.bannerT > 0) {
    const t = game.bannerT;
    const a = Math.min(1, t * 1.5) * Math.min(1, (2.8 - t) * 3 + 0.2);
    ctx.globalAlpha = clamp(a, 0, 1);
    const by2 = H * 0.3;
    const grd = ctx.createLinearGradient(0, by2 - 40 * u, 0, by2 + 40 * u);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.5, 'rgba(10,6,30,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, by2 - 46 * u, W, 92 * u);
    ctx.fillStyle = '#fff'; ctx.font = `900 ${52 * u}px ui-sans-serif,system-ui,sans-serif`;
    ctx.fillText(game.banner.title, cx, by2 - 6 * u);
    ctx.fillStyle = '#ffd93d'; ctx.font = `700 ${17 * u}px ui-sans-serif`;
    ctx.fillText(game.banner.sub, cx, by2 + 30 * u);
    ctx.globalAlpha = 1;
  }

  /* --- BOSS 血条 --- */
  const boss = enemies.find(e => e.type === 'boss' && e.dead <= 0);
  if (boss) {
    const bw2 = Math.min(560 * u, W * 0.6), bx2 = (W - bw2) / 2, by2 = 40 * u;
    panel(ctx, bx2 - 8 * u, by2 - 18 * u, bw2 + 16 * u, 40 * u, 0.45);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(ctx, bx2, by2, bw2, 12 * u, 6 * u); ctx.fill();
    const p = clamp(boss.hp / boss.maxhp, 0, 1);
    const gg = ctx.createLinearGradient(bx2, 0, bx2 + bw2, 0);
    gg.addColorStop(0, '#ff4d63'); gg.addColorStop(0.5, '#ff8a5b'); gg.addColorStop(1, '#ffd93d');
    ctx.fillStyle = gg; roundRect(ctx, bx2, by2, Math.max(bw2 * p, 6 * u), 12 * u, 6 * u); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `800 ${13 * u}px ui-sans-serif`;
    ctx.fillText('气球王  BOSS', bx2, by2 - 9 * u);
  }
  ctx.restore();

  /* --- 暗角 / 受击 / 闪白（覆盖在画面上） --- */
  ctx.save();
  ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, low ? `rgba(120,0,30,${0.35 + Math.sin(perfNow * 6) * 0.1})` : 'rgba(10,6,30,0.42)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  if (game.hurtFlash > 0.01) {
    ctx.fillStyle = `rgba(255,40,70,${game.hurtFlash * 0.34})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (P.flash > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,230,170,${P.flash * 0.13})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  if (game.showFps) {
    ctx.save(); ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    ctx.fillStyle = '#0f0'; ctx.font = '12px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`${game.fps.toFixed(0)} fps | 精灵 ${R.stats.sprites} | 粒子 ${particles.length} | 分辨率 ${R.SW}x${R.SH}`, 10, H - 8);
    ctx.restore();
  }
}
const hpW = (w, h) => w;
function panel(ctx, x, y, w, h, a) {
  ctx.fillStyle = `rgba(12,8,30,${a ?? 0.45})`;
  roundRect(ctx, x, y, w, h, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1.5; ctx.stroke();
}
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function drawMinimap(ctx, x, y, size) {
  const m = world.map; if (!m) return;
  panel(ctx, x - 6, y - 6, size + 12, size + 12, 0.5);
  const cell = size / Math.max(m.w, m.h);
  const ox = x + (size - m.w * cell) / 2, oy = y + (size - m.h * cell) / 2;
  const R2 = 9;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
  // 只画玩家周围的
  const cxm = P.x, cym = P.y;
  for (let j = Math.max(0, (cym - R2) | 0); j <= Math.min(m.h - 1, (cym + R2) | 0); j++) {
    for (let i = Math.max(0, (cxm - R2) | 0); i <= Math.min(m.w - 1, (cxm + R2) | 0); i++) {
      if (m.solid[j * m.w + i]) { ctx.fillStyle = 'rgba(140,160,255,0.30)'; ctx.fillRect(ox + i * cell, oy + j * cell, cell + 0.6, cell + 0.6); }
    }
  }
  for (const b of balloons) {
    if (b.popT > 0) continue;
    if (Math.abs(b.x - cxm) > R2 || Math.abs(b.y - cym) > R2) continue;
    ctx.fillStyle = b.power ? '#a3e635' : 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(ox + b.x * cell, oy + b.y * cell, 1.6, 0, TAU); ctx.fill();
  }
  for (const p of pickups) {
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(ox + p.x * cell - 1.5, oy + p.y * cell - 1.5, 3, 3);
  }
  for (const e of enemies) {
    if (e.dead > 0) continue;
    if (Math.abs(e.x - cxm) > R2 || Math.abs(e.y - cym) > R2) continue;
    ctx.fillStyle = e.type === 'boss' ? '#ff2d55' : '#ff6b6b';
    ctx.beginPath(); ctx.arc(ox + e.x * cell, oy + e.y * cell, e.type === 'boss' ? 3.5 : 2.2, 0, TAU); ctx.fill();
  }
  // 玩家
  ctx.translate(ox + P.x * cell, oy + P.y * cell); ctx.rotate(P.a);
  ctx.fillStyle = '#7dd3fc';
  ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.5, 3.2); ctx.lineTo(-3.5, -3.2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ============================ 武器视图模型 ============================ */
function drawViewModel(ctx, W, H) {
  const k = WEAPON_ORDER[P.weapon];
  const st = {
    recoil: P.vw.recoil, bob: P.bob, sway: P.vw.sway, reload: P.vw.reload,
    pumpAnim: P.vw.pumpT, spin: P.vw.spin, s: Math.min(W / 720, H / 410)
  };
  // 双手（气球手套）+ 武器
  ctx.save();
  GunArt[k](ctx, W, H, st);
  drawHands(ctx, W, H, st, C(0xff8fab), st.recoil);
  ctx.restore();
  // 枪口火光（对准枪口）
  if (P.vw.flash > 0) {
    const s = 0.42 * P.vw.flash;
    const mz = GUN_MUZZLE[k], sc = st.s;
    const mx = W * GUN_X + mz[0] * sc, my = H * GUN_Y + mz[1] * sc + st.recoil * 20 * sc;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createRadialGradient(mx, my, 0, mx, my, H * 0.42);
    grd.addColorStop(0, `rgba(255,240,190,${s})`);
    grd.addColorStop(1, 'rgba(255,180,80,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = Math.min(1, P.vw.flash);
    ctx.translate(mx, my); ctx.rotate(st.spin * 3);
    const R2 = 46 * sc * (0.7 + P.vw.flash * 0.6);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU + 0.4;
      ctx.strokeStyle = 'rgba(255,240,190,0.8)'; ctx.lineWidth = 5 * sc; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R2 * 0.2, Math.sin(a) * R2 * 0.2);
      ctx.lineTo(Math.cos(a) * R2, Math.sin(a) * R2); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,250,220,0.95)';
    ctx.beginPath(); ctx.arc(0, 0, R2 * 0.36, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
  }
}

/* ============================ 主循环 ============================ */
let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const now = t / 1000;
  let dt = Math.min(0.05, now - lastT || 0.016);
  lastT = now;
  perfNow = now;
  game._fpsAcc += dt; game._fpsN++;
  if (game._fpsAcc > 0.4) { game.fps = game._fpsN / game._fpsAcc; game._fpsAcc = 0; game._fpsN = 0; }

  if (game.state === 'play') {
    tickPlay(dt);
  } else if (game.state === 'menu' || game.state === 'over') {
    // 展示模式：镜头缓慢环绕
    if (world.map) {
      P.a += dt * 0.16;
      P.z = 0.62;
      P.bobPix = Math.sin(now * 0.7) * 6;
      P.pitchPix = 8;
    }
  }
  if (world.map) {
    // 屏幕震动
    let ox = 0, oy = 0;
    if (game.shakeT > 0) {
      game.shakeT -= dt;
      const s = game.shakeA * clamp(game.shakeT * 4, 0, 1);
      ox = rand(-s, s); oy = rand(-s, s);
      if (game.shakeT <= 0) game.shakeA = 0;
    }
    R.render(P);
    R.present();
    const ctx = R.ctx;
    if (ox || oy) {
      ctx.setTransform(1, 0, 0, 1, ox * R.dpr, oy * R.dpr);
      ctx.drawImage(R.fb, 0, 0, R.cv.width, R.cv.height);
      ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    }
    if (game.state === 'play' || game.state === 'pause') {
      drawViewModel(ctx, innerWidth, innerHeight);
      drawHUD(ctx, dt);
    }
  }
  // 状态衰减
  game.hurtFlash = Math.max(0, game.hurtFlash - dt * 2.2);
  game.hitMark = Math.max(0, game.hitMark - dt);
  game.hitMarkKill = Math.max(0, game.hitMarkKill - dt);
  if (game.bannerT > 0) game.bannerT -= dt;
  for (let i = game.toasts.length - 1; i >= 0; i--) { game.toasts[i].life -= dt; if (game.toasts[i].life <= 0) game.toasts.splice(i, 1); }
}

function tickPlay(dt) {
  if (Input.key('Escape')) { pauseGame(); return; }
  // 连击计时
  if (game.chainT > 0) { game.chainT -= dt; if (game.chainT <= 0) game.chain = 0; }
  updatePlayer(dt);
  updateEnemies(dt);
  updateBalloons(dt);
  updatePickups(dt);
  updateProjectiles(dt);
  updateParticles(dt);
  updateWaves(dt);
  if (Input.everLocked && !Input.locked && game.state === 'play') pauseGame();
}
