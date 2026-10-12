# Parkour ALPHA RELEASE

Trizen Digital's third-person parkour runner for three.js, and the demo built on it at
[parkour.trizen.dev](https://parkour.trizen.dev/).

| Package | What |
| --- | --- |
| [`@trizendigital/parkour`](packages/parkour/README.md) | the runner: plug in your world, a physics engine and a figure |
| [`@trizendigital/parkour-box3d`](packages/parkour-box3d/README.md) | the box3d physics engine adapter |
| [`@trizendigital/parkour-rapier`](packages/parkour-rapier/README.md) | the Rapier physics engine adapter |
| [`@trizendigital/parkour-demo`](packages/parkour-demo/README.md) | the game: the Y Bot, the courses, the QA replay player, the benchmark, the tools and tests |

## Bring it to your game

```sh
npm install @trizendigital/parkour @trizendigital/parkour-box3d three
```

Describe your world and give it to a `Simulation` with a physics engine; [the core's README](packages/parkour/README.md) shows how, and send your clanker to [AGENTS.md](AGENTS.md) for integration instructions.

## Playing the demo

- [parkour.trizen.dev](https://parkour.trizen.dev/), in the browser.
- `npx @trizendigital/parkour-demo`, on http://localhost:5412/.
- From a clone: `npm install`, then `npm run dev` (http://localhost:5410/).

## Reporting something

In the demo, press **V** to capture the last 20 seconds. Note down what went wrong and save; then **Share** it from the library (**L**). A `.qa.zip` downloads and an issue opens on the replay form: drop the zip into it for the maintainer. The zip contains which commit it was recorded on & the state. `npm run qa:open -- <file>.qa.zip` allows you to run it automatically on the right commit via worktrees.
[The QA guide](packages/parkour-demo/qa/README.md) has the rest.

## Working on it

```sh
npm install
npm run dev            # the demo, http://localhost:5410/
npm test               # the tests
npm run golden         # the golden traces on box3d; -- --engine rapier on Rapier
npm run try            # pack every package, install the tarballs in ../.try/ and serve the installed demo
```

Again, [AGENTS.md](AGENTS.md) to ensure the clanker works within the bounds and runs all the correct tests.

## License

None. Enjoy!

## What about the video -> animation library?

That's gonna be a separate app release. Again, free, 0 license. It'll be more than just video -> animation - stay tuned builders!