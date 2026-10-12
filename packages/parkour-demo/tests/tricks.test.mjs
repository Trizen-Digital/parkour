import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { Motion } from '@trizen/parkour/motion/Motion.js';
import { Tricks } from '@trizen/parkour/runner/Tricks.js';
import { Clock } from '@trizen/parkour/runner/Clock.js';
import { Runner } from '@trizen/parkour/runner/Runner.js';
import { TUNING_DEFAULTS } from '@trizen/parkour/sim/tuning.js';

// The game's motion, loaded from the files the browser loads, to say which take each move plays.
const served = ( name ) => 'data:application/json;base64,' + readFileSync( new URL( `../public/data/${ name }.json`, import.meta.url ) ).toString( 'base64' );
const motion = await new Motion( { moves: served( 'moves' ) } ).load();

// The runner's step (s).
const STEP = 1 / 120;

// The input as the tricks read it: actions held on any device, held only on the keyboard and mouse ('keys') or only
// on the pad ('pad'), pressed or released this step, and analogue values.
function input( { held = [], keys = [], pad = [], pressed = [], released = [], values = {} } = {} ) {

	return {
		held: ( action, device ) =>
			device === 'keys' ? keys.includes( action ) :
			device === 'pad' ? pad.includes( action ) :
			held.includes( action ) || keys.includes( action ) || pad.includes( action ),
		pressed: ( action ) => pressed.includes( action ),
		released: ( action ) => released.includes( action ),
		value: ( action ) => values[ action ] ?? 0
	};

}

// A runner, standing or falling, heading along +z, with something ahead of it or not, and a roof low over it or not.
// Its stunts, the moves they play and the bails asked for (true: the player's) are recorded.
function setup( { air = false, speed = 5.5, directions = [ 'up' ], obstacle = false, roof = false } = {} ) {

	const plays = [], stops = [], probes = [], bails = [];
	let playing = null;

	const c = {
		clock: new Clock(),
		get time() {

			return this.clock.time;

		},
		state: air ? 'falling' : 'standing',
		grounded: ! air,
		position: new Vector3( 0, 2, 0 ),
		velocity: new Vector3( 0, air ? - 2 : 0, speed ),
		tuning: { values: { ...TUNING_DEFAULTS } },
		events: [],
		airComboOpen: air,
		canMove: true,
		precisionAllowed: true,
		jumps: 0,
		holdJump: Runner.prototype.holdJump,
		trickGesture: { has: ( direction ) => directions.includes( direction ) },
		forward: () => new Vector3( 0, 0, 1 ),
		queries: {
			sphereCast( from, to, radius, options ) {

				probes.push( { from: from.clone(), to: to.clone(), radius, options } );

				return obstacle && options.group === 'probe' ? { fraction: 0.2 } : null;

			},
			ray: () => roof ? { fraction: 0.5 } : null
		},
		motion: {
			takeOf: ( name ) => motion.takeOf( name ),
			moves: {
				playing: () => playing,
				stop: ( name ) => stops.push( name )
			}
		},
		startStunt( name, options ) {

			plays.push( { name, options } );
			playing = { name };
			this.stunt = { name, ...options };
			this.airComboOpen = false;
			this.state = options.air ? 'airStunt' : 'groundStunt';
			if ( ! options.air ) this.velocity.set( 0, 0, 0 );

		},
		bail: { request: ( byPlayer = false ) => bails.push( byPlayer ) }
	};
	const tricks = new Tricks( c );

	// The runner's steps up to a time: each runs the clock (the trick timers fire), then the tricks update.
	function advance( time, controls = input() ) {

		while ( c.time < time - 1e-9 ) {

			c.clock.run( Math.min( time, c.time + STEP ), controls );
			tricks.update();

		}

	}

	// Back on the ground with the stunt and its move over, the landing judged.
	function land() {

		c.grounded = true;
		c.velocity.y = 0;
		c.stunt = playing = null;
		c.state = 'standing';

	}

	// A move playing without a stunt of its own.
	function play( name ) {

		playing = { name };

	}

	return { c, tricks, plays, stops, probes, bails, advance, land, play };

}

const close = ( actual, expected ) => assert.ok( Math.abs( actual - expected ) < 1e-9, actual + ' != ' + expected );

const cartwheel = () => input( { pressed: [ 'wheel' ] } );
const dive = () => input( { held: [ 'sprint' ], released: [ 'dive' ] } );

test( 'a cartwheel keeps its speed and locks the jump for 0.7 s', () => {

	const { c, tricks, plays, advance } = setup();

	// The jump count does not hold a cartwheel back.
	c.jumps = 2;
	assert.equal( tricks.ground( cartwheel() ), true );
	assert.equal( plays[ 0 ].name, 'cartwheel' );
	close( c.velocity.z, 5.5 );
	assert.equal( c.jumpLocked, true );
	close( c.clock.readyAt( 'jumpLock' ), 0.7 );
	assert.equal( tricks.jumpReady(), false );

	advance( 0.699 );
	assert.equal( tricks.cartwheeling, true );
	advance( 0.7 );
	assert.equal( tricks.cartwheeling, false );
	assert.equal( c.bailIfAirborne, false );
	assert.equal( c.jumpLocked, false );
	assert.equal( tricks.jumpReady(), true );

} );

test( 'after a cartwheel, the next cartwheel and the large tricks wait 1.1 s', () => {

	for ( const [ name, controls ] of [ [ 'cartwheel', cartwheel ], [ 'diveOut', dive ] ] ) {

		const { tricks, plays, advance, land } = setup();

		tricks.ground( cartwheel() );
		advance( 1.099 );
		land();
		assert.equal( tricks.ground( controls() ), false, name );
		advance( 1.1 );
		assert.equal( tricks.ground( controls() ), true, name );
		assert.equal( plays.at( - 1 ).name, name );

	}

} );

test( 'climbing mid-trick does not stop a cartwheel; the grab key, L1 or the left trigger held does', () => {

	const climbing = setup();

	climbing.c.climbing = climbing.c.tricking = true;
	assert.equal( climbing.tricks.ground( cartwheel() ), true );

	for ( const held of [ { keys: [ 'grab' ] }, { pad: [ 'precision' ] }, { pad: [ 'grab' ] } ] ) {

		const { tricks, plays } = setup();

		assert.equal( tricks.ground( input( { pressed: [ 'wheel' ], ...held } ) ), false );
		assert.equal( plays.length, 0 );

	}

} );

test( 'a cartwheel that leaves the ground asks for a bail', () => {

	const { c, tricks, bails, play } = setup();

	tricks.startCartwheel();
	c.grounded = false;
	tricks.update();
	assert.deepEqual( bails, [ false ] );

	// Only the cartwheel falls into a bail: another move in the air does not.
	play( 'diveOut' );
	tricks.update();
	assert.deepEqual( bails, [ false ] );

} );

test( 'the air combo opens only from its marker, not from time in the air', () => {

	const { c, tricks, advance } = setup( { air: true } );

	c.airComboOpen = false;
	advance( 1 );
	assert.equal( c.airComboOpen, false );
	assert.equal( tricks.air( input( { held: [ 'flip' ] } ) ), false );

} );

test( 'a flip in the air needs 1.25 m clear ahead of the runner; a wheel trick does not check', () => {

	const { tricks, plays, probes } = setup( { air: true, obstacle: true } );

	assert.equal( tricks.air( input( { held: [ 'flip' ] } ) ), false );
	const probe = probes[ 0 ];

	assert.equal( probe.radius, 0.35 );
	assert.equal( probe.options.group, 'probe' );
	close( probe.to.z - probe.from.z, 1.25 );
	assert.equal( tricks.air( input( { held: [ 'wheel' ] } ) ), true );
	assert.equal( plays[ 0 ].name, 'frontFlip' );

} );

test( 'a spin after side flips uses up the combo at once, starts 0.15 s later and resets the side flip count', () => {

	const { c, tricks, plays, advance } = setup( { air: true, directions: [ 'left' ] } );

	tricks.counts.sideflip = 2;
	assert.equal( tricks.air( input( { held: [ 'flip' ] } ) ), false );
	assert.equal( c.airComboOpen, false );
	close( c.velocity.y, - 2 );
	advance( 0.149 );
	assert.equal( plays.length, 0 );
	advance( 0.15 );
	assert.equal( plays[ 0 ].name, 'spin' );
	close( c.velocity.y, - 0.5 );
	assert.equal( tricks.counts.sideflip, 0 );

} );

test( 'a spin out of a cartwheel stops the cartwheel as it starts, after the button is let go', () => {

	const { tricks, plays, stops, advance, play } = setup( { air: true, directions: [ 'left' ] } );

	play( 'cartwheel' );
	tricks.air( input( { pressed: [ 'flip' ] } ) );
	advance( 0.15 );
	assert.deepEqual( stops, [ 'cartwheel' ] );
	assert.equal( plays[ 0 ].name, 'spin' );

} );

test( 'with several flick directions at once, each air trick family takes its own first choice', () => {

	const flip = setup( { air: true, directions: [ 'left', 'right', 'up', 'down' ] } );

	flip.tricks.air( input( { held: [ 'flip' ] } ) );
	assert.equal( flip.plays[ 0 ].name, 'sideFlip' );

	const wheel = setup( { air: true, directions: [ 'left', 'right', 'down' ] } );

	wheel.tricks.air( input( { held: [ 'wheel' ] } ) );
	assert.equal( wheel.plays[ 0 ].name, 'diveFrontFlip' );

	const backflip = setup( { air: true, directions: [ 'left', 'right', 'up' ] } );

	backflip.tricks.air( input( { held: [ 'backflip' ] } ) );
	assert.equal( backflip.plays[ 0 ].name, 'heldBackflip' );

	// To the left the back flip button has no trick.
	const left = setup( { air: true, directions: [ 'left' ] } );

	assert.equal( left.tricks.air( input( { held: [ 'backflip' ] } ) ), false );
	assert.equal( left.plays.length, 0 );

} );

test( 'a jump press with a flick backflips ahead of a held flip; the space bar or the left trigger held stops it', () => {

	const flick = setup( { air: true, directions: [ 'right', 'up' ] } );

	flick.tricks.air( input( { pressed: [ 'jump' ], held: [ 'flip' ] } ) );
	assert.equal( flick.plays[ 0 ].name, 'heldBackflip' );

	const space = setup( { air: true } );

	assert.equal( space.tricks.air( input( { pressed: [ 'jump' ], keys: [ 'jump' ] } ) ), false );

	const trigger = setup( { air: true } );

	assert.equal( trigger.tricks.air( input( { pressed: [ 'backflip' ], pad: [ 'grab' ] } ) ), false );

} );

test( 'after getting up from a bail, backflips wait for their time but flips need only the air combo', () => {

	const flip = setup( { air: true } );

	flip.c.clock.hold( 'airTrickLock', 0.7 );
	assert.equal( flip.tricks.air( input( { held: [ 'flip' ] } ) ), true );

	const backflip = setup( { air: true } );

	backflip.c.clock.hold( 'airTrickLock', 0.7 );
	assert.equal( backflip.tricks.air( input( { held: [ 'backflip' ] } ) ), false );
	assert.equal( backflip.c.airComboOpen, false );

} );

test( 'the trick rate steps the jump arc 15 times a second and counts whole steps up to the one that hits', () => {

	const { c, tricks, probes } = setup();
	let steps = 0;

	c.queries.sphereCast = ( from, to, radius, options ) => {

		probes.push( { from, to, radius, options } );

		return ++ steps === 16 ? { fraction: 0.01 } : null;

	};
	close( tricks.animationRate( true ), 15 / 16 );
	assert.equal( probes[ 0 ].options.group, 'movement' );
	close( probes[ 0 ].from.y, 1.55 );
	close( probes[ 0 ].to.y, 1.55 + 7.25 / 15 - ( 0.5 * 9.8 * 1.75 ) / 225 );

} );

test( 'a sprinting dive starts on the dive release and shakes the camera', () => {

	const { c, tricks, plays } = setup();

	assert.equal( tricks.ground( input( { held: [ 'sprint', 'dive' ] } ) ), false );
	assert.equal( tricks.ground( dive() ), true );
	assert.equal( plays[ 0 ].name, 'diveOut' );
	close( c.velocity.y, 6.25 );
	assert.equal( c.jumps, 1 );
	assert.equal( c.diving, true );
	assert.deepEqual( c.events.filter( ( event ) => event.type === 'camera' ).map( ( event ) => event.name ), [ 'trick', 'landing' ] );

} );
