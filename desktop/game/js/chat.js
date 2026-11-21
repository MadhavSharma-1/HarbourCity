// Free-text conversations. Citizens answer from their *own* knowledge (what they saw, heard, were told,
// or read in the news). With an Anthropic API key set in the desktop app, Claude voices them, but it is
// still only given that citizen's knowledge, and its output is validated before the game uses it.
import { recall, relevance, tokenize, tellFact, directions } from './knowledge.js';
import { describe } from './dialogue.js';
import { pick, clamp } from './util.js';

const has = (t, words) => words.some((w) => t.includes(w));

export function localReply(game, npc, line) {
  const t = ' ' + line.toLowerCase() + ' ';
  const p = npc.profile, now = game.time;
  const hostile = npc.relation < -1 || npc.anger > 0.6;
  const facts = recall(npc.knowledge, line, now, 4);
  const relevant = facts.filter((f) => f.rel > 0);
  const out = { reply: '', affinity: 0, mood: 0, end: false, remember: null };

  if (has(t, ['idiot', 'stupid', 'shut up', 'get lost', 'loser', 'moron', 'ugly', 'out of my way'])) {
    out.affinity = -0.6; out.mood = -0.3; out.remember = 'insulted';
    if (p.brave > 0.55) out.reply = pick(['Excuse me? Watch your mouth.', 'Say that again, I dare you.', 'Wow. Get away from me.']);
    else { out.reply = pick(['Okay... I\'m leaving.', 'I don\'t want any trouble.']); out.end = true; }
    return out;
  }
  if (has(t, [' bye', 'see you', 'gotta go', 'take care', 'later '])) {
    out.end = true;
    out.reply = hostile ? 'Yeah. Bye.' : npc.relation > 0.3 ? pick(['See you around! Take care.', 'Bye! Nice talking to you.']) : pick(['Later.', 'See you.']);
    return out;
  }
  if (has(t, ['thank', 'cheers', 'appreciate'])) { out.reply = hostile ? 'Mm.' : pick(['No problem.', 'Anytime.', 'Sure thing.']); out.affinity = 0.1; return out; }
  if (has(t, ['sorry', 'apolog'])) {
    const forgive = p.friendly * 0.7 + 0.2 > 0.5;
    out.reply = forgive ? 'Alright. Apology accepted. Just be more careful.' : 'Sorry doesn\'t fix it.';
    out.affinity = forgive ? 0.6 : 0.1; out.remember = forgive ? 'apology' : null;
    return out;
  }
  if (has(t, ['stole', 'stolen', 'robbed', 'took my', 'hit my', 'lost my'])) {
    npc.learn({ id: 'told:' + Math.floor(now), text: `A stranger told me: "${line.slice(0, 120)}"`, tags: tokenize(line), importance: 0.5, confidence: 0.6, source: 'heard', from: 'a stranger' });
    out.reply = hostile ? 'Not my problem.' : p.friendly > 0.5 ? 'Seriously? That\'s awful. You should report it to the police. People around here notice things, someone might have seen it.' : 'Rough. Can\'t help you, though.';
    out.affinity = hostile ? 0 : 0.05;
    return out;
  }
  const asksSeen = has(t, ['seen', ' see ', ' saw ', 'notice', 'witness', 'what happened', 'heard', 'hear about', 'news', 'anything happen', 'going on']);
  if (asksSeen || relevant.length) {
    if (hostile && p.friendly < 0.4) { out.reply = 'Even if I knew, why would I tell you?'; return out; }
    if (relevant.length) {
      out.reply = tellFact(relevant[0], now) + (p.curious > 0.6 ? ' Why do you ask?' : '');
      out.cited = [relevant[0].id];
    } else if (asksSeen) {
      const news = facts[0] && !tokenize(line).length ? facts[0] : null;
      out.reply = news ? 'Not much. ' + tellFact(news, now) : pick(['No, sorry. I haven\'t seen anything like that.', 'Can\'t say I have.', 'Nope, nothing.']);
    }
    out.affinity = 0.03;
    return out;
  }
  if (has(t, ['where', 'how do i get', 'nearest', 'looking for', 'way to'])) {
    const P = game.player.pos;
    const kinds = [[['gas', 'fuel', 'petrol'], 'gas'], [['beach', 'ocean', 'sea', 'swim'], 'beach'], [['pier'], 'beach'], [['park'], 'park'], [['tower', 'tallest', 'downtown'], 'landmark'], [['police', 'station', 'cop'], 'police'], [['hospital', 'doctor', 'clinic'], 'hospital']];
    for (const [words, kind] of kinds) {
      if (!has(t, words)) continue;
      const list = game.world.pois.filter((x) => x.kind === kind || (kind === 'beach' && x.name.includes(words[0] === 'pier' ? 'Pier' : 'beach')));
      const best = list.sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
      if (best) { out.reply = `${best.name}? It's ${directions(P.x, P.z, best.x, best.z)}.`; out.affinity = 0.05; return out; }
    }
    if (has(t, ['wreck', 'treasure', 'ship'])) { out.reply = p.job.includes('marine') || p.job === 'surfer' ? 'The wreck is south-west of the pier, way out in deep water. Bring a lot of breath.' : 'Divers talk about some old wreck offshore. No idea where exactly.'; return out; }
    out.reply = 'Hmm, not sure. What are you looking for?';
    return out;
  }
  if (has(t, ['what do you do', 'your job', 'work', 'up to', 'doing'])) { out.reply = `I'm ${p.goal}. I work as a ${p.job}.` + (p.chatty > 0.4 ? ' ' + p.topic : ''); out.affinity = 0.08; return out; }
  if (has(t, ['how are you', 'how\'s it going', 'how are things', 'you okay', 'how you doing'])) {
    out.reply = hostile ? 'Better before you showed up.' : npc.fear > 0.5 ? 'Honestly? Still shaken up.' : npc.mood > 0.3 ? 'Pretty good, thanks!' : npc.mood < -0.2 ? 'Long day. Really long.' : 'Not bad. Busy.';
    out.affinity = hostile ? 0 : 0.08; out.mood = 0.05;
    return out;
  }
  if (has(t, ['name', 'who are you'])) { out.reply = `I'm ${p.first}. ${p.first} ${p.last}.`; out.affinity = 0.05; return out; }
  if (has(t, ['weather', 'rain'])) { out.reply = game.weather.rain > 0.3 ? 'This rain is miserable. I forgot my umbrella.' : 'Nice out, isn\'t it?'; return out; }
  // small talk, maybe some gossip
  if (hostile) { out.reply = pick(['What do you want?', 'I\'m busy.', 'Make it quick.']); return out; }
  const news = npc.knowledge.filter((k) => k.importance >= 0.4).sort((a, b) => b.t - a.t)[0];
  out.reply = news && p.chatty > 0.45 ? 'Did you hear? ' + tellFact(news, now) : pick(['Ha, sure.', 'Is that so?', 'Hm. Interesting.', 'Okay... anything else?']);
  out.affinity = 0.03;
  return out;
}

/** Ask Claude through the desktop app (if a key is set). Returns null to fall back to localReply. */
export async function modelReply(game, npc, line, history) {
  if (!window.neon || !(await window.neon.hasApiKey())) return null;
  const facts = recall(npc.knowledge, line, game.time, 8);
  const payload = {
    character: {
      name: npc.name, age: npc.profile.age, job: npc.profile.job, doing: npc.profile.goal, traits: {
        friendliness: npc.profile.friendly, bravery: npc.profile.brave, chattiness: npc.profile.chatty, curiosity: npc.profile.curious },
      mood: describe(npc), fear: npc.fear, anger: npc.anger, relationship_with_player: clamp(npc.relation / 3, -1, 1),
      history_with_player: npc.memory.map((m) => m.type), time: game.env.timeString(), weather: game.weather.rain > 0.3 ? 'raining' : 'clear',
      player_looks_like: game.player.appearance,
    },
    memories: facts.map((f) => ({ id: f.id, what: f.text, how_known: f.source, told_by: f.from, minutes_ago: Math.round((game.time - f.t) / 60), confidence: +f.confidence.toFixed(2) })),
    places: game.world.pois.map((p) => `${p.name}: ${directions(game.player.pos.x, game.player.pos.z, p.x, p.z)}`).slice(0, 25),
    conversation: history.slice(-8),
    player_says: line.slice(0, 400),
  };
  try {
    const r = await window.neon.askClaude(payload);
    if (!r || typeof r.reply !== 'string' || !r.reply.trim() || r.reply.length > 400) return null;
    const known = new Set(facts.map((f) => f.id));
    return {
      reply: r.reply.trim(), affinity: clamp(+r.affinity_delta || 0, -0.6, 0.6), mood: clamp(+r.mood_delta || 0, -0.5, 0.5),
      end: r.intent === 'end_conversation' || r.intent === 'leave', remember: r.intent === 'insulted' ? 'insulted' : null,
      cited: (r.cited_memory_ids || []).filter((id) => known.has(id)), byModel: true,
    };
  } catch (e) {
    return null;
  }
}

export function relevanceOf(npc, line) { return recall(npc.knowledge, line, 0, 1).map((f) => relevance(tokenize(line), f)); }
