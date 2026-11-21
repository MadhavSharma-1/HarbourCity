import * as THREE from 'three';
import { damp, clamp } from './util.js';

/*
  Procedurally animated human. Every frame we compute a target pose (joint angles) for the
  current activity, then each joint eases toward it. Easing makes all transitions — walk → run,
  standing → swimming, falling down → getting up — blend smoothly with no keyframed clips.
*/

let G = null;
function geos() {
  if (G) return G;
  const cap = (r, l, y) => { const g = new THREE.CapsuleGeometry(r, l, 4, 10); g.translate(0, y, 0); return g; };
  G = {
    pelvis: cap(0.15, 0.1, 0),
    torso: cap(0.165, 0.24, 0.22),
    neck: new THREE.CylinderGeometry(0.045, 0.052, 0.12, 8).translate(0, 0.05, 0),
    head: new THREE.SphereGeometry(0.108, 18, 14).scale(0.92, 1.08, 1).translate(0, 0.11, 0.0),
    nose: new THREE.ConeGeometry(0.018, 0.045, 6).rotateX(Math.PI / 2).translate(0, 0.1, 0.105),
    hair: new THREE.SphereGeometry(0.114, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.95, 1.05, 1.05).translate(0, 0.125, -0.008),
    longHair: cap(0.1, 0.14, 0.02).scale(1.05, 1, 0.6).translate(0, 0, -0.06),
    upperArm: cap(0.05, 0.2, -0.14),
    foreArm: cap(0.042, 0.19, -0.13),
    hand: new THREE.SphereGeometry(0.045, 8, 6).scale(0.75, 1.25, 0.5).translate(0, -0.05, 0),
    thigh: cap(0.078, 0.3, -0.225),
    shin: cap(0.06, 0.32, -0.22),
    foot: new THREE.BoxGeometry(0.095, 0.075, 0.25).translate(0, -0.04, 0.055),
  };
  return G;
}

const matCache = new Map();
function mat(hex, rough = 0.8) {
  const k = hex + ':' + rough;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough }));
  return matCache.get(k);
}
const faceCache = new Map();
function faceMat(skin) {
  if (faceCache.has(skin)) return faceCache.get(skin);
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = skin; g.fillRect(0, 0, 256, 128);
  const ex = [0.205, 0.295].map((u) => u * 256), ey = 0.46 * 128;
  for (const x of ex) {
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.ellipse(x, ey, 7, 4.5, 0, 0, 7); g.fill();
    g.fillStyle = '#3b2a1e'; g.beginPath(); g.arc(x, ey, 3.2, 0, 7); g.fill();
    g.fillStyle = '#000'; g.beginPath(); g.arc(x, ey, 1.4, 0, 7); g.fill();
    g.strokeStyle = 'rgba(40,25,15,.8)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x - 8, ey - 8); g.quadraticCurveTo(x, ey - 11, x + 8, ey - 8); g.stroke();
  }
  g.strokeStyle = 'rgba(120,50,45,.75)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0.225 * 256, 0.66 * 128); g.quadraticCurveTo(0.25 * 256, 0.69 * 128, 0.275 * 256, 0.66 * 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.65 });
  faceCache.set(skin, m);
  return m;
}

export const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#a26a47', '#7a4b31', '#5a3824', '#f5d7bd'];
export const HAIR = ['#1c140f', '#3b2616', '#6a4325', '#a5753f', '#d9b779', '#7a7a7a', '#b8452b', '#0d0d0d'];
export const SHIRTS = ['#2f5d8c', '#b03a2e', '#f0f0f0', '#222222', '#3f7d4f', '#e3b23c', '#7a4e8c', '#d96c3b', '#5f7f99', '#c9c1b1', '#1e3d59', '#8c2f39', '#46a0a0', '#ff8fab'];
export const PANTS = ['#1f2a44', '#2b2b2b', '#4a4a4a', '#6b5a43', '#3a4f6b', '#c8b998', '#22313f', '#5b3a29'];
export const SHOES = ['#111111', '#f2f2f2', '#5b3a29', '#2c3e50', '#8b0000'];

export class Humanoid {
  constructor(look = {}) {
    const g = geos();
    const skin = look.skin || SKIN[0];
    const shirt = mat(look.shirt || SHIRTS[0]);
    const pants = mat(look.pants || PANTS[0]);
    const skinM = mat(skin, 0.6);
    const shoes = mat(look.shoes || SHOES[0], 0.5);
    const hairM = mat(look.hair || HAIR[0], 0.9);
    const sleeve = look.longSleeve ? shirt : skinM;
    this.root = new THREE.Group();
    const J = (this.j = {});
    const add = (parent, name, x, y, z, geo, m) => {
      const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); J[name] = o;
      if (geo) { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; o.add(mesh); o.userData.mesh = mesh; }
      return o;
    };
    const body = add(this.root, 'body', 0, 0.95, 0);       // pivot at hips: tilts whole body (swimming, lying)
    const hips = add(body, 'hips', 0, 0, 0, g.pelvis, pants);
    const spine = add(hips, 'spine', 0, 0.07, 0, g.torso, shirt);
    spine.userData.mesh.scale.set(look.female ? 1.0 : 1.12, 1, 0.68);
    hips.userData.mesh.scale.set(look.female ? 1.08 : 1.0, 1, 0.75);
    const neck = add(spine, 'neck', 0, 0.48, 0, g.neck, skinM);
    const head = add(neck, 'head', 0, 0.08, 0, g.head, faceMat(skin));
    const nose = new THREE.Mesh(g.nose, skinM); head.add(nose);
    if (!look.bald) { const h = new THREE.Mesh(g.hair, hairM); head.add(h); }
    if (look.longHair) { const h = new THREE.Mesh(g.longHair, hairM); h.position.set(0, 0.06, 0); head.add(h); }
    const sw = look.female ? 0.18 : 0.205;
    for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
      const sh = add(spine, 'shoulder' + side, s * sw, 0.42, 0, null);
      add(sh, 'upperArm' + side, 0, 0, 0, g.upperArm, shirt);
      add(J['upperArm' + side], 'foreArm' + side, 0, -0.3, 0, g.foreArm, sleeve);
      add(J['foreArm' + side], 'hand' + side, 0, -0.27, 0, g.hand, skinM);
      add(hips, 'thigh' + side, s * 0.095, -0.03, 0, g.thigh, pants);
      add(J['thigh' + side], 'shin' + side, 0, -0.45, 0, g.shin, pants);
      add(J['shin' + side], 'foot' + side, 0, -0.43, 0, g.foot, shoes);
    }
    const sc = look.height || 1;
    this.root.scale.setScalar(sc);
    this.phase = Math.random() * 10;
    this.t = Math.random() * 100;
    this.cur = {};          // current eased angles
    this.target = {};
    this.hipY = 0;
    this.bodyPitch = 0;
    this.lod = 0;
  }

  setVisible(v) { this.root.visible = v; }

  /** s: { mode, speed, gesture, lookYaw, lookPitch, under } */
  update(dt, s) {
    this.t += dt;
    const T = this.target;
    for (const k in T) T[k] = 0;
    const set = (name, x = 0, y = 0, z = 0) => { T[name + 'x'] = x; T[name + 'y'] = y; T[name + 'z'] = z; };
    let hipY = 0, pitch = 0, roll = 0, rate = 12;
    const t = this.t;
    const speed = s.speed || 0;

    if (s.mode === 'walk') {
      const run = clamp((speed - 2.2) / 4, 0, 1);
      const stepLen = 0.62 + 0.55 * run;
      this.phase += (speed / stepLen) * Math.PI * 0.5 * dt * 2;
      const p = this.phase;
      const A = clamp(speed / 2.5, 0.25, 0.75) + run * 0.25;
      const sinp = Math.sin(p), cosp = Math.cos(p);
      for (const [side, sg] of [['L', 1], ['R', -1]]) {
        const ph = sg * sinp, pc = sg * cosp;
        set('thigh' + side, -ph * A - run * 0.15, 0, 0);
        set('shin' + side, Math.max(0, pc) * (0.6 + run * 1.1) + 0.08 + run * 0.15, 0, 0);
        set('foot' + side, ph * A * 0.4 - Math.max(0, pc) * 0.3, 0, 0);
        set('upperArm' + side, ph * A * (0.7 + run * 0.3), 0, sg * (0.08 + run * 0.06));
        set('foreArm' + side, -0.25 - run * 1.1 - Math.max(0, -ph) * 0.25, 0, 0);
      }
      set('spine', 0.04 + run * 0.18, sinp * (0.07 + run * 0.08), 0);
      set('head', -0.03 - run * 0.1, -sinp * 0.05, 0);
      hipY = -Math.abs(Math.sin(p)) * (0.025 + run * 0.035) + (1 - Math.abs(Math.sin(p))) * 0.01 - run * 0.03;
      roll = Math.sin(p) * 0.025;
    } else if (s.mode === 'idle') {
      const br = Math.sin(t * 1.7) * 0.025;
      const shift = Math.sin(t * 0.35) * 0.05;
      set('spine', br * 0.5, 0, shift * 0.3);
      set('upperArmL', 0.03, 0, 0.09 + br * 0.2); set('upperArmR', 0.03, 0, -0.09 - br * 0.2);
      set('foreArmL', -0.15); set('foreArmR', -0.15);
      set('thighL', 0, 0, 0.03 + shift * 0.4); set('thighR', 0, 0, -0.03 + shift * 0.4);
      set('shinL', 0.03 + Math.max(0, shift) * 0.4); set('shinR', 0.03 + Math.max(0, -shift) * 0.4);
      set('head', Math.sin(t * 0.5) * 0.04, Math.sin(t * 0.23) * 0.3, 0);
      roll = -shift * 0.2;
      rate = 5;
    } else if (s.mode === 'swim') {
      rate = 7;
      const moving = speed > 0.3;
      if (s.under || moving) {
        this.phase += dt * (moving ? 1.5 + speed * 0.6 : 0.8);
        const p = this.phase;
        pitch = s.under ? 1.35 + (s.lookPitch || 0) : 1.25;
        if (s.under && !moving) pitch = 0.4;
        // breast-stroke underwater, front crawl on the surface
        if (s.under) {
          const k = (Math.sin(p) + 1) / 2;
          set('upperArmL', -2.7 + k * 1.4, 0, 0.3 + k * 0.9); set('upperArmR', -2.7 + k * 1.4, 0, -0.3 - k * 0.9);
          set('foreArmL', -0.6 * (1 - k)); set('foreArmR', -0.6 * (1 - k));
          set('thighL', Math.sin(p + 1) * 0.35, 0, 0.15); set('thighR', Math.sin(p + 1) * 0.35, 0, -0.15);
          set('shinL', 0.4 + Math.cos(p) * 0.4); set('shinR', 0.4 + Math.cos(p) * 0.4);
        } else {
          T.upperArmLx = -((p * 1.0) % (Math.PI * 2)); T.upperArmRx = -((p * 1.0 + Math.PI) % (Math.PI * 2));
          set('thighL', Math.sin(p * 3) * 0.3); set('thighR', -Math.sin(p * 3) * 0.3);
          set('shinL', 0.2); set('shinR', 0.2);
        }
        set('head', -0.9, 0, 0);
        set('footL', 0.7); set('footR', 0.7);
      } else {
        // treading water
        this.phase += dt * 2.4;
        const p = this.phase;
        set('upperArmL', -0.3, 0, 0.9 + Math.sin(p) * 0.3); set('upperArmR', -0.3, 0, -0.9 - Math.sin(p) * 0.3);
        set('foreArmL', -0.8); set('foreArmR', -0.8);
        set('thighL', -0.4 + Math.sin(p) * 0.4); set('thighR', -0.4 - Math.sin(p) * 0.4);
        set('shinL', 0.8 + Math.cos(p) * 0.3); set('shinR', 0.8 - Math.cos(p) * 0.3);
        pitch = 0.15;
      }
    } else if (s.mode === 'sit') {
      set('thighL', -1.45, 0, 0.06); set('thighR', -1.45, 0, -0.06);
      set('shinL', 1.35); set('shinR', 1.35);
      set('upperArmL', -0.95, 0, 0.15); set('upperArmR', -0.95, 0, -0.15);
      set('foreArmL', -0.55); set('foreArmR', -0.55);
      set('spine', -0.12);
      set('head', 0, (s.steer || 0) * 0.3, 0);
      hipY = -0.42;
      rate = 20;
    } else if (s.mode === 'down') {
      // lying on the back, limbs loose
      pitch = -1.5; hipY = -0.8;
      set('upperArmL', -0.4, 0, 1.0); set('upperArmR', -0.2, 0, -1.2);
      set('foreArmL', -0.4); set('foreArmR', -0.7);
      set('thighL', -0.2, 0, 0.2); set('thighR', 0.1, 0, -0.15);
      set('shinL', 0.5); set('shinR', 0.2);
      set('head', 0.2, 0.4, 0);
      rate = 9;
    } else if (s.mode === 'cower') {
      hipY = -0.42;
      set('thighL', -1.7, 0, 0.15); set('thighR', -1.7, 0, -0.15);
      set('shinL', 2.2); set('shinR', 2.2);
      set('footL', -0.4); set('footR', -0.4);
      set('spine', 0.75);
      set('upperArmL', -2.4, 0, 0.6); set('upperArmR', -2.4, 0, -0.6);
      set('foreArmL', -1.9); set('foreArmR', -1.9);
      set('head', 0.4, Math.sin(t * 9) * 0.06, 0);
      rate = 10;
    } else if (s.mode === 'air') {
      set('thighL', -0.6); set('thighR', 0.15); set('shinL', 0.9); set('shinR', 0.4);
      set('upperArmL', -0.3, 0, 0.5); set('upperArmR', 0.3, 0, -0.5);
      set('foreArmL', -0.6); set('foreArmR', -0.6);
      rate = 10;
    }

    // upper-body gestures layered on top of idle
    if (s.gesture && (s.mode === 'idle' || s.mode === 'walk')) {
      const gk = s.gesture;
      if (gk === 'talk') {
        const a = Math.sin(t * 3.1) * 0.5 + 0.5, b = Math.sin(t * 2.3 + 1.3) * 0.5 + 0.5;
        set('upperArmR', -0.35 - a * 0.4, 0.2, -0.25); set('foreArmR', -1.2 - b * 0.4);
        if (Math.sin(t * 0.7) > 0) { set('upperArmL', -0.3 - b * 0.3, -0.2, 0.25); set('foreArmL', -1.1 - a * 0.3); }
        T.headx = Math.sin(t * 2.2) * 0.07;
      } else if (gk === 'phone') {
        set('upperArmR', -0.5, 0, -0.35); set('foreArmR', -1.75, 0, 0);
        set('upperArmL', -0.25, 0, 0.3); set('foreArmL', -1.45);
        T.headx = 0.42;
      } else if (gk === 'call') {
        set('upperArmR', -0.2, 0, -1.25); set('foreArmR', -2.3, 0, 0);
      } else if (gk === 'angry') {
        set('upperArmR', -2.5 + Math.sin(t * 14) * 0.25, 0, -0.3); set('foreArmR', -0.9 + Math.sin(t * 14) * 0.3);
        set('upperArmL', -0.2, 0, 0.35); set('foreArmL', -1.6);
        T.spinex = -0.08; T.headx = -0.08;
      } else if (gk === 'wave') {
        set('upperArmR', -0.3, 0, -2.6); set('foreArmR', 0, 0, Math.sin(t * 10) * 0.6);
      } else if (gk === 'shrug') {
        const k = Math.max(0, Math.sin(t * 2.5));
        set('upperArmL', -0.3, 0, 0.4 + k * 0.3); set('upperArmR', -0.3, 0, -0.4 - k * 0.3);
        set('foreArmL', -1.4, 0.6); set('foreArmR', -1.4, -0.6);
      } else if (gk === 'point') {
        set('upperArmR', -1.55, 0.25, -0.1); set('foreArmR', -0.05);
      }
    }
    if (s.lookYaw !== undefined && s.mode !== 'down' && s.mode !== 'swim') {
      T.heady = clamp(s.lookYaw, -1.1, 1.1);
      if (s.lookPitch !== undefined) T.headx = clamp(-s.lookPitch, -0.5, 0.5);
    }

    // ease toward target
    const C = this.cur, J = this.j;
    for (const k in T) {
      const c = C[k] ?? 0;
      C[k] = damp(c, T[k], rate, dt);
    }
    for (const name in J) {
      if (C[name + 'x'] === undefined) continue;
      J[name].rotation.set(C[name + 'x'], C[name + 'y'], C[name + 'z']);
    }
    this.hipY = damp(this.hipY, hipY, rate, dt);
    this.bodyPitch = damp(this.bodyPitch, pitch, s.mode === 'down' ? 6 : rate * 0.6, dt);
    this.bodyRoll = damp(this.bodyRoll || 0, roll, rate, dt);
    J.body.position.y = 0.95 + this.hipY;
    J.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);
  }
}
