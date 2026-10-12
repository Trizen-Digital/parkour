import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Vector3 } from 'three';
import { TakeLibrary } from '@trizendigital/parkour/motion/TakeLibrary.js';
import { Graph } from '@trizendigital/parkour/motion/graph/Graph.js';
import { BLENDS, blendWeights } from '@trizendigital/parkour/motion/graph/blends.js';
import { DirectionalBlend } from '@trizendigital/parkour/motion/graph/DirectionalBlend.js';
import { eachClip } from '@trizendigital/parkour/motion/graph/recipes.js';
import { Moves } from '@trizendigital/parkour/motion/Moves.js';
import { PoseInputs } from '@trizendigital/parkour/runner/PoseInputs.js';

const takes = new TakeLibrary( JSON.parse( await fs.readFile( new URL( '../public/data/moves.json', import.meta.url ) ) ) );

const STEP = 1 / 120;

// Speeds the runner goes at (m/s): a walk, a run, a sprint.
const WALK = 1, RUN = 4, SPRINT = 5.85;

// A runner standing still, seen from behind.
const STANDING = {
	speed: 0, turnRate: 0, inAir: false, plainJump: true, sprinting: false,
	thirdPerson: true, limp: false, sliding: false, slideTucked: false, slideUpright: false, hanging: false,
	hangingFree: false, shimmyLeft: false, shimmyRight: false, onPipe: false, pipeGoing: null, pipeClimbRate: 1, onLadder: false,
	ladderGoing: null, onPole: false, poleKicking: false, onRope: false, ropeSwing: 0, onZipline: false,
	wallAhead: false, backflipLanding: false, leftFootLeads: false,
	jumpCharging: false, stick: { x: 0, y: 0 }, lean: 0, groundIK: 0, ledgeIK: 0,
	leftFootTarget: new Vector3(), rightFootTarget: new Vector3(),
};

// A random stream that goes round a fixed list.
function cycle( values ) {

	let next = 0;
	return () => values[ next ++ % values.length ];

}

// A graph over its own moves, the runner as given; `run( steps, inputs )` updates it and returns the last recipe.
function setup( random = cycle( [ 0.1, 0.7, 0.4, 0.9, 0.2 ] ) ) {

	const moves = new Moves( takes );
	const graph = new Graph( takes, moves, random );
	let inputs = STANDING, recipe = null;

	const run = ( steps, values = {} ) => {

		inputs = { ...inputs, ...values };
		for ( let step = 0; step < steps; step ++ ) {

			moves.update( STEP );
			recipe = graph.update( STEP, inputs );

		}

		return recipe;

	};

	return { graph, moves, run, state: ( machine ) => graph.machines[ machine ].current.name };

}

test( 'each machine reaches each of its poses from what the runner does', () => {

	const cases = [
		[ {}, 'locomotion', 'idle' ],
		[ { speed: WALK }, 'locomotion', 'walk' ],
		[ { speed: SPRINT, sprinting: true }, 'locomotion', 'run' ],
		[ { inAir: true }, 'locomotion', 'inAir' ],
		[ { onPipe: true }, 'pipe', 'hold' ],
		[ { onPipe: true, pipeGoing: 'up' }, 'pipe', 'climb' ],
		[ { onPipe: true, pipeGoing: 'down' }, 'pipe', 'slideDown' ],
		[ { onLadder: true }, 'ladder', 'hold' ],
		[ { onLadder: true, ladderGoing: 'up' }, 'ladder', 'climb' ],
		[ { onLadder: true, ladderGoing: 'down' }, 'ladder', 'slideDown' ],
		[ { onRope: true }, 'rope', 'swing' ],
		[ { onPole: true }, 'pole', 'slide' ],
		[ { onPole: true, poleKicking: true }, 'pole', 'kickReady' ],
		[ { onZipline: true }, 'zipline', 'ride' ],
		[ { hanging: true }, 'hang', 'hold' ],
		[ { hanging: true, shimmyLeft: true }, 'hang', 'shimmyLeft' ],
		[ { hanging: true, shimmyRight: true }, 'hang', 'shimmyRight' ],
		[ { sliding: true, speed: SPRINT }, 'slide', 'seated' ],
		[ { sliding: true, speed: SPRINT, slideTucked: true }, 'slide', 'tucked' ],
		[ { sliding: true, speed: SPRINT, slideUpright: true }, 'slide', 'upright' ],
	];

	for ( const [ values, machine, expected ] of cases ) {

		const { run, state } = setup();
		run( 480, values );
		assert.equal( state( machine ), expected, JSON.stringify( values ) );

	}

} );

test( 'a machine starts again at its first state when it comes back into use, and holds that for one update', () => {

	const { run, state } = setup();
	run( 240, { onPipe: true, pipeGoing: 'up' } );
	assert.equal( state( 'pipe' ), 'climb' );

	// Off the pipe long enough for its branch to fade out (0.25 s), then back on.
	run( 60, { onPipe: false, pipeGoing: null } );
	run( 1, { onPipe: true, pipeGoing: 'up' } );
	assert.equal( state( 'pipe' ), 'grab' );
	run( 1 );
	assert.equal( state( 'pipe' ), 'climb' );

} );

test( 'a move covering the body fully restarts the locomotion under it once it blends out', () => {

	const { run, moves, graph, state } = setup();
	run( 120, { speed: WALK } );
	assert.equal( state( 'locomotion' ), 'walk' );

	// A hard landing blends in over 0.15 s and starts blending out 0.25 s before its end.
	const landing = moves.play( 'hardLanding' );
	while ( landing.weight < 1 ) run( 1 );
	const covered = graph.frame;
	run( 10 );
	assert.equal( graph.machines.locomotion.updatedAt, covered - 1, 'not updated while the move covers the body' );

	while ( ! landing.stopping ) run( 1 );
	run( 1 );
	assert.equal( state( 'locomotion' ), 'entry' );
	run( 1 );
	assert.equal( state( 'locomotion' ), 'walk' );

} );

test( 'the pipe\'s grab hands over to holding on as it ends, judged on its capture\'s clock', () => {

	// The grab is 0.613 s long and plays 1.25 times its capture's speed: the 0.2 s cross-fade into holding on starts
	// 0.16 s before its end, already as far in as the grab had gone past that point.
	const { run, state, graph } = setup();
	const grab = graph.machines.pipe.states.grab.pose;
	let before = 0;

	run( 1, { onPipe: true } );
	while ( state( 'pipe' ) === 'grab' ) {

		before = grab.time;
		run( 1 );

	}

	const { length, pace } = takes.takes.get( 'pipe_grab' );
	assert.equal( pace, 1.25 );
	const left = ( length - before ) * pace;
	assert.ok( left <= 0.2 && left > 0.2 - pace * STEP, 'left ' + left );
	assert.ok( Math.abs( graph.machines.pipe.fade.age - ( 0.2 - left + STEP ) ) < 1e-12 );

} );

test( 'a transition taken mid-fade fades from that fade, and a state on both sides is updated once', () => {

	const { run, state, graph } = setup();
	run( 240, { speed: WALK } );
	run( 6, { speed: SPRINT } );
	assert.equal( state( 'locomotion' ), 'run' );

	const recipe = run( 1, { inAir: true } );
	assert.equal( state( 'locomotion' ), 'runTakeoff' );

	// walk → run → runTakeoff: the take-off fades in over the walk fading into the run.
	const machine = graph.machines.locomotion;
	assert.equal( machine.fade.from.to, machine.states.run );
	assert.equal( machine.fade.from.from, machine.states.walk );
	const clips = [];
	eachClip( recipe, ( clip ) => clips.push( clip.take ) );
	assert.ok( clips.includes( 'ground_walk_lean_left' ) || clips.includes( 'ground_walk_lean_left_slow' ) );
	assert.ok( clips.includes( 'air_takeoff_run' ) );

	// Hanging, a shimmy started and stopped at once: the hold shows on both sides of the fade back, and is worked out
	// once in the update.
	const hang = setup();
	hang.run( 480, { hanging: true } );
	hang.run( 3, { shimmyLeft: true } );
	const hold = hang.graph.machines.hang.states.hold, update = hold.pose.update.bind( hold.pose );
	let updates = 0;
	hold.pose.update = ( graph ) => ( updates ++, update( graph ) );
	hang.run( 1, { shimmyLeft: false } );
	assert.equal( hang.state( 'hang' ), 'hold' );
	assert.equal( hang.graph.machines.hang.fade.from.from, hold );
	assert.equal( updates, 1 );

} );

test( 'a landing at a run dips the body once, seen from behind and over no other move', () => {

	const dips = ( values, before = () => {} ) => {

		const { run, moves } = setup();
		run( 240, { speed: RUN, inAir: true, plainJump: false, ...values } );
		before( moves );
		let count = 0;
		for ( let step = 0; step < 120; step ++ ) {

			run( 1, { inAir: false } );
			count += moves.instances.filter( ( instance ) => instance.move.name === 'landingDip' && instance.age === STEP ).length;

		}

		return count;

	};

	assert.equal( dips( {} ), 1 );
	assert.equal( dips( { thirdPerson: false } ), 0 );
	assert.equal( dips( {}, ( moves ) => moves.play( 'perchLand' ) ), 0 );

} );

test( 'a switch takes its first answer at once, then blends straight over its time and leaves a side it has left alone', () => {

	const { run, graph } = setup();
	let recipe = run( 1 );
	assert.equal( recipe.source.kind, 'add', 'on its feet, no limp pose mixed in' );

	// Going limp takes 0.35 s; its first step is one 42nd of the way.
	recipe = run( 1, { limp: true } );
	assert.equal( recipe.source.kind, 'mix' );
	assert.ok( Math.abs( recipe.source.weight - STEP / 0.35 ) < 1e-12 );

	recipe = run( 42 );
	assert.equal( recipe.source.kind, 'clip' );
	const walking = graph.machines.locomotion.updatedAt;
	run( 10 );
	assert.equal( graph.machines.locomotion.updatedAt, walking );

	// Back on its feet at once.
	recipe = run( 1, { limp: false } );
	assert.equal( recipe.source.kind, 'add' );

} );

test( 'standing about plays the idles one after another, never one twice running, each fading into the next', () => {

	const { run, graph } = setup();
	const idle = graph.machines.locomotion.states.idle.pose;
	const played = [];
	let fading = 0;

	for ( let step = 0; step < 120 * 60; step ++ ) {

		run( 1 );
		if ( ! idle.current ) continue;
		if ( played.at( - 1 ) !== idle.current.take ) played.push( idle.current.take );
		if ( graph.machines.locomotion.states.idle.recipe.kind === 'mix' ) fading ++;

	}

	assert.ok( played.length > 8 );
	assert.ok( played.every( ( take, i ) => i === 0 || take !== played[ i - 1 ] ) );
	assert.deepEqual( new Set( played ), new Set( [ 'ground_idle', 'ground_idle_shift', 'ground_idle_look' ] ) );
	assert.ok( Math.abs( fading - ( played.length - 1 ) * 0.25 * 120 ) <= played.length );

} );

test( 'a directional blend mixes the takes around its input, an input past its edge going to the nearest point on it', () => {

	const weights = ( blend, ...input ) => blendWeights( blend, input ).map( ( { take, weight } ) => [ take, weight ] );

	// The run at full speed and a hard turn left is the leaning run alone; straight on, the weights still add up.
	assert.deepEqual( weights( BLENDS.runTurn, - Math.PI / 4, 5.85 ), [ [ 'ground_run_lean_left', 1 ] ] );
	assert.ok( Math.abs( blendWeights( BLENDS.runTurn, [ 0, 4.2 ] ).reduce( ( sum, sample ) => sum + sample.weight, 0 ) - 1 ) < 1e-12 );

	// The lean is one axis: into the run, back, or an even mix.
	assert.deepEqual( weights( BLENDS.lean, - 1 ), [ [ 'pose_lean_forward', 1 ] ] );
	assert.deepEqual( weights( BLENDS.lean, 1 ), [ [ 'pose_lean_back', 1 ] ] );
	assert.ok( blendWeights( BLENDS.lean, [ 0 ] ).every( ( sample ) => sample.weight === 0.5 ) );

	// Looking hard right and a little up while hanging: past the edge between looking right and up-right, 0.4 of
	// the way along it.
	const look = Object.fromEntries( weights( BLENDS.hangLook, 1, 0.4 ) );
	assert.ok( Math.abs( look.ledge_hang_look_right - 0.6 ) < 1e-12 );
	assert.ok( Math.abs( look.ledge_hang_look_up_right - 0.4 ) < 1e-12 );

} );

test( 'a blend\'s takes keep in step, and only its heaviest take\'s markers fire', () => {

	const { run, graph } = setup();
	run( 240, { speed: SPRINT, sprinting: true } );
	run( 1, { turnRate: 0.35 } );
	const blend = graph.machines.locomotion.states.run.recipe;
	assert.equal( blend.kind, 'blend' );
	assert.ok( blend.samples.length > 1 );

	// Every take is the same fraction of the way through itself.
	const fractions = blend.samples.map( ( sample ) => sample.recipe.time / takes.takes.get( sample.recipe.take ).length );
	assert.ok( fractions.every( ( fraction ) => Math.abs( fraction - fractions[ 0 ] ) < 1e-12 ) );
	assert.ok( Math.abs( graph.machines.locomotion.states.run.players[ 0 ].phase % 1 - fractions[ 0 ] ) < 1e-12 );

	const forMarkers = [];
	eachClip( blend, ( clip ) => forMarkers.push( clip.take ), true );
	const heaviest = blend.samples.reduce( ( best, sample ) => ( sample.weight > best.weight ? sample : best ) );
	assert.deepEqual( forMarkers, [ heaviest.recipe.take ] );

} );

test( 'a leaning take goes round in the time its stride takes at its sample\'s speed; a blend\'s cycle is its take\'s', () => {

	const still = () => [ 0, 0 ];

	for ( const blend of [ BLENDS.runTurn, BLENDS.walkTurn ] ) {

		const leaning = new DirectionalBlend( blend, still, takes );

		blend.samples.forEach( ( sample, index ) => {

			const take = takes.takes.get( sample.take );
			assert.ok( take.stride > 0, sample.take );
			assert.ok( Math.abs( take.length / leaning.rates[ index ] - take.stride / sample.at[ blend.speedAxis ] ) < 1e-12, sample.take );

		} );

		assert.equal( leaning.timeLeft(), takes.takes.get( blend.length ).length );

	}

	// The fast leaning run: 5.85 m/s over a 4.754 m stride (a tenth more than its capture's), a take 1.1944 s long.
	// The slow one at 2.5 m/s takes its 4.071 m stride in 1.6284 s.
	const runTurn = new DirectionalBlend( BLENDS.runTurn, still, takes );
	assert.equal( runTurn.rates[ 0 ], 5.85 * 1.1944444444444444 / 4.754 );
	assert.ok( Math.abs( takes.takes.get( 'ground_run_lean_left_slow' ).length / runTurn.rates[ 2 ] - 1.6284 ) < 1e-12 );

	// Takes with no stride, or a blend with no speed axis, play at their own rate.
	const seated = new DirectionalBlend( BLENDS.slideSeated, still, takes );
	assert.ok( seated.rates.every( ( rate ) => rate === 1 ) );
	assert.equal( seated.timeLeft(), takes.takes.get( 'slide_seat' ).length );

} );

test( 'the graph reads a turn to the right as positive, and the lean easing in against the velocity of the step before', () => {

	// A runner facing along x at 1 m/s, braking at 1 m/s², stepped 0.1 s at a time.
	const runner = {
		position: new Vector3(), velocity: new Vector3( 1, 0, 0 ), yaw: Math.PI / 2, state: 'walking', grounded: true,
		tuning: { values: { braking: 1 } }, pipesAndZiplines: {}, slides: { tilt: {} }, ledges: {}, polesAndBars: {}, tricks: {}, doorsAndSwitches: {}
	};
	const input = { held: () => false, move: { x: 0, y: 0 } };
	const inputs = new PoseInputs( runner, { moves: { busy: () => false } } );

	// No step before the first: no turn, and nothing to lean against yet.
	inputs.update( 0.1, input );
	assert.equal( inputs.turnRate, 0 );
	assert.equal( inputs.lean, 0 );
	assert.equal( inputs.speed, 1 );

	// Stopping within a step would take 10 m/s², more than the runner's 1: the lean heads for -1, a third of the way
	// in a tenth of a second.
	inputs.update( 0.1, input );
	assert.equal( inputs.lean, - 0.325 );

	// The heading turning clockwise (seen from above) is a turn to the right.
	runner.yaw -= 0.05;
	inputs.update( 0.1, input );
	assert.ok( Math.abs( inputs.turnRate - 0.5 ) < 1e-12 );

	// With no braking at all the lean holds, and so does the velocity it leans against.
	runner.tuning.values.braking = 0;
	const lean = inputs.lean;
	runner.velocity.set( 2, 0, 0 );
	inputs.update( 0.1, input );
	assert.equal( inputs.lean, lean );
	assert.equal( inputs.lastVelocity.x, 1 );

} );

test( 'on a rope the swing mixes its two poses by which way the body swings, held still on its own', () => {

	const { run } = setup();
	const weights = ( recipe ) => {

		const found = {};
		eachClip( recipe, ( clip, weight ) => {

			found[ clip.take ] = ( found[ clip.take ] ?? 0 ) + weight;

		} );
		return found;

	};

	run( 120, { onRope: true, ropeSwing: 0 } );
	let found = weights( run( 1, { onRope: true, ropeSwing: 0 } ) );
	assert.ok( Math.abs( found.rope_swing_forward - 0.5 ) < 1e-6 && Math.abs( found.rope_swing_back - 0.5 ) < 1e-6, JSON.stringify( found ) );

	run( 120, { onRope: true, ropeSwing: 1 } );
	found = weights( run( 1, { onRope: true, ropeSwing: 1 } ) );
	assert.ok( Math.abs( found.rope_swing_forward - 1 ) < 1e-6, JSON.stringify( found ) );

} );
