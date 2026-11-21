// Missions built on the game's systems: driving, citizens' grounded knowledge, police and diving.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { GRID, roadCoord, blockCenter, BLOCK_HALF } from './world.js';
import { placeName, describeVehicle, directions } from './knowledge.js';
import { compass } from './util.js';
import { pick } from './util.js';

const rnd = (a, b) => a + Math.random() * (b - a);
/** A sidewalk point roughly `dist` metres from (x,z). */
function sidewalkNear(x, z, minD, maxD) {
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(Math.random() * GRID), j = Math.floor(Math.random() * (GRID - 1));
    const cx = blockCenter(i), cz = blockCenter(j);
    const side = Math.floor(Math.random() * 4);
    const px = cx + (side === 0 ? BLOCK_HALF - 2 : side === 1 ? -BLOCK_HALF + 2 : rnd(-30, 30));
    const pz = cz + (side === 2 ? BLOCK_HALF - 2 : side === 3 ? -BLOCK_HALF + 2 : rnd(-30, 30));
    const d = Math.hypot(px - x, pz - z);
    if (d >= minD && d <= maxD) return new THREE.Vector3(px, 0.15, pz);
  }
  return new THREE.Vector3(x + minD, 0.15, z);
}
/** A kerbside parking spot (outer lane) near (x,z). */
function kerbNear(x, z) {
  const i = Math.round((x + 800) / 100), j = Math.max(0, Math.min(GRID - 1, Math.floor((z + 800) / 100)));
  return { x: roadCoord(Math.max(0, Math.min(GRID, i))) - 5.5, z: z, h: 0 };
}

export const MISSION_DEFS = [
  {
    id: 'delivery', title: 'Rush Delivery', giver: 'Lena Park (Corner Bean)', reward: 400, repeatable: true,
    brief: 'Our coffee machine part is waiting at the gas station. Grab it and bring it to the café, fast. Don\'t smash it up!',
    setup(m, g) {
      const P = g.player.pos;
      const gas = [...g.world.gasStations].sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
      m.pickup = new THREE.Vector3(gas.x, 0, gas.z);
      m.drop = sidewalkNear(gas.x, gas.z, 450, 800);
      m.dropName = placeName(g.world, m.drop.x, m.drop.z);
    },
    steps: [
      { text: (m) => 'Get a car and drive to the gas station to pick up the package.', target: (m) => m.pickup, check: (m, g) => g.player.mode === 'car' && g.player.vehicle.pos.distanceTo(m.pickup) < 12 && g.player.vehicle.speed() < 2,
        done: (m, g) => { m.timer = 160; m.health0 = g.player.vehicle.health; g.notify('Package loaded. Clock is ticking!'); } },
      { text: (m) => `Deliver the package ${m.dropName}.`, target: (m) => m.drop, timed: true,
        check: (m, g) => g.player.mode === 'car' && g.player.vehicle.pos.distanceTo(m.drop) < 12 && g.player.vehicle.speed() < 2,
        done: (m, g) => { const dmg = Math.max(0, m.health0 - g.player.vehicle.health); m.rewardOverride = Math.max(100, Math.round(400 + m.timer * 2 - dmg * 6)); } },
    ],
  },
  {
    id: 'hitrun', title: 'The Green Van', giver: 'Detective Rosa Alvarez', reward: 700,
    brief: 'A van hit a cyclist and drove off. Our officers are stretched thin. Talk to the people at the scene, find out what they saw, and track that van down.',
    setup(m, g) {
      const P = g.player.pos;
      m.scene = sidewalkNear(P.x, P.z, 200, 380);
      m.where = placeName(g.world, m.scene.x, m.scene.z);
      const dirAng = Math.random() * Math.PI * 2;
      m.van = null;
      m.vanPos = sidewalkNear(m.scene.x + Math.sin(dirAng) * 260, m.scene.z + Math.cos(dirAng) * 260, 0, 120);
      m.dir = compass(m.vanPos.x - m.scene.x, m.vanPos.z - m.scene.z);
      m.paint = pick(['#2f4f3f', '#3f7d4f']);
      m.fact = { id: 'mission:hitrun', text: `A green delivery van hit a cyclist ${m.where} and sped off ${m.dir}.`, tags: ['green', 'van', 'hit', 'cyclist', 'accident', 'crash', 'driver', 'saw', 'happened'], importance: 0.95, confidence: 0.9, source: 'saw', t: g.time };
    },
    steps: [
      { text: (m) => `Go to the scene of the hit and run ${m.where}.`, target: (m) => m.scene, check: (m, g) => g.player.pos.distanceTo(m.scene) < 35,
        done: (m, g) => {
          // witnesses: only these people saw it. Everyone else genuinely doesn't know.
          m.witnesses = [];
          for (let k = 0; k < 3; k++) {
            const n = g.npcs.spawnAt(m.scene.x + rnd(-10, 10), m.scene.z + rnd(-10, 10));
            n.learn(m.fact); n.state = 'idle'; n.stateT = 400; n.gesture = 'phone'; n.keep = true;
            m.witnesses.push(n);
          }
          g.notify('Witnesses are standing around. Press E to talk, then ask what they saw.');
        } },
      { text: () => 'Ask the witnesses what happened (press E and type your question).', target: (m) => m.scene, check: (m) => m.cited },
      { text: (m) => `Find the green van. Witnesses say it went ${m.dir}.`, target: (m) => m.vanPos, radius: 70,
        enter: (m, g) => { const v = new Vehicle(g, 'van', m.paint); v.place(m.vanPos.x, m.vanPos.z, Math.random() * 6); v.health = 55; v.frontBroken = true; v.keep = true; g.parked.push(v); m.van = v; },
        check: (m, g) => m.van && g.player.pos.distanceTo(m.van.pos) < 9 },
      { text: () => 'You found it: front end smashed. Wait while you phone it in to the detective.', target: (m) => m.van.pos, enter: (m) => { m.wait = 4; }, check: (m, g, dt) => (m.wait -= dt) <= 0 },
    ],
    cleanup(m, g) { for (const n of m.witnesses || []) n.keep = false; },
  },
  {
    id: 'fare', title: 'Night Fare', giver: 'Harbor Cabs dispatch', reward: 250, repeatable: true,
    brief: 'We\'re short of drivers tonight. Pick up a customer and get them where they\'re going. Tips depend on how you drive.',
    setup(m, g) {
      const P = g.player.pos;
      m.pickup = sidewalkNear(P.x, P.z, 120, 260);
      const poi = pick(g.world.pois.filter((p) => Math.hypot(p.x - m.pickup.x, p.z - m.pickup.z) > 350));
      m.dest = new THREE.Vector3(poi.x, 0, poi.z);
      m.destName = poi.name;
      m.tip = 120; m.complained = 0;
    },
    steps: [
      { text: () => 'Get a car and pick up the customer (stop next to them).', target: (m) => m.pickup,
        enter: (m, g) => { m.passenger = g.npcs.spawnAt(m.pickup.x, m.pickup.z); m.passenger.state = 'idle'; m.passenger.stateT = 9999; m.passenger.gesture = 'wave'; m.passenger.keep = true; },
        check: (m, g) => g.player.mode === 'car' && g.player.vehicle.pos.distanceTo(m.pickup) < 10 && g.player.vehicle.speed() < 1.5,
        done: (m, g) => {
          const n = m.passenger; m.name = n.profile.first; n.human.root.visible = false; n.state = 'idle'; n.inCab = true;
          g.notify(`${m.name}: "${m.destName}, please."`); m.health0 = g.player.vehicle.health; m.timer = 200;
        } },
      { text: (m) => `Drive ${m.name} to ${m.destName}. Smooth driving = bigger tip.`, target: (m) => m.dest, timed: true,
        tick: (m, g, dt) => {
          const v = g.player.vehicle; if (!v) return;
          if (m.passenger) m.passenger.pos.copy(v.pos);
          if (v.health < m.health0 - 2) { m.health0 = v.health; m.tip -= 50; g.notify(`${m.name}: "Hey! Are you trying to kill me?!"`); }
          if (v.speed() > 27 && (m.complained -= dt) <= 0) { m.complained = 12; m.tip -= 15; g.notify(`${m.name}: "Slow down, please! I'd like to arrive alive."`); }
        },
        check: (m, g) => g.player.mode === 'car' && g.player.vehicle.pos.distanceTo(m.dest) < 25 && g.player.vehicle.speed() < 2,
        done: (m, g) => {
          const tip = Math.max(0, Math.round(m.tip));
          m.rewardOverride = 250 + tip;
          g.notify(`${m.name}: "${tip > 80 ? 'Great ride, thanks! Keep the change.' : tip > 0 ? 'Thanks, I guess.' : 'Never again.'}"`);
          const n = m.passenger; n.human.root.visible = true; n.inCab = false; n.pos.set(m.dest.x + 4, 0.15, m.dest.z); n.stateT = 0; n.keep = false;
          n.remember(tip > 80 ? 'goodRide' : 'badRide', tip > 80 ? 0.6 : -0.4);
        } },
    ],
    cleanup(m) { if (m.passenger) { m.passenger.human.root.visible = true; m.passenger.inCab = false; m.passenger.keep = false; } },
  },
  {
    id: 'dive', title: 'Deep Blue', giver: 'Marine biologist Dr. Okafor', reward: 600,
    brief: 'My sensors picked up the old cargo wreck south-west of the pier. Dive down and recover two of the lost chests. Watch your air!',
    setup(m, g) { m.wreck = g.underwater.wreckPos.clone(); m.start = g.underwater.found; },
    steps: [
      { text: () => 'Swim out to the shipwreck, south-west of the pier, and dive.', target: (m) => m.wreck, radius: 40, check: (m, g) => g.player.mode === 'swim' && g.player.pos.distanceTo(m.wreck) < 70 },
      { text: (m, g) => `Recover treasure chests (${g.underwater.found - m.start}/2). Press E next to a chest.`, target: (m) => m.wreck, radius: 50, check: (m, g) => g.underwater.found - m.start >= 2 },
    ],
  },
  {
    id: 'heat', title: 'Hot Pursuit', giver: 'An unknown number', reward: 1200,
    brief: 'Pick up a "package" by the old warehouse at the east edge of town. Don\'t ask questions. Then lose whoever follows you.',
    setup(m, g) { m.spot = new THREE.Vector3(805, 0, -300 + Math.random() * 400); },
    steps: [
      { text: () => 'Drive to the warehouse at the east edge of the city.', target: (m) => m.spot, check: (m, g) => g.player.pos.distanceTo(m.spot) < 15,
        done: (m, g) => { g.police.report({ kind: 'drug deal', stars: 3, text: `a suspicious handover ${placeName(g.world, m.spot.x, m.spot.z)}` }, { profile: { first: 'An', last: 'undercover officer' } }); g.notify('It was a setup! Lose the police.'); } },
      { text: (m, g) => `Lose the police (${'★'.repeat(g.police.stars) || 'almost clear'}). Stay out of their sight.`, check: (m, g) => g.police.stars === 0 },
    ],
    failIfBusted: true,
  },
  {
    id: 'collect', title: 'Debt Collector', giver: 'Grace Bennett (Saltwater Grill)', reward: 350,
    brief: 'Someone ran up a $300 tab at my grill and vanished. Find someone who knows where they hang out. Be polite, people remember rudeness.',
    setup(m, g) {
      const P = g.player.pos;
      m.spot = sidewalkNear(P.x, P.z, 250, 500);
      m.where = placeName(g.world, m.spot.x, m.spot.z);
      m.fact = { id: 'mission:debtor', text: `The guy who owes Grace money hangs around ${m.where} most afternoons.`, tags: ['grace', 'owe', 'money', 'debt', 'tab', 'guy', 'hang', 'where', 'saltwater', 'grill'], importance: 0.8, confidence: 0.8, source: 'heard', from: 'a regular' };
      m.informant = null;
    },
    steps: [
      { text: () => 'Ask around about Grace\'s missing customer. Talk to people near you (try "who owes Grace money?").',
        enter: (m, g) => {
          // only one nearby person knows
          const n = g.npcs.spawnAt(g.player.pos.x + 25, g.player.pos.z + 10);
          n.learn(m.fact); n.keep = true; m.informant = n;
        },
        target: (m) => m.informant?.pos, check: (m) => m.cited },
      { text: (m) => `Go ${m.where} and find the debtor.`, target: (m) => m.spot,
        enter: (m, g) => { m.debtor = g.npcs.spawnAt(m.spot.x, m.spot.z); m.debtor.state = 'idle'; m.debtor.stateT = 9999; m.debtor.gesture = 'phone'; m.debtor.keep = true; },
        check: (m, g) => g.player.pos.distanceTo(m.debtor.pos) < 3,
        done: (m, g) => { m.debtor.say('Grace sent you? Ugh... fine, here. Tell her I\'m sorry.', '', 5); m.debtor.keep = false; } },
    ],
    cleanup(m) { if (m.informant) m.informant.keep = false; if (m.debtor) m.debtor.keep = false; },
  },
];

export class Missions {
  constructor(game) {
    this.game = game; this.active = null; this.completed = new Set();
    const beamGeo = new THREE.CylinderGeometry(2.5, 2.5, 140, 24, 1, true); beamGeo.translate(0, 70, 0);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.5, 0.2), transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.beam.visible = false; this.beam.renderOrder = 6;
    game.scene.add(this.beam);
  }
  available() { return MISSION_DEFS.filter((d) => d.repeatable || !this.completed.has(d.id)); }
  start(id) {
    const g = this.game;
    if (this.active) this.fail('Mission abandoned.');
    const def = MISSION_DEFS.find((d) => d.id === id);
    const m = { def, step: 0, timer: 0, startTime: g.time };
    def.setup(m, g);
    this.active = m;
    this.enterStep();
    g.notify(`MISSION: ${def.title}. ${def.brief}`);
    g.audio.chime();
  }
  enterStep() { const m = this.active, s = m.def.steps[m.step]; s.enter?.(m, this.game); }
  onCited(ids) { if (this.active && ids.some((id) => id.startsWith('mission:'))) this.active.cited = true; }
  objective() {
    const m = this.active; if (!m) return null;
    const s = m.def.steps[m.step];
    const t = s.target?.(m, this.game);
    return { text: s.text(m, this.game), target: t, radius: s.radius || 0, timer: s.timed ? m.timer : null, title: m.def.title };
  }
  update(dt) {
    const g = this.game, m = this.active;
    if (!m) { this.beam.visible = false; return; }
    const s = m.def.steps[m.step];
    s.tick?.(m, g, dt);
    if (s.timed) { m.timer -= dt; if (m.timer <= 0) return this.fail('Out of time.'); }
    if (m.def.failIfBusted && g.lastBust && g.lastBust > m.startTime) return this.fail('You were arrested.');
    const t = s.target?.(m, g);
    this.beam.visible = !!t && !g.env.underwater;
    if (t) { this.beam.position.set(t.x, 0, t.z); this.beam.scale.set(s.radius ? s.radius / 2.5 : 1, 1, s.radius ? s.radius / 2.5 : 1); }
    if (s.check(m, g, dt)) {
      s.done?.(m, g);
      m.step++;
      if (m.step >= m.def.steps.length) return this.complete();
      this.enterStep();
      g.audio.tick();
    }
  }
  complete() {
    const g = this.game, m = this.active;
    const reward = m.rewardOverride ?? m.def.reward;
    g.player.money += reward;
    this.completed.add(m.def.id);
    m.def.cleanup?.(m, g);
    this.active = null; this.beam.visible = false;
    g.audio.chime();
    g.notify(`MISSION COMPLETE: ${m.def.title}. +$${reward}`);
    g.phone?.refresh();
    g.save?.();
  }
  fail(reason) {
    const g = this.game, m = this.active; if (!m) return;
    m.def.cleanup?.(m, g);
    this.active = null; this.beam.visible = false;
    g.notify(`MISSION FAILED: ${m.def.title}. ${reason}`);
  }
}
