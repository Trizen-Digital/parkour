import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { PolesAndBars } from '@trizendigital/parkour/runner/PolesAndBars.js';
import { Clock } from '@trizendigital/parkour/runner/Clock.js';
import { TUNING_DEFAULTS } from '@trizendigital/parkour/sim/tuning.js';

const near = ( actual, expected ) => assert.ok( Math.abs( actual - expected ) < 1e-7, actual + ' != ' + expected );

const UP = new Vector3( 0, 1, 0 );

// The runner's step (s).
const STEP = 1 / 120;

// The course tags a bar's solid 'bar'; a wall carries no tags.
const BAR = { id: 'bar', owner: 'bar', tags: [ 'bar' ] };
const WALL = { id: 'wall', owner: 'wall', tags: [] };

// Where the runner's probes meet a bar ahead of it, and the bar's face toward the runner.
const ON_BAR = new Vector3( 0, 6, 0.7 );
const TOWARD = new Vector3( 0, 0, - 1 );

const hit = ( point, normal, solid ) => ( {
	point,
	centre: point.clone(),
	normal,
	faceNormal: normal.clone(),
	distance: 0,
	fraction: 0,
	startedInside: false,
	solid
} );

const pole = () => ( { id: 'pole', bottom: new Vector3( 0, 0, 0 ), top: new Vector3( 0, 10, 0 ), radius: 0.05 } );

// The probes of a bar ahead at chest height: the bar, then its top, nothing behind it or in the body's way, and the
// bar under both hands. A change replaces what one of them finds.
function barAhead( change = {}, calls = [] ) {

	const found = {
		bar: hit( ON_BAR, TOWARD, BAR ),
		top: hit( ON_BAR.clone().addScaledVector( UP, 0.1 ), UP.clone(), BAR ),
		behind: null,
		body: null,
		hands: hit( ON_BAR, TOWARD, BAR ),
		...change
	};
	const casts = [ found.bar, found.top ];

	return {
		sphereCast: ( from, to, radius, options ) => {

			calls.push( { from: from.clone(), to: to.clone(), radius, options } );

			return casts.shift() ?? null;

		},
		overlapSphere: ( at, radius ) => ( radius < 0.1 ? found.hands : found.behind ),
		overlapCapsule: () => found.body
	};

}

// A runner falling past, grab held, with the given poles in the course and queries.
function setup( { poles = [], queries = {} } = {} ) {

	// A second into the run, stepped at 120 Hz.
	const clock = new Clock();

	clock.run( 1 - STEP );
	clock.run( 1 );

	const c = {
		clock,
		get time() {

			return this.clock.time;

		},
		position: new Vector3( 0, 5, - 0.3 ),
		velocity: new Vector3( 0, - 2, 0 ),
		yaw: 0,
		grounded: false,
		state: 'falling',
		events: [],
		world: { poles, solids: [ BAR, WALL ] },
		tuning: { values: { ...TUNING_DEFAULTS } },
		queries: { sphereCast: () => null, overlapSphere: () => null, overlapCapsule: () => null, ray: () => null, ...queries },
		motion: { moves: { play() {} }, playTake() {} },
		capsule: { halfHeight: 0.9 },
		// Bails asked for.
		bail: {
			requests: 0,
			request() {

				this.requests ++;

				return true;

			}
		},
		forward() {

			return new Vector3( Math.sin( this.yaw ), 0, Math.cos( this.yaw ) );

		},
		setState( state ) {

			this.state = state;

		}
	};

	// Held actions by device: a read that names no device sees either.
	const held = { keys: new Set( [ 'grab' ] ), pad: new Set() };
	const released = new Set();
	const input = {
		move: { x: 0, y: 0 },
		held: ( action, device ) => ( device ? held[ device ].has( action ) : held.keys.has( action ) || held.pad.has( action ) ),
		released: ( action ) => released.has( action ),
		value: () => 0
	};

	// The runner's steps for a while: the clock runs each.
	const wait = ( seconds ) => {

		for ( let i = 0; i < Math.round( seconds / STEP ); i ++ ) c.clock.run( c.time + STEP, input );

	};

	return { c, input, held, released, wait, polesAndBars: new PolesAndBars( c ) };

}

test( 'a pole is caught after 0.05 s in its box, as far up it as the runner is from its foot, with the view on the head', () => {

	const { c, input, wait, polesAndBars } = setup( { poles: [ pole() ] } );

	// In the box from this step, which counts: found on the sixth.
	for ( let i = 0; i < 5; i ++ ) {

		assert.equal( polesAndBars.tryAttach( input ), false );
		wait( STEP );

	}

	assert.equal( polesAndBars.tryAttach( input ), true );
	assert.equal( c.state, 'onPole' );
	assert.equal( c.viewOnHead, true );

	polesAndBars.update( 0.2, input, 0 );
	near( c.position.y, Math.hypot( 5, 0.3 ) - 1.25 );
	near( c.position.z, - 0.3 );

} );

test( 'a pole slides down at 8 m/s and turns around it at 1.5 m/s, and a jump release kicks off toward the steer', () => {

	const { c, input, released, wait, polesAndBars } = setup( { poles: [ pole() ] } );

	polesAndBars.tryAttach( input );
	wait( 0.05 );
	polesAndBars.tryAttach( input );
	polesAndBars.update( 0.2, input, 0 );

	const y = c.position.y;
	input.value = ( action ) => ( action === 'poleTurn' ? 1 : 0 );
	polesAndBars.update( 0.1, input, 0 );
	near( c.position.y, y - 0.8 );
	near( c.position.x, 0.15 );
	near( c.position.z, - 0.285 );

	released.add( 'jump' );
	input.move.x = 1;
	polesAndBars.update( 0.01, input, 0 );
	near( c.velocity.x, - 6.5 );
	near( c.velocity.y, 2.5 );
	assert.equal( c.state, 'falling' );
	assert.equal( c.fromPole, true );
	near( c.clock.readyAt( 'noCollision' ), c.time + 0.1 );

	// The kick steers like one for 0.2 s, and the next pole waits 0.35 s.
	wait( 0.2 );
	assert.equal( c.fromPole, false );
	assert.ok( c.clock.held( 'poleLock' ) );
	wait( 0.15 );
	assert.equal( c.clock.held( 'poleLock' ), false );

} );

test( 'a bar is caught once its probes agree, settles in 0.15 s and launches by itself 0.38 s later', () => {

	const calls = [];
	const { c, input, polesAndBars } = setup( { queries: barAhead( {}, calls ) } );

	assert.equal( polesAndBars.tryAttach( input ), true );
	assert.equal( c.state, 'onBar' );
	near( calls[ 0 ].from.y, 5 - 0.26 + 0.24 );
	near( calls[ 0 ].radius, 0.1 );
	assert.equal( calls[ 0 ].options.group, 'probe' );

	polesAndBars.update( 0.15, input, 0 );
	near( c.position.y, 5.2 );
	near( c.position.z, 0.515 );
	polesAndBars.update( 0.37, input, 0 );
	near( c.velocity.y, 0 );
	polesAndBars.update( 0.01, input, 0 );
	near( c.velocity.z, 5.85 );
	near( c.velocity.y, 4.25 );
	polesAndBars.update( 0.1, input, 0 );
	near( c.velocity.y, 4.25 - 9.8 * 1.75 * 0.1 );

} );

test( 'a bar swing is refused on anything but a bar, with no room around it, a hand off it, a top the probe starts inside, or the pad jump held', () => {

	const blocked = hit( ON_BAR, TOWARD, WALL );
	const top = hit( ON_BAR.clone().addScaledVector( UP, 0.1 ), UP.clone(), BAR );

	for ( const change of [
		{ bar: blocked },
		{ behind: blocked },
		{ body: blocked },
		{ top: { ...top, startedInside: true } },
		{ hands: null }
	] ) {

		const { input, polesAndBars } = setup( { queries: barAhead( change ) } );

		assert.equal( polesAndBars.tryAttach( input ), false );

	}

	// With the pad's jump held the bar is not even looked for.
	const calls = [];
	const { input, held, polesAndBars } = setup( { queries: barAhead( {}, calls ) } );

	held.pad.add( 'jump' );
	assert.equal( polesAndBars.tryAttach( input ), false );
	assert.equal( calls.length, 0 );

} );

test( 'a bar caught falling faster than 15.5 m/s is not caught: it knocks the runner limp, a bail asked of the bail system', () => {

	const { c, input, polesAndBars } = setup( { queries: barAhead() } );

	c.velocity.y = - 16;
	assert.equal( polesAndBars.tryAttach( input ), false );
	assert.equal( c.bail.requests, 1 );
	assert.equal( c.state, 'falling' );
	assert.equal( polesAndBars.attachment, null );

} );
