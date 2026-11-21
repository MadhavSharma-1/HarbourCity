import { pick, compass, roundDist, clamp } from './util.js';

/*
  Rule-based conversation system. Each NPC has a personality (friendliness, bravery, chattiness),
  a mood, a daily goal and a memory of what the player has done to them. Replies are assembled
  from those, plus the time of day and real directions to places on the map.
*/

const F_NAMES = ['Maya', 'Sofia', 'Lena', 'Ava', 'Priya', 'Chloe', 'Nadia', 'Rosa', 'Grace', 'Hana', 'Zoe', 'Isabel', 'Amara', 'Keiko', 'Elena', 'Fatima', 'Jade', 'Lucia', 'Mei', 'Tara'];
const M_NAMES = ['Marcus', 'Leo', 'Daniel', 'Omar', 'Ravi', 'Jake', 'Andre', 'Tomas', 'Kenji', 'Luis', 'Sam', 'Victor', 'Eli', 'Noah', 'Hugo', 'Malik', 'Ivan', 'Theo', 'Diego', 'Arjun'];
const LAST = ['Reyes', 'Carter', 'Nguyen', 'Okafor', 'Silva', 'Kowalski', 'Haddad', 'Patel', 'Moreau', 'Jensen', 'Tanaka', 'Rossi', 'Bennett', 'Alvarez', 'Novak', 'Mensah', 'Park', 'Dubois'];

const JOBS = [
  { job: 'barista', goals: ['opening up the café', 'heading to my shift at the café', 'on a break from the espresso machine'], topic: 'Everyone in this city runs on oat-milk lattes. Me included.' },
  { job: 'nurse', goals: ['heading to the hospital for a night shift', 'finally off work after twelve hours', 'grabbing food before my shift'], topic: 'You would not believe how many people come in after crashing on the boulevard. Drive careful.' },
  { job: 'software developer', goals: ['walking to clear my head — there\'s a bug I can\'t fix', 'on my way to a standup that should have been an email', 'looking for a quiet café with Wi-Fi'], topic: 'I\'m building an app that tells you where traffic lights are. Nobody asked for it.' },
  { job: 'mechanic', goals: ['picking up parts for a gearbox', 'heading back to the garage', 'on lunch'], topic: 'If your engine starts smoking, stop driving it. Seriously. And keep an eye on your fuel.' },
  { job: 'student', goals: ['skipping a lecture, don\'t tell anyone', 'heading to the library', 'meeting friends at the pier'], topic: 'Rent here is insane. I live with four roommates and a cat named Taxes.' },
  { job: 'surfer', goals: ['checking the swell at the beach', 'waxing my board later', 'heading down to the pier'], topic: 'The reef past the pier is unreal. Fish everywhere. Just watch your breath down there.' },
  { job: 'retired teacher', goals: ['taking my afternoon walk', 'feeding the pigeons in the park', 'going to the pharmacy'], topic: 'This city used to be all warehouses. Now it\'s towers everywhere you look.' },
  { job: 'delivery driver', goals: ['on my last drop of the day', 'looking for parking, as usual', 'grabbing a coffee between deliveries'], topic: 'The traffic lights downtown are timed by someone who hates drivers.' },
  { job: 'musician', goals: ['heading to a gig tonight', 'busking by the park', 'looking for inspiration'], topic: 'I play at a bar near the beach on weekends. The sunset sets are the best.' },
  { job: 'real estate agent', goals: ['showing an apartment in ten minutes', 'heading downtown for a meeting', 'trying to close a deal'], topic: 'Vista Tower penthouse is on the market. Interested? No? Didn\'t think so.' },
  { job: 'marine biologist', goals: ['going to the dive shop', 'heading out to check the reef sensors', 'writing up my research'], topic: 'There\'s an old cargo wreck offshore, south-west of the pier, about 40 meters down. People say there\'s treasure in it.' },
  { job: 'chef', goals: ['heading to the market for fish', 'on my way to the restaurant', 'escaping the kitchen for five minutes'], topic: 'The best fish tacos in town are by the pier. Don\'t tell my boss I said that.' },
  { job: 'police dispatcher', goals: ['getting off a long shift', 'heading in to work', 'getting some air'], topic: 'Half the calls I get are about people driving on the sidewalk. Don\'t be that person.' },
  { job: 'tourist', goals: ['trying to find the beach', 'looking at the skyscrapers', 'lost, honestly'], topic: 'Your city is beautiful! The ocean is so blue. Is it always this warm?' },
];

export function makeProfile(rand = Math.random) {
  const female = rand() < 0.5;
  const j = pick(JOBS, rand);
  return {
    female,
    first: pick(female ? F_NAMES : M_NAMES, rand),
    last: pick(LAST, rand),
    age: 18 + Math.floor(rand() * 60),
    job: j.job, topic: j.topic, goal: pick(j.goals, rand),
    friendly: rand(), brave: rand(), chatty: rand(),
    voicePitch: female ? 1.1 + rand() * 0.4 : 0.7 + rand() * 0.35,
  };
}

export function timeWord(h) {
  if (h < 5) return 'night'; if (h < 12) return 'morning'; if (h < 17) return 'afternoon'; if (h < 21) return 'evening'; return 'night';
}

/** Short reactive lines shouted in the street. */
export const BARKS = {
  nearMiss: ['Whoa! Watch where you\'re going!', 'Slow down, maniac!', 'Are you trying to kill someone?!', 'That was way too close!', 'Hey! This is a crosswalk!'],
  nearMissScared: ['Aaah!', 'Oh my god!', 'Help!', 'Nope nope nope!'],
  hit: ['Ow! You hit me!', 'My leg…', 'Somebody call an ambulance!', 'What is wrong with you?!'],
  witnessHit: ['Oh no, someone got hit!', 'Did you see that?!', 'Someone call 911!', 'Hit and run!'],
  crash: ['Whoa, did you see that crash?', 'Ouch, that\'s gonna cost.', 'Is everyone okay?', 'Yikes!'],
  horn: ['Alright, alright!', 'I hear you!', 'Relax, buddy!', 'Honk all you want.', 'Jeez, what?'],
  sidewalk: ['Get off the sidewalk!', 'This is for people!', 'Are you crazy?!'],
  personalSpace: ['Can I help you?', 'Personal space, please.', 'Uh… why are you standing so close?', 'Do I know you?'],
  bumped: ['Hey, watch it!', 'Excuse YOU.', 'Ow, careful!', 'Look where you\'re walking!'],
  greetFriendly: ['Hey there!', 'Nice day, huh?', 'Hi!', 'Evening!', 'How\'s it going?'],
  niceCar: ['Nice car!', 'Sweet ride!', 'Whoa, love that car.'],
  carjackWitness: ['Hey! He\'s stealing that car!', 'Someone call the cops!', 'That\'s not your car!'],
  swim: ['Careful in the water, the currents are strong.', 'Enjoy your swim!'],
  night: ['Late night, huh?', 'Can\'t sleep either?'],
  chat: [
    ['Did you see the traffic on the boulevard today?', 'Terrible. Took me forty minutes to get across downtown.'],
    ['Are you going to the beach this weekend?', 'If the weather holds, absolutely.'],
    ['Gas prices again. $1.79 a liter!', 'I know. I\'m thinking of getting a bike.'],
    ['Have you tried the new taco place by the pier?', 'Yes! The fish tacos are incredible.'],
    ['I heard someone found gold coins near the old shipwreck.', 'People say that every summer. Nobody ever shows the coins.'],
    ['My landlord raised the rent again.', 'Same here. This city is getting expensive.'],
    ['Did you watch the Harbor Gulls game last night?', 'Don\'t remind me. We lost in overtime.'],
    ['They\'re building another tower downtown.', 'Soon you won\'t be able to see the sky.'],
    ['Somebody drove right over the curb earlier!', 'People drive like maniacs around here.'],
    ['Look at that sunset.', 'Best thing about living by the ocean.'],
  ],
};

function relationWord(npc) {
  const r = npc.relation;
  if (r < -1.2) return 'hostile'; if (r < -0.3) return 'wary'; if (r > 0.8) return 'friendly'; return 'neutral';
}

function moodLabel(npc) {
  if (npc.fear > 0.5) return 'scared';
  if (npc.anger > 0.5) return 'angry';
  if (npc.mood > 0.45) return 'cheerful';
  if (npc.mood < -0.3) return 'grumpy';
  return 'calm';
}

export function describe(npc) {
  const p = npc.profile;
  return `${p.age} · ${p.job} · feels ${moodLabel(npc)} · ${relationWord(npc)} toward you`;
}

export function openLine(npc, ctx) {
  const p = npc.profile, m = npc.memory;
  const has = (k) => m.some((e) => e.type === k);
  if (has('hit')) return pick(['You! You\'re the lunatic who ran me over! What do you want?', 'Stay away from me. You hit me with your car!', 'Oh great, it\'s you. My hip still hurts, by the way.']);
  if (has('carjacked')) return 'You stole my car! You have some nerve talking to me.';
  if (has('insulted') && npc.relation < -0.3) return pick(['What now? Come to insult me again?', 'Oh. You again.', '…What.']);
  if (npc.fear > 0.6) return pick(['P-please, I don\'t want any trouble.', 'Uh… hi. Are you going to hurt me?', 'What do you want? I just want to get home.']);
  if (npc.anger > 0.6) return pick(['I\'m not in the mood, alright?', 'Make it quick.', 'Ugh. What?']);
  if (has('nice') && npc.relation > 0.4) return pick([`Oh hey, it's you again! Good ${timeWord(ctx.hour)}.`, 'Hey friend! Back for more small talk?', `Hi again! Still ${p.goal}, believe it or not.`]);
  const tw = timeWord(ctx.hour);
  if (p.friendly > 0.65) return pick([`Hi! Good ${tw}! I'm ${p.first}.`, `Hey there! Lovely ${tw}, isn't it? I'm ${p.first}.`, `Oh, hello! I'm ${p.first}. You new around here?`]);
  if (p.friendly < 0.3) return pick(['Yeah?', 'Do I know you?', 'Can I help you with something?', 'I\'m kind of busy.']);
  return pick([`Hey. Good ${tw}.`, 'Hi. What\'s up?', `Hello. Name's ${p.first}.`]);
}

export function options(npc, ctx) {
  const o = [
    { id: 'how', text: 'How\'s your day going?' },
    { id: 'what', text: 'What are you up to?' },
    { id: 'gas', text: 'Where\'s the nearest gas station?' },
    { id: 'spots', text: 'Know any good places around here?' },
  ];
  if (npc.memory.some((e) => e.type === 'hit' || e.type === 'carjacked' || e.type === 'insulted' || e.type === 'nearmiss'))
    o.push({ id: 'sorry', text: 'Look… I\'m sorry about earlier.' });
  else o.push({ id: 'compliment', text: 'You seem like a nice person.' });
  o.push({ id: 'rude', text: 'Get out of my way.' });
  o.push({ id: 'bye', text: 'See you around.' });
  return o;
}

export function respond(npc, id, ctx) {
  const p = npc.profile;
  const hostile = npc.relation < -1.0 || npc.anger > 0.7;
  let text = '', gesture = 'talk', end = false, dMood = 0, dRel = 0, mem = null;
  switch (id) {
    case 'how': {
      if (hostile) { text = pick(['It WAS fine until you showed up.', 'Worse now, thanks.']); gesture = 'angry'; break; }
      const h = ctx.hour;
      const late = h >= 23 || h < 5;
      if (npc.mood > 0.4) text = pick(['Honestly? Pretty great.', 'Really good, thanks for asking!', 'Can\'t complain!']) + ' ' + (late ? 'Even if it\'s way past my bedtime.' : 'The weather\'s been perfect.');
      else if (npc.mood < -0.2) text = pick(['Long. Really long.', 'Could be better.', 'Don\'t ask.']) + ' ' + pick(['My boss has been on my case.', 'I got a parking ticket this morning.', 'Traffic was a nightmare.']);
      else text = pick(['Not bad. Just another day in the city.', 'Fine, I guess. Busy.', 'Same as always.']);
      dRel = 0.15; dMood = 0.1; mem = 'nice';
      break;
    }
    case 'what': {
      if (hostile) { text = 'None of your business.'; gesture = 'shrug'; break; }
      text = `I'm ${p.goal}. I work as a ${p.job}. ` + (p.chatty > 0.4 ? p.topic : '');
      dRel = 0.1;
      break;
    }
    case 'gas': {
      const gs = ctx.nearestGas;
      if (!gs) { text = 'No idea, sorry.'; gesture = 'shrug'; break; }
      if (hostile && p.friendly < 0.5) { text = 'Figure it out yourself.'; gesture = 'shrug'; break; }
      const rel = gs.relative;
      text = `${gs.name}? Head ${gs.dir}, ${roundDist(gs.dist)}. ${rel}` + (gs.dist > 500 ? ' It\'s a bit of a hike on foot.' : '');
      gesture = 'point'; npc.pointAt = gs; dRel = 0.05;
      break;
    }
    case 'spots': {
      if (hostile) { text = 'Yeah. Anywhere you aren\'t.'; gesture = 'angry'; break; }
      const poi = ctx.suggestion;
      const lines = {
        landmark: `Go see ${poi.name}, the tallest building in the city. You can't miss it, it's ${poi.dir} of here.`,
        park: `${poi.name} is nice, ${roundDist(poi.dist)} ${poi.dir}. There's a fountain in the middle.`,
        beach: `The beach! Head south to the ocean. The pier is great at sunset, and the reef off the pier is amazing if you can hold your breath.`,
        wreck: `Divers talk about a sunken cargo ship south-west of the pier, way out in deep water. Bring lungs.`,
        gas: `Honestly? ${poi.name}. They have good coffee in the shop.`,
      };
      text = lines[poi.kind] || 'The beach is always nice.';
      if (p.job === 'marine biologist' || p.job === 'surfer') text = BARKS.chat[4][0].replace('I heard someone', 'Rumor is someone') + ' The wreck is south-west of the pier, deep down. There are kelp forests and a reef on the way.';
      gesture = 'point'; npc.pointAt = poi; dRel = 0.1; mem = 'nice';
      break;
    }
    case 'compliment': {
      if (p.friendly > 0.35) { text = pick(['Aw, thanks! You too.', 'That\'s sweet of you. Made my day.', 'Ha! Thanks, stranger.']); dMood = 0.3; dRel = 0.4; mem = 'nice'; gesture = 'wave'; }
      else { text = pick(['…Okay? Thanks, I guess.', 'Are you selling something?', 'Weird thing to say, but sure.']); dRel = 0.1; gesture = 'shrug'; }
      break;
    }
    case 'sorry': {
      const forgiving = p.friendly * 0.7 + npc.mood * 0.3 + 0.2;
      if (forgiving > 0.55) { text = pick(['…Fine. Apology accepted. Just be more careful, okay?', 'Alright. Everyone has a bad day. Don\'t do it again.', 'Thanks for saying that. Really.']); dRel = 0.8; npc.anger *= 0.3; npc.fear *= 0.5; mem = 'apology'; gesture = 'shrug'; }
      else { text = pick(['Sorry doesn\'t fix my bruises.', 'Save it.', 'I don\'t believe you.']); dRel = 0.2; gesture = 'angry'; }
      break;
    }
    case 'rude': {
      dRel = -0.7; dMood = -0.4; mem = 'insulted';
      if (p.brave > 0.6) { text = pick(['Excuse me?! Who do you think you are?', 'You get out of MY way.', 'Wow. Rude. Have a terrible day.']); gesture = 'angry'; npc.anger = Math.min(1, npc.anger + 0.6); }
      else { text = pick(['S-sorry! I\'m going!', 'Okay, okay, jeez.', 'Fine…']); npc.fear = Math.min(1, npc.fear + 0.4); end = true; gesture = 'shrug'; }
      break;
    }
    case 'bye': {
      text = npc.relation > 0.3 ? pick(['See ya! Stay safe.', 'Bye! Nice talking to you.', 'Take care!']) : npc.relation < -0.5 ? pick(['Good riddance.', 'Yeah, bye.']) : pick(['Later.', 'Bye.', 'See you.']);
      gesture = npc.relation > 0.3 ? 'wave' : null;
      end = true;
      break;
    }
  }
  npc.mood = clamp(npc.mood + dMood, -1, 1);
  if (mem) npc.remember(mem, dRel); else npc.relation += dRel;
  return { text, gesture, end };
}

/** Build the context the dialogue needs (directions are real, computed from the map). */
export function buildContext(game, npc) {
  const P = game.player.pos;
  const hour = game.env.hours;
  const yaw = game.player.heading;
  const rel = (dx, dz) => {
    const a = Math.atan2(dx, dz);
    let d = a - yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 0.6) return 'It\'s straight ahead of you.';
    if (Math.abs(d) > 2.4) return 'It\'s behind you.';
    return d > 0 ? 'It\'s off to your left.' : 'It\'s off to your right.';
  };
  let nearestGas = null;
  for (const st of game.world.gasStations) {
    const dx = st.x - P.x, dz = st.z - P.z, d = Math.hypot(dx, dz);
    if (!nearestGas || d < nearestGas.dist) nearestGas = { name: st.name, dist: d, dir: compass(dx, dz), relative: rel(dx, dz), x: st.x, z: st.z };
  }
  const pois = game.world.pois.map((p) => ({ ...p, dist: Math.hypot(p.x - P.x, p.z - P.z), dir: compass(p.x - P.x, p.z - P.z) }));
  pois.push({ name: 'the shipwreck', kind: 'wreck', x: game.underwater.wreckPos.x, z: game.underwater.wreckPos.z, dist: 0, dir: 'south-west' });
  const cand = pois.filter((p) => p.kind !== 'gas' || Math.random() < 0.2);
  const suggestion = pick(cand);
  return { hour, nearestGas, suggestion };
}
