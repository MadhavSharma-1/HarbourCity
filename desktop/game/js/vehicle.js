import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp } from './util.js';
import { groundHeight, WATER_LEVEL } from './world.js';
import { applyCarModel } from './assets.js';

export const SPECS = {
  sedan: { name: 'Sedan', len: 4.75, wid: 1.86, hgt: 1.45, cab: 2.55, cabOff: -0.15, taper: 0.6, r: 0.34, mass: 1500, power: 140000 },
  hatch: { name: 'Hatchback', len: 4.1, wid: 1.78, hgt: 1.5, cab: 2.35, cabOff: -0.42, taper: 0.66, r: 0.32, mass: 1200, power: 95000 },
  suv: { name: 'SUV', len: 4.9, wid: 1.98, hgt: 1.82, cab: 2.95, cabOff: -0.38, taper: 0.78, r: 0.4, mass: 2100, power: 200000 },
  sports: { name: 'Sports coupe', len: 4.5, wid: 1.95, hgt: 1.22, cab: 2.0, cabOff: -0.25, taper: 0.5, r: 0.35, mass: 1400, power: 330000, grip: 9.5 },
  van: { name: 'Delivery van', len: 5.3, wid: 2.02, hgt: 2.3, cab: 4.2, cabOff: -0.5, taper: 0.9, r: 0.36, mass: 2500, power: 135000 },
  police: { name: 'Police cruiser', len: 4.9, wid: 1.9, hgt: 1.5, cab: 2.6, cabOff: -0.15, taper: 0.62, r: 0.35, mass: 1700, power: 260000, grip: 9 },
  ambulance: { name: 'Ambulance', len: 5.6, wid: 2.1, hgt: 2.5, cab: 4.4, cabOff: -0.45, taper: 0.92, r: 0.38, mass: 2900, power: 190000 },
  taxi: { name: 'Taxi', len: 4.75, wid: 1.86, hgt: 1.45, cab: 2.55, cabOff: -0.15, taper: 0.6, r: 0.34, mass: 1500, power: 150000 },
};
export const PAINTS = ['#b8b8bc', '#1d1f22', '#f2f2f0', '#8c1c13', '#1f3f73', '#2f4f3f', '#6d6f73', '#c9a227', '#5a2d82', '#d9541e', '#0f5e75', '#7a6a58', '#a3a7ab'];

const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.6, metalness: 0.2 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.82, envMapIntensity: 1.3 });
const crackedGlass = new THREE.MeshStandardMaterial({ color: 0x3a4248, roughness: 0.6, metalness: 0.3, transparent: true, opacity: 0.9 });
let wheelGeoCache = new Map();

function colorize(geo, r, g, b) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, g, b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
function wheelGeo(r) {
  if (wheelGeoCache.has(r)) return wheelGeoCache.get(r);
  const tire = colorize(new THREE.CylinderGeometry(r, r, 0.25, 20).rotateZ(Math.PI / 2), 0.035, 0.035, 0.038);
  const rim = colorize(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.262, 14).rotateZ(Math.PI / 2), 0.72, 0.73, 0.75);
  const hub = colorize(new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.28, 8).rotateZ(Math.PI / 2), 0.3, 0.3, 0.32);
  const spokes = [];
  for (let k = 0; k < 5; k++) spokes.push(colorize(new THREE.BoxGeometry(0.27, r * 1.1, 0.06).rotateX((k / 5) * Math.PI), 0.55, 0.56, 0.58));
  const g = mergeGeometries([tire, rim, hub, ...spokes]);
  wheelGeoCache.set(r, g);
  return g;
}

function buildCar(spec, paintHex, type) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const { len, wid, hgt, r } = spec;
  const clr = r * 0.78;
  const bh = type === 'van' ? hgt * 0.4 : hgt * (type === 'sports' ? 0.5 : 0.47);
  const ch = hgt - clr - bh;
  const paint = new THREE.MeshPhysicalMaterial({ color: paintHex, roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 });

  const bg = new THREE.BoxGeometry(wid, bh, len, 6, 3, 14);
  let p = bg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nz = z / (len / 2), ny = (y + bh / 2) / bh;
    x *= 1 - 0.1 * Math.pow(Math.abs(nz), 6);
    x *= 1 - 0.06 * (1 - ny) - 0.05 * Math.pow(ny, 4);
    if (nz > 0.42) y -= ny * ((nz - 0.42) / 0.58) * bh * (type === 'van' ? 0.12 : 0.3);
    if (nz < -0.62) y -= ny * ((-nz - 0.62) / 0.38) * bh * 0.14;
    if (Math.abs(nz) > 0.96) z *= 0.985 + 0.015 * (1 - ny);
    p.setXYZ(i, x, y, z);
  }
  bg.computeVertexNormals();
  const bodyMesh = new THREE.Mesh(bg, paint);
  bodyMesh.position.y = clr + bh / 2;
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  body.add(bodyMesh);

  const cg = new THREE.BoxGeometry(wid * 0.84, ch, spec.cab, 4, 2, 6);
  p = cg.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ny = (y + ch / 2) / ch;
    z = z * lerp(1, spec.taper, ny) - ny * 0.06;
    x *= lerp(1, 0.88, ny);
    p.setXYZ(i, x, y, z);
  }
  cg.computeVertexNormals();
  cg.clearGroups();
  const idx = cg.index.count;
  // BoxGeometry face order: +x,-x,+y,-y,+z,-z — sides & ends are glass, top/bottom painted
  const per = idx / 6;
  cg.addGroup(0, per * 2, 0); cg.addGroup(per * 2, per * 2, 1); cg.addGroup(per * 4, per * 2, 0);
  const cabin = new THREE.Mesh(cg, [glassMat, paint]);
  cabin.position.set(0, clr + bh + ch / 2 - 0.01, spec.cabOff);
  cabin.castShadow = true;
  body.add(cabin);

  // trim: bumpers, grille, mirrors, B-pillars, plates
  const trims = [
    new THREE.BoxGeometry(wid * 0.98, bh * 0.32, 0.18).translate(0, clr + bh * 0.2, len / 2 - 0.03),
    new THREE.BoxGeometry(wid * 0.98, bh * 0.32, 0.18).translate(0, clr + bh * 0.2, -len / 2 + 0.03),
    new THREE.BoxGeometry(wid * 0.5, bh * 0.22, 0.05).translate(0, clr + bh * 0.55, len / 2 - 0.005),
    new THREE.BoxGeometry(0.24, 0.12, 0.14).translate(wid / 2 + 0.05, clr + bh + 0.08, spec.cabOff + spec.cab / 2 - 0.25),
    new THREE.BoxGeometry(0.24, 0.12, 0.14).translate(-wid / 2 - 0.05, clr + bh + 0.08, spec.cabOff + spec.cab / 2 - 0.25),
    new THREE.BoxGeometry(wid * 0.82, ch * 0.9, 0.1).translate(0, clr + bh + ch * 0.45, spec.cabOff - 0.05).scale(1.0, 1, 1),
    new THREE.BoxGeometry(wid + 0.04, 0.05, len * 0.6).translate(0, clr + 0.04, 0),
  ];
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.02), new THREE.MeshStandardMaterial({ color: 0xf2f0e6, roughness: 0.5 }));
  plate.position.set(0, clr + bh * 0.42, -len / 2 - 0.07); body.add(plate);
  const trim = new THREE.Mesh(mergeGeometries(trims), trimMat);
  trim.castShadow = true; body.add(trim);

  // lights
  const L = {};
  const mk = (name, color, geos) => {
    const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0, roughness: 0.2 });
    const mesh = new THREE.Mesh(mergeGeometries(geos), m); body.add(mesh); L[name] = m; return mesh;
  };
  const fy = clr + bh * 0.72 - (type === 'van' ? 0 : bh * 0.1), fz = len / 2 - 0.02 - (type === 'van' ? 0 : 0.05);
  const hx = wid / 2 - 0.3;
  mk('head', new THREE.Color(1, 0.95, 0.85), [-1, 1].map((s) => new THREE.BoxGeometry(0.38, 0.12, 0.06).translate(s * hx, fy, fz)));
  const ry = clr + bh * 0.68, rz = -len / 2 + 0.01;
  mk('tail', new THREE.Color(1, 0.04, 0.02), [-1, 1].map((s) => new THREE.BoxGeometry(0.42, 0.14, 0.06).translate(s * (wid / 2 - 0.28), ry, rz)));
  mk('rev', new THREE.Color(1, 1, 1), [-1, 1].map((s) => new THREE.BoxGeometry(0.12, 0.1, 0.06).translate(s * (wid / 2 - 0.58), ry - 0.02, rz)));
  mk('indL', new THREE.Color(1, 0.55, 0.05), [new THREE.BoxGeometry(0.14, 0.1, 0.06).translate(wid / 2 - 0.1, fy - 0.06, fz - 0.03), new THREE.BoxGeometry(0.14, 0.1, 0.06).translate(wid / 2 - 0.08, ry + 0.12, rz)]);
  mk('indR', new THREE.Color(1, 0.55, 0.05), [new THREE.BoxGeometry(0.14, 0.1, 0.06).translate(-wid / 2 + 0.1, fy - 0.06, fz - 0.03), new THREE.BoxGeometry(0.14, 0.1, 0.06).translate(-wid / 2 + 0.08, ry + 0.12, rz)]);

  if (type === 'police' || type === 'ambulance') {
    const red = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: new THREE.Color(1, 0.05, 0.05), emissiveIntensity: 0 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x000033, emissive: new THREE.Color(0.1, 0.25, 1), emissiveIntensity: 0 });
    const barY = hgt + 0.08, barZ = type === 'police' ? spec.cabOff : spec.cabOff + spec.cab / 2 - 0.3;
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), red); r.position.set(0.28, barY, barZ); body.add(r);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), type === 'police' ? blue : red); b.position.set(-0.28, barY, barZ); body.add(b);
    L.barA = red; L.barB = b.material;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(wid + 0.02, 0.18, len * 0.8), new THREE.MeshStandardMaterial({ color: type === 'police' ? 0x0b1a3a : 0xc0201a, roughness: 0.5 }));
    stripe.position.set(0, clr + bh * 0.55, 0); body.add(stripe);
  }
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.28), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd34d, emissiveIntensity: 0.6 }));
    sign.position.set(0, hgt + 0.1, spec.cabOff); body.add(sign);
    L.taxi = sign.material;
  }

  // wheels
  const wheels = [];
  const wg = wheelGeo(r);
  const wx = wid / 2 - 0.16, wz = len / 2 - (type === 'van' ? 0.9 : 0.82);
  for (const [sx, sz, front] of [[1, 1, true], [-1, 1, true], [1, -1, false], [-1, -1, false]]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * wx, r, sz * wz);
    const spin = new THREE.Group(); pivot.add(spin);
    const w = new THREE.Mesh(wg, wheelMat); w.castShadow = true; spin.add(w);
    if (sx < 0) w.rotation.y = Math.PI;
    root.add(pivot);
    wheels.push({ pivot, spin, front });
  }
  // a simple driver silhouette visible through the glass (AI cars)
  const dg = mergeGeometries([new THREE.SphereGeometry(0.11, 10, 8).translate(0, 0.62, 0), new THREE.BoxGeometry(0.38, 0.5, 0.24).translate(0, 0.25, 0)]);
  const driver = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9 }));
  driver.position.set(0.38, clr + bh - 0.12, spec.cabOff + 0.15);
  body.add(driver);

  return { root, body, bodyMesh, cabin, lights: L, wheels, driver, paint, dims: { clr, bh, ch } };
}

export class Vehicle {
  constructor(game, type = 'sedan', paint) {
    this.game = game; this.type = type;
    this.spec = { grip: 7.5, ...SPECS[type] };
    this.paintHex = paint || PAINTS[Math.floor(Math.random() * PAINTS.length)];
    if (type === 'taxi') this.paintHex = '#f2c12e';
    if (type === 'police' || type === 'ambulance') this.paintHex = '#f2f2f0';
    const car = buildCar(this.spec, this.paintHex, type);
    Object.assign(this, { model: car.root, bodyGroup: car.body, bodyMesh: car.bodyMesh, cabin: car.cabin, lights: car.lights, wheels: car.wheels, driverMesh: car.driver, dims: car.dims });
    this.origBody = Float32Array.from(this.bodyMesh.geometry.attributes.position.array);
    this.origCabin = Float32Array.from(this.cabin.geometry.attributes.position.array);
    this.pos = new THREE.Vector3(); this.heading = 0; this.vel = new THREE.Vector2(); this.angVel = 0;
    this.steer = 0; this.throttle = 0; this.braking = false; this.reversing = false;
    this.fuelCap = type === 'van' ? 70 : type === 'suv' ? 60 : 45; this.fuel = this.fuelCap * (0.5 + Math.random() * 0.5);
    this.health = 100; this.engineOn = false; this.headlights = false; this.indicator = 0; this.hazard = false;
    this.rpm = 800; this.gear = 1; this.pitch = 0; this.roll = 0; this.wheelSpin = 0; this.prevVF = 0; this.slip = 0;
    this.frontBroken = false; this.rearBroken = false; this.glassBroken = false; this.sunk = false;
    this.smokeT = 0; this.blink = 0; this.lastHit = 0;
    this.radius = this.spec.wid / 2;
    this.driver = null;  // 'player' | 'ai' | null
    game.scene.add(this.model);
    this.model.updateMatrixWorld(true);
    if ((type === 'sports') && game.assets?.car) applyCarModel(this, game.assets.car);
  }

  place(x, z, h) { this.pos.set(x, groundHeight(x, z), z); this.heading = h; this.vel.set(0, 0); this.angVel = 0; this.syncModel(0); }
  get fwdX() { return Math.sin(this.heading); }
  get fwdZ() { return Math.cos(this.heading); }
  forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading); }
  speed() { return this.vel.length(); }
  canRun() { return this.engineOn && this.fuel > 0 && this.health > 0 && !this.sunk; }

  /** ctl: { fwd, back, steer, handbrake } (0..1, -1..1). null = no driver: rolls to a stop. */
  physics(dt, ctl) {
    const s = this.spec, m = s.mass;
    let sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    let vF = this.vel.x * sh + this.vel.y * ch;
    let vR = -this.vel.x * ch + this.vel.y * sh;
    ctl = ctl || { fwd: 0, back: 0, steer: 0, handbrake: true };
    let thr = 0, brake = 0;
    if (ctl.fwd > 0) { if (vF < -0.8) brake = ctl.fwd; else thr = ctl.fwd; }
    if (ctl.back > 0) { if (vF > 0.8) brake = ctl.back; else thr = -ctl.back; }
    const running = this.canRun();
    if (!running) thr = 0;
    // low fuel: engine sputters
    if (running && this.fuel < 1.5 && Math.random() < 0.08) thr *= 0.1;
    this.throttle = Math.abs(thr); this.braking = brake > 0.05; this.reversing = vF < -0.3 && thr < 0;
    const healthK = 0.35 + 0.65 * clamp(this.health / 60, 0, 1);
    let F = 0;
    if (thr > 0) F = Math.min(s.power / Math.max(Math.abs(vF), 3.5), m * 9.81 * 1.05) * thr * healthK;
    else if (thr < 0 && vF > -9) F = -Math.min((s.power * 0.35) / Math.max(Math.abs(vF), 3), m * 5) * -thr * healthK;
    const ground = groundHeight(this.pos.x, this.pos.z);
    const onSand = this.pos.z > 807 && ground > WATER_LEVEL - 0.5;
    F -= 0.42 * vF * Math.abs(vF) + (onSand ? 140 : 14) * vF;
    vF += (F / m) * dt;
    const bF = brake * 9.5 + (ctl.handbrake ? 3.5 : 0) + (running ? 0 : 0.6) + (onSand ? 1.5 : 0);
    const dv = bF * dt;
    vF = Math.abs(vF) <= dv && thr === 0 ? 0 : vF - Math.sign(vF) * Math.min(dv, Math.abs(vF));

    const maxSteer = 0.6 / (1 + Math.abs(vF) / 16);
    this.steer = damp(this.steer, (ctl.steer || 0) * maxSteer, 7, dt);
    const yawT = (vF * Math.tan(this.steer)) / (s.len * 0.6);
    this.angVel = damp(this.angVel, yawT, ctl.handbrake ? 2.2 : 9, dt);
    const wet = this.game.weather ? this.game.weather.rain : 0;
    const grip = (ctl.handbrake ? 1.3 : s.grip) * (onSand ? 0.55 : 1) * (1 - 0.35 * wet); // wet roads: less grip
    this.slip = Math.abs(vR);
    vR *= Math.exp(-grip * dt);
    this.heading += this.angVel * dt;
    sh = Math.sin(this.heading); ch = Math.cos(this.heading);
    this.vel.set(sh * vF - ch * vR, ch * vF + sh * vR);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.y * dt;

    // engine model: automatic 5-speed for RPM/sound
    const ratios = [3.5, 2.1, 1.45, 1.08, 0.84], fd = 3.6;
    let rpm = (Math.abs(vF) / s.r) * ratios[this.gear - 1] * fd * 9.549;
    if (rpm > 6100 && this.gear < 5) this.gear++;
    if (rpm < 2100 && this.gear > 1) this.gear--;
    rpm = (Math.abs(vF) / s.r) * ratios[this.gear - 1] * fd * 9.549;
    if (this.gear === 1) rpm = Math.max(rpm, 800 + this.throttle * 2600);
    this.rpm = running ? damp(this.rpm, clamp(Math.max(800, rpm), 800, 7200), 10, dt) : damp(this.rpm, 0, 4, dt);
    if (this.engineOn && !this.sunk) this.fuel = Math.max(0, this.fuel - (0.0012 + this.throttle * 0.03 * (0.4 + Math.abs(vF) / 35)) * dt);
    if (this.fuel <= 0 && this.engineOn) { this.engineOn = false; if (this.driver === 'player') this.game.notify('Out of fuel! Find a gas station (orange on the map) or push… er, walk.'); }

    this.accelF = (vF - this.prevVF) / Math.max(dt, 1e-3); this.prevVF = vF;
    this.collideWorld();
    this.followGround(dt);
  }

  collideWorld() {
    const s = this.spec, col = this.game.world.colliders;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const r = s.wid / 2 * 0.95;
    const offs = [s.len / 2 - r, 0, -s.len / 2 + r];
    for (const o of offs) {
      const cx = this.pos.x + sh * o, cz = this.pos.z + ch * o;
      const res = col.resolve(cx, cz, r, this.pos.y + 0.6);
      if (!res.hit) continue;
      this.pos.x += res.x - cx; this.pos.z += res.z - cz;
      const vn = this.vel.x * res.nx + this.vel.y * res.nz;
      if (vn < 0) {
        const impact = -vn;
        this.vel.x -= res.nx * vn * 1.3; this.vel.y -= res.nz * vn * 1.3;
        this.vel.multiplyScalar(impact > 4 ? 0.8 : 0.97);
        this.angVel += (o > 0 ? 1 : o < 0 ? -1 : 0) * (res.nx * ch - res.nz * sh) * impact * 0.08;
        this.impact(cx - res.nx * r, cz - res.nz * r, res.nx, res.nz, impact);
      }
    }
  }

  /** Called on any crash. (px,pz) world contact point, (nx,nz) normal pointing into the car. */
  impact(px, pz, nx, nz, speed) {
    if (speed < 2.2) return;
    const g = this.game;
    const dmg = Math.pow(speed - 2, 1.25) * 1.9;
    this.health = Math.max(0, this.health - dmg);
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const dx = px - this.pos.x, dz = pz - this.pos.z;
    const lx = dx * ch - dz * sh, lz = dx * sh + dz * ch;
    const dlx = nx * ch - nz * sh, dlz = nx * sh + nz * ch;
    const amount = Math.min(0.4, (speed - 1.5) * 0.028);
    this.deform(lx, 0.7, lz, dlx, dlz, amount, 1.0 + speed * 0.04);
    const halfL = this.spec.len / 2;
    if (lz > halfL - 0.9 && speed > 6) this.frontBroken = true;
    if (lz < -halfL + 0.9 && speed > 6) this.rearBroken = true;
    if (speed > 13 && !this.glassBroken) { this.glassBroken = true; this.cabin.material = [crackedGlass, this.cabin.material[1]]; }
    const now = performance.now();
    if (now - this.lastHit > 180) {
      this.lastHit = now;
      const vol = clamp(speed / 25, 0.1, 1);
      const d = g.camera.position.distanceTo(this.pos);
      g.audio.crash(vol * clamp(1 - d / 80, 0, 1));
      for (let k = 0; k < Math.min(30, speed * 1.5); k++) g.sparks.emit(px, this.pos.y + 0.5 + Math.random() * 0.4, pz, (Math.random() - 0.5) * 6 + nx * 3, Math.random() * 4, (Math.random() - 0.5) * 6 + nz * 3, 0.35 + Math.random() * 0.3, 0.06, 0.02, 4, 2.4, 0.8, 1, 0.5, 9);
      g.emit('crash', { x: px, z: pz, speed, vehicle: this });
      if (this.driver === 'player') { g.shake = Math.min(1, speed / 20); if (this.health <= 0) g.notify('Engine destroyed. Press F to get out.'); }
    }
  }

  deform(lx, ly, lz, dx, dz, amount, R) {
    for (const [mesh, orig] of [[this.bodyMesh, this.origBody], [this.cabin, this.origCabin]]) {
      const pa = mesh.geometry.attributes.position, a = pa.array;
      const ox = mesh.position.x, oy = mesh.position.y, oz = mesh.position.z;
      let changed = false;
      for (let i = 0; i < pa.count; i++) {
        const x = a[i * 3] + ox, y = a[i * 3 + 1] + oy, z = a[i * 3 + 2] + oz;
        const d = Math.hypot(x - lx, (y - ly) * 0.7, z - lz);
        if (d > R) continue;
        const f = (1 - d / R) ** 2 * amount;
        let nx = a[i * 3] + dx * f, ny = a[i * 3 + 1] - f * 0.25, nz = a[i * 3 + 2] + dz * f;
        const ex = nx - orig[i * 3], ey = ny - orig[i * 3 + 1], ez = nz - orig[i * 3 + 2];
        const el = Math.hypot(ex, ey, ez);
        if (el > 0.5) { const k = 0.5 / el; nx = orig[i * 3] + ex * k; ny = orig[i * 3 + 1] + ey * k; nz = orig[i * 3 + 2] + ez * k; }
        a[i * 3] = nx; a[i * 3 + 1] = ny; a[i * 3 + 2] = nz; changed = true;
      }
      if (changed) { pa.needsUpdate = true; mesh.geometry.computeVertexNormals(); }
    }
  }

  followGround(dt) {
    const s = this.spec;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const hf = groundHeight(this.pos.x + sh * s.len * 0.38, this.pos.z + ch * s.len * 0.38);
    const hr = groundHeight(this.pos.x - sh * s.len * 0.38, this.pos.z - ch * s.len * 0.38);
    const target = (hf + hr) / 2;
    if (target < WATER_LEVEL - 0.9) {
      // driven into the sea: the car floods and sinks
      if (!this.sunk) {
        this.sunk = true; this.engineOn = false; this.health = 0;
        this.game.audio.splash();
        for (let k = 0; k < 40; k++) this.game.bubbles.emit(this.pos.x + (Math.random() - 0.5) * 3, WATER_LEVEL, this.pos.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 1.2, 0.5, 0.2, 1, 1, 1, 0.8, 1, 6);
        this.game.emit('carSunk', { vehicle: this });
      }
      this.pos.y = Math.max(target, this.pos.y - dt * 1.2);
      this.vel.multiplyScalar(Math.exp(-2.5 * dt));
      if (Math.random() < 0.3) this.game.bubbles.emit(this.pos.x, this.pos.y + 1, this.pos.z, 0, 1.5, 0, 3, 0.15, 0.25, 0.8, 0.95, 1, 0.6, 0.5, -1.2);
    } else {
      this.pos.y = this.pos.y > target + 0.3 ? this.pos.y - dt * 9 : damp(this.pos.y, target, 25, dt);
    }
    this.groundPitch = Math.atan2(hr - hf, s.len * 0.76);
  }

  syncModel(dt) {
    const vF = this.forwardSpeed();
    const pT = clamp(-(this.accelF || 0) * 0.006, -0.06, 0.06);
    const rT = clamp(-this.angVel * vF * 0.0045, -0.07, 0.07);
    this.pitch = damp(this.pitch, pT, 6, dt || 1); this.roll = damp(this.roll, rT, 6, dt || 1);
    this.model.position.copy(this.pos);
    this.model.rotation.set(this.groundPitch || 0, this.heading, 0, 'YXZ');
    this.bodyGroup.rotation.set(this.pitch, 0, this.roll);
    this.bodyGroup.position.y = this.health < 30 ? -0.03 : 0;
    this.wheelSpin += (vF / this.spec.r) * (dt || 0);
    for (const w of this.wheels) { w.spin.rotation.x = this.wheelSpin; if (w.front) w.pivot.rotation.y = this.steer; }
  }

  /** Lights, smoke, fire. */
  updateVisuals(dt, night) {
    this.syncModel(dt);
    const L = this.lights;
    this.blink += dt;
    const on = Math.floor(this.blink * 2.6) % 2 === 0;
    const hl = this.headlights && !this.frontBroken && this.health > 0 && (this.engineOn || this.driver === 'ai');
    L.head.emissiveIntensity = hl ? 6 : 0;
    L.tail.emissiveIntensity = this.rearBroken ? 0 : this.braking ? 7 : hl ? 1.6 : 0;
    L.rev.emissiveIntensity = this.reversing && !this.rearBroken ? 4 : 0;
    const left = this.hazard || this.indicator < 0, right = this.hazard || this.indicator > 0;
    L.indL.emissiveIntensity = left && on ? 5 : 0;
    L.indR.emissiveIntensity = right && on ? 5 : 0;
    if (L.taxi) L.taxi.emissiveIntensity = 0.4 + night * 2;
    if (L.barA) { const f = Math.floor(this.blink * 6) % 2; L.barA.emissiveIntensity = this.siren && f ? 8 : 0; L.barB.emissiveIntensity = this.siren && !f ? 8 : 0; }
    if ((left || right) && this.driver === 'player') {
      const phase = Math.floor(this.blink * 2.6);
      if (phase !== this._lastBlink) { this._lastBlink = phase; this.game.audio.tick(); }
    }
    // damage smoke / fire from the engine bay
    if (this.health < 50 && !this.sunk) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        const k = 1 - this.health / 50;
        this.smokeT = 0.12 - k * 0.09;
        const sh = Math.sin(this.heading), ch = Math.cos(this.heading), o = this.spec.len / 2 - 0.9;
        const x = this.pos.x + sh * o, z = this.pos.z + ch * o, y = this.pos.y + this.dims.clr + this.dims.bh + 0.1;
        const gcol = this.health < 15 ? 0.08 : 0.5 - k * 0.25;
        this.game.smoke.emit(x, y, z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6, 2.5 + k * 2, 0.5, 2.8 + k * 2, gcol, gcol, gcol, 0.55, 0.4, -0.3);
        if (this.health < 15) for (let f = 0; f < 2; f++) this.game.fire.emit(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8, 0, 1.8 + Math.random(), 0, 0.5 + Math.random() * 0.3, 0.7, 0.15, 3.5, 1.4, 0.35, 0.9, 1, -1);
      }
    }
  }

  dispose() {
    this.game.scene.remove(this.model);
    this.bodyMesh.geometry.dispose(); this.cabin.geometry.dispose();
  }
}

/** Resolve a collision between two vehicles (3-circle capsules). Returns impulse magnitude. */
export function collideVehicles(a, b) {
  const dx0 = a.pos.x - b.pos.x, dz0 = a.pos.z - b.pos.z;
  if (dx0 * dx0 + dz0 * dz0 > 49) return 0;
  const ca = circles(a), cb = circles(b);
  let best = null;
  for (const p of ca) for (const q of cb) {
    const dx = p[0] - q[0], dz = p[1] - q[1], d = Math.hypot(dx, dz), rr = p[2] + q[2];
    if (d < rr && (!best || rr - d > best.pen)) best = { pen: rr - d, nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0, px: (p[0] + q[0]) / 2, pz: (p[1] + q[1]) / 2 };
  }
  if (!best) return 0;
  const ma = a.spec.mass, mb = b.spec.mass, inv = 1 / ma + 1 / mb;
  a.pos.x += best.nx * best.pen * (1 / ma) / inv; a.pos.z += best.nz * best.pen * (1 / ma) / inv;
  b.pos.x -= best.nx * best.pen * (1 / mb) / inv; b.pos.z -= best.nz * best.pen * (1 / mb) / inv;
  const rvx = a.vel.x - b.vel.x, rvz = a.vel.y - b.vel.y;
  const vn = rvx * best.nx + rvz * best.nz;
  if (vn >= 0) return 0;
  const j = (-(1 + 0.25) * vn) / inv;
  a.vel.x += (j / ma) * best.nx; a.vel.y += (j / ma) * best.nz;
  b.vel.x -= (j / mb) * best.nx; b.vel.y -= (j / mb) * best.nz;
  a.angVel += (Math.random() - 0.5) * j / ma * 0.3; b.angVel += (Math.random() - 0.5) * j / mb * 0.3;
  const sp = -vn;
  a.impact(best.px, best.pz, best.nx, best.nz, sp);
  b.impact(best.px, best.pz, -best.nx, -best.nz, sp);
  return sp;
}
function circles(v) {
  const s = v.spec, r = (s.wid / 2) * 0.95, sh = Math.sin(v.heading), ch = Math.cos(v.heading);
  return [s.len / 2 - r, 0, -s.len / 2 + r].map((o) => [v.pos.x + sh * o, v.pos.z + ch * o, r]);
}
