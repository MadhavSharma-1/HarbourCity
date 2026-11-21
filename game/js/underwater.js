import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seabedHeight, WATER_LEVEL, SHORE_Z, waterAbsorb } from './world.js';
import { mulberry32, fbm, clamp, pick } from './util.js';

/** Reef, kelp forests, fish schools, manta rays, jellyfish, a shipwreck with treasure, god rays, marine snow. */
export class Underwater {
  constructor(game) {
    this.game = game; this.scene = game.scene; this.shared = game.shared;
    this.R = mulberry32(4242);
    this.wreckPos = new THREE.Vector3(-260, 0, 1480);
    this.treasures = [];
    this.found = 0;
  }

  build() {
    this.buildRocks();
    this.buildCoral();
    this.buildKelp();
    this.buildWreck();
    this.buildFish();
    this.buildRays();
    this.buildJellies();
    this.buildShafts();
    this.buildSnow();
  }

  randSeabed(zMin, zMax, depthMin, depthMax, xRange = 1400, tries = 30, cond) {
    const R = this.R;
    for (let k = 0; k < tries; k++) {
      const x = (R() - 0.5) * 2 * xRange, z = zMin + R() * (zMax - zMin);
      const h = seabedHeight(x, z), d = WATER_LEVEL - h;
      if (d >= depthMin && d <= depthMax && (!cond || cond(x, z))) return [x, h, z];
    }
    return null;
  }

  buildRocks() {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const n = fbm(v.x * 1.7 + 4, v.z * 1.7 + v.y * 2, 3);
      v.multiplyScalar(0.7 + n * 0.6); v.y *= 0.6;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    const list = [];
    for (let k = 0; k < 900; k++) { const s = this.randSeabed(SHORE_Z + 90, SHORE_Z + 1600, 2, 60); if (s) list.push(s); }
    const im = new THREE.InstancedMesh(g, waterAbsorb(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), 'rock'), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), c = new THREE.Color();
    list.forEach(([x, y, z], i) => {
      const s = 0.6 + this.R() ** 3 * 6;
      q.setFromEuler(e.set(this.R(), this.R() * 6, this.R()));
      m.compose(pos.set(x, y + s * 0.15, z), q, sc.set(s * (0.8 + this.R() * 0.6), s, s * (0.8 + this.R() * 0.6)));
      im.setMatrixAt(i, m);
      const gr = 0.32 + this.R() * 0.18;
      im.setColorAt(i, c.setRGB(gr, gr * (0.95 + this.R() * 0.15), gr * 0.88));
    });
    im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
    this.scene.add(im);
  }

  buildCoral() {
    const R = this.R;
    // a few shapes: brain coral, branching staghorn, sea fan, tube sponge, anemone
    const brain = new THREE.SphereGeometry(0.6, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    { const p = brain.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + Math.sin(x * 14) * Math.sin(z * 14) * 0.05; p.setXYZ(i, x * k, y * k * 0.8, z * k); } brain.computeVertexNormals(); }
    const branch = []; const addBranch = (x, y, z, ax, az, len, r, depth) => {
      const g = new THREE.CylinderGeometry(r * 0.7, r, len, 6); g.translate(0, len / 2, 0);
      g.rotateZ(az); g.rotateX(ax); g.translate(x, y, z); branch.push(g);
      if (depth > 0) { const tx = x - Math.sin(az) * len, ty = y + Math.cos(az) * Math.cos(ax) * len, tz = z + Math.sin(ax) * len; for (let k = 0; k < 2; k++) addBranch(tx, ty, tz, ax + (R() - 0.5) * 0.9, az + (R() - 0.5) * 0.9, len * 0.75, r * 0.7, depth - 1); }
    };
    addBranch(0, 0, 0, 0, 0, 0.5, 0.07, 3);
    const stag = mergeGeometries(branch);
    const fan = new THREE.CircleGeometry(0.8, 14, 0, Math.PI); { const p = fan.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 3) * 0.05); }
    const tube = mergeGeometries([0, 1, 2, 3].map((k) => new THREE.CylinderGeometry(0.11, 0.13, 0.6 + k * 0.25, 8, 1, true).translate(Math.cos(k * 1.7) * 0.18, 0.3 + k * 0.12, Math.sin(k * 1.7) * 0.18)));
    const anem = mergeGeometries(Array.from({ length: 14 }, (_, k) => { const a = (k / 14) * Math.PI * 2; return new THREE.CylinderGeometry(0.015, 0.03, 0.35, 4).translate(0, 0.17, 0).rotateZ(Math.cos(a) * 0.6).rotateX(Math.sin(a) * 0.6); }));
    const shapes = [
      { g: brain, cols: ['#c9a66b', '#8f6f9a', '#d88b5f', '#a3b86c'], n: 700 },
      { g: stag, cols: ['#e07a5f', '#f2cc8f', '#c86b98', '#f4a261'], n: 900 },
      { g: fan, cols: ['#9b2d5a', '#c44569', '#6a4c93', '#e76f51'], n: 500, side: THREE.DoubleSide },
      { g: tube, cols: ['#e9c46a', '#f28482', '#84a59d', '#bc6c25'], n: 450, side: THREE.DoubleSide },
      { g: anem, cols: ['#ff70a6', '#70d6ff', '#ffd670', '#e9ff70'], n: 500, emissive: true },
    ];
    // reefs: clusters in 3-18 m depth
    const reefCenters = [];
    for (let k = 0; k < 22; k++) { const s = this.randSeabed(SHORE_Z + 120, SHORE_Z + 900, 4, 18); if (s) reefCenters.push(s); }
    reefCenters.push([200, seabedHeight(200, 1080), 1080]); // right off the end of the pier
    this.reefCenters = reefCenters;
    for (const sh of shapes) {
      const list = [];
      for (let k = 0; k < sh.n; k++) {
        const c = pick(reefCenters, R);
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 40;
        const x = c[0] + Math.cos(a) * r, z = c[2] + Math.sin(a) * r;
        const y = seabedHeight(x, z);
        if (WATER_LEVEL - y < 1.5) continue;
        list.push([x, y, z]);
      }
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: sh.side || THREE.FrontSide });
      if (sh.emissive) { mat.emissive = new THREE.Color(0.25, 0.1, 0.2); }
      waterAbsorb(mat, 'coral' + shapes.indexOf(sh));
      const im = new THREE.InstancedMesh(sh.g, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), cc = new THREE.Color();
      list.forEach(([x, y, z], i) => {
        const sc = 0.6 + R() * 1.6;
        q.setFromEuler(e.set((R() - 0.5) * 0.3, R() * 6.3, (R() - 0.5) * 0.3));
        m.compose(p.set(x, y - 0.05, z), q, s.set(sc, sc, sc));
        im.setMatrixAt(i, m); im.setColorAt(i, cc.set(pick(sh.cols, R)).multiplyScalar(0.8 + R() * 0.4));
      });
      im.frustumCulled = false; im.receiveShadow = true;
      this.scene.add(im);
    }
  }

  buildKelp() {
    const R = this.R;
    const g = new THREE.PlaneGeometry(0.5, 1, 1, 10); g.translate(0, 0.5, 0);
    const g2 = g.clone().rotateY(Math.PI / 2);
    const geo = mergeGeometries([g, g2]);
    const list = [];
    const forests = [];
    for (let k = 0; k < 14; k++) { const s = this.randSeabed(SHORE_Z + 200, SHORE_Z + 1200, 9, 30); if (s) forests.push(s); }
    this.kelpForests = forests;
    for (let k = 0; k < 2600; k++) {
      const f = pick(forests, R);
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 45;
      const x = f[0] + Math.cos(a) * r, z = f[2] + Math.sin(a) * r;
      const y = seabedHeight(x, z), depth = WATER_LEVEL - y;
      if (depth < 5) continue;
      list.push([x, y, z, Math.min(depth - 1, 6 + R() * 16)]);
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x5b6b2a, roughness: 0.7, side: THREE.DoubleSide, transparent: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.shared.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
          float k = uv.y * uv.y;
          transformed.x += sin(uTime * 0.7 + ph + uv.y * 2.5) * 0.9 * k / max(instanceMatrix[0].x, 0.01);
          transformed.z += cos(uTime * 0.55 + ph * 1.3 + uv.y * 2.0) * 0.6 * k / max(instanceMatrix[2].z, 0.01);
          transformed.x *= 0.6 + 0.4 * sin(uv.y * 31.0 + ph);`);
    };
    waterAbsorb(mat, 'kelp');
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    list.forEach(([x, y, z, h], i) => {
      q.setFromEuler(e.set(0, R() * 6.3, 0));
      m.compose(p.set(x, y, z), q, s.set(0.8 + R() * 0.8, h, 0.8 + R() * 0.8));
      im.setMatrixAt(i, m); im.setColorAt(i, c.setHSL(0.17 + R() * 0.06, 0.45 + R() * 0.2, 0.22 + R() * 0.1));
    });
    im.frustumCulled = false;
    this.scene.add(im);
  }

  buildWreck() {
    const w = this.wreckPos;
    w.y = seabedHeight(w.x, w.z);
    const grp = new THREE.Group();
    const rust = new THREE.MeshStandardMaterial({ color: 0x5a3b2a, roughness: 1, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2f2a25, roughness: 1 });
    // hull: a lofted shape made from a deformed box
    const hull = new THREE.BoxGeometry(12, 7, 60, 6, 4, 24);
    const p = hull.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nz = z / 30, ny = (y + 3.5) / 7;
      const bow = Math.max(0, nz - 0.55) / 0.45;
      x *= (0.45 + 0.55 * Math.sqrt(ny)) * (1 - bow * bow * 0.95);
      if (nz < -0.85) x *= 0.85;
      y += bow * bow * 2;
      x += (fbm(z * 0.3, y * 0.3, 2) - 0.5) * 0.8; // dents
      p.setXYZ(i, x, y, z);
    }
    hull.computeVertexNormals();
    const hm = new THREE.Mesh(hull, rust); hm.position.y = 3; grp.add(hm);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 44), dark); deck.position.set(0, 6.4, -4); grp.add(deck);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 7), rust); bridge.position.set(0, 9, -20); bridge.rotation.z = 0.05; grp.add(bridge);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 14, 8), dark); mast.position.set(0, 11, 6); mast.rotation.z = 0.6; grp.add(mast);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 5, 12), dark); stack.position.set(0, 12, -24); stack.rotation.x = 0.3; grp.add(stack);
    for (let k = 0; k < 5; k++) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 5), new THREE.MeshStandardMaterial({ color: pick(['#3d5a6c', '#7a3b2e', '#4a5d3a']), roughness: 1, metalness: 0.4 }));
      crate.position.set((this.R() - 0.5) * 30, 1.1, (this.R() - 0.5) * 50 + 20); crate.rotation.set(this.R() * 0.3, this.R() * 3, this.R() * 0.4);
      grp.add(crate);
    }
    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (!o.material.customProgramCacheKey || !o.material._abs) { waterAbsorb(o.material, 'wreck'); o.material._abs = true; } } });
    grp.position.copy(w); grp.position.y -= 1.2;
    grp.rotation.set(0.04, 0.7, 0.22);
    this.scene.add(grp);

    // treasure chests: in and around the wreck, on the reefs, in the trench
    const chestGeo = new THREE.BoxGeometry(1, 0.6, 0.7);
    const lidGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 10, 1, false, 0, Math.PI); lidGeo.rotateZ(Math.PI / 2);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xffb000, emissiveIntensity: 0.7, metalness: 1, roughness: 0.25 });
    const spots = [
      [w.x + 10, w.z + 16], [w.x - 12, w.z - 10], [w.x + 4, w.z - 26],
      ...this.reefCenters.slice(0, 3).map((c) => [c[0] + 5, c[2] + 3]),
      ...this.kelpForests.slice(0, 2).map((c) => [c[0] - 4, c[2] + 6]),
    ].slice(0, 8);
    for (const [x, z] of spots) {
      const y = seabedHeight(x, z);
      const c = new THREE.Group();
      if (!wood._abs) { waterAbsorb(wood, 'chest'); wood._abs = true; }
      c.add(new THREE.Mesh(chestGeo, wood));
      const lid = new THREE.Mesh(lidGeo, wood); lid.position.y = 0.3; c.add(lid);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.66, 0.12), gold); c.add(band);
      c.position.set(x, y + 0.3, z); c.rotation.y = this.R() * 6;
      this.scene.add(c);
      this.treasures.push({ group: c, x, y: y + 0.3, z, found: false, value: 200 + Math.floor(this.R() * 6) * 50 });
    }
    this.goldMat = gold;
  }

  buildFish() {
    // small fish: elongated body + tail; wiggle in the vertex shader
    const body = new THREE.SphereGeometry(0.12, 8, 6).scale(0.45, 0.7, 1.6);
    const tail = new THREE.ConeGeometry(0.1, 0.18, 4).rotateX(-Math.PI / 2).scale(0.25, 1.2, 1).translate(0, 0, -0.24);
    const geo = mergeGeometries([body, tail]);
    const N = 900;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.5 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.shared.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fph = float(gl_InstanceID) * 1.7;
          transformed.x += sin(uTime * 12.0 + fph + position.z * 10.0) * 0.06 * smoothstep(0.1, -0.3, position.z);`);
    };
    waterAbsorb(mat, 'fish');
    this.fish = new THREE.InstancedMesh(geo, mat, N);
    this.fish.frustumCulled = false;
    this.schools = [];
    const palettes = [['#f4d35e', '#ee964b'], ['#5fa8d3', '#cae9ff'], ['#c0c0c8', '#e0e0e8'], ['#ff6b6b', '#ffd93d'], ['#7bdff2', '#b2f7ef'], ['#f28482', '#f6bd60']];
    const R = this.R, c = new THREE.Color();
    let idx = 0;
    const centers = [...this.reefCenters, ...this.kelpForests, [this.wreckPos.x, this.wreckPos.y, this.wreckPos.z]];
    while (idx < N) {
      const home = pick(centers, R);
      const n = Math.min(N - idx, 20 + Math.floor(R() * 40));
      const pal = pick(palettes, R);
      const sc = 0.7 + R() * 1.6;
      const s = { home: new THREE.Vector3(home[0], 0, home[2]), center: new THREE.Vector3(home[0], Math.min(WATER_LEVEL - 2, home[1] + 2 + R() * 4), home[2]), vel: new THREE.Vector3(), start: idx, n, sc, wander: R() * 100, fish: [] };
      for (let k = 0; k < n; k++) {
        const f = { p: s.center.clone().add(new THREE.Vector3((R() - 0.5) * 6, (R() - 0.5) * 3, (R() - 0.5) * 6)), v: new THREE.Vector3(R() - 0.5, 0, R() - 0.5) };
        s.fish.push(f);
        this.fish.setColorAt(idx + k, c.set(pal[k % 2]).multiplyScalar(0.8 + R() * 0.4));
      }
      idx += n;
      this.schools.push(s);
    }
    this.scene.add(this.fish);
  }

  buildRays() {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.2); shape.quadraticCurveTo(1.6, 0.4, 2.4, -0.2); shape.quadraticCurveTo(0.8, -0.3, 0.3, -1.0); shape.lineTo(0, -1.1);
    shape.lineTo(-0.3, -1.0); shape.quadraticCurveTo(-0.8, -0.3, -2.4, -0.2); shape.quadraticCurveTo(-1.6, 0.4, 0, 1.2);
    const g = new THREE.ShapeGeometry(shape, 8); g.rotateX(-Math.PI / 2);
    const tail = new THREE.CylinderGeometry(0.02, 0.06, 2.5, 4).rotateX(Math.PI / 2).translate(0, 0, 2.2);
    tail.deleteAttribute('uv'); g.deleteAttribute('uv');
    const geo = mergeGeometries([g.toNonIndexed(), tail.toNonIndexed()]);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.shared.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.y += sin(uTime * 1.6 + float(gl_InstanceID) - abs(position.x) * 0.6) * abs(position.x) * 0.35;`);
    };
    waterAbsorb(mat, 'ray');
    this.rays = [];
    this.rayMesh = new THREE.InstancedMesh(geo, mat, 6);
    this.rayMesh.frustumCulled = false;
    for (let k = 0; k < 6; k++) {
      const c = pick(this.reefCenters, this.R);
      this.rays.push({ c: new THREE.Vector3(c[0], 0, c[2]), r: 25 + this.R() * 40, a: this.R() * 6, sp: 0.06 + this.R() * 0.05, y: Math.min(WATER_LEVEL - 3, c[1] + 4 + this.R() * 4), s: 1.2 + this.R() * 1.3 });
    }
    this.scene.add(this.rayMesh);
  }

  buildJellies() {
    const bell = new THREE.SphereGeometry(0.35, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const tent = mergeGeometries(Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2; return new THREE.CylinderGeometry(0.008, 0.004, 1.2, 3).translate(Math.cos(a) * 0.22, -0.55, Math.sin(a) * 0.22); }));
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, emissive: 0x6fb6ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
    const geo = mergeGeometries([bell, tent.clone()].map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.shared.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float pulse = sin(uTime * 2.2 + float(gl_InstanceID) * 2.0);
          transformed.xz *= 1.0 + pulse * 0.12 * step(-0.05, position.y);
          transformed.x += sin(uTime + position.y * 3.0 + float(gl_InstanceID)) * 0.1 * step(position.y, -0.05);`);
    };
    this.jellies = [];
    this.jellyMesh = new THREE.InstancedMesh(geo, mat, 60);
    this.jellyMesh.frustumCulled = false;
    for (let k = 0; k < 60; k++) {
      const s = this.randSeabed(SHORE_Z + 300, SHORE_Z + 1500, 15, 60) || [0, -20, 1300];
      this.jellies.push({ p: new THREE.Vector3(s[0], WATER_LEVEL - 3 - this.R() * Math.min(20, WATER_LEVEL - s[1] - 4), s[2]), ph: this.R() * 6, s: 0.6 + this.R() * 1.4 });
    }
    this.scene.add(this.jellyMesh);
  }

  buildShafts() {
    const g = new THREE.CylinderGeometry(1.2, 4, 30, 16, 1, true); g.translate(0, -15, 0);
    this.shaftMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: this.shared.uTime, uI: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uTime; uniform float uI; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 1.5); float a = vUv.y * vUv.y * edge * (0.6 + 0.4 * sin(uTime * 0.8 + vUv.x * 18.0)); gl_FragColor = vec4(vec3(0.55, 0.85, 0.9) * a * 0.09 * uI, 1.0); }',
    });
    this.shafts = [];
    for (let k = 0; k < 26; k++) {
      const m = new THREE.Mesh(g, this.shaftMat);
      m.rotation.z = 0.25; m.rotation.x = 0.15;
      this.scene.add(m);
      this.shafts.push({ m, ox: (Math.random() - 0.5) * 80, oz: (Math.random() - 0.5) * 80 });
    }
  }

  buildSnow() {
    const n = 1500, p = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) p[i] = (Math.random() - 0.5) * 40;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfe9e6, size: 0.05, transparent: true, opacity: 0.7, depthWrite: false }));
    this.snow.frustumCulled = false; this.snow.visible = false;
    this.scene.add(this.snow);
  }

  update(dt, t) {
    const g = this.game, cam = g.camera.position;
    const under = g.env.underwater;
    const near = cam.z > SHORE_Z + 30 && cam.y < 40;
    this.fish.visible = this.rayMesh.visible = this.jellyMesh.visible = near;
    // god rays near the camera
    this.shaftMat.uniforms.uI.value = under ? (1 - g.env.night) * 1.0 : 0;
    for (const s of this.shafts) {
      s.m.visible = under;
      if (!under) continue;
      const gx = Math.floor((cam.x + s.ox) / 80) * 80 - s.ox, gz = Math.floor((cam.z + s.oz) / 80) * 80 - s.oz;
      s.m.position.set(gx + s.ox * 0.5 + 40, WATER_LEVEL, gz + s.oz * 0.5 + 40);
    }
    this.snow.visible = under;
    if (under) { this.snow.position.set(Math.floor(cam.x / 40) * 40, Math.floor(cam.y / 40) * 40, Math.floor(cam.z / 40) * 40); }
    if (!near) return;

    // boids-lite: each school wanders around its home; fish follow + avoid the diver
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), look = new THREE.Matrix4();
    const diver = g.player.pos;
    const tmp = new THREE.Vector3(), zero = new THREE.Vector3();
    for (const s of this.schools) {
      const far = s.center.distanceTo(cam) > 160;
      s.wander += dt * 0.25;
      const tx = s.home.x + Math.sin(s.wander) * 18, tz = s.home.z + Math.cos(s.wander * 0.8) * 18;
      const floor = seabedHeight(tx, tz);
      const ty = clamp(floor + 3 + Math.sin(s.wander * 1.3) * 1.5, floor + 1.2, WATER_LEVEL - 1.5);
      s.vel.lerp(tmp.set(tx - s.center.x, ty - s.center.y, tz - s.center.z).clampLength(0, 2.2), dt * 0.8);
      s.center.addScaledVector(s.vel, dt);
      if (far) continue;
      const scare = diver.distanceTo(s.center) < 12;
      for (let k = 0; k < s.n; k++) {
        const f = s.fish[k];
        tmp.subVectors(s.center, f.p);
        const d = tmp.length();
        f.v.addScaledVector(tmp, dt * (d > 4 ? 1.2 : 0.3));
        f.v.x += Math.sin(t * 1.3 + k) * dt * 0.8; f.v.z += Math.cos(t * 1.1 + k * 1.3) * dt * 0.8; f.v.y += Math.sin(t * 0.9 + k * 0.7) * dt * 0.3;
        if (scare) { tmp.subVectors(f.p, diver); const dd = tmp.length(); if (dd < 5) f.v.addScaledVector(tmp.normalize(), dt * 18 / Math.max(dd, 0.5)); }
        f.v.clampLength(0.6, scare ? 6 : 2.6);
        f.p.addScaledVector(f.v, dt);
        const fl = seabedHeight(f.p.x, f.p.z) + 0.5;
        if (f.p.y < fl) { f.p.y = fl; f.v.y = Math.abs(f.v.y); }
        if (f.p.y > WATER_LEVEL - 0.6) { f.p.y = WATER_LEVEL - 0.6; f.v.y = -Math.abs(f.v.y); }
        look.lookAt(zero, f.v, up); q.setFromRotationMatrix(look);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(up, Math.PI));
        m.compose(f.p, q, sc.setScalar(s.sc));
        this.fish.setMatrixAt(s.start + k, m);
      }
    }
    this.fish.instanceMatrix.needsUpdate = true;
    // manta rays glide in big circles
    this.rays.forEach((r, i) => {
      r.a += r.sp * dt;
      const x = r.c.x + Math.cos(r.a) * r.r, z = r.c.z + Math.sin(r.a) * r.r;
      const y = Math.max(r.y, seabedHeight(x, z) + 2) + Math.sin(t * 0.4 + i) * 0.8;
      const heading = Math.atan2(-Math.sin(r.a), Math.cos(r.a));
      q.setFromAxisAngle(up, heading + Math.PI);
      m.compose(tmp.set(x, y, z), q, sc.setScalar(r.s));
      this.rayMesh.setMatrixAt(i, m);
    });
    this.rayMesh.instanceMatrix.needsUpdate = true;
    this.jellies.forEach((j, i) => {
      j.p.y += Math.max(0, Math.sin(t * 2.2 + i * 2)) * dt * 0.25 - dt * 0.08;
      const fl = seabedHeight(j.p.x, j.p.z);
      if (j.p.y < fl + 3) j.p.y = fl + 3;
      if (j.p.y > WATER_LEVEL - 1.5) j.p.y = WATER_LEVEL - 1.5;
      j.p.x += Math.sin(t * 0.1 + i) * dt * 0.2;
      q.identity();
      m.compose(j.p, q, sc.setScalar(j.s));
      this.jellyMesh.setMatrixAt(i, m);
    });
    this.jellyMesh.instanceMatrix.needsUpdate = true;
    this.goldMat.emissiveIntensity = 0.5 + Math.sin(t * 3) * 0.3;
  }

  nearestTreasure(p, maxD = 3) {
    let best = null, bd = maxD;
    for (const t of this.treasures) {
      if (t.found) continue;
      const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  collect(t) {
    t.found = true;
    this.scene.remove(t.group);
    this.found++;
    return t.value;
  }
}
