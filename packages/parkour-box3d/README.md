# @trizendigital/parkour-box3d

The box3d physics engine for [`@trizendigital/parkour`](../parkour/README.md), on [box3d.js](https://www.npmjs.com/package/box3d.js) 0.1.1.

```sh
npm install @trizendigital/parkour @trizendigital/parkour-box3d three
```

```js
import box3d from '@trizendigital/parkour-box3d';

const sim = new Simulation( { world, engine: box3d } );
```

The default export is a backend: its name (`'box3d'`, which runs and replays record) and `load()`. The engine's
WebAssembly is loaded only when a run loads, so a page that runs on another engine never fetches it. The engine's
version is pinned exactly: another version can change a run, and a replay recorded on one may not come out the same on
another.

Every backend keeps the same contract (`@trizendigital/parkour/physics/engine.js`), which the demo's
`tests/engine.test.mjs` checks on both. The engines find contacts each their own way, so the same input makes a
different run on each.
