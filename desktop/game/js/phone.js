// In-game smartphone: missions, news, contacts, shop (cars + apartment), settings, save/load.
import { Vehicle, PAINTS } from './vehicle.js';
import { MISSION_DEFS } from './missions.js';
import { saveGame, loadGame } from './save.js';
import { describe } from './dialogue.js';

const $ = (id) => document.getElementById(id);
const CARS = [
  { type: 'hatch', name: 'Hatchback', price: 1800 }, { type: 'sedan', name: 'Sedan', price: 3200 },
  { type: 'suv', name: 'SUV', price: 5200 }, { type: 'van', name: 'Delivery van', price: 4000 }, { type: 'sports', name: 'Sports coupe', price: 9500 },
];

export class Phone {
  constructor(game) {
    this.game = game; this.tab = 'missions'; this.open = false;
    $('phoneTabs').addEventListener('click', (e) => { const t = e.target.dataset.tab; if (t) { this.tab = t; this.refresh(); } });
    $('phoneBody').addEventListener('click', (e) => this.onClick(e));
  }
  toggle(force) {
    const g = this.game;
    this.open = force ?? !this.open;
    $('phone').classList.toggle('hidden', !this.open);
    if (this.open) { g.unlockPointer(true); this.refresh(); } else g.lockPointer();
  }
  refresh() {
    if (!this.open) return;
    const g = this.game;
    for (const b of $('phoneTabs').children) b.classList.toggle('on', b.dataset.tab === this.tab);
    let h = '';
    if (this.tab === 'missions') {
      const a = g.missions.active;
      if (a) h += `<div class="card on"><b>Active: ${a.def.title}</b><p>${g.missions.objective().text}</p><button data-act="abandon">Abandon</button></div>`;
      for (const d of MISSION_DEFS) {
        const done = g.missions.completed.has(d.id);
        h += `<div class="card"><b>${d.title}</b> <span class="muted">from ${d.giver}</span><p>${d.brief}</p><p class="muted">Reward $${d.reward}${d.repeatable ? ' (repeatable)' : ''}${done ? ' · ✓ completed' : ''}</p>`;
        if (!a && (d.repeatable || !done)) h += `<button data-act="start" data-id="${d.id}">Start mission</button>`;
        h += '</div>';
      }
    } else if (this.tab === 'news') {
      h += g.news.items.length ? g.news.items.map((n) => `<div class="card"><span class="muted">${n.clock}</span><p>${n.text}</p></div>`).join('') : '<p class="muted">No news yet. Things will happen.</p>';
    } else if (this.tab === 'contacts') {
      const people = [...g.npcs.registry.values(), ...g.npcs.list.filter((n) => n.relation !== 0 || n.memory.length).map((n) => n.snapshot())];
      const seen = new Set();
      const rows = people.filter((p) => !seen.has(p.id) && seen.add(p.id)).sort((a, b) => b.relation - a.relation);
      h += rows.length ? rows.map((p) => `<div class="card"><b>${p.profile.first} ${p.profile.last}</b> <span class="muted">${p.profile.job}</span><p>${p.relation > 0.8 ? 'Friend 🙂' : p.relation > 0.2 ? 'Friendly' : p.relation < -1 ? 'Hates you 😠' : p.relation < -0.2 ? 'Wary of you' : 'Acquaintance'} · remembers ${p.memory.length} encounter(s)</p></div>`).join('')
        : '<p class="muted">People you meet and talk to will show up here. They remember you.</p>';
    } else if (this.tab === 'shop') {
      h += `<p class="muted">Cash: $${Math.floor(g.player.money)}</p>`;
      for (const c of CARS) h += `<div class="card"><b>${c.name}</b> <span class="muted">$${c.price}</span><button data-act="car" data-type="${c.type}" data-price="${c.price}">Buy &amp; deliver</button></div>`;
      h += `<div class="card"><b>Beachfront apartment</b> <span class="muted">$15000</span><p>Your own place by the pier. You wake up here after blacking out or getting released by the police.</p>${g.property ? '<p>✓ Owned</p>' : '<button data-act="home" data-price="15000">Buy</button>'}</div>`;
    } else if (this.tab === 'settings') {
      h += `<div class="card"><b>Save game</b><p class="muted">Autosaves every 2 minutes and when you quit.</p><button data-act="save">Save now</button> <button data-act="load">Load last save</button></div>`;
      h += `<div class="card"><b>AI conversations (optional)</b><p class="muted">Citizens already talk using their own memories. With an Anthropic API key, Claude voices them, still only using what each person actually knows. The key stays on this PC.</p>`;
      h += window.neon ? `<input id="apiKey" type="password" placeholder="sk-ant-..." style="width:100%"><button data-act="key">Save key</button> <button data-act="clearkey">Remove key</button><p id="keyStatus" class="muted"></p>` : '<p class="muted">Available in the desktop app.</p>';
      h += '</div>';
      if (window.neon) window.neon.hasApiKey().then((k) => { const s = $('keyStatus'); if (s) s.textContent = k ? 'Key set: AI voices on.' : 'No key: built-in dialogue.'; });
    }
    $('phoneBody').innerHTML = h;
  }
  async onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const g = this.game, act = b.dataset.act;
    if (act === 'start') { g.missions.start(b.dataset.id); this.toggle(false); }
    else if (act === 'abandon') g.missions.fail('Abandoned.');
    else if (act === 'car') {
      const price = +b.dataset.price;
      if (g.player.money < price) return g.notify('Not enough money.');
      g.player.money -= price;
      const v = new Vehicle(g, b.dataset.type, PAINTS[Math.floor(Math.random() * PAINTS.length)]);
      const P = g.player.pos;
      v.place(P.x + 6, P.z + 3, 0); v.fuel = v.fuelCap; v.owned = true; v.keep = true;
      g.parked.push(v); g.lastCar = v;
      g.notify(`Your new ${v.spec.name} has been delivered next to you.`);
      g.save();
    } else if (act === 'home') {
      if (g.player.money < 15000) return g.notify('Not enough money.');
      g.player.money -= 15000; g.property = { x: 230, z: 790 };
      g.notify('You bought the beachfront apartment!'); g.save();
    } else if (act === 'save') g.notify(saveGame(g) ? 'Game saved.' : 'Save failed.');
    else if (act === 'load') { if (loadGame(g)) { g.notify('Game loaded.'); this.toggle(false); } else g.notify('No save found.'); }
    else if (act === 'key') { const k = $('apiKey').value.trim(); if (k) { await window.neon.setApiKey(k); g.notify('API key saved on this PC.'); } }
    else if (act === 'clearkey') { await window.neon.setApiKey(''); g.notify('API key removed.'); }
    this.refresh();
  }
}
export { describe };
