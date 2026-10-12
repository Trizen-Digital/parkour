# AGENTS.md

A guide for agents working in this repo. [README.md](README.md) says what is here and how to run it;
[the demo's docs/ARCHITECTURE.md](packages/parkour-demo/docs/ARCHITECTURE.md) how the game works.

## The packages

| Package | Folder | What |
| --- | --- | --- |
| `@trizen/parkour` | `packages/parkour/` | the core: the simulation, the runner, the motion and pose graph, the figure (`RiggedFigure`, the timing-only `Figure`), the physics contract, the world, the camera, the input, the pilot, the replay format |
| `@trizen/parkour-box3d` | `packages/parkour-box3d/` | the box3d backend (the demo's default) |
| `@trizen/parkour-rapier` | `packages/parkour-rapier/` | the Rapier backend |
| `@trizen/parkour-demo` | `packages/parkour-demo/` | the game (parkour.trizen.dev), the Y Bot, the courses and `fromCourse`, QA, the benchmark, the tools, the tests, the docs |

- The core never imports the demo or a backend. A backend imports only the core (`@trizen/parkour/physics/engine.js`,
  `@trizen/parkour/world/solids.js`) and its engine. The demo imports the core by package path
  (`@trizen/parkour/runner/Ledges.js`), never by a relative path into `packages/parkour/`.
- The core has no character and no motion data: the Y Bot (`src/figure/YBotFigure.js`, `src/data/`) and the takes
  (`public/data/`) are the demo's.
- The engines are pinned to exact versions in the backends: a new engine version can change a run, so it is a change
  meant to alter the game (the goldens on both engines, then bless with the reason).
- `npm run try` packs every package, installs the tarballs into `../.try/` and serves the installed demo: what a user
  gets from npm. `npm run try -- --check` runs the tests and the goldens there instead. Run it after changing a
  package's `files`, `exports` or dependencies.

## Style

- three.js-style JavaScript: tabs, spaces inside parentheses and brackets (`foo( a, b )`, `[ 1, 2 ]`), ES modules.
- Every module starts with a comment saying what it is for and how it fits. Comments inside say why (a rule, a number,
  an order that matters), not what the next line does. A number gets a comment saying what it is for.
- Plain words for names and comments, in the game's own terms (the runner, a move, a take, a stunt, the pose graph).

## Git

- Commit as the user (the repo's configured identity), with no AI attribution lines.
- Never push unless asked.
- A commit message says what changed in the game's own terms.

## Dev servers

| Command (from the root) | Port | What |
| --- | --- | --- |
| `npm run dev` | 5410 | the demo with hot reload |
| `npm run dev:nohmr` | 5411 | hot reload off: test there, in a background tab, so an edit does not reload the page under the test |
| `npm run try` | 5412 | the installed demo (`npx parkour-demo` in `../.try/`) |
| `npm run preview:hosted` | 5413 | the hosted build: no QA store, replays kept in the browser |
| `npm run qa:open -- <zip> --serve` | 5414 | the demo at a shared replay's commit |

Never drive the tab the user is looking at.

## Determinism

The same world, settings, physics engine and raw input must give the same run, to the bit: the golden traces, QA
replays and Easy mode's look-ahead all rest on it.

- No `Math.random` in the runtime. Chance draws from the seeded streams (`@trizen/parkour/sim/random.js`), which a
  respawn resets.
- Anything that changes a run comes in through the raw device input, or between frames as something the QA recorder
  writes onto its tape (a respawn, a setting). A respawn starts everything again from the simulation as it loaded.
- The simulation reads no pose: a figure poses itself from the motion's recipe. Only the ragdoll and the first-person
  camera read a body.
- Easy mode never touches the runner: the pilot presses keys through the raw input.
- What a figure or a world is made with and never changes in a run stays out of what a snapshot walks (private fields,
  or marked static).

QA replays (`packages/parkour-demo/qa/`, [its README](packages/parkour-demo/qa/README.md)) are the user's feedback, and
how issues are reported: a replay must still run again exactly. `tests/qa.test.mjs` (which runs every curated replay in
`qa/replays/`), the QA console's `tapeCheck()` and `npm run qa:open -- <zip>` (a shared replay at its own commit and on
the code now) say whether it does. So are the comments on the benchmark (`qa/bench/comments.json`, kept in the user's copy, not in git):
`npm run bench -- --comment <id>` and the QA console's bench helpers find each one's moment again, on the engine and in
the view it is about.

## Verifying a change

Run these from the repo's root (they run in the demo) or from `packages/parkour-demo/`. Every tool runs on box3d
unless given `--engine rapier`.

| Change | Run |
| --- | --- |
| Anything | `npm test` |
| A restructure (the game should play exactly as before) | `npm run golden` and `npm run golden -- --engine rapier`: every trace exact |
| A change meant to alter the game | the goldens on both engines, look at what differs and why, then `npm run golden:bless` on both, with the reason in the commit |
| The runner, the motion, the figure | also `npm run purity`, on both engines (the simulation reads no pose) |
| What a run holds (new state on the runner, the motion, the camera, the input) | also `npm run snapshots`, on both engines (a restore puts a run back exactly) |
| The physics engines | `npm test` runs the contract on both; the goldens on both |
| How the runner gets round courses | also `npm run lanes` and `npm run reach`, before and after, and `npm run bench -- --engine all --view all` (every station passes) |
| The benchmark's stations or autopilot | `npm run bench -- --engine all --view all`, and `npm test` (tests/bench.test.mjs) |
| The motion data | `npm run moves:check` |
| A package's `files`, `exports` or dependencies | `npm run try -- --check` |

## Adapting a world

A game with a world of its own runs the runner in it by giving `new World( description )` a **world description**:
plain data (`@trizen/parkour/world/World.js` documents every field, and checks them as it takes them). The demo's
`src/world/fromCourse.js` is one adapter, from its courses; a game writes its own, from whatever its world is (a
three.js scene, a level format, a tile map). The core ships no other adapter.

```js
import { Vector3 } from 'three';
import { Simulation, World, boxSolid, prismSolid } from '@trizen/parkour';
import box3d from '@trizen/parkour-box3d';

const world = new World( {
	name: 'my level',
	spawns: [ { position: new Vector3( 0, 0.9215, 0 ), yaw: 0 } ],   // capsule centres: 0.9215 m above the floor
	solids: [
		boxSolid( { id: 'floor', position: [ 0, - 0.5, 0 ], halfExtents: [ 50, 0.5, 50 ] } ),
		boxSolid( { id: 'wall', position: [ 0, 1.5, 6 ], halfExtents: [ 3, 1.5, 0.25 ] } ),
		prismSolid( { id: 'pole', a: new Vector3( 4, 0, 4 ), b: new Vector3( 4, 4, 4 ), radius: 0.06, tags: [ 'pole' ] } ),
	],
	poles: [ { id: 'pole', bottom: new Vector3( 4, 0, 4 ), top: new Vector3( 4, 4, 4 ), radius: 0.06 } ],
} );
const sim = new Simulation( { world, engine: box3d, camera, canvas } );
await sim.load();
```

What an adapter must get right:

- **Units and axes**: metres, Y up; a yaw of 0 faces +Z. A spawn is the capsule's centre, not the feet.
- **Solids are boxes and convex hulls.** `boxSolid` (centre, rotation as a quaternion `[ x, y, z, w ]`, half
  extents), `hullSolid` (flat world-space points; give `polygons`, each face's point indices, so contacts report the
  face they are on) and `prismSolid` (anything round, between two points). A concave mesh made one hull is filled in:
  split it into convex pieces first (by hand, by its parts in the scene, or with a convex decomposition).
- **The order of solids never changes.** The engines' answers depend on the order solids are added, so the same world
  must give the same solids in the same order every time (sort by a stable id or keep the source's order; never a
  Set's order or anything timed). That is what makes a replay in the world run again.
- **What the runner reads**: ledges, wall runs and vaults are found on the solids themselves (a box's top edge is a
  ledge); tags change that: `noClimb` (no ledge or wall run here), `outOfBounds` (the edge of the playable area:
  no wall run or wall kick off it; give it `noClimb` too, as the demo's courses do), `bar` (a swing bar), `barPost` (a
  post holding one), `pole`. Poles, pipes, ziplines, ladders, ropes, doors and switches are listed beside the
  solids, each with what `World` documents; a pole's solid shares its id and carries the `pole` tag.
- **Groups**: a solid blocks every collision group unless given `groups` (`GROUPS.movement`, `probe`, `camera`,
  `ragdoll`); decoration the camera should pass through blocks all but `camera`.
- **Static**: nothing in a world moves during a run (doors are the runner's). Moving platforms are not supported.
- **floor**: below it the runner has fallen out and starts again at the first spawn (-30 m unless given).

A sketch of a scene adapter, for a game to fill in:

```js
// Every mesh with userData.parkour becomes a solid: a box for a BoxGeometry, a hull of its vertices otherwise.
function fromScene( scene ) {

	const solids = [], poles = [], spawns = [];
	scene.updateMatrixWorld( true );
	scene.traverse( ( object ) => { /* in traversal order: stable for the same scene */
		const mark = object.userData.parkour;
		if ( ! mark || ! object.isMesh ) return;
		if ( mark.spawn ) return spawns.push( { position: object.getWorldPosition( new Vector3() ), yaw: mark.yaw ?? 0 } );
		// boxSolid from the geometry's parameters and the world matrix, or hullSolid from its world-space vertices
	} );
	return { name: scene.name, spawns, solids, poles };

}
```

Check an adapter by running the runner in the world headless (`tools/headless/env.mjs` gives node enough of a
browser) and replaying a capture made in it: it must come out exactly.

## Units

Metres, seconds and radians inside the code, Y up; a heading of 0 faces +Z. Degrees only where a person reads them (the
settings' Tuning tab, a data table written `radians( 65 )`).

## The motion data

`packages/parkour-demo/public/data/moves.json` and `public/data/takes/` are built from the specs in
`tools/moves/families/` by `npm run moves:build`, never edited by hand; `npm run moves:check` proves they match. A
placeholder take is replaced by name when a capture lands ([docs/MOVES.md](packages/parkour-demo/docs/MOVES.md));
`npm run moves:captures` lists what is still to capture.
