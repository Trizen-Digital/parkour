// A landing about to be rolled, at the tutorial's vault fences: the roll is judged on the step after touchdown and
// starts on the one after, and nothing takes the body in between. A power jump or a vault onto the second fence started
// in that step used to be taken over by the roll, which left collisions off for good: the runner fell through the
// floor. In Easy mode two taps of Space did it, the pilot holding the second through the landing.

import test from 'node:test';
import assert from 'node:assert/strict';

await import( '../tools/headless/env.mjs' );
const { worldFor, courseFor } = await import( '../tools/headless/courses.mjs' );
const { spawnIndex } = await import( '../src/world/fromCourse.js' );
const { Simulation } = await import( '@trizendigital/parkour/sim/Simulation.js' );
const { Figure } = await import( '@trizendigital/parkour/figure/Figure.js' );
const { Pilot } = await import( '@trizendigital/parkour/pilot/Pilot.js' );
const { LEDGE_STATES } = await import( '@trizendigital/parkour/runner/states.js' );
const { ENGINES, backendOf } = await import( '../src/engines.js' );

// The first fence's near face (m along x). On the floor the runner's centre stands 0.92 m up; under 0.5 m it is going
// through it.
const FENCE = 58.8;
const SUNK = 0.5;

async function vaultBay( engine, easy ) {

	const sim = new Simulation( { world: worldFor( 'tutorial' ), figure: new Figure(), engine: backendOf( engine ) } );
	await sim.load();
	sim.respawn( spawnIndex( courseFor( 'tutorial' ), 'vault' ) );
	const pilot = new Pilot( sim );
	pilot.toggle( easy );
	return { sim, pilot, runner: sim.runner };

}

// Sprints at the fences for 4 s at 60 frames a second, Space tapped (2 frames) `before` m short of the first fence and
// again `again` frames later. What the runner did on the way, and how low it went. `open` undoes runner.rollComing, so
// a move can start in the step between, to see the roll stand down for it.
async function run( { engine, easy = true, before = 1.5, again = 40, open = false } ) {

	const { sim, pilot, runner } = await vaultBay( engine, easy );
	if ( open ) Object.defineProperty( runner, 'rollComing', { get: () => false } );
	const seen = { lowest: Infinity, ghostOutside: false, rolledOverPlacement: false };
	let pressedAt = null, held = false;
	for ( let frame = 0; frame < 240; frame ++ ) {

		if ( pressedAt === null && runner.position.x > FENCE - before ) pressedAt = frame;
		const space = pressedAt !== null && ( frame - pressedAt < 2 || ( frame - pressedAt >= again && frame - pressedAt < again + 2 ) );
		if ( space !== held ) sim.input.queueKey( 'Space', space ? 'pressed' : 'released' );
		held = space;
		pilot.think( 1 / 60 );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( [ 'KeyW', 'ShiftLeft', ...( space ? [ 'Space' ] : [] ) ] );
			input.mouseButtons = new Set();
			input.enabled = true;
			pilot.apply( input );

		} );

		seen.lowest = Math.min( seen.lowest, runner.position.y );
		seen.ghostOutside ||= runner.clock.held( 'noCollision' ) && ! LEDGE_STATES.has( runner.state ) && ! runner.stunt?.ghost;
		seen.rolledOverPlacement ||= runner.state === 'rolling' && runner.ledges.placement !== null;

	}

	sim.dispose();
	return seen;

}

for ( const engine of ENGINES ) {

	// Each of these fell through the floor before: a power jump onto the second fence, taken over by the roll.
	test( `${engine}: Easy, two taps of Space over the first fence land at the second on the floor`, async () => {

		for ( const before of [ 1, 2 ] ) for ( const again of [ 30, 45 ] ) {

			const seen = await run( { engine, before, again } );
			const name = `tapped ${before} m short, again ${again} frames on`;
			assert.ok( seen.lowest > SUNK, `${name}: went down to ${seen.lowest.toFixed( 2 )} m` );
			assert.equal( seen.rolledOverPlacement, false, `${name}: rolled over a vault` );
			assert.equal( seen.ghostOutside, false, `${name}: collisions off outside a ledge move` );

		}

	} );

	// The two holds behind runner.rollComing, each with the other's work undone: something does start in the step
	// between (rollComing made false), and the roll must stand down; a placement's state is taken from it, and it must
	// let go of its ghost.
	test( `${engine}: a roll that finds a vault holding the body is dropped; a vault whose state is taken lets go of its ghost`, async () => {

		const opened = await run( { engine, before: 1.5, again: 40, open: true } );
		assert.ok( opened.lowest > SUNK, `went down to ${opened.lowest.toFixed( 2 )} m` );
		assert.equal( opened.rolledOverPlacement, false );

		const { sim, runner } = await vaultBay( engine, false );
		sim.input.queueKey( 'Mouse0', 'pressed' );
		let took = false, held = false;
		for ( let frame = 0; frame < 120 && ! took; frame ++ ) {

			const space = runner.position.x > FENCE - 1.6;
			if ( space && ! held ) sim.input.queueKey( 'Space', 'pressed' );
			held = space;
			sim.frame( 1 / 60, ( input ) => {

				input.keys = new Set( [ 'KeyW', 'ShiftLeft', ...( space ? [ 'Space' ] : [] ) ] );
				input.mouseButtons = new Set( [ 0 ] );
				input.enabled = true;

			} );

			if ( runner.state === 'vaulting' && runner.clock.held( 'noCollision' ) ) {

				// Another system's state set over the vault, as the roll's timer once did.
				runner.setState( 'falling' );
				took = true;

			}

		}

		assert.ok( took, 'vaulted' );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( [ 'KeyW' ] );
			input.mouseButtons = new Set();
			input.enabled = true;

		} );
		assert.equal( runner.ledges.placement, null );
		assert.equal( runner.clock.held( 'noCollision' ), false );
		sim.dispose();

	} );

}
