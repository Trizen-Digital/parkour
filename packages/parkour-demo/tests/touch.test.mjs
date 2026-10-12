// The touch controls as a device (src/touch/TouchInput.js), played as the page plays them: the stick walks the runner
// and sprints it at its edge, Jump reaches Easy mode's pilot as Space does, the look turns the view as far as the
// finger went and never points a trick in the air, and a run played by touch replays exactly.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { PROJECT } = await import( '../tools/headless/env.mjs' );
const { worldFor } = await import( '../tools/headless/courses.mjs' );
const { Simulation } = await import( '@trizen/parkour/sim/Simulation.js' );
const { Figure } = await import( '@trizen/parkour/figure/Figure.js' );
const { DeviceState } = await import( '@trizen/parkour/input/deviceState.js' );
const { Pilot } = await import( '@trizen/parkour/pilot/Pilot.js' );
const { MOUSE_YAW_RATE, LOOK_GAIN } = await import( '@trizen/parkour/input/response.js' );
const { radians } = await import( '@trizen/parkour/math.js' );
const { FORMAT } = await import( '@trizen/parkour/replay/tape.js' );
const { Recorder } = await import( '../src/qa/recorder.js' );
const { Replay, replaySim } = await import( '../src/qa/replay.js' );
const { TouchInput } = await import( '../src/touch/TouchInput.js' );
const { backendOf } = await import( '../src/engines.js' );

const COURSE = 'test_jumps';
const course = JSON.parse( fs.readFileSync( path.join( PROJECT, 'public/courses', `${COURSE}.json` ), 'utf8' ) );

const DT = 1 / 60;

// The player's loop on a simulation reading its pads through the touch controls: the pilot on (touch plays in Easy
// mode), the recorder bracketing each frame, the touch controls' turn inside it before the pilot's.
async function session( engine = 'box3d' ) {

	const touch = new TouchInput();
	const sim = new Simulation( {
		world: worldFor( COURSE ), figure: new Figure(), engine: backendOf( engine ),
		page: { storage: null, eventWindow: null, eventDocument: null, navigator: touch.navigator },
	} );
	await sim.load();
	const raw = new DeviceState( sim.input );
	const pilot = new Pilot( sim );
	pilot.toggle( true );
	touch.setOn( true );
	touch.attach( sim.input );
	const recorder = new Recorder( { keep: 60 } );
	recorder.attach( sim, raw );
	recorder.easy = true;
	recorder.respawn( 0 );

	// Frames, each after `before` (what the thumbs do between frames); the mouse's counts each frame took, and whether
	// free look was held.
	const looks = [];
	const frames = ( count, before = () => {} ) => {

		for ( let k = 0; k < count; k ++ ) {

			before( k );
			pilot.think( DT );
			recorder.beginFrame();
			sim.frame( DT, ( input ) => {

				touch.apply( input, sim.runner, DT );
				looks.push( { x: input.mouse.x, y: input.mouse.y, free: input.mouseButtons.has( 1 ), air: ! sim.runner.grounded } );
				pilot.apply( input );
				recorder.capture( DT );

			} );
			recorder.endFrame();

		}

	};

	return { touch, sim, pilot, recorder, frames, looks };

}

test( 'the stick walks the runner at a part push and sprints it at its edge; let go, its pad is gone', async () => {

	const { touch, sim, frames } = await session();

	frames( 90, () => touch.setStick( 0, - 0.5 ) );
	assert.equal( sim.runner.state, 'walking' );
	assert.ok( sim.runner.speed > 0.5 && sim.runner.speed < 2.05, `walking at ${sim.runner.speed}` );
	assert.equal( touch.navigator.getGamepads()[ 0 ].id, 'Touch controls' );

	frames( 90, () => touch.setStick( 0.2, - 0.98 ) );
	assert.equal( sim.runner.state, 'sprinting' );
	assert.ok( sim.runner.speed > 5, `sprinting at ${sim.runner.speed}` );

	// Back from the edge a little, it still sprints; further, it walks again.
	touch.setStick( 0, - 0.85 );
	assert.equal( touch.sprint, true );
	touch.setStick( 0, - 0.7 );
	assert.equal( touch.sprint, false );

	touch.releaseStick();
	assert.equal( touch.navigator.getGamepads().length, 0 );

} );

test( 'Jump on the touch controls reaches Easy mode\'s pilot as Space does: it plans the jump, and the runner takes off', async () => {

	const { touch, sim, pilot, frames } = await session();

	frames( 60, () => touch.setStick( 0, - 1 ) );
	touch.press( 'jump' );
	frames( 1 );
	assert.ok( pilot.plan, 'the pilot plans the jump' );
	touch.release( 'jump' );
	let airborne = false;
	frames( 60, () => airborne ||= ! sim.runner.grounded );
	assert.ok( airborne, 'the runner left the ground' );

} );

test( 'the look turns the view as far as the finger went, at no more than the view\'s mouse turn rate a frame, with free look held', async () => {

	const { touch, sim, frames, looks } = await session();
	frames( 10 );
	const yaw = sim.view.yaw, from = looks.length;

	// 1000 px across: 240 mouse counts, more than a frame takes.
	touch.look( 1000, 0 );
	frames( 120 );
	const given = looks.slice( from ), limit = MOUSE_YAW_RATE * DT / radians( sim.tuning.values.mouseSensitivity );
	assert.ok( given.every( ( look ) => look.x <= limit + 1e-9 ), 'no frame over the rate' );
	assert.ok( Math.abs( given.reduce( ( sum, look ) => sum + look.x, 0 ) - 240 ) < 1e-9, 'every count given' );
	assert.ok( Math.abs( yaw - sim.view.yaw - LOOK_GAIN * radians( 240 * sim.tuning.values.mouseSensitivity ) ) < 1e-9 );
	assert.ok( given[ 0 ].free && ! given.at( - 1 ).free, 'free look held while there was look to give' );

} );

test( 'in the air the look goes in under a trick flick\'s threshold, so dragging the view points no trick', async () => {

	const { touch, sim, frames, looks } = await session();

	frames( 60, () => touch.setStick( 0, - 1 ) );
	touch.press( 'jump' );
	frames( 1 );
	touch.release( 'jump' );
	frames( 60, () => sim.runner.grounded );
	assert.equal( sim.runner.grounded, false );

	const from = looks.length, flick = sim.tuning.values.trickMouseFlick;
	touch.look( 120, - 80 );
	frames( 10 );
	const air = looks.slice( from ).filter( ( look ) => look.air && ( look.x || look.y ) );
	assert.ok( air.length > 0 );
	assert.ok( air.every( ( look ) => Math.abs( look.x ) <= flick && Math.abs( look.y ) <= flick ), 'under the threshold' );
	assert.deepEqual( sim.runner.trickGesture.mouse, { up: false, down: false, left: false, right: false } );

} );

test( 'a run played on the touch controls (stick, sprint, look, Jump through the pilot, Grab, Slide) replays exactly', async ( t ) => {

	const { touch, recorder, frames } = await session();

	frames( 60, ( k ) => {

		touch.setStick( Math.sin( k / 9 ) * 0.4, - 0.6 );
		touch.look( 6, k % 2 ? - 1 : 2 );

	} );
	frames( 60, () => touch.setStick( 0, - 1 ) );
	touch.press( 'jump' );
	frames( 8 );
	touch.release( 'jump' );
	frames( 90, ( k ) => k === 20 && touch.look( - 300, 40 ) );
	touch.press( 'slide' );
	frames( 30 );
	touch.release( 'slide' );
	touch.press( 'grab' );
	frames( 40 );
	touch.release( 'grab' );
	touch.releaseStick();
	frames( 40 );

	const rec = JSON.parse( JSON.stringify( { format: FORMAT, id: 'touch', course: { name: COURSE }, notes: [], ...recorder.take( 60 ) } ) );
	const sim = await replaySim( course, { engine: 'box3d' } );
	const replay = new Replay( sim, rec );
	const rows = [];
	replay.run( rec.frames - 1, ( row ) => rows.push( row ) );
	replay.end();
	assert.equal( replay.divergedAt, null, `differs from frame ${replay.divergedAt}` );
	assert.equal( rows.length, rec.frames );
	t.diagnostic( `${rec.frames} frames replayed with every hash the same` );

} );
