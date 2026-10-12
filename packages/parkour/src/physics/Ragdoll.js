import { Quaternion, Vector3 } from 'three';
import { clamp } from '../math.js';
import { GRAVITY } from '../sim/tuning.js';
import { GROUPS } from '../world/solids.js';
import { AXES, AXIS, JointLimits, LOCKED } from './jointLimits.js';

// The ragdoll: when the runner bails, the figure goes limp. Its bones become bodies joined at the joints (the figure's
// ragdoll description, src/data/ybot-ragdoll.json), thrown with the runner's velocity among the course's solids; the
// bones follow the bodies, and the runner follows the hips, until the runner gets up (runner/Bail.js) and the motion
// has the body again.
//
// The ragdoll's dynamic world is made once, with the course, and is as made whenever no ragdoll is active: stopping
// puts it back (DynamicWorld.fresh), because what a world does next depends on everything that happened in it before.
// So the same pose thrown the same way always falls the same way, and no snapshot ever holds engine state: one taken
// while a ragdoll is active cannot be restored (sim/snapshot.js), and the world is kept where no snapshot looks.
//
// The engine joins the bodies; how far each joint turns, and the pull towards a pose that keeps the body from going
// slack, are ours (jointLimits.js), worked before each step of the world.

// The solver's passes over the contacts and joints each step: enough for a chain of 19 bodies to hold together.
const SOLVER_ITERATIONS = 8;

// The course's solids as the ragdoll meets them: a little rough, a little bouncy (contacts take the mean of the two
// materials').
const GROUND = { friction: 0.7, restitution: 0.3 };

// While limp, the runner is half its capsule's height above the hips, as if standing there: the get-up looks for the
// floor straight down from the hips.
const ABOVE_HIPS = new Vector3( 0, 0.9, 0 );

// Held while limp, the move pushes the hips along the stick (turned by the view) and lifts them, so a player can roll
// the body or drag it off a ledge: the push and the lift, as forces (N).
const LIMP_PUSH = 255;
const LIMP_LIFT = 355;

const vector = ( values ) => new Vector3().fromArray( values );
const quaternion = ( values ) => new Quaternion().fromArray( values );

// The pose motor's stiffness (1/s²) from the hips' speed: 150 below 0.5 m/s, rising to 1000 at 10 m/s, so a tumble
// keeps the body's shape and a body coming to rest lies loose.
function motorStiffness( speed ) {

	return 150 + clamp( ( speed - 0.5 ) / 9.5, 0, 1 ) * 850;

}

// The limp push for a step of the move (x right, y forward) under the view's yaw, as a force (N).
function limpPush( move, yaw ) {

	return new Vector3(
		( Math.sin( yaw ) * move.y - Math.cos( yaw ) * move.x ) * LIMP_PUSH,
		LIMP_LIFT,
		( Math.cos( yaw ) * move.y + Math.sin( yaw ) * move.x ) * LIMP_PUSH
	);

}

// The room a body's shapes take up (m³), each counted whole, as an engine weighs them: a capsule is a cylinder
// between two half spheres, a box twice its half extents each way.
function volumeOf( shapes ) {

	let volume = 0;

	for ( const shape of shapes ) {

		if ( shape.kind === 'box' ) {

			const [ x, y, z ] = shape.halfExtents;
			volume += 8 * x * y * z;

		} else {

			const r = shape.radius;
			volume += Math.PI * r * r * 2 * shape.halfLength + ( 4 / 3 ) * Math.PI * r * r * r;

		}

	}

	return volume;

}

// A body's shape as the engine takes it: a capsule as described, a box's half extents as a vector.
function shapeOf( shape ) {

	return shape.kind === 'box' ?
		{ kind: 'box', halfExtents: vector( shape.halfExtents ) } :
		{ kind: 'capsule', radius: shape.radius, halfLength: shape.halfLength };

}

// Turns a bone so it faces `rotation` in the world, under its parent as the parent stands now.
function turnTo( bone, rotation ) {

	bone.quaternion.copy( bone.parent.getWorldQuaternion( new Quaternion() ).invert().multiply( rotation ) );
	bone.updateMatrixWorld( true );

}

// Puts a bone at `position` facing `rotation` in the world.
function placeBone( bone, position, rotation ) {

	bone.parent.updateWorldMatrix( true, false );
	bone.position.copy( bone.parent.worldToLocal( position ) );
	turnTo( bone, rotation );

}

/**
 * The figure's body gone limp: bodies and joints in a dynamic world of the course's solids.
 */
class Ragdoll {

	// The dynamic world: the course's solids, and while active the ragdoll's bodies. Private, so no snapshot walks it.
	#world = null;

	// The figure's bones the ragdoll moves, by name.
	#bones = new Map();

	// Each bone the ragdoll poses, parents before their children: on its body, or (`between`) between two.
	#posed = [];

	/**
	 * @param {Object} parts
	 * @param {PhysicsEngine} parts.engine
	 * @param {Solid[]} parts.solids The course's solids; those in the ragdoll's collision group are its ground.
	 * @param {Tuning} parts.tuning
	 * @param {Motion} parts.motion Handed the body back when the ragdoll stops.
	 * @param {Figure} parts.figure Its `ragdoll` describes the bodies and joints; a figure without one never goes
	 *   limp (the timing-only figure).
	 */
	constructor( { engine, solids, tuning, motion, figure } ) {

		this.tuning = tuning;
		this.motion = motion;
		this.figure = figure;

		/** The ragdoll description (src/data/ybot-ragdoll.json), or null. */
		this.description = figure.ragdoll;

		/** Whether the ragdoll has the body. */
		this.active = false;

		/** @type {Map<string, Body>} while active, each body by its bone's name */
		this.bodies = new Map();

		/** @type {JointLimits[]} while active, each joint in the description's order */
		this.joints = [];

		if ( ! this.description ) return;

		this.#world = engine.createDynamicWorld( {
			gravity: new Vector3( 0, - GRAVITY, 0 ),
			iterations: SOLVER_ITERATIONS,
			solids: solids.filter( ( solid ) => solid.groups & GROUPS.ragdoll ),
			...GROUND,
		} );

		const between = new Map( this.description.between.map( ( item ) => [ item.bone, item ] ) );
		const bodies = new Set( this.description.bodies.map( ( body ) => body.bone ) );

		figure.model.traverse( ( bone ) => {

			if ( ! bone.isBone || ! ( bodies.has( bone.name ) || between.has( bone.name ) ) ) return;
			this.#posed.push( { bone, between: between.get( bone.name ) } );
			this.#bones.set( bone.name, bone );

		} );

	}

	/**
	 * Hands the body to the ragdoll: a body for each described bone where the figure has it posed now, each moving at
	 * `velocity`, joined as described.
	 *
	 * @param {Vector3} velocity m/s
	 */
	start( velocity ) {

		if ( this.active || ! this.description ) return;

		const description = this.description;
		const massScale = this.tuning.values.ragdollMassScale;

		this.figure.root.updateMatrixWorld( true );
		this.placeBetween();

		for ( const body of description.bodies ) {

			const bone = this.#bones.get( body.bone );
			const damping = body.damping ?? description.damping;
			// The body's mass (kg, scaled by the tuning) spread evenly through its shapes.
			const density = body.mass / volumeOf( body.shapes ) * massScale;

			this.bodies.set( body.bone, this.#world.addBody( {
				position: bone.getWorldPosition( new Vector3() ),
				rotation: bone.getWorldQuaternion( new Quaternion() ),
				linearVelocity: velocity,
				linearDamping: damping.linear,
				angularDamping: damping.angular,
				continuous: body.continuous === true,
				shapes: body.shapes.map( ( shape ) => ( {
					shape: shapeOf( shape ),
					offset: vector( shape.offset ),
					rotation: quaternion( shape.rotation ),
					density,
					...description.material,
				} ) ),
			} ) );

		}

		for ( const joint of description.joints ) this.join( joint );

		this.active = true;

	}

	// A bone between two bodies (the middle of the spine) has no body of its own. Before the bodies are made, it is
	// turned its share of the way from the parent's pose to the child's, and the child turned back to where it was, so
	// the child's body starts on its joint with the parent's whatever the animation did to the middle.
	placeBetween() {

		for ( const item of this.description.between ) {

			const bone = this.#bones.get( item.bone ), parent = this.#bones.get( item.parent ), child = this.#bones.get( item.child );
			const childRotation = child.getWorldQuaternion( new Quaternion() );
			const onParent = parent.getWorldQuaternion( new Quaternion() ).multiply( quaternion( item.parentRotation ) );
			const onChild = childRotation.clone().multiply( quaternion( item.childRotation ) );

			turnTo( bone, onParent.slerp( onChild, item.share ) );
			turnTo( child, childRotation );

		}

	}

	// Joins a bone's body to its parent's. With one axis turning the engine's joint is a hinge about it, which the
	// engine also keeps within that axis's limit (either way of `center`, the middle of the hinge's range, measured
	// from the parent's frame); with more, a ball, whose limits are all ours.
	join( joint ) {

		const body = this.bodies.get( joint.bone ), parent = this.bodies.get( joint.parent );
		const limits = new JointLimits( joint, body, parent, joint.limitSpring ?? this.description.limitSpring );
		const turning = AXES.filter( ( axis ) => joint[ axis ] !== LOCKED );
		const hinge = turning.length === 1 ? turning[ 0 ] : null;

		this.#world.addJoint( {
			kind: hinge ? 'hinge' : 'ball',
			body, parent,
			anchor: vector( joint.anchor ), parentAnchor: vector( joint.parentAnchor ),
			frame: limits.frame, parentFrame: limits.parentFrame,
			...( hinge && { axis: AXIS[ hinge ].clone(), limits: [ - joint[ hinge ], joint[ hinge ] ], center: joint.center ?? 0 } ),
			// Two jointed bodies overlap where they meet: contacts between them would only fight the joint.
			collide: false,
		} );
		this.joints.push( limits );

	}

	/**
	 * One step of the limp body: the joints' limits and motors, the limp push, the world's step, the bones on the
	 * bodies.
	 *
	 * @param {number} dt s
	 * @param {Input} input `limpMove` held pushes the body along `move`.
	 * @param {number} viewYaw The view's yaw, which turns the push.
	 * @return {{ position: Vector3, velocity: Vector3, yaw: number }} where the runner is (half its height above the
	 *   hips), its velocity (the hips') and its yaw (the way the body lies)
	 */
	step( dt, input, viewYaw ) {

		const values = this.tuning.values;
		const hips = this.bodies.get( this.figure.roles.hips );
		const motor = motorStiffness( hips.linearVelocity().length() ) * values.ragdollMotorScale;

		for ( const joint of this.joints ) joint.step( dt, motor, values.ragdollLimitScale );

		if ( input.held( 'limpMove' ) ) hips.applyImpulse( limpPush( input.move, viewYaw ).multiplyScalar( dt ) );

		this.#world.step( dt );
		this.poseBones();

		// The description's heading is the way the body faces in the hips' frame: along the spine, so a body lying on
		// the ground gives the runner its direction.
		const heading = vector( this.description.heading ).applyQuaternion( hips.rotation() );

		return {
			yaw: Math.atan2( heading.x, heading.z ),
			position: hips.position().add( ABOVE_HIPS ),
			velocity: hips.linearVelocity(),
		};

	}

	// The bones on the bodies, parents first (each is placed under its parent as just placed).
	poseBones() {

		for ( const { bone, between } of this.#posed ) {

			const body = this.bodies.get( bone.name );
			const { position, rotation } = between ? this.betweenPose( between ) : { position: body.position(), rotation: body.rotation() };

			placeBone( bone, position, rotation );

		}

	}

	// A bone between two bodies: at its place on the parent's body, turned its share of the way to the child's.
	betweenPose( item ) {

		const parent = this.bodies.get( item.parent ), child = this.bodies.get( item.child );
		const parentRotation = parent.rotation();
		const onParent = parentRotation.clone().multiply( quaternion( item.parentRotation ) );
		const onChild = child.rotation().multiply( quaternion( item.childRotation ) );

		return {
			position: vector( item.position ).applyQuaternion( parentRotation ).add( parent.position() ),
			rotation: onParent.slerp( onChild, item.share ),
		};

	}

	/**
	 * Hands the body back: the bodies go and the world is as made again. The motion takes over afresh: whatever move
	 * was playing when the body went limp is over.
	 */
	stop() {

		if ( ! this.active ) return;

		this.#world.fresh();
		this.bodies.clear();
		this.joints.length = 0;
		this.active = false;

		this.motion.moves.stop( undefined, 0 );

	}

	/** Frees the ragdoll's world for good. */
	dispose() {

		this.#world?.dispose();

	}

}

export { Ragdoll };
