import * as THREE from 'three';
import { Humanoid } from './humanoid.js';
import { groundHeight, seabedHeight, WATER_LEVEL, SHORE_Z, HALF } from './world.js';
import { clamp, damp, angleDiff } from './util.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.human = new Humanoid({ skin: '#d9a77f', hair: '#2a1a10', shirt: '#24364f', pants: '#2f4a6b', shoes: '#f2f2f2', longSleeve: true, height: 1.0 });
    game.scene.add(this.human.root);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.mode = 'foot';
    this.vehicle = null;
    this.health = 100; this.oxygen = 1; this.money = 500;
    this.under = false; this.walkMode = false; this.speed = 0;
    this.downT = 0; this.onGround = true;
  }

  spawn(x, z, h) {
    this.pos.set(x, groundHeight(x, z), z); this.heading = h; this.vel.set(0, 0, 0);
    this.mode = 'foot'; this.health = 100; this.oxygen = 1; this.under = false;
    if (this.human.root.parent !== this.game.scene) this.game.scene.add(this.human.root);
  }

  surfaceY() { return WATER_LEVEL + this.game.waveAt(this.pos.x, this.pos.z); }
  waterDepthHere() { return this.pos.z > SHORE_Z ? WATER_LEVEL - seabedHeight(this.pos.x, this.pos.z) : 0; }
  headUnderwater() {
    if (this.mode !== 'swim') return false;
    return this.pos.y + 1.05 < this.surfaceY() - 0.05;
  }

  update(dt, input, cam) {
    const g = this.game;
    if (this.mode === 'car') return this.updateCar(dt, input);
    if (this.mode === 'down') {
      this.downT -= dt;
      this.human.update(dt, { mode: 'down' });
      this.syncHuman();
      if (this.downT <= 0) this.mode = 'foot';
      return;
    }
    const fwd = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const str = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    if (input.hit('KeyV')) { this.walkMode = !this.walkMode; g.notify(this.walkMode ? 'Walking' : 'Jogging'); }
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    let wx = fx * fwd + rx * str, wz = fz * fwd + rz * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    if (this.mode === 'foot') {
      const max = sprint ? 6.8 : this.walkMode ? 1.6 : 3.6;
      const tx = wx * max * (wl > 0 ? 1 : 0), tz = wz * max * (wl > 0 ? 1 : 0);
      const acc = this.onGround ? 10 : 2;
      this.vel.x = damp(this.vel.x, tx, acc, dt); this.vel.z = damp(this.vel.z, tz, acc, dt);
      const gh = groundHeight(this.pos.x, this.pos.z);
      if (this.onGround && input.hit('Space')) { this.vel.y = 4.6; this.onGround = false; }
      this.vel.y -= 9.8 * dt;
      this.pos.addScaledVector(this.vel, dt);
      const r = g.world.colliders.resolve(this.pos.x, this.pos.z, 0.33, this.pos.y + 0.4);
      if (r.hit) { this.pos.x = r.x; this.pos.z = r.z; }
      // parked / traffic cars are solid too
      for (const v of g.allVehicles()) {
        const dx = this.pos.x - v.pos.x, dz = this.pos.z - v.pos.z;
        if (dx * dx + dz * dz > 16) continue;
        const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
        let lx = dx * ch - dz * sh, lz = dx * sh + dz * ch;
        const hx = v.spec.wid / 2 + 0.3, hz = v.spec.len / 2 + 0.3;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz && this.pos.y < v.pos.y + v.spec.hgt) {
          if (hx - Math.abs(lx) < hz - Math.abs(lz)) lx = Math.sign(lx) * hx; else lz = Math.sign(lz) * hz;
          this.pos.x = v.pos.x + lx * ch + lz * sh; this.pos.z = v.pos.z - lx * sh + lz * ch;
          if (v.speed() > 4 && v.driver !== 'player') this.knockDown(v.vel.x, v.vel.y);
        }
      }
      const gh2 = groundHeight(this.pos.x, this.pos.z);
      if (this.pos.y <= gh2) { this.pos.y = gh2; if (this.vel.y < -12) this.hurt((-this.vel.y - 12) * 6); this.vel.y = 0; this.onGround = true; }
      else if (this.pos.y > gh2 + 0.25) this.onGround = false;
      else if (this.onGround) this.pos.y = gh2;
      void gh;
      this.speed = Math.hypot(this.vel.x, this.vel.z);
      if (this.speed > 0.2) this.heading += angleDiff(this.heading, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, dt * 10);
      // into the sea → swimming
      if (this.waterDepthHere() > 1.45 && this.pos.y < this.surfaceY() - 0.9) {
        this.mode = 'swim'; this.under = false;
        if (this.vel.y < -3) { g.audio.splash(); this.splash(); }
        this.vel.y *= 0.2;
      }
      const mode = this.onGround ? (this.speed > 0.25 ? 'walk' : 'idle') : 'air';
      this.human.update(dt, { mode, speed: this.speed });
      this.oxygen = Math.min(1, this.oxygen + dt / 3);
    } else if (this.mode === 'swim') {
      const surf = this.surfaceY();
      const floatY = surf - 1.1;
      const up = (input.down('Space') ? 1 : 0) - (input.down('KeyC') || input.down('ControlLeft') ? 1 : 0);
      if (up < 0) this.under = true;
      const spd = sprint ? 3.3 : 1.9;
      let tx, ty, tz;
      if (this.under) {
        // swim where the camera is looking
        const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
        const lx = -Math.sin(cam.yaw) * cp, ly = -sp, lz = -Math.cos(cam.yaw) * cp;
        tx = (lx * fwd + rx * str) * spd; ty = (ly * fwd) * spd + up * 1.6 + 0.15; tz = (lz * fwd + rz * str) * spd;
      } else { tx = wx * spd * (wl > 0 ? 1 : 0); tz = wz * spd * (wl > 0 ? 1 : 0); ty = (floatY - this.pos.y) * 3; }
      this.vel.x = damp(this.vel.x, tx, 2.5, dt); this.vel.y = damp(this.vel.y, ty, 3, dt); this.vel.z = damp(this.vel.z, tz, 2.5, dt);
      this.pos.addScaledVector(this.vel, dt);
      const floor = groundHeight(this.pos.x, this.pos.z) + 0.25;
      if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = Math.max(0, this.vel.y); }
      if (this.pos.y > floatY) { this.pos.y = floatY; if (this.under && up <= 0) this.under = false; this.vel.y = Math.min(this.vel.y, 0); }
      const r = g.world.colliders.resolve(this.pos.x, this.pos.z, 0.4, this.pos.y + 0.5);
      if (r.hit) { this.pos.x = r.x; this.pos.z = r.z; }
      this.speed = this.vel.length();
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 0.2) this.heading += angleDiff(this.heading, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, dt * 4);
      const pitchLook = this.under && hs > 0.2 ? -Math.atan2(this.vel.y, hs) * 0.8 : 0;
      this.human.update(dt, { mode: 'swim', speed: this.speed, under: this.under, lookPitch: pitchLook });
      // back on the beach
      if (this.waterDepthHere() < 1.25) { this.mode = 'foot'; this.under = false; this.pos.y = groundHeight(this.pos.x, this.pos.z); }
      // breath
      if (this.headUnderwater()) {
        this.oxygen = Math.max(0, this.oxygen - dt / 70);
        if (this.oxygen <= 0) this.hurt(12 * dt);
        if (Math.random() < dt * (this.speed > 1 ? 6 : 2.5)) g.bubbles.emit(this.pos.x + Math.sin(this.heading) * 0.4, this.pos.y + 1.0, this.pos.z + Math.cos(this.heading) * 0.4, (Math.random() - 0.5) * 0.3, 0.8, (Math.random() - 0.5) * 0.3, 4, 0.07, 0.14, 0.85, 0.95, 1, 0.7, 0.4, -1.3);
      } else { if (this.oxygen < 0.3 && !this._gasped) { this._gasped = true; g.audio.burst(0.5, 600, 0.2); } this.oxygen = Math.min(1, this.oxygen + dt / 4); if (this.oxygen > 0.5) this._gasped = false; }
      if (!this.under && this.speed > 0.6 && Math.random() < dt * 8) g.bubbles.emit(this.pos.x, surf + 0.05, this.pos.z, (Math.random() - 0.5), 0.6, (Math.random() - 0.5), 0.6, 0.25, 0.6, 1, 1, 1, 0.5, 2, 2);
    }
    this.syncHuman();
  }

  splash() {
    const s = this.surfaceY();
    for (let k = 0; k < 30; k++) this.game.bubbles.emit(this.pos.x, s, this.pos.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.8, 0.2, 0.5, 1, 1, 1, 0.8, 1, 9);
  }

  syncHuman() {
    const r = this.human.root;
    r.position.copy(this.pos);
    r.rotation.set(0, this.heading, 0);
  }

  knockDown(vx, vz) {
    if (this.mode !== 'foot') return;
    this.mode = 'down'; this.downT = 2.5;
    this.vel.set(vx * 0.5, 2, vz * 0.5);
    this.hurt(15 + Math.hypot(vx, vz) * 1.5);
    this.game.shake = 0.6;
    this.game.audio.crash(0.4);
  }

  hurt(n) {
    this.health = Math.max(0, this.health - n);
    if (this.health <= 0) this.game.blackout();
  }

  /* ───────────── vehicles ───────────── */
  tryEnter() {
    const g = this.game;
    let best = null, bd = 4.2;
    for (const v of g.allVehicles()) {
      if (v.sunk) continue;
      const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z);
      if (d < bd && v.speed() < 6) { bd = d; best = v; }
    }
    if (!best) return false;
    const v = best;
    if (v.ai && v.driver === 'ai') {
      g.traffic.ejectDriver(v.ai, 'jacked');
      g.emit('carjack', { x: v.pos.x, z: v.pos.z });
      g.notify('You took the car. The driver is not happy about it.');
    }
    if (v.ai) v.ai.mode = 'player';
    if (g.lastCar && g.lastCar !== v) g.lastCar.keep = false;
    g.lastCar = v; v.keep = true;
    this.vehicle = v; this.mode = 'car';
    v.driver = 'player'; v.driverMesh.visible = false;
    v.hazard = false;
    if (v.health > 0 && v.fuel > 0) { v.engineOn = true; g.audio.ignition(); }
    else g.notify(v.health <= 0 ? 'This engine is wrecked.' : 'The tank is empty.');
    // sit the player in the driver's seat
    const seatHip = Math.min(v.dims.clr + 0.2, v.spec.hgt - 0.86);
    v.bodyGroup.add(this.human.root);
    this.human.root.position.set(0.4, seatHip - 0.53, v.spec.cabOff + 0.25);
    this.human.root.rotation.set(0, 0, 0);
    this.human.cur = {};
    g.hud.showCar(true);
    return true;
  }

  exitCar() {
    const g = this.game, v = this.vehicle;
    if (!v) return;
    if (v.speed() > 4) { g.notify('Slow down before getting out.'); return; }
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    let ox = 1.7;
    for (const side of [1, -1]) {
      const x = v.pos.x + ch * 1.7 * side, z = v.pos.z - sh * 1.7 * side;
      const r = g.world.colliders.resolve(x, z, 0.35, v.pos.y + 0.5);
      if (!r.hit) { ox = 1.7 * side; break; }
    }
    this.pos.set(v.pos.x + ch * ox, v.pos.y, v.pos.z - sh * ox);
    if (v.sunk) this.pos.y = Math.max(v.pos.y + 0.5, groundHeight(this.pos.x, this.pos.z));
    this.heading = v.heading;
    this.vel.set(0, 0, 0);
    g.scene.add(this.human.root);
    this.human.cur = {};
    v.driver = null; v.indicator = 0;
    if (v.ai) v.ai.mode = 'parked';
    g.audio.setEngine(false, 0, 0); g.audio.setHorn(false); g.audio.setSqueal(0);
    this.vehicle = null;
    this.mode = this.waterDepthHere() > 1.45 && this.pos.y < this.surfaceY() - 0.5 ? 'swim' : 'foot';
    if (this.mode === 'swim') this.under = this.pos.y < this.surfaceY() - 2;
    g.hud.showCar(false);
  }

  updateCar(dt, input) {
    const g = this.game, v = this.vehicle;
    const ctl = {
      fwd: input.down('KeyW') || input.down('ArrowUp') ? 1 : 0,
      back: input.down('KeyS') || input.down('ArrowDown') ? 1 : 0,
      steer: (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0) - (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0),
      handbrake: input.down('Space'),
    };
    if (input.hit('KeyL')) { v.headlights = !v.headlights; g.audio.tick(); }
    if (input.hit('KeyZ')) v.indicator = v.indicator === -1 ? 0 : -1;
    if (input.hit('KeyX')) v.indicator = v.indicator === 1 ? 0 : 1;
    if (input.hit('KeyC')) v.hazard = !v.hazard;
    if (input.hit('KeyE')) {
      if (v.engineOn) { v.engineOn = false; g.notify('Engine off'); }
      else if (v.health > 0 && v.fuel > 0 && !v.sunk) { v.engineOn = true; g.audio.ignition(); }
    }
    const horn = input.down('KeyH');
    g.audio.setHorn(horn);
    if (input.hit('KeyH')) g.emit('horn', { x: v.pos.x, z: v.pos.z });
    // indicators cancel after the turn
    if (v.indicator !== 0 && Math.abs(v.steer) > 0.25) v._turned = true;
    if (v._turned && Math.abs(v.steer) < 0.05) { v.indicator = 0; v._turned = false; }
    v.physics(dt, ctl);
    this.pos.copy(v.pos);
    this.heading = v.heading;
    this.speed = v.speed();
    g.audio.setEngine(v.canRun(), v.rpm, v.throttle);
    g.audio.setSqueal(v.slip > 3.5 ? (v.slip - 3.5) / 5 : 0);
    if (v.slip > 4.5 && v.speed() > 6) {
      const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
      for (const s of [1, -1]) g.smoke.emit(v.pos.x - sh * 1.5 + ch * 0.8 * s, v.pos.y + 0.2, v.pos.z - ch * 1.5 - sh * 0.8 * s, 0, 0.6, 0, 1.3, 0.5, 2.4, 0.75, 0.75, 0.75, 0.35, 0.6, -0.2);
    }
    // refuelling
    const st = g.world.gasStations.find((s) => v.pos.x > s.zone.x0 && v.pos.x < s.zone.x1 && v.pos.z > s.zone.z0 && v.pos.z < s.zone.z1);
    this.atStation = st && v.speed() < 0.5 ? st : null;
    if (this.atStation && input.down('KeyR') && v.fuel < v.fuelCap - 0.01) {
      if (v.engineOn) { v.engineOn = false; g.notify('Engine off while refuelling.'); }
      const l = Math.min(9 * dt, v.fuelCap - v.fuel, this.money / st.price);
      if (l <= 0.0001) { if (!this._broke) { g.notify("You can't afford more fuel."); this._broke = true; } }
      else { v.fuel += l; this.money -= l * st.price; this._pumpT = (this._pumpT || 0) + dt; if (this._pumpT > 0.25) { this._pumpT = 0; g.audio.tick(); } }
    } else this._broke = false;
    this.human.update(dt, { mode: 'sit', steer: v.steer / 0.6 });
    if (v.sunk && v.pos.y < WATER_LEVEL - 1.5) { g.notify('The car is sinking! You swim out.'); this.exitCar(); }
  }
}
export { HALF };
