import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { SkidStops } from '@trizen/parkour/runner/SkidStops.js';
import { Clock } from '@trizen/parkour/runner/Clock.js';

// A runner on the ground still carrying speed, with a motion that only records which moves start and stop.
function setup() {

	const played = [], stopped = [];
	const runner = {
		grounded: true,
		state: 'standing',
		velocity: new Vector3( 3, 0, 0 ),
		clock: new Clock(),
		motion: {
			moves: {
				playing: () => null,
				play( name, options ) {

					played.push( { name, options } );

					return { name };

				},
				stop: ( name ) => stopped.push( name )
			}
		}
	};
	const input = { move: { x: 0, y: 0 }, held: () => false };

	const skidStops = new SkidStops( runner );

	// The runner's step for the skid stops: the time moves on, then they look at the stick.
	const step = ( dt ) => {

		runner.clock.run( runner.clock.time + dt, input );
		skidStops.everyStep( input );

	};

	return { runner, input, played, stopped, skidStops, step };

}

const skids = ( names ) => names.filter( ( name ) => name === 'skidStop' ).length;

test( 'letting go of the stick at speed skids once, and moving again re-arms it', () => {

	const { runner, input, played, stopped, step } = setup();

	step( 0.01 );
	assert.equal( played.length, 1 );
	assert.equal( played[ 0 ].name, 'skidStop' );
	step( 0.01 );
	assert.equal( played.length, 1 );

	input.move.y = 1;
	step( 0.01 );
	assert.equal( skids( stopped ), 1 );
	input.move.y = 0;

	// x and z are checked apart: 2 m/s on both is 2.83 m/s across the ground, still too slow to skid.
	runner.velocity.set( 2, 0, 2 );
	step( 0.01 );
	assert.equal( played.length, 1 );
	runner.velocity.z = 2.55001;
	step( 0.01 );
	assert.equal( played.length, 2 );

} );

test( 'first person and a slide use up the skid without playing it', () => {

	const { runner, input, played, step } = setup();

	runner.firstPerson = true;
	step( 0.01 );
	runner.firstPerson = false;
	step( 0.01 );
	assert.equal( played.length, 0 );

	input.move.x = 1;
	step( 0.01 );
	input.move.x = 0;
	runner.state = 'sliding';
	step( 0.01 );
	runner.state = 'standing';
	step( 0.01 );
	assert.equal( played.length, 0 );

} );

test( 'a finished stride keeps the skid going against the stick for 0.45 s, but falling still stops it', () => {

	const { runner, input, played, stopped, skidStops, step } = setup();

	skidStops.strideCompleted( input );
	assert.equal( played.length, 1 );

	input.move.y = 1;
	step( 0.4 );
	assert.equal( stopped.length, 0 );

	// A second stride starts the 0.45 s again.
	skidStops.strideCompleted( input );
	step( 0.1 );
	assert.equal( stopped.length, 0 );

	runner.grounded = false;
	step( 0.01 );
	assert.equal( skids( stopped ), 1 );

	runner.grounded = true;
	step( 0.34 );
	assert.equal( skids( stopped ), 2 );

} );

test( 'a stride ends without a skid in a roll or precision window, or while sprinting', () => {

	const { runner, input, played, skidStops } = setup();

	runner.clock.hold( 'rollWindow', 0.35 );
	assert.equal( skidStops.strideCompleted( input ), null );
	runner.clock.release( 'rollWindow' );

	runner.clock.hold( 'precisionWindow', 0.35 );
	assert.equal( skidStops.strideCompleted( input ), null );
	runner.clock.release( 'precisionWindow' );

	// With the sprint toggle on, the held sprint is the latch, so a toggled sprint counts too.
	input.held = ( action ) => action === 'sprint';
	assert.equal( skidStops.strideCompleted( input ), null );
	assert.equal( played.length, 0 );

	input.held = () => false;
	assert.equal( skidStops.strideCompleted( input ).name, 'skidStop' );

} );
