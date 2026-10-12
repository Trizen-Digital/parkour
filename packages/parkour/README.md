# @trizendigital/parkour

A third-person parkour runner for three.js: it runs, jumps, vaults, climbs ledges, runs along walls, swings on bars
and ropes, climbs pipes, poles and ladders, rides ziplines, barges through doors, flips and rolls, and goes limp into a
ragdoll, in any world you describe to it. It steps at a fixed 120 Hz whatever the frame rate, so the same world,
settings, physics engine and raw input always make the same run, to the bit.

```sh
npm install @trizendigital/parkour @trizendigital/parkour-box3d three
```

`three` 0.186 is a peer dependency. The physics engine is a package of its own: `@trizendigital/parkour-box3d` or
`@trizendigital/parkour-rapier`.

## Running it

```js
import { Vector3 } from 'three';
import { Simulation, World, Figure, boxSolid } from '@trizendigital/parkour';
import box3d from '@trizendigital/parkour-box3d';

const world = new World( {
	spawns: [ { position: new Vector3( 0, 0.9215, 0 ), yaw: 0 } ],
	solids: [ boxSolid( { id: 'floor', position: [ 0, - 0.5, 0 ], halfExtents: [ 50, 0.5, 50 ] } ) ],
} );

const sim = new Simulation( { world, engine: box3d, camera, canvas: renderer.domElement, figure: new Figure() } );
await sim.load();

renderer.setAnimationLoop( () => {

	sim.frame( timer.getDelta() );   // the input, the fixed steps, the camera
	renderer.render( scene, camera );

} );
```

- **The world** is a world description (`World`): the solids (boxes and convex hulls: `boxSolid`, `hullSolid`,
  `prismSolid`), the spawns, and the poles, pipes, ziplines, ladders, ropes, doors and switches there are to use. Your
  game makes one from its own world; the repo's [AGENTS.md](../../AGENTS.md) (Adapting a world) says what that must get
  right, and the demo's `src/world/fromCourse.js` is a whole adapter.
- **The engine** is a backend package's default export. Its name is what a replay records.
- **The figure** is what the player sees: a `RiggedFigure` (a skinned glTF model with a rig description, posed from
  the motion's takes, as the demo's Y Bot is), or the timing-only `Figure`, which loads nothing. Add `sim.figure.root`
  to your scene.
- **The motion data** (the move table and each take's clip) is loaded by URL: `./data/moves.json` unless the
  Simulation is given `motion: new Motion( { moves } )`, and `./data/takes/` unless the RiggedFigure is given `takes`.
  This package carries none: the demo's (`@trizendigital/parkour-demo`, `public/data/`) are built for the Y Bot's skeleton, a
  Mixamo rig.

Every module is reachable by path for tools and tests (`@trizendigital/parkour/runner/Ledges.js`); `src/index.js` is the
public API. How it all works: [the demo's docs/ARCHITECTURE.md](../parkour-demo/docs/ARCHITECTURE.md).
