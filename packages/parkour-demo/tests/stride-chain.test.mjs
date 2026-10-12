// Strides one after another flow on forward: across the benchmark's dozen gaps (strides-level), the Y Bot's feet on
// the ground never slide forward in the runner's frame between one stride's landing and the next stride, which picks
// up the step the last one's take has got to as it runs on along the top (Precision.js), with no skid between them.
// And the takes behind it: where the next stride's take starts matches the pose the last one's has reached.

import test from 'node:test';
import assert from 'node:assert/strict';

await import( '../tools/headless/env.mjs' );
const { Matrix4, Vector3 } = await import( 'three' );
const { Course } = await import( '../src/course/Course.js' );
const { metrics } = await import( '../src/course/metrics.js' );
const { World } = await import( '@trizen/parkour/world/World.js' );
const { fromCourse } = await import( '../src/world/fromCourse.js' );
const { Simulation } = await import( '@trizen/parkour/sim/Simulation.js' );
const { Motion } = await import( '@trizen/parkour/motion/Motion.js' );
const { backendOf, ENGINES } = await import( '../src/engines.js' );
const { STRIDE_HAND_OVER } = await import( '@trizen/parkour/runner/Precision.js' );
const { YBotFigure } = await import( '../src/figure/YBotFigure.js' );
const { STATIONS } = await import( '../src/bench/stations.js' );
const { benchCourse } = await import( '../src/bench/course.js' );
const { BenchRun } = await import( '../src/bench/BenchRun.js' );

// A foot bone this low in the runner's frame (m, below the body's centre) stands on the ground.
const ON_GROUND = - 0.78;

test( 'strides one after another: a foot on the ground never slides forward between them, and no skid plays', async () => {

	const { def, placed } = benchCourse( STATIONS.filter( ( station ) => station.id === 'strides-level' ) );
	const sim = new Simulation( { world: new World( fromCourse( new Course( def, { metrics } ) ) ), figure: new YBotFigure(), engine: backendOf( ENGINES[ 0 ] ), page: { storage: null, eventWindow: null, eventDocument: null, navigator: null } } );
	await sim.load();
	const run = new BenchRun( sim, placed ).start();

	// Each step: whether the runner strides, the moves playing, and the feet in the runner's frame.
	const feet = [ 'LeftFoot', 'RightFoot' ].map( ( name ) => sim.figure.model.getObjectByName( 'mixamorig' + name ) );
	const steps = [], inverse = new Matrix4(), at = new Vector3();
	const onStep = sim.onStep;
	sim.onStep = ( s ) => {

		onStep?.( s );
		sim.figure.root.updateMatrixWorld( true );
		inverse.copy( sim.figure.root.matrixWorld ).invert();
		steps.push( {
			striding: s.runner.state === 'striding',
			moves: s.motion.moves.instances.map( ( instance ) => instance.move.name ),
			feet: feet.map( ( foot ) => foot.getWorldPosition( at ).applyMatrix4( inverse ).toArray() )
		} );

	};
	run.runToEnd();
	sim.onStep = onStep;
	assert.deepEqual( run.log.map( ( record ) => record.result ), [ 'pass' ] );

	// From each stride's last step to a tenth of a second into the next (a stride straight after it).
	let handOvers = 0;
	for ( let start = 1; start < steps.length; start ++ ) {

		if ( ! steps[ start ].striding || steps[ start - 1 ].striding ) continue;
		let end = start - 1;
		while ( end > 0 && ! steps[ end ].striding ) end --;
		if ( ! steps[ end ].striding ) continue;

		handOvers ++;
		let forward = 0;
		for ( let i = end + 1; i <= start + 12; i ++ ) {

			assert.ok( ! steps[ i ].moves.includes( 'skidStop' ), `a skid between the strides at step ${i}` );
			for ( let foot = 0; foot < 2; foot ++ ) {

				const [ , y0, z0 ] = steps[ i - 1 ].feet[ foot ], [ , y1, z1 ] = steps[ i ].feet[ foot ];
				if ( y0 < ON_GROUND && y1 < ON_GROUND ) forward += Math.max( 0, z1 - z0 );

			}

		}

		// Before, the skid's braced leg and the next stride starting a step behind slid a foot on the ground forward
		// 0.25 m at each hand-over, 0.68 m at most.
		assert.ok( forward < 0.02, `a foot on the ground slid ${forward.toFixed( 3 )} m forward handing over at step ${start}` );

	}

	assert.equal( handOvers, 11 );
	run.end();
	sim.dispose();

} );

test( 'a stride straight after another starts its take where its feet are about where the last one\'s have got to', async () => {

	const motion = await new Motion().load();
	const figure = await new YBotFigure().load( motion.takes );
	const feet = [ 'LeftFoot', 'RightFoot' ].map( ( name ) => figure.model.getObjectByName( 'mixamorig' + name ) );
	// How far ahead of where they are in one take each foot is in another (m, in the runner's frame).
	const ahead = ( [ take, time ], [ otherTake, otherTime ] ) => {

		const at = ( name, t ) => {

			figure.step( 1 / 120, { kind: 'clip', take: name, time: t, rootMotion: true }, new Vector3(), 0, {} );
			figure.root.updateMatrixWorld( true );
			return feet.map( ( foot ) => foot.getWorldPosition( new Vector3() ).z );

		};
		const a = at( take, time ), b = at( otherTake, otherTime );
		return b.map( ( z, i ) => z - a[ i ] );

	};

	// Precision.js's hand-over after a left stride, from its landing (0.57 s into its take) to as it starts blending out
	// at its end: the other side's take, then the same side's.
	const { until, other, same } = STRIDE_HAND_OVER;
	const next = ( time ) => time < until ? [ 'stride_right', Math.max( 0, time - other ) ] : [ 'stride_left', Math.max( 0, time - same ) ];
	const end = motion.takes.takes.get( 'stride_left' ).length;
	let worst = 0;
	for ( let time = 0.57; time <= end - 0.1; time += 0.01 ) worst = Math.max( worst, ...ahead( [ 'stride_left', time ], next( time ) ).map( Math.abs ) );

	// As it was, the last stride's end against the next one's start: the foot on the ground 0.29 m ahead, and the
	// other, on its way forward, 0.33 m back.
	const before = ahead( [ 'stride_left', 0.6963 ], [ 'stride_right', 0 ] );
	assert.ok( worst < 0.2, `a foot is ${worst.toFixed( 3 )} m out at a hand-over` );
	assert.ok( before[ 0 ] > 0.25 && before[ 1 ] < - 0.25 );

} );
