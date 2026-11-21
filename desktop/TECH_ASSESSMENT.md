# Harbor City: honest technical assessment vs. the GTA VI reference shots

## Why it looked like a children's game

I inspected the code. Every visible object was generated from primitive shapes:

| Element | What it was | Why it read as "toy" |
|---|---|---|
| People | ~14 capsules and spheres per person, a painted face texture, procedural limb swinging | No real body shape, clothing, hair or skin, and no motion capture |
| Cars | Deformed boxes with flat-coloured lights | No real panels, interior, wheels or materials |
| Buildings | One stretched box per building, with windows drawn by a shader | Flat walls with no material detail, no balconies, signage or rooftop clutter |
| Trees and palms | Low-poly icosahedrons and stacked cylinders | Faceted look |
| Ground | Small procedurally drawn textures | Repetitive, no real surface detail |
| Lighting | Analytic sky, sun, one hemisphere light | Flat ambient light; reflections showed a synthetic sky |

None of that is a renderer limit on its own. It's a lack of **art assets**. AAA visuals are mostly scanned or hand-made models, textures and motion capture; code alone can't produce them.

## Can this engine reach GTA VI quality?

No. The game runs on **three.js (WebGL 2)** inside Electron. Compared with GTA VI's engine or Unreal Engine 5, it lacks:

- **Global illumination:** no dynamic GI (no Lumen equivalent), so indirect light is faked with a hemisphere light plus environment maps.
- **Shadows and geometry:** shadow-map resolution and draw distance are limited, and there's no virtualised geometry (no Nanite), so dense cities need heavy instancing and simplification.
- **Characters:** no skin subsurface scattering, strand hair, cloth simulation or facial rig of the MetaHuman kind.
- **Reflections and fog:** no ray tracing, and no volumetric fog or clouds beyond cheap approximations.

With good assets, three.js can look clean and attractive, but not like your reference shots.

**The realistic path to that look is Unreal Engine 5** (project skeleton already in `neon/ProjectNeon`). It needs:

- **Engine features:** Lumen, Nanite, Virtual Shadow Maps, MetaHumans, Chaos Vehicles, motion matching (the free Game Animation Sample), and Mass Entity for crowds.
- **Art:** Epic's free City Sample and Fab / Quixel Megascans assets.
- **Hardware:** a Windows PC with a recent RTX GPU and about 32 GB of RAM, both for development and for building the Windows installer.

Even then, GTA VI took hundreds of artists many years. A solo or small project can reach "convincing realistic district", not GTA VI.

## What changed in this round (implemented and tested)

1. **Real people.** Rigged human models (a man and a woman) replace the capsule people for the player and every NPC.
   - **Motion capture:** idle, walk, run and two gesture animations.
   - **Retargeting:** world-space retargeting (`bakeRetarget` in `js/assets.js`) so one set of animations drives different skeletons.
   - **Blending:** walk and run blend by speed; talking adds nodding and gesturing on top.
   - **Variety:** the male model's top, trousers, shoes, hair, hat and skin tone are tinted per person.
2. **A detailed car.** The player's sports car is now a full model (Khronos "Car Concept": body, interior, glass, rims, brakes). Its headlights, brake lights and indicators are driven by the existing light logic, its wheels spin and steer, and the physics is unchanged.
3. **Real reflections.** Captured HDR skies (city by day, sunset, night) now drive reflections on glass, car paint and water.
4. **Surface detail.** A real masonry/plaster texture is mapped onto building walls (varied per building), and the outskirts and parks use a real grass texture.
5. **Earlier visual pass, kept:** cloud layer, twilight sky, colour grading, pastel beachfront and neon tower crowns.

All gameplay is preserved: missions, police, ambulances, weather, phone, save/load, the citizens' grounded knowledge and gossip, and typed conversations.

## Scored against your five references (1 = far off, 10 = matches)

| Area | Before | Now | What's still missing |
|---|---|---|---|
| Environmental detail | 2 | 3 | Buildings are still boxes. Needs modular facades, balconies, signage, street furniture, litter. |
| Human realism | 1 | 4 | Only 2 body models (crowds repeat). Stylised, game-quality faces, no facial animation or lip-sync, no hair or cloth simulation. |
| Lighting quality | 3 | 4 | No GI or volumetrics. Night lighting is approximate. |
| Texture quality | 2 | 3 | Only roads, walls and grass use real textures. Most surfaces are still flat colour. |
| Vehicle realism | 2 | 5 (player car) / 2 (traffic) | AI traffic still uses box cars. No car interior view. |
| Animation quality | 1 | 5 | Mocap locomotion is in. No motion matching, foot IK on slopes, sitting, entering cars or climbing. |
| Population density | 3 | 3 | Tens of people, not hundreds. Beaches are sparse. |
| Urban authenticity | 2 | 2 | No neighbourhood identities, interiors, shops you can enter, or graffiti. |
| Atmosphere | 3 | 4 | Fake clouds; no volumetric haze or god rays above water. |
| Cinematic presentation | 2 | 3 | No depth of field, motion blur or cinematic cameras. |

## Placeholders still in the game (unfinished)

- **Vehicles and props:** AI traffic cars, police cars and ambulances are box-based. Trees, palms, umbrellas, street lights, traffic lights and the pier are primitive shapes.
- **Buildings:** box buildings with shader windows.
- **Underwater:** sea life (fish, coral, kelp, rays, jellyfish) is simple shapes.

## Not implemented

- **Conversations:** no microphone or speech recognition (Electron's built-in recogniser doesn't work offline), no lip-sync, no facial animation. NPC voices use Windows' built-in text-to-speech.
- **Characters:** no MetaHuman-level characters.
- **Rendering:** no ray tracing, global illumination or volumetric clouds.
- **City:** no swamp, rural areas, port, aircraft or boats.

## Next steps, in order of visual impact

1. **More bodies:** more character models to break up clones. This needs a source of licensed rigged humans, such as Mixamo, which requires an Adobe login on your side.
2. **Traffic models:** detailed models for AI traffic (CC0/CC-BY car packs).
3. **City art:** modular building facades and street props (CC0 kits), plus real palms and trees.
4. **Or migrate to UE5:** for the reference-shot quality, on a Windows RTX machine with City Sample and MetaHumans, reusing the simulation, AI and memory design already written in `neon/`.
