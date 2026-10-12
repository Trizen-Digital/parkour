# @trizen/parkour-rapier

The Rapier physics engine for [`@trizen/parkour`](../parkour/README.md), on [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat` 0.21.0).

```sh
npm install @trizen/parkour @trizen/parkour-rapier three
```

```js
import rapier from '@trizen/parkour-rapier';

const sim = new Simulation( { world, engine: rapier } );
```

The default export is a backend: its name (`'rapier'`, which runs and replays record) and `load()`. The engine's
WebAssembly is loaded only when a run loads, so a page that runs on another engine never fetches it. The engine's
version is pinned exactly: another version can change a run, and a replay recorded on one may not come out the same on
another.

Every backend keeps the same contract (`@trizen/parkour/physics/engine.js`), which the demo's
`tests/engine.test.mjs` checks on both. The engines find contacts each their own way, so the same input makes a
different run on each.
