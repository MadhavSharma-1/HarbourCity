// Wanted level, police pursuit and ambulances. Crimes only count once a witness reports them.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { GRID, roadCoord, HALF, CELL } from './world.js';
import { clamp, angleDiff } from './util.js';
import { placeName, describeVehicle } from './knowledge.js';

const near = (i) => clamp(Math.round((i + HALF) / CELL), 0, GRID);

/** Route along the road grid: intersections from A to B, then B itself. */
function route(fx, fz, tx, tz) {
  let i = near(fx), j = near(fz);
  const ti = near(tx), tj = near(tz);
  const pts = [new THREE.Vector2(roadCoord(i), roadCoord(j))];
  // go along the longer axis first, like a driver would
  const xFirst = Math.abs(ti - i) >= Math.abs(tj - j);
  const stepX = () => { while (i !== ti) { i += Math.sign(ti - i); pts.push(new THREE.Vector2(roadCoord(i), roadCoord(j))); } };
  const stepZ = () => { while (j !== tj) { j += Math.sign(tj - j); pts.push(new THREE.Vector2(roadCoord(i), roadCoord(j))); } };
  if (xFirst) { stepX(); stepZ(); } else { stepZ(); stepX(); }
  pts.push(new THREE.Vector2(tx, tz));
  // drop the first point if we're already past it
  if (pts.length > 2 && Math.hypot(pts[0].x - fx, pts[0].y - fz) < 30 && Math.hypot(pts[1].x - fx, pts[1].y - fz) < Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)) pts.shift();
  return pts;
}

class Unit {
  constructor(game, kind, x, z) {
    this.game = game; this.kind = kind;
    this.v = new Vehicle(game, kind);
    this.v.place(x, z, Math.random() * 6.28);
    this.v.driver = 'ai'; this.v.engineOn = true; this.v.fuel = this.v.fuelCap; this.v.siren = true; this.v.keep = true;
    this.path = []; this.repath = 0; this.stuck = 0; this.reverseT = 0; this.age = 0; this.done = false;
  }
  drive(dt, tx, tz, cruise) {
    const v = this.v;
    this.age += dt;
    this.repath -= dt;
    if (this.repath <= 0 || !this.path.length) { this.path = route(v.pos.x, v.pos.z, tx, tz); this.repath = 2; }
    const wp = this.path[0];
    if (this.path.length > 1 && Math.hypot(wp.x - v.pos.x, wp.y - v.pos.z) < 11) this.path.shift();
    const p = this.path[0];
    const dist = Math.hypot(tx - v.pos.x, tz - v.pos.z);
    const diff = angleDiff(v.heading, Math.atan2(p.x - v.pos.x, p.y - v.pos.z));
    let target = cruise * (Math.abs(diff) > 0.7 ? 0.4 : 1);
    if (dist < 25) target = Math.min(target, dist * 0.5);
    const vF = v.forwardSpeed();
    let ctl = { fwd: vF < target ? 1 : 0, back: vF > target + 3 ? 1 : 0, steer: clamp(diff * 2.4, -1, 1), handbrake: false };
    if (Math.abs(vF) < 1 && target > 2) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 2.5) { this.reverseT = 1.6; this.stuck = 0; }
    if (this.reverseT > 0) { this.reverseT -= dt; ctl = { fwd: 0, back: 1, steer: -ctl.steer, handbrake: false }; }
    v.physics(dt, ctl);
    v.updateVisuals(dt, this.game.env.night);
    return dist;
  }
  dispose() { this.v.dispose(); }
}

export class Police {
  constructor(game) {
    this.game = game;
    this.stars = 0; this.heat = 0; this.lastKnown = new THREE.Vector3(); this.unseen = 0; this.bustT = 0;
    this.units = []; this.ambulances = []; this.chaseT = 0; this.lastReport = '';
  }
  vehicles() { return [...this.units, ...this.ambulances].map((u) => u.v); }

  /** A witness phoned in a crime. */
  report(crime, witness) {
    const g = this.game;
    const before = this.stars;
    this.stars = clamp(Math.max(this.stars + (this.stars > 0 ? 1 : 0), crime.stars), 0, 5);
    this.lastKnown.copy(g.player.pos);
    this.unseen = 0;
    this.lastReport = `${witness.profile.first} ${witness.profile.last} reported a ${crime.kind}`;
    if (this.stars > before) g.notify(`WANTED ${'★'.repeat(this.stars)}  ${this.lastReport}.`);
    g.news?.publish(`Police are looking for a suspect after a ${crime.kind}${crime.text.includes(' on ') ? crime.text.slice(crime.text.indexOf(' on ')) : ''}. Witnesses describe ${g.player.appearance}.`, ['police', crime.kind, 'suspect'], 0.7);
  }

  /** Someone was hit: send an ambulance. */
  sendAmbulance(npc) {
    if (this.ambulances.length >= 2 || !npc) return;
    const s = this.spawnPoint(140, 240);
    if (!s) return;
    const u = new Unit(this.game, 'ambulance', s.x, s.y);
    u.patient = npc; u.waitT = 0;
    this.ambulances.push(u);
  }

  spawnPoint(minR, maxR) {
    const P = this.game.player.pos;
    for (let k = 0; k < 30; k++) {
      const i = Math.floor(Math.random() * (GRID + 1)), j = Math.floor(Math.random() * (GRID + 1));
      const x = roadCoord(i) + 3.5, z = roadCoord(j) + 3.5;
      const d = Math.hypot(x - P.x, z - P.z);
      if (d > minR && d < maxR) return new THREE.Vector2(x, z);
    }
    return null;
  }

  update(dt) {
    const g = this.game, P = g.player;
    const ppos = P.mode === 'car' ? P.vehicle.pos : P.pos;
    // dispatch: one unit per star (max 5)
    if (this.stars > 0 && this.units.length < this.stars && Math.random() < dt * 0.6) {
      const s = this.spawnPoint(120, 230);
      if (s) this.units.push(new Unit(g, 'police', s.x, s.y));
    }
    let seen = false, closest = Infinity;
    for (const u of this.units) {
      const d = u.v.pos.distanceTo(ppos);
      closest = Math.min(closest, d);
      if (d < 70 && this.stars > 0) seen = true;
      if (this.stars > 0) u.drive(dt, (seen ? ppos : this.lastKnown).x, (seen ? ppos : this.lastKnown).z, d < 40 ? 22 : 26);
      else { u.v.siren = false; u.drive(dt, u.v.pos.x + Math.sin(u.v.heading) * 50, u.v.pos.z + Math.cos(u.v.heading) * 50, 10); }
    }
    if (seen) { this.lastKnown.copy(ppos); this.unseen = 0; } else if (this.stars > 0) this.unseen += dt;
    // losing them
    const evade = 14 + this.stars * 6;
    if (this.stars > 0 && this.unseen > evade) {
      this.stars--; this.unseen = 0;
      g.notify(this.stars ? `Wanted level dropping: ${'★'.repeat(this.stars)}` : 'You lost the police.');
    }
    // busted: police right next to you and you're not getting away
    const pSpeed = P.mode === 'car' ? P.vehicle.speed() : P.speed;
    if (this.stars > 0 && closest < (P.mode === 'car' ? 8 : 5) && pSpeed < 2) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt);
    if (this.bustT > 2.5) this.bust();
    // sirens draw attention: people nearby notice the chase
    this.chaseT -= dt;
    if (this.stars > 0 && seen && this.chaseT <= 0) { this.chaseT = 4; g.emit('chase', { x: ppos.x, z: ppos.z }); }
    g.audio.setSiren(this.units.length && this.stars > 0 ? Math.max(0, 1 - closest / 150) : 0);
    // retire units nobody needs
    for (let k = this.units.length - 1; k >= 0; k--) {
      const u = this.units[k];
      if ((this.stars === 0 && (u.v.pos.distanceTo(ppos) > 140 || u.age > 40)) || u.v.pos.distanceTo(ppos) > 500 || u.v.sunk) { u.dispose(); this.units.splice(k, 1); }
    }
    this.updateAmbulances(dt);
  }

  updateAmbulances(dt) {
    const g = this.game;
    for (let k = this.ambulances.length - 1; k >= 0; k--) {
      const u = this.ambulances[k];
      const n = u.patient;
      if (!u.done && n && g.npcs.list.includes(n)) {
        const d = u.drive(dt, n.pos.x, n.pos.z, 20);
        if (d < 10 && u.v.speed() < 1.5) {
          u.waitT += dt;
          if (u.waitT > 6) {
            u.done = true; u.v.siren = false;
            g.npcs.list.splice(g.npcs.list.indexOf(n), 1);
            g.npcs.retire(n); n.dispose();
            g.news?.publish(`A pedestrian was taken to hospital after being hit by ${n.hitBy || 'a car'} ${placeName(g.world, n.pos.x, n.pos.z)}.`, ['hospital', 'hit', 'accident', 'pedestrian'], 0.6);
          }
        }
      } else {
        u.done = true; u.v.siren = false;
        u.drive(dt, u.v.pos.x + Math.sin(u.v.heading) * 60, u.v.pos.z + Math.cos(u.v.heading) * 60, 12);
        if (u.v.pos.distanceTo(g.player.pos) > 180 || u.age > 90) { u.dispose(); this.ambulances.splice(k, 1); }
      }
    }
  }

  bust() {
    const g = this.game, P = g.player;
    const fine = 150 * this.stars;
    this.stars = 0; this.bustT = 0; this.unseen = 0; g.lastBust = g.time;
    P.money = Math.max(0, P.money - fine);
    if (P.mode === 'car') { P.vehicle.vel.set(0, 0); P.exitCar(); }
    const st = g.world.pois.find((p) => p.kind === 'police');
    if (st) P.spawn(st.x + 30, st.z + 44, 0);
    g.notify(`BUSTED. You were fined $${fine} and released from the Harbor Police Station.`);
    g.news?.publish(`Police arrested a suspect (${P.appearance}) after a chase. They were released after paying a $${fine} fine.`, ['police', 'arrest'], 0.55);
  }

  /** Called when an NPC is hit so the ambulance knows what to report. */
  onEvent(type, d) {
    if (type === 'npcHit') { d.npc.hitBy = describeVehicle(d.vehicle); setTimeout(() => this.sendAmbulance(d.npc), 5000); }
  }

  serialize() { return { stars: this.stars }; }
  restore(s) { this.stars = s?.stars || 0; }
}
