// The Y Bot's corrections after the pose: the hands put on what they hold (HandGrips) and the body kept out of the
// course (BodyClearance), both eased.

import test from 'node:test';
import assert from 'node:assert/strict';
import '../tools/headless/env.mjs';

const { Vector3 } = await import( 'three' );
const { Motion } = await import( '@trizen/parkour/motion/Motion.js' );
const { YBotFigure } = await import( '../src/figure/YBotFigure.js' );

const STEP = 1 / 120;
// The runner's centre standing on the floor.
const CENTRE = new Vector3( 0, 0.9215, 0 );
const STANDING = { kind: 'clip', take: 'ground_idle', time: 0 };

// A course of half-spaces, each { normal (out of it), at (a point on its face) }: a capsule's depth in one is how far
// its deepest point is past the face.
function course( ...walls ) {

	return {
		sphereCast: () => null,
		ray: ( origin, way, distance ) => {

			const direction = way.clone().normalize();
			for ( const { normal, at } of walls ) {

				const along = - direction.dot( normal ), height = origin.clone().sub( at ).dot( normal );
				if ( along > 1e-9 && height >= 0 && height / along <= distance ) return { point: origin.clone().addScaledVector( direction, height / along ), distance: height / along, normal: normal.clone() };

			}

			return null;

		},
		penetration: ( shape, at, { rotation } ) => {

			const axis = new Vector3( 0, 1, 0 ).applyQuaternion( rotation ).multiplyScalar( shape.halfHeight - shape.radius );
			let best = null;
			for ( const { normal, at: face } of walls ) {

				const depth = Math.max( ...[ 1, - 1 ].map( ( side ) => face.clone().sub( at.clone().addScaledVector( axis, side ) ).dot( normal ) ) ) + shape.radius;
				if ( depth > 0 && ( ! best || depth > best.depth ) ) best = { depth, normal: normal.clone(), point: at.clone() };

			}

			return best;

		}
	};

}

async function yBot( queries = course() ) {

	const motion = await new Motion().load();
	const figure = await new YBotFigure().load( motion.takes );
	figure.setQueries( queries );
	return figure;

}

const bone = ( figure, name ) => figure.model.getObjectByName( name ).getWorldPosition( new Vector3() );

// Where a hand's grip point (for a kind of grip) is in the world as the figure stands.
function gripPoint( figure, side, kind, grip ) {

	const hand = figure.grips.hands.find( ( h ) => h.side === side );
	const point = figure.grips.pointOf( hand, figure.grips.settings.kinds[ kind ], grip );
	figure.model.updateMatrixWorld( true );
	return figure.model.getObjectByName( figure.sampler.bones[ hand.hand ].name ).localToWorld( point );

}

test( 'held firmly, the fists close on a bar overhead a shoulder\'s width apart, and let go of it gently', async () => {

	const figure = await yBot();
	const bar = { kind: 'line', weight: 1, firm: true, a: new Vector3( - 1.5, 1.95, 0.1 ), b: new Vector3( 1.5, 1.95, 0.1 ), radius: 0.03 };
	for ( let step = 0; step < 120; step ++ ) figure.step( STEP, STANDING, CENTRE, 0, { grip: bar } );

	const fists = [ 'left', 'right' ].map( ( side ) => gripPoint( figure, side, 'line', bar ) );
	for ( const fist of fists ) assert.ok( Math.hypot( fist.y - 1.95, fist.z - 0.1 ) < 0.02, `a fist on the bar (${fist.toArray().map( ( v ) => v.toFixed( 3 ) )})` );
	assert.ok( Math.abs( fists[ 0 ].x - fists[ 1 ].x ) > 0.38, 'a shoulder\'s width apart' );
	assert.ok( fists[ 0 ].x * fists[ 1 ].x < 0, 'each on its own side' );

	// Let go: a step later the hands have barely moved; a second later they hang as the take has them.
	const held = bone( figure, 'mixamorigLeftHand' );
	figure.step( STEP, STANDING, CENTRE, 0, { grip: null } );
	assert.ok( bone( figure, 'mixamorigLeftHand' ).distanceTo( held ) < 0.05 );
	for ( let step = 0; step < 120; step ++ ) figure.step( STEP, STANDING, CENTRE, 0, { grip: null } );
	assert.ok( bone( figure, 'mixamorigLeftHand' ).y < 1.2 );
	assert.equal( figure.grips.holding().size, 0 );

} );

test( 'a button the take\'s hand comes near is pressed by the hand the grip names, the other left as the take has it', async () => {

	const figure = await yBot();
	figure.step( STEP, STANDING, CENTRE, 0 );
	const left = bone( figure, 'mixamorigLeftHand' );
	// A button a hand's breadth out from where the hanging right hand's knuckles are.
	const knuckles = gripPoint( figure, 'right', 'point', {} );
	const button = { kind: 'point', weight: 1, firm: false, at: knuckles.clone().add( new Vector3( - 0.1, 0.03, 0 ) ), normal: new Vector3( 1, 0, 0 ), hand: 'right' };
	for ( let step = 0; step < 120; step ++ ) figure.step( STEP, STANDING, CENTRE, 0, { grip: button } );

	const press = button.at.clone().addScaledVector( button.normal, figure.grips.settings.press );
	assert.ok( gripPoint( figure, 'right', 'point', button ).distanceTo( press ) < 0.01 );
	assert.ok( bone( figure, 'mixamorigLeftHand' ).distanceTo( left ) < 1e-6 );

	// Far from where the take has the hand, it is barely drawn to it.
	figure.resetBody();
	const far = { ...button, at: knuckles.clone().add( new Vector3( - 0.5, 0.3, 0 ) ) };
	for ( let step = 0; step < 120; step ++ ) figure.step( STEP, STANDING, CENTRE, 0, { grip: far } );
	assert.ok( figure.grips.holds[ 1 ].weight < 0.05 );

} );

test( 'a hand plants on a vaulted top where it comes down onto it and stays there as the body moves on', async () => {

	const figure = await yBot();
	figure.step( STEP, STANDING, CENTRE, 0 );
	const palm = gripPoint( figure, 'left', 'plant', {} );
	// A top just over the hanging palm (it comes down onto it from within a plant's reach).
	const top = palm.y + 0.05;
	// Only the top's face, for the hand to find (the body is not in it).
	figure.setQueries( { ...course( { normal: new Vector3( 0, 1, 0 ), at: new Vector3( 0, top, 0 ) } ), penetration: () => null } );
	const plant = { kind: 'plant', weight: 1, firm: false, top };
	for ( let step = 0; step < 30; step ++ ) figure.step( STEP, STANDING, CENTRE, 0, { grip: plant } );

	const planted = gripPoint( figure, 'left', 'plant', plant );
	assert.ok( Math.abs( planted.y - top ) < 0.01, 'the palm on the top' );

	// The body moves on 15 cm: the palm stays put.
	for ( let step = 0; step < 10; step ++ ) figure.step( STEP, STANDING, CENTRE.clone().add( new Vector3( 0, 0, 0.15 ) ), 0, { grip: plant } );
	assert.ok( gripPoint( figure, 'left', 'plant', plant ).distanceTo( planted ) < 0.01 );

} );

test( 'the body eases off a wall it leans into, and nothing lifts it off the ground it stands on', async () => {

	// A wall through the body's right side (the Y Bot faces +z; its right is -x), and the floor.
	const wall = { normal: new Vector3( 1, 0, 0 ), at: new Vector3( - 0.05, 0, 0 ) };
	const floor = { normal: new Vector3( 0, 1, 0 ), at: new Vector3( 0, 0.2, 0 ) };
	const figure = await yBot( course( wall, floor ) );
	const hips = () => bone( figure, 'mixamorigHips' );

	const free = await yBot();
	free.step( STEP, STANDING, CENTRE, 0 );
	const start = bone( free, 'mixamorigHips' ).x;
	figure.step( STEP, STANDING, CENTRE, 0, { onGround: true } );
	const first = hips().x - start;
	for ( let step = 0; step < 120; step ++ ) figure.step( STEP, STANDING, CENTRE, 0, { onGround: true } );
	const settled = hips().x - start;
	assert.ok( settled > 0.05, 'moved off the wall' );
	assert.ok( first > 0 && first < settled / 2, 'eased off, not snapped' );
	assert.ok( figure.clearance.body.x > 0.05 && Math.abs( figure.clearance.body.y ) < 1e-9, 'out of the wall, never up off the floor' );

	figure.resetBody();
	assert.equal( figure.clearance.body.length(), 0 );

} );

test( 'over a vaulted top the legs go straight up out of it, and a head under a bar leans back from it', async () => {

	// A thin wall across the way, its top at the knees: the way out of its sides is shorter than out of its top.
	const top = 0.45;
	const figure = await yBot( course( { normal: new Vector3( 0, 1, 0 ), at: new Vector3( 0, top, 0 ) } ) );
	for ( let step = 0; step < 120; step ++ ) figure.step( STEP, STANDING, CENTRE, 0, { grip: { kind: 'plant', weight: 1, top } } );
	assert.ok( figure.clearance.body.y > 0.1 && Math.abs( figure.clearance.body.x ) < 1e-9 && Math.abs( figure.clearance.body.z ) < 1e-9 );

	// A bar's underside through the top of the head, clear of the shoulders: the neck leans, the body stays.
	const under = await yBot( course( { normal: new Vector3( 0, - 1, 0 ), at: new Vector3( 0, 1.68, 0 ) } ) );
	under.step( STEP, STANDING, CENTRE, 0 );
	const upright = bone( under, 'mixamorigHeadTop_End' );
	for ( let step = 0; step < 120; step ++ ) under.step( STEP, STANDING, CENTRE, 0 );
	assert.ok( upright.y > 1.68, 'the take\'s head goes into it' );
	assert.ok( bone( under, 'mixamorigHeadTop_End' ).y < upright.y - 0.02, 'the head ducks' );
	assert.equal( under.clearance.body.length(), 0 );

} );

test( 'an arm reaching into a solid from the body\'s side swings back out along its face, its reach kept; on a ledge the hands are left be', async () => {

	// A face under the shoulders the hanging arms go down through (the body itself not in it).
	const face = { normal: new Vector3( 0, 1, 0 ), at: new Vector3( 0, 1, 0 ) };
	const figure = await yBot( { ...course( face ), penetration: () => null } );
	figure.step( STEP, STANDING, CENTRE, 0 );
	const reach = bone( figure, 'mixamorigRightHand' ).distanceTo( bone( figure, 'mixamorigRightArm' ) );
	assert.ok( bone( figure, 'mixamorigRightHand' ).y < 1, 'the take\'s hand goes through it' );

	for ( let step = 0; step < 120; step ++ ) figure.step( STEP, STANDING, CENTRE, 0 );
	const hand = bone( figure, 'mixamorigRightHand' );
	assert.ok( hand.y > 1, 'out on the shoulder\'s side' );
	assert.ok( Math.abs( hand.distanceTo( bone( figure, 'mixamorigRightArm' ) ) - reach ) < 0.02, 'the reach kept' );

	const hanging = await yBot( { ...course( face ), penetration: () => null } );
	for ( let step = 0; step < 120; step ++ ) hanging.step( STEP, STANDING, CENTRE, 0, { handsOnLedge: true } );
	assert.ok( bone( hanging, 'mixamorigRightHand' ).y < 1 );

} );
