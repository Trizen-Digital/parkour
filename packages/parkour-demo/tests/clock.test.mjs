import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock } from '@trizendigital/parkour/runner/Clock.js';

const STEP = 1 / 120;

// Runs the clock a number of steps the way the runner does: each run to the last time plus a step.
function steps( clock, count, args = [] ) {

	for ( let i = 0; i < count; i ++ ) clock.run( clock.time + STEP, ...args );

}

test( 'a timer fires at the start of the step its time falls in, once, with what the run passes', () => {

	const clock = new Clock();
	const calls = [];

	clock.after( 0.02, 'ping', ( ...args ) => calls.push( [ clock.time, ...args ] ) );
	steps( clock, 2, [ 'input' ] );
	assert.equal( calls.length, 0 );
	assert.ok( clock.pending( 'ping' ) );

	steps( clock, 1, [ 'input' ] );
	assert.equal( calls.length, 1 );
	assert.equal( calls[ 0 ][ 1 ], 'input' );
	assert.ok( Math.abs( calls[ 0 ][ 0 ] - 3 * STEP ) < 1e-12 );
	assert.equal( clock.pending( 'ping' ), false );

	steps( clock, 10 );
	assert.equal( calls.length, 1 );

} );

test( 'a time some steps ahead fires on that step, whatever the sum of the steps rounds to', () => {

	// 0.35 s is 42 steps; the summed step times land a hair past or short of 0.35 * k.
	for ( const seconds of [ 0.1, 0.2, 0.25, 0.35, 0.7, 1.8 ] ) {

		const clock = new Clock();
		let firedAt = 0;

		steps( clock, 37 );
		clock.after( seconds, 'due', () => {

			firedAt = Math.round( clock.time / STEP ) - 37;

		} );
		steps( clock, 300 );
		assert.equal( firedAt, Math.round( seconds / STEP ), `${ seconds } s` );

	}

} );

test( 'setting a name again replaces its timer; cancelling forgets it', () => {

	const clock = new Clock();
	const calls = [];

	clock.after( 0.05, 'end', () => calls.push( 'first' ) );
	clock.after( 0.1, 'end', () => calls.push( 'second' ) );
	steps( clock, 6 );
	assert.deepEqual( calls, [] );
	steps( clock, 6 );
	assert.deepEqual( calls, [ 'second' ] );

	clock.after( 0.05, 'end', () => calls.push( 'third' ) );
	clock.cancel( 'end' );
	steps( clock, 12 );
	assert.deepEqual( calls, [ 'second' ] );

} );

test( 'timers due in one run fire earliest first, those due together in the order they were set', () => {

	const clock = new Clock();
	const calls = [];

	clock.after( 0.03, 'late', () => calls.push( 'late' ) );
	clock.after( 0.01, 'b', () => calls.push( 'b' ) );
	clock.after( 0.01, 'a', () => calls.push( 'a' ) );
	clock.run( 0.05 );
	assert.deepEqual( calls, [ 'b', 'a', 'late' ] );

} );

test( 'a timer cancelled or replaced by an earlier one in the same run does not fire', () => {

	const clock = new Clock();
	const calls = [];

	clock.after( 0.01, 'reset', () => {

		calls.push( 'reset' );
		clock.cancel( 'cancelled' );
		clock.after( 0.5, 'replaced', () => calls.push( 'replaced later' ) );

	} );
	clock.after( 0.02, 'cancelled', () => calls.push( 'cancelled' ) );
	clock.after( 0.02, 'replaced', () => calls.push( 'replaced' ) );
	clock.run( 0.05 );
	assert.deepEqual( calls, [ 'reset' ] );
	assert.ok( clock.pending( 'replaced' ) );

} );

test( 'a timer set during a run waits for the next run: 0 seconds is the next step', () => {

	const clock = new Clock();
	const calls = [];

	clock.after( 0, 'first', () => {

		calls.push( 'first' );
		clock.after( 0, 'next', () => calls.push( 'next' ) );

	} );
	steps( clock, 1 );
	assert.deepEqual( calls, [ 'first' ] );
	steps( clock, 1 );
	assert.deepEqual( calls, [ 'first', 'next' ] );

} );

test( 'a hold lasts its seconds, is replaced by the next hold of its name (shorter too), and ends when released', () => {

	const clock = new Clock();

	assert.equal( clock.held( 'lock' ), false );
	assert.equal( clock.readyAt( 'lock' ), 0 );

	clock.hold( 'lock', 0.35 );
	assert.ok( clock.held( 'lock' ) );
	assert.ok( Math.abs( clock.readyAt( 'lock' ) - 0.35 ) < 1e-12 );

	steps( clock, 41 );
	assert.ok( clock.held( 'lock' ) );
	steps( clock, 1 );
	assert.equal( clock.held( 'lock' ), false, 'free on the step that reaches 0.35 s' );
	assert.equal( clock.readyAt( 'lock' ), clock.time );

	clock.hold( 'lock', Infinity );
	steps( clock, 1000 );
	assert.ok( clock.held( 'lock' ) );
	clock.hold( 'lock', 0.1 );
	steps( clock, 12 );
	assert.equal( clock.held( 'lock' ), false );

	clock.hold( 'lock', 1 );
	clock.release( 'lock' );
	assert.equal( clock.held( 'lock' ), false );

} );

test( 'a hold reads right while the time moves on without the clock running; its timers wait for the run', () => {

	const clock = new Clock();
	let fired = false;

	clock.hold( 'getUpLock', 0.2 );
	clock.after( 0.1, 'timer', () => {

		fired = true;

	} );

	// As the ragdoll's steps do: the time alone.
	for ( let i = 0; i < 30; i ++ ) clock.time += STEP;
	assert.equal( clock.held( 'getUpLock' ), false );
	assert.equal( fired, false );

	steps( clock, 1 );
	assert.ok( fired );

} );

test( 'a beat counts the step it begins in, comes every interval, and catches up after a wait', () => {

	const clock = new Clock();
	const beats = [];

	// Begun in the first step: due 0.1 s after that step began, so on step 12, then every 12 steps.
	for ( let i = 1; i <= 36; i ++ ) {

		clock.run( clock.time + STEP );
		if ( clock.every( 'check', 0.1 ) ) beats.push( i );

	}

	assert.deepEqual( beats, [ 12, 24, 36 ] );

	// Asked twice in one step, it counts its beat once.
	steps( clock, 12 );
	assert.equal( clock.every( 'check', 0.1 ), 1 );
	assert.equal( clock.every( 'check', 0.1 ), 0 );

	// After half a second unasked, the beats that came are counted at once.
	steps( clock, 60 );
	assert.equal( clock.every( 'check', 0.1 ), 5 );

} );

test( 'a beat begun mid-run counts from the start of its step; cancelling it begins it again', () => {

	const clock = new Clock();

	steps( clock, 7 );
	assert.equal( clock.every( 'burn', 0.05 ), 0 );

	// Begun in step 7, so due 0.05 s after step 6: step 12.
	let fired = 0;

	for ( let i = 8; i <= 12; i ++ ) {

		clock.run( clock.time + STEP );
		if ( clock.every( 'burn', 0.05 ) ) fired = i;

	}

	assert.equal( fired, 12 );

	clock.cancel( 'burn' );
	steps( clock, 3 );
	assert.equal( clock.every( 'burn', 0.05 ), 0 );
	steps( clock, 5 );
	assert.equal( clock.every( 'burn', 0.05 ), 1 );

} );

test( 'cancel forgets a timer, a hold and a beat of a name; clear forgets everything', () => {

	const clock = new Clock();
	let fired = false;

	clock.after( 0.1, 'a', () => {

		fired = true;

	} );
	clock.hold( 'b', 1 );
	steps( clock, 1 );
	clock.every( 'c', 0.05 );
	clock.cancel( 'a', 'b', 'c' );
	assert.equal( clock.pending( 'a' ), false );
	assert.equal( clock.held( 'b' ), false );
	steps( clock, 6 );
	assert.equal( clock.every( 'c', 0.05 ), 0, 'begun again' );

	clock.after( 0.01, 'a', () => {

		fired = true;

	} );
	clock.hold( 'b', 1 );
	clock.clear();
	steps( clock, 20 );
	assert.equal( fired, false );
	assert.equal( clock.held( 'b' ), false );

} );
