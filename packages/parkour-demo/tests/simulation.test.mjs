// The simulation shell: the fixed step, the drawn position, pause and slow motion, respawn and the mark, snapshots,
// the physics engine it is built on, the random streams and the tuning.

import test from 'node:test';
import assert from 'node:assert/strict';

await import( '../tools/headless/env.mjs' );
const { worldFor } = await import( '../tools/headless/courses.mjs' );
const { Simulation, STEP } = await import( '@trizendigital/parkour/sim/Simulation.js' );
const { backendOf } = await import( '../src/engines.js' );
const { markStatic, takeSnapshot, restoreSnapshot } = await import( '@trizendigital/parkour/sim/snapshot.js' );
const { SeededRandom } = await import( '@trizendigital/parkour/sim/random.js' );
const { TUNING_DEFAULTS, TUNING_UNITS, Tuning, showTuning, validateTuning } = await import( '@trizendigital/parkour/sim/tuning.js' );
const { radians } = await import( '@trizendigital/parkour/math.js' );
const { Quaternion } = await import( 'three' );
const { YBotFigure } = await import( '../src/figure/YBotFigure.js' );
const { stateDump, diffDumps } = await import( '../src/qa/dump.js' );
const { Trace } = await import( '../tools/headless/trace.mjs' );
const { compare } = await import( '../tools/headless/compare.mjs' );

const NO_PAGE = { storage: null, eventWindow: null, eventDocument: null, navigator: null };

async function loaded( { course = 'test_basic', figure, engine = 'rapier' } = {} ) {

	const sim = new Simulation( { world: worldFor( course ), figure, page: NO_PAGE, engine: backendOf( engine ) } );
	await sim.load();
	sim.respawn( 0 );
	return sim;

}

// One frame with these keys held (and these edges queued), as a device would leave them.
function play( sim, dt, { keys = [], buttons = [], mouse = [ 0, 0, 0 ], edges = [] } = {} ) {

	for ( const [ key, edge ] of edges ) sim.input.queueKey( key, edge );
	sim.frame( dt, ( input ) => {

		input.keys = new Set( keys );
		input.mouseButtons = new Set( buttons );
		input.mouse = { x: mouse[ 0 ], y: mouse[ 1 ], wheel: mouse[ 2 ] };
		input.enabled = true;

	} );

}

const RUN = { keys: [ 'KeyW', 'ShiftLeft' ] };

test( 'the run steps 120 times a second whatever the frame rate, and carries the time left over to the next frame', async () => {

	const sim = await loaded();
	let steps = 0, time = 0;
	for ( let i = 0; i < 90; i ++ ) {

		const dt = i % 3 === 0 ? 1 / 144 : i % 3 === 1 ? 1 / 60 : 0.0213;
		play( sim, dt, RUN );
		steps += sim.steps;
		time += dt;
		assert.ok( sim.accumulator >= 0 && sim.accumulator < STEP );

	}

	assert.equal( steps, Math.floor( time / STEP + 1e-9 ) );
	assert.ok( Math.abs( steps * STEP + sim.accumulator - time ) < 1e-12 );

} );

test( 'a frame counts as at most 1/20 s, and a frame of no time does nothing', async () => {

	const sim = await loaded();
	play( sim, 0.4, RUN );
	assert.equal( sim.steps, 6 );
	const before = sim.runner.position.clone(), steps = sim.steps;
	play( sim, 0, RUN );
	play( sim, - 1, RUN );
	assert.equal( sim.steps, steps );
	assert.ok( sim.runner.position.equals( before ) );

} );

test( 'the runner is drawn between its last two steps, by the time left over', async () => {

	const sim = await loaded();
	for ( let i = 0; i < 30; i ++ ) play( sim, 1 / 60, RUN );
	play( sim, 1.5 * STEP, RUN );
	const runner = sim.runner, alpha = sim.accumulator / STEP;
	assert.ok( alpha > 0.4 && alpha < 0.6, `alpha ${alpha}` );
	const expected = runner.previousPosition.clone().lerp( runner.position, alpha );
	assert.ok( sim.position.distanceTo( expected ) < 1e-12 );
	assert.ok( runner.position.distanceTo( runner.previousPosition ) > 0.01, 'moving' );

} );

test( 'paused, frames run no step and the runner is drawn where its last step left it', async () => {

	const sim = await loaded();
	for ( let i = 0; i < 20; i ++ ) play( sim, 1 / 60, RUN );
	sim.paused = true;
	const at = sim.runner.position.clone(), time = sim.runner.time;
	for ( let i = 0; i < 20; i ++ ) play( sim, 1 / 60, RUN );
	assert.equal( sim.steps, 0 );
	assert.equal( sim.simDt, 0 );
	assert.equal( sim.runner.time, time );
	assert.ok( sim.runner.position.equals( at ) && sim.position.equals( at ) );
	sim.paused = false;
	play( sim, 1 / 60, RUN );
	assert.equal( sim.steps, 2 );

} );

test( 'slow motion eases the time down to the tuning\'s scale over its ease, and back up', async () => {

	const sim = await loaded();
	const { slowMotionScale: scale, slowMotionEase: ease } = TUNING_DEFAULTS;
	const frames = Math.ceil( ease / 0.05 );
	sim.runner.slowMotion = true;
	play( sim, 1 / 20 );
	assert.ok( sim.simDt < 0.05 && sim.simDt > 0.05 * scale, 'easing in' );
	for ( let i = 1; i < frames; i ++ ) play( sim, 1 / 20 );
	assert.equal( sim.simDt, 0.05 * scale );

	sim.runner.slowMotion = false;
	play( sim, 1 / 20 );
	assert.ok( sim.simDt < 0.05 && sim.simDt > 0.05 * scale, 'easing out' );
	for ( let i = 1; i < frames; i ++ ) play( sim, 1 / 20 );
	assert.equal( sim.simDt, 0.05 );

} );

test( 'in slow motion the figure is drawn between its steps, and the run reads only the steps\' pose', async () => {

	const sim = await loaded();
	const TURN = { ...RUN, mouse: [ 4, 0, 0 ] };
	for ( let i = 0; i < 60; i ++ ) play( sim, 1 / 60, RUN );
	sim.runner.slowMotion = true;
	for ( let i = 0; i < 30; i ++ ) play( sim, 1 / 60, TURN );

	// A step every few frames: the frames between turn the figure part of the way on, and the next frame puts the
	// step's pose back before anything reads it.
	const stepped = new Quaternion(), before = new Quaternion();
	let between = 0;
	for ( let i = 0; i < 12; i ++ ) {

		play( sim, 1 / 60, TURN );
		if ( sim.steps > 0 || ! sim.figure.between ) continue;
		stepped.fromArray( sim.figure.stepped, 0 );
		before.fromArray( sim.figure.before, 0 );
		const drawn = sim.figure.root.quaternion;
		assert.ok( drawn.angleTo( stepped ) > 0 && drawn.angleTo( before ) > 0 && drawn.angleTo( stepped ) < before.angleTo( stepped ) );
		between ++;

	}

	assert.ok( between > 0, 'frames with no step drew between steps' );
	sim.figure.showStep();
	assert.ok( sim.figure.root.quaternion.equals( new Quaternion().fromArray( sim.figure.stepped, 0 ) ) );
	assert.equal( sim.figure.between, false );

} );

test( 'a respawn after a run is a fresh load: everything the run changed is put back, the page\'s devices stay', async () => {

	const used = await loaded();
	for ( let i = 0; i < 120; i ++ ) play( used, 1 / 60, { ...RUN, mouse: [ 2, 0, 0 ] } );
	play( used, 1 / 60, { keys: [ 'KeyW', 'Space' ], edges: [ [ 'Space', 'pressed' ] ] } );
	for ( let i = 0; i < 60; i ++ ) play( used, 1 / 60, { keys: [ 'KeyW' ], edges: i === 0 ? [ [ 'Space', 'released' ] ] : [] } );
	used.setMark();
	used.respawn( 0 );

	const fresh = await loaded();
	const differ = diffDumps( stateDump( fresh ), stateDump( used ) ).filter( ( line ) => ! /^input\.(enabled|keys|mouseButtons|mouse)\b|^camera\.userData:/.test( line ) );
	assert.deepEqual( differ, [] );

} );

test( 'the mark: back to where it was set, facing the same way, and the run goes on from there', async () => {

	const sim = await loaded();
	for ( let i = 0; i < 20; i ++ ) play( sim, 1 / 60, RUN );
	sim.setMark();
	const mark = sim.runner.position.clone(), yaw = sim.runner.yaw;
	for ( let i = 0; i < 60; i ++ ) play( sim, 1 / 60, RUN );
	const time = sim.runner.time;
	assert.ok( sim.runner.position.distanceTo( mark ) > 1 );
	assert.equal( sim.backToMark(), true );
	assert.ok( sim.runner.position.distanceTo( mark ) < 1e-9 );
	assert.equal( sim.runner.yaw, yaw );
	assert.equal( sim.view.yaw, yaw );
	play( sim, 1 / 60, RUN );
	assert.ok( sim.runner.time > time, 'the run went on' );

} );

test( 'a snapshot restores the run exactly: after other input and a restore, the same input gives the same trace', async () => {

	const sim = await loaded();
	for ( let i = 0; i < 40; i ++ ) play( sim, 1 / 60, RUN );
	const record = () => {

		const trace = new Trace( sim );
		sim.onStep = () => trace.step();
		for ( let i = 0; i < 90; i ++ ) {

			play( sim, i % 2 ? 1 / 60 : 1 / 75, i === 30 ? { keys: [ 'KeyW', 'Space' ], edges: [ [ 'Space', 'pressed' ] ] } : i === 34 ? { keys: [ 'KeyW' ], edges: [ [ 'Space', 'released' ] ] } : { ...RUN, mouse: [ 1, 0, 0 ] } );
			trace.frame();

		}

		sim.onStep = null;
		return trace.toJSON();

	};

	const snapshot = takeSnapshot( sim );
	const first = record();
	for ( let i = 0; i < 120; i ++ ) play( sim, 1 / 60, { keys: [ 'KeyA', 'KeyW' ], mouse: [ - 3, 1, 0 ] } );
	restoreSnapshot( sim, snapshot );
	const again = record();
	assert.ok( compare( first, again ).exact );
	assert.ok( first.steps.some( ( row ) => row[ 9 ] !== first.steps[ 0 ][ 9 ] ), 'the state changed along the way' );

} );

test( 'a snapshot skips what is marked static, and with a shallow mark copies what the object points at', async () => {

	const sim = await loaded();
	const table = { value: 1 }, held = { value: 1 }, shell = { held };
	markStatic( table );
	markStatic( shell, { deep: false } );
	sim.runner.extras = { table, shell, held, value: 1 };
	const snapshot = takeSnapshot( sim );
	table.value = 2;
	held.value = 2;
	sim.runner.extras.value = 2;
	restoreSnapshot( sim, snapshot );
	assert.equal( sim.runner.extras.value, 1, 'run state is put back' );
	assert.equal( table.value, 2, 'a static table is not' );
	assert.equal( held.value, 1, 'what a shallow static points at is, when the run holds it too' );
	delete sim.runner.extras;

} );

test( 'while the ragdoll has the body, a snapshot can be taken but not restored', async () => {

	const sim = await loaded( { figure: new YBotFigure() } );
	for ( let i = 0; i < 30; i ++ ) play( sim, 1 / 60, RUN );
	for ( let i = 0; i < 3; i ++ ) play( sim, 1 / 60, { keys: [ 'Digit4' ], edges: i === 0 ? [ [ 'Digit4', 'pressed' ] ] : [] } );
	for ( let i = 0; i < 60 && ! sim.ragdoll.active; i ++ ) play( sim, 1 / 60, { edges: i === 0 ? [ [ 'Digit4', 'released' ] ] : [] } );
	assert.ok( sim.ragdoll.active, 'the ragdoll has the body' );
	const snapshot = takeSnapshot( sim );
	assert.equal( snapshot.restorable, false );
	assert.throws( () => restoreSnapshot( sim, snapshot ), /ragdoll/ );

} );

test( 'a simulation is built on the engine asked for: its queries are that engine\'s, and a run plays the same on either', async () => {

	const runs = {}, drops = {};
	for ( const engine of [ 'rapier', 'box3d' ] ) {

		const sim = await loaded( { engine } );
		assert.equal( sim.engine, engine );

		// The capsule dropped on the floor from 3 m: each engine finds it its own way, to the last bits.
		const from = sim.runner.position.clone().setY( sim.runner.position.y + 3 );
		drops[ engine ] = sim.queries.capsuleCast( from, from.clone().setY( from.y - 6 ), 0.185, 0.9, { group: 'movement' } ).fraction;

		const trace = new Trace( sim );
		sim.onStep = () => trace.step();
		for ( let k = 0; k < 90; k ++ ) play( sim, 1 / 60, RUN );
		runs[ engine ] = trace.toJSON();
		sim.dispose();

	}

	assert.notEqual( drops.rapier, drops.box3d );
	assert.ok( Math.abs( drops.rapier - drops.box3d ) * 6 < 0.0001, `${drops.rapier} and ${drops.box3d}` );
	const last = ( run ) => run.steps[ run.steps.length - 1 ].slice( 1, 4 );
	const [ a, b ] = [ last( runs.rapier ), last( runs.box3d ) ];
	assert.ok( Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ], a[ 2 ] - b[ 2 ] ) < 0.001, `${a} and ${b}` );

} );

test( 'a snapshot copies nothing of the physics engine\'s, on either engine: its worlds and bodies stay inside the backend', async () => {

	for ( const engine of [ 'rapier', 'box3d' ] ) {

		const sim = await loaded( { engine, figure: new YBotFigure() } );
		for ( let k = 0; k < 60; k ++ ) play( sim, 1 / 60, RUN );
		const snapshot = takeSnapshot( sim );

		// A WebAssembly handle (Rapier's pointer, an embind object) or a box3d id ({ index1, generation }).
		const engineObject = ( object ) => '__wbg_ptr' in object || '$$' in object || ( 'index1' in object && 'generation' in object );
		const reached = [ ...snapshot.copies.keys() ].filter( ( object ) => ! Array.isArray( object ) && ! ArrayBuffer.isView( object ) && engineObject( object ) );
		assert.deepEqual( reached, [], engine );
		sim.dispose();

	}

} );

test( 'a disposed simulation lets go of its physics worlds: box3d holds 128 at once, and a long session never runs out', async () => {

	// 70 simulations of two query worlds each (the timing-only figure has no ragdoll): more than box3d holds at once,
	// had each not let go of its own.
	for ( let k = 0; k < 70; k ++ ) ( await loaded( { engine: 'box3d' } ) ).dispose();

	const kept = [];
	await assert.rejects( async () => {

		for ( let k = 0; k < 70; k ++ ) kept.push( await loaded( { engine: 'box3d' } ) );

	}, /at most 128 worlds/ );
	for ( const sim of kept ) sim.dispose();

} );

test( 'random streams: each its own, the same draws after a reset, and saved and restored', () => {

	const random = new SeededRandom( 7 );
	const draws = ( name, n ) => Array.from( { length: n }, () => random.next( name ) );
	const vaults = draws( 'vaultChoice', 5 );
	assert.ok( vaults.every( ( x ) => x >= 0 && x < 1 ) );
	assert.equal( new Set( vaults ).size, 5 );

	random.reset();
	draws( 'idleChoice', 20 );
	assert.deepEqual( draws( 'vaultChoice', 5 ), vaults, 'another stream\'s draws do not move this one' );

	random.reset();
	draws( 'shakePhase', 3 );
	const saved = random.save();
	const ahead = draws( 'shakePhase', 4 );
	random.restore( saved );
	assert.deepEqual( draws( 'shakePhase', 4 ), ahead );

	assert.notDeepEqual( new SeededRandom( 8 ).stream( 'vaultChoice' )(), vaults[ 0 ], 'another seed, other draws' );

} );

test( 'the tuning: checked against its ranges, saved where the page keeps it, and nowhere for a replay', () => {

	assert.deepEqual( validateTuning( {} ), TUNING_DEFAULTS );
	assert.equal( validateTuning( { sprintSpeed: 7, notATuning: 3 } ).notATuning, undefined );
	assert.throws( () => validateTuning( { sprintSpeed: Infinity } ), /sprintSpeed/ );
	assert.throws( () => validateTuning( { gravityScale: - 2 } ), /gravityScale/ );
	assert.throws( () => validateTuning( { walkSpeed: '2' } ), /walkSpeed/ );

	const saved = new Map(), storage = { getItem: ( key ) => saved.get( key ) ?? null, setItem: ( key, value ) => saved.set( key, value ) };
	const tuning = new Tuning( storage );
	tuning.set( 'sprintSpeed', 7 );
	assert.equal( new Tuning( storage ).values.sprintSpeed, 7, 'a new page reads it back' );
	assert.throws( () => tuning.set( 'sprintSpeed', 100 ) );
	assert.equal( tuning.values.sprintSpeed, 7 );
	tuning.reset();
	assert.deepEqual( new Tuning( storage ).values, TUNING_DEFAULTS );

	saved.set( 'parkour-tuning', JSON.stringify( { sprintSpeed: 7, walkSpeed: 1000 } ) );
	assert.deepEqual( new Tuning( storage ).values, TUNING_DEFAULTS, 'saved values out of range leave the defaults' );

	const replay = new Tuning( null );
	replay.set( 'sprintSpeed', 6 );
	assert.equal( replay.values.sprintSpeed, 6 );

} );

test( 'tuning angles are radians, shown in degrees', () => {

	assert.equal( TUNING_DEFAULTS.walkableSlope, radians( 65 ) );
	assert.equal( TUNING_DEFAULTS.trickSideSector, radians( 44 ) );
	assert.equal( TUNING_DEFAULTS.stickLookRate, radians( 125 ) );
	assert.equal( showTuning( 'walkableSlope', TUNING_DEFAULTS.walkableSlope ), '65°' );
	assert.equal( showTuning( 'stickLookRate', TUNING_DEFAULTS.stickLookRate ), '125°/s' );
	assert.equal( showTuning( 'sprintSpeed', 5.85 ), '5.85 m/s' );
	// What the panel sets, typed in degrees, is the default itself.
	assert.equal( TUNING_UNITS.angle.value( 65 ), TUNING_DEFAULTS.walkableSlope );
	assert.throws( () => validateTuning( { walkableSlope: 65 } ), /walkableSlope/, 'degrees are out of range' );
	// The look sensitivity reads against its default: half the base look speeds show as 1×, and the old 1 as 2×.
	assert.equal( TUNING_DEFAULTS.mouseSensitivity, 0.5 );
	assert.equal( showTuning( 'mouseSensitivity', TUNING_DEFAULTS.mouseSensitivity ), '1×' );
	assert.equal( showTuning( 'mouseSensitivity', 1 ), '2×' );

} );
