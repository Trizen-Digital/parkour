import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { ENGINES, createEngine } from '../src/engines.js';
import { Queries } from '@trizen/parkour/physics/Queries.js';
import { Mover, FLOOR_GAP } from '@trizen/parkour/physics/Mover.js';
import { TUNING_DEFAULTS } from '@trizen/parkour/sim/tuning.js';
import { boxSolid, hullSolid } from '@trizen/parkour/world/solids.js';

// The runner's capsule moved through solids on every engine: finding and keeping to the floor, sliding along walls,
// stepping up what is a step and only what is, gliding, and getting out of what it is in.

const DT = 1 / 120;
const DEGREE = Math.PI / 180;
const LIMITS = TUNING_DEFAULTS; // a 0.3 m step, walkable to 65°
const STANDING = 0.9 + FLOOR_GAP; // the capsule's centre over a floor at 0

const floor = boxSolid( { id: 'floor', position: [ 0, - 0.5, 0 ], halfExtents: [ 20, 0.5, 20 ] } );

// A wall along x whose face (towards -z) stands at z = 1.75.
const wall = boxSolid( { id: 'wall', position: [ 0, 1.5, 2 ], halfExtents: [ 10, 1.5, 0.25 ] } );
const AT_WALL = 1.75 - 0.185;

// A ramp rising along +z at `degrees`, from z = 0 to z = `length`, 4 m wide, standing on the floor.
function ramp( degrees, length ) {

	const height = Math.tan( degrees * DEGREE ) * length;
	const points = [ [ - 2, 0, 0 ], [ 2, 0, 0 ], [ - 2, 0, length ], [ 2, 0, length ], [ - 2, height, length ], [ 2, height, length ] ].flat();

	return hullSolid( { id: `ramp${ degrees }`, points, polygons: [ [ 0, 1, 3, 2 ], [ 2, 3, 5, 4 ], [ 0, 1, 5, 4 ], [ 0, 2, 4 ], [ 1, 3, 5 ] ] } );

}

// A flight of `steps` stairs climbing along +z from z = 0, as the courses build them: each step a solid box from the
// floor up to its tread (25 cm rises, 30 cm treads), then a deck at the top.
function stairs( steps, { width = 8, x = 0 } = {} ) {

	const solids = [];

	for ( let k = 1; k <= steps; k ++ ) {

		solids.push( boxSolid( { id: `step${ k }`, position: [ x, 0.125 * k, 0.3 * ( k - 0.5 ) ], halfExtents: [ width / 2, 0.125 * k, 0.15 ] } ) );

	}

	solids.push( boxSolid( { id: 'deck', position: [ x, 0.125 * steps, 0.3 * steps + 2 ], halfExtents: [ width / 2, 0.125 * steps, 2 ] } ) );

	return solids;

}

for ( const engineName of ENGINES ) {

	const engine = await createEngine( engineName );
	const moverOver = ( ...solids ) => new Mover( new Queries( engine.createQueryWorld( [ floor, ...solids ] ) ) );

	// The mover's step ups, as they are taken.
	const countingStepUps = ( mover ) => {

		const taken = [];
		const stepUp = mover.stepUp.bind( mover );

		mover.stepUp = ( ...args ) => {

			const step = stepUp( ...args );
			if ( step ) taken.push( step );
			return step;

		};

		return taken;

	};

	test( `${ engineName }: a walk keeps the capsule 2.15 cm over the floor, and finds the floor it ends on`, () => {

		const mover = moverOver();

		for ( const start of [ STANDING + 0.01, STANDING - 0.004, STANDING ] ) {

			const position = new Vector3( 0, start, 0 );
			const velocity = new Vector3( 1, 0, 0 );
			const { grounded } = mover.walk( position, velocity, DT, LIMITS, true );

			assert.equal( grounded, true );
			assert.ok( Math.abs( position.y - STANDING ) < 1e-6, `from ${ start }: ${ position.y }` );
			assert.ok( Math.abs( position.x - DT ) < 1e-9 );
			assert.equal( mover.floor.solid.id, 'floor' );
			assert.ok( Math.abs( mover.floor.floorDistance - FLOOR_GAP ) < 1e-6 || start !== STANDING );

		}

		// Within the 1.9–2.4 cm band the capsule is left where it is.
		const position = new Vector3( 0, 0.9 + 0.02, 0 );
		mover.walk( position, new Vector3(), DT, LIMITS, true );
		assert.equal( position.y, 0.92 );

		// Rising, it looks for no floor.
		const rising = new Vector3( 0, STANDING, 0 );
		assert.equal( mover.walk( rising, new Vector3( 0, 2, 0 ), DT, LIMITS, false ).grounded, false );
		assert.equal( mover.floor, null );

	} );

	test( `${ engineName }: a floor is a floor up to the walkable slope; the face found is the slope's own`, () => {

		const gentle = ramp( 20, 6 );
		const steep = ramp( 70, 1 );
		const mover = moverOver( { ...gentle, id: 'gentle' } );
		const steepMover = moverOver( steep );

		const onGentle = mover.findFloor( new Vector3( 0, Math.tan( 20 * DEGREE ) * 3 + 1, 3 ), 0.9, 0.5, LIMITS.walkableSlope );
		assert.equal( onGentle.solid.id, 'gentle' );
		assert.ok( Math.abs( onGentle.faceNormal.y - Math.cos( 20 * DEGREE ) ) < 1e-6 );
		assert.equal( onGentle.byRay, false );

		const onSteep = steepMover.findFloor( new Vector3( 0, Math.tan( 70 * DEGREE ) * 0.5 + 1.2, 0.5 ), 0.9, 0.5, LIMITS.walkableSlope );
		assert.equal( onSteep, null );

		// Nothing within reach.
		assert.equal( mover.findFloor( new Vector3( 10, 3, 10 ), 0.9, 0.5, LIMITS.walkableSlope ), null );

	} );

	test( `${ engineName }: a walk down a slope follows it, on the floor every step, as far along it as it would go on the flat`, () => {

		const mover = moverOver( ramp( 20, 8 ) );
		const slope = Math.tan( 20 * DEGREE );
		const position = new Vector3( 0, slope * 7 + STANDING / Math.cos( 20 * DEGREE ), 7 );
		let over = null;

		for ( let k = 0; k < 90; k ++ ) {

			assert.equal( mover.walk( position, new Vector3( 0, 0, - 4 ), DT, LIMITS, true ).grounded, true, `step ${ k }` );

			// The same height over the slope all the way down.
			over ??= position.y - slope * position.z;
			assert.ok( Math.abs( position.y - slope * position.z - over ) < 0.001, `step ${ k }: ${ position.toArray() }` );

		}

		// 3 m along the slope.
		assert.ok( Math.abs( position.z - ( 7 - 3 * Math.cos( 20 * DEGREE ) ) ) < 0.01, `${ position.z }` );

	} );

	test( `${ engineName }: a walk into a wall stops at it, slides along it, and loses the speed it had into it`, () => {

		const mover = moverOver( wall );
		const position = new Vector3( 0, STANDING, 1 );
		const velocity = new Vector3( 2, 0, 4 );

		for ( let k = 0; k < 60; k ++ ) mover.walk( position, velocity, DT, LIMITS, true );

		// To the engine's precision: a sweep's contact normal can lean a few milliradians off the face, and the
		// velocity left by it lean as much away from the wall.
		assert.ok( Math.abs( position.z - AT_WALL ) < 0.01, `${ position.z }` );
		assert.ok( Math.abs( position.x - 1 ) < 0.01, `${ position.x }` );
		assert.ok( velocity.z <= 1e-9 && velocity.z > - 0.03 && Math.abs( velocity.x - 2 ) < 0.02, `${ velocity.toArray() }` );

	} );

	test( `${ engineName }: running at a wall at an angle, the capsule never steps up, keeps no speed into the wall, and runs along it at the speed it steers along it`, () => {

		for ( const degrees of [ 10, 27, 45, 70 ] ) {

			const mover = moverOver( wall );
			const taken = countingStepUps( mover );
			const position = new Vector3( 0, STANDING, 1.2 );
			const heading = new Vector3( Math.cos( degrees * DEGREE ), 0, Math.sin( degrees * DEGREE ) ).multiplyScalar( 6 );
			let steps = 0;
			let along = 0;

			for ( let k = 0; k < 120; k ++ ) {

				// Steering into the wall every step, as the runner does.
				const velocity = heading.clone();
				const x = position.x;

				mover.walk( position, velocity, DT, LIMITS, true );

				// From the step it meets the wall on.
				if ( ! steps && velocity.z === heading.z ) continue;
				steps ++;
				along += position.x - x;

				// At the wall, nothing goes on into it: a contact normal leaning a little leaves only a little either way.
				if ( position.z > AT_WALL - 0.001 ) assert.ok( velocity.z < 0.03 * heading.length(), `${ degrees }°, step ${ k }: ${ velocity.toArray() }` );
				assert.ok( Math.abs( position.y - STANDING ) < 0.003, `${ degrees }°, step ${ k }: ${ position.y }` );

			}

			assert.equal( taken.length, 0, `${ degrees }°: a slide along the wall taken as a step up` );
			assert.ok( steps > 20 && Math.abs( along / ( steps * DT ) - heading.x ) < 0.03 * heading.length(), `${ degrees }°: ${ along / ( steps * DT ) } m/s along the wall` );

		}

	} );

	test( `${ engineName }: a walk on the floor steps up what is no higher than the step height`, () => {

		for ( const [ height, over ] of [ [ 0.25, true ], [ 0.35, false ] ] ) {

			const mover = moverOver( boxSolid( { id: 'step', position: [ 0, height / 2, 2 ], halfExtents: [ 2, height / 2, 0.5 ] } ) );
			const position = new Vector3( 0, STANDING, 0.5 );

			for ( let k = 0; k < 90; k ++ ) mover.walk( position, new Vector3( 0, 0, 2 ), DT, LIMITS, true );

			assert.equal( position.z > 1.6, over, `${ height } m: ${ position.toArray() }` );
			if ( over ) assert.ok( Math.abs( position.y - ( height + STANDING ) ) < 1e-6 );

		}

	} );

	test( `${ engineName }: a flight of stairs is climbed straight or at an angle, a riser a step, without losing speed`, () => {

		for ( const degrees of [ 90, 60, 30 ] ) {

			const mover = moverOver( ...stairs( 4 ) );
			const taken = countingStepUps( mover );
			const heading = new Vector3( Math.cos( degrees * DEGREE ), 0, Math.sin( degrees * DEGREE ) ).multiplyScalar( 3 );
			const position = new Vector3( 0, STANDING, - 0.3 );
			let grounded = true;
			let highest = position.y;

			for ( let k = 0; position.z < 1.6; k ++ ) {

				assert.ok( k < 240, `${ degrees }°: stuck at ${ position.toArray() }` );

				const velocity = heading.clone();
				grounded = mover.walk( position, velocity, DT, LIMITS, grounded ).grounded;

				// Up the risers, never back down, and at the speed it was going.
				assert.ok( position.y >= highest - 1e-6, `${ degrees }°, step ${ k }: ${ position.y } after ${ highest }` );
				assert.ok( velocity.distanceTo( heading ) < 1e-9, `${ degrees }°, step ${ k }: ${ velocity.toArray() }` );
				highest = position.y;

			}

			assert.equal( taken.length, 4, `${ degrees }°` );
			assert.ok( Math.abs( position.y - ( 1 + STANDING ) ) < 1e-6, `${ degrees }°: ${ position.y }` );

		}

	} );

	test( `${ engineName }: a flight of stairs is climbed at a creep, and from standing against its first riser`, () => {

		// From standing against the first riser, gaining speed as the runner does (the tuning's acceleration) and losing
		// what goes into what it meets: the first moves meet the riser with under a millimetre left, and so does every
		// move at a creep.
		for ( const speed of [ 0.1, 0.3, 2 ] ) {

			const mover = moverOver( ...stairs( 4 ) );
			const taken = countingStepUps( mover );
			const position = new Vector3( 0, STANDING, - 0.185 - 0.0001 );
			const velocity = new Vector3();
			let grounded = true;

			for ( let k = 0; position.z < 1.6; k ++ ) {

				assert.ok( k < 3 / speed / DT, `${ speed } m/s: stuck at ${ position.toArray() }` );
				velocity.z = Math.min( speed, velocity.z + LIMITS.acceleration * DT );
				grounded = mover.walk( position, velocity, DT, LIMITS, grounded ).grounded;

			}

			assert.equal( taken.length, 4, `${ speed } m/s` );
			assert.ok( Math.abs( position.y - ( 1 + STANDING ) ) < 1e-6, `${ speed } m/s: ${ position.y }` );

		}

	} );

	test( `${ engineName }: a flight of stairs along a wall is climbed steering into the wall, without sticking to it`, () => {

		// The flight's side runs along the wall, which stands on past its top.
		const mover = moverOver( ...stairs( 4, { width: 4, x: - 2 } ), boxSolid( { id: 'side', position: [ 0.25, 1.5, 1 ], halfExtents: [ 0.25, 1.5, 5 ] } ) );
		const taken = countingStepUps( mover );
		const heading = new Vector3( Math.sin( 20 * DEGREE ), 0, Math.cos( 20 * DEGREE ) ).multiplyScalar( 3 );
		const position = new Vector3( - 0.2, STANDING, - 0.3 );
		let grounded = true;
		let k = 0;

		for ( ; position.z < 1.6 && k < 240; k ++ ) grounded = mover.walk( position, heading.clone(), DT, LIMITS, grounded ).grounded;

		// Up the flight at the speed it steers along the wall: 1.9 m in 0.67 s.
		assert.ok( k < 90, `${ k } steps, at ${ position.toArray() }` );
		assert.equal( taken.length, 4 );
		assert.ok( Math.abs( position.y - ( 1 + STANDING ) ) < 0.001, `${ position.y }` );

	} );

	test( `${ engineName }: a step up that slides along a wall on the way across loses the speed into the wall, as any slide does`, () => {

		// A step whose side runs along a wall; the runner meets the riser 2 mm ahead with the wall 3 mm to its side,
		// heading into both.
		const mover = moverOver(
			boxSolid( { id: 'step', position: [ - 2, 0.125, 1 ], halfExtents: [ 2, 0.125, 0.5 ] } ),
			boxSolid( { id: 'side', position: [ 0.25, 1.5, 1 ], halfExtents: [ 0.25, 1.5, 5 ] } )
		);
		const taken = countingStepUps( mover );
		const heading = new Vector3( Math.sin( 20 * DEGREE ), 0, Math.cos( 20 * DEGREE ) ).multiplyScalar( 3 );
		const position = new Vector3( - 0.185 - 0.003, STANDING, 0.5 - 0.185 - 0.002 );
		const velocity = heading.clone();

		mover.walk( position, velocity, DT, LIMITS, true );

		assert.equal( taken.length, 1 );
		assert.equal( taken[ 0 ].slidAlong?.solid.id, 'side' );
		assert.ok( position.y > 0.25 + 0.9, `${ position.toArray() }` );
		assert.ok( Math.abs( velocity.x ) < 0.02 * heading.length(), `${ velocity.toArray() }` );
		assert.ok( Math.abs( velocity.z - heading.z ) < 0.02 * heading.length(), `${ velocity.toArray() }` );

	} );

	test( `${ engineName }: a glide keeps its height, stops at a wall it cannot step over, and steps up onto a low one`, () => {

		const mover = moverOver(
			boxSolid( { id: 'wall', position: [ 0, 3, 3 ], halfExtents: [ 5, 3, 0.25 ] } ),
			boxSolid( { id: 'low', position: [ 10, 0.1, 3 ], halfExtents: [ 2, 0.1, 0.5 ] } )
		);

		// High up a wall, far over the floor, pressed against it: it goes along the wall and keeps its velocity (a
		// guided move's own).
		const position = new Vector3( 0, 3, 2 );
		const velocity = new Vector3( 1, 0, 2 );

		for ( let k = 0; k < 60; k ++ ) assert.equal( mover.glide( position, velocity, DT, LIMITS ).grounded, false );
		assert.ok( Math.abs( position.y - 3 ) < 0.002, `${ position.y }` );
		assert.ok( Math.abs( position.z - ( 2.75 - 0.185 ) ) < 0.005, `${ position.toArray() }` );
		assert.ok( position.x < 0.5 + 0.005, `${ position.toArray() }` );
		assert.deepEqual( velocity.toArray(), [ 1, 0, 2 ] );

		// Level over the floor into a low box: it rides up onto it.
		const low = new Vector3( 10, STANDING, 2 );
		for ( let k = 0; k < 60; k ++ ) mover.glide( low, new Vector3( 0, 0, 2 ), DT, LIMITS );
		assert.ok( low.z > 2.6 && low.y > 1.1, `${ low.toArray() }` );

	} );

	test( `${ engineName }: a glide along a wall high over the floor takes no step up: it goes on down the wall as it was going`, () => {

		const mover = moverOver( boxSolid( { id: 'tall', position: [ 0, 4, 2 ], halfExtents: [ 10, 4, 0.25 ] } ) );
		const taken = countingStepUps( mover );
		const position = new Vector3( 0, 4, AT_WALL - 0.0001 );
		const velocity = new Vector3( 5, - 0.6, 0 );

		for ( let k = 0; k < 60; k ++ ) mover.glide( position, velocity, DT, LIMITS );

		assert.equal( taken.length, 0 );
		assert.ok( Math.abs( position.y - ( 4 - 0.3 ) ) < 0.002, `${ position.toArray() }` );
		assert.ok( Math.abs( position.x - 2.5 ) < 0.01, `${ position.toArray() }` );

	} );

	test( `${ engineName }: a capsule inside a solid is pushed out of it, the way it tilts`, () => {

		const mover = moverOver();

		// Upright, 10 cm into the floor: pushed up to 1.25 mm clear.
		const upright = new Vector3( 0, 0.8, 0 );
		mover.resolvePenetration( upright, 0.9 );
		assert.ok( Math.abs( upright.y - 0.90125 ) < 1e-6, `${ upright.y }` );

		// Lying along z (a slide's lean taken all the way), 30 cm up: clear of the floor already.
		const lying = new Vector3( 0, 0.3, 0 );
		mover.resolvePenetration( lying, 0.9, new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), Math.PI / 2 ) );
		assert.equal( lying.y, 0.3 );

		// Lying, 10 cm into it: pushed up until its side clears the floor.
		const sunk = new Vector3( 0, 0.085, 0 );
		mover.resolvePenetration( sunk, 0.9, new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), Math.PI / 2 ) );
		assert.ok( Math.abs( sunk.y - ( 0.185 + 0.00125 ) ) < 1e-6, `${ sunk.y }` );

	} );

}
