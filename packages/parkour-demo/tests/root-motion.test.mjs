import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { TakeLibrary } from '@trizendigital/parkour/motion/TakeLibrary.js';
import { Moves } from '@trizendigital/parkour/motion/Moves.js';
import { RootMotion } from '@trizendigital/parkour/motion/RootMotion.js';

// One take that steps 2 m forward over a second, a move that plays it on the body, and another that plays half of
// it twice as fast.
function setup() {

	const takes = new TakeLibrary( {
		takes: { step: { length: 1, root: { times: [ 0, 1 ], positions: [ 0, 0, 0, 0, 0, 2 ] } }, still: { length: 1 } },
		moves: {
			stepMove: { take: 'step', span: [ 0, 1 ], length: 1, rate: 1, blendIn: 0.4, blendOut: 0.2, layer: 'body' },
			halfStep: { take: 'step', span: [ 0.5, 1 ], length: 0.5, rate: 2, blendIn: 0.6, blendInCurve: 'smoothstep', blendOut: 0.1, layer: 'body' },
			stand: { take: 'still', span: [ 0, 1 ], length: 1, rate: 1, blendIn: 0.1, blendOut: 0.1, layer: 'body' },
		}
	} );
	const moves = new Moves( takes );

	return { takes, moves, root: new RootMotion( takes, moves ) };

}

const near = ( a, b, tolerance = 1e-7 ) => assert.ok( a.distanceTo( b ) < tolerance, `${ a.toArray() } != ${ b.toArray() }` );

test( 'a move carries the root in full from its first step, and looking ahead does not move it on', () => {

	const { moves, root } = setup();
	const instance = moves.play( 'stepMove' );
	moves.update( 0.05 );
	assert.ok( instance.weight < 1 );

	near( root.extract( 0.1 ).translation, new Vector3( 0, 0, 0.2 ) );
	assert.equal( instance.time, 0.05 );

} );

test( 'a move carries the root no further than its end, where it blends itself out', () => {

	const { moves, root } = setup();
	const instance = moves.play( 'stepMove' );
	instance.time = 0.9;
	near( root.extract( 0.3 ).translation, new Vector3( 0, 0, 0.2 ) );

	moves.update( 0.3 );
	assert.equal( instance.time, 1 );
	assert.equal( instance.stopping, true );
	assert.equal( root.extract( 0.1 ), null, 'a move blending out carries nothing' );

} );

test( 'a move playing a take with no root track leaves the root to the runner, as does none at all', () => {

	const { moves, root } = setup();
	assert.equal( root.extract( 0.1 ), null );
	moves.play( 'stand' );
	assert.equal( root.extract( 0.1 ), null );

} );

test( 'a move\'s travel between two times on its clock goes through its span at its rate, within the take', () => {

	const { takes, root } = setup();

	// Half a step from the middle, at twice the speed: 0.1 s on the stunt's clock is 0.2 s of the take, 0.4 m.
	near( root.moveDelta( takes.moves.get( 'halfStep' ), 0, 0.1 ), new Vector3( 0, 0, 0.4 ) );
	// Past the take's end it goes no further.
	near( root.moveDelta( takes.moves.get( 'halfStep' ), 0, 5 ), new Vector3( 0, 0, 1 ) );

} );

test( 'a move that cuts in blends out the one it interrupts over its own blend-in, along its own curve', () => {

	const { moves } = setup();
	let event = null;
	const first = moves.play( 'stepMove', { onBlendOut: ( value ) => ( event = value ) } );
	moves.update( 0.2 );
	assert.equal( first.weight, 0.5 );

	moves.play( 'halfStep' );
	assert.deepEqual( event, { move: 'stepMove', interrupted: true } );
	assert.equal( moves.playing().name, 'halfStep' );

	// A third of the way through the 0.6 s blend-out, smoothstep: 0.5 × ( 1 − 0.259… ).
	moves.update( 0.2 );
	assert.ok( Math.abs( first.weight - 0.5 * ( 1 - ( 1 / 3 ) ** 2 * ( 3 - 2 / 3 ) ) ) < 1e-12 );

} );

test( 'moves on the body share it by weight, and what they leave goes to the pose beneath', () => {

	const { moves } = setup();
	const first = moves.play( 'stepMove' );
	const second = moves.play( 'stand' );
	first.weight = 0.6;
	second.weight = 0.8;

	const beneath = { kind: 'rest' };
	const recipe = moves.layer( 'body', beneath );
	assert.equal( recipe.kind, 'blend' );
	assert.equal( recipe.samples.length, 2 );
	assert.ok( Math.abs( recipe.samples[ 0 ].weight - 0.6 / 1.4 ) < 1e-12 );
	assert.ok( Math.abs( recipe.samples[ 1 ].weight - 0.8 / 1.4 ) < 1e-12 );
	assert.ok( recipe.samples.every( ( sample ) => sample.recipe.kind === 'clip' && sample.recipe.rootMotion ) );

	second.weight = 0.1;
	const partial = moves.layer( 'body', beneath );
	assert.equal( partial.samples.at( - 1 ).recipe, beneath );
	assert.ok( Math.abs( partial.samples.at( - 1 ).weight - 0.3 ) < 1e-12 );

	assert.equal( moves.layer( 'climb', beneath ), beneath, 'a layer with no move is the pose beneath' );

} );

test( 'the pose beneath a layer is not worked out while a move covers it fully, unless it is asked for every time', () => {

	const { moves } = setup();
	const instance = moves.play( 'stepMove' );
	instance.weight = 1;
	let updates = 0;
	const beneath = () => {

		updates ++;
		return { kind: 'rest' };

	};

	moves.layer( 'body', beneath );
	assert.equal( updates, 0 );
	moves.layer( 'body', beneath, true );
	assert.equal( updates, 1 );
	instance.weight = 0.9;
	moves.layer( 'body', beneath );
	assert.equal( updates, 2 );

} );

test( 'stopping a move by name blends out only that move; stopping with no name, every move, at once when asked', () => {

	const { moves } = setup();
	const first = moves.play( 'stepMove' );
	moves.update( 0.1 );
	moves.stop( 'stand' );
	assert.equal( first.stopping, false );
	moves.stop( 'stepMove' );
	assert.equal( first.stopping, true );
	assert.equal( moves.busy(), false );

	// A move already blending out goes on as it was.
	moves.play( 'stand' );
	moves.stop( undefined, 0 );
	moves.update( 0.01 );
	assert.deepEqual( moves.instances.map( ( instance ) => instance.move.name ), [ 'stepMove' ] );

} );
