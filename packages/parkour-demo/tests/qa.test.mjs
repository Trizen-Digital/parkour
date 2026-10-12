// QA replays play again exactly: runs recorded the way the game records them (Manual and Easy, a bail, a gamepad,
// events between frames, a take-over, another physics engine) replay on fresh simulations with every frame's hash the
// same. And the parts around them: the recording format, the store in qa/, the lane driver, the kept looks.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { PROJECT } = await import( '../tools/headless/env.mjs' );
const { DeviceState } = await import( '@trizen/parkour/input/deviceState.js' );
const { Pilot } = await import( '@trizen/parkour/pilot/Pilot.js' );
const { Recorder } = await import( '../src/qa/recorder.js' );
const { Replay, replaySim, takeOver } = await import( '../src/qa/replay.js' );
const { FORMAT, encodeInput, decodeInput, engineOf, pressesOf, summarize } = await import( '@trizen/parkour/replay/tape.js' );
const { LaneDriver, laneStart } = await import( '../src/qa/lanes.js' );
const { VisualRig } = await import( '../src/qa/visual.js' );
const { COURSES } = await import( '../tools/headless/scenarios.mjs' );
const { YBotFigure } = await import( '../src/figure/YBotFigure.js' );
const { qaStore } = await import( '../tools/qa-store.js' );
const { fingerprintOf } = await import( '../tools/qa/fingerprint.mjs' );

const COURSE = 'test_jumps';
const course = JSON.parse( fs.readFileSync( path.join( PROJECT, 'public/courses', `${COURSE}.json` ), 'utf8' ) );

// Frame times as a real display gives them: 60 Hz wobbling, with stretches at 144 Hz.
const dtAt = ( i ) => i % 400 > 300 ? 0.006944 : Math.round( ( 1 / 60 + 0.004 * Math.sin( i * 2.399963 ) * Math.cos( i * 0.7071 ) ) * 1e6 ) / 1e6;

// The game's recording loop on a replay simulation: the pilot thinks, the recorder brackets the frame, the frame's
// raw input goes in through the recorder.
async function session( { figure, engine } = {} ) {

	const sim = await replaySim( course, { figure, engine } );
	const raw = new DeviceState( sim.input );
	const pilot = new Pilot( sim );
	const recorder = new Recorder( { keep: 60 } );
	recorder.attach( sim, raw );
	let i = 0;

	const frame = ( { keys = [], buttons = [], edges = [], mouse = [ 0, 0, 0 ], pad = null } = {} ) => {

		const dt = dtAt( i ++ );
		for ( const [ key, edge ] of edges ) sim.input.queueKey( key, edge );
		sim.input.navigator = pad ? { getGamepads: () => [ pad ] } : null;
		pilot.think( dt );
		recorder.beginFrame();
		sim.frame( dt, ( input ) => {

			input.keys = new Set( keys );
			input.mouseButtons = new Set( buttons );
			input.mouse = { x: mouse[ 0 ], y: mouse[ 1 ], wheel: mouse[ 2 ] };
			input.enabled = true;
			pilot.apply( input );
			recorder.capture( dt );

		} );
		recorder.endFrame();

	};

	const lane = ( index, { easy = false, early = 0 } = {} ) => {

		pilot.toggle( easy );
		recorder.easy = easy;
		recorder.respawn( laneStart( course.lanes[ index ] ) );
		const driver = new LaneDriver( course.lanes[ index ], { early } );
		while ( ! driver.done ) {

			const { keys, edges } = driver.next( sim.runner );
			frame( { keys, edges } );
			driver.after( sim );

		}

		return driver.result( sim );

	};

	return { sim, raw, pilot, recorder, frame, lane };

}

// A key pressed on top of the held keys for a few frames, then let go.
function tap( frame, key, keys = [], count = 3 ) {

	for ( let k = 0; k <= count; k ++ ) frame( { keys: k < count ? [ ...keys, key ] : keys, edges: k === 0 ? [ [ key, 'pressed' ] ] : k === count ? [ [ key, 'released' ] ] : [] } );

}

// Play before the tape (not recorded), then on it: a lane by hand, the input cleared, settings changed, a gamepad,
// a bail, a lane in Easy.
async function recordRun( options ) {

	const s = await session( options );
	const { sim, recorder, frame, lane } = s;

	recorder.setRecording( false );
	sim.respawn( 0 );
	for ( let k = 0; k < 90; k ++ ) frame( { keys: [ 'KeyW', 'ShiftLeft' ], mouse: [ 3, - 1, 0 ] } );
	tap( frame, 'Space', [ 'KeyW', 'ShiftLeft' ] );
	tap( frame, 'KeyC', [ 'KeyW' ] );
	for ( let k = 0; k < 40; k ++ ) frame( { keys: [ 'KeyW' ] } );
	tap( frame, 'Digit4' );
	for ( let k = 0; k < 60; k ++ ) frame();
	recorder.setRecording( true );

	const manual = lane( 0 );
	for ( let k = 0; k < 30; k ++ ) frame( { keys: [ 'KeyW' ], mouse: [ - 2, 1, 0 ] } );

	sim.input.clear();
	sim.tuning.values = { ...sim.tuning.values, airControl: 0.4 };
	sim.input.preferences.values.invertMouseY = true;
	sim.camera.aspect = 1.6;
	sim.camera.updateProjectionMatrix();
	for ( let k = 0; k < 30; k ++ ) frame( { keys: [ 'KeyW', 'KeyD' ], mouse: [ 0, 2, 0 ] } );

	const pad = ( south, y ) => ( { id: 'Test pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard', axes: [ - 0, y, 0.25, 0 ], buttons: Array.from( { length: 17 }, ( _, b ) => ( { pressed: b === 0 && south, value: b === 0 && south ? 1 : b === 7 ? 0.5 : 0 } ) ) } );
	for ( let k = 0; k < 40; k ++ ) frame( { pad: pad( k >= 20 && k < 26, - 0.9 ) } );

	tap( frame, 'Digit4' );
	for ( let k = 0; k < 90; k ++ ) frame( { mouse: [ 1, 0, 0 ] } );
	tap( frame, 'Space' );
	for ( let k = 0; k < 60; k ++ ) frame();

	const easy = lane( 1, { easy: true, early: 1 } );
	for ( let k = 0; k < 20; k ++ ) frame();
	return { ...s, manual, easy };

}

// A recording as the store would give it back.
function saved( body ) {

	return JSON.parse( JSON.stringify( { format: FORMAT, id: 'test', course: { name: COURSE }, notes: [], ...body } ) );

}

async function replay( rec, { figure, definition = course, engine = engineOf( rec.settings ) } = {} ) {

	const sim = await replaySim( definition, { figure, engine } );
	const replay = new Replay( sim, rec );
	const rows = [];
	replay.run( rec.frames - 1, ( row ) => rows.push( row ) );
	replay.end();
	return { divergedAt: replay.divergedAt, rows };

}

test( 'raw input frames survive the recording format exactly (−0, the gamepad, edges, runs)', () => {

	const frames = [
		{ dt: 0.016667, keys: [ 'KeyW' ], buttons: [], mouse: [ 0, - 0, 0 ], edges: [ [ 'KeyW', 'pressed' ] ], pad: null, enabled: true, editing: false },
		{ dt: 0.016, keys: [ 'KeyW', 'Space' ], buttons: [ 0 ], mouse: [ 1.5, - 2, 1 ], edges: [], pad: { id: 'pad', axes: [ - 0, - 1, 0.1, 0 ], buttons: [ [ 1, 1 ], [ 0, 0 ], [ 0, 0.25 ] ] }, enabled: true, editing: false },
		{ dt: 0.006944, keys: [ 'KeyW', 'Space' ], buttons: [ 0 ], mouse: [ 0, 0, 0 ], edges: [ [ 'Space', 'released' ], [ 'Mouse0', 'pressed' ] ], pad: null, enabled: false, editing: true },
	];
	const back = decodeInput( JSON.parse( JSON.stringify( encodeInput( frames ) ) ) );
	assert.deepEqual( back, frames );
	assert.ok( Object.is( back[ 0 ].mouse[ 1 ], - 0 ) && Object.is( back[ 1 ].pad.axes[ 0 ], - 0 ) );

} );

test( 'a recorded run (Manual, then Easy, a bail, events between frames) replays exactly on a fresh simulation', async ( t ) => {

	const { recorder, manual, easy } = await recordRun();
	const rec = saved( recorder.take( 60 ) );
	assert.equal( rec.range.from, 0 );
	assert.ok( rec.frames > 300, `${rec.frames} frames` );

	const { presses } = pressesOf( decodeInput( rec.input ) );
	assert.ok( presses.some( ( [ , name ] ) => name === 'jump' ), 'jump presses' );
	assert.deepEqual( rec.trace.easys.map( ( [ , on ] ) => on ), [ false, true ] );
	assert.ok( rec.trace.states.some( ( [ , state ] ) => state === 'bailing' || state === 'limp' ), 'a bail' );
	const kinds = rec.events.map( ( event ) => Object.keys( event ).filter( ( key ) => key !== 'f' && key !== 'edges' ).join( '+' ) );
	assert.ok( kinds.includes( 'respawn' ) && kinds.includes( 'clear' ) && kinds.includes( 'settings' ), kinds.join( ', ' ) );
	t.diagnostic( `${rec.frames} frames, ${rec.duration.toFixed( 2 )} s; lane 1 by hand ${manual.made ? 'made' : 'missed'}, lane 2 in Easy ${easy.made ? `made (${easy.caught ?? 'past'})` : 'missed'}; events: ${kinds.join( ', ' )}` );

	const { divergedAt, rows } = await replay( rec );
	assert.equal( divergedAt, null, divergedAt === null ? '' : `differs from frame ${divergedAt}: ${JSON.stringify( rows[ divergedAt ] )}` );
	assert.equal( rows.length, rec.frames );
	assert.ok( rows.every( ( row, f ) => row.hash === rec.trace.hash[ f ] ) );
	rec.window = rec.range;
	t.diagnostic( `every frame's hash the same (${rows.length}); flow: ${summarize( rec ).flow.slice( 0, 6 ).join( ' · ' )} …` );

	// Cut at the respawn: the part after it replays on its own.
	const tape = recorder.tape, respawned = tape.events.find( ( event ) => event.respawn ).f;
	const late = saved( recorder.take( tape.duration - tape.t[ respawned ] ) );
	assert.ok( late.events[ 0 ]?.f === 0 && late.events[ 0 ].respawn, 'begins at the respawn event' );
	assert.equal( ( await replay( late ) ).divergedAt, null );

} );

test( 'a tuning value changed since the recording makes the replay come out differently, from the frame it first matters', async ( t ) => {

	const { recorder } = await recordRun();
	const rec = saved( recorder.take( 60 ) );
	const sprintSpeed = rec.settings.tuning.sprintSpeed;
	rec.settings.tuning.sprintSpeed += 0.5;
	const { divergedAt, rows } = await replay( rec );
	assert.notEqual( divergedAt, null );
	assert.ok( divergedAt > 0 && rows.slice( 0, divergedAt ).every( ( row ) => row.ok ) );
	assert.ok( rows.slice( divergedAt ).some( ( row ) => ! row.ok ) );
	t.diagnostic( `sprintSpeed ${sprintSpeed} → ${rec.settings.tuning.sprintSpeed} m/s: the same up to frame ${divergedAt - 1}, then not (frame ${divergedAt}: recorded ${rec.trace.v[ divergedAt ] / 100} m/s, z ${rec.trace.z[ divergedAt ]} mm; now ${rows[ divergedAt ].v / 100} m/s, z ${rows[ divergedAt ].z} mm)` );

} );

test( 'a preference set between frames, as the panel\'s Controls set one, goes on the tape as a setting and the replay plays it back', async ( t ) => {

	const { sim, recorder, frame } = await session();
	recorder.respawn( 0 );
	for ( let k = 0; k < 60; k ++ ) frame( { keys: [ 'KeyW' ], mouse: [ 0, 2, 0 ] } );
	sim.input.preferences.set( 'invertMouseY', true );
	for ( let k = 0; k < 60; k ++ ) frame( { keys: [ 'KeyW' ], mouse: [ 0, 2, 0 ] } );
	sim.input.preferences.set( 'sprintToggle', true );
	frame( { keys: [ 'KeyW' ] } );
	tap( frame, 'ShiftLeft', [ 'KeyW' ] );
	for ( let k = 0; k < 90; k ++ ) frame( { keys: [ 'KeyW' ] } );
	assert.equal( sim.runner.sprinting, true, 'the toggle latched the sprint' );

	const rec = saved( recorder.take( 60 ) );
	const changes = rec.events.filter( ( event ) => event.settings ).map( ( { f, settings } ) => [ f, settings ] );
	assert.deepEqual( changes, [ [ 60, { preferences: { invertMouseY: true } } ], [ 120, { preferences: { sprintToggle: true } } ] ] );
	assert.equal( ( await replay( rec ) ).divergedAt, null );

	// Without a change on the tape the replay plays on without it, and comes out differently from where it matters.
	const without = ( key ) => saved( { ...rec, events: rec.events.filter( ( event ) => event.settings?.preferences?.[ key ] === undefined ) } );
	const look = ( await replay( without( 'invertMouseY' ) ) ).divergedAt, sprint = ( await replay( without( 'sprintToggle' ) ) ).divergedAt;
	assert.equal( look, 60 );
	assert.ok( sprint > 120, `sprint differs from frame ${sprint}` );
	t.diagnostic( `${rec.frames} frames; without the look inversion the replay differs from frame ${look}, without the sprint toggle from frame ${sprint}` );

} );

test( 'play from here: a replay run to a frame on the live simulation, played on and captured again, replays exactly', async ( t ) => {

	const { recorder: first } = await recordRun();
	const rec = saved( first.take( 60 ) );

	const live = await session();
	live.recorder.respawn( 0 );
	for ( let k = 0; k < 60; k ++ ) live.frame( { keys: [ 'KeyW', 'KeyA' ], mouse: [ 2, 0, 0 ] } );
	const to = Math.floor( rec.frames / 2 );
	await takeOver( live, rec, to );
	assert.equal( live.recorder.tape.n, to + 1 );
	assert.deepEqual( live.recorder.tape.rows.map( ( row ) => row.hash ), rec.trace.hash.slice( 0, to + 1 ) );

	live.sim.camera.aspect = 1.25;
	live.sim.camera.updateProjectionMatrix();
	for ( let k = 0; k < 40; k ++ ) live.frame( { keys: [ 'KeyW', 'ShiftLeft' ], mouse: [ - 1, 0, 0 ] } );
	tap( live.frame, 'Space', [ 'KeyW', 'ShiftLeft' ] );
	for ( let k = 0; k < 60; k ++ ) live.frame( { keys: [ 'KeyW' ] } );
	const again = saved( live.recorder.take( 600 ) );
	assert.equal( again.frames, to + 1 + 104 );
	assert.ok( again.events.some( ( event ) => event.f === to + 1 && event.settings?.aspect === 1.25 ), 'the aspect change on the tape' );
	const { divergedAt } = await replay( again );
	assert.equal( divergedAt, null, `differs from frame ${divergedAt}` );
	t.diagnostic( `taken over at frame ${to} of ${rec.frames}, played on for 104 frames: the capture (${again.frames} frames from the recording's start) replays exactly` );

} );

test( 'runs at test_basic\'s bar, pole, pipe and zipline, one after another with a respawn at each start: each replays exactly from its respawn', async ( t ) => {

	const basic = JSON.parse( fs.readFileSync( path.join( PROJECT, 'public/courses/test_basic.json' ), 'utf8' ) );
	const sim = await replaySim( basic );
	const raw = new DeviceState( sim.input ), pilot = new Pilot( sim ), recorder = new Recorder( { keep: 600 } );
	recorder.attach( sim, raw );
	const scenarios = COURSES.filter( ( scenario ) => scenario.course === 'test_basic' );
	const starts = [];
	let i = 0;
	for ( const scenario of scenarios ) {

		recorder.respawn( scenario.start.position ? scenario.start : scenario.start.spawn );
		starts.push( recorder.tape.n );
		let clock = 0, held = [], buttons = [];
		while ( clock < scenario.seconds ) {

			const dt = dtAt( i ++ ), active = scenario.inputs.filter( ( input ) => clock >= input.at && clock < input.until );
			const keys = [ ...new Set( active.flatMap( ( input ) => input.keys ?? [] ) ) ], down = [ ...new Set( active.flatMap( ( input ) => input.buttons ?? [] ) ) ];
			const mouse = active.reduce( ( sum, input ) => input.mouse ? [ sum[ 0 ] + input.mouse[ 0 ], sum[ 1 ] + input.mouse[ 1 ], 0 ] : sum, [ 0, 0, 0 ] );
			const edges = [
				...keys.filter( ( key ) => ! held.includes( key ) ).map( ( key ) => [ key, 'pressed' ] ), ...held.filter( ( key ) => ! keys.includes( key ) ).map( ( key ) => [ key, 'released' ] ),
				...down.filter( ( b ) => ! buttons.includes( b ) ).map( ( b ) => [ `Mouse${b}`, 'pressed' ] ), ...buttons.filter( ( b ) => ! down.includes( b ) ).map( ( b ) => [ `Mouse${b}`, 'released' ] ),
			];
			for ( const [ key, edge ] of edges ) sim.input.queueKey( key, edge );
			pilot.think( dt );
			recorder.beginFrame();
			sim.frame( dt, ( input ) => {

				input.keys = new Set( keys );
				input.mouseButtons = new Set( down );
				input.mouse = { x: mouse[ 0 ], y: mouse[ 1 ], wheel: 0 };
				input.enabled = true;
				recorder.capture( dt );

			} );
			recorder.endFrame();
			held = keys;
			buttons = down;
			clock += dt;

		}

	}

	const tape = recorder.tape, states = new Set( tape.rows.map( ( row ) => row.state ) );
	for ( const state of [ 'onBar', 'onPipe', 'onZipline' ] ) assert.ok( states.has( state ), `${state} in ${[ ...states ].join( ', ' )}` );
	const all = saved( recorder.take( 600 ) );
	assert.equal( ( await replay( all, { definition: basic } ) ).divergedAt, null );
	const lengths = [];
	for ( const start of starts.slice( 1 ) ) {

		const rec = saved( recorder.take( tape.duration - tape.t[ start ] ) );
		assert.ok( rec.events[ 0 ]?.respawn, 'begins at a respawn' );
		const { divergedAt } = await replay( rec, { definition: basic } );
		assert.equal( divergedAt, null, `from the respawn at frame ${start}: differs from frame ${divergedAt}` );
		lengths.push( rec.frames );

	}

	t.diagnostic( `${scenarios.map( ( scenario ) => scenario.name.replace( 'test_basic-', '' ) ).join( ', ' )}: ${tape.n} frames, states ${[ ...states ].join( ' ' )}; the whole tape and each run from its respawn (${lengths.join( ', ' )} frames) replay exactly` );

} );

test( 'with the Y Bot (first person rides its head) a run with a bail replays exactly too', async ( t ) => {

	const { sim, recorder, frame } = await session( { figure: new YBotFigure() } );
	recorder.respawn( 0 );
	for ( let k = 0; k < 60; k ++ ) frame( { keys: [ 'KeyW', 'ShiftLeft' ], mouse: [ 2, 0, 0 ] } );
	tap( frame, 'KeyC', [ 'KeyW', 'ShiftLeft' ] );
	for ( let k = 0; k < 60; k ++ ) frame( { keys: [ 'KeyW', 'ShiftLeft' ], mouse: [ - 2, 1, 0 ] } );
	tap( frame, 'Space', [ 'KeyW', 'ShiftLeft' ] );
	for ( let k = 0; k < 40; k ++ ) frame( { keys: [ 'KeyW' ] } );
	tap( frame, 'KeyC', [ 'KeyW' ] );
	tap( frame, 'Digit4' );
	for ( let k = 0; k < 120; k ++ ) frame( { mouse: [ 1, 0, 0 ] } );
	const rec = saved( recorder.take( 60 ) );
	assert.ok( rec.trace.states.some( ( [ , state ] ) => state === 'bailing' || state === 'limp' ), 'a bail' );
	assert.ok( sim.figure.root.getObjectByName( sim.figure.roles.head ), 'a figure with bones' );
	const { divergedAt, rows } = await replay( rec, { figure: new YBotFigure() } );
	assert.equal( divergedAt, null, divergedAt === null ? '' : `differs from frame ${divergedAt}: ${JSON.stringify( rows[ divergedAt ] )}` );
	t.diagnostic( `${rec.frames} frames with the Y Bot, every hash the same; peak joint acceleration ${Math.max( ...rows.map( ( row ) => row.acc ) )} m/s²` );

} );

test( 'with the Y Bot, a ragdoll before the tape and one on it: the respawn that begins the tape puts the physics world back as loaded, so it replays exactly', async ( t ) => {

	const { sim, recorder, frame } = await session( { figure: new YBotFigure() } );
	let ragdolls = 0, limp = false;
	const watch = ( input ) => {

		frame( input );
		if ( sim.ragdoll.active && ! limp ) ragdolls ++;
		limp = sim.ragdoll.active;

	};
	const bail = () => {

		for ( let k = 0; k < 50; k ++ ) watch( { keys: [ 'KeyW', 'ShiftLeft' ], mouse: [ 1, 0, 0 ] } );
		tap( watch, 'Digit4', [ 'KeyW', 'ShiftLeft' ] );
		for ( let k = 0; k < 150; k ++ ) watch( { mouse: [ 1, 0, 0 ] } );

	};

	recorder.setRecording( false );
	sim.respawn( 0 );
	bail();
	recorder.setRecording( true );

	recorder.respawn( 0 );
	bail();
	assert.equal( ragdolls, 2, 'the ragdoll had the body twice' );
	const rec = saved( recorder.take( 60 ) );
	const { divergedAt, rows } = await replay( rec, { figure: new YBotFigure() } );
	assert.equal( divergedAt, null, divergedAt === null ? '' : `differs from frame ${divergedAt}: ${JSON.stringify( rows[ divergedAt ] )}` );
	t.diagnostic( `${rec.frames} frames, a ragdoll before the tape and one on it, every hash the same` );

} );

test( 'a run on box3d, with ragdolls, records its engine and replays exactly on box3d, and not on Rapier', async ( t ) => {

	const { sim, recorder, frame } = await session( { figure: new YBotFigure(), engine: 'box3d' } );
	let ragdolls = 0, limp = false;
	const watch = ( input ) => {

		frame( input );
		if ( sim.ragdoll.active && ! limp ) ragdolls ++;
		limp = sim.ragdoll.active;

	};
	const bail = () => {

		for ( let k = 0; k < 50; k ++ ) watch( { keys: [ 'KeyW', 'ShiftLeft' ], mouse: [ 1, 0, 0 ] } );
		tap( watch, 'Digit4', [ 'KeyW', 'ShiftLeft' ] );
		for ( let k = 0; k < 150; k ++ ) watch( { mouse: [ 1, 0, 0 ] } );

	};

	// A ragdoll before the tape, and two on it with a respawn between: each starts in a world built fresh.
	recorder.setRecording( false );
	sim.respawn( 0 );
	bail();
	recorder.setRecording( true );
	recorder.respawn( 0 );
	bail();
	recorder.respawn( 0 );
	bail();
	assert.equal( ragdolls, 3, 'the ragdoll had the body three times' );
	const rec = saved( recorder.take( 60 ) );
	assert.equal( rec.settings.engine, 'box3d' );

	const again = await replay( rec, { figure: new YBotFigure() } );
	assert.equal( again.divergedAt, null, again.divergedAt === null ? '' : `differs from frame ${again.divergedAt}: ${JSON.stringify( again.rows[ again.divergedAt ] )}` );
	const elsewhere = await replay( rec, { figure: new YBotFigure(), engine: 'rapier' } );
	assert.notEqual( elsewhere.divergedAt, null, 'the same input on Rapier makes another run' );
	t.diagnostic( `${rec.frames} frames on box3d, every hash the same on box3d; on Rapier it comes out differently from frame ${elsewhere.divergedAt}` );

} );

test( 'a lane is pressed where it says, held for its tap, and judged by what the runner does', () => {

	const lane = { start: [ 0, 0, 0 ], yaw: 90, feature: [ 10, 0, 0 ], press: 'up', at: 2, drive: 'full' };
	assert.deepEqual( laneStart( lane ).position, [ 0, 0.9215, 0 ] );
	const driver = new LaneDriver( lane, { early: 0.5, tap: 2 } );
	const runner = { position: { x: 0, z: 0 }, state: 'sprinting', grounded: true };
	const sim = { runner, ragdoll: { active: false } };
	const frames = [];
	for ( const x of [ 6, 7, 7.5, 8, 8.5, 9 ] ) {

		runner.position.x = x;
		frames.push( driver.next( runner ) );
		driver.after( sim );

	}

	// 2.5 m before the feature (2 m, half a metre early): pressed, held two frames, let go.
	assert.equal( driver.pressedAt, 2 );
	assert.deepEqual( frames.map( ( frame ) => frame.keys.includes( 'Space' ) ), [ false, false, true, true, false, false ] );
	assert.deepEqual( frames.flatMap( ( frame ) => frame.edges ), [ [ 'Space', 'pressed' ], [ 'Space', 'released' ] ] );
	assert.ok( frames.every( ( frame ) => frame.keys.includes( 'KeyW' ) && frame.keys.includes( 'ShiftLeft' ) ) );
	assert.equal( driver.done, false );

	runner.state = 'hanging';
	driver.after( sim );
	assert.equal( driver.done, true );
	assert.deepEqual( { made: driver.result( sim ).made, caught: driver.result( sim ).caught }, { made: true, caught: 'hanging' } );

	const short = new LaneDriver( lane );
	runner.state = 'bailing';
	short.after( sim );
	assert.equal( short.result( sim ).made, false );
	assert.equal( short.result( sim ).bailed, true );

} );

test( 'a kept look puts the figure and the camera back exactly as they were', async () => {

	const sim = await replaySim( course, { figure: new YBotFigure() } );
	sim.respawn( 0 );
	for ( let k = 0; k < 30; k ++ ) sim.frame( 1 / 60, ( input ) => {

		input.keys = new Set( [ 'KeyW', 'ShiftLeft' ] );

	} );
	const rig = new VisualRig( sim.figure, sim.camera );
	const look = rig.capture();
	const camera = sim.camera.position.clone(), fov = sim.camera.fov;
	for ( let k = 0; k < 30; k ++ ) sim.frame( 1 / 60, ( input ) => {

		input.keys = new Set( [ 'KeyA' ] );

	} );
	assert.notDeepEqual( Array.from( rig.capture() ), Array.from( look ) );
	rig.apply( look );
	assert.deepEqual( Array.from( rig.capture() ), Array.from( look ) );
	assert.ok( sim.camera.position.equals( camera ) && sim.camera.fov === fov );

	// Without the camera (the editor's orbit), the camera stays where it is.
	sim.camera.position.set( 1, 2, 3 );
	rig.apply( look, { camera: null } );
	assert.deepEqual( sim.camera.position.toArray(), [ 1, 2, 3 ] );

} );

test( 'the QA store keeps replays in qa/: summaries for the library, only the editable fields patched, courses kept once, deletes to the trash', async () => {

	const root = fs.mkdtempSync( path.join( os.tmpdir(), 'qa-store-' ) );
	let handler;
	qaStore( { root } ).configureServer( { config: { base: '/' }, middlewares: { use: ( mount, handle ) => handler = handle } } );
	const call = ( method, url, body ) => new Promise( ( resolve ) => {

		const request = { method, url, async * [ Symbol.asyncIterator ]() {

			if ( body !== undefined ) yield Buffer.from( typeof body === 'string' ? body : JSON.stringify( body ) );

		} };
		const response = { headers: {}, setHeader( key, value ) {

			this.headers[ key ] = value;

		}, end( data ) {

			const text = String( data );
			resolve( { status: this.statusCode, json: this.headers[ 'Content-Type' ].includes( 'json' ) ? JSON.parse( text ) : null } );

		} };
		handler( request, response );

	} );

	const rec = { id: '20260101-120000-test_jumps', title: 'Short of the ledge', created: '2026-01-01T12:00:00Z', course: { name: COURSE, lane: 2 }, notes: [ { id: 'n1', f: 10, t: 0.2, text: 'drops here' } ], window: { from: 0, to: 9, t0: 0, t1: 1.5 }, input: { dt: [ 0.016 ] }, trace: { hash: [ 1 ] } };
	assert.equal( ( await call( 'PUT', `/replays/${rec.id}`, rec ) ).status, 200 );
	const index = ( await call( 'GET', '/index' ) ).json;
	assert.deepEqual( index.replays.map( ( summary ) => [ summary.id, summary.title, summary.course, summary.lane, summary.duration, summary.notes[ 0 ].text ] ), [ [ rec.id, rec.title, COURSE, 2, 1.5, 'drops here' ] ] );

	await call( 'PATCH', `/replays/${rec.id}`, { title: 'Falls short', input: { dt: [] }, trace: null } );
	const back = ( await call( 'GET', `/replays/${rec.id}` ) ).json;
	assert.equal( back.title, 'Falls short' );
	assert.deepEqual( back.input, rec.input, 'the recording itself never changes' );
	assert.deepEqual( back.trace, rec.trace );

	await call( 'PUT', '/courses/test_jumps-0000abcd.json', '{"name":"first"}' );
	await call( 'PUT', '/courses/test_jumps-0000abcd.json', '{"name":"second"}' );
	assert.equal( ( await call( 'GET', '/courses/test_jumps-0000abcd.json' ) ).json.name, 'first' );

	assert.equal( ( await call( 'GET', '/replays/..%2Fsecrets' ) ).status, 400 );
	await call( 'DELETE', `/replays/${rec.id}` );
	assert.equal( ( await call( 'GET', `/replays/${rec.id}` ) ).status, 404 );
	assert.ok( fs.existsSync( path.join( root, 'trash', rec.id, `${rec.id}.json` ) ) );
	fs.rmSync( root, { recursive: true } );

} );

// The curated replays (qa/replays/, promoted from the library) come out exactly as recorded on the code as it is now:
// a change that alters one is either a bug or meant, and then the replay is recorded again with the reason.
const CURATED = path.join( PROJECT, 'qa/replays' );
const curated = fs.existsSync( CURATED ) ? fs.readdirSync( CURATED ).filter( ( file ) => file.endsWith( '.json' ) ).sort() : [];

for ( const file of curated ) {

	test( `the curated replay ${file} comes out exactly as recorded`, async () => {

		const rec = JSON.parse( fs.readFileSync( path.join( CURATED, file ), 'utf8' ) );
		const definition = JSON.parse( fs.readFileSync( path.join( PROJECT, 'qa/courses', rec.course.file ), 'utf8' ) );
		const { divergedAt, rows } = await replay( rec, { figure: new YBotFigure(), definition } );
		// Played in a browser, a run may come out differently in node from the start (the browser's maths): then node
		// must still make the run it made when the replay was promoted.
		if ( rec.headless ) assert.equal( fingerprintOf( rows.map( ( row ) => row.hash ) ), rec.headless.fingerprint, `node makes another run of it than when it was promoted at ${rec.headless.commit}` );
		else assert.equal( divergedAt, null, `comes out differently from frame ${divergedAt}` );

	} );

}
