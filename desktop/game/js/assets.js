// Real art: rigged human models with motion-captured animation, a detailed car model, HDR skies
// and surface textures. Everything falls back to the procedural placeholders if a file is missing.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { clamp, damp } from './util.js';

const gltf = new GLTFLoader();
const load = (url) => gltf.loadAsync(url).catch((e) => { console.warn('asset failed', url, e); return null; });

const strip = (n) => n.replace(/^mixamorig:?/, '');
/** Put a skeleton in its T-pose (if the file has one) so every rig shares the same reference pose. */
function applyTPose(g) {
  const clip = g?.animations.find((c) => c.name.toLowerCase() === 'tpose');
  if (!clip) return;
  const mixer = new THREE.AnimationMixer(g.scene);
  const act = mixer.clipAction(clip); act.play(); mixer.setTime(0);
  const snap = [];
  g.scene.traverse((o) => { if (o.isBone) snap.push([o, o.position.clone(), o.quaternion.clone()]); });
  act.stop(); mixer.uncacheRoot(g.scene);
  for (const [o, p, q] of snap) { o.position.copy(p); o.quaternion.copy(q); }
  g.scene.updateMatrixWorld(true);
}
const restCache = new WeakMap();
/** Snapshot (once) and restore a skeleton's rest pose. */
function restPose(scene) {
  if (!restCache.has(scene)) {
    const snap = [];
    scene.traverse((o) => { if (o.isBone) snap.push([o, o.position.clone(), o.quaternion.clone()]); });
    restCache.set(scene, snap);
  }
  for (const [o, p, q] of restCache.get(scene)) { o.position.copy(p); o.quaternion.copy(q); }
  scene.updateMatrixWorld(true);
}

/**
 * World-space retargeting: play the clip on the source skeleton, and for every bone apply the same
 * rotation *relative to its rest pose* to the target skeleton. Works across rigs whose bone axes
 * differ (Mixamo vs Ready Player Me), unlike copying local rotations.
 */
function bakeRetarget(src, clip, tgt, { hips = true, fps = 30 } = {}) {
  restPose(src); restPose(tgt);
  const sb = {}, tb = {};
  src.traverse((o) => { if (o.isBone) sb[strip(o.name)] = o; });
  const order = [];
  tgt.traverse((o) => { if (o.isBone) { tb[strip(o.name)] = o; if (sb[strip(o.name)]) order.push(o); } });
  const Q = THREE.Quaternion, V = THREE.Vector3;
  const restS = {}, restT = {}, parentRest = {};
  for (const b of order) {
    const n = strip(b.name);
    restS[n] = sb[n].getWorldQuaternion(new Q());
    restT[n] = b.getWorldQuaternion(new Q());
    parentRest[n] = b.parent.getWorldQuaternion(new Q());
  }
  const sh = sb.Hips, th = tb.Hips;
  const sh0 = sh.getWorldPosition(new V()), th0 = th.getWorldPosition(new V());
  const ratio = th0.y / Math.max(1e-4, sh0.y);
  const mixer = new THREE.AnimationMixer(src);
  const action = mixer.clipAction(clip); action.play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const qv = {}; for (const b of order) qv[b.name] = new Float32Array(frames * 4);
  const pv = new Float32Array(frames * 3);
  const world = {}, tmp = new Q(), inv = new Q(), wp = new V();
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / fps);
    times[f] = t;
    mixer.setTime(t); src.updateMatrixWorld(true);
    for (const b of order) {
      const n = strip(b.name);
      const qs = sb[n].getWorldQuaternion(tmp);
      const w = qs.clone().multiply(inv.copy(restS[n]).invert()).multiply(restT[n]);
      world[b.name] = w;
      const pw = world[b.parent.name] || parentRest[n];
      const local = inv.copy(pw).invert().multiply(w);
      local.toArray(qv[b.name], f * 4);
    }
    sh.getWorldPosition(wp).sub(sh0).multiplyScalar(ratio).add(th0);
    th.parent.worldToLocal(wp).toArray(pv, f * 3);
  }
  action.stop(); mixer.uncacheRoot(src); restPose(src);
  const tracks = order.map((b) => new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, qv[b.name]));
  if (hips) tracks.push(new THREE.VectorKeyframeTrack(th.name + '.position', times, pv));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
function findBone(root, re) { let b = null; root.traverse((o) => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; }

export async function loadAssets(renderer, onProgress = () => {}) {
  const A = { people: null, car: null, env: null, textures: {} };
  onProgress('Loading people…');
  const [man, woman, loco, gest] = await Promise.all(['man', 'woman', 'anim_locomotion', 'anim_gestures'].map((n) => load(`./assets/people/${n}.glb`)));
  if (man && woman && loco) {
    for (const g of [man, woman, loco, gest]) applyTPose(g);
    const clipsFor = (tpl, height) => {
      tpl.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(tpl.scene);
      const scale = height / Math.max(0.1, box.max.y - box.min.y);
      const get = (src, name) => src?.animations.find((a) => a.name.toLowerCase() === name);
      const clips = {
        idle: get(gest, 'idle') ? bakeRetarget(gest.scene, get(gest, 'idle'), tpl.scene) : bakeRetarget(loco.scene, get(loco, 'idle'), tpl.scene),
        walk: get(gest, 'walk') ? bakeRetarget(gest.scene, get(gest, 'walk'), tpl.scene) : bakeRetarget(loco.scene, get(loco, 'walk'), tpl.scene),
        run: get(gest, 'run') ? bakeRetarget(gest.scene, get(gest, 'run'), tpl.scene) : bakeRetarget(loco.scene, get(loco, 'run'), tpl.scene),
      };
      if (gest) for (const g of ['agree', 'headshake']) {
        const c = get(gest, g);
        if (c) { const r = bakeRetarget(gest.scene, c, tpl.scene, { hips: false }); THREE.AnimationUtils.makeClipAdditive(r); clips[g] = r; }
      }
      restPose(tpl.scene);
      return { scene: tpl.scene, scale, clips };
    };
    A.people = { man: clipsFor(man, 1.78), woman: clipsFor(woman, 1.66) };
  }
  onProgress('Loading vehicles…');
  const car = await load('./assets/cars/coupe.glb');
  if (car) A.car = prepareCar(car.scene);
  onProgress('Loading sky lighting…');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const exr = new EXRLoader();
  A.env = {};
  for (const n of ['city', 'sunset', 'night']) {
    try { const t = await exr.loadAsync(`./assets/hdri/${n}.exr`); t.mapping = THREE.EquirectangularReflectionMapping; A.env[n] = pmrem.fromEquirectangular(t).texture; t.dispose(); }
    catch (e) { console.warn('hdri failed', n, e); }
  }
  const tl = new THREE.TextureLoader();
  for (const n of ['grasslight-big', 'brick_diffuse']) {
    try { const t = await tl.loadAsync(`./assets/textures/${n}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; A.textures[n] = t; }
    catch (e) { console.warn('texture failed', n); }
  }
  return A;
}

/* ───────────────────────── people ───────────────────────── */
const tintCache = new Map();
function tinted(mat, hex, k) {
  const key = mat.uuid + hex + k;
  if (!tintCache.has(key)) { const m = mat.clone(); m.color = new THREE.Color(hex).lerp(new THREE.Color(1, 1, 1), k); tintCache.set(key, m); }
  return tintCache.get(key);
}

/** A rigged, motion-captured human. Same interface as the procedural Humanoid. */
export class Person {
  constructor(lib, look) {
    const tpl = look.female ? lib.woman : lib.man;
    this.isPerson = true; this.t = Math.random() * 10; this.cur = {};
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const model = SkeletonUtils.clone(tpl.scene);
    model.scale.multiplyScalar(tpl.scale * (look.height || 1));
    this.body.add(model);
    const skinTone = look.skin || '#e0ac85';
    const hideHat = Math.random() < 0.6;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      const n = o.material.name || '';
      // per-person clothing, skin and hair so a crowd isn't a set of clones
      if (/Outfit_Top/.test(n)) o.material = tinted(o.material, look.shirt || '#ffffff', 0.25);
      else if (/Outfit_Bottom/.test(n)) o.material = tinted(o.material, look.pants || '#ffffff', 0.25);
      else if (/Footwear/.test(n)) o.material = tinted(o.material, look.shoes || '#ffffff', 0.35);
      else if (/Hair|Beard/.test(n)) o.material = tinted(o.material, look.hair || '#3b2616', 0.1);
      else if (/Headwear/.test(n)) o.visible = !hideHat;
      else if (/Skin|Body/.test(n) && !look.female) o.material = tinted(o.material, skinTone, 0.45);
      else if (look.female && /Ch03/.test(n)) o.material = tinted(o.material, look.shirt || '#ffffff', 0.72);
    });
    this.head = findBone(model, /Head$/);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const k of ['idle', 'walk', 'run']) {
      const a = this.mixer.clipAction(tpl.clips[k]);
      a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0);
      a.time = Math.random() * tpl.clips[k].duration;
      this.actions[k] = a;
    }
    for (const k of ['agree', 'headshake']) {
      if (!tpl.clips[k]) continue;
      const a = this.mixer.clipAction(tpl.clips[k], undefined, THREE.AdditiveAnimationBlendMode);
      a.play(); a.setEffectiveWeight(0);
      this.actions[k] = a;
    }
    this.w = { idle: 1, walk: 0, run: 0, agree: 0, headshake: 0 };
    this.pitch = 0;
  }
  setVisible(v) { this.root.visible = v; }
  update(dt, s) {
    this.t += dt;
    const sp = s.speed || 0, mode = s.mode;
    const tgt = { idle: 1, walk: 0, run: 0, agree: 0, headshake: 0 };
    let pitch = 0, lift = 0;
    if (mode === 'walk' || mode === 'air' || (mode === 'swim' && sp > 0.3)) {
      const r = clamp((sp - 2.3) / 2.2, 0, 1);
      tgt.idle = 0; tgt.walk = 1 - r; tgt.run = r;
      this.actions.walk.timeScale = clamp(sp / 1.45, 0.6, 1.7);
      this.actions.run.timeScale = clamp(sp / 5.0, 0.7, 1.5);
    }
    if (mode === 'swim') { pitch = s.under ? 1.35 : 1.25; lift = -0.2; this.actions.walk.timeScale = 0.55; }
    if (mode === 'down') { pitch = -1.52; lift = 0.12; }
    if (mode === 'cower') { tgt.headshake = 0.6; }
    if (s.gesture === 'talk' || s.gesture === 'point' || s.gesture === 'wave') tgt.agree = 0.8;
    if (s.gesture === 'angry' || s.gesture === 'shrug') tgt.headshake = 1;
    for (const k in tgt) {
      if (!this.actions[k]) continue;
      this.w[k] = damp(this.w[k], tgt[k], 8, dt);
      this.actions[k].setEffectiveWeight(this.w[k]);
    }
    this.pitch = damp(this.pitch, pitch, mode === 'down' ? 6 : 4, dt);
    this.body.rotation.x = this.pitch;
    this.body.position.y = damp(this.body.position.y, lift, 6, dt);
    this.mixer.update(dt);
    // eyes/head follow what they're looking at
    if (this.head && s.lookYaw !== undefined && mode !== 'down') this.head.rotation.y += clamp(s.lookYaw, -1, 1) * 0.8;
  }
}

/* ───────────────────────── car ───────────────────────── */
function prepareCar(scene) {
  // the model is already Y-up; make sure the headlights point along +Z (our forward)
  const holder = new THREE.Group();
  holder.add(scene);
  holder.updateMatrixWorld(true);
  const head = scene.getObjectByName('BodyHeadlights');
  if (head) {
    const c = new THREE.Box3().setFromObject(head).getCenter(new THREE.Vector3());
    if (c.z < 0) holder.rotation.y = Math.PI;
  }
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  return { holder, box };
}

/** Swap a Vehicle's procedural body for the detailed model, keeping lights, wheels and physics working. */
export function applyCarModel(v, tpl) {
  const model = tpl.holder.clone(true);
  const size = tpl.box.getSize(new THREE.Vector3());
  const k = v.spec.len / size.z;
  model.scale.setScalar(k);
  model.position.y = -tpl.box.min.y * k;
  model.updateMatrixWorld(true);
  // hide the placeholder body (physics, damage logic and light state stay the same)
  for (const c of v.bodyGroup.children) c.visible = false;
  for (const w of v.wheels) w.pivot.visible = false;
  v.bodyGroup.add(model);
  const L = v.lights;
  const lightMat = (m, color) => { const c = m.clone(); c.emissive = new THREE.Color(color); c.emissiveIntensity = 0; return c; };
  const paint = new THREE.Color(v.paintHex);
  const mats = {};
  const wheelMeshes = { FL: [], FR: [], RL: [], RR: [] };
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const n = o.material.name || '';
    if (/^Paint/.test(n)) { mats[n] = mats[n] || o.material.clone(); mats[n].color.copy(paint); o.material = mats[n]; }
    else if (n === 'Headlight') { mats.head = mats.head || lightMat(o.material, 0xfff4e0); o.material = mats.head; }
    else if (n === 'Brakelight') { mats.tail = mats.tail || lightMat(o.material, 0xff1408); o.material = mats.tail; }
    else if (n === 'Signallight') {
      const p = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      v.model.worldToLocal(p);
      const side = p.x > 0 ? 'indL' : 'indR';
      mats[side] = mats[side] || lightMat(o.material, 0xff8c10); o.material = mats[side];
    }
    const wm = o.name.match(/^Wheel(Front|Rear)(L|R)/) || o.parent?.name.match(/^Wheel(Front|Rear)(L|R)/);
    if (wm) wheelMeshes[(wm[1] === 'Front' ? 'F' : 'R') + wm[2]].push(o);
  });
  if (mats.head) L.head = mats.head;
  if (mats.tail) L.tail = mats.tail;
  if (mats.indL) L.indL = mats.indL;
  if (mats.indR) L.indR = mats.indR;
  // wheels: give each a pivot at its centre so it can spin and steer
  const newWheels = [];
  for (const key of ['FL', 'FR', 'RL', 'RR']) {
    const list = wheelMeshes[key];
    if (!list.length) continue;
    const bb = new THREE.Box3(); for (const m of list) bb.expandByObject(m);
    const centre = bb.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group(); const spin = new THREE.Group();
    v.model.worldToLocal(pivot.position.copy(centre));
    pivot.add(spin); v.model.add(pivot);
    pivot.updateMatrixWorld(true);
    for (const m of list) spin.attach(m);
    newWheels.push({ pivot, spin, front: key[0] === 'F' });
  }
  if (newWheels.length === 4) { v.wheels = newWheels; v.wheelAxis = 'x'; }
  v.detailed = true;
}
