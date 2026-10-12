// The ragdoll: the Y Bot's description, what the ragdoll asks of a physics engine, the body falling in one piece on
// every engine, every ragdoll starting in a world as made, and the joint limits and motor on stand-in bodies.

import test from 'node:test';
import assert from 'node:assert/strict';
import '../tools/headless/env.mjs';

const { Quaternion, Vector2, Vector3 } = await import( 'three' );
const { YBotFigure } = await import( '../src/figure/YBotFigure.js' );
const { Figure } = await import( '@trizendigital/parkour/figure/Figure.js' );
const { Ragdoll } = await import( '@trizendigital/parkour/physics/Ragdoll.js' );
const { AXES, LOCKED, JointLimits, coneError, nearestOnEllipse } = await import( '@trizendigital/parkour/physics/jointLimits.js' );
const { ENGINES: ENGINE_NAMES, createEngine } = await import( '../src/engines.js' );
const { GROUPS, boxSolid } = await import( '@trizendigital/parkour/world/solids.js' );
const { TUNING_DEFAULTS } = await import( '@trizendigital/parkour/sim/tuning.js' );
const DESCRIPTION = ( await import( '../src/data/ybot-ragdoll.json', { with: { type: 'json' } } ) ).default;

const DEGREE = Math.PI / 180;
const STEP = 1 / 120;
const STILL = { move: { x: 0, y: 0 }, held: () => false };

// Bones the ragdoll has a body for, by their names in the model.
const HIPS = 'mixamorigHips', SPINE = 'mixamorigSpine', CHEST = 'mixamorigSpine2', HEAD = 'mixamorigHead';
const LEFT_HAND = 'mixamorigLeftHand', TOES = [ 'mixamorigLeftToeBase', 'mixamorigRightToeBase' ];
// The middle of the spine: it has no body, and rides between the spine's and the chest's.
const SPINE_MIDDLE = 'mixamorigSpine1';

const ENGINES = {};
for ( const name of ENGINE_NAMES ) ENGINES[ name ] = await createEngine( name );

// A 100 m floor whose top is at 0.
const FLOOR = boxSolid( { id: 'floor', position: [ 0, - 0.5, 0 ], halfExtents: [ 50, 0.5, 50 ] } );

// The motion as the ragdoll sees it: told when the body comes back.
function standInMotion() {

	const motion = { stops: [], moves: { stop: ( ...args ) => motion.stops.push( args ) } };
	return motion;

}

function ragdollFor( figure, { engine = ENGINES.rapier, solids = [ FLOOR ], tuning = {} } = {} ) {

	const motion = standInMotion();
	const ragdoll = new Ragdoll( { engine, solids, tuning: { values: { ...TUNING_DEFAULTS, ...tuning } }, motion, figure } );
	return { ragdoll, motion };

}

// The Y Bot standing at a height, turned to a yaw.
async function yBot( { height = 1, yaw = 0 } = {} ) {

	const figure = await new YBotFigure().load( null );
	figure.root.position.set( 0, height, 0 );
	figure.root.rotation.set( 0, yaw, 0 );
	return figure;

}

const bone = ( figure, name ) => figure.model.getObjectByName( name );

// How far apart two rotations are, number by number (with either sign, which means the same rotation).
const apart = ( a, b ) => Math.min( ...[ 1, - 1 ].map( ( sign ) => Math.max( ...[ 'x', 'y', 'z', 'w' ].map( ( key ) => Math.abs( a[ key ] - sign * b[ key ] ) ) ) ) );

// How far apart a joint's two anchors are, in the world.
function gap( joint ) {

	const anchor = ( values, body ) => new Vector3().fromArray( values ).applyQuaternion( body.rotation() ).add( body.position() );
	return anchor( joint.joint.anchor, joint.body ).distanceTo( anchor( joint.joint.parentAnchor, joint.parent ) );

}

// How far each axis of a joint is past its limit (rad; negative: within it).
function pastLimits( joint ) {

	const { angles } = joint.measure();
	return joint.limits.map( ( limit, axis ) => ( { locked: limit === LOCKED, past: Math.abs( angles[ axis ] ) - ( limit === LOCKED ? 0 : limit ) } ) );

}

function energy( ragdoll ) {

	let total = 0;
	for ( const body of ragdoll.bodies.values() ) total += body.mass() * ( 0.5 * body.linearVelocity().lengthSq() + 9.8 * body.position().y );
	return total;

}

// Starts the ragdoll and steps it, watching its joints, its energy and how fast it moves at the end.
function fall( ragdoll, { velocity = new Vector3(), seconds = 5, input = STILL } = {} ) {

	ragdoll.start( velocity );
	let widestGap = 0, widestToeGap = 0, gained = 0, fastestAtTheEnd = 0, last = null;
	const steps = Math.round( seconds / STEP ), start = energy( ragdoll );
	for ( let index = 1; index <= steps; index ++ ) {

		last = ragdoll.step( STEP, input, 0 );
		if ( index > 1 ) for ( const joint of ragdoll.joints ) {

			if ( TOES.includes( joint.joint.bone ) ) widestToeGap = Math.max( widestToeGap, gap( joint ) );
			else widestGap = Math.max( widestGap, gap( joint ) );

		}

		gained = Math.max( gained, energy( ragdoll ) - start );
		if ( index > steps - 120 ) for ( const body of ragdoll.bodies.values() ) fastestAtTheEnd = Math.max( fastestAtTheEnd, body.linearVelocity().length() );

	}

	return { widestGap, widestToeGap, gained, fastestAtTheEnd, last };

}

function assertLyingInOnePiece( ragdoll ) {

	const hips = ragdoll.bodies.get( HIPS ).position();
	for ( const [ name, body ] of ragdoll.bodies ) {

		const position = body.position();
		assert.ok( Number.isFinite( position.x + position.y + position.z ), name );
		assert.ok( position.y > - 0.05 && position.y < 0.6, `${name} at ${position.y} m` );
		assert.ok( position.distanceTo( hips ) < 1.2, `${name} ${position.distanceTo( hips )} m from the hips` );

	}

}

// An engine that makes nothing: it records what the ragdoll asks of it, and its bodies stand where they are made.
function recordingEngine() {

	const asked = { world: null, bodies: [], joints: [], kept: 0, steps: 0, fresh: 0, removed: 0 };
	const body = ( description ) => ( {
		description,
		position: () => description.position.clone(),
		rotation: () => description.rotation.clone(),
		linearVelocity: () => new Vector3(),
		angularVelocity: () => new Vector3(),
		inverseInertiaWorld: () => [ 1, 0, 0, 1, 0, 1 ],
		applyImpulse() {},
		applyAngularImpulse() {},
	} );
	return {
		asked,
		createDynamicWorld( description ) {

			asked.world = description;
			return {
				addBody: ( description ) => ( asked.bodies.push( description ), body( description ) ),
				addJoint: ( description ) => void asked.joints.push( description ),
				disableCollision: () => void asked.kept ++,
				step: () => void asked.steps ++,
				fresh: () => void asked.fresh ++,
				removeBody: () => void asked.removed ++,
				dispose() {},
			};

		},
	};

}

test( 'the Y Bot\'s ragdoll description: bodies on its bones, joined into one tree from the hips', async () => {

	const figure = await yBot();
	const bodies = new Set( DESCRIPTION.bodies.map( ( body ) => body.bone ) );

	assert.equal( bodies.size, DESCRIPTION.bodies.length );
	for ( const body of DESCRIPTION.bodies ) {

		assert.ok( bone( figure, body.bone )?.isBone, body.bone );
		assert.ok( body.mass > 0 && body.shapes.length > 0, body.bone );

	}

	// Every body but the hips hangs from exactly one joint, and following the parents from any body comes to the hips.
	const parentOf = new Map();
	for ( const joint of DESCRIPTION.joints ) {

		assert.ok( bodies.has( joint.bone ) && bodies.has( joint.parent ), joint.bone );
		assert.ok( ! parentOf.has( joint.bone ), `${joint.bone} hangs from two joints` );
		parentOf.set( joint.bone, joint.parent );
		for ( const axis of AXES ) assert.ok( joint[ axis ] === LOCKED || joint[ axis ] > 0, `${joint.bone} ${axis}` );
		assert.ok( AXES.some( ( axis ) => joint[ axis ] !== LOCKED ), `${joint.bone} turns about no axis` );

	}

	assert.equal( parentOf.size, bodies.size - 1 );
	for ( const name of bodies ) {

		let at = name;
		for ( let hops = 0; at !== HIPS && hops < bodies.size; hops ++ ) at = parentOf.get( at );
		assert.equal( at, HIPS, `${name} comes to the hips` );

	}

	for ( const item of DESCRIPTION.between ) assert.ok( ! bodies.has( item.bone ) && bodies.has( item.parent ) && bodies.has( item.child ), item.bone );

} );

test( 'the ragdoll asks its engine for a world of the course\'s ragdoll solids, then the bodies and joints as described, in order', async () => {

	const figure = await yBot();
	const physics = recordingEngine();
	const wall = boxSolid( { id: 'glass', position: [ 0, 1, 5 ], halfExtents: [ 1, 1, 0.1 ], groups: GROUPS.camera } );
	const { ragdoll } = ragdollFor( figure, { engine: physics, solids: [ FLOOR, wall ], tuning: { ragdollMassScale: 2 } } );
	const asked = physics.asked;

	assert.deepEqual( asked.world.solids, [ FLOOR ], 'only solids that block the ragdoll' );
	assert.deepEqual( [ asked.world.gravity.y, asked.world.iterations, asked.world.friction, asked.world.restitution ], [ - 9.8, 8, 0.7, 0.3 ] );

	ragdoll.start( new Vector3( 0, 0, 6 ) );

	assert.equal( asked.bodies.length, DESCRIPTION.bodies.length );
	asked.bodies.forEach( ( body, index ) => {

		const described = DESCRIPTION.bodies[ index ];
		assert.ok( body.position.distanceTo( bone( figure, described.bone ).getWorldPosition( new Vector3() ) ) < 1e-9, described.bone );
		assert.ok( apart( body.rotation, bone( figure, described.bone ).getWorldQuaternion( new Quaternion() ) ) < 1e-12, described.bone );
		assert.equal( body.linearVelocity.z, 6 );
		assert.deepEqual( [ body.linearDamping, body.angularDamping ], [ 0.25, 1.5 ] );
		assert.equal( body.continuous, [ CHEST, HIPS, HEAD ].includes( described.bone ), described.bone );
		for ( const shape of body.shapes ) {

			assert.equal( shape.density, body.shapes[ 0 ].density, 'one density through a body' );
			assert.deepEqual( [ shape.friction, shape.restitution ], [ 0.55, 0 ] );

		}

		// The body weighs its described mass, scaled: a capsule a cylinder and a ball, a box its half extents doubled.
		const weighed = body.shapes.reduce( ( total, { shape, density } ) => total + density * ( shape.kind === 'box' ?
			8 * shape.halfExtents.x * shape.halfExtents.y * shape.halfExtents.z :
			Math.PI * shape.radius ** 2 * 2 * shape.halfLength + 4 / 3 * Math.PI * shape.radius ** 3 ), 0 );
		assert.ok( Math.abs( weighed - described.mass * 2 ) < 1e-9, `${described.bone} weighs ${weighed}` );

	} );

	// A joint turning about one axis is a hinge about it, limited by the engine too; one turning about more is a ball.
	assert.equal( asked.joints.length, DESCRIPTION.joints.length );
	asked.joints.forEach( ( joint, index ) => {

		const described = DESCRIPTION.joints[ index ];
		const turning = AXES.filter( ( axis ) => described[ axis ] !== LOCKED );
		assert.equal( joint.body, ragdoll.bodies.get( described.bone ) );
		assert.equal( joint.parent, ragdoll.bodies.get( described.parent ) );
		assert.equal( joint.collide, false, 'a joint\'s two bodies never touch' );
		if ( turning.length === 1 ) {

			assert.equal( joint.kind, 'hinge', described.bone );
			assert.deepEqual( joint.limits, [ - described[ turning[ 0 ] ], described[ turning[ 0 ] ] ] );
			assert.equal( joint.center, described.center ?? 0 );
			assert.equal( joint.axis.toArray()[ AXES.indexOf( turning[ 0 ] ) ], 1 );

		} else assert.equal( joint.kind, 'ball', described.bone );

	} );

	assert.equal( asked.joints.filter( ( joint ) => joint.kind === 'hinge' ).length, 9 );
	assert.equal( asked.kept, 0, 'no pair is kept apart but the jointed ones' );

	// Stopping makes the world as made again: nothing is taken out body by body.
	ragdoll.stop();
	assert.deepEqual( [ asked.fresh, asked.removed ], [ 1, 0 ] );

} );

test( 'a body or a joint may have its own damping or limit spring; the rest take the description\'s', async () => {

	const figure = await yBot();
	figure.ragdoll = {
		...DESCRIPTION,
		bodies: DESCRIPTION.bodies.map( ( body ) => body.bone === LEFT_HAND ? { ...body, damping: { linear: 1, angular: 3 } } : body ),
		joints: DESCRIPTION.joints.map( ( joint ) => joint.bone === LEFT_HAND ? { ...joint, limitSpring: { stiffness: 80, damping: 8 } } : joint ),
	};
	const physics = recordingEngine();
	const { ragdoll } = ragdollFor( figure, { engine: physics } );
	ragdoll.start( new Vector3() );

	for ( const [ index, body ] of physics.asked.bodies.entries() ) {

		const own = figure.ragdoll.bodies[ index ].bone === LEFT_HAND;
		assert.deepEqual( [ body.linearDamping, body.angularDamping ], own ? [ 1, 3 ] : [ 0.25, 1.5 ] );

	}

	for ( const joint of ragdoll.joints ) assert.deepEqual( joint.limitSpring, joint.joint.bone === LEFT_HAND ? { stiffness: 80, damping: 8 } : { stiffness: 50, damping: 5 } );

} );

test( 'a figure with no body never goes limp', () => {

	const { ragdoll } = ragdollFor( new Figure() );
	ragdoll.start( new Vector3( 0, 0, 6 ) );

	assert.equal( ragdoll.active, false );
	assert.equal( ragdoll.bodies.size, 0 );

} );

// A fallen body at rest, on every engine: how far past its limits it may lie (°: a locked axis, one that turns), and
// how far from its rest place the chest may hang (m: its bend moves it; 1.5 cm is about 55° past the bend). The limits
// are springs worked before each step, which each engine's solver meets its own way, so one fall rests differently on
// each: within these bounds on all of them.
const AT_REST = { locked: 5, turning: 60, chest: 0.015 };

// The body on each engine: where it starts, how it falls and comes to rest, and that each fall starts in a world as
// made. The falls themselves differ from engine to engine.
for ( const [ engineName, engine ] of Object.entries( ENGINES ) ) {

	test( `${ engineName }: the ragdoll takes the body where the figure stands: 19 bodies on their bones, 18 joints closed, 83.7 kg`, async () => {

		const figure = await yBot();
		const { ragdoll } = ragdollFor( figure, { engine } );
		ragdoll.start( new Vector3() );

		assert.equal( ragdoll.active, true );
		assert.equal( ragdoll.bodies.size, 19 );
		assert.equal( ragdoll.joints.length, 18 );
		for ( const [ name, body ] of ragdoll.bodies ) {

			// The engine keeps a body's place in single precision.
			assert.ok( body.position().distanceTo( bone( figure, name ).getWorldPosition( new Vector3() ) ) < 1e-6, name );
			assert.ok( apart( body.rotation(), bone( figure, name ).getWorldQuaternion( new Quaternion() ) ) < 1e-6, name );

		}

		const mass = [ ...ragdoll.bodies.values() ].reduce( ( total, body ) => total + body.mass(), 0 );
		assert.ok( Math.abs( mass - 83.7 ) < 0.001, `mass ${mass}` );

		for ( const joint of ragdoll.joints ) {

			assert.ok( gap( joint ) < 1e-4, `${joint.joint.bone} pivots ${gap( joint )} m apart` );
			for ( const { locked, past } of pastLimits( joint ) ) if ( locked ) assert.ok( past < 0.01 * DEGREE, `${joint.joint.bone}: a locked axis at ${past / DEGREE}°` );

		}

		ragdoll.dispose();

	} );

	test( `${ engineName }: taking over a pose that bends the middle of the spine more than its share, the chest stays put and every joint starts closed`, async () => {

		const figure = await yBot();
		const chest = bone( figure, CHEST );
		bone( figure, SPINE_MIDDLE ).quaternion.multiply( new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), 30 * DEGREE ) );
		figure.root.updateMatrixWorld( true );
		const chestRotation = chest.getWorldQuaternion( new Quaternion() );

		const { ragdoll } = ragdollFor( figure, { engine } );
		ragdoll.start( new Vector3() );

		for ( const joint of ragdoll.joints ) assert.ok( gap( joint ) < 0.005, `${joint.joint.bone} pivots ${gap( joint )} m apart` );
		assert.ok( chest.getWorldQuaternion( new Quaternion() ).angleTo( chestRotation ) < 1e-6 );

		ragdoll.dispose();

	} );

	test( `${ engineName }: dropped on a floor, the body comes to rest in one piece, roughly within its limits, its bones on its bodies`, async () => {

		const figure = await yBot( { height: 1, yaw: 0.3 } );
		const { ragdoll } = ragdollFor( figure, { engine } );
		const { widestGap, widestToeGap, gained, fastestAtTheEnd, last } = fall( ragdoll );

		assertLyingInOnePiece( ragdoll );
		assert.ok( gained < 20, `the bodies gained ${gained} J` );
		assert.ok( fastestAtTheEnd < 0.3, `a body is moving at ${fastestAtTheEnd} m/s` );
		assert.ok( Math.max( widestGap, widestToeGap ) < 0.03, `a joint opened ${Math.max( widestGap, widestToeGap )} m` );

		const axes = ragdoll.joints.flatMap( ( joint ) => pastLimits( joint ).map( ( axis ) => ( { ...axis, bone: joint.joint.bone } ) ) );
		for ( const { locked, past, bone } of axes ) assert.ok( past < ( locked ? AT_REST.locked : AT_REST.turning ) * DEGREE, `${bone}: an axis ${past / DEGREE}° past its limit` );
		assert.ok( axes.filter( ( axis ) => axis.past > 2 * DEGREE ).length < axes.length / 4 );

		figure.root.updateMatrixWorld( true );
		for ( const name of [ HIPS, CHEST, HEAD, LEFT_HAND ] ) {

			assert.ok( bone( figure, name ).getWorldPosition( new Vector3() ).distanceTo( ragdoll.bodies.get( name ).position() ) < 1e-4, name );

		}

		// The middle of the spine sits at its place on the spine's body, and the chest hangs from it at its own length
		// (as near as its bend lets it: the chest turns about a point below its bone).
		const spine = ragdoll.bodies.get( SPINE );
		const between = DESCRIPTION.between.find( ( item ) => item.bone === SPINE_MIDDLE );
		const middle = new Vector3().fromArray( between.position ).applyQuaternion( spine.rotation() ).add( spine.position() );
		assert.ok( bone( figure, SPINE_MIDDLE ).getWorldPosition( new Vector3() ).distanceTo( middle ) < 1e-4 );
		const sampler = figure.sampler;
		assert.ok( bone( figure, CHEST ).position.distanceTo( sampler.rest[ sampler.index.get( CHEST ) ].position ) < AT_REST.chest );

		// The runner is half its height above the hips, moving with them, and faces the way the body lies: where the
		// hips' heading (up the spine) points, level, so roughly from the hips to the chest.
		const hips = ragdoll.bodies.get( HIPS ), chest = ragdoll.bodies.get( CHEST ).position();
		assert.ok( last.position.distanceTo( hips.position().add( new Vector3( 0, 0.9, 0 ) ) ) < 1e-12 );
		assert.ok( last.velocity.distanceTo( hips.linearVelocity() ) < 1e-12 );
		const heading = new Vector3().fromArray( DESCRIPTION.heading ).applyQuaternion( hips.rotation() );
		assert.equal( last.yaw, Math.atan2( heading.x, heading.z ) );
		const facing = new Vector3( Math.sin( last.yaw ), 0, Math.cos( last.yaw ) );
		assert.ok( chest.sub( hips.position() ).setY( 0 ).normalize().dot( facing ) > Math.cos( 45 * DEGREE ), `yaw ${last.yaw}` );

		ragdoll.dispose();

	} );

	test( `${ engineName }: thrown forward at a sprint, the body tumbles without coming apart and comes to rest`, async () => {

		const figure = await yBot( { height: 1.5, yaw: 0.3 } );
		const { ragdoll } = ragdollFor( figure, { engine } );
		const { widestGap, widestToeGap, gained, fastestAtTheEnd } = fall( ragdoll, { velocity: new Vector3( 0, 1, 6 ) } );

		assertLyingInOnePiece( ragdoll );
		assert.ok( gained < 20, `the bodies gained ${gained} J` );
		assert.ok( fastestAtTheEnd < 0.3, `a body is moving at ${fastestAtTheEnd} m/s` );
		assert.ok( widestGap < 0.05, `a joint opened ${widestGap} m` );
		assert.ok( widestToeGap < 0.12, `a toe's joint opened ${widestToeGap} m` );

		ragdoll.dispose();

	} );

	test( `${ engineName }: held, the limp move pushes the body along the stick under the view, and lifts it`, async () => {

		const hipsAfter = async ( input, viewYaw ) => {

			const { ragdoll } = ragdollFor( await yBot( { height: 1 } ), { engine } );
			ragdoll.start( new Vector3() );
			for ( let index = 0; index < 12; index ++ ) ragdoll.step( STEP, input, viewYaw );
			const velocity = ragdoll.bodies.get( HIPS ).linearVelocity();
			ragdoll.dispose();
			return velocity;

		};

		const still = await hipsAfter( STILL, Math.PI / 2 );
		const notHeld = await hipsAfter( { move: { x: 0, y: 1 }, held: () => false }, Math.PI / 2 );
		const pushed = await hipsAfter( { move: { x: 0, y: 1 }, held: ( action ) => action === 'limpMove' }, Math.PI / 2 );

		assert.deepEqual( notHeld.toArray(), still.toArray(), 'not held, the move does nothing' );
		// Forward under a view turned a quarter to the left is +x.
		assert.ok( pushed.x - still.x > 0.1, `pushed along x by ${pushed.x - still.x} m/s` );
		assert.ok( pushed.y - still.y > 0.1, `lifted by ${pushed.y - still.y} m/s` );
		assert.ok( Math.abs( pushed.z - still.z ) < 0.5 * ( pushed.x - still.x ) );

	} );

	test( `${ engineName }: every ragdoll starts in a world as made: the same pose thrown the same way falls the same way, after another ragdoll too`, async () => {

		const figure = await yBot( { height: 1.2, yaw: 0.3 } );
		const { ragdoll, motion } = ragdollFor( figure, { engine } );
		const pose = [];
		figure.model.traverse( ( node ) => pose.push( [ node, node.position.clone(), node.quaternion.clone() ] ) );

		const path = () => {

			for ( const [ node, position, quaternion ] of pose ) {

				node.position.copy( position );
				node.quaternion.copy( quaternion );

			}

			ragdoll.start( new Vector3( 1, 2, 4 ) );
			const hips = [];
			for ( let index = 0; index < 240; index ++ ) hips.push( ...ragdoll.step( STEP, STILL, 0 ).position.toArray() );
			ragdoll.stop();
			return hips;

		};

		const first = path(), second = path();
		assert.ok( first.every( ( value, index ) => Object.is( value, second[ index ] ) ), 'the two falls are the same, bit for bit' );

		// Stopping hands the body back to the motion with no move playing.
		assert.equal( ragdoll.active, false );
		assert.equal( ragdoll.bodies.size + ragdoll.joints.length, 0 );
		assert.deepEqual( motion.stops, [ [ undefined, 0 ], [ undefined, 0 ] ] );
		ragdoll.stop();
		assert.equal( motion.stops.length, 2, 'stopping again does nothing' );

		ragdoll.dispose();

	} );

}

// A body that stays where it is and keeps the angular impulses it is given; its inertia is 1 about every axis.
function standInBody( rotation = new Quaternion() ) {

	const body = {
		impulses: [],
		rotation: () => rotation.clone(),
		angularVelocity: () => new Vector3(),
		inverseInertiaWorld: () => [ 1, 0, 0, 1, 0, 1 ],
		applyAngularImpulse: ( impulse ) => body.impulses.push( new Vector3().copy( impulse ) ),
	};
	return body;

}

const SPRING = { stiffness: 50, damping: 5 };
const LINED_UP = { frame: [ 0, 0, 0, 1 ], parentFrame: [ 0, 0, 0, 1 ] };

// The impulse the limits' spring gives two bodies of unit inertia, standing still, for an error (N·m·s).
function springImpulse( error, stiffness, dt = STEP ) {

	const mass = 1 / 2, springTerm = mass * stiffness * dt * dt, damperTerm = mass * SPRING.damping * dt;
	return springTerm * error / ( 1 + ( springTerm + damperTerm ) * 2 ) / dt;

}

test( 'a joint within its limits and on its motor\'s pose is left alone', () => {

	const body = standInBody( new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.3 ) ), parent = standInBody();
	const joint = new JointLimits( { ...LINED_UP, twist: LOCKED, bendY: 0.5, bendZ: LOCKED, motor: [ 0, Math.sin( 0.15 ), 0, Math.cos( 0.15 ) ] }, body, parent, SPRING );
	joint.step( STEP, 150, 1 );

	joint.measure().angles.forEach( ( angle, axis ) => assert.ok( Math.abs( angle - [ 0, 0.3, 0 ][ axis ] ) < 1e-12, `${angle}` ) );
	assert.equal( body.impulses.length + parent.impulses.length, 0 );

} );

test( 'a joint bent past its limit is turned back, the two bodies equally and oppositely, as hard as its spring and the tuning say', () => {

	for ( const limitScale of [ 1, 2 ] ) {

		const body = standInBody( new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.7 ) ), parent = standInBody();
		new JointLimits( { ...LINED_UP, twist: LOCKED, bendY: 0.5, bendZ: LOCKED, motor: false }, body, parent, SPRING ).step( STEP, 150, limitScale );

		assert.equal( body.impulses.length, 1 );
		const expected = springImpulse( 0.2, SPRING.stiffness * limitScale );
		assert.ok( body.impulses[ 0 ].distanceTo( new Vector3( 0, - expected, 0 ) ) < 1e-9, `${body.impulses[ 0 ].toArray()} against ${expected}` );
		assert.deepEqual( parent.impulses[ 0 ].toArray(), body.impulses[ 0 ].clone().negate().toArray() );

	}

} );

test( 'a locked axis is pulled back as hard as a step allows: about half its error each step', () => {

	const body = standInBody( new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), 0.1 ) ), parent = standInBody();
	new JointLimits( { ...LINED_UP, twist: LOCKED, bendY: 0.5, bendZ: LOCKED, motor: false }, body, parent, SPRING ).step( STEP, 150, 1 );

	// The two bodies turn towards each other by both impulses over the step.
	const closing = 2 * body.impulses[ 0 ].x * STEP;
	assert.ok( closing < 0 && Math.abs( closing / 0.1 + 0.5 ) < 0.02, `closes ${- closing} of 0.1 rad in a step` );

} );

test( 'two limited bends make a cone: round when the limits are equal, elliptical otherwise', () => {

	const swing = ( axis, angle ) => new Quaternion().setFromAxisAngle( new Vector3( ...axis ).normalize(), angle );

	assert.equal( coneError( swing( [ 0, 0.6, 0.8 ], 0.3 ), 0.4, 0.4 ).angle, 0 );
	const round = coneError( swing( [ 0, 0.6, 0.8 ], 0.6 ), 0.4, 0.4 );
	assert.ok( Math.abs( round.angle - 0.2 ) < 1e-9 && round.axis.distanceTo( new Vector3( 0, 0.6, 0.8 ) ) < 1e-9 );

	// Elliptical: inside along the wide axis, outside along the narrow one by about the angle past the edge.
	assert.equal( coneError( swing( [ 0, 0, 1 ], 0.7 ), 0.3, 0.8 ).angle, 0 );
	const narrow = coneError( swing( [ 0, 1, 0 ], 0.5 ), 0.3, 0.8 );
	assert.ok( Math.abs( narrow.angle - Math.sin( 0.2 ) ) < 0.01, `${narrow.angle}` );
	assert.ok( Math.abs( narrow.axis.clone().normalize().y ) > 0.999, 'turned back about the axis it bent about' );

	// On a joint, the body swung out of the cone is turned back about the swing's axis.
	const body = standInBody( swing( [ 0, 0.6, 0.8 ], 0.6 ) ), parent = standInBody();
	new JointLimits( { ...LINED_UP, twist: 0.5, bendY: 0.4, bendZ: 0.4, motor: false }, body, parent, SPRING ).step( STEP, 150, 1 );
	assert.ok( body.impulses[ 0 ].clone().normalize().dot( new Vector3( 0, 0.6, 0.8 ) ) < - 0.999 );
	assert.ok( Math.abs( body.impulses[ 0 ].length() - springImpulse( 0.2, SPRING.stiffness ) ) < 1e-9 );

} );

test( 'the nearest point of an ellipse to one outside it lies on the ellipse, straight out from it', () => {

	const radii = new Vector2( 2, 1 );
	for ( const point of [ new Vector2( 3, 2 ), new Vector2( - 1, 4 ), new Vector2( 0.5, - 3 ), new Vector2( - 2.5, - 0.2 ) ] ) {

		const nearest = nearestOnEllipse( point, radii );
		assert.ok( Math.abs( ( nearest.x / radii.x ) ** 2 + ( nearest.y / radii.y ) ** 2 - 1 ) < 1e-3, `${nearest.toArray()} on the ellipse` );
		const out = point.clone().sub( nearest ).normalize(), normal = new Vector2( nearest.x / radii.x ** 2, nearest.y / radii.y ** 2 ).normalize();
		assert.ok( out.dot( normal ) > 0.999, `${point.toArray()}: ${out.dot( normal )}` );

	}

	assert.deepEqual( nearestOnEllipse( new Vector2( 5, 0 ), radii ).toArray(), [ 2, 0 ] );
	assert.deepEqual( nearestOnEllipse( new Vector2( 0, - 3 ), new Vector2( 1, 2 ) ).toArray(), [ 0, - 2 ] );

} );

test( 'the motor pulls each axis that turns towards its pose, and leaves the locked ones to the limits', () => {

	const body = standInBody(), parent = standInBody();
	const target = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.3 );
	new JointLimits( { ...LINED_UP, twist: LOCKED, bendY: 1, bendZ: LOCKED, motor: target.toArray() }, body, parent, SPRING ).step( STEP, 400, 1 );

	assert.equal( body.impulses.length, 1 );
	const impulse = body.impulses[ 0 ];
	assert.ok( impulse.y > 0 && Math.abs( impulse.x ) + Math.abs( impulse.z ) < 1e-12, `towards +0.3 rad about y: ${impulse.toArray()}` );

	// No motor: a joint left to hang.
	const loose = standInBody();
	new JointLimits( { ...LINED_UP, twist: LOCKED, bendY: 1, bendZ: LOCKED, motor: false }, loose, standInBody(), SPRING ).step( STEP, 400, 1 );
	assert.equal( loose.impulses.length, 0 );

} );
