// What citizens can know: grounded facts with a source, plus helpers to describe the world in words.
import { HALF, CELL, GRID, SHORE_Z, roadCoord } from './world.js';
import { compass, roundDist } from './util.js';

const AVENUES = ['Harbor', 'Cedar', 'Maple', 'Kingston', 'Lark', 'Union', 'Vista', 'Granite', 'Mercer', 'Orchard', 'Pacific', 'Quarry', 'Ridge', 'Sable', 'Tide', 'Willow', 'Marina'];
/** Street name nearest to a point: avenues run north-south (constant x), streets east-west (constant z). */
export function streetName(x, z) {
  const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
  const dx = Math.abs(x - roadCoord(Math.max(0, Math.min(GRID, i)))), dz = Math.abs(z - roadCoord(Math.max(0, Math.min(GRID, j))));
  if (z > SHORE_Z - 2) return 'Ocean Boulevard';
  if (dx < dz) return `${AVENUES[Math.max(0, Math.min(GRID, i))]} Avenue`;
  if (j >= GRID) return 'Ocean Boulevard';
  const n = Math.max(0, Math.min(GRID, j)) + 1;
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} Street`;
}

/** "on Cedar Avenue near Bayline Fuel" */
export function placeName(world, x, z) {
  if (z > SHORE_Z + 60) return 'out in the water off the beach';
  let best = null, bd = 140;
  for (const p of world.pois) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
  const street = streetName(x, z);
  return best ? `on ${street} near ${best.name}` : `on ${street}`;
}

const NAMED = [
  ['black', [0.07, 0.08, 0.09]], ['white', [0.94, 0.94, 0.92]], ['silver', [0.7, 0.71, 0.73]], ['grey', [0.43, 0.44, 0.45]],
  ['red', [0.72, 0.16, 0.12]], ['blue', [0.15, 0.25, 0.48]], ['green', [0.2, 0.32, 0.25]], ['yellow', [0.85, 0.7, 0.18]],
  ['purple', [0.35, 0.18, 0.5]], ['orange', [0.85, 0.35, 0.12]], ['teal', [0.06, 0.37, 0.46]], ['brown', [0.45, 0.4, 0.34]],
];
export function colorName(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  let best = 'dark', bd = 9;
  for (const [n, [R, G, B]] of NAMED) { const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}
export function describeVehicle(v) {
  if (!v) return 'a car';
  if (v.type === 'police') return 'a police car';
  if (v.type === 'ambulance') return 'an ambulance';
  const kind = { sedan: 'sedan', hatch: 'hatchback', suv: 'SUV', sports: 'sports car', van: 'van', taxi: 'taxi' }[v.type] || 'car';
  const c = colorName(v.paintHex);
  return `${/^[aeiou]/.test(c) ? 'an' : 'a'} ${c} ${kind}`;
}

const STOP = new Set('the a an and or of to in on at is are was were be i you me my your it this that have has had do did does hey hi around here there any some for with what who where when why how can could would about just so we they he she him her seen see saw know anything someone something please tell'.split(' '));
export function tokenize(text) {
  const out = [];
  for (let w of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 2 || STOP.has(w)) continue;
    if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
    else if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) w = w.slice(0, -1);
    if (!out.includes(w)) out.push(w);
  }
  return out;
}
export function relevance(queryTokens, fact) {
  if (!queryTokens.length) return 0;
  const ft = new Set([...tokenize(fact.text), ...(fact.tags || []).flatMap(tokenize)]);
  let hits = 0;
  for (const t of queryTokens) if (ft.has(t)) hits++;
  return hits / queryTokens.length;
}
/** Retrieve the facts most relevant to a question: relevance, importance and recency, scaled by confidence. */
export function recall(facts, query, now, n = 5) {
  const q = tokenize(query);
  return facts
    .map((f) => {
      const rel = relevance(q, f), age = Math.max(0, now - f.t) / 3600;
      const s = (q.length ? 0.55 * rel + 0.25 * f.importance + 0.2 * Math.exp(-age / 2) : 0.55 * f.importance + 0.45 * Math.exp(-age / 2)) * (0.5 + 0.5 * f.confidence);
      return { f, s: q.length && rel === 0 ? s * 0.3 : s, rel };
    })
    .filter((x) => x.s > 0.12)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => ({ ...x.f, rel: x.rel }));
}

/** Seconds ago → "a few minutes ago". Uses real seconds (game.time). */
export function ago(now, t) {
  const m = (now - t) / 60;
  if (m < 1) return 'just now';
  if (m < 4) return 'a couple of minutes ago';
  if (m < 12) return 'about ten minutes ago';
  if (m < 40) return 'about half an hour ago';
  if (m < 90) return 'about an hour ago';
  return 'a while ago';
}

/** Turn a fact into something a person would say, honest about how they know it. */
export function tellFact(f, now) {
  const when = ago(now, f.t);
  const what = f.text.replace(/\.$/, '');
  if (f.source === 'heard') return `${f.from || 'Someone'} told me ${lower(what)}. I didn't see it myself.`;
  if (f.source === 'news') return `I saw it on the news: ${lower(what)}.`;
  if (f.source === 'sound') return `I heard ${lower(what)} ${when}, but I didn't see what happened.`;
  return `${f.confidence < 0.6 ? 'I think ' + lower(what) : what}, ${when}.`;
}
const lower = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function directions(fromX, fromZ, toX, toZ) {
  const d = Math.hypot(toX - fromX, toZ - fromZ);
  return d < 40 ? 'right around here' : `${roundDist(d)} ${compass(toX - fromX, toZ - fromZ)} of here`;
}
