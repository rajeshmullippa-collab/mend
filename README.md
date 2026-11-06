# Mend: kintsugi in your hands

**Mend is a seated, hands-only mixed-reality ritual for Meta Quest.** A broken ceramic vessel sits on a small felt mat in your real room. Pinch a shard, bring it home, and let go. It seats itself with a bell tone, and every crack it closes fills with gold. When the vessel is whole, it turns slowly in the light and goes on your shelf. There's a new vessel every day.

- **Play:** https://rajeshmullippa-collab.github.io/mend/ (open it in the Meta Quest Browser with hand tracking on)
- **Demo video (under 3 min, recorded in the Meta Immersive Web Emulator):** see the Devpost entry
- **Built for:** Meta VR Start Developer Competition 2026, Gaming track, New Experience division

> Built by Hark, an AI agent, under Rajesh Mullippa's direction.

## Why kintsugi

Kintsugi is the Japanese craft of repairing broken pottery with gold, so the repair becomes part of the object's story. It suits a headset unusually well. You use your hands directly and the work is small and precise. It fits within arm's reach, and it's calming enough to finish in one short sitting.

## How it plays

| | |
|---|---|
| **Hands-first** | Every interaction is a pinch. You pick up shards with a hand pinch (IWSDK `OneHandGrabbable` with `useHandPinchForGrab`), and the buttons respond to a hand-ray pinch. You never need a controller. |
| **Seated, 2 ft radius** | On entering, the mat recenters about 43 cm in front of and 40 cm below your eyes. Every shard starts within reach on the near half of the mat. A Recenter button is always on the mat. |
| **Short session** | A vessel has 6–9 shards (a few more as your shelf grows) and takes about 2–5 minutes. Progress saves after every shard, so you can take the headset off and pick up where you left off. |
| **Teaches by doing** | There's no text wall. The first card says "Pinch a shard. Bring it home." A gold ghost of a shard's home fades in as you carry it close and brightens when it's close enough to seat. If you go quiet for a while, one shard and its home start to glow. |
| **Reason to come back** | The vessel of the day is seeded by the date, so its shape, glaze and break pattern are the same for everyone that day. Finished vessels collect on a shelf behind the mat, with a daily streak. |
| **Passthrough** | It runs as an `immersive-ar` session, so the mat and vessel sit in your own room. |

## How it's built

- **Immersive Web SDK** (`@iwsdk/core` 1.1.0-rc.2), an ECS on Three.js. One `MendSystem` runs the loop. Its queries on `Grabbed` and `Pressed` drive pick-up, release, snapping and buttons.
- **Procedural vessels** (`src/mend/vessel.ts`): each vessel is a lathe profile (tea bowl, open bowl, vase or cup) with real wall thickness. Its surface is split into a 160 × 40 grid. Each cell goes to the nearest of a few stratified seed points, measured in true surface distance with a little noise, which gives believable irregular breaks. Each shard is built with outer glaze, inner glaze and raw-clay break faces. The gold seams are thin ribbons laid along each shared edge, on both faces. They're revealed when both neighbors are in place.
- **Snapping:** a shard seats when it's released within 4 cm and 55° of its home, then eases into place in about 0.2 s.
- **Sound** (`src/mend/audio.ts`): everything is synthesized with WebAudio. Ceramic clinks, a bell that climbs a pentatonic scale as the vessel fills, a gold shimmer and a closing chord. It uses no audio files.
- **No downloaded assets:** all meshes and labels are generated at runtime, so it loads fast and stays light. Geometry is a few thousand triangles per vessel.
- **Desktop:** the build includes IWSDK's emulator (IWER), so you can try the experience on a desktop browser too. The Quest Browser uses native WebXR.

## Run locally

```bash
npm install
npm run dev        # IWSDK dev server with the emulator
npm run build      # production build to dist/
```

`docs/` holds the production build that GitHub Pages serves.

## Roadmap

- Place the mat on a real table using scene understanding (planes) and anchors
- Two-hand rotation of the vessel, for harder vessels with more pieces
- Gaze-and-pinch and voice alternatives for accessibility
- A "gift" mode that sends a friend today's vessel with your seams

## Credits and license

Code is MIT licensed (see `LICENSE`). Project scaffolding comes from Meta's `@iwsdk/create` (MIT). Everything else, including the code, geometry, sound and text, was made for this project. Built by Hark, an AI agent, under Rajesh Mullippa's direction.
