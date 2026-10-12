// Doors, valves and buttons, run on test_basic: its door (1 m by 2.2 m, in an 8 m wall across z = 44.15, facing back
// down the course) with a valve 2.4 m to its left and a button 2.4 m to its right.

import test from 'node:test';
import assert from 'node:assert/strict';

await import( '../tools/headless/env.mjs' );
const { worldFor } = await import( '../tools/headless/courses.mjs' );
const { Simulation } = await import( '@trizen/parkour/sim/Simulation.js' );
const { backendOf } = await import( '../src/engines.js' );

const NO_PAGE = { storage: null, eventWindow: null, eventDocument: null, navigator: null };

// The capsule's centre stands this far above the floor.
const STANDING = 0.9215;

// The door's leaf, and how far out from it the capsule's centre is held: its radius and half the leaf.
const LEAF = 44.15;
const HELD_OFF = 0.185 + 0.025;

async function at( x, z ) {

	const sim = new Simulation( { world: worldFor( 'test_basic' ), page: NO_PAGE, engine: backendOf( 'rapier' ) } );
	await sim.load();
	sim.respawn( { position: [ x, STANDING, z ], yaw: 0 } );
	return sim;

}

// Frames at 60 a second with these keys held; a key not held the frame before is pressed.
function play( sim, frames, keys = [], until = () => false ) {

	for ( let f = 0; f < frames && ! until( sim.runner ); f ++ ) {

		for ( const key of keys ) if ( ! sim.input.keys.has( key ) ) sim.input.queueKey( key, 'pressed' );
		for ( const key of sim.input.keys ) if ( ! keys.includes( key ) ) sim.input.queueKey( key, 'released' );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( keys );
			input.mouseButtons = new Set();
			input.enabled = true;

		} );

	}

}

const door = ( sim ) => sim.runner.doorsAndSwitches.doors[ 0 ];
const item = ( sim, kind ) => sim.runner.doorsAndSwitches.switches.find( ( state ) => state.item.kind === kind );

test( 'a sprint at a shut door turns the shoulder in as they meet, bursts the door open away from the runner, and goes on through at speed', async () => {

	const sim = await at( 28, 37 );
	const runner = sim.runner;
	let shoulder = null;

	play( sim, 240, [ 'KeyW', 'ShiftLeft' ], ( r ) => {

		if ( sim.motion.moves.playing()?.name === 'doorBarge' && shoulder === null ) shoulder = r.position.z;
		return door( sim ).open;

	} );

	// The shoulder went in a little more than the lead's worth of running before the leaf (0.6 s at 5.85 m/s, and the
	// capsule's radius and half the leaf).
	assert.ok( shoulder > LEAF - 3.9 && shoulder < LEAF - 3.5, `shoulder in at ${shoulder}` );
	assert.equal( door( sim ).open, true );
	assert.equal( door( sim ).how, 'barge' );
	// The runner came from the side the door faces, so the door swings to the other.
	assert.equal( door( sim ).side, 1 );

	play( sim, 60, [ 'KeyW', 'ShiftLeft' ] );
	assert.ok( runner.position.z > LEAF + 4 );
	assert.ok( runner.speed > 5.8 );
	assert.equal( runner.state, 'sprinting' );

} );

test( 'walking into a shut door holds the runner at its leaf', async () => {

	const sim = await at( 28, 42 );

	play( sim, 240, [ 'KeyW' ] );
	assert.equal( door( sim ).open, false );
	assert.ok( Math.abs( sim.runner.position.z - ( LEAF - HELD_OFF ) ) < 1e-6, `held at ${sim.runner.position.z}` );

} );

test( 'Interact in front of a shut door kicks it open as the foot meets it, and the runner walks through', async () => {

	const sim = await at( 28, 43.2 );

	play( sim, 10 );
	play( sim, 1, [ 'KeyE' ] );
	assert.equal( sim.runner.state, 'groundStunt' );
	assert.equal( sim.motion.moves.playing()?.name, 'doorKick' );
	assert.equal( door( sim ).open, false );

	const kicked = sim.runner.time;
	play( sim, 60, [], () => door( sim ).open );
	assert.equal( door( sim ).how, 'kick' );
	assert.ok( Math.abs( door( sim ).since - kicked - 0.45 / 1.4 ) < 0.02 );

	// Set where the foot meets the leaf.
	assert.ok( Math.abs( sim.runner.position.z - ( LEAF - 0.95 ) ) < 1e-6 );

	play( sim, 240, [ 'KeyW' ] );
	assert.ok( sim.runner.position.z > LEAF + 2 );

} );

test( 'Interact at the valve turns it through its move, then the door beside it opens', async () => {

	const sim = await at( 25.6, 42.5 );

	play( sim, 10 );
	play( sim, 1, [ 'KeyE' ] );
	assert.equal( sim.motion.moves.playing()?.name, 'valveTurn' );
	const valve = item( sim, 'valve' );
	const length = sim.motion.length( 'valveTurn' );
	assert.ok( Math.abs( valve.to - valve.from - length ) < 1e-9 );

	// Facing the wall at arm's length from the wheel.
	play( sim, 30 );
	assert.ok( Math.abs( sim.runner.yaw ) < 1e-9 );
	assert.ok( Math.abs( sim.runner.position.z - ( valve.item.position.z - 0.42 ) ) < 1e-6 );

	play( sim, 200, [], () => door( sim ).open );
	assert.equal( door( sim ).how, 'switch' );
	assert.ok( Math.abs( valve.workedAt - valve.to ) < 0.01 );

} );

test( 'Interact at the button presses it side-on, and the press opens the door beside it', async () => {

	const sim = await at( 30.4, 42.6 );

	play( sim, 10 );
	play( sim, 1, [ 'KeyE' ] );
	assert.equal( sim.motion.moves.playing()?.name, 'buttonPress' );

	play( sim, 60, [], () => door( sim ).open );
	const button = item( sim, 'button' );
	assert.ok( Math.abs( button.workedAt - button.from - 0.5 / 1.2 ) < 0.02 );

	// The right shoulder to the wall: facing along it.
	assert.ok( Math.abs( sim.runner.yaw - Math.PI / 2 ) < 1e-9 );

} );

test( 'heading along the wall the other way, the left hand presses the button, the runner keeping its heading; in first person the view turns down to it and back up after', async () => {

	const sim = await at( 30.4, 42.6 );
	sim.respawn( { position: [ 30.4, STANDING, 42.6 ], yaw: - Math.PI / 2 } );
	sim.runner.firstPerson = true;

	play( sim, 10 );
	play( sim, 1, [ 'KeyE' ] );
	assert.equal( sim.motion.moves.playing()?.name, 'buttonPressLeft' );
	assert.equal( sim.runner.doorsAndSwitches.working.hand, 'left' );

	// Eased round to look at the button: down at it, not in one frame.
	assert.ok( sim.view.pitch < 0.2 );
	play( sim, 40 );
	assert.ok( sim.view.pitch > 0.3 );
	assert.ok( Math.abs( sim.runner.yaw + Math.PI / 2 ) < 1e-9, 'the left shoulder to the wall' );

	play( sim, 120, [], () => ! sim.runner.doorsAndSwitches.working );
	play( sim, 90 );
	assert.ok( Math.abs( sim.view.pitch ) < 0.01, 'level again' );

} );

test( 'what Interact would work is named before the press (the door ahead, the valve, the button), and asking changes nothing', async () => {

	const target = ( sim ) => sim.runner.doorsAndSwitches.target()?.kind ?? null;

	for ( const [ x, z, kind ] of [ [ 28, 43.2, 'kick' ], [ 25.6, 42.5, 'valve' ], [ 30.4, 42.6, 'button' ], [ 28, 38, null ] ] ) {

		const sim = await at( x, z );
		play( sim, 10 );
		const time = sim.runner.time, where = sim.runner.position.clone();
		assert.equal( target( sim ), kind, `at ${x}, ${z}` );
		assert.equal( target( sim ), kind );
		assert.ok( sim.runner.time === time && sim.runner.position.equals( where ) && ! door( sim ).open );

	}

	// On a run, in reach of the leaf, there is nothing to work: a door is barged.
	const sim = await at( 28, 37 );
	play( sim, 240, [ 'KeyW', 'ShiftLeft' ], ( r ) => LEAF - r.position.z < 1.5 );
	assert.ok( LEAF - sim.runner.position.z < 1.5 && sim.runner.speed > 2.5 );
	assert.equal( target( sim ), null );

} );

test( 'Interact with nothing in reach is still the precision crouch', async () => {

	const sim = await at( 28, 38 );

	play( sim, 10 );
	play( sim, 1, [ 'KeyE' ] );
	assert.equal( sim.runner.state, 'aiming' );

} );

test( 'a door left open shuts again once the runner is clear of it, 4 s after it opened', async () => {

	const sim = await at( 28, 37 );

	play( sim, 240, [ 'KeyW', 'ShiftLeft' ], () => door( sim ).open );
	const opened = door( sim ).since;
	play( sim, 60 * 3.9, [ 'KeyW', 'ShiftLeft' ] );
	assert.equal( door( sim ).open, true );
	play( sim, 60, [ 'KeyW', 'ShiftLeft' ], () => ! door( sim ).open );
	assert.equal( door( sim ).open, false );
	assert.ok( door( sim ).since - opened >= 4 );

} );

test( 'a respawn shuts the doors and forgets the switches', async () => {

	const sim = await at( 30.4, 42.6 );

	play( sim, 10 );
	play( sim, 60, [ 'KeyE' ] );
	assert.equal( door( sim ).open, true );
	sim.respawn( 0 );
	assert.equal( door( sim ).open, false );
	assert.equal( item( sim, 'button' ).workedAt, - Infinity );

} );
