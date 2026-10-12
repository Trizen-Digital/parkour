import test from 'node:test';
import assert from 'node:assert/strict';
import '../tools/headless/env.mjs';

const { AnimationClip, Bone, Group, Quaternion, Vector3, VectorKeyframeTrack } = await import( 'three' );
const { Motion } = await import( '@trizen/parkour/motion/Motion.js' );
const { TakeLibrary } = await import( '@trizen/parkour/motion/TakeLibrary.js' );
const { PoseSampler } = await import( '@trizen/parkour/figure/PoseSampler.js' );
const { LegSolver } = await import( '@trizen/parkour/figure/LegSolver.js' );
const { FootPlacement } = await import( '@trizen/parkour/figure/FootPlacement.js' );
const { Figure } = await import( '@trizen/parkour/figure/Figure.js' );
const { YBotFigure } = await import( '../src/figure/YBotFigure.js' );
const { PoseInputs } = await import( '@trizen/parkour/runner/PoseInputs.js' );
const { TUNING_DEFAULTS } = await import( '@trizen/parkour/sim/tuning.js' );
const YBOT = ( await import( '../src/data/ybot.json', { with: { type: 'json' } } ) ).default;

const STEP = 1 / 120;
const UP = new Vector3( 0, 1, 0 );

test( 'stopping a move by name stops the one playing and lets it fade over its own blend-out', async () => {

	const motion = await new Motion().load();
	const roll = motion.moves.play( 'landingRoll' );
	const land = motion.moves.play( 'hardLanding' );
	assert.equal( motion.moves.playing(), land.move );

	motion.moves.stop( 'skidStop' );
	assert.equal( land.stopping, false );
	motion.moves.stop( 'hardLanding' );
	assert.equal( land.stopping, true );
	assert.equal( land.blendOut, land.move.blendOut );
	assert.equal( motion.moves.playing(), null );
	assert.equal( motion.moves.busy(), false );

	// The hard landing cut the roll off when it started.
	assert.equal( roll.stopping, true );

} );

test( 'a landing at speed dips the body in third person, but not over another move or in first person', async () => {

	const input = { held: () => false, move: { x: 0, y: 0 }, moveDirection: { x: 0, y: 0 } };

	// A runner falls for a second and a half at 5 m/s and lands sprinting: the move playing once it has landed.
	const land = async ( { firstPerson = false, playing = null } = {} ) => {

		const motion = await new Motion().load();
		const runner = {
			position: new Vector3(),
			velocity: new Vector3( 0, 0, 5 ),
			yaw: 0,
			state: 'falling',
			grounded: false,
			firstPerson,
			tuning: { values: { ...TUNING_DEFAULTS } },
			pipesAndZiplines: {}, slides: { tilt: {} }, ledges: {}, polesAndBars: {}, tricks: {}, doorsAndSwitches: {},
			forward: () => new Vector3( 0, 0, 1 ),
			queries: { sphereCast: () => null }
		};
		const poseInputs = new PoseInputs( runner, motion );
		const step = () => {

			poseInputs.update( STEP, input );
			motion.update( STEP, poseInputs );

		};

		for ( let frame = 0; frame < 180; frame ++ ) step();
		if ( playing ) motion.moves.play( playing );
		Object.assign( runner, { state: 'sprinting', grounded: true } );
		step();
		return motion.moves.playing()?.name ?? null;

	};

	assert.equal( await land(), 'landingDip' );
	assert.equal( await land( { playing: 'landingRoll' } ), 'landingRoll' );
	assert.equal( await land( { firstPerson: true } ), null );

} );

test( 'a take\'s root bone is held while the take\'s root motion is taken out, and always when the take is pinned: at rest or at the first frame', () => {

	// The root bone rests 0.5 m ahead; the take moves it from 1 m to 3 m ahead.
	const model = new Group(), root = new Bone();
	root.name = 'root';
	root.position.z = 0.5;
	model.add( root );
	const takes = new TakeLibrary( {
		takes: { slide: { length: 1, root: { times: [ 0, 1 ], positions: [ 0, 0, 0, 0, 0, 2 ] } } },
		moves: {}
	} );
	const clip = new AnimationClip( 'slide', 1, [ new VectorKeyframeTrack( 'root.position', [ 0, 1 ], [ 0, 0, 1, 0, 0, 3 ] ) ] );
	const sampler = new PoseSampler( model, new Map( [ [ 'slide', clip ] ] ), takes, { root: 'root' } );
	const rootAt = ( recipe ) => {

		sampler.beginStep();
		return sampler.evaluate( recipe )[ 0 ].position.z;

	};

	const slide = takes.takes.get( 'slide' );
	assert.equal( rootAt( { kind: 'clip', take: 'slide', time: 0.5 } ), 2 );
	assert.equal( rootAt( { kind: 'clip', take: 'slide', time: 0.5, rootMotion: true } ), 0.5 );
	slide.pinned = true;
	assert.equal( rootAt( { kind: 'clip', take: 'slide', time: 0.5 } ), 0.5 );
	slide.pinAt = 'firstFrame';
	assert.equal( rootAt( { kind: 'clip', take: 'slide', time: 0.5 } ), 1 );

} );

// A small two-legged skeleton standing on the floor at its origin: hips 0.9 m up, thighs and shins 0.4 m, the knees
// a little forward, the feet 5 cm above the floor. Every bone faces the model's way, so a foot's up is +y.
function legs() {

	const model = new Group();
	const bone = ( name, parent, x, y, z ) => {

		const b = new Bone();
		b.name = name;
		b.position.set( x, y, z );
		parent.add( b );
		return b;

	};

	const hips = bone( 'hips', bone( 'root', model, 0, 0, 0 ), 0, 0.9, 0 );
	for ( const [ side, x ] of [ [ 'left', 0.1 ], [ 'right', - 0.1 ] ] ) bone( side + 'Foot', bone( side + 'Shin', bone( side + 'Thigh', hips, x, - 0.05, 0 ), 0, - 0.4, 0.03 ), 0, - 0.4, - 0.03 );

	model.updateMatrixWorld( true );
	const sampler = new PoseSampler( model, new Map(), null, { root: 'root', hips: 'hips', leftFoot: 'leftFoot', rightFoot: 'rightFoot' } );
	sampler.legs = new LegSolver( sampler );
	return sampler;

}

const at = ( sampler, pose, role ) => sampler.global( pose, sampler.role( role ) ).position;

test( 'a leg reaches a target in reach exactly, its bones keeping their lengths and its knee bending toward the hint', () => {

	const sampler = legs(), pose = sampler.allocate();
	const foot = sampler.role( 'leftFoot' ), shin = sampler.parents[ foot ], thigh = sampler.parents[ shin ];
	const length = ( a, b ) => sampler.global( pose, a ).position.distanceTo( sampler.global( pose, b ).position );
	const lengths = [ length( thigh, shin ), length( shin, foot ) ];

	const target = new Vector3( 0.15, 0.25, 0.1 );
	sampler.legs.solve( pose, foot, target, { knee: new Vector3( 0.1, 0.5, 2 ) } );

	assert.ok( at( sampler, pose, 'leftFoot' ).distanceTo( target ) < 1e-9 );
	assert.ok( Math.abs( length( thigh, shin ) - lengths[ 0 ] ) < 1e-9 && Math.abs( length( shin, foot ) - lengths[ 1 ] ) < 1e-9 );
	assert.ok( sampler.global( pose, shin ).position.z > 0.2, 'the knee bends forward, toward the hint' );

	// With the hint behind, the same target bends the knee backward.
	const back = sampler.allocate();
	sampler.legs.solve( back, foot, target, { knee: new Vector3( 0.1, 0.5, - 2 ) } );
	assert.ok( at( sampler, back, 'leftFoot' ).distanceTo( target ) < 1e-9 );
	assert.ok( sampler.global( back, shin ).position.z < 0 );

} );

test( 'a leg out of reach goes straight toward its target; half a weight bends it half way; the foot keeps its turn unless given one', () => {

	const sampler = legs(), foot = sampler.role( 'rightFoot' ), hip = new Vector3( - 0.1, 0.85, 0 );
	const far = new Vector3( - 0.1, 0.85 - 2, 1 ), pose = sampler.allocate();
	sampler.legs.solve( pose, foot, far );

	const reach = at( sampler, pose, 'rightFoot' ).sub( hip );
	assert.ok( Math.abs( reach.length() - ( 0.4 + Math.hypot( 0.4, 0.03 ) ) ) < 0.01, 'the leg is straight' );
	assert.ok( reach.normalize().dot( far.clone().sub( hip ).normalize() ) > 0.9999, 'and points at the target' );

	const goal = new Vector3( - 0.1, 0.3, 0.2 ), full = sampler.allocate(), half = sampler.allocate(), still = sampler.allocate();
	sampler.legs.solve( full, foot, goal );
	sampler.legs.solve( half, foot, goal, { weight: 0.5 } );
	const thigh = sampler.parents[ sampler.parents[ foot ] ];
	const angle = ( p ) => p[ thigh ].quaternion.angleTo( still[ thigh ].quaternion );
	assert.ok( Math.abs( angle( half ) - angle( full ) / 2 ) < 1e-3 );

	// The foot keeps its turn on the shin; given a rotation, it takes it in the skeleton's space.
	assert.ok( full[ foot ].quaternion.angleTo( still[ foot ].quaternion ) < 1e-12 );
	const flat = new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), 0.3 );
	sampler.legs.solve( still, foot, goal, { rotation: flat } );
	assert.ok( sampler.global( still, foot ).quaternion.angleTo( flat ) < 1e-9 );

} );

// Ground for the feet's probe: a height and a normal for every place, as a swept ball would find them. Ground
// above the ball's start is a solid the ball starts in.
function ground( height, normal = UP ) {

	return {
		sphereCast( from, to, radius, options ) {

			assert.equal( options.group, 'probe' );
			const y = height( from.x, from.z );
			if ( y > from.y ) return { startedInside: true, point: from.clone(), normal: new Vector3( 1, 0, 0 ) };
			if ( y < to.y - radius ) return null;
			return { startedInside: false, point: new Vector3( from.x, y, from.z ), normal: normal.clone() };

		},
		// Nothing for the body to keep clear of.
		penetration: () => null,
		ray: () => null
	};

}

const SETTINGS = {
	...YBOT.feet,
	left: { role: 'leftFoot', aim: [ 0, 1, 0 ], twist: { axis: [ 0, 0, 1 ], toward: [ 0, 0, 1 ] } },
	right: { role: 'rightFoot', aim: [ 0, 1, 0 ], twist: { axis: [ 0, 0, 1 ], toward: [ 0, 0, 1 ] } }
};

// The small skeleton's feet put on some ground, `steps` steps of `dt` long; the pose, and the placement's state.
function stand( queries, { steps = 1, dt = 1, weight = 1, settings = SETTINGS } = {} ) {

	const sampler = legs(), feet = new FootPlacement( sampler, sampler.legs, settings );
	feet.queries = queries;
	let pose;
	for ( let step = 0; step < steps; step ++ ) {

		pose = sampler.allocate();
		feet.place( pose, weight, dt );

	}

	return { sampler, feet, pose, still: sampler.allocate() };

}

test( 'on level ground below the takes\' floor, the hips and both feet drop by its depth, the legs unbent', () => {

	const { sampler, pose, still } = stand( ground( () => - 0.03 ) );

	assert.ok( Math.abs( at( sampler, pose, 'hips' ).y - ( at( sampler, still, 'hips' ).y - 0.03 ) ) < 1e-12 );
	for ( const foot of [ 'leftFoot', 'rightFoot' ] ) assert.ok( at( sampler, pose, foot ).distanceTo( at( sampler, still, foot ).add( new Vector3( 0, - 0.03, 0 ) ) ) < 1e-9, foot );

} );

test( 'at a step, the pelvis stays with the lower foot and the higher foot\'s leg bends to stand on the step', () => {

	// The left foot (x > 0) is over a step 20 cm up.
	const { sampler, feet, pose, still } = stand( ground( ( x ) => ( x > 0 ? 0.2 : 0 ) ) );

	assert.equal( feet.pelvis, 0 );
	assert.ok( Math.abs( feet.lift[ 0 ] - 0.2 ) < 1e-12 && feet.lift[ 1 ] === 0 );
	assert.ok( at( sampler, pose, 'hips' ).distanceTo( at( sampler, still, 'hips' ) ) < 1e-12 );
	assert.ok( at( sampler, pose, 'leftFoot' ).distanceTo( at( sampler, still, 'leftFoot' ).add( new Vector3( 0, 0.2, 0 ) ) ) < 1e-9 );
	assert.ok( at( sampler, pose, 'rightFoot' ).distanceTo( at( sampler, still, 'rightFoot' ) ) < 1e-9 );
	assert.ok( sampler.global( pose, sampler.parents[ sampler.role( 'leftFoot' ) ] ).position.z > 0.03, 'the raised leg bends its knee forward' );

} );

test( 'the pelvis eases toward its ground at its rate and each foot at its own; a weight of zero leaves the pose and the heights', () => {

	const settings = SETTINGS;
	const { feet } = stand( ground( () => - 0.1 ), { dt: STEP } );
	assert.ok( Math.abs( feet.pelvis - - 0.1 * settings.pelvisRate * STEP ) < 1e-15 );
	assert.ok( Math.abs( feet.lift[ 0 ] - ( - 0.1 - feet.pelvis ) * settings.footRate * STEP ) < 1e-15 );

	const idle = stand( ground( () => - 0.1 ), { weight: 0 } );
	assert.equal( idle.feet.pelvis, 0 );
	assert.deepEqual( idle.feet.lift, [ 0, 0 ] );
	idle.pose.forEach( ( bone, i ) => assert.ok( bone.position.equals( idle.still[ i ].position ) && bone.quaternion.equals( idle.still[ i ].quaternion ) ) );

	const half = stand( ground( () => - 0.1 ), { weight: 0.5 } );
	assert.ok( Math.abs( at( half.sampler, half.pose, 'hips' ).y - ( 0.9 - 0.05 ) ) < 1e-12 );

} );

test( 'a foot inside a solid learns nothing of the ground there: it keeps its animated height', () => {

	// A block whose top is 1 m up under the left foot: the ball starts inside it.
	const { sampler, feet, pose, still } = stand( ground( ( x ) => ( x > 0 ? 1 : - 0.02 ) ) );

	assert.ok( Math.abs( feet.pelvis - - 0.02 ) < 1e-12 );
	assert.ok( Math.abs( feet.lift[ 0 ] - 0.02 ) < 1e-12, 'the left foot stands on the takes\' own floor' );
	assert.ok( at( sampler, pose, 'leftFoot' ).distanceTo( at( sampler, still, 'leftFoot' ) ) < 1e-9 );

} );

test( 'while the pelvis is still easing down from higher ground, the hips go lower so the legs reach their feet\'s goals', () => {

	const sampler = legs(), feet = new FootPlacement( sampler, sampler.legs, SETTINGS );
	feet.queries = ground( () => 0 );
	// Left over from standing where the ground was 10 cm higher under both feet.
	feet.pelvis = 0.1;
	feet.lift = [ 0, 0 ];
	const pose = sampler.allocate(), still = sampler.allocate();
	feet.place( pose, 1, STEP );

	// After one step the pelvis is still 9.7 cm up and the feet's goals 8.1 cm above their animated places: the
	// nearly straight legs reach them from hips raised 8.3 cm, not 9.7.
	const raised = at( sampler, pose, 'hips' ).y - at( sampler, still, 'hips' ).y;
	assert.ok( feet.pelvis > 0.09 && raised < feet.pelvis - 0.01 );
	for ( const [ i, foot ] of [ 'leftFoot', 'rightFoot' ].entries() ) {

		const goal = at( sampler, still, foot ).add( new Vector3( 0, feet.pelvis + feet.lift[ i ], 0 ) );
		assert.ok( at( sampler, pose, foot ).distanceTo( goal ) < 1e-5, foot );

	}

} );

test( 'a foot lies flat on ground it can stand on, pointing the way the figure faces, and keeps its turn on steeper ground', () => {

	const slope = new Vector3( 0, Math.cos( 0.3 ), - Math.sin( 0.3 ) ), steep = new Vector3( 0, 0.7, - Math.sqrt( 0.51 ) );
	const { sampler, pose } = stand( ground( () => 0, slope ) );
	const turn = sampler.global( pose, sampler.role( 'leftFoot' ) ).quaternion;
	assert.ok( UP.clone().applyQuaternion( turn ).distanceTo( slope ) < 1e-9, 'its up along the ground\'s normal' );
	const toes = new Vector3( 0, 0, 1 ).applyQuaternion( turn );
	assert.ok( Math.abs( toes.dot( slope ) ) < 1e-9 && toes.z > 0.9, 'its toes along the ground, ahead' );

	const kept = stand( ground( () => 0, steep ) );
	assert.ok( kept.sampler.global( kept.pose, kept.sampler.role( 'leftFoot' ) ).quaternion.angleTo( new Quaternion() ) < 1e-9 );

} );

test( 'the body trails a step up or down that the capsule takes at once, catching up as the runner goes on; a jump, a landing, a body the ragdoll had and a jump elsewhere it follows at once', () => {

	// A step 25 cm up from z = 1 on, as the courses' stairs have it: a ball swept down meets the highest ground under it.
	const sampler = legs(), feet = new FootPlacement( sampler, sampler.legs, SETTINGS );
	feet.queries = {
		sphereCast( from, to, radius, options ) {

			assert.equal( options.group, 'probe' );
			const y = from.z + radius > 1 ? 0.25 : 0;
			if ( y < to.y - radius ) return null;
			return { startedInside: false, point: new Vector3( from.x, y, from.z ), normal: UP.clone() };

		}
	};

	// Each step the skeleton's space goes where the runner's capsule has put it; the hips' height in the world, and the
	// largest change of it from one step to the next.
	let hips = null, most = 0;
	const step = ( x, y, z, weight = 0 ) => {

		sampler.space.position.set( x, y, z );
		sampler.beginStep( STEP );
		const pose = sampler.allocate();
		feet.place( pose, weight, STEP );
		const height = sampler.toWorld( at( sampler, pose, 'hips' ) ).y;
		if ( hips !== null ) most = Math.max( most, Math.abs( height - hips ) );
		hips = height;
		return pose;

	};

	// Walking up onto it at 2 m/s, the mover lifting the capsule (0.185 m round) 25 cm in a single step once its front
	// is 2 cm over: the hips rise no faster than the runner goes, and are with the capsule again 30 cm on.
	let z = 0;
	for ( ; z < 0.835; z += 2 * STEP ) step( 0, 0, z );
	for ( ; z < 1.15; z += 2 * STEP ) {

		step( 0, 0.25, z );
		assert.ok( hips <= 0.9 + 0.25 + 1e-12 );

	}

	assert.ok( most < 2 * STEP + 1e-9, `${ most }` );
	assert.equal( feet.trail, 0 );
	assert.ok( Math.abs( hips - ( 0.9 + 0.25 ) ) < 1e-12 );

	// And back down it, dropping once the capsule's rim is off the edge: the hips held up, then lowered as it goes.
	most = 0;
	for ( ; z > 0.815; z -= 2 * STEP ) step( 0, 0.25, z );
	for ( ; z > 0.45; z -= 2 * STEP ) step( 0, 0, z );
	assert.ok( most < 2 * STEP + 1e-9, `${ most }` );
	assert.ok( Math.abs( hips - 0.9 ) < 1e-12 );

	// Standing (the feet placed), a step up keeps the feet on their ground, both over the step, while the hips trail.
	step( 0, 0, 0.93, 1 );
	const stood = step( 0, 0.25, 0.97, 1 );
	assert.ok( Math.abs( hips - 0.9 ) < 1e-9, `${ hips }` );
	for ( const foot of [ 'leftFoot', 'rightFoot' ] ) assert.ok( Math.abs( sampler.toWorld( at( sampler, stood, foot ) ).y - ( 0.05 + 0.25 ) ) < 1e-6, foot );
	feet.reset();

	// A jump's first step leaves the ground below, a landing comes from falling, a body the ragdoll had comes down from
	// the air it bailed in, and a jump elsewhere is not a step: the hips go with the capsule every step.
	const follows = ( places ) => {

		for ( const [ x, y, z ] of places ) {

			step( x, y, z );
			assert.equal( feet.trail, 0, `at ${ [ x, y, z ] }` );
			assert.ok( Math.abs( hips - ( y + 0.9 ) ) < 1e-12 );

		}

	};

	follows( [ 0, 1, 2, 3, 4, 5 ].map( ( k ) => [ 0, 7.25 * k * STEP, 0 ] ) );
	// Falling at 10 m/s onto the ground: the step that stops the fall jolts the capsule's height by 8.3 cm.
	follows( [ 6, 5, 4, 3, 2, 1, 0, 0, 0 ].map( ( k ) => [ 0, 10 * k * STEP, 0 ] ) );
	// Placed last 30 cm up, still in the air, and next on the ground.
	follows( [ [ 0, 0.3, 0 ], [ 0, 0.3, 0 ], [ 0.1, 0, 0 ] ] );
	follows( [ [ 0, 0, 0 ], [ 3, 0.25, 1.5 ], [ 3, 0.25, 1.5 ] ] );

} );

test( 'the timing-only figure stands below the runner\'s centre, tilts with the slide after its heading, and sees from 0.75 m up', () => {

	const figure = new Figure(), position = new Vector3( 1, 2, 3 );
	figure.step( STEP, null, position, 0.5, { tilt: { pitch: 0.2, roll: 0 }, sliding: true } );

	assert.ok( figure.root.position.equals( position ) );
	assert.equal( figure.root.rotation.order, 'YXZ' );
	assert.ok( figure.body.position.y < - 0.31 && figure.body.position.y > - 0.33 );
	const { position: eyes, quaternion } = figure.headPose();
	assert.ok( eyes.equals( new Vector3( 1, 2.75, 3 ) ) );
	assert.ok( quaternion.equals( figure.root.quaternion ) );

	figure.step( STEP, null, position, 0.5 );
	assert.ok( figure.body.position.y < - 0.9 );

} );

test( 'the Y Bot standing at a step puts each foot on its own ground, the hips with the lower one', async () => {

	const motion = await new Motion().load();
	const figure = await new YBotFigure().load( motion.takes );
	figure.setQueries( ground( ( x ) => ( x > 0 ? 0.15 : 0 ) ) );
	const standing = { kind: 'clip', take: 'ground_idle', time: 0 };
	const recipe = { kind: 'feet', source: standing, weight: 1 };

	// The runner's capsule floats over the floor: the model's origin, 0.92 m below its centre, is 1.5 mm up.
	const centre = new Vector3( 0, 0.9215, 0 );
	const bone = ( role ) => figure.model.getObjectByName( figure.roles[ role ] ).getWorldPosition( new Vector3() );
	figure.step( STEP, standing, centre, 0 );
	const animated = { left: bone( 'leftFoot' ), right: bone( 'rightFoot' ), hips: bone( 'hips' ) };
	for ( let step = 0; step < 240; step ++ ) figure.step( STEP, recipe, centre, 0 );

	// The left foot (x > 0: the Y Bot faces +z) is over the step.
	assert.ok( Math.abs( bone( 'leftFoot' ).y - ( animated.left.y - 0.0015 + 0.15 ) ) < 0.001 );
	assert.ok( Math.abs( bone( 'rightFoot' ).y - ( animated.right.y - 0.0015 ) ) < 0.001 );
	assert.ok( Math.abs( bone( 'hips' ).y - ( animated.hips.y - 0.0015 ) ) < 0.001 );

	figure.resetBody();
	assert.equal( figure.feet.pelvis, 0 );

} );

test( 'the grip says what the hands hold, eased: a bar reached for then held firm and let go at the launch, a valve\'s rim, a button\'s face for its hand, a vaulted top; and a beam underfoot', () => {

	const input = { held: () => false, move: { x: 0, y: 0 } };
	const line = { a: new Vector3( - 1, 2, 0 ), b: new Vector3( 1, 2, 0 ), radius: 0.03 };
	const runner = {
		position: new Vector3(), velocity: new Vector3(), yaw: 0, state: 'onBar', grounded: false,
		tuning: { values: { ...TUNING_DEFAULTS } }, slides: { tilt: {} }, tricks: {}, ledges: { vaultTop: null },
		polesAndBars: { attachment: { kind: 'bar', phase: 'placing', line } }, pipesAndZiplines: {}, doorsAndSwitches: {},
		forward: () => new Vector3( 0, 0, 1 ), queries: { sphereCast: () => null }
	};
	let playing = null;
	const inputs = new PoseInputs( runner, { moves: { busy: () => false, playing: () => playing } } );
	const grip = inputs.grip;

	inputs.update( STEP, input );
	assert.equal( grip.kind, 'line' );
	assert.equal( grip.firm, false, 'reached for while the body settles' );
	assert.ok( Math.abs( grip.weight - 8 * STEP ) < 1e-12 );
	assert.ok( grip.a.equals( line.a ) && grip.b.equals( line.b ) && grip.radius === 0.03 );

	runner.polesAndBars.attachment.phase = 'holding';
	inputs.update( STEP, input );
	assert.equal( grip.firm, true );

	// Launched: the hands let go, the line kept while the weight eases out.
	runner.polesAndBars.attachment.phase = 'launched';
	inputs.update( STEP, input );
	assert.equal( grip.kind, 'line' );
	for ( let step = 0; step < 60; step ++ ) inputs.update( STEP, input );
	assert.equal( grip.kind, null );
	assert.equal( grip.weight, 0 );

	runner.state = 'groundStunt';
	runner.polesAndBars.attachment = null;
	const item = { position: new Vector3( 0, 1, 1 ), normal: new Vector3( 0, 0, - 1 ), radius: 0.2 };
	runner.doorsAndSwitches.working = { kind: 'valve', state: { item } };
	inputs.update( STEP, input );
	assert.equal( grip.kind, 'rim' );
	assert.equal( grip.firm, true );
	assert.equal( grip.rim, 0.2 );

	runner.doorsAndSwitches.working = { kind: 'button', hand: 'left', state: { item } };
	inputs.update( STEP, input );
	assert.equal( grip.kind, 'point' );
	assert.equal( grip.hand, 'left' );
	assert.ok( grip.at.distanceTo( new Vector3( 0, 1, 0.96 ) ) < 1e-9, 'the button\'s face, 4 cm out' );

	runner.doorsAndSwitches.working = null;
	runner.ledges.vaultTop = 0.75;
	playing = { name: 'kongVault' };
	inputs.update( STEP, input );
	assert.equal( grip.kind, 'plant' );
	assert.equal( grip.top, 0.75 );

	runner.grounded = true;
	runner.mover = { floor: { solid: { tags: [ 'beam' ] } } };
	inputs.update( STEP, input );
	assert.equal( inputs.onBeam, true );
	runner.mover.floor.solid.tags = [];
	inputs.update( STEP, input );
	assert.equal( inputs.onBeam, false );

} );

test( 'a masked move shows from the spine up, the pose beneath it going on', async () => {

	const motion = await new Motion().load();
	const figure = await new YBotFigure().load( motion.takes );
	const sampler = figure.sampler;
	sampler.beginStep( STEP );
	const run = { kind: 'clip', take: 'ground_run_lean_left', time: 0.3 }, barge = { kind: 'clip', take: 'door_barge', time: 0.4 };
	const shown = sampler.evaluate( { kind: 'mask', base: run, over: barge, weight: 1, mask: 'upper' } );
	const legs = sampler.evaluate( run ), shoulder = sampler.evaluate( barge );

	for ( const [ name, from ] of [ [ 'mixamorigSpine1', shoulder ], [ 'mixamorigRightArm', shoulder ], [ 'mixamorigHead', shoulder ], [ 'mixamorigLeftUpLeg', legs ], [ 'mixamorigRightLeg', legs ], [ 'mixamorigHips', legs ] ] ) {

		const index = sampler.index.get( name );
		assert.ok( shown[ index ].quaternion.angleTo( from[ index ].quaternion ) < 1e-6, name );

	}

} );

test( 'in the air, a wall the flight meets within 0.3 s nearly head on shows as coming; one met side-on, or on the ground, does not', () => {

	const input = { held: () => false, move: { x: 0, y: 0 } };
	let wall = { startedInside: false, faceNormal: new Vector3( 0, 0, - 1 ), normal: new Vector3( 0, 0, - 1 ) };
	const runner = {
		position: new Vector3( 0, 2, 0 ), velocity: new Vector3( 0, 0, 5 ), yaw: 0, state: 'falling', grounded: false,
		tuning: { values: { ...TUNING_DEFAULTS } }, slides: { tilt: {} }, tricks: {}, ledges: {}, polesAndBars: {}, pipesAndZiplines: {}, doorsAndSwitches: {},
		forward: () => new Vector3( 0, 0, 1 ), queries: { sphereCast: () => wall }
	};
	const inputs = new PoseInputs( runner, { moves: { busy: () => false, playing: () => null } } );

	inputs.update( STEP, input );
	assert.equal( inputs.wallComing, true );

	wall = { ...wall, faceNormal: new Vector3( - 1, 0, 0 ), normal: new Vector3( - 1, 0, 0 ) };
	inputs.update( STEP, input );
	assert.equal( inputs.wallComing, false );

	wall = { ...wall, faceNormal: new Vector3( 0, 0, - 1 ), normal: new Vector3( 0, 0, - 1 ) };
	runner.grounded = true;
	inputs.update( STEP, input );
	assert.equal( inputs.wallComing, false );

} );
