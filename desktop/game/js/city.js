// Weather, the news feed, and emergent city events (accidents, power cuts, festivals, storms).
import * as THREE from 'three';
import { placeName, describeVehicle } from './knowledge.js';
import { pick } from './util.js';

export class Weather {
  constructor(game) {
    this.game = game; this.rain = 0; this.target = 0; this.changeT = 240;
    const n = 6000, pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 80, y = Math.random() * 40, z = (Math.random() - 0.5) * 80;
      pos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.drops = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab6c4, transparent: true, opacity: 0, depthWrite: false }));
    this.drops.frustumCulled = false;
    game.scene.add(this.drops);
    this.fall = 0;
  }
  setTarget(r) { this.target = r; this.changeT = 300 + Math.random() * 400; }
  update(dt) {
    const g = this.game;
    this.changeT -= dt;
    if (this.changeT <= 0) {
      const storm = Math.random() < 0.3;
      this.setTarget(storm ? 0.6 + Math.random() * 0.4 : 0);
      if (storm) g.news.publish('Weather service: heavy rain moving over Harbor City. Drive carefully, roads will be slippery.', ['rain', 'storm', 'weather'], 0.45);
    }
    this.rain += Math.sign(this.target - this.rain) * Math.min(Math.abs(this.target - this.rain), dt / 25);
    const under = g.env.underwater;
    this.drops.visible = this.rain > 0.02 && !under;
    this.drops.material.opacity = this.rain * (0.55 - g.env.night * 0.3);
    this.drops.material.color.setScalar(0.75 - g.env.night * 0.5);
    g.env.starMat.opacity *= 1 - Math.min(1, this.rain * 1.5);
    g.env.moon.visible = g.env.moon.visible && this.rain < 0.4;
    if (this.drops.visible) {
      // drops fall in a box that follows the camera
      this.fall = (this.fall + dt * 32) % 40;
      const c = g.camera.position;
      this.drops.position.set(Math.floor(c.x / 4) * 4, c.y - 15 - this.fall + 20, Math.floor(c.z / 4) * 4);
    }
    // wet road: darker, shinier
    const m = g.world.roadMat;
    m.roughness = 0.9 - this.rain * 0.62;
    m.color.setScalar(0.72 - this.rain * 0.25);
    g.audio.setRain?.(under ? 0 : this.rain);
  }
}

export class News {
  constructor(game) { this.game = game; this.items = []; }
  /** Publish a story. Citizens who check their phones may learn it (source: news). */
  publish(text, tags = [], importance = 0.5) {
    const g = this.game;
    const item = { id: 'news:' + Math.floor(g.time) + ':' + this.items.length, text, tags, t: g.time, clock: g.env.timeString() };
    this.items.unshift(item);
    if (this.items.length > 30) this.items.pop();
    for (const n of g.npcs.list) if (Math.random() < 0.55) n.learn({ id: item.id, text, tags, importance: importance * 0.8, confidence: 0.85, source: 'news' });
    g.notify('📰 ' + text.slice(0, 110) + (text.length > 110 ? '…' : ''));
    g.phone?.refresh();
  }
}

/** Emergent events that propagate through traffic, witnesses, emergency services and the news. */
export class CityEvents {
  constructor(game) { this.game = game; this.t = 120 + Math.random() * 120; this.outage = null; this.festival = null; }
  update(dt) {
    const g = this.game;
    this.t -= dt;
    if (this.t <= 0) { this.t = 150 + Math.random() * 200; this.trigger(); }
    if (this.outage && (this.outage.t -= dt) <= 0) {
      g.shared.uOutage.value.set(0, 0, 0);
      g.news.publish(`Power has been restored ${this.outage.where}.`, ['power', 'outage'], 0.3);
      this.outage = null;
    }
    if (this.festival && (this.festival.t -= dt) <= 0) this.festival = null;
  }
  trigger(kind) {
    const g = this.game;
    kind = kind || pick(['accident', 'accident', 'outage', 'festival', 'dispute']);
    if (kind === 'accident') {
      // two cars collide somewhere the player isn't: traffic piles up behind them, people react
      const cars = g.traffic.cars.filter((c) => c.mode === 'drive' && c.v.pos.distanceTo(g.player.pos) > 60);
      const c = pick(cars);
      if (!c) return;
      g.traffic.knock(c);
      c.v.health = 25 + Math.random() * 20; c.v.hazard = true;
      c.v.vel.set(Math.sin(c.v.heading) * 12, Math.cos(c.v.heading) * 12);
      c.v.impact(c.v.pos.x + Math.sin(c.v.heading) * 2, c.v.pos.z + Math.cos(c.v.heading) * 2, -Math.sin(c.v.heading), -Math.cos(c.v.heading), 14);
      const where = placeName(g.world, c.v.pos.x, c.v.pos.z);
      setTimeout(() => g.news.publish(`Crash ${where}: ${describeVehicle(c.v)} lost control. Expect delays in the area.`, ['crash', 'accident', 'traffic'], 0.55), 8000);
    } else if (kind === 'outage' && g.env.night > 0.4) {
      const P = g.player.pos;
      const x = P.x + (Math.random() - 0.5) * 300, z = Math.min(780, P.z + (Math.random() - 0.5) * 300);
      const where = placeName(g.world, x, z);
      g.shared.uOutage.value.set(x, z, 160);
      this.outage = { t: 120 + Math.random() * 120, where };
      g.news.publish(`Power outage ${where}. Crews are working on it.`, ['power', 'outage', 'blackout'], 0.5);
    } else if (kind === 'festival') {
      const park = pick(g.world.parks);
      if (!park) return;
      for (let k = 0; k < 14; k++) {
        const n = g.npcs.spawnAt(park.x + (Math.random() - 0.5) * 50, park.z + (Math.random() - 0.5) * 50);
        n.state = 'idle'; n.stateT = 60 + Math.random() * 60; n.gesture = pick(['wave', 'talk', null, null]);
      }
      this.festival = { t: 180, park };
      g.news.publish(`Street festival happening now at ${park.name}: food stalls and live music until late!`, ['festival', 'party', 'music', park.name.toLowerCase()], 0.45);
    } else if (kind === 'dispute') {
      const a = pick(g.npcs.list.filter((n) => n.state === 'walk'));
      const b = a && g.npcs.list.find((n) => n !== a && n.state === 'walk' && n.pos.distanceTo(a.pos) < 30);
      if (!a || !b) return;
      a.say('Hey! You scratched my car this morning!', 'angry', 4); a.gestureFor('angry', 6); a.anger = 0.8;
      setTimeout(() => { b.say('I did not! Prove it!', 'angry', 4); b.gestureFor('angry', 5); }, 2500);
      const f = { id: 'dispute:' + Math.floor(g.time), text: `${a.profile.first} and ${b.profile.first} had a shouting match ${placeName(g.world, a.pos.x, a.pos.z)}.`, tags: ['argument', 'fight', a.profile.first.toLowerCase(), b.profile.first.toLowerCase()], importance: 0.45, confidence: 0.9, source: 'saw' };
      for (const n of g.npcs.list) if (n.pos.distanceTo(a.pos) < 35) n.learn(f);
    }
  }
}
