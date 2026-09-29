/* =========================================================================
   CORE —— 数学 / 随机 / 噪声 / 颜色 / 输入 / WebAudio 合成
   本作所有素材（贴图、角色、武器、音效、音乐）均由代码实时生成，
   不加载任何外部图片、模型或音频文件。
   ========================================================================= */
'use strict';

const TAU = Math.PI * 2, PI = Math.PI;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = t => t * t * (3 - 2 * t);
const sign = v => v < 0 ? -1 : 1;

/* ---------- 随机数 ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = Math.random;
function seedRand(s) { rnd = mulberry32(s); }
const rand = (a = 1, b) => b === undefined ? rnd() * a : a + rnd() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length) % arr.length];
const chance = p => rnd() < p;
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };

/* ---------- 值噪声（用于程序化贴图） ---------- */
const PERM = new Uint8Array(512);
(function initPerm() {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const r = mulberry32(1337);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
function hash2(x, y) { return PERM[(PERM[x & 255] + (y & 255)) & 511] / 255; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smoothstep(xf), v = smoothstep(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y, oct = 4, gain = 0.5, lac = 2) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, y * f) * amp; norm += amp; amp *= gain; f *= lac; }
  return s / norm;
}

/* ---------- 颜色：打包为 0xAABBGGRR（小端写入 ImageData） ---------- */
function packRGB(r, g, b) { return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; }
function packRGBA(r, g, b, a) { return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; }
function cr(c) { return c & 255; } function cg(c) { return (c >> 8) & 255; } function cb(c) { return (c >> 16) & 255; } function ca(c) { return (c >>> 24) & 255; }
/** 明暗缩放 */
function shade(c, f) {
  let r = (cr(c) * f) | 0, g = (cg(c) * f) | 0, b = (cb(c) * f) | 0;
  r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
  return packRGB(r, g, b);
}
/** 两色线性插值 */
function mixC(c1, c2, t) {
  return packRGB(lerp(cr(c1), cr(c2), t) | 0, lerp(cg(c1), cg(c2), t) | 0, lerp(cb(c1), cb(c2), t) | 0);
}
/** 直觉写法 0xRRGGBB → 内部 ABGR 打包色（与 ImageData 小端字节序对齐） */
const C = v => packRGB((v >> 16) & 255, (v >> 8) & 255, v & 255);
function hsv(h, s, v) {
  h = (h % 1 + 1) % 1; const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q;
  }
  return [r * 255 | 0, g * 255 | 0, b * 255 | 0];
}
const rainbowC = t => { const c = hsv(t, 0.72, 1); return packRGB(c[0], c[1], c[2]); };

/* ---------- 轻量 2D 离屏画布（所有贴图/精灵都靠它画） ---------- */
function makeCanvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}
/** 把 canvas 抽成 {w,h,data:Uint32Array}，data 直接可写进 ImageData */
function extractSprite(cv) {
  const w = cv.width, h = cv.height;
  const d = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = new Uint32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) out[i] = (d[j + 3] << 24) | (d[j + 2] << 16) | (d[j + 1] << 8) | d[j];
  return { w, h, data: out };
}

/* =========================================================================
   输入
   ========================================================================= */
const Input = {
  keys: {}, mouse: { dx: 0, dy: 0, left: false, right: false, wheel: 0 },
  locked: false, everLocked: false, sens: 0.0022, invertY: false,
  init(canvas) {
    addEventListener('keydown', e => {
      const k = e.code;
      if (!this.keys[k]) this.onPress && this.onPress(k, e);
      this.keys[k] = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('wheel', e => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.everLocked = true;
      this.onLockChange && this.onLockChange(this.locked);
    });
  },
  lock(canvas) {
    if (this.locked) return;
    const p = canvas.requestPointerLock && canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { });          // 某些环境下会拒绝，不应中断游戏
  },
  key(k) { return !!this.keys[k]; },
  takeMouse() { const d = { dx: this.mouse.dx * this.sens, dy: this.mouse.dy * this.sens * (this.invertY ? -1 : 1) }; this.mouse.dx = 0; this.mouse.dy = 0; return d; },
  takeWheel() { const w = this.mouse.wheel; this.mouse.wheel = 0; return w; }
};

/* =========================================================================
   音频引擎：全部用 WebAudio 实时合成
   ========================================================================= */
const Sound = {
  ctx: null, master: null, sfxBus: null, musBus: null, noiseBuf: null,
  ready: false, muted: false, vol: 0.8,

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 1; this.sfxBus.connect(this.master);
    this.musBus = ctx.createGain(); this.musBus.gain.value = 0.34; this.musBus.connect(this.master);

    // 白噪声缓冲
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 0;
    for (let i = 0; i < len; i++) { s = (s + (Math.random() * 2 - 1) * 0.7) * 0.86; d[i] = clamp(s + (Math.random() * 2 - 1) * 0.3, -1, 1); }
    this.noiseBuf = buf;
    this.ready = true;
    Music.init(ctx, this.musBus);
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setVol(v) { this.vol = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; },
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : this.vol; return this.muted; },

  /* --- 基础单元 --- */
  now() { return this.ctx.currentTime; },
  _pan(p) { const n = this.ctx.createStereoPanner(); n.pan.value = clamp(p, -1, 1); return n; },
  _noise(dur, when) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    src.start(when, Math.random() * 1.5, dur + 0.05);
    return src;
  },
  /** 带包络的滤波噪声（枪声/脚步/爆炸底层） */
  noiseHit({ dur = 0.12, vol = 0.5, type = 'lowpass', f0 = 3000, f1 = 300, q = 1, pan = 0, delay = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now() + delay;
    const src = this._noise(dur, t);
    const flt = ctx.createBiquadFilter(); flt.type = type;
    flt.frequency.setValueAtTime(f0, t); flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this._pan(pan);
    src.connect(flt).connect(g).connect(p).connect(this.sfxBus);
    src.stop(t + dur + 0.05);
  },
  /** 频率滑音（爆破/啵声主体） */
  tone({ f0 = 800, f1 = 120, dur = 0.15, vol = 0.4, type = 'sine', pan = 0, delay = 0, curve = 'exp' } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = this.now() + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    else o.frequency.linearRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this._pan(pan);
    o.connect(g).connect(p).connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  },

  /* --- 具体音效 --- */
  pop(pan = 0, size = 1, vol = 0.5) {           // 气球爆炸
    const f = 1500 / (0.6 + size * 0.7);
    this.tone({ f0: f, f1: 70, dur: 0.11, vol: vol * 0.9, type: 'sine', pan });
    this.noiseHit({ dur: 0.06, vol: vol * 0.45, f0: 6000, f1: 900, type: 'bandpass', q: 0.8, pan });
  },
  splat(pan = 0, vol = 0.4) {                   // 乳胶飞溅
    this.noiseHit({ dur: 0.13, vol: vol, f0: 1400, f1: 160, type: 'lowpass', pan });
    this.tone({ f0: 220, f1: 90, dur: 0.1, vol: vol * 0.3, type: 'triangle', pan });
  },
  shootPopper(pan = 0) {                        // 针式吹针枪
    this.noiseHit({ dur: 0.09, vol: 0.35, f0: 5200, f1: 700, type: 'bandpass', q: 2, pan });
    this.tone({ f0: 1200, f1: 420, dur: 0.07, vol: 0.2, type: 'square', pan });
  },
  shootShotgun(pan = 0) {                       // 气泵霰弹
    this.noiseHit({ dur: 0.26, vol: 0.6, f0: 3800, f1: 180, type: 'lowpass', pan });
    this.tone({ f0: 180, f1: 48, dur: 0.22, vol: 0.45, type: 'sine', pan });
    this.noiseHit({ dur: 0.08, vol: 0.25, f0: 800, f1: 200, type: 'bandpass', q: 3, pan, delay: 0.14 });
  },
  shootCannon(pan = 0) {                        // 彩带加农
    this.tone({ f0: 260, f1: 60, dur: 0.3, vol: 0.5, type: 'sine', pan });
    this.noiseHit({ dur: 0.3, vol: 0.35, f0: 1800, f1: 120, type: 'lowpass', pan });
  },
  shootBlaster(pan = 0) {                       // 彩带连发
    this.tone({ f0: 700, f1: 1500, dur: 0.05, vol: 0.22, type: 'sawtooth', pan });
    this.tone({ f0: 350, f1: 90, dur: 0.09, vol: 0.22, type: 'square', pan });
  },
  explosion(pan = 0, vol = 0.7) {
    this.tone({ f0: 140, f1: 32, dur: 0.5, vol: vol, type: 'sine', pan });
    this.noiseHit({ dur: 0.45, vol: vol * 0.8, f0: 2400, f1: 90, type: 'lowpass', pan });
    this.noiseHit({ dur: 0.12, vol: vol * 0.4, f0: 5000, f1: 500, type: 'highpass', pan });
  },
  hurt(vol = 0.5) {
    this.tone({ f0: 320, f1: 90, dur: 0.2, vol: vol, type: 'square' });
    this.noiseHit({ dur: 0.12, vol: vol * 0.35, f0: 900, f1: 200, type: 'lowpass' });
  },
  heal() { [0, 0.07, 0.14].forEach((d, i) => this.tone({ f0: 523 * Math.pow(1.26, i), f1: 523 * Math.pow(1.26, i), dur: 0.14, vol: 0.22, type: 'sine', delay: d })); },
  pickup() { [0, 0.06, 0.12, 0.18].forEach((d, i) => this.tone({ f0: 660 * Math.pow(1.2, i), f1: 660 * Math.pow(1.2, i), dur: 0.1, vol: 0.2, type: 'square', delay: d })); },
  chain(level) { this.tone({ f0: 500 + level * 130, f1: 900 + level * 190, dur: 0.11, vol: 0.22, type: 'triangle' }); },
  swap() { this.noiseHit({ dur: 0.07, vol: 0.2, f0: 2500, f1: 600, type: 'bandpass', q: 2 }); },
  dry() { this.noiseHit({ dur: 0.05, vol: 0.25, f0: 3000, f1: 2000, type: 'bandpass', q: 6 }); this.tone({ f0: 180, f1: 140, dur: 0.05, vol: 0.12, type: 'square' }); },
  reload() { this.noiseHit({ dur: 0.06, vol: 0.22, f0: 1800, f1: 400, type: 'bandpass', q: 3 }); this.noiseHit({ dur: 0.07, vol: 0.22, f0: 2400, f1: 500, type: 'bandpass', q: 3, delay: 0.16 }); },
  step(pan = 0) { this.noiseHit({ dur: 0.07, vol: 0.1, f0: 900 + Math.random() * 300, f1: 180, type: 'lowpass', pan }); },
  bounce(pan = 0, pitch = 1) { this.tone({ f0: 420 * pitch, f1: 700 * pitch, dur: 0.09, vol: 0.16, type: 'sine', pan }); },
  ui(hi = false) { this.tone({ f0: hi ? 880 : 440, f1: hi ? 1320 : 330, dur: 0.1, vol: 0.2, type: 'triangle' }); },
  wave() { [0, 0.1, 0.2, 0.34].forEach((d, i) => this.tone({ f0: 392 * Math.pow(1.335, i), f1: 392 * Math.pow(1.335, i), dur: 0.2, vol: 0.24, type: 'square', delay: d })); },
  gameover() { [0, 0.16, 0.34, 0.6].forEach((d, i) => this.tone({ f0: 440 / Math.pow(1.2, i), f1: 440 / Math.pow(1.2, i), dur: 0.35, vol: 0.22, type: 'sawtooth', delay: d })); }
};

/* =========================================================================
   程序化音乐：16 分音符序列 + 实时合成（低音/主旋律/鼓组）
   ========================================================================= */
const Music = {
  on: false, step: 0, next: 0, timer: null, bpm: 134, ctx: null, bus: null,
  chords: [
    { r: 45, q: 'min' }, { r: 41, q: 'maj' }, { r: 48, q: 'maj' }, { r: 43, q: 'maj' },
    { r: 45, q: 'min' }, { r: 37, q: 'maj' }, { r: 41, q: 'min' }, { r: 43, q: 'maj' }
  ],
  lead: [0, 12, 15, 12, 19, 15, 12, 7, 0, 12, 15, 19, 24, 19, 15, 12,
         -3, 7, 12, 7, 15, 12, 7, 3, 0, 7, 12, 15, 19, 15, 12, 7],
  intensity: 0,

  init(ctx, bus) { this.ctx = ctx; this.bus = bus; },
  m2f(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  chordNotes(ch) {
    const third = ch.q === 'min' ? 3 : 4, fifth = 7;
    return [ch.r, ch.r + 12, ch.r + 12 + third, ch.r + 12 + fifth, ch.r + 24];
  },
  start() {
    if (!Sound.ready || this.on) return;
    this.on = true; this.step = 0; this.next = Sound.now() + 0.08;
    this.timer = setInterval(() => this.tick(), 25);
  },
  stop() { this.on = false; if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  setIntensity(v) { this.intensity = clamp(v, 0, 1); },
  tick() {
    if (!this.on) return;
    const spb = 60 / this.bpm / 4;                      // 一个 16 分音符
    this.spb = spb;
    while (this.next < Sound.now() + 0.12) {
      this.playStep(this.step, this.next);
      this.next += spb; this.step++;
    }
  },
  playStep(step, t) {
    const ctx = this.ctx, bus = this.bus, I = this.intensity, spb = this.spb;
    const s16 = step % 16, bar = Math.floor(step / 16) % 8;
    const ch = this.chords[bar];

    // 鼓：底鼓 / 军鼓 / 踩镲
    if (s16 % 4 === 0 || (I > 0.5 && s16 === 14 && bar % 2)) this.kick(t, 0.7);
    if (s16 === 4 || s16 === 12) this.snare(t, 0.35 * (0.6 + I * 0.5));
    if (s16 % 2 === 0) this.hat(t, 0.1 + 0.07 * I);
    if (I > 0.65 && s16 % 2 === 1) this.hat(t, 0.05);

    // 低音：八分音符跳音
    if (s16 % 2 === 0) {
      const seq = [0, 0, 12, 0, 0, 7, 0, 12];
      const m = ch.r + seq[(s16 / 2) | 0];
      this.blip(t, this.m2f(m), spb * 1.7, 0.30, 'triangle', 420);
    }
    // 和弦垫
    if (s16 === 0) {
      const notes = this.chordNotes(ch);
      for (let i = 0; i < 3; i++) this.blip(t, this.m2f(notes[i] + 12), spb * 15, 0.055 + 0.02 * I, 'square', 1500);
    }
    // 主旋律
    if (I > 0.12) {
      const li = (step) % this.lead.length;
      const oct = I > 0.6 ? 24 : 12;
      this.blip(t, this.m2f(ch.r + oct + this.lead[li]), spb * 1.25, 0.085 + 0.05 * I, 'square', 2600);
    }
    // 打击彩带
    if (I > 0.85 && s16 === 15 && bar % 4 === 3) this.blip(t, this.m2f(ch.r + 36), 0.12, 0.06, 'triangle', 4000);
  },
  blip(t, f, dur, vol, type, cut) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = cut; flt.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt).connect(g).connect(this.bus);
    o.start(t); o.stop(t + dur + 0.03);
  },
  kick(t, v) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.2);
  },
  snare(t, v) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = Sound.noiseBuf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 1900; flt.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(flt).connect(g).connect(this.bus); src.start(t, Math.random()); src.stop(t + 0.16);
  },
  hat(t, v) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = Sound.noiseBuf; src.loop = true;
    const flt = ctx.createBiquadFilter(); flt.type = 'highpass'; flt.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(flt).connect(g).connect(this.bus); src.start(t, Math.random()); src.stop(t + 0.08);
  }
};
