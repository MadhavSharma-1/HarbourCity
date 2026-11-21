import { describe, openLine, options, respond, buildContext } from './dialogue.js';
import { clamp } from './util.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.mm = $('minimap').getContext('2d');
    this.big = $('bigmapCanvas');
    this.mmT = 0;
    this.fpsT = 0; this.frames = 0;
    this.lastPrompt = '';
  }

  showCar(on) { $('cluster').classList.toggle('hidden', !on); if (on) $('carName').textContent = this.game.player.vehicle.spec.name; }

  notify(text) {
    const el = document.createElement('div');
    el.className = 'note'; el.textContent = text;
    $('feed').appendChild(el);
    setTimeout(() => el.remove(), 4600);
    while ($('feed').children.length > 4) $('feed').firstChild.remove();
  }

  prompt(html) {
    if (html === this.lastPrompt) return;
    this.lastPrompt = html;
    const p = $('prompt');
    if (!html) p.classList.add('hidden'); else { p.innerHTML = html; p.classList.remove('hidden'); }
  }

  update(dt) {
    const g = this.game, P = g.player;
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) {
      const c = g.renderer.domElement;
      $('fps').textContent = `${Math.round(this.frames / this.fpsT)} fps · ${c.width}×${c.height}`;
      this.frames = 0; this.fpsT = 0;
    }
    $('clock').textContent = g.env.timeString();
    $('money').textContent = '$' + Math.floor(P.money).toLocaleString();
    $('treasure').textContent = `Treasures ${g.underwater.found}/${g.underwater.treasures.length}`;
    $('hpBar').firstChild.style.width = P.health + '%';
    const showO2 = P.mode === 'swim' && (P.headUnderwater() || P.oxygen < 0.99);
    $('o2Bar').classList.toggle('hidden', !showO2);
    $('o2Bar').firstChild.style.width = P.oxygen * 100 + '%';
    const under = P.mode === 'swim' && P.headUnderwater();
    $('depth').classList.toggle('hidden', !under);
    if (under) $('depthVal').textContent = Math.max(0, P.surfaceY() - P.pos.y - 1).toFixed(1) + 'm';

    const inCar = P.mode === 'car';
    if ($('cluster').classList.contains('hidden') === inCar) this.showCar(inCar);
    if (inCar) {
      const v = P.vehicle;
      const kmh = Math.round(Math.abs(v.forwardSpeed()) * 3.6);
      $('speed').innerHTML = `${kmh}<small>km/h</small>`;
      $('gear').textContent = !v.engineOn ? 'OFF' : v.reversing ? 'R' : v.speed() < 0.3 ? 'N' : 'D' + v.gear;
      $('rpmBar').firstChild.style.width = clamp(v.rpm / 7200, 0, 1) * 100 + '%';
      $('fuelBar').firstChild.style.width = (v.fuel / v.fuelCap) * 100 + '%';
      $('fuelTxt').textContent = v.fuel.toFixed(1) + 'L';
      $('engBar').firstChild.style.width = v.health + '%';
      $('engTxt').textContent = Math.round(v.health) + '%';
      const blink = Math.floor(v.blink * 2.6) % 2 === 0;
      $('icoL').classList.toggle('on', (v.indicator < 0 || v.hazard) && blink);
      $('icoR').classList.toggle('on', (v.indicator > 0 || v.hazard) && blink);
      $('icoLights').classList.toggle('on', v.headlights);
      $('icoHaz').classList.toggle('on', v.hazard);
      $('icoEng').classList.toggle('on', v.health < 40);
      $('icoFuel').classList.toggle('on', v.fuel < v.fuelCap * 0.15);
    }
    this.mmT -= dt;
    if (this.mmT <= 0) { this.mmT = 1 / 20; this.drawMinimap(); }
    if (!$('bigmap').classList.contains('hidden')) this.drawBigMap();
  }

  drawMinimap() {
    const g = this.game, ctx = this.mm, P = g.player, mi = g.world.mapImage;
    const W = 460, R = P.mode === 'car' ? 330 : 190;
    const k = (W / 2 / R) / mi.S;
    ctx.save();
    ctx.fillStyle = '#21405a'; ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(g.cam.yaw);
    ctx.scale(k, k);
    ctx.translate(-(P.pos.x - mi.X0) * mi.S, -(P.pos.z - mi.Z0) * mi.S);
    ctx.drawImage(mi.canvas, 0, 0);
    const M = (x, z) => [(x - mi.X0) * mi.S, (z - mi.Z0) * mi.S];
    const dot = (x, z, r, col) => { const [a, b] = M(x, z); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(a, b, r / k, 0, 7); ctx.fill(); };
    for (const c of g.traffic.cars) dot(c.v.pos.x, c.v.pos.z, 3, c.v === P.vehicle ? '#fff' : '#ffffffaa');
    for (const n of g.npcs.list) dot(n.pos.x, n.pos.z, 2, n.relation < -0.8 ? '#ff6a6a' : '#9fe8ff');
    ctx.restore();
    // edge-clamped markers (screen space)
    const mark = (x, z, col, label) => {
      const dx = x - P.pos.x, dz = z - P.pos.z;
      const c = Math.cos(g.cam.yaw), s = Math.sin(g.cam.yaw);
      let sx = (dx * c - dz * s) * (W / 2 / R), sy = (dx * s + dz * c) * (W / 2 / R);
      const d = Math.hypot(sx, sy), lim = W / 2 - 22;
      if (d > lim) { sx *= lim / d; sy *= lim / d; }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(W / 2 + sx, W / 2 + sy, 14, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = 'bold 17px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, W / 2 + sx, W / 2 + sy + 1);
    };
    for (const st of g.world.gasStations) mark(st.x, st.z, '#ffb347', 'G');
    mark(g.underwater.wreckPos.x, g.underwater.wreckPos.z, '#5fd4ff', '?');
    // player arrow
    ctx.save(); ctx.translate(W / 2, W / 2); ctx.rotate(g.cam.yaw - P.heading + Math.PI);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(11, 12); ctx.lineTo(0, 6); ctx.lineTo(-11, 12); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    const n = document.getElementById('compassN');
    const a = g.cam.yaw; // north is -Z on the map
    n.style.left = (115 + Math.sin(a) * 100) + 'px';
    n.style.top = (115 - Math.cos(a) * 100 - 8) + 'px';
  }

  drawBigMap() {
    const g = this.game, mi = g.world.mapImage, c = this.big;
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    const s = Math.min(W / mi.canvas.width, H / mi.canvas.height);
    const ox = (W - mi.canvas.width * s) / 2, oy = (H - mi.canvas.height * s) / 2;
    ctx.fillStyle = '#123'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(mi.canvas, ox, oy, mi.canvas.width * s, mi.canvas.height * s);
    const M = (x, z) => [ox + (x - mi.X0) * mi.S * s, oy + (z - mi.Z0) * mi.S * s];
    ctx.font = '600 13px Inter, sans-serif'; ctx.textAlign = 'center';
    for (const p of g.world.pois) {
      const [x, y] = M(p.x, p.z);
      ctx.fillStyle = p.kind === 'gas' ? '#ffb347' : p.kind === 'park' ? '#8ee07a' : '#fff';
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(p.name, x, y - 9); ctx.fillText(p.name, x, y - 9);
    }
    const [wx, wy] = M(g.underwater.wreckPos.x, g.underwater.wreckPos.z);
    ctx.strokeStyle = '#5fd4ff'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.arc(wx, wy, 26, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#5fd4ff'; ctx.fillText('Shipwreck (rumored)', wx, wy - 32);
    const P = g.player, [px, py] = M(P.pos.x, P.pos.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(-P.heading + Math.PI);
    ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = '700 16px Rajdhani, sans-serif';
    ctx.fillText('HARBOR CITY — press M to close', 16, 26);
  }
}

/** Conversation panel. */
export class DialogueUI {
  constructor(game) {
    this.game = game; this.npc = null;
    window.addEventListener('keydown', (e) => {
      if (!this.npc) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= this.opts.length) { this.choose(this.opts[n - 1].id); e.preventDefault(); }
      if (e.code === 'Escape') { this.close(); e.stopImmediatePropagation(); }
    });
  }
  get open() { return !!this.npc; }
  start(npc) {
    const g = this.game;
    this.npc = npc;
    npc.prevState = npc.state === 'talk' ? 'walk' : npc.state;
    if (npc.partner) npc.endChat();
    npc.state = 'talk'; npc.gesture = 'talk';
    g.unlockPointer(true);
    $('dialogue').classList.remove('hidden');
    $('dlgName').textContent = npc.name;
    $('dlgMeta').textContent = describe(npc);
    const ctx = (this.ctx = buildContext(g, npc));
    this.say(openLine(npc, ctx));
    this.renderOptions();
  }
  say(text) {
    $('dlgText').textContent = text;
    this.npc.say(text, '', 4, true);
    this.npc.gestureFor('talk', Math.min(4, 1 + text.length / 25));
  }
  renderOptions() {
    const box = $('dlgOpts'); box.innerHTML = '';
    this.opts = options(this.npc, this.ctx);
    this.opts.forEach((o, i) => {
      const b = document.createElement('button');
      b.textContent = `${i + 1}. ${o.text}`;
      b.onclick = () => this.choose(o.id);
      box.appendChild(b);
    });
  }
  choose(id) {
    const npc = this.npc; if (!npc) return;
    this.ctx = buildContext(this.game, npc);
    const r = respond(npc, id, this.ctx);
    this.say(r.text);
    if (r.gesture) npc.gestureFor(r.gesture, 2.5);
    $('dlgMeta').textContent = describe(npc);
    if (r.end) { $('dlgOpts').innerHTML = ''; setTimeout(() => { if (this.npc === npc) this.close(); }, 1600); }
    else this.renderOptions();
    if (id === 'rude' && npc.profile.brave < 0.6) setTimeout(() => npc.startFlee(this.game.player.pos, 4), 1700);
  }
  close() {
    const npc = this.npc; if (!npc) return;
    this.npc = null;
    $('dialogue').classList.add('hidden');
    if (npc.state === 'talk') npc.returnToPath();
    this.game.lockPointer();
  }
}
