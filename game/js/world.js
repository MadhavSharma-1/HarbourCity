import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, fbm, clamp, smoothstep, pick } from './util.js';

/* ───────────────────────── World layout constants ───────────────────────── */
export const GRID = 16;                     // city blocks per side
export const CELL = 100;                    // road-to-road spacing (m)
export const HALF = (GRID * CELL) / 2;      // 800
export const ROAD_HALF = 7;                 // 4 lanes × 3.5 m
export const BLOCK_HALF = CELL / 2 - ROAD_HALF; // 43
export const WATER_LEVEL = -1.2;
export const SHORE_Z = HALF + ROAD_HALF;    // where the sand starts
export const PIER = { x0: 192, x1: 208, z0: 806, z1: 1040, y: 1.4 };
export const LANES = [1.75, 5.25];
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export const roadCoord = (i) => -HALF + i * CELL;
export const blockCenter = (i) => -HALF + CELL / 2 + i * CELL;

export function blockIndexAt(v) {
  const t = v + HALF;
  if (t < 0 || t >= GRID * CELL) return -1;
  const i = Math.floor(t / CELL);
  const local = t - i * CELL;
  if (local < ROAD_HALF || local > CELL - ROAD_HALF) return -1;
  return i;
}

export function seabedHeight(x, z) {
  const d = z - SHORE_Z;
  if (d <= 0) return 0;
  let h;
  if (d < 100) h = -d * 0.018;
  else { const t = clamp((d - 100) / 650, 0, 1); h = -1.8 - 40 * t * t * (3 - 2 * t); }
  const k = clamp((d - 60) / 220, 0, 1);
  h += (fbm(x * 0.011 + 3.1, z * 0.011 - 7.7, 4) - 0.5) * 12 * k;
  h += (fbm(x * 0.09, z * 0.09, 2) - 0.5) * 1.1 * k;
  // a long trench running diagonally offshore
  const tx = x + 0.3 * (z - 1500) - 520;
  h -= Math.exp(-(tx * tx) / (2 * 55 * 55)) * clamp((d - 420) / 200, 0, 1) * 16;
  return h;
}

export function groundHeight(x, z) {
  if (z < SHORE_Z) {
    if (Math.abs(x) < HALF + ROAD_HALF && z > -HALF - ROAD_HALF && blockIndexAt(x) >= 0 && blockIndexAt(z) >= 0) return 0.15;
    return 0;
  }
  let h = seabedHeight(x, z);
  if (x > PIER.x0 && x < PIER.x1 && z < PIER.z1) h = Math.max(h, PIER.y);
  return h;
}

/** Ocean surface height (matches the water shader). */
export function waveHeight(x, z, t) {
  return 0.18 * Math.sin(0.08 * x + 0.6 * t) + 0.12 * Math.sin(0.11 * z - 0.9 * t + 1.3) + 0.06 * Math.sin(0.21 * (x + z) + 1.7 * t);
}

/** Traffic light state for intersection (ii,jj). axis 0 = traffic moving along X, 1 = along Z. */
export function lightState(ii, jj, axis, t) {
  const off = ((ii * 7 + jj * 13) % 10) * 3;
  const c = (t + off) % 30;
  if (axis === 0) return c < 12 ? 'g' : c < 15 ? 'y' : 'r';
  return c < 15 ? 'r' : c < 27 ? 'g' : 'y';
}

/* ───────────────────────────── Collisions ───────────────────────────── */
export class Colliders {
  constructor() { this.boxes = []; this.cell = 25; this.map = new Map(); this.stamp = 0; }
  _k(i, j) { return (i + 2000) * 8192 + (j + 2000); }
  add(x0, z0, x1, z1, h, tag = 'solid') {
    const b = { x0, z0, x1, z1, h, tag, s: 0 };
    this.boxes.push(b);
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
      for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
        const k = this._k(i, j);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(b);
      }
    return b;
  }
  addCircle(x, z, r, h, tag) { return this.add(x - r, z - r, x + r, z + r, h, tag); }
  query(x, z, r, out) {
    out.length = 0; this.stamp++;
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const arr = this.map.get(this._k(i, j));
        if (!arr) continue;
        for (const b of arr) if (b.s !== this.stamp) { b.s = this.stamp; out.push(b); }
      }
    return out;
  }
  /** Push a circle (x,z,r) at height y out of every box. Returns contact info. */
  resolve(x, z, r, y = 0.5) {
    const cand = this.query(x, z, r, this._tmp || (this._tmp = []));
    let hit = false, nx = 0, nz = 0, depth = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of cand) {
        if (y > b.h) continue;
        const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
        let dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2), pen, ux, uz;
        if (d > 1e-5) { ux = dx / d; uz = dz / d; pen = r - d; }
        else {
          const l = x - b.x0, rr = b.x1 - x, t = z - b.z0, bt = b.z1 - z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) { ux = -1; uz = 0; pen = l + r; } else if (m === rr) { ux = 1; uz = 0; pen = rr + r; }
          else if (m === t) { ux = 0; uz = -1; pen = t + r; } else { ux = 0; uz = 1; pen = bt + r; }
        }
        x += ux * pen; z += uz * pen;
        nx += ux * pen; nz += uz * pen; depth = Math.max(depth, pen); hit = true;
      }
    }
    const nl = Math.hypot(nx, nz) || 1;
    return { x, z, hit, nx: nx / nl, nz: nz / nl, depth };
  }
  /** Is a point inside any box? (used by the camera) */
  inside(x, y, z) {
    const cand = this.query(x, z, 0.3, this._tmp2 || (this._tmp2 = []));
    for (const b of cand) if (y < b.h && x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3) return true;
    return false;
  }
}

/* ───────────────────────────── Textures ───────────────────────────── */
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function speckle(g, s, base, spread, n, alpha = 0.25) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * spread);
    g.fillStyle = `rgba(${v},${v},${v},${alpha * Math.random()})`;
    const r = Math.random() * 2 + 0.5;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
}

export function makeTextures() {
  const asphalt = canvasTex(512, (g, s) => {
    speckle(g, s, '#3a3b3e', 255, 26000, 0.22);
    g.strokeStyle = 'rgba(20,20,20,.35)'; g.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) { g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, Math.random() * 40 + 10, 0, 7); g.fill(); }
  }, 200);
  const concrete = canvasTex(256, (g, s) => {
    speckle(g, s, '#a9a6a0', 255, 6000, 0.18);
    g.strokeStyle = 'rgba(60,60,60,.45)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * s / 4, 0); g.lineTo(i * s / 4, s); g.stroke(); g.beginPath(); g.moveTo(0, i * s / 4); g.lineTo(s, i * s / 4); g.stroke(); }
  }, 22);
  const grass = canvasTex(512, (g, s) => {
    g.fillStyle = '#4c6b2c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40000; i++) {
      const v = Math.random();
      g.fillStyle = `rgba(${40 + v * 60},${80 + v * 70},${20 + v * 30},.5)`;
      g.fillRect(Math.random() * s, Math.random() * s, 1.5, 3);
    }
  }, 400);
  const parkGrass = grass.clone(); parkGrass.repeat.set(16, 16); parkGrass.needsUpdate = true;
  return { asphalt, concrete, grass, parkGrass };
}

/* ─────────────── Underwater light absorption (red fades first) ─────────────── */
export function waterAbsorb(mat, tag = '') {
  const prev = mat.onBeforeCompile;
  const hasPrev = prev && prev !== THREE.Material.prototype.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (hasPrev) prev(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        #ifdef USE_INSTANCING
          vWY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
        #else
          vWY = (modelMatrix * vec4(transformed, 1.0)).y;
        #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
      .replace('#include <fog_fragment>', `{ float wd = max(${WATER_LEVEL.toFixed(2)} - vWY, 0.0); gl_FragColor.rgb *= exp(-wd * vec3(0.12, 0.045, 0.032)); }
        #include <fog_fragment>`);
  };
  const key = 'absorb|' + tag + '|' + (hasPrev ? prev.toString() : '');
  mat.customProgramCacheKey = () => key;
  return mat;
}

/* ───────────────────────── Building facade shader ───────────────────────── */
export function makeBuildingMaterial(shared, glass) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: glass ? 0.35 : 0.85, metalness: glass ? 0.2 : 0.0 });
  const P = glass
    ? { fh: '3.6', ww: '1.6', x0: '0.04', x1: '0.96', y0: '0.10', y1: '0.97', met: '0.85', rough: '0.06' }
    : { fh: '3.4', ww: '3.0', x0: '0.22', x1: '0.78', y0: '0.28', y1: '0.82', met: '0.55', rough: '0.08' };
  m.customProgramCacheKey = () => 'building-' + (glass ? 'glass' : 'concrete');
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = shared.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying float vSeed;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        mat4 bim = modelMatrix * instanceMatrix;
        vWPos = (bim * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(bim) * objectNormal);
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec3 vWPos; varying vec3 vWNrm; varying float vSeed;
        float bh21(vec2 p){ return fract(sin(dot(p, vec2(41.37, 289.13))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float isWall = 1.0 - step(0.5, abs(vWNrm.y));
          vec2 tng = normalize(vec2(-vWNrm.z, vWNrm.x) + 1e-5);
          float u = dot(vWPos.xz, tng);
          float fh = ${P.fh}; float ww = ${P.ww};
          vec2 cell = vec2(u / ww, (vWPos.y - 0.15) / fh);
          vec2 id = floor(cell); vec2 f = fract(cell);
          float win = step(${P.x0}, f.x) * step(f.x, ${P.x1}) * step(${P.y0}, f.y) * step(f.y, ${P.y1}) * isWall;
          float groundFloor = 1.0 - step(1.0, cell.y);
          float shop = groundFloor * isWall * step(0.08, f.x) * step(f.x, 0.92) * step(0.12, f.y) * step(f.y, 0.86);
          win = mix(win, shop, groundFloor);
          float slab = isWall * (1.0 - step(0.06, f.y)) * (1.0 - groundFloor);
          float side = floor(dot(vWNrm.xz, vec2(1.0, 3.0)) + 4.0);
          float rnd = bh21(id + vec2(vSeed * 97.0, side * 13.1));
          vec3 glassCol = mix(vec3(0.035, 0.05, 0.065), vec3(0.12, 0.16, 0.2), rnd);
          diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, win);
          diffuseColor.rgb *= 1.0 - slab * 0.35;
          // roof: tar/gravel
          float roof = step(0.5, vWNrm.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.23, 0.22, 0.21) * (0.85 + 0.3 * bh21(floor(vWPos.xz * 0.5))), roof);
          roughnessFactor = mix(roughnessFactor, ${P.rough}, win);
          metalnessFactor = mix(metalnessFactor, ${P.met}, win * (1.0 - groundFloor));
          // interior lights at night (some apartments, offices; shops are mostly lit)
          float litR = bh21(id * 1.73 + vec2(vSeed * 31.0, side));
          float lit = step(0.6 - uNight * 0.1, litR) * win;
          lit = mix(lit, step(0.25, litR) * shop, groundFloor);
          vec3 warm = mix(vec3(1.0, 0.72, 0.42), vec3(0.75, 0.85, 1.0), step(0.85, bh21(id + 7.0)));
          float flick = 0.75 + 0.25 * bh21(id + 3.0);
          totalEmissiveRadiance += warm * lit * flick * (uNight * 1.25 + groundFloor * 0.25 * (1.0 - uNight));
          // dim interior glow during the day so windows aren't pure mirrors
          totalEmissiveRadiance += vec3(0.02, 0.022, 0.025) * win * (1.0 - uNight);
        }`);
  };
  return m;
}

/* ─────────────────────────────── World ─────────────────────────────── */
const GAS_BLOCKS = [[3, 4], [11, 2], [7, 10], [13, 13], [1, 14]];
const GAS_NAMES = ['Bayline Fuel', 'Coastal Gas', 'Harbor Petrol', 'Sunset Fuel Stop', 'Northgate Gas'];
const PARK_BLOCKS = [[7, 7], [8, 7], [2, 9], [12, 9], [5, 2], [14, 6]];
export const LANDMARK = { i: 8, j: 5 };
const FACADES = ['#c9bfae', '#b5a993', '#d9d4c7', '#8f8a80', '#9a4d33', '#a8643a', '#7a7f86', '#e8e2d0', '#9c8b74', '#b7b2a8', '#6f5d4b', '#cfc6b8'];
const GLASSES = ['#5c7a8f', '#3f5d6e', '#7d96a8', '#4a6670', '#2f4552', '#8aa0b0', '#506a7a', '#6b8a9a'];

export class World {
  constructor(scene, shared) {
    this.scene = scene; this.shared = shared;
    this.colliders = new Colliders();
    this.lamps = [];          // light sources for the night light pool
    this.gasStations = [];
    this.pois = [];
    this.parks = [];
    this.buildings = [];      // for minimap
    this.lightBulbs = [];
    this.rand = mulberry32(1337);
  }

  build(onProgress = () => {}) {
    const tex = (this.tex = makeTextures());
    this.buildGround(tex);
    onProgress('Paving roads…');
    this.buildMarkings();
    onProgress('Raising skyscrapers…');
    this.buildBlocks(tex);
    onProgress('Wiring street lights…');
    this.buildStreetLights();
    this.buildTrafficLights();
    onProgress('Shaping the coastline…');
    this.buildBeach();
    this.buildMountains();
    this.buildSidewalkGraph();
    this.mapImage = this.drawMapImage();
  }

  /* ground, asphalt, grass, seabed */
  buildGround(tex) {
    const s = this.scene;
    const grassGeo = new THREE.PlaneGeometry(12000, 6000 + SHORE_Z);
    grassGeo.rotateX(-Math.PI / 2);
    grassGeo.translate(0, -0.05, (SHORE_Z - 6000) / 2);
    const grass = new THREE.Mesh(grassGeo, new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1 }));
    tex.grass.repeat.set(1200, 600);
    grass.receiveShadow = true;
    s.add(grass);

    const size = GRID * CELL + ROAD_HALF * 2;
    const roadGeo = new THREE.PlaneGeometry(size, size);
    roadGeo.rotateX(-Math.PI / 2);
    tex.asphalt.repeat.set(size / 7, size / 7);
    const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.9, metalness: 0.0, color: 0xb8b8b8 }));
    road.receiveShadow = true;
    s.add(road);

    // seabed / beach terrain
    const W = 8000, D = 1700, sx = 400, sz = 190;
    const g = new THREE.PlaneGeometry(W, D, sx, sz);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, SHORE_Z + D / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = seabedHeight(x, z);
      pos.setY(i, h);
      const n = fbm(x * 0.05, z * 0.05, 3);
      if (h > WATER_LEVEL + 0.25) c.setRGB(0.74, 0.66, 0.5).multiplyScalar(0.92 + n * 0.16);
      else if (h > WATER_LEVEL - 0.6) c.setRGB(0.66, 0.58, 0.44);
      else {
        c.setRGB(0.7, 0.64, 0.5).multiplyScalar(0.85 + n * 0.25);
        const grassN = fbm(x * 0.02 + 9, z * 0.02, 3);
        if (h < -3 && h > -14 && grassN > 0.55) c.lerp(new THREE.Color(0.22, 0.34, 0.18), smoothstep(0.55, 0.7, grassN));
        if (h < -20) c.lerp(new THREE.Color(0.42, 0.44, 0.42), smoothstep(-20, -40, h) * 0.6);
      }
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    // rocky slopes
    const nrm = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const slope = 1 - nrm.getY(i);
      if (slope > 0.08 && pos.getY(i) < WATER_LEVEL) {
        const k = smoothstep(0.08, 0.25, slope);
        col[i * 3] = col[i * 3] * (1 - k) + 0.38 * k; col[i * 3 + 1] = col[i * 3 + 1] * (1 - k) + 0.37 * k; col[i * 3 + 2] = col[i * 3 + 2] * (1 - k) + 0.34 * k;
      }
    }
    const seabedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    seabedMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.shared.uTime;
      sh.uniforms.uSunI = this.shared.uSunIntensity;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos2;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos2 = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uSunI; varying vec3 vWPos2;
        float caustic(vec2 p, float t){
          vec2 q = p * 0.22; float c = 0.0;
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            q += vec2(sin(q.y * 1.3 + t * (0.5 + fi * 0.13) + fi), cos(q.x * 1.1 - t * (0.45 + fi * 0.1)));
            c += 0.06 / abs(sin(q.x + fi) * cos(q.y * 0.8) + 0.08);
          }
          return clamp(c / 3.0, 0.0, 2.2);
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float wd = ${WATER_LEVEL.toFixed(2)} - vWPos2.y;
          if (wd > 0.05) {
            float k = smoothstep(0.05, 1.5, wd) * exp(-wd * 0.045);
            totalEmissiveRadiance += vec3(0.55, 0.85, 0.9) * caustic(vWPos2.xz, uTime) * k * 0.6 * uSunI * diffuseColor.rgb;
          }`);
    };
    waterAbsorb(seabedMat, 'seabed');
    const seabed = new THREE.Mesh(g, seabedMat);
    seabed.receiveShadow = true;
    s.add(seabed);
    this.seabed = seabed;
  }

  buildMarkings() {
    const white = [], yellow = [];
    const mk = (arr, x, z, w, l, rotY) => arr.push([x, z, w, l, rotY]);
    for (let a = 0; a < 2; a++) {            // a=0: roads along X (constant z)
      for (let r = 0; r <= GRID; r++) {
        const rc = roadCoord(r);
        for (let i = 0; i < GRID; i++) {
          const s0 = roadCoord(i) + 12, s1 = roadCoord(i + 1) - 12, mid = (s0 + s1) / 2, len = s1 - s0;
          const P = (u, v) => (a === 0 ? [u, rc + v] : [rc + v, u]);
          const rot = a === 0 ? Math.PI / 2 : 0;
          for (const o of [-0.17, 0.17]) { const [x, z] = P(mid, o); mk(yellow, x, z, 0.12, len, rot); }
          for (const side of [-3.5, 3.5]) {
            for (let k = 0; k < 8; k++) { const u = s0 + 3 + k * 9.4; const [x, z] = P(u, side); mk(white, x, z, 0.13, 3, rot); }
          }
          // stop lines: traffic drives on the right (+Z side when heading +X, -X side when heading +Z)
          const sg = a === 0 ? 1 : -1;
          { const [x, z] = P(roadCoord(i + 1) - 11.6, 3.5 * sg); mk(white, x, z, 0.45, 6.6, rot + Math.PI / 2); }
          { const [x, z] = P(roadCoord(i) + 11.6, -3.5 * sg); mk(white, x, z, 0.45, 6.6, rot + Math.PI / 2); }
        }
      }
    }
    // zebra crossings
    for (let ii = 0; ii <= GRID; ii++) for (let jj = 0; jj <= GRID; jj++) {
      const ix = roadCoord(ii), iz = roadCoord(jj);
      for (const [dx, dz] of DIRS) {
        const ni = ii + dx, nj = jj + dz;
        if (ni < 0 || nj < 0 || ni > GRID || nj > GRID) continue;
        for (let k = 0; k < 12; k++) {
          const v = -6.05 + k * 1.1;
          if (dx !== 0) mk(white, ix + dx * 9, iz + v, 0.55, 3, Math.PI / 2);
          else mk(white, ix + v, iz + dz * 9, 0.55, 3, 0);
        }
      }
    }
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const make = (arr, color) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      arr.forEach(([x, z, w, l, ry], i) => { q.setFromEuler(e.set(0, ry, 0)); m4.compose(p.set(x, 0.015, z), q, sc.set(w, 1, l)); im.setMatrixAt(i, m4); });
      im.receiveShadow = true; im.frustumCulled = false;
      this.scene.add(im);
    };
    make(white, 0xe8e8e0);
    make(yellow, 0xe0b430);
  }

  buildBlocks(tex) {
    const R = this.rand;
    const sidewalkGeo = new THREE.BoxGeometry(BLOCK_HALF * 2, 0.15, BLOCK_HALF * 2); sidewalkGeo.translate(0, 0.075, 0);
    const blocks = [];
    const bConcrete = [], bGlass = [], acUnits = [], tanks = [], antennas = [], beacons = [], trees = [];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const cx = blockCenter(i), cz = blockCenter(j);
      blocks.push([cx, cz]);
      const isGas = GAS_BLOCKS.findIndex(([a, b]) => a === i && b === j);
      const isPark = PARK_BLOCKS.some(([a, b]) => a === i && b === j);
      // sidewalk trees (outer ring)
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const t of [-32, -6, 6, 32]) {
          if (R() < 0.45) continue;
          const inset = BLOCK_HALF - 3.6;
          const x = sx ? cx + sx * inset : cx + t, z = sz ? cz + sz * inset : cz + t;
          trees.push([x, z, 0.75 + R() * 0.5]);
        }
      }
      if (isGas >= 0) { this.buildGasStation(cx, cz, GAS_NAMES[isGas]); continue; }
      if (isPark) { this.parks.push({ x: cx, z: cz, name: ['Central Park', 'Central Park', 'Westside Green', 'Eastview Park', 'Riverside Commons', 'Liberty Square'][PARK_BLOCKS.findIndex(([a, b]) => a === i && b === j)] });
        for (let k = 0; k < 30; k++) { const x = cx + (R() - 0.5) * 70, z = cz + (R() - 0.5) * 70; if (Math.abs(x - cx) < 6 || Math.abs(z - cz) < 6) continue; trees.push([x, z, 0.9 + R() * 0.7]); }
        continue;
      }
      if (i === LANDMARK.i && j === LANDMARK.j) {
        bGlass.push({ x: cx, z: cz, w: 46, d: 46, h: 170, col: '#3f5d6e', y: 0.15 });
        bGlass.push({ x: cx, z: cz, w: 34, d: 34, h: 90, col: '#4a6670', y: 170.15 });
        bGlass.push({ x: cx, z: cz, w: 20, d: 20, h: 45, col: '#5c7a8f', y: 260.15 });
        antennas.push([cx, 305.15, cz, 40]); beacons.push([cx, 345, cz]);
        this.colliders.add(cx - 23, cz - 23, cx + 23, cz + 23, 400);
        this.buildings.push([cx - 23, cz - 23, cx + 23, cz + 23, 345]);
        this.pois.push({ name: 'Vista Tower', x: cx, z: cz, kind: 'landmark' });
        continue;
      }
      // height falls off from downtown (0,-200)
      const dd = Math.hypot(cx - 0, cz + 200) / 650;
      const core = 1 - smoothstep(0, 1, dd);
      const maxH = 12 + core * core * 150;
      const splits = core > 0.6 ? pick([[1, 1], [2, 1], [1, 2], [2, 2]], R) : pick([[2, 2], [3, 2], [2, 3], [3, 3], [2, 2]], R);
      const A = BLOCK_HALF - 6; // 37
      const gap = 2.5;
      const lw = (A * 2 - gap * (splits[0] - 1)) / splits[0];
      const ld = (A * 2 - gap * (splits[1] - 1)) / splits[1];
      for (let a = 0; a < splits[0]; a++) for (let b = 0; b < splits[1]; b++) {
        const x = cx - A + lw / 2 + a * (lw + gap), z = cz - A + ld / 2 + b * (ld + gap);
        let h = maxH * (0.35 + R() * 0.75);
        if (core < 0.3) h = 7 + R() * (10 + core * 40);
        h = Math.max(6, Math.round(h / 3.4) * 3.4);
        const shrink = h > 40 ? 0.85 + R() * 0.15 : 0.92 + R() * 0.08;
        const w = lw * shrink, d = ld * shrink;
        const glass = h > 55 && R() < 0.7;
        const list = glass ? bGlass : bConcrete;
        list.push({ x, z, w, d, h, col: glass ? pick(GLASSES, R) : pick(FACADES, R), y: 0.15 });
        this.colliders.add(x - w / 2, z - d / 2, x + w / 2, z + d / 2, h + 0.15);
        this.buildings.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2, h]);
        let top = 0.15 + h;
        if (h > 45 && R() < 0.65) {
          const h2 = Math.round((h * (0.15 + R() * 0.25)) / 3.4) * 3.4 + 3.4;
          list.push({ x, z, w: w * 0.7, d: d * 0.7, h: h2, col: list[list.length - 1].col, y: top });
          top += h2;
          if (h > 90 && R() < 0.5) { const h3 = 6.8 + R() * 10; list.push({ x, z, w: w * 0.42, d: d * 0.42, h: h3, col: list[list.length - 1].col, y: top }); top += h3; }
        }
        if (h > 35) { const ah = 6 + R() * 14; antennas.push([x + (R() - 0.5) * w * 0.2, top, z + (R() - 0.5) * d * 0.2, ah]); beacons.push([antennas[antennas.length - 1][0], top + ah, antennas[antennas.length - 1][2]]); }
        if (h < 60) {
          const n = 1 + Math.floor(R() * 4);
          for (let k = 0; k < n; k++) acUnits.push([x + (R() - 0.5) * (w - 4), top, z + (R() - 0.5) * (d - 4), R() * Math.PI]);
          if (h > 12 && h < 45 && R() < 0.35) tanks.push([x + (R() - 0.5) * (w - 6), top, z + (R() - 0.5) * (d - 6)]);
        }
      }
    }

    // sidewalks (raised blocks)
    const sw = new THREE.InstancedMesh(sidewalkGeo, new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.92 }), blocks.length);
    const m4 = new THREE.Matrix4();
    blocks.forEach(([x, z], i) => sw.setMatrixAt(i, m4.makeTranslation(x, 0, z)));
    sw.receiveShadow = true; sw.frustumCulled = false;
    this.scene.add(sw);

    // park lawns + fountain
    const lawnGeo = new THREE.PlaneGeometry(BLOCK_HALF * 2 - 5, BLOCK_HALF * 2 - 5); lawnGeo.rotateX(-Math.PI / 2);
    const lawnMat = new THREE.MeshStandardMaterial({ map: tex.parkGrass, roughness: 1 });
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xb9ab8f, roughness: 1 });
    for (const p of this.parks) {
      const lawn = new THREE.Mesh(lawnGeo, lawnMat); lawn.position.set(p.x, 0.16, p.z); lawn.receiveShadow = true; this.scene.add(lawn);
      for (const r of [0, Math.PI / 2]) {
        const path = new THREE.Mesh(new THREE.PlaneGeometry(4, BLOCK_HALF * 2 - 5), pathMat);
        path.rotation.set(-Math.PI / 2, 0, r); path.position.set(p.x, 0.17, p.z); path.receiveShadow = true; this.scene.add(path);
      }
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.3, 0.8, 32), new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.8 }));
      basin.position.set(p.x, 0.55, p.z); basin.castShadow = basin.receiveShadow = true; this.scene.add(basin);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32), new THREE.MeshStandardMaterial({ color: 0x2a6f80, roughness: 0.05, metalness: 0.3 }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(p.x, 0.9, p.z); this.scene.add(pool);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 3, 12), basin.material); col.position.set(p.x, 1.6, p.z); col.castShadow = true; this.scene.add(col);
      this.colliders.addCircle(p.x, p.z, 5.2, 1.0);
      this.pois.push({ name: p.name, x: p.x, z: p.z, kind: 'park' });
    }

    // buildings
    const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
    const mkB = (list, glass) => {
      const im = new THREE.InstancedMesh(boxGeo, makeBuildingMaterial(this.shared, glass), list.length);
      const c = new THREE.Color(), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      list.forEach((b, i) => { mm.compose(p.set(b.x, b.y, b.z), q, s.set(b.w, b.h, b.d)); im.setMatrixAt(i, mm); im.setColorAt(i, c.set(b.col)); });
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
      this.scene.add(im);
    };
    mkB(bConcrete, false); mkB(bGlass, true);
    this.buildingCount = bConcrete.length + bGlass.length;

    const inst = (geo, mat, list, fn, shadow = true) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const mm = new THREE.Matrix4();
      list.forEach((it, i) => { fn(mm, it); im.setMatrixAt(i, mm); });
      im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false;
      this.scene.add(im); return im;
    };
    const acGeo = new THREE.BoxGeometry(2.2, 1.3, 1.6); acGeo.translate(0, 0.65, 0);
    inst(acGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.5, metalness: 0.6 }), acUnits, (mm, [x, y, z, r]) => mm.makeRotationY(r).setPosition(x, y, z));
    const tankGeo = mergeGeometries([new THREE.CylinderGeometry(2, 2, 4, 14).translate(0, 4.5, 0), new THREE.ConeGeometry(2.1, 1.2, 14).translate(0, 7.1, 0), new THREE.CylinderGeometry(0.15, 0.15, 2.5, 5).translate(1.5, 1.25, 0), new THREE.CylinderGeometry(0.15, 0.15, 2.5, 5).translate(-1.5, 1.25, 0)]);
    inst(tankGeo, new THREE.MeshStandardMaterial({ color: 0x7a5b3e, roughness: 0.9 }), tanks, (mm, [x, y, z]) => mm.makeTranslation(x, y, z));
    const antGeo = new THREE.CylinderGeometry(0.12, 0.3, 1, 6); antGeo.translate(0, 0.5, 0);
    inst(antGeo, new THREE.MeshStandardMaterial({ color: 0x555a5e, metalness: 0.8, roughness: 0.4 }), antennas, (mm, [x, y, z, h]) => mm.makeScale(1, h, 1).setPosition(x, y, z));
    this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.1) });
    inst(new THREE.SphereGeometry(0.5, 8, 6), this.beaconMat, beacons, (mm, [x, y, z]) => mm.makeTranslation(x, y, z), false);
    this.buildTrees(trees);
  }

  buildTrees(trees) {
    const R = this.rand;
    // outskirts forest
    for (let k = 0; k < 1600; k++) {
      const x = (R() - 0.5) * 3200, z = -1600 + R() * (SHORE_Z + 1580);
      if (Math.abs(x) < HALF + 25 && z > -HALF - 25) continue;
      trees.push([x, z, 0.8 + R() * 0.9]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 3.2, 6); trunkGeo.translate(0, 1.6, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.7, 1);
    const p = crownGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const n = 0.8 + Math.random() * 0.4; v.multiplyScalar(n); v.y *= 1.15; p.setXYZ(i, v.x, v.y, v.z); }
    crownGeo.computeVertexNormals(); crownGeo.translate(0, 4.3, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 }), trees.length);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), trees.length);
    const mm = new THREE.Matrix4(), c = new THREE.Color(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
    trees.forEach(([x, z, s], i) => {
      const y = groundHeight(x, z);
      q.setFromEuler(e.set(0, R() * 6.28, 0));
      mm.compose(pp.set(x, y, z), q, sc.set(s, s * (0.9 + R() * 0.3), s));
      trunk.setMatrixAt(i, mm); crown.setMatrixAt(i, mm);
      crown.setColorAt(i, c.setHSL(0.22 + R() * 0.08, 0.45 + R() * 0.2, 0.2 + R() * 0.12));
      if (Math.abs(x) < HALF + 10 && z > -HALF - 10) this.colliders.addCircle(x, z, 0.3 * s, 6);
    });
    for (const m of [trunk, crown]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; this.scene.add(m); }
  }

  buildGasStation(cx, cz, name) {
    const g = new THREE.Group();
    const conc = new THREE.MeshStandardMaterial({ color: 0x8d8d8a, roughness: 0.9 });
    const pad = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_HALF * 2 - 2, 0.02, BLOCK_HALF * 2 - 2), conc); pad.position.set(0, 0.16, 0); pad.receiveShadow = true; g.add(pad);
    const canopyZ = 8;
    const brand = new THREE.Color().setHSL(this.rand(), 0.7, 0.45);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(26, 0.8, 14), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
    canopy.position.set(0, 5.6, canopyZ); canopy.castShadow = true; g.add(canopy);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(26.2, 0.35, 14.2), new THREE.MeshStandardMaterial({ color: brand, roughness: 0.5, emissive: brand, emissiveIntensity: 0.2 }));
    trim.position.set(0, 5.75, canopyZ); g.add(trim);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.1) }));
    under.rotation.x = Math.PI / 2; under.position.set(0, 5.19, canopyZ); g.add(under);
    this.gasUnderMats = this.gasUnderMats || []; this.gasUnderMats.push(under.material);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 });
    for (const px of [-10, 10]) for (const pz of [-5, 5]) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.4, 0.6), pillarMat); pl.position.set(px, 2.85, canopyZ + pz); pl.castShadow = true; g.add(pl);
      this.colliders.addCircle(cx + px, cz + canopyZ + pz, 0.4, 6);
    }
    const pumpMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.4 });
    const screenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 0.6) });
    for (const px of [-6, 0, 6]) {
      const island = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 6), conc); island.position.set(px, 0.28, canopyZ); g.add(island);
      for (const pz of [-1.4, 1.4]) {
        const pump = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.6), pumpMat); pump.position.set(px, 1.2, canopyZ + pz); pump.castShadow = true; g.add(pump);
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 0.65), trim.material); top.position.set(px, 2.15, canopyZ + pz); g.add(top);
        for (const sx of [-0.46, 0.46]) { const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), screenMat); scr.position.set(px + sx, 1.6, canopyZ + pz); scr.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2; g.add(scr); }
      }
      this.colliders.add(cx + px - 0.7, cz + canopyZ - 3, cx + px + 0.7, cz + canopyZ + 3, 2.2);
    }
    const shop = new THREE.Mesh(new THREE.BoxGeometry(22, 4.6, 11), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }));
    shop.position.set(0, 2.45, -22); shop.castShadow = shop.receiveShadow = true; g.add(shop);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.6), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.6, emissive: new THREE.Color(1, 0.85, 0.6), emissiveIntensity: 0.6 }));
    glass.position.set(0, 1.8, -16.45); g.add(glass);
    this.gasGlassMats = this.gasGlassMats || []; this.gasGlassMats.push(glass.material);
    this.colliders.add(cx - 11, cz - 27.5, cx + 11, cz - 16.5, 5);
    // price sign
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 384;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#111'; c2.fillRect(0, 0, 256, 384);
    c2.fillStyle = '#' + brand.getHexString(); c2.fillRect(0, 0, 256, 110);
    c2.fillStyle = '#fff'; c2.font = 'bold 34px sans-serif'; c2.textAlign = 'center';
    name.split(' ').slice(0, 2).forEach((w, k) => c2.fillText(w.toUpperCase(), 128, 46 + k * 40));
    c2.fillStyle = '#ffcc33'; c2.font = 'bold 30px sans-serif'; c2.fillText('UNLEADED', 128, 170);
    c2.font = 'bold 84px monospace'; c2.fillStyle = '#ff5533'; c2.fillText('1.79', 128, 260);
    c2.fillStyle = '#aaa'; c2.font = '24px sans-serif'; c2.fillText('$ / LITRE', 128, 310);
    const stex = new THREE.CanvasTexture(cv); stex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.8, 0.4), [conc, conc, conc, conc, new THREE.MeshStandardMaterial({ map: stex, emissive: 0xffffff, emissiveMap: stex, emissiveIntensity: 0.5 }), conc]);
    sign.position.set(33, 8, 33); sign.rotation.y = Math.PI / 4; g.add(sign);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 8), pillarMat); post.position.set(33, 3, 33); g.add(post);
    this.colliders.addCircle(cx + 33, cz + 33, 0.4, 7);
    g.position.set(cx, 0, cz);
    this.scene.add(g);
    const st = { name, x: cx, z: cz + canopyZ, zone: { x0: cx - 13, x1: cx + 13, z0: cz + canopyZ - 7.5, z1: cz + canopyZ + 7.5 }, price: 1.79 };
    this.gasStations.push(st);
    this.lamps.push({ x: cx, y: 4.8, z: cz + canopyZ, gas: true });
    this.pois.push({ name, x: cx, z: cz + canopyZ, kind: 'gas' });
    this.parkingSpots = this.parkingSpots || [];
    this.parkingSpots.push({ x: cx - 18, z: cz - 6, h: 0 }, { x: cx + 18, z: cz - 6, h: Math.PI });
  }

  buildStreetLights() {
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.08, 0.13, 7.5, 6).translate(0, 3.75, 0),
      new THREE.BoxGeometry(0.1, 0.1, 2.0).translate(0, 7.4, 0.95),
      new THREE.CylinderGeometry(0.2, 0.25, 0.4, 6).translate(0, 0.2, 0),
    ]);
    const headGeo = new THREE.BoxGeometry(0.45, 0.14, 0.8); headGeo.translate(0, 7.3, 1.9);
    const items = [];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const cx = blockCenter(i), cz = blockCenter(j), e = BLOCK_HALF - 0.6;
      for (const t of [-20, 20]) {
        items.push([cx + e, cz + t, Math.PI / 2]); items.push([cx - e, cz - t, -Math.PI / 2]);
        items.push([cx + t, cz + e, 0]); items.push([cx - t, cz - e, Math.PI]);
      }
    }
    for (let z = PIER.z0 + 20; z < PIER.z1; z += 40) { items.push([PIER.x0 + 0.5, z, Math.PI / 2, PIER.y]); }
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.7, roughness: 0.45 });
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1.0, 0.78, 0.5), emissiveIntensity: 0 });
    const pole = new THREE.InstancedMesh(poleGeo, poleMat, items.length);
    const head = new THREE.InstancedMesh(headGeo, this.lampHeadMat, items.length);
    const mm = new THREE.Matrix4();
    items.forEach(([x, z, r, y = 0.15], i) => {
      mm.makeRotationY(r).setPosition(x, y, z);
      pole.setMatrixAt(i, mm); head.setMatrixAt(i, mm);
      this.lamps.push({ x: x + Math.sin(r) * 1.9, y: y + 7.0, z: z + Math.cos(r) * 1.9 });
      this.colliders.addCircle(x, z, 0.2, 8);
    });
    pole.castShadow = true; pole.frustumCulled = head.frustumCulled = false;
    this.scene.add(pole, head);
  }

  buildTrafficLights() {
    const poleGeo = mergeGeometries([new THREE.CylinderGeometry(0.1, 0.12, 5.2, 6).translate(0, 2.6, 0), new THREE.BoxGeometry(0.42, 1.25, 0.42).translate(0, 4.75, 0)]);
    const polesPos = [];
    const bulbs = [[], [], []];
    for (let ii = 0; ii <= GRID; ii++) for (let jj = 0; jj <= GRID; jj++) {
      const ix = roadCoord(ii), iz = roadCoord(jj);
      for (const s of [1, -1]) {
        const px = ix + s * 7.8, pz = iz + s * 7.8;
        if (Math.abs(px) > HALF + 7 || Math.abs(pz) > HALF + 7) continue;
        polesPos.push([px, pz]);
        this.colliders.addCircle(px, pz, 0.2, 6);
        // one bulb set seen by X traffic (sphere sticks out along X), one by Z traffic
        for (let axis = 0; axis < 2; axis++) {
          for (let c = 0; c < 3; c++) {
            bulbs[c].push({ x: px, y: 5.15 - c * 0.38, z: pz, ii, jj, axis });
          }
        }
      }
    }
    const mm = new THREE.Matrix4();
    const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2b2e30, metalness: 0.6, roughness: 0.5 }), polesPos.length);
    polesPos.forEach(([x, z], i) => pole.setMatrixAt(i, mm.makeTranslation(x, 0.15, z)));
    pole.castShadow = true; pole.frustumCulled = false; this.scene.add(pole);
    // bulb: a thin disc pair facing one axis
    this.tlMeshes = [];
    const geoX = new THREE.CylinderGeometry(0.13, 0.13, 0.46, 10); geoX.rotateZ(Math.PI / 2);  // sticks out along X
    const geoZ = new THREE.CylinderGeometry(0.13, 0.13, 0.46, 10); geoZ.rotateX(Math.PI / 2);  // along Z
    for (let c = 0; c < 3; c++) {
      for (let axis = 0; axis < 2; axis++) {
        const list = bulbs[c].filter((b) => b.axis === axis);
        const im = new THREE.InstancedMesh(axis === 0 ? geoX : geoZ, new THREE.MeshBasicMaterial({ color: 0xffffff }), list.length);
        const col = new THREE.Color(0.05, 0.05, 0.05);
        list.forEach((b, i) => { im.setMatrixAt(i, mm.makeTranslation(b.x, b.y + 0.15, b.z)); im.setColorAt(i, col); });
        im.frustumCulled = false;
        this.scene.add(im);
        this.tlMeshes.push({ im, list, c, axis });
      }
    }
    this.tlTimer = 0;
  }

  updateTrafficLights(t, dt) {
    this.tlTimer -= dt;
    if (this.tlTimer > 0) return;
    this.tlTimer = 0.2;
    const ON = [new THREE.Color(5, 0.25, 0.15), new THREE.Color(5, 2.6, 0.2), new THREE.Color(0.3, 5, 1.2)];
    const OFF = [new THREE.Color(0.12, 0.02, 0.02), new THREE.Color(0.12, 0.09, 0.02), new THREE.Color(0.02, 0.1, 0.04)];
    const map = { r: 0, y: 1, g: 2 };
    for (const { im, list, c, axis } of this.tlMeshes) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const s = map[lightState(b.ii, b.jj, axis, t)];
        im.setColorAt(i, s === c ? ON[c] : OFF[c]);
      }
      im.instanceColor.needsUpdate = true;
    }
  }

  buildBeach() {
    const R = this.rand;
    // pier
    const wood = waterAbsorb(new THREE.MeshStandardMaterial({ color: 0x7b5a3c, roughness: 0.9 }), 'pier');
    const deck = new THREE.Mesh(new THREE.BoxGeometry(PIER.x1 - PIER.x0, 0.4, PIER.z1 - PIER.z0), wood);
    deck.position.set((PIER.x0 + PIER.x1) / 2, PIER.y - 0.2, (PIER.z0 + PIER.z1) / 2);
    deck.castShadow = deck.receiveShadow = true; this.scene.add(deck);
    const posts = [];
    for (let z = PIER.z0 + 4; z < PIER.z1; z += 8) for (const x of [PIER.x0 + 0.5, PIER.x1 - 0.5]) posts.push([x, z]);
    const postGeo = new THREE.CylinderGeometry(0.25, 0.25, 1, 8); postGeo.translate(0, 0.5, 0);
    const pim = new THREE.InstancedMesh(postGeo, wood, posts.length);
    const mm = new THREE.Matrix4();
    posts.forEach(([x, z], i) => { const g = seabedHeight(x, z); pim.setMatrixAt(i, mm.makeScale(1, PIER.y - g, 1).setPosition(x, g, z)); });
    pim.castShadow = true; this.scene.add(pim);
    for (const x of [PIER.x0 + 0.1, PIER.x1 - 0.1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, PIER.z1 - PIER.z0), wood); rail.position.set(x, PIER.y + 1.0, (PIER.z0 + PIER.z1) / 2); this.scene.add(rail);
    }
    this.colliders.add(PIER.x0 - 0.3, PIER.z0 + 4, PIER.x0 + 0.15, PIER.z1, PIER.y + 1.1, 'rail');
    this.colliders.add(PIER.x1 - 0.15, PIER.z0 + 4, PIER.x1 + 0.3, PIER.z1, PIER.y + 1.1, 'rail');
    this.pois.push({ name: 'the Pier', x: 200, z: 950, kind: 'beach' });
    this.pois.push({ name: 'the beach', x: -100, z: 840, kind: 'beach' });

    // palm trees
    const palms = [];
    for (let x = -1400; x < 1400; x += 18 + R() * 20) { if (Math.abs(x - 200) < 14) continue; palms.push([x + R() * 6, SHORE_Z + 6 + R() * 40, 0.8 + R() * 0.5]); }
    const segs = [];
    for (let k = 0; k < 6; k++) segs.push(new THREE.CylinderGeometry(0.17 - k * 0.012, 0.2 - k * 0.012, 1.6, 7).translate(k * k * 0.06, 0.8 + k * 1.55, 0));
    const trunk = mergeGeometries(segs);
    const fronds = [];
    for (let k = 0; k < 8; k++) {
      const f = new THREE.PlaneGeometry(0.9, 4.2, 1, 4); f.translate(0, 2.1, 0);
      const p = f.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -y * y * 0.09); }
      f.rotateX(-Math.PI / 2.6); f.rotateY((k / 8) * Math.PI * 2);
      f.translate(25 * 0.06, 9.5, 0);
      fronds.push(f);
    }
    const leaf = mergeGeometries(fronds); leaf.computeVertexNormals();
    const tIm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x8a6f4f, roughness: 1 }), palms.length);
    const lIm = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ color: 0x3f7a2a, roughness: 0.8, side: THREE.DoubleSide }), palms.length);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    palms.forEach(([x, z, sc], i) => {
      q.setFromEuler(e.set(0, R() * 6.28, 0)); mm.compose(p.set(x, seabedHeight(x, z) - 0.2, z), q, s.set(sc, sc, sc));
      tIm.setMatrixAt(i, mm); lIm.setMatrixAt(i, mm);
      this.colliders.addCircle(x, z, 0.25, 8);
    });
    for (const m of [tIm, lIm]) { m.castShadow = true; m.frustumCulled = false; this.scene.add(m); }

    // umbrellas + lifeguard towers
    const umb = [];
    for (let k = 0; k < 90; k++) { const x = (R() - 0.5) * 1600; if (Math.abs(x - 200) < 12) continue; umb.push([x, SHORE_Z + 22 + R() * 38]); }
    const uGeo = new THREE.ConeGeometry(1.6, 0.6, 12, 1, true); uGeo.translate(0, 2.3, 0);
    const uIm = new THREE.InstancedMesh(uGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.8 }), umb.length);
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.3, 5); poleGeo.translate(0, 1.15, 0);
    const upIm = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0xdddddd }), umb.length);
    const cols = ['#e84a3c', '#f2c12e', '#2e86de', '#ffffff', '#27ae60', '#ff7eb6'];
    const cc = new THREE.Color();
    umb.forEach(([x, z], i) => { mm.makeTranslation(x, seabedHeight(x, z), z); uIm.setMatrixAt(i, mm); upIm.setMatrixAt(i, mm); uIm.setColorAt(i, cc.set(pick(cols, R))); });
    for (const m of [uIm, upIm]) { m.castShadow = true; m.frustumCulled = false; this.scene.add(m); }
    for (const x of [-560, -120, 560]) {
      const z = SHORE_Z + 30, y = seabedHeight(x, z);
      const tg = new THREE.Group();
      const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea }), red = new THREE.MeshStandardMaterial({ color: 0xd9412f });
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 0.15), white); l.position.set(a * 1.1, 1.3, b * 1.1); tg.add(l); }
      const hut = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.8, 2.8), red); hut.position.y = 3.5; tg.add(hut);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1, 4), white); roof.position.y = 4.9; roof.rotation.y = Math.PI / 4; tg.add(roof);
      tg.traverse((o) => { o.castShadow = true; });
      tg.position.set(x, y, z); this.scene.add(tg);
      this.colliders.add(x - 1.4, z - 1.4, x + 1.4, z + 1.4, y + 5);
    }
    this.beachParking = [];
    for (let k = 0; k < 6; k++) this.beachParking.push({ x: -300 + k * 120, z: SHORE_Z + 4, h: Math.PI / 2 });
  }

  buildMountains() {
    const R = this.rand, geos = [];
    for (let k = 0; k < 46; k++) {
      const a = -Math.PI * 0.62 + (k / 46) * Math.PI * 1.24 + (R() - 0.5) * 0.06; // north arc
      const dist = 2300 + R() * 1200;
      const x = Math.sin(a) * dist, z = -Math.cos(a) * dist * 0.85 - 200;
      const r = 380 + R() * 520, h = 260 + R() * 520;
      const g = new THREE.ConeGeometry(r, h, 9, 6);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        const n = fbm(vx * 0.004 + k, vz * 0.004, 3);
        const f = 0.75 + n * 0.5;
        p.setXYZ(i, vx * f, vy + (n - 0.5) * h * 0.15, vz * f);
      }
      g.translate(x, h / 2 - 20, z);
      g.deleteAttribute('uv');
      const ng = g.toNonIndexed();
      const cols = new Float32Array(ng.attributes.position.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < ng.attributes.position.count; i++) {
        const y = ng.attributes.position.getY(i);
        const t = y / 700;
        if (t > 0.62) c.setRGB(0.92, 0.94, 0.97);
        else if (t > 0.3) c.setRGB(0.42, 0.4, 0.37);
        else c.setRGB(0.24, 0.33, 0.2);
        cols.set([c.r, c.g, c.b], i * 3);
      }
      ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      geos.push(ng);
    }
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    m.geometry.computeVertexNormals();
    this.scene.add(m);
  }

  /* pedestrian navigation graph: 4 corners per block, ring edges + crosswalks */
  buildSidewalkGraph() {
    const nodes = [];
    const id = (i, j, c) => (i * GRID + j) * 4 + c;
    const S = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) for (let c = 0; c < 4; c++)
      nodes[id(i, j, c)] = { x: blockCenter(i) + S[c][0] * (BLOCK_HALF - 2), z: blockCenter(j) + S[c][1] * (BLOCK_HALF - 2), edges: [], id: id(i, j, c) };
    const link = (a, b, cross) => { nodes[a].edges.push({ to: b, cross }); nodes[b].edges.push({ to: a, cross }); };
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      for (let c = 0; c < 4; c++) link(id(i, j, c), id(i, j, (c + 1) % 4), null);
      if (i + 1 < GRID) {  // cross the road running along Z (cars on axis 1)
        link(id(i, j, 1), id(i + 1, j, 0), { ii: i + 1, jj: j, axis: 1 });
        link(id(i, j, 2), id(i + 1, j, 3), { ii: i + 1, jj: j + 1, axis: 1 });
      }
      if (j + 1 < GRID) {  // cross road running along X (cars on axis 0)
        link(id(i, j, 3), id(i, j + 1, 0), { ii: i, jj: j + 1, axis: 0 });
        link(id(i, j, 2), id(i, j + 1, 1), { ii: i + 1, jj: j + 1, axis: 0 });
      }
    }
    this.nodes = nodes;
  }

  nearestNode(x, z) {
    const i = clamp(Math.floor((x + HALF) / CELL), 0, GRID - 1), j = clamp(Math.floor((z + HALF) / CELL), 0, GRID - 1);
    let best = null, bd = Infinity;
    for (let c = 0; c < 4; c++) { const n = this.nodes[(i * GRID + j) * 4 + c]; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }

  drawMapImage() {
    const S = 0.5, X0 = -1100, Z0 = -1100, W = 2200, H = 2800;
    const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
    const g = c.getContext('2d');
    const P = (x, z) => [(x - X0) * S, (z - Z0) * S];
    g.fillStyle = '#3d5a34'; g.fillRect(0, 0, c.width, c.height);
    const [sx, sy] = P(-1100, SHORE_Z); g.fillStyle = '#d9c99a'; g.fillRect(sx, sy, c.width, 70 * S);
    const [, wy] = P(0, SHORE_Z + 67); g.fillStyle = '#2b7ea1'; g.fillRect(0, wy, c.width, c.height);
    // depth shading
    for (let z = SHORE_Z + 67; z < 1700; z += 20) for (let x = -1100; x < 1100; x += 20) {
      const d = WATER_LEVEL - seabedHeight(x, z);
      const k = clamp(d / 45, 0, 1);
      g.fillStyle = `rgb(${Math.round(43 - k * 30)},${Math.round(126 - k * 70)},${Math.round(161 - k * 60)})`;
      const [px, pz] = P(x, z); g.fillRect(px, pz, 20 * S + 1, 20 * S + 1);
    }
    const [ax, az] = P(-HALF - ROAD_HALF, -HALF - ROAD_HALF);
    g.fillStyle = '#5b5e63'; g.fillRect(ax, az, (GRID * CELL + 14) * S, (GRID * CELL + 14) * S);
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const [bx, bz] = P(blockCenter(i) - BLOCK_HALF, blockCenter(j) - BLOCK_HALF);
      g.fillStyle = '#a3a29d'; g.fillRect(bx, bz, BLOCK_HALF * 2 * S, BLOCK_HALF * 2 * S);
    }
    g.fillStyle = '#5f8d46';
    for (const p of this.parks) { const [px, pz] = P(p.x - BLOCK_HALF + 2, p.z - BLOCK_HALF + 2); g.fillRect(px, pz, (BLOCK_HALF * 2 - 4) * S, (BLOCK_HALF * 2 - 4) * S); }
    for (const [x0, z0, x1, z1, h] of this.buildings) {
      const k = clamp(h / 160, 0, 1);
      g.fillStyle = `rgb(${Math.round(200 - k * 90)},${Math.round(196 - k * 90)},${Math.round(186 - k * 80)})`;
      const [px, pz] = P(x0, z0); g.fillRect(px, pz, (x1 - x0) * S, (z1 - z0) * S);
    }
    g.fillStyle = '#f39c34';
    for (const st of this.gasStations) { const [px, pz] = P(st.zone.x0, st.zone.z0); g.fillRect(px, pz, 26 * S, 15 * S); }
    g.fillStyle = '#7b5a3c'; { const [px, pz] = P(PIER.x0, PIER.z0); g.fillRect(px, pz, (PIER.x1 - PIER.x0) * S, (PIER.z1 - PIER.z0) * S); }
    return { canvas: c, S, X0, Z0 };
  }
}
