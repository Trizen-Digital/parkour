import test from 'node:test';
import assert from 'node:assert/strict';
import '../tools/headless/env.mjs';

const { Motion } = await import( '@trizen/parkour/motion/Motion.js' );
const { markersCrossed } = await import( '@trizen/parkour/motion/markers.js' );

const STEP = 1 / 120;

// What the graph reads of a runner standing still, seen from behind.
const STANDING = { speed: 0, turnRate: 0, thirdPerson: true, plainJump: true, stick: { x: 0, y: 0 }, lean: 0, groundIK: 0, ledgeIK: 0 };

async function setup() {

	const motion = await new Motion().load();
	const markersUntil = ( seconds ) => {

		const names = [];
		for ( let time = 0; time < seconds - 1e-9; time += STEP ) {

			motion.update( STEP, STANDING );
			names.push( ...motion.takeMarkers() );

		}

		return names;

	};

	return { motion, markersUntil };

}

test( 'a landing roll plays at its own rate for its recorded length and marks the end of the roll on the way', async () => {

	const { motion, markersUntil } = await setup();

	// The roll was recorded over 1.11 s and plays 1.1 times as fast; it marks the roll's end 0.5497 s in.
	assert.equal( motion.takes.takes.get( motion.takeOf( 'landingRoll' ) ).length, 1.11 / 1.1 );
	assert.ok( Math.abs( motion.length( 'landingRoll' ) - 1.0090833 ) < 0.0001 );

	motion.moves.play( 'landingRoll' );
	assert.ok( ! markersUntil( 0.54 ).includes( 'rollEnd' ) );
	assert.ok( markersUntil( 0.02 ).includes( 'rollEnd' ) );
	assert.deepEqual( motion.takeMarkers(), [], 'the runner is told each marker once' );

} );

test( 'slipping off a perch is a move on the body, as long as its take; grabbing a pole is the pole machine\'s own', async () => {

	const { motion } = await setup();

	const slip = motion.takes.moves.get( 'perchSlip' );
	assert.equal( slip.take, 'ground_wall_bump' );
	assert.equal( slip.layer, 'body' );
	assert.equal( motion.length( 'perchSlip' ), motion.takes.takes.get( 'ground_wall_bump' ).length );
	assert.equal( motion.hasRootMotion( 'perchSlip' ), false );

	assert.ok( ! [ ...motion.takes.moves.values() ].some( ( move ) => move.take === 'pole_grab' ) );
	assert.equal( motion.graph.machines.pole.initial.pose.take, 'pole_grab' );

} );

test( 'a take\'s markers fire as its clock crosses them, every cycle when it loops, and not when it barely shows', () => {

	const take = { length: 1, markers: [ [ 'leftFoot', 0.25 ], [ 'rightFoot', 0.75 ] ] };
	const names = ( ...args ) => markersCrossed( take, ...args ).map( ( marker ) => marker.name );

	assert.deepEqual( names( 0, 1.6, { loop: true } ), [ 'leftFoot', 'rightFoot', 'leftFoot' ] );
	assert.deepEqual( names( 0.25, 0.75 ), [ 'leftFoot' ], 'from is in, to is out' );
	assert.deepEqual( names( 0, 1.6, { loop: true, weight: 0.000001 } ), [] );

} );

test( 'a take\'s sound cues fire beside its markers, typed apart, and never reach the runner', async () => {

	const take = { length: 1, markers: [ [ 'leftFoot', 0.25 ] ], sounds: [ [ 'step', 0.25 ], [ 'step', 0.75 ] ] };
	assert.deepEqual( markersCrossed( take, 0, 1 ).map( ( marker ) => `${marker.type}:${marker.name}` ), [ 'marker:leftFoot', 'sound:step', 'sound:step' ] );

	// A wall run's steps are sound cues: the motion keeps them for the sound, and the runner and the traces (which read
	// the markers) see none of them.
	const { motion } = await setup();
	const cues = [], told = [], marked = [];
	motion.moves.play( 'wallRunLeft' );
	for ( let time = 0; time < motion.length( 'wallRunLeft' ); time += STEP ) {

		motion.update( STEP, STANDING );
		cues.push( ...motion.sounds.map( ( cue ) => cue.name ) );
		marked.push( ...motion.markers.map( ( marker ) => marker.name ) );
		told.push( ...motion.takeMarkers() );

	}

	assert.deepEqual( cues, [ 'step', 'step', 'step' ] );
	assert.ok( ! told.includes( 'step' ) && ! marked.includes( 'step' ) );

} );

test( 'the graph\'s clips fire their markers at their share of the pose, once for each move of their clock', async () => {

	const { motion } = await setup();
	const player = {}, other = {};
	const clip = ( take, from, to, owner ) => ( { kind: 'clip', take, time: to, from, to, loop: true, player: owner } );

	// The same player on both sides of a mix fires once, at both shares together; in a blend only the heaviest take
	// fires.
	const run = motion.takes.takes.get( 'ground_run_lean_left' );
	const foot = run.markers[ 0 ][ 1 ];
	const recipe = {
		kind: 'mix', weight: 0.25,
		a: clip( 'ground_run_lean_left', foot - 0.01, foot + 0.01, player ),
		b: { kind: 'blend', markers: 'heaviest', samples: [
			{ weight: 0.3, recipe: clip( 'ground_run_lean_right', 0, run.length, other ) },
			{ weight: 0.7, recipe: clip( 'ground_run_lean_left', foot - 0.01, foot + 0.01, player ) },
		] },
	};

	const fired = motion.graphMarkers( recipe );
	const markers = fired.filter( ( marker ) => marker.type === 'marker' );
	assert.equal( markers.length, 1 );
	assert.equal( markers[ 0 ].name, run.markers[ 0 ][ 0 ] );
	assert.equal( markers[ 0 ].weight, 0.75 + 0.25 * 0.7 );
	// The take's sound cue at that footfall fires with it, once, at the same share.
	assert.deepEqual( fired.filter( ( marker ) => marker.type === 'sound' ).map( ( cue ) => [ cue.name, cue.weight ] ), [ [ 'step', 0.75 + 0.25 * 0.7 ] ] );

	assert.deepEqual( motion.graphMarkers( recipe ), [], 'a clock that has not moved fires nothing again' );

} );

test( 'starting afresh leaves no move playing, no marker waiting and the graph at its start', async () => {

	const { motion, markersUntil } = await setup();
	markersUntil( 1 );
	motion.moves.play( 'landingRoll' );
	markersUntil( 0.1 );

	motion.reset();
	assert.equal( motion.moves.busy(), false );
	assert.deepEqual( motion.takeMarkers(), [] );
	assert.equal( motion.graph.frame, 0 );

} );
