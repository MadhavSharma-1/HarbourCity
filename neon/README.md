# Project Neon: AI-native open-world prototype (Unreal Engine 5)

Phase 1 is a small city district with one player character, one drivable car, and **ten autonomous
citizens**. Each citizen has a personality, needs, money, a job, a home, a daily routine, relationships
and persistent memory, and can talk with you in natural language. Their simulated lives continue
whether or not you interact with them.

```
neon/
├── ProjectNeon/                      Unreal Engine 5 C++ project (open ProjectNeon.uproject)
│   ├── Config/                       renderer (Lumen, VSM, Nanite, TSR), input, AI service settings
│   └── Source/ProjectNeon/
│       ├── Core/      NeonTypes            enums + structs (memory record, world event, place…)
│       │              NeonSimSubsystem     clock, places, sidewalk graph, event bus, tiers, economy
│       │              NeonGameMode         spawns district/NPCs/cars, autosave, console commands
│       │              NeonSaveGame         JSON save (Saved/Neon/world.json)
│       ├── NPC/       NeonNPC              the citizen (character + components below)
│       │              NPCIdentityComponent identity, backstory, job, home, personality traits
│       │              NPCMemoryComponent   working / episodic / semantic memory, retrieval, consolidation
│       │              NPCNeedsComponent    energy, hunger, social, fun, wages, rent, financial stress
│       │              NPCEmotionComponent  valence, arousal, fear, anger, joy, stress (numeric)
│       │              NPCRelationshipComponent affinity, trust, familiarity, romance, conflicts
│       │              NPCPerceptionComponent   sight cone + line of sight + hearing radius
│       │              NPCScheduleComponent daily routine that adapts (e.g. after job loss)
│       │              NPCDialogueComponent conversations with the player, speech bubbles
│       │              NPCDecisionController utility AI + optional LLM proposals + activity execution
│       │              NPCRoster            the ten citizens and their starting relationships
│       ├── AI/        NeonAIClient         async HTTP to the AI service, budget, validation
│       │              NeonRuleDialogue     offline, memory-grounded dialogue (no model needed)
│       │              NeonMemoryLogic      tokenizer + relevance/importance/recency retrieval
│       ├── Player/    NeonCharacter, NeonPlayerController (talk UI, enter/exit car, save/load)
│       ├── Vehicle/   NeonVehicle          raycast suspension, tyre friction circles, fuel, damage, lights
│       ├── World/     NeonCityGenerator    3×3-block district, 14 places, park, gas station, lights
│       │              NeonEnvironment      sun/moon, SkyAtmosphere, clouds, fog, day-night, rain
│       │              NeonMaterials        runtime materials (no assets required)
│       ├── UI/        NeonHUD              clock, money, car gauges, prompts, bubbles, sim overlay
│       └── Tests/     NeonAutomationTests  memory retrieval, grounding, AI response validation
└── ai_service/                       optional AI orchestration service (Python, FastAPI)
    ├── app/main.py                   /health, /v1/dialogue, /v1/decide, /v1/memory/sync
    ├── app/schemas.py                request/response schemas + validation + grounding filter
    ├── app/providers.py              Claude (Anthropic SDK), Ollama (local), rules
    ├── app/schema.sql                SQLite: npc_memory, dialogue_log, decision_log
    ├── prompts/                      system prompts for dialogue and decisions
    └── tests/test_service.py         8 tests
```

No Blueprints or content assets are needed. The district, materials, lighting and characters are all
created from C++ at runtime, so the project runs as soon as it compiles. See "Making it look real"
below for swapping in high-end art.

---

## 1. Setup on a Mac (Apple Silicon)

1. **Install Xcode** from the App Store, open it once to accept the licence, then run
   `xcode-select --install`.
2. **Install Unreal Engine 5.5** (5.4 also works) through the Epic Games Launcher (Unreal Engine > Library > +).
3. **Open the project:** double-click `neon/ProjectNeon/ProjectNeon.uproject`. When asked
   *"Missing modules… rebuild now?"* click **Yes**. The first build takes a few minutes.
   To build from Terminal instead:
   ```bash
   "/Users/Shared/Epic Games/UE_5.5/Engine/Build/BatchFiles/Mac/Build.sh" ProjectNeonEditor Mac Development -project="$PWD/neon/ProjectNeon/ProjectNeon.uproject"
   ```
4. **Recommended: add proper characters.** In the editor go to *Content Browser > Add > Add Feature or Content Pack >
   Third Person*. The code automatically uses the Manny/Quinn mannequins and their animation blueprints
   when they exist. Without them, people appear as simple placeholder bodies.
5. Press **Play** (Alt+P). The empty Entry map is fine, because the game mode builds the district.

On Windows the steps are the same with Visual Studio 2022 ("Game development with C++" workload).

### Optional: the AI service (natural-language NPCs)

Without the service, NPCs use the built-in rule-based dialogue. It is still grounded in their memories,
but limited to understood topics. With the service, NPCs answer anything in character, using only their own memories.

```bash
cd neon/ai_service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then edit .env
```

Choose one brain in `.env`:

| `NEON_PROVIDER` | What it uses | Notes |
|---|---|---|
| `anthropic` | Claude (`claude-opus-5-5`, structured JSON output, `effort=low` for fast replies) | Set `ANTHROPIC_API_KEY` in `.env`. The key stays in the service and never goes into the game. Change the model with `NEON_ANTHROPIC_MODEL`. |
| `ollama` | A local model through [Ollama](https://ollama.com) | Free and offline, and runs well on Apple Silicon: `ollama pull llama3.1:8b`. |
| `rules` | No model | The service reports itself as rules-only and the game uses its local rules. |

Start it, then press Play:

```bash
set -a && source .env && set +a
uvicorn app.main:app --host 127.0.0.1 --port 8787
```

The HUD shows `NPC dialogue: anthropic` (or `ollama`) when it's connected. The game re-checks every 30 s.

---

## 2. Controls

| Key | Action |
|---|---|
| WASD, mouse | Move, look |
| Shift / Space | Sprint / jump (handbrake in the car) |
| **E** | Talk to the nearest person, then type freely and press Enter. Type "bye" or press Esc to leave. |
| **F** | Get in or out of a car |
| L / H / R | Headlights / horn / hold to refuel at Bayline Fuel |
| T (hold) | Fast-forward time ×30 |
| **N** | Simulation overlay: every NPC's tier, activity, reason, mood, needs, money, memories, plus events, revenue and emergency calls |
| K or F5 / O or F9 | Save / load (also autosaves every 5 min and on exit) |

Console commands (press the backtick key, `` ` ``):
`Neon.FireNPC Daniel`, `Neon.HireNPC Hugo CornerBean`, `Neon.Time 12.5`, `Neon.Weather rain`,
`Neon.SetOperating CornerBean 0`, `Neon.Who`, `Neon.Save`, `Neon.Load`.

---

## 3. How it works

### Information is grounded: NPCs only know what reached them
1. Things that happen (crashes, near-misses, horns, job loss) are published as **world events**
   with a location, an eyewitness description, a "what it sounded like" description, and audible and visible radii.
2. Each NPC's **perception** decides whether it *saw* the event (in range, inside its field of view,
   line-of-sight trace clear), only *heard* it, or knows nothing. There is no global knowledge.
3. What was perceived becomes a **memory** with source, confidence, importance, time, place and emotional state.
4. Information then spreads **only through conversation**. When two NPCs chat, they pass on interesting
   memories as hearsay (`ToldBy`, with lower confidence). An NPC who hears a crash can walk over to look
   and turn "heard" into "observed".
5. When you talk to an NPC, the request contains only that NPC's **retrieved memories**. The prompt forbids
   inventing facts, the service drops citations of memories the NPC doesn't have, and the game validates
   the result a second time. If you ask about something they never witnessed, they say they don't know.

**Example to try.** Drive the black sports car fast past Corner Bean, then crash it into Marcus's blue hatchback
(parked on the west road by Dockside Flats). Afterwards:
- people who saw it remember "A black sports car crashed into a parked blue hatchback near Dockside Flats".
- some call emergency services (high empathy), some walk over to look (curious and brave), some leave (fearful).
- Marcus, whether or not he saw it, notices the damage the next time he sees his car and gets angry.
- witnesses tell their friends over the next hours. Ask Lena later "have you seen a black sports car?"
  and she answers from her own memory, or from what Tomas told her, and says which.

### Memory architecture (three levels)
| Level | Contents | Retention |
|---|---|---|
| Working | what just happened, what you just said | about 1 game hour, then promoted if important (≥ 0.4) or forgotten |
| Episodic | crashes, conversations, losing a job, arguments | up to 160 per NPC; importance slowly decays; least important dropped first |
| Semantic | home, job, people they know, their backstory | kept and updated in place |

Every record has an NPC id, event type, timestamp, location and place, participants, confidence, importance,
source (`Observed` / `Heard` / `ToldBy` / `Conversation` / `Self`) plus who told them, the emotional state at
the time, and an expiry. The fields match `ai_service/app/schema.sql`. Retrieval scores keyword relevance
(55 %), importance (25 %) and recency (20 %), scaled by confidence.

### Decision-making (hybrid)
- **Utility AI** (`NPCDecisionController::Decide`) scores the schedule's proposal against needs (hunger,
  exhaustion, loneliness, boredom), money (no café lunch when broke), relationships (who to go and chat with)
  and reactions to perceived events (flee, investigate, call emergency services, confront, or ignore). The
  reaction weights come from personality traits and current fear and anger.
- **LLM proposals**: for nearby (tier 1) NPCs reacting to a serious event, the controller can ask
  `/v1/decide` for a high-level proposal, using exactly the schema in your brief. It is used only if the action
  is in the allowed list, the event is still current, and the NPC isn't busy. A model can never execute
  game commands.
- **Execution**: a small state machine walks the sidewalk graph (A*), enters and leaves buildings, buys
  things (the economy records each sale), chats, gossips, argues, makes up, investigates, flees, phones for help, or
  confronts the driver.
- **Simulation tiers**: tier 1 (< 30 m) decides 4× a second; tier 2 (< 90 m) once a second; tier 3
  moves abstractly with no physics; tier 4 is indoors (hidden, needs and economy still simulated).

### Living without the player
Each NPC follows a daily routine with jitter (wake up, commute, work, lunch, back to work, home, shop, dinner or
the park, sleep) and weekends differ. Wages are paid while working and rent is due at midnight. Financial stress
lowers their resting mood and changes spending. `Neon.FireNPC Daniel` makes Daniel lose his job: his routine
turns into job hunting at the City Job Centre, he stops buying café lunches, he tells friends (who react
according to their empathy), his mood drops, and each hour at the job centre gives him a chance to be hired
somewhere new. Hugo starts the game unemployed, so you can watch this happen from the first minute.

### Vehicle
A single rigid body with four raycast wheels. Spring and damper suspension. Each tyre has a friction circle
scaled by its own load, which gives weight transfer under braking and cornering. Rear-wheel drive with a
constant-power engine curve, brakes, handbrake (rear grip drops, so the car drifts), aerodynamic drag and
rolling resistance. Grass and wet roads reduce grip (`Neon.Weather rain`). Fuel is consumed
(about 3× real rates, for gameplay) and you refuel by paying at Bayline Fuel. Crashes reduce engine health
(less power, then no engine), break the headlights on front impacts, and visibly deform the body.

### Save system
`Saved/Neon/world.json` is human-readable and stores only the state that can't be rebuilt: the clock;
each NPC's position, job, money, needs, emotions, episodic and semantic memories, and relationships; vehicle
position, fuel and damage; business status and revenue; and emergency reports. On save, memories are also
mirrored to the service's SQLite database (`GET /v1/memory/NPC_LENA` lists them).

---

## 4. Testing

**AI service** (no API key needed; a fake model is used):
```bash
cd neon/ai_service && python -m pytest -q        # 8 passed
```
Covers schema validation, out-of-range values, unknown intents, the provider-down fallback, invented
memory citations being removed, decision allow-listing, and the memory database round-trip.

**C++ automation tests:** in the editor, open *Tools > Session Frontend > Automation*, filter `Neon`, then Run. Or headless:
```bash
"/Users/Shared/Epic Games/UE_5.5/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor" \
  "$PWD/neon/ProjectNeon/ProjectNeon.uproject" -ExecCmds="Automation RunTests Neon; Quit" -unattended -nullrhi -log
```
Covers the tokenizer, relevance ranking, "no invented knowledge" retrieval, memory expiry, and dialogue and decision validation.

**Manual checks (press N for the overlay):**
1. Fast-forward with T. NPCs leave home around 7–9, disappear into workplaces, come out for lunch, and go home in the evening.
2. Crash into Marcus's car within sight of people. Check the overlay's events and emergency-call count, then talk to a witness.
3. Talk to someone who was indoors at the time and ask about the crash. They don't know, unless a friend told them.
4. `Neon.FireNPC Daniel`, then follow him (`Neon.Who`). Later, talk to Lena and ask how Daniel is doing.
5. Save (K), quit, Play again. Memories, relationships and car damage persist.

**Performance:** run `stat unit`, `stat fps` and `stat gpu` in the console. Budget: the full NPC simulation
is well under 1 ms per frame for 10 NPCs. Tier-based update rates keep it linear as the population grows.
LLM calls are asynchronous, capped (`MaxInFlight=2`), rate-limited per NPC (`DecisionCooldownSeconds`),
and never block a frame. On a Mac, if the frame rate is low, set *Settings > Engine Scalability* to High
and, if needed, `r.ScreenPercentage 75`. TSR upscales.

---

## 5. Implemented vs planned

| Area | Phase 1 status |
|---|---|
| District, third-person character, drivable car | ✅ implemented (basic shapes, PBR materials, Lumen, VSM, sky, clouds, fog) |
| 10 autonomous NPCs with identity, traits, goals, jobs, homes | ✅ |
| Typed natural-language conversations | ✅ via Claude or a local LLM, with a grounded rules fallback |
| Three-level persistent memory with retrieval and source tracking | ✅ |
| Perception: sight, line of sight, hearing | ✅ (custom lightweight component, not `UAIPerceptionComponent`) |
| Utility AI + LLM proposals with validation | ✅ |
| Schedules, needs, wages, rent, spending, job loss and job hunting | ✅ |
| Relationships, gossip, arguments, reconciliation, romance values | ✅ (romance is numeric only) |
| Emergency calls by witnesses | ✅ (logged; nobody responds yet) |
| Save/load, autosave, memory DB mirror | ✅ |
| Weather-dependent grip, rain fog | ✅ (no rain particles or wet-road shader yet) |
| Voice input, TTS, lip sync, facial animation | ⏳ Phase 2 (planned: Whisper STT, TTS from the service, MetaHuman Animator / Audio2Face) |
| GOAP planner | ⏳ Phase 2 (utility AI covers Phase 1) |
| Police, ambulances, traffic AI, crowds, shops you can enter, phone | ⏳ Phase 3 |
| Photoreal characters (MetaHuman), scanned city assets, ray tracing | ⏳ Phase 4 (see below) |

## 6. Making it look real (Phase 4 path)

The code is built so art can be dropped in without changing the simulation:
- **People:** create MetaHumans (free, in the MetaHuman Creator / UE 5.5 MetaHuman plugin), then make a Blueprint
  child of `NeonNPC` and set *Body Mesh Asset* and *Anim Class*, or point `ApplyLook()` at a per-NPC MetaHuman.
  For movement quality, use the free *Game Animation Sample* (motion matching).
- **City:** Epic's free *City Sample* and *Fab* / Quixel Megascans Nanite assets. Subclass `NeonCityGenerator`
  and assign the mesh slots, or place art by hand and keep the generator for places and the sidewalk graph.
- **Mac note:** Lumen and Nanite run on Apple Silicon, but hardware ray tracing isn't available on macOS.
  The City Sample needs a lot of memory (32 GB or more). Photoreal, City Sample-scale scenes are better built on a
  Windows PC with a recent RTX GPU.

## 7. Safety & security
- API keys live only in `ai_service/.env` (git-ignored). The game holds no secrets.
- The model returns data in a fixed schema. Values are range-checked twice (service and game), actions are
  allow-listed, memory citations are checked against what the NPC actually knows, and the game's own rules
  make the final call. Nothing the model says can run a command, modify files, or bypass the simulation.
- All behaviour is limited to the fictional city.
