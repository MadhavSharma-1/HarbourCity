// Save only what matters: clock, player, owned cars (with damage + fuel), wanted level, weather,
// news, completed missions, property, treasures, and every citizen who has history with the player.
import { Vehicle } from './vehicle.js';

const KEY = 'harbor-city-save-v1';

export function hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }

export function saveGame(g) {
  const P = g.player;
  for (const n of g.npcs.list) g.npcs.retire(n); // capture people currently on screen too
  const cars = g.allVehicles().filter((v) => v.owned).map((v) => ({ type: v.type, paint: v.paintHex, x: v.pos.x, z: v.pos.z, h: v.heading, fuel: v.fuel, health: v.health, front: v.frontBroken, rear: v.rearBroken }));
  const data = {
    v: 1, savedAt: new Date().toISOString(), hours: g.env.hours,
    player: { x: P.pos.x, z: P.pos.z, money: P.money, health: P.health, appearance: P.appearance },
    cars, wanted: g.police.serialize(), rain: g.weather.target,
    news: g.news.items.slice(0, 20), missions: [...g.missions.completed], property: g.property || null,
    treasures: g.underwater.treasures.map((t) => t.found), citizens: [...g.npcs.registry.values()],
  };
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { console.error(e); return false; }
}

export function loadGame(g) {
  let d;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
  if (!d) return false;
  const P = g.player;
  g.env.hours = d.hours ?? 17;
  if (P.mode === 'car') { P.vehicle.vel.set(0, 0); P.exitCar(); }
  P.spawn(d.player.x, d.player.z, 0);
  P.money = d.player.money; P.health = d.player.health || 100;
  if (d.player.appearance) P.appearance = d.player.appearance;
  // replace owned cars with the saved ones (damage and fuel persist)
  for (const v of g.parked.filter((v) => v.owned)) { v.dispose(); g.parked.splice(g.parked.indexOf(v), 1); }
  for (const c of d.cars || []) {
    const v = new Vehicle(g, c.type, c.paint);
    v.place(c.x, c.z, c.h); v.fuel = c.fuel; v.health = c.health; v.frontBroken = c.front; v.rearBroken = c.rear;
    v.owned = true; v.keep = true;
    if (c.health < 100) v.deform(0, 0.7, v.spec.len / 2, 0, -1, Math.min(0.4, (100 - c.health) / 200), 1.2);
    g.parked.push(v);
    g.lastCar = v;
  }
  g.police.restore(d.wanted);
  g.weather.setTarget(d.rain || 0); g.weather.rain = d.rain || 0;
  g.news.items = d.news || [];
  g.missions.completed = new Set(d.missions || []);
  g.property = d.property || null;
  (d.treasures || []).forEach((f, i) => { const t = g.underwater.treasures[i]; if (f && t && !t.found) { t.found = true; g.scene.remove(t.group); g.underwater.found++; } });
  g.npcs.registry = new Map((d.citizens || []).map((c) => [c.id, c]));
  g.phone?.refresh();
  return true;
}
