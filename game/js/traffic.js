import * as THREE from 'three';
import { Vehicle, PAINTS } from './vehicle.js';
import { GRID, DIRS, LANES, roadCoord, lightState } from './world.js';
import { clamp, damp, pick, angleDiff } from './util.js';

const TYPES = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'suv', 'suv', 'taxi', 'van', 'sports'];
const DRIVER_LINES = {
  honk: ['Move it!', 'Come on, green means go!', 'Get out of the road!', 'Are you kidding me?', 'Some of us have places to be!'],
  crash: ['My car!!', 'Are you insane?!', "I'm calling my insurance!", 'You hit me!', 'Learn to drive!'],
  jacked: ['Hey! That\'s my car!', 'Thief! Somebody stop him!', 'Not again… I just paid it off!'],
};

/** AI drivers that follow lanes, obey traffic lights, keep distance and react to collisions. */
export class Traffic {
  constructor(game) {
    this.game = game;
    this.cars = [];
    this.max = 32;
    this.spawnTimer = 0;
  }

  segPoints(i, j, dir, lane) {
    const [dx, dz] = DIRS[dir];
    const rx = -dz, rz = dx;
    const ax = roadCoord(i), az = roadCoord(j), bx = roadCoord(i + dx), bz = roadCoord(j + dz);
    return {
      p0: new THREE.Vector2(ax + dx * 12 + rx * lane, az + dz * 12 + rz * lane),
      p1: new THREE.Vector2(bx - dx * 12 + rx * lane, bz - dz * 12 + rz * lane),
    };
  }
  validDir(i, j, d) { const [dx, dz] = DIRS[d]; const a = i + dx, b = j + dz; return a >= 0 && b >= 0 && a <= GRID && b <= GRID; }

  spawn(px, pz, minR, maxR) {
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(Math.random() * (GRID + 1)), j = Math.floor(Math.random() * (GRID + 1)), dir = Math.floor(Math.random() * 4);
      if (!this.validDir(i, j, dir)) continue;
      const lane = pick(LANES);
      const { p0, p1 } = this.segPoints(i, j, dir, lane);
      const t = Math.random();
      const x = p0.x + (p1.x - p0.x) * t, z = p0.y + (p1.y - p0.y) * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < minR || d > maxR) continue;
      if (this.cars.some((c) => (c.v.pos.x - x) ** 2 + (c.v.pos.z - z) ** 2 < 150)) continue;
      const type = pick(TYPES);
      const v = new Vehicle(this.game, type, pick(PAINTS));
      v.driver = 'ai'; v.engineOn = true; v.fuel = v.fuelCap;
      const [dx, dz] = DIRS[dir];
      v.place(x, z, Math.atan2(dx, dz));
      const car = {
        v, mode: 'drive', i, j, dir, lane, phase: 'seg', p0, p1, t, len: p0.distanceTo(p1),
        speed: 8, cruise: 10 + Math.random() * 5, stuck: 0, ignore: 0, honkCd: 0, nextDir: null, curve: null,
        name: null, temper: Math.random(),
      };
      v.ai = car;
      const s = 9; v.vel.set(dx * s, dz * s); car.speed = s;
      this.chooseNext(car);
      this.cars.push(car);
      return car;
    }
    return null;
  }

  chooseNext(c) {
    const bi = c.i + DIRS[c.dir][0], bj = c.j + DIRS[c.dir][1];
    const opts = [c.dir, c.dir, c.dir, (c.dir + 1) % 4, (c.dir + 3) % 4].filter((d) => this.validDir(bi, bj, d));
    c.nextDir = opts.length ? pick(opts) : (c.dir + 2) % 4;
    c.indicator = c.nextDir === (c.dir + 1) % 4 ? 1 : c.nextDir === (c.dir + 3) % 4 ? -1 : 0;
  }

  beginTurn(c) {
    const bi = c.i + DIRS[c.dir][0], bj = c.j + DIRS[c.dir][1];
    const nd = c.nextDir;
    const next = this.segPoints(bi, bj, nd, c.lane);
    const P0 = c.p1.clone(), P2 = next.p0.clone();
    const d = new THREE.Vector2(...DIRS[c.dir]);
    let P1;
    if (nd === c.dir) P1 = P0.clone().add(P2).multiplyScalar(0.5);
    else if (nd === (c.dir + 2) % 4) P1 = P0.clone().addScaledVector(d, 10).add(P2.clone().addScaledVector(d, 10)).multiplyScalar(0.5);
    else P1 = P0.clone().addScaledVector(d, P2.clone().sub(P0).dot(d));
    let len = 0, prev = P0.clone();
    for (let k = 1; k <= 10; k++) { const q = bez(P0, P1, P2, k / 10); len += q.distanceTo(prev); prev = q; }
    c.curve = { P0, P1, P2, len };
    c.phase = 'turn'; c.t = 0;
    c.nb = { i: bi, j: bj, dir: nd, p0: next.p0, p1: next.p1 };
  }

  update(dt, simTime) {
    const g = this.game, P = g.player;
    const cx = P.pos.x, cz = P.pos.z;
    // spawn / despawn around the player
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.cars.length < this.max) { this.spawnTimer = 0.15; this.spawn(cx, cz, 110, 330); }
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const c = this.cars[k];
      const d = Math.hypot(c.v.pos.x - cx, c.v.pos.z - cz);
      if (d > 430 && c.v !== P.vehicle && !c.v.keep) { c.v.dispose(); this.cars.splice(k, 1); if (c.bubbleEl) c.bubbleEl.remove(); }
    }
    const night = g.env.night;
    const obstacles = this.collectObstacles();
    for (const c of this.cars) {
      const v = c.v;
      c.honkCd -= dt;
      if (c.mode === 'drive') this.drive(c, dt, simTime, obstacles);
      else if (c.mode === 'dynamic') {
        v.physics(dt, { fwd: 0, back: 0, steer: 0, handbrake: true });
        if (v.speed() < 0.3) {
          c.settle = (c.settle || 0) + dt;
          if (c.settle > 1.5 && v.driver === 'ai') {
            // shaken driver gets out to yell, or drives off if the car still works
            if (v.health > 35 && Math.random() < 0.5) { c.mode = 'recover'; c.recover = 2; }
            else this.ejectDriver(c, 'crash');
          }
        }
      } else if (c.mode === 'recover') {
        c.recover -= dt;
        v.physics(dt, { fwd: 0, back: 0, steer: 0, handbrake: true });
        if (c.recover <= 0) this.resumePath(c);
      } else if (c.mode === 'parked' && v !== P.vehicle) {
        v.physics(dt, null);
      }
      if (v !== P.vehicle) {
        v.headlights = night > 0.45 && v.driver === 'ai';
        v.updateVisuals(dt, night);
      }
    }
  }

  collectObstacles() {
    const g = this.game, list = [];
    for (const c of this.cars) list.push({ x: c.v.pos.x, z: c.v.pos.z, car: c, r: 2.2 });
    if (g.player.vehicle && !g.player.vehicle.ai) list.push({ x: g.player.vehicle.pos.x, z: g.player.vehicle.pos.z, player: true, r: 2.2 });
    for (const v of g.parked) list.push({ x: v.pos.x, z: v.pos.z, r: 2.2 });
    if (g.player.mode !== 'car') list.push({ x: g.player.pos.x, z: g.player.pos.z, r: 0.8, ped: true, player: true });
    for (const n of g.npcs.list) if (n.onRoad) list.push({ x: n.pos.x, z: n.pos.z, r: 0.8, ped: true });
    return list;
  }

  drive(c, dt, simTime, obstacles) {
    const v = c.v;
    // desired speed from traffic lights
    let target = c.cruise;
    if (c.phase === 'seg') {
      const distEnd = (1 - c.t) * c.len;
      const bi = c.i + DIRS[c.dir][0], bj = c.j + DIRS[c.dir][1];
      const axis = c.dir % 2;
      const st = lightState(bi, bj, axis, simTime);
      if (st === 'r' || (st === 'y' && distEnd > 7)) target = Math.min(target, Math.sqrt(Math.max(0, 2 * 3.5 * (distEnd - 0.5))));
      if (distEnd < 25 && c.nextDir !== c.dir) target = Math.min(target, 7.5);
      v.indicator = distEnd < 35 ? c.indicator : 0;
    } else { target = Math.min(target, c.nextDir === c.dir ? c.cruise : 7); }
    // keep distance from whatever is ahead
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let blockedBy = null, minAlong = Infinity;
    if (c.ignore <= 0) {
      for (const o of obstacles) {
        if (o.car === c) continue;
        const rx = o.x - v.pos.x, rz = o.z - v.pos.z;
        const along = rx * fx + rz * fz;
        if (along <= 0 || along > 32) continue;
        const lat = Math.abs(rx * fz - rz * fx);
        if (lat > (o.ped ? 2.0 : 1.9)) continue;
        if (along < minAlong) { minAlong = along; blockedBy = o; }
      }
    } else c.ignore -= dt;
    if (blockedBy) {
      const gap = blockedBy.ped ? 3.5 : 6.5;
      target = Math.min(target, Math.sqrt(Math.max(0, 2 * 5 * (minAlong - gap))));
    }
    c.speed = c.speed > target ? Math.max(target, c.speed - 7 * dt) : Math.min(target, c.speed + 2.4 * dt);
    v.braking = c.speed > target + 0.2 || (c.speed < 0.5 && target < 0.5);
    // jams: honk at the player, creep past deadlocks
    if (c.speed < 0.2) {
      c.stuck += dt;
      if (blockedBy && blockedBy.player && c.stuck > 3 && c.honkCd <= 0) {
        c.honkCd = 4 + Math.random() * 4;
        this.honk(c, 0.6);
        if (Math.random() < 0.6) this.game.npcs.bubbleAt(v.pos, pick(DRIVER_LINES.honk), 'angry', 2.5);
      }
      if (c.stuck > 7 && blockedBy && !blockedBy.player && !blockedBy.ped) { c.ignore = 2.5; c.stuck = 0; }
    } else c.stuck = 0;

    // advance along the path
    if (c.phase === 'seg') {
      c.t += (c.speed * dt) / c.len;
      if (c.t >= 1) { this.beginTurn(c); }
      else {
        const x = c.p0.x + (c.p1.x - c.p0.x) * c.t, z = c.p0.y + (c.p1.y - c.p0.y) * c.t;
        this.setPose(v, x, z, Math.atan2(c.p1.x - c.p0.x, c.p1.y - c.p0.y), c.speed, dt);
      }
    }
    if (c.phase === 'turn') {
      const cv = c.curve;
      c.t += (c.speed * dt) / cv.len;
      if (c.t >= 1) {
        const nb = c.nb;
        Object.assign(c, { i: nb.i, j: nb.j, dir: nb.dir, p0: nb.p0, p1: nb.p1, len: nb.p0.distanceTo(nb.p1), t: 0, phase: 'seg' });
        this.chooseNext(c);
      } else {
        const p = bez(cv.P0, cv.P1, cv.P2, c.t), tg = bezT(cv.P0, cv.P1, cv.P2, c.t);
        this.setPose(v, p.x, p.y, Math.atan2(tg.x, tg.y), c.speed, dt);
      }
    }
  }

  setPose(v, x, z, h, speed, dt) {
    const prevH = v.heading;
    v.pos.x = x; v.pos.z = z;
    v.heading = prevH + angleDiff(prevH, h) * Math.min(1, dt * 12);
    v.angVel = angleDiff(prevH, v.heading) / Math.max(dt, 1e-3);
    v.vel.set(Math.sin(h) * speed, Math.cos(h) * speed);
    v.prevVF = v.accelF = 0;
    v.followGround(dt);
    v.rpm = 900 + speed * 120;
  }

  honk(c, vol) {
    const g = this.game;
    const d = g.camera.position.distanceTo(c.v.pos);
    if (d < 70) { g.audio.setHorn(true, vol * (1 - d / 70)); setTimeout(() => g.audio.setHorn(g.input?.down('KeyH') && g.player.mode === 'car'), 350 + Math.random() * 300); }
    g.emit('horn', { x: c.v.pos.x, z: c.v.pos.z, ai: true });
  }

  /** Something hit this AI car hard enough to break it out of lane-following. */
  knock(c) {
    if (c.mode === 'drive') { c.mode = 'dynamic'; c.settle = 0; c.v.hazard = false; }
  }

  resumePath(c) {
    // find the closest lane segment and rejoin it
    const v = c.v;
    let best = null, bd = Infinity;
    const ci = Math.round((v.pos.x + 800) / 100), cj = Math.round((v.pos.z + 800) / 100);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (let d = 0; d < 4; d++) {
      if (i < 0 || j < 0 || i > GRID || j > GRID || !this.validDir(i, j, d)) continue;
      const { p0, p1 } = this.segPoints(i, j, d, c.lane);
      const ab = p1.clone().sub(p0), t = clamp(new THREE.Vector2(v.pos.x, v.pos.z).sub(p0).dot(ab) / ab.lengthSq(), 0, 0.9);
      const q = p0.clone().addScaledVector(ab, t);
      const dd = q.distanceTo(new THREE.Vector2(v.pos.x, v.pos.z)) + Math.abs(angleDiff(v.heading, Math.atan2(ab.x, ab.y))) * 4;
      if (dd < bd) { bd = dd; best = { i, j, d, p0, p1, t }; }
    }
    if (!best || bd > 12) { c.mode = 'parked'; c.v.hazard = true; return; }
    Object.assign(c, { mode: 'drive', i: best.i, j: best.j, dir: best.d, p0: best.p0, p1: best.p1, t: best.t, len: best.p0.distanceTo(best.p1), phase: 'seg', speed: 0 });
    this.chooseNext(c);
  }

  /** Driver leaves the car (after a crash or a carjacking) and becomes a pedestrian. */
  ejectDriver(c, why) {
    const v = c.v;
    if (v.driver !== 'ai') return null;
    v.driver = null; v.engineOn = why === 'jacked' ? v.engineOn : false; v.hazard = why === 'crash';
    v.driverMesh.visible = false;
    c.mode = 'parked';
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const x = v.pos.x + ch * 1.6, z = v.pos.z - sh * 1.6;
    const npc = this.game.npcs.spawnAt(x, z, { fromCar: true });
    if (npc) {
      if (why === 'jacked') { npc.remember('carjacked', -0.8); npc.fear = 0.9; npc.say(pick(DRIVER_LINES.jacked), 'scared', 3); npc.startFlee(this.game.player.pos, 6); }
      else { npc.remember('crashed', -0.5); npc.anger = 0.8; npc.say(pick(DRIVER_LINES.crash), 'angry', 3.5); npc.state = 'confront'; npc.stateT = 6; }
    }
    return npc;
  }
}

function bez(a, b, c, t) { const u = 1 - t; return new THREE.Vector2(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y); }
function bezT(a, b, c, t) { const u = 1 - t; return new THREE.Vector2(2 * u * (b.x - a.x) + 2 * t * (c.x - b.x), 2 * u * (b.y - a.y) + 2 * t * (c.y - b.y)); }
