import * as THREE from 'three';
import { Humanoid, SKIN, HAIR, SHIRTS, PANTS, SHOES } from './humanoid.js';
import { makeProfile, BARKS } from './dialogue.js';
import { lightState, groundHeight, SHORE_Z, WATER_LEVEL, seabedHeight } from './world.js';
import { clamp, damp, pick, angleDiff } from './util.js';
import { describeVehicle, placeName, tellFact } from './knowledge.js';

const tmpV = new THREE.Vector3();

export class NPC {
  constructor(mgr, x, z, opts = {}) {
    this.mgr = mgr; this.game = mgr.game;
    const saved = opts.saved;
    this.profile = saved ? saved.profile : makeProfile();
    const p = this.profile;
    this.look = saved ? saved.look : {
      female: p.female, skin: pick(SKIN), hair: pick(HAIR), shirt: pick(SHIRTS), pants: pick(PANTS), shoes: pick(SHOES),
      longHair: p.female ? Math.random() < 0.75 : Math.random() < 0.08, bald: !p.female && Math.random() < 0.12,
      longSleeve: Math.random() < 0.4, height: (p.female ? 0.93 : 1.0) + (Math.random() - 0.5) * 0.1,
    };
    this.human = new Humanoid(this.look);
    this.citizenId = saved ? saved.id : 'c' + Math.floor(Math.random() * 1e9).toString(36);
    this.home = saved ? saved.home : { x, z };
    this.game.scene.add(this.human.root);
    this.pos = new THREE.Vector3(x, groundHeight(x, z), z);
    this.vel = new THREE.Vector3();
    this.heading = Math.random() * Math.PI * 2;
    this.walkSpeed = 1.15 + Math.random() * 0.45 - p.age / 400;
    this.state = 'walk'; this.stateT = 0;
    this.mood = (p.friendly - 0.5) * 0.8; this.fear = 0; this.anger = 0; this.relation = 0;
    this.memory = saved ? saved.memory.map((m) => ({ ...m, t: -1e5 })) : [];
    this.knowledge = saved ? saved.knowledge : [];
    if (saved) { this.relation = saved.relation; this.mood = saved.mood; }
    this.gesture = null; this.lookYaw = 0;
    this.brainT = Math.random() * 0.3;
    this.closeT = 0; this.greetCd = 10 + Math.random() * 20; this.barkCd = 0;
    this.onRoad = false; this.inv = 0;
    this.beach = !!opts.beach;
    if (this.beach) { this.state = 'roam'; this.pickRoam(); }
    else { this.from = mgr.game.world.nearestNode(x, z); this.to = this.from; this.state = opts.fromCar ? 'confront' : 'walk'; }
    if (Math.random() < 0.15 && !opts.fromCar) { this.state = 'idle'; this.stateT = 4 + Math.random() * 8; this.gesture = Math.random() < 0.6 ? 'phone' : null; }
  }

  get name() { return `${this.profile.first} ${this.profile.last}`; }

  /** Learn a fact. Facts carry a source (saw / sound / heard / news / self) and only spread through people. */
  learn(f) {
    const ex = this.knowledge.find((k) => k.id === f.id);
    if (ex) {
      ex.confidence = Math.min(1, Math.max(ex.confidence, f.confidence) + 0.1);
      if (f.source === 'saw' && ex.source !== 'saw') { ex.source = 'saw'; ex.text = f.text; ex.from = null; }
      return false;
    }
    this.knowledge.push({ id: f.id, text: f.text, tags: f.tags || [], t: f.t ?? this.game.time, importance: f.importance ?? 0.4, confidence: f.confidence ?? 1, source: f.source || 'saw', from: f.from || null });
    if (this.knowledge.length > 40) { this.knowledge.sort((a, b) => b.importance - a.importance || b.t - a.t); this.knowledge.length = 40; }
    return true;
  }

  /** Something worth passing on that the other person doesn't know yet. */
  gossipFor(other) {
    const known = new Set(other.knowledge.map((k) => k.id));
    return this.knowledge.filter((k) => k.importance >= 0.35 && k.confidence > 0.35 && !known.has(k.id)).sort((a, b) => b.importance - a.importance)[0];
  }

  snapshot() {
    return { id: this.citizenId, profile: this.profile, look: this.look, home: this.home, relation: this.relation, mood: this.mood,
      memory: this.memory.slice(-12).map((m) => ({ type: m.type })), knowledge: this.knowledge.slice(0, 40) };
  }

  remember(type, weight) {
    this.memory.push({ type, t: this.game.time });
    if (this.memory.length > 12) this.memory.shift();
    this.relation = clamp(this.relation + weight, -3, 3);
  }

  say(text, kind = '', dur = 3, speakIt = false) {
    this.mgr.showBubble(this, text, kind, dur);
    if (speakIt) this.mgr.speak(text, this.profile);
  }

  bark(list, kind, chance = 1, toPlayer = false) {
    if (this.barkCd > 0 || Math.random() > chance) return;
    this.barkCd = 4 + Math.random() * 3;
    const d = this.pos.distanceTo(this.game.player.pos);
    this.say(pick(list), kind, 3, toPlayer && d < 14 && this.mgr.voiceBarkOk());
  }

  pickRoam() {
    this.roamTarget = new THREE.Vector2(this.pos.x + (Math.random() - 0.5) * 60, clamp(this.pos.z + (Math.random() - 0.5) * 30, SHORE_Z + 4, SHORE_Z + 58));
  }

  startFlee(from, secs) {
    if (this.state === 'down' || this.state === 'talk') return;
    this.state = 'flee'; this.stateT = secs; this.threat = from.clone ? from.clone() : new THREE.Vector3(from.x, 0, from.z);
    this.gesture = null;
  }

  /* ───────────── brain: perception + decisions (a few times a second) ───────────── */
  think() {
    const g = this.game, P = g.player;
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    this.fear = Math.max(0, this.fear - 0.03); this.anger = Math.max(0, this.anger - 0.02);
    this.mood = damp(this.mood, (this.profile.friendly - 0.5) * 0.8, 0.05, 1);
    if (this.state === 'down' || this.state === 'talk') return;

    const car = P.mode === 'car' ? P.vehicle : null;
    if (car && dist < 35 && car.speed() > 4 && (this.lastSawCar || -99) < g.time - 90) {
      this.lastSawCar = g.time;
      const fast = car.speed() > 16, veh = describeVehicle(car);
      this.learn({ id: 'saw-car:' + veh + ':' + Math.floor(g.time / 90), text: `${cap(veh)} ${fast ? 'sped' : 'drove'} past ${placeName(g.world, car.pos.x, car.pos.z).replace(/^on /, 'along ')}.`, tags: [veh, 'car', fast ? 'speeding' : 'driving'], importance: fast ? 0.4 : 0.25, confidence: 0.85, t: g.time, source: 'saw' });
    }
    if (car && dist < 14) {
      const sp = car.speed();
      const rx = this.pos.x - car.pos.x, rz = this.pos.z - car.pos.z;
      const closing = (car.vel.x * rx + car.vel.y * rz) / Math.max(sp, 0.01);
      const lat = Math.abs(car.vel.x * rz - car.vel.y * rx) / Math.max(sp, 0.01);
      if (sp > 7 && closing > 0 && closing < sp * 1.6 && lat < 3) {
        // near miss!
        if (!this.memory.some((e) => e.type === 'nearmiss' && g.time - e.t < 8)) this.remember('nearmiss', -0.25);
        this.fear = Math.min(1, this.fear + 0.5);
        if (this.profile.brave > 0.65 && this.fear < 0.8) { this.anger = Math.min(1, this.anger + 0.5); this.bark(BARKS.nearMiss, 'angry', 1, true); this.state = 'shake'; this.stateT = 2.5; }
        else { this.bark(BARKS.nearMissScared, 'scared', 0.8); this.startFlee(car.pos, 4 + Math.random() * 3); }
        return;
      }
      const carOnWalk = groundHeight(car.pos.x, car.pos.z) > 0.1 && car.pos.z < SHORE_Z;
      if (carOnWalk && sp > 2.5 && dist < 10) { this.bark(BARKS.sidewalk, 'angry', 0.6, true); this.fear += 0.3; this.startFlee(car.pos, 3); return; }
      if (sp < 3 && dist < 6 && car.type === 'sports' && this.greetCd <= 0 && this.profile.friendly > 0.5) { this.greetCd = 30; this.bark(BARKS.niceCar, '', 0.5, true); this.gesture = 'point'; this.lookAt = P.pos; }
    }
    if (!car && P.mode !== 'swim') {
      if (dist < 1.25 && this.state !== 'flee' && this.state !== 'confront') {
        this.closeT += 0.25;
        if (this.closeT > 2.2) { this.closeT = -6; this.bark(BARKS.personalSpace, this.profile.friendly < 0.4 ? 'angry' : '', 1, true); this.lookAt = P.pos; this.gesture = this.profile.friendly < 0.4 ? 'shrug' : null; }
      } else this.closeT = Math.max(0, this.closeT - 0.1);
      if (dist < 4.5 && this.greetCd <= 0 && (this.state === 'walk' || this.state === 'roam' || this.state === 'idle')) {
        this.greetCd = 25 + Math.random() * 30;
        if (this.relation > -0.3 && this.profile.friendly > 0.62 && Math.random() < 0.55) {
          const list = g.env.hours > 22 || g.env.hours < 5 ? BARKS.night : BARKS.greetFriendly;
          this.bark(list, '', 1, true); this.gestureT = 2; this.gesture = 'wave'; this.lookAt = P.pos;
        } else if (this.relation < -0.5) { this.bark(['Ugh, you again.', 'Stay away from me.', '…'], 'angry', 0.7); this.lookAt = P.pos; }
      }
      // spot the player and keep an eye on them if we fear/dislike them
      if (dist < 12 && (this.relation < -0.8 || this.fear > 0.5) && this.state === 'walk' && Math.random() < 0.3) this.lookAt = P.pos;
      if (dist < 8 && this.relation < -1.5 && this.profile.brave < 0.4 && this.state !== 'flee') this.startFlee(P.pos, 4);
    }
    // NPC to NPC small talk
    if ((this.state === 'walk' || this.state === 'roam') && this.profile.chatty > 0.55 && Math.random() < 0.05 && this.fear < 0.3) {
      for (const o of this.mgr.list) {
        if (o === this || (o.state !== 'walk' && o.state !== 'roam') || o.profile.chatty < 0.35) continue;
        if (o.pos.distanceToSquared(this.pos) < 9) { this.mgr.startChat(this, o); break; }
      }
    }
  }

  onEvent(type, d) {
    if (this.state === 'down') return;
    const dist = Math.hypot(d.x - this.pos.x, d.z - this.pos.z);
    this.perceive(type, d, dist);
    if (type === 'crash' && dist < 45 && d.speed > 7) {
      this.fear = Math.min(1, this.fear + 0.25);
      if (this.state === 'talk') return;
      if (dist < 6 && this.profile.brave < 0.5) { this.startFlee(new THREE.Vector3(d.x, 0, d.z), 3); return; }
      this.state = 'watch'; this.stateT = 3 + Math.random() * 4; this.lookAt = new THREE.Vector3(d.x, 0, d.z);
      this.gesture = Math.random() < 0.35 ? 'call' : null;
      this.bark(BARKS.crash, 'scared', 0.25);
    } else if (type === 'horn' && dist < 22 && !d.ai) {
      if (this.state === 'talk') return;
      this.anger = Math.min(1, this.anger + 0.15);
      this.lookAt = new THREE.Vector3(d.x, 0, d.z);
      if (this.onRoad || dist < 8) { this.bark(BARKS.horn, this.profile.friendly < 0.4 ? 'angry' : '', 0.6, true); if (this.profile.brave > 0.7 && Math.random() < 0.4) this.gestureFor('angry', 2); }
      if (this.onRoad) this.hurry = 1.8;
    } else if (type === 'npcHit' && d.npc !== this && dist < 35) {
      this.fear = Math.min(1, this.fear + 0.6);
      if (this.state === 'talk') return;
      this.bark(BARKS.witnessHit, 'scared', 0.5);
      if (this.profile.brave < 0.45) this.startFlee(this.game.player.pos, 6);
      else { this.state = 'watch'; this.stateT = 6; this.lookAt = d.npc.pos; this.gesture = 'call'; }
      if (d.byPlayer) this.remember('sawViolence', -0.4);
    } else if (type === 'carjack' && dist < 30) {
      this.fear = Math.min(1, this.fear + 0.4);
      if (this.state === 'talk') return;
      this.bark(BARKS.carjackWitness, 'scared', 0.6);
      this.remember('sawViolence', -0.3);
      if (this.profile.brave < 0.5) this.startFlee(this.game.player.pos, 5); else { this.state = 'watch'; this.stateT = 5; this.lookAt = this.game.player.pos; this.gesture = 'call'; }
    }
  }

  gestureFor(g, t) { this.gesture = g; this.gestureT = t; }

  /** Turn an event into knowledge, if this person could see or hear it, and maybe report it to the police. */
  perceive(type, d, dist) {
    const g = this.game, where = placeName(g.world, d.x, d.z), now = g.time;
    const sees = dist < 40, hears = dist < 70;
    const look = g.player.appearance;
    let fact = null, crime = null;
    if (type === 'crash' && d.speed > 5 && hears) {
      const veh = describeVehicle(d.vehicle);
      const id = 'crash:' + Math.round(d.x / 15) + ':' + Math.round(d.z / 15) + ':' + Math.floor(now / 20);
      fact = sees ? { id, text: `${cap(veh)} crashed ${where}.`, tags: [veh, 'crash', 'accident', 'car'], importance: 0.45 + Math.min(0.4, d.speed / 40), confidence: 0.95, source: 'saw' }
        : { id, text: `a loud crash ${where}`, tags: ['crash', 'noise', 'accident'], importance: 0.35, confidence: 0.6, source: 'sound' };
      if (sees && d.vehicle && d.vehicle.driver === 'player' && d.speed > 9) crime = { kind: 'reckless driving', stars: 1, text: `${veh} driving recklessly ${where}` };
    } else if (type === 'npcHit' && d.npc !== this && hears) {
      const veh = describeVehicle(d.vehicle);
      const id = 'hit:' + d.npc.citizenId;
      fact = sees ? { id, text: `${cap(veh)} hit ${d.npc.profile.female ? 'a woman' : 'a man'} ${where}.${d.byPlayer ? ` The driver was ${look}.` : ''}`, tags: [veh, 'hit', 'accident', 'pedestrian', 'injured'], importance: 0.9, confidence: 0.9, source: 'saw' }
        : { id, text: `someone screaming after a crash ${where}`, tags: ['scream', 'accident'], importance: 0.5, confidence: 0.5, source: 'sound' };
      if (sees && d.byPlayer) crime = { kind: 'hit and run', stars: 2, text: `${veh} hit a pedestrian ${where}` };
    } else if (type === 'carjack' && sees) {
      const veh = describeVehicle(d.vehicle);
      fact = { id: 'jack:' + Math.round(now), text: `Someone (${look}) pulled a driver out of ${veh} and drove off ${where}.`, tags: [veh, 'stolen', 'theft', 'carjack', 'car'], importance: 0.85, confidence: 0.9, source: 'saw' };
      crime = { kind: 'carjacking', stars: 2, text: `carjacking of ${veh} ${where}` };
    } else if (type === 'chase' && hears) {
      fact = { id: 'police:' + Math.floor(now / 30), text: `police chasing someone ${where}`, tags: ['police', 'chase', 'siren'], importance: 0.6, confidence: 0.8, source: sees ? 'saw' : 'sound' };
    }
    if (fact) this.learn({ ...fact, t: now });
    // whether they phone it in depends on who they are
    if (crime && !this.pendingReport && Math.random() < 0.35 + this.profile.brave * 0.3 + (1 - this.profile.friendly) * 0.1) {
      this.pendingReport = crime; this.reportT = 2 + Math.random() * 4;
    }
  }

  knock(vx, vz, byPlayer, vehicle) {
    if (this.inv > 0) return;
    this.inv = 1.5;
    if (this.state === 'talk') this.game.ui.close();
    this.state = 'down'; this.stateT = 4 + Math.random() * 3; this.landed = false;
    this.vel.set(vx * 0.75, 2.5 + Math.hypot(vx, vz) * 0.12, vz * 0.75);
    this.fear = 1; this.onRoad = false;
    if (byPlayer) { this.remember('hit', -1.4); this.mood = -0.8; }
    this.bark(BARKS.hit, 'scared', 1);
    this.barkCd = 0;
    this.injured = true;
    if (byPlayer) this.learn({ id: 'hit:' + this.citizenId, text: `${cap(describeVehicle(vehicle))} ran me over. The driver was ${this.game.player.appearance}.`, tags: ['hit', 'car', 'hurt', 'me'], importance: 1, confidence: 1, source: 'saw' });
    this.game.emit('npcHit', { x: this.pos.x, z: this.pos.z, npc: this, byPlayer, vehicle });
  }

  /* ───────────── movement + animation (every frame) ───────────── */
  update(dt, camDist) {
    const g = this.game;
    this.stateT -= dt; this.barkCd -= dt; this.greetCd -= dt; this.inv -= dt;
    this.brainT -= dt;
    if (this.brainT <= 0) { this.brainT = 0.25; this.think(); }
    if (this.pendingReport && this.state !== 'down') {
      if (!this.reportStarted) { this.reportStarted = true; this.gestureFor('call', 5); }
      this.reportT -= dt;
      if (this.reportT <= 0) {
        const r = this.pendingReport; this.pendingReport = null; this.reportStarted = false;
        this.say(`Police? I want to report a ${r.kind}. ${cap(r.text)}.`, 'scared', 4.5);
        g.police?.report(r, this);
        this.learn({ id: 'called:' + Math.floor(g.time), text: `I called the police about a ${r.kind}: ${r.text}.`, tags: ['police', 'called', r.kind], importance: 0.6, confidence: 1, source: 'self' });
      }
    }
    if (this.gestureT !== undefined) { this.gestureT -= dt; if (this.gestureT <= 0) { this.gestureT = undefined; if (this.state !== 'idle') this.gesture = null; } }
    let speed = 0, mode = 'idle';
    const world = g.world;

    switch (this.state) {
      case 'walk': {
        const n = world.nodes[this.to.id];
        const dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.5) { this.arrive(); break; }
        speed = this.walkSpeed * (this.hurry || 1);
        this.moveToward(dx / d, dz / d, speed, dt);
        mode = 'walk';
        break;
      }
      case 'waitCross': {
        const e = this.pendingEdge;
        const c = e.cross;
        const other = c.axis === 1 ? 0 : 1;
        if (lightState(c.ii, c.jj, c.axis, g.simTime) === 'r' && lightState(c.ii, c.jj, other, g.simTime) === 'g') {
          this.to = world.nodes[e.to]; this.onRoad = true; this.state = 'walk';
        } else if (this.stateT < -25) { this.state = 'walk'; this.to = world.nodes[this.from.id]; }
        this.faceToward(world.nodes[e.to].x - this.pos.x, world.nodes[e.to].z - this.pos.z, dt, 4);
        break;
      }
      case 'roam': {
        const t = this.roamTarget;
        const dx = t.x - this.pos.x, dz = t.y - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.8) { if (Math.random() < 0.4) { this.state = 'idleRoam'; this.stateT = 3 + Math.random() * 8; } this.pickRoam(); break; }
        speed = this.walkSpeed * 0.85; this.moveToward(dx / d, dz / d, speed, dt, true); mode = 'walk';
        break;
      }
      case 'idleRoam': if (this.stateT <= 0) this.state = 'roam'; break;
      case 'idle':
        if (this.stateT <= 0) { this.state = this.beach ? 'roam' : 'walk'; this.gesture = null; }
        break;
      case 'chat': {
        const o = this.partner;
        if (!o || o.state !== 'chat' || this.stateT <= 0) { this.endChat(); break; }
        this.faceToward(o.pos.x - this.pos.x, o.pos.z - this.pos.z, dt, 5);
        this.gesture = this.mgr.chatSpeaker(this) ? 'talk' : null;
        break;
      }
      case 'talk': {
        const P = g.player.pos;
        this.faceToward(P.x - this.pos.x, P.z - this.pos.z, dt, 6);
        if (this.pointAt && this.gesture === 'point') this.faceToward(this.pointAt.x - this.pos.x, this.pointAt.z - this.pos.z, dt, 6);
        break;
      }
      case 'watch': {
        if (this.lookAt) this.faceToward(this.lookAt.x - this.pos.x, this.lookAt.z - this.pos.z, dt, 4);
        if (this.stateT <= 0) this.returnToPath();
        break;
      }
      case 'shake': {
        const P = g.player.pos;
        this.faceToward(P.x - this.pos.x, P.z - this.pos.z, dt, 6);
        this.gesture = 'angry';
        if (this.stateT <= 0) { this.gesture = null; this.returnToPath(); }
        break;
      }
      case 'confront': {
        const P = g.player.pos;
        const dx = P.x - this.pos.x, dz = P.z - this.pos.z, d = Math.hypot(dx, dz);
        this.gesture = 'angry';
        if (d > 2 && d < 18 && g.player.mode !== 'swim') { speed = 2.2; this.moveToward(dx / d, dz / d, speed, dt, true); mode = 'walk'; }
        else this.faceToward(dx, dz, dt, 6);
        if (this.barkCd <= 0 && d < 6) this.bark(['You owe me a new car!', 'Get back here!', 'I got your plate number!', 'Unbelievable!'], 'angry', 1, true);
        if (this.stateT <= 0 || d > 25) { this.gesture = null; this.returnToPath(); }
        break;
      }
      case 'flee': {
        const t = this.threat;
        let dx = this.pos.x - t.x, dz = this.pos.z - t.z;
        const d = Math.hypot(dx, dz) || 1;
        speed = 5.2 + this.profile.brave * 0.8;
        if (this.profile.brave < 0.25 && d < 5 && this.stateT > 1.5) { mode = 'cower'; speed = 0; this.faceToward(-dx, -dz, dt, 5); break; }
        this.moveToward(dx / d, dz / d, speed, dt, true);
        mode = 'walk';
        if (this.stateT <= 0) this.returnToPath();
        break;
      }
      case 'return': {
        const n = this.to;
        const dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.6) { this.state = 'walk'; this.from = n; this.arrive(); break; }
        speed = this.walkSpeed; this.moveToward(dx / d, dz / d, speed, dt, true); mode = 'walk';
        break;
      }
      case 'down': {
        mode = 'down';
        if (!this.landed) {
          this.vel.y -= 9.8 * dt;
          this.pos.addScaledVector(this.vel, dt);
          const gh = groundHeight(this.pos.x, this.pos.z);
          const r = world.colliders.resolve(this.pos.x, this.pos.z, 0.3, this.pos.y + 0.3);
          if (r.hit) { this.pos.x = r.x; this.pos.z = r.z; this.vel.x *= -0.3; this.vel.z *= -0.3; }
          if (this.pos.y <= gh) { this.pos.y = gh; this.vel.multiplyScalar(0.4); if (Math.abs(this.vel.y) < 1.5) this.landed = true; this.vel.y = Math.abs(this.vel.y) * 0.3; }
        }
        if (this.stateT <= 0) {
          // get up, then decide how to react
          this.landed = false; this.vel.set(0, 0, 0);
          const P = g.player;
          if (this.profile.brave > 0.55 && P.pos.distanceTo(this.pos) < 20) { this.state = 'confront'; this.stateT = 6; this.anger = 1; }
          else this.startFlee(P.pos, 6);
        }
        break;
      }
    }
    // gentle separation so crowds don't overlap
    if (this.state !== 'down') {
      for (const o of this.mgr.list) {
        if (o === this || o.state === 'down') continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 0.36 && d2 > 1e-6) { const d = Math.sqrt(d2), k = (0.6 - d) * 0.5; this.pos.x += (dx / d) * k; this.pos.z += (dz / d) * k; }
      }
      const P = g.player;
      if (P.mode === 'foot') {
        const dx = this.pos.x - P.pos.x, dz = this.pos.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.65 && d > 1e-4) {
          const k = 0.65 - d; this.pos.x += (dx / d) * k; this.pos.z += (dz / d) * k;
          if (P.speed > 5 && this.state !== 'talk') { this.bark(BARKS.bumped, 'angry', 1, true); this.remember('bumped', -0.15); this.anger += 0.3; this.lookAt = P.pos; }
        }
      }
      if (this.state !== 'down') this.pos.y = damp(this.pos.y, groundHeight(this.pos.x, this.pos.z), 12, dt);
    }

    // head tracking
    let lookYaw = 0;
    if (this.lookAt && this.state !== 'flee') {
      const a = Math.atan2(this.lookAt.x - this.pos.x, this.lookAt.z - this.pos.z);
      lookYaw = clamp(angleDiff(this.heading, a), -1.2, 1.2);
      if (Math.random() < dt * 0.15) this.lookAt = null;
    }
    // animate (skip when far away)
    const h = this.human;
    h.root.position.copy(this.pos);
    h.root.rotation.y = this.heading;
    const vis = camDist < 170 && !this.inCab;
    h.root.visible = vis;
    if (vis && camDist < 90) h.update(dt * (camDist > 45 ? 1 : 1), { mode, speed, gesture: this.gesture, lookYaw });
    else if (vis) { h.t += dt; }
    if (camDist > 45 !== this.farShadow) { this.farShadow = camDist > 45; h.root.traverse((o) => { if (o.isMesh) o.castShadow = !this.farShadow; }); }
  }

  moveToward(dx, dz, speed, dt, collide = false) {
    this.faceToward(dx, dz, dt, 8);
    const a = Math.min(1, Math.abs(angleDiff(this.heading, Math.atan2(dx, dz))) < 1.2 ? 1 : 0.3);
    this.pos.x += dx * speed * a * dt; this.pos.z += dz * speed * a * dt;
    if (collide) {
      const r = this.game.world.colliders.resolve(this.pos.x, this.pos.z, 0.3, this.pos.y + 0.5);
      this.pos.x = r.x; this.pos.z = r.z;
      // never walk into the sea
      if (this.pos.z > SHORE_Z && seabedHeight(this.pos.x, this.pos.z) < WATER_LEVEL + 0.3) { this.pos.z -= dz * speed * dt * 2; if (this.beach) this.pickRoam(); }
    }
  }
  faceToward(dx, dz, dt, rate) {
    if (dx * dx + dz * dz < 1e-6) return;
    const a = Math.atan2(dx, dz);
    this.heading += angleDiff(this.heading, a) * Math.min(1, rate * dt);
  }

  arrive() {
    this.onRoad = false; this.hurry = 1;
    this.from = this.to;
    const n = this.game.world.nodes[this.from.id];
    if (Math.random() < 0.05) { this.state = 'idle'; this.stateT = 3 + Math.random() * 7; this.gesture = Math.random() < 0.5 ? 'phone' : null; }
    const opts = n.edges.filter((e) => e.to !== this.prevId);
    const e = pick(opts.length ? opts : n.edges);
    this.prevId = n.id;
    if (e.cross) { this.pendingEdge = e; if (this.state !== 'idle') { this.state = 'waitCross'; this.stateT = 0; } else this.to = n; }
    else this.to = this.game.world.nodes[e.to];
  }

  returnToPath() {
    this.onRoad = false; this.gesture = null;
    if (this.beach) { this.state = 'roam'; this.pickRoam(); return; }
    this.to = this.game.world.nearestNode(this.pos.x, this.pos.z);
    this.state = 'return';
  }

  endChat() {
    if (this.partner && this.partner.partner === this) { this.partner.partner = null; if (this.partner.state === 'chat') this.partner.returnToPath(); }
    this.partner = null; this.gesture = null;
    if (this.state === 'chat') this.returnToPath();
  }

  dispose() {
    this.game.scene.remove(this.human.root);
    if (this.bubble) this.bubble.el.remove();
  }
}

export class NPCManager {
  constructor(game) {
    this.game = game; this.list = []; this.max = 30;
    this.container = document.getElementById('bubbles');
    this.freeBubbles = [];
    this.chats = [];
    this.registry = new Map(); // citizens who have history with the player, persisted in the save
    this.lastSpeak = 0;
    this.voice = true;
    this.spawnT = 0;
  }

  spawnAt(x, z, opts) {
    const n = new NPC(this, x, z, opts);
    this.list.push(n);
    return n;
  }

  /** Keep anyone worth remembering (they know the player or know something) for later. */
  retire(n) {
    if (n.relation !== 0 || n.memory.length || n.knowledge.some((k) => k.importance >= 0.5)) {
      this.registry.set(n.citizenId, n.snapshot());
      if (this.registry.size > 80) {
        const weakest = [...this.registry.values()].sort((a, b) => Math.abs(a.relation) - Math.abs(b.relation))[0];
        this.registry.delete(weakest.id);
      }
    }
  }
  /** A returning citizen whose home is near (x,z), if any. */
  returning(x, z) {
    const active = new Set(this.list.map((n) => n.citizenId));
    for (const c of this.registry.values()) if (!active.has(c.id) && Math.hypot(c.home.x - x, c.home.z - z) < 160 && Math.random() < 0.5) return c;
    return null;
  }

  spawnRandom() {
    const P = this.game.player.pos;
    const nearBeach = P.z > 600;
    if (nearBeach && Math.random() < 0.45) {
      const x = P.x + (Math.random() - 0.5) * 200, z = SHORE_Z + 6 + Math.random() * 45;
      if (Math.hypot(x - P.x, z - P.z) > 35) this.spawnAt(x, z, { beach: true });
      return;
    }
    const nodes = this.game.world.nodes;
    for (let k = 0; k < 10; k++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      const d = Math.hypot(n.x - P.x, n.z - P.z);
      if (d < 35 || d > 150) continue;
      const nb = this.game.world.nodes[pick(n.edges).to];
      const t = Math.random();
      const x = n.x + (nb.x - n.x) * t * 0.9, z = n.z + (nb.z - n.z) * t * 0.9;
      const back = this.returning(x, z);
      this.spawnAt(x, z, back ? { saved: back } : {}).to = nb;
      return;
    }
  }

  startChat(a, b) {
    a.state = b.state = 'chat'; a.partner = b; b.partner = a;
    a.stateT = b.stateT = 8 + Math.random() * 6;
    let [sp, ls] = Math.random() < 0.5 ? [a, b] : [b, a];
    let fact = sp.gossipFor(ls);
    if (!fact) { [sp, ls] = [ls, sp]; fact = sp.gossipFor(ls); }
    if (fact) {
      const react = fact.importance > 0.7 ? 'Seriously? That\'s awful.' : pick(['No way! When?', 'Huh, I had no idea.', 'Wow. This city, I swear.']);
      this.chats.push({ a: sp, b: ls, lines: ['Did you hear? ' + tellFact(fact, this.game.time), react], i: 0, t: 0.6, fact });
      return;
    }
    const topic = pick(BARKS.chat);
    this.chats.push({ a, b, lines: topic, i: 0, t: 0.6 });
  }
  chatSpeaker(npc) { const c = this.chats.find((c) => c.a === npc || c.b === npc); return c && c.t > 0.3 && ((c.i % 2 === 1) === (c.a === npc)); }

  onEvent(type, d) { for (const n of this.list) n.onEvent(type, d); }

  update(dt) {
    const g = this.game;
    const target = Math.round(this.max * (g.env.hours > 1 && g.env.hours < 6 ? 0.35 : 1));
    this.spawnT -= dt;
    if (this.list.length < target && this.spawnT <= 0) { this.spawnT = 0.12; this.spawnRandom(); }
    const P = g.player.pos, cam = g.camera.position;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const n = this.list[k];
      const d = Math.hypot(n.pos.x - P.x, n.pos.z - P.z);
      if ((d > 220 || (this.list.length > target + 4 && d > 120)) && n.state !== 'talk' && !n.keep) { this.retire(n); n.dispose(); this.list.splice(k, 1); continue; }
      n.update(dt, n.pos.distanceTo(cam));
    }
    // conversations between NPCs
    for (let k = this.chats.length - 1; k >= 0; k--) {
      const c = this.chats[k];
      if (c.a.state !== 'chat' || c.b.state !== 'chat') { this.chats.splice(k, 1); continue; }
      c.t -= dt;
      if (c.t <= 0) {
        if (c.i < c.lines.length) {
          const sp = c.i % 2 === 0 ? c.a : c.b; sp.say(c.lines[c.i], '', 3.8); c.i++; c.t = 4;
          if (c.fact && c.i === 1) c.b.learn({ ...c.fact, source: 'heard', from: c.a.profile.first, confidence: c.fact.confidence * 0.75, importance: c.fact.importance * 0.9 });
        }
        else { c.a.stateT = 0; this.chats.splice(k, 1); }
      }
    }
    // vehicles knocking pedestrians over
    const vehicles = [];
    if (g.player.mode === 'car') vehicles.push(g.player.vehicle);
    for (const c of g.traffic.cars) if (c.v !== g.player.vehicle && (c.mode === 'dynamic' || c.v.speed() > 6)) vehicles.push(c.v);
    for (const v of vehicles) {
      const sp = v.speed();
      if (sp < 2.5) continue;
      const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
      for (const n of this.list) {
        if (n.state === 'down' || n.inv > 0) continue;
        const dx = n.pos.x - v.pos.x, dz = n.pos.z - v.pos.z;
        if (dx * dx + dz * dz > 16) continue;
        const lx = dx * ch - dz * sh, lz = dx * sh + dz * ch;
        if (Math.abs(lx) < v.spec.wid / 2 + 0.3 && Math.abs(lz) < v.spec.len / 2 + 0.3) {
          n.knock(v.vel.x, v.vel.y, v.driver === 'player', v);
          v.vel.multiplyScalar(0.93);
          if (v.driver === 'player') { g.shake = 0.3; g.audio.crash(0.25); }
        }
      }
    }
    this.updateBubbles(dt);
  }

  /* ───────────── speech bubbles + voices ───────────── */
  showBubble(npc, text, kind, dur) {
    if (npc.bubble) { npc.bubble.el.remove(); }
    const el = document.createElement('div');
    el.className = 'bubble ' + (kind || '');
    el.textContent = text;
    this.container.appendChild(el);
    npc.bubble = { el, t: dur };
  }
  bubbleAt(pos, text, kind, dur) {
    const fake = { pos: pos.clone(), bubble: null, isFake: true, human: null };
    this.showBubble(fake, text, kind, dur);
    this.freeBubbles.push(fake);
  }
  updateBubbles(dt) {
    const cam = this.game.camera;
    const W = innerWidth, H = innerHeight;
    const place = (owner, y) => {
      const b = owner.bubble; if (!b) return;
      b.t -= dt;
      if (b.t <= 0) { b.el.remove(); owner.bubble = null; return; }
      tmpV.set(owner.pos.x, owner.pos.y + y, owner.pos.z);
      const d = tmpV.distanceTo(cam.position);
      tmpV.project(cam);
      if (tmpV.z > 1 || d > 45) { b.el.style.display = 'none'; return; }
      b.el.style.display = '';
      b.el.style.left = ((tmpV.x * 0.5 + 0.5) * W).toFixed(1) + 'px';
      b.el.style.top = ((-tmpV.y * 0.5 + 0.5) * H).toFixed(1) + 'px';
      b.el.style.opacity = Math.min(1, b.t * 2, 1.4 - d / 45).toFixed(2);
    };
    for (const n of this.list) place(n, n.state === 'down' ? 0.8 : 2.05);
    for (let k = this.freeBubbles.length - 1; k >= 0; k--) { const f = this.freeBubbles[k]; place(f, 2.4); if (!f.bubble) this.freeBubbles.splice(k, 1); }
  }
  voiceBarkOk() { return this.voice && performance.now() - this.lastSpeak > 3500; }
  speak(text, profile) {
    if (!this.voice || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
      if (voices.length) {
        const fem = voices.filter((v) => /female|samantha|victoria|karen|moira|tessa|zira|susan|serena|fiona|aria|jenny/i.test(v.name));
        const mal = voices.filter((v) => /male|daniel|alex|fred|george|david|mark|guy|ryan|tom/i.test(v.name) && !/female/i.test(v.name));
        const pool = profile.female ? (fem.length ? fem : voices) : (mal.length ? mal : voices);
        u.voice = pool[(profile.first.charCodeAt(0) + profile.last.length) % pool.length];
      }
      u.pitch = profile.voicePitch; u.rate = 1.0 + (profile.chatty - 0.5) * 0.2; u.volume = 0.9;
      speechSynthesis.speak(u);
      this.lastSpeak = performance.now();
    } catch (e) { /* speech not available */ }
  }

  nearestTalkable(pos, maxD = 2.6) {
    let best = null, bd = maxD;
    for (const n of this.list) {
      if (n.state === 'down' || n.state === 'flee') continue;
      const d = n.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
