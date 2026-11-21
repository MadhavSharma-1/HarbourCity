import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, WATER_LEVEL, SHORE_Z, waveHeight, groundHeight } from './world.js';
import { createOcean } from './water.js';
import { Environment } from './environment.js';
import { Particles } from './particles.js';
import { Audio } from './audio.js';
import { Vehicle, collideVehicles } from './vehicle.js';
import { Traffic } from './traffic.js';
import { NPCManager } from './npc.js';
import { Underwater } from './underwater.js';
import { Player } from './player.js';
import { HUD, DialogueUI } from './hud.js';
import { clamp, damp, lerp, angleDiff } from './util.js';

const $ = (id) => document.getElementById(id);
const START = { x: 186, z: 789, h: 0 };

class Input {
  constructor(dom) {
    this.keys = new Set(); this.pressed = new Set(); this.dx = 0; this.dy = 0; this.wheel = 0; this.locked = false;
    addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'SELECT') return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => { if (this.locked || this.dragging) { this.dx += e.movementX; this.dy += e.movementY; } });
    dom.addEventListener('mousedown', () => { this.dragging = true; });
    addEventListener('mouseup', () => { this.dragging = false; });
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
  }
  down(c) { return this.keys.has(c); }
  hit(c) { return this.pressed.has(c); }
  end() { this.pressed.clear(); this.dx = this.dy = this.wheel = 0; }
}

const UnderwaterShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uUnder: { value: 0 }, uHurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uUnder; uniform float uHurt; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      uv += uUnder * vec2(sin(uv.y * 23.0 + uTime * 1.7), cos(uv.x * 19.0 + uTime * 1.3)) * 0.0022;
      vec2 off = (uv - 0.5) * 0.0025 * (1.0 + uUnder * 2.0);
      vec4 c = vec4(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b, 1.0);
      float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
      c.rgb = mix(c.rgb, mix(c.rgb, vec3(l) * vec3(0.55, 1.0, 1.08), 0.3) * vec3(0.78, 0.97, 1.02), uUnder);
      float r = length(vUv - 0.5);
      c.rgb *= mix(1.0, smoothstep(0.85, 0.25, r), 0.35 + uUnder * 0.3);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.4, 0.4, 0.35), uHurt * smoothstep(0.2, 0.75, r));
      gl_FragColor = c;
    }`,
};

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.15, 12000);
    this.scene.add(this.camera);
    this.shared = { uTime: { value: 0 }, uNight: { value: 0 }, uSunIntensity: { value: 1 } };
    this.input = new Input(this.canvas);
    this.audio = new Audio();
    this.time = 0; this.simTime = 0; this.shake = 0; this.playing = false; this.paused = false;
    this.listeners = [];
    this.cam = { yaw: Math.PI, pitch: 0.18, dist: 4.5, idle: 0, pos: new THREE.Vector3() };
    this.settings = { res: '1440', shadow: 2048, bloom: true, peds: 30, cars: 32, voice: true };
    window.__game = this;
  }

  async build() {
    const msg = (t) => { $('loadMsg').textContent = t; return new Promise((res) => setTimeout(res, 0)); };
    await msg('Building the city…');
    this.world = new World(this.scene, this.shared);
    this.world.build((t) => { $('loadMsg').textContent = t; });
    await msg('Filling the ocean…');
    this.ocean = createOcean(this.scene, this.shared);
    this.env = new Environment(this);
    this.underwater = new Underwater(this);
    this.underwater.build();
    await msg('Waking up the citizens…');
    this.smoke = new Particles(this.scene, 2500, { soft: 1.6 });
    this.fire = new Particles(this.scene, 800, { additive: true, soft: 1.2 });
    this.sparks = new Particles(this.scene, 600, { additive: true, soft: 0.6 });
    this.bubbles = new Particles(this.scene, 1500, { additive: true, soft: 3 });
    this.player = new Player(this);
    this.player.spawn(START.x, START.z, START.h);
    this.traffic = new Traffic(this);
    this.npcs = new NPCManager(this);
    this.listeners.push((t, d) => this.npcs.onEvent(t, d));
    this.parked = [];
    const pc = new Vehicle(this, 'sports', '#c0392b');
    pc.place(176, SHORE_Z + 6, Math.PI / 2); pc.fuel = pc.fuelCap * 0.35; pc.keep = true;
    this.parked.push(pc);
    this.lastCar = pc;
    const types = ['sedan', 'hatch', 'suv', 'van', 'sedan'];
    for (const s of [...(this.world.parkingSpots || []), ...this.world.beachParking]) {
      if (Math.abs(s.x - 176) < 20 && s.z > SHORE_Z) continue;
      const v = new Vehicle(this, types[Math.floor(Math.random() * types.length)]);
      v.place(s.x, s.z, s.h); this.parked.push(v);
    }
    // night-time light pool: the nearest street lamps get real lights
    this.lampLights = [];
    for (let k = 0; k < 8; k++) { const l = new THREE.PointLight(0xffc98a, 0, 34, 1.6); this.scene.add(l); this.lampLights.push(l); }
    this.lampT = 0;
    this.headL = [0, 1].map(() => { const s = new THREE.SpotLight(0xfff1dc, 0, 90, 0.42, 0.55, 1.4); this.scene.add(s, s.target); return s; });
    this.composerSetup();
    this.hud = new HUD(this);
    this.ui = new DialogueUI(this);
    this.applySettings();
    addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.locked && this.playing && !this.ui.open && !this.ignoreUnlock && !this.paused) this.pause(true);
      this.ignoreUnlock = false;
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.playing && !this.ui.open) this.pause(!this.paused);
    });
    // warm-up traffic & people so the city is alive on the first frame
    for (let k = 0; k < 40; k++) this.traffic.spawn(START.x, START.z, 40, 300);
    for (let k = 0; k < 20; k++) this.npcs.spawnRandom();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
    await msg('Ready.');
  }

  composerSetup() {
    const r = this.renderer;
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.uwPass = new ShaderPass(UnderwaterShader);
    this.composer.addPass(this.uwPass);
    this.composer.addPass(new OutputPass());
  }

  readSettings() {
    const s = this.settings;
    s.res = $('optRes').value; s.shadow = +$('optShadow').value; s.bloom = $('optBloom').value === '1';
    s.peds = +$('optPeds').value; s.cars = +$('optCars').value; s.voice = $('optVoice').value === '1';
  }
  applySettings() {
    const s = this.settings;
    this.npcs.max = s.peds; this.traffic.max = s.cars; this.npcs.voice = s.voice;
    const l = this.env.light;
    this.renderer.shadowMap.enabled = s.shadow > 0;
    l.castShadow = s.shadow > 0;
    if (s.shadow > 0 && l.shadow.mapSize.x !== s.shadow) { l.shadow.mapSize.set(s.shadow, s.shadow); if (l.shadow.map) { l.shadow.map.dispose(); l.shadow.map = null; } }
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    this.bloom.enabled = s.bloom;
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    const targetW = { 1080: 1920, 1440: 2560, 2160: 3840 }[this.settings.res];
    let pr = targetW ? targetW / w : window.devicePixelRatio || 1;
    // keep the aspect: a 2K preset renders 2560 pixels across for a 16:9 window
    pr = clamp(pr, 0.5, 3);
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /* ───────────── helpers used by other modules ───────────── */
  emit(type, data) { for (const l of this.listeners) l(type, data); }
  notify(t) { this.hud.notify(t); }
  waveAt(x, z) { return waveHeight(x, z, this.shared.uTime.value) * clamp((WATER_LEVEL - groundHeight(x, z)) / 3, 0.15, 1); }
  waterSurfaceAt(x, z) { return WATER_LEVEL + this.waveAt(x, z); }
  isOverWater(x, z) { return z > SHORE_Z + 40 || groundHeight(x, z) < WATER_LEVEL; }
  allVehicles() { const a = this.parked.slice(); for (const c of this.traffic.cars) a.push(c.v); return a; }
  lockPointer() { if (this.playing && !this.paused && this.canvas.requestPointerLock) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not allowed */ } } }
  unlockPointer(ignore) { this.ignoreUnlock = !!ignore; if (document.pointerLockElement) document.exitPointerLock(); }

  start() {
    this.readSettings(); this.applySettings();
    this.audio.resume();
    $('startScreen').classList.add('hidden');
    $('startBtn').textContent = 'RESUME';
    this.playing = true; this.paused = false;
    this.lockPointer();
    if (!this.welcomed) {
      this.welcomed = true;
      this.notify('Welcome to Harbor City. Your red sports car is parked on the beach behind you. Press F near it.');
      setTimeout(() => this.notify('Low on fuel? Gas stations show up as G on the minimap.'), 5000);
      setTimeout(() => this.notify('Walk up to anyone and press E to talk.'), 10000);
    }
  }
  pause(on) {
    if (on === this.paused) return;
    this.paused = on;
    $('startScreen').classList.toggle('hidden', !on);
    if (on) { this.unlockPointer(true); this.audio.setEngine(false, 0, 0); this.audio.setHorn(false); }
    else { this.readSettings(); this.applySettings(); this.lockPointer(); }
  }

  blackout() {
    if (this.blackingOut) return;
    this.blackingOut = true;
    $('blackout').classList.remove('hidden');
    if (this.ui.open) this.ui.close();
    setTimeout(() => {
      if (this.player.mode === 'car') { this.player.vehicle.vel.set(0, 0); this.player.exitCar(); }
      this.player.spawn(START.x, START.z, START.h);
      this.player.money = Math.max(0, this.player.money - 150);
      $('blackout').classList.add('hidden');
      this.notify('You woke up near the pier. The clinic charged you $150.');
      this.blackingOut = false;
    }, 3200);
  }

  /* ───────────── main loop ───────────── */
  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const g = this, P = this.player, input = this.input;
    this.time += dt;
    this.simTime += dt;
    this.shared.uTime.value += dt;
    const active = this.playing && !this.paused && !this.blackingOut;
    const fast = active && input.down('KeyT');
    this.env.update(dt, this.camera.position, fast);

    if (active && !this.ui.open) {
      if (input.hit('KeyF')) { if (P.mode === 'car') P.exitCar(); else if (P.mode === 'foot') P.tryEnter(); }
      if (input.hit('KeyM')) $('bigmap').classList.toggle('hidden');
      if (input.hit('KeyE') && P.mode === 'foot') { const n = this.npcs.nearestTalkable(P.pos); if (n) this.ui.start(n); }
      if (input.hit('KeyE') && P.mode === 'swim') {
        const t = this.underwater.nearestTreasure(P.pos, 3.2);
        if (t) { const v = this.underwater.collect(t); P.money += v; this.audio.chime(); this.notify(`Treasure! +$${v}  (${this.underwater.found}/${this.underwater.treasures.length})`); }
      }
      P.update(dt, input, this.cam);
    } else if (P.mode !== 'car') {
      P.human.update(dt, { mode: P.mode === 'swim' ? 'swim' : 'idle', speed: 0, under: P.under });
      P.syncHuman();
    } else if (P.vehicle) { P.vehicle.physics(dt, null); this.audio.setEngine(false, 0, 0); }

    if (P.vehicle) {
      const v = P.vehicle;
      v.headlightsAuto = false;
      v.updateVisuals(dt, this.env.night);
    }
    this.traffic.update(dt, this.simTime);
    for (const v of this.parked) if (v !== P.vehicle) { v.physics(dt, null); v.updateVisuals(dt, this.env.night); }
    this.vehicleCollisions();
    this.npcs.update(dt);
    this.underwater.update(dt, this.shared.uTime.value);
    this.world.updateTrafficLights(this.simTime, dt);
    this.updateLights(dt);
    this.updateCamera(dt);
    this.audio.setUnderwater(this.env.underwater);
    const camH = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const ps of [this.smoke, this.fire, this.sparks, this.bubbles]) ps.update(dt, camH);
    this.uwPass.uniforms.uTime.value = this.time;
    this.uwPass.uniforms.uUnder.value = this.env.underwater ? 1 : 0;
    this.uwPass.uniforms.uHurt.value = damp(this.uwPass.uniforms.uHurt.value, P.health < 35 || P.oxygen <= 0 ? 0.8 : 0, 3, dt);
    this.bloom.strength = lerp(0.22, 0.5, this.env.night) + (this.env.underwater ? 0.1 : 0);
    this.bloom.threshold = lerp(1.5, 0.95, this.env.night);
    this.prompts();
    this.hud.update(dt);
    this.composer.render(dt);
    input.end();
  }

  vehicleCollisions() {
    const P = this.player, pv = P.mode === 'car' ? P.vehicle : null;
    const cars = this.traffic.cars;
    const others = this.allVehicles();
    const dyn = [];
    if (pv) dyn.push(pv);
    for (const c of cars) if (c.mode === 'dynamic' && c.v !== pv) dyn.push(c.v);
    for (const a of dyn) for (const b of others) {
      if (a === b || (dyn.includes(b) && dyn.indexOf(b) < dyn.indexOf(a))) continue;
      const imp = collideVehicles(a, b);
      if (imp > 2.5) {
        for (const v of [a, b]) if (v.ai && v.ai.mode === 'drive') { this.traffic.knock(v.ai); v.ai.hitByPlayer = a === pv; }
      }
    }
  }

  updateLights(dt) {
    const night = this.env.night;
    this.world.lampHeadMat.emissiveIntensity = night * 3;
    for (const m of this.world.gasGlassMats || []) m.emissiveIntensity = 0.3 + night * 1.2;
    this.world.beaconMat.color.setRGB(Math.sin(this.time * 3) > 0.3 ? 5 : 0.2, 0.15, 0.1);
    this.lampT -= dt;
    if (this.lampT <= 0) {
      this.lampT = 0.4;
      const c = this.camera.position;
      const near = [];
      if (night > 0.2) {
        for (const l of this.world.lamps) { const d = (l.x - c.x) ** 2 + (l.z - c.z) ** 2; if (d < 120 * 120) near.push([d, l]); }
        near.sort((a, b) => a[0] - b[0]);
      }
      this.lampLights.forEach((L, i) => {
        const e = near[i];
        if (e) { L.position.set(e[1].x, e[1].y, e[1].z); L.userData.on = true; L.userData.gas = e[1].gas; }
        else L.userData.on = false;
      });
    }
    for (const L of this.lampLights) L.intensity = L.userData.on ? night * (L.userData.gas ? 120 : 70) : 0;
    // player car headlights are real spot lights
    const v = this.player.mode === 'car' ? this.player.vehicle : null;
    const on = v && v.headlights && !v.frontBroken && v.health > 0;
    this.headL.forEach((s, i) => {
      s.intensity = on ? 260 * (0.5 + night * 0.5) : 0;
      if (!v) return;
      const side = i ? 1 : -1;
      const p = new THREE.Vector3(side * (v.spec.wid / 2 - 0.3), v.dims.clr + v.dims.bh * 0.6, v.spec.len / 2 + 0.1);
      v.model.localToWorld(p); s.position.copy(p);
      const t = new THREE.Vector3(side * 1.2, -0.8, 22); v.model.localToWorld(t); s.target.position.copy(t);
    });
  }

  updateCamera(dt) {
    const g = this, P = this.player, C = this.cam, cam = this.camera, input = this.input;
    const active = this.playing && !this.paused;
    if (active && !this.ui.open) {
      C.yaw -= input.dx * 0.0024; C.pitch += input.dy * 0.0022;
      if (input.dx || input.dy) C.idle = 0; else C.idle += dt;
      C.dist = clamp(C.dist + input.wheel * 0.6, 2.5, 14);
    } else if (!this.playing) { C.yaw += dt * 0.05; C.idle = 0; }
    const target = new THREE.Vector3();
    let dist = C.dist, fov = 68;
    if (P.mode === 'car') {
      const v = P.vehicle, sp = v.speed();
      target.set(v.pos.x, v.pos.y + 1.35, v.pos.z);
      dist = Math.max(C.dist, 6) + Math.min(sp * 0.05, 2) + v.spec.len * 0.3;
      if (C.idle > 1.2 && sp > 2) {
        const fwdBack = v.forwardSpeed() < -1 ? 0 : Math.PI;
        C.yaw += angleDiff(C.yaw, v.heading + fwdBack) * Math.min(1, dt * 2.2);
        C.pitch = damp(C.pitch, 0.2, 2, dt);
      }
      fov = 68 + clamp(sp - 10, 0, 40) * 0.35;
    } else if (P.mode === 'swim') {
      target.set(P.pos.x, P.pos.y + 1.0, P.pos.z);
      dist = Math.min(C.dist, 4.2);
    } else if (P.mode === 'down') {
      target.set(P.pos.x, P.pos.y + 0.6, P.pos.z);
    } else {
      target.set(P.pos.x, P.pos.y + 1.6, P.pos.z);
    }
    if (this.ui.open) {
      // over-the-shoulder framing of the conversation
      const n = this.ui.npc;
      const a = Math.atan2(P.pos.x - n.pos.x, P.pos.z - n.pos.z);
      C.yaw += angleDiff(C.yaw, a + 0.45) * Math.min(1, dt * 3);
      C.pitch = damp(C.pitch, 0.08, 3, dt);
      dist = 2.6;
      target.set((P.pos.x + n.pos.x) / 2, P.pos.y + 1.55, (P.pos.z + n.pos.z) / 2);
      P.heading += angleDiff(P.heading, Math.atan2(n.pos.x - P.pos.x, n.pos.z - P.pos.z)) * Math.min(1, dt * 6);
    }
    C.pitch = clamp(C.pitch, P.mode === 'swim' && P.under ? -1.3 : -0.45, 1.25);
    this.camera.fov = damp(this.camera.fov, fov, 3, dt); this.camera.updateProjectionMatrix();
    const cp = Math.cos(C.pitch);
    const dir = new THREE.Vector3(Math.sin(C.yaw) * cp, Math.sin(C.pitch), Math.cos(C.yaw) * cp);
    // pull the camera in so it never ends up inside a building
    let d = dist;
    const probe = new THREE.Vector3();
    for (let k = 1; k <= 14; k++) {
      const s = (k / 14) * dist;
      probe.copy(target).addScaledVector(dir, s);
      if (this.world.colliders.inside(probe.x, probe.y, probe.z) || probe.y < groundHeight(probe.x, probe.z) + 0.25) { d = Math.max(0.8, s - 0.4); break; }
    }
    const want = target.clone().addScaledVector(dir, d);
    // don't let the lens sit exactly on the water surface
    if (this.isOverWater(want.x, want.z)) {
      const ws = this.waterSurfaceAt(want.x, want.z);
      const playerUnder = P.mode === 'swim' && P.headUnderwater();
      if (playerUnder && want.y > ws - 0.35) want.y = ws - 0.35;
      if (!playerUnder && want.y < ws + 0.35) want.y = ws + 0.35;
    }
    C.pos.lerp(want, 1 - Math.exp(-dt * (P.mode === 'car' ? 14 : 18)));
    if (C.pos.distanceTo(want) > 30) C.pos.copy(want);
    cam.position.copy(C.pos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.4; cam.position.y += (Math.random() - 0.5) * this.shake * 0.4;
    }
    cam.lookAt(target);
  }

  prompts() {
    const P = this.player, hud = this.hud;
    if (!this.playing || this.paused || this.ui.open) return hud.prompt('');
    if (P.mode === 'car') {
      const v = P.vehicle;
      if (P.atStation) return hud.prompt(v.fuel < v.fuelCap - 0.05 ? `<kbd>R</kbd>Hold to refuel at ${P.atStation.name} — $${P.atStation.price}/L` : 'Tank full');
      if (v.health <= 0 || v.sunk) return hud.prompt('<kbd>F</kbd>Get out — this car is wrecked');
      if (!v.engineOn && v.fuel > 0) return hud.prompt('<kbd>E</kbd>Start engine');
      return hud.prompt('');
    }
    if (P.mode === 'swim') {
      const t = this.underwater.nearestTreasure(P.pos, 3.2);
      if (t) return hud.prompt('<kbd>E</kbd>Open treasure chest');
      if (P.under && P.oxygen < 0.3) return hud.prompt('Low on air — swim up! <kbd>Space</kbd>');
      if (!P.under && !this._dived) return hud.prompt('<kbd>C</kbd>Dive  ·  <kbd>Space</kbd>Swim up  ·  Look where you want to swim');
      if (P.under) this._dived = true;
      return hud.prompt('');
    }
    if (P.mode === 'foot') {
      const n = this.npcs.nearestTalkable(P.pos);
      if (n) return hud.prompt(`<kbd>E</kbd>Talk to ${n.profile.first}`);
      let best = null, bd = 4.2;
      for (const v of this.allVehicles()) { const d = Math.hypot(v.pos.x - P.pos.x, v.pos.z - P.pos.z); if (d < bd && !v.sunk) { bd = d; best = v; } }
      if (best) return hud.prompt(best.driver === 'ai' ? '<kbd>F</kbd>Take this car (the driver won\'t like it)' : `<kbd>F</kbd>Get in ${best.spec.name}`);
    }
    hud.prompt('');
  }
}

const game = new Game();
game.build().then(() => {
  const b = $('startBtn');
  b.disabled = false; b.textContent = 'PLAY';
  b.onclick = () => (game.playing ? game.pause(false) : game.start());
}).catch((e) => {
  console.error(e);
  $('loadMsg').textContent = 'Failed to start: ' + e.message + ' (WebGL 2 is required)';
});
