// @trizendigital/parkour: a deterministic third-person parkour runner for three.js. This is the public API a game builds on;
// every module is also reachable by path (`@trizendigital/parkour/runner/Ledges.js`) for tools and tests.
//
// A game gives a Simulation three things: a World (made from a world description: its solids, spawns and the things
// to take hold of), a physics engine backend (@trizendigital/parkour-box3d or @trizendigital/parkour-rapier) and a figure (a
// RiggedFigure for a model the player sees, or the timing-only Figure). It then calls `sim.frame( dt )` every rendered
// frame. The same world, settings, engine and raw input always make the same run, to the bit.

export { Simulation, STEP } from './sim/Simulation.js';
export { World } from './world/World.js';
export { GROUPS, EVERY_GROUP, boxSolid, hullSolid, prismSolid } from './world/solids.js';
export { Figure } from './figure/Figure.js';
export { RiggedFigure } from './figure/RiggedFigure.js';
export { Motion } from './motion/Motion.js';
export { Pilot } from './pilot/Pilot.js';
export { DeviceState } from './input/deviceState.js';
export { Tuning, TUNING_DEFAULTS } from './sim/tuning.js';
export { SeededRandom, random } from './sim/random.js';
export { takeSnapshot, restoreSnapshot, markStatic } from './sim/snapshot.js';
export { Tape, FORMAT as REPLAY_FORMAT, engineOf, applySettings, encodeInput, decodeInput } from './replay/tape.js';
export { FrameTrace } from './replay/trace.js';
export { QueryWorld, Body, DynamicWorld, PhysicsEngine } from './physics/engine.js';
