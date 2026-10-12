import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { Body, DynamicWorld, PhysicsEngine, QueryWorld } from '@trizen/parkour/physics/engine.js';

// The engine interface on Rapier (rapier3d-compat, its WebAssembly inlined). Rapier keeps the contract as it is: a
// cast is Rapier's shape cast (its time of impact, witness point and normal), a ray is solid, a penetration is the
// deepest of Rapier's contacts at no prediction distance. Groups are Rapier's interaction groups: a solid is a member
// of the groups it blocks and a query filters on its own, so filtering costs nothing in the broad phase.

const IDENTITY = Object.freeze( { x: 0, y: 0, z: 0, w: 1 } );

// Rapier's interaction groups: 16 membership bits over 16 filter bits; all of them.
const ALL = 0xffff;

// Rapier's hinge turns about its joint frame's X axis.
const HINGE_AXIS = new Vector3( 1, 0, 0 );

// A query is a member of every group and filters on its own; with no group it sees every solid.
function queryGroups( group ) {

	return group === undefined ? undefined : ( ( ALL << 16 ) | group ) >>> 0;

}

function shapeOf( shape ) {

	switch ( shape.kind ) {

		case 'sphere': return new RAPIER.Ball( shape.radius );
		// Rapier's capsule is half its straight middle and the radius.
		case 'capsule': return new RAPIER.Capsule( Math.max( 0, shape.halfHeight - shape.radius ), shape.radius );
		case 'box': return new RAPIER.Cuboid( shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z );

	}

	throw new Error( `no query shape '${ shape.kind }'` );

}

// A solid as a fixed collider (null for a hull Rapier finds flat or degenerate: it then holds nothing).
function colliderOf( solid ) {

	if ( solid.shape.kind === 'box' ) {

		const [ x, y, z ] = solid.shape.halfExtents;
		const [ qx, qy, qz, qw ] = solid.rotation;

		return RAPIER.ColliderDesc.cuboid( x, y, z ).setTranslation( ...solid.position ).setRotation( { x: qx, y: qy, z: qz, w: qw } );

	}

	return RAPIER.ColliderDesc.convexHull( new Float32Array( solid.shape.points ) );

}

class RapierQueryWorld extends QueryWorld {

	#world = new RAPIER.World( { x: 0, y: 0, z: 0 } );

	// The solid behind each collider, by collider handle.
	#solids = new Map();

	constructor( solids ) {

		super();

		for ( const solid of solids ) {

			const description = colliderOf( solid );

			if ( ! description ) continue;
			description.setCollisionGroups( ( ( solid.groups << 16 ) | ALL ) >>> 0 );
			this.#solids.set( this.#world.createCollider( description ).handle, solid );

		}

		// Rapier's queries only see colliders once a step has put them in its broad phase.
		this.#world.step();

	}

	cast( shape, from, to, { group, rotation = IDENTITY, stopAtPenetration = true } = {} ) {

		const motion = new Vector3().subVectors( to, from );
		const hit = this.#world.castShape( from, rotation, motion, shapeOf( shape ), 0, 1, stopAtPenetration, undefined, queryGroups( group ) );

		if ( ! hit ) return null;

		return {
			fraction: hit.time_of_impact,
			point: new Vector3().copy( hit.witness1 ),
			normal: new Vector3().copy( hit.normal1 ),
			solid: this.#solids.get( hit.collider.handle )
		};

	}

	overlap( shape, at, { group, rotation = IDENTITY, minDepth = 0 } = {} ) {

		const query = shapeOf( shape );
		const solids = [];

		this.#world.intersectionsWithShape( at, rotation, query, ( collider ) => {

			if ( minDepth > 0 ) {

				const contact = collider.contactShape( query, at, rotation, 0 );

				if ( ! contact || - contact.distance <= minDepth ) return true;

			}

			solids.push( this.#solids.get( collider.handle ) );

			return true;

		}, undefined, queryGroups( group ) );

		return solids;

	}

	penetration( shape, at, { group, rotation = IDENTITY, touching = false } = {} ) {

		const query = shapeOf( shape );
		let deepest = null;

		this.#world.intersectionsWithShape( at, rotation, query, ( collider ) => {

			const contact = collider.contactShape( query, at, rotation, 0 );

			if ( contact && ( deepest ? contact.distance < deepest.contact.distance : touching ? contact.distance <= 0 : contact.distance < 0 ) ) deepest = { contact, collider };

			return true;

		}, undefined, queryGroups( group ) );

		if ( ! deepest ) return null;

		const { contact, collider } = deepest;

		return {
			depth: - contact.distance,
			point: new Vector3().copy( contact.point1 ),
			normal: new Vector3().copy( contact.normal1 ),
			solid: this.#solids.get( collider.handle )
		};

	}

	ray( origin, direction, distance, { group } = {} ) {

		// A solid ray: one that starts inside a collider hits it at 0.
		const hit = this.#world.castRayAndGetNormal( new RAPIER.Ray( origin, direction ), distance, true, undefined, queryGroups( group ) );

		if ( ! hit ) return null;

		return {
			distance: hit.timeOfImpact,
			point: new Vector3().copy( origin ).addScaledVector( direction, hit.timeOfImpact ),
			normal: new Vector3().copy( hit.normal ),
			solid: this.#solids.get( hit.collider.handle )
		};

	}

	dispose() {

		this.#world.free();

	}

}

// Each body's Rapier rigid body, kept here so no game code can reach it.
const rigidBodies = new WeakMap();

class RapierBody extends Body {

	constructor( rigid ) {

		super();
		rigidBodies.set( this, rigid );

	}

	get #rigid() {

		return rigidBodies.get( this );

	}

	position() {

		return new Vector3().copy( this.#rigid.translation() );

	}

	rotation() {

		return new Quaternion().copy( this.#rigid.rotation() );

	}

	linearVelocity() {

		return new Vector3().copy( this.#rigid.linvel() );

	}

	angularVelocity() {

		return new Vector3().copy( this.#rigid.angvel() );

	}

	mass() {

		return this.#rigid.mass();

	}

	inverseInertiaWorld() {

		const m = this.#rigid.effectiveWorldInvInertia();

		return [ m.m11, m.m12, m.m13, m.m22, m.m23, m.m33 ];

	}

	applyImpulse( impulse ) {

		this.#rigid.applyImpulse( impulse, true );

	}

	applyAngularImpulse( impulse ) {

		this.#rigid.applyTorqueImpulse( impulse, true );

	}

}

function pairKey( a, b ) {

	return a < b ? `${ a }|${ b }` : `${ b }|${ a }`;

}

class RapierDynamicWorld extends DynamicWorld {

	#world;

	// The world as made, to come back to: a world Rapier restores from a snapshot goes on exactly as the one taken.
	#made;

	#iterations;

	// Whether anything has happened since the world was made (or last made fresh).
	#touched = false;

	// Body pairs that never touch, by rigid body handles. Every body's colliders ask Rapier's contact filter hook,
	// but Rapier consults it only when it steps with an event queue: the world steps with one once a pair is apart.
	#apart = new Set();

	#events = null;

	#hooks = {
		filterContactPair: ( collider1, collider2, body1, body2 ) => this.#apart.has( pairKey( body1, body2 ) ) ? null : RAPIER.SolverFlags.COMPUTE_IMPULSE,
		filterIntersectionPair: () => true
	};

	constructor( { gravity, iterations, solids, friction, restitution } ) {

		super();

		this.#world = new RAPIER.World( gravity );
		this.#world.numSolverIterations = iterations;
		this.#iterations = iterations;

		for ( const solid of solids ) {

			const description = colliderOf( solid );

			if ( description ) this.#world.createCollider( description.setFriction( friction ).setRestitution( restitution ) );

		}

		this.#made = this.#world.takeSnapshot();

	}

	fresh() {

		if ( ! this.#touched ) return;

		this.#world.free();
		this.#world = RAPIER.World.restoreSnapshot( this.#made );
		this.#world.numSolverIterations = this.#iterations;
		this.#apart.clear();
		this.#touched = false;

	}

	addBody( { position, rotation, linearVelocity, linearDamping, angularDamping, continuous, shapes } ) {

		this.#touched = true;

		const rigid = this.#world.createRigidBody( RAPIER.RigidBodyDesc.dynamic()
			.setTranslation( position.x, position.y, position.z )
			.setRotation( rotation )
			.setLinearDamping( linearDamping )
			.setAngularDamping( angularDamping )
			.setCcdEnabled( continuous )
			.setLinvel( linearVelocity.x, linearVelocity.y, linearVelocity.z ) );

		for ( const part of shapes ) {

			const description = part.shape.kind === 'capsule' ?
				RAPIER.ColliderDesc.capsule( part.shape.halfLength, part.shape.radius ) :
				RAPIER.ColliderDesc.cuboid( part.shape.halfExtents.x, part.shape.halfExtents.y, part.shape.halfExtents.z );

			description
				.setTranslation( part.offset.x, part.offset.y, part.offset.z )
				.setRotation( part.rotation )
				.setDensity( part.density )
				.setFriction( part.friction )
				.setRestitution( part.restitution )
				.setActiveHooks( RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS );
			this.#world.createCollider( description, rigid );

		}

		return new RapierBody( rigid );

	}

	addJoint( { kind, body, parent, anchor, parentAnchor, frame = IDENTITY, parentFrame = IDENTITY, axis, limits, center = 0, collide = true } ) {

		this.#touched = true;

		const hinge = kind === 'hinge';
		const data = hinge ?
			RAPIER.JointData.revoluteWithAxes( anchor, parentAnchor, new Vector3().copy( axis ).applyQuaternion( frame ), new Vector3().copy( axis ).applyQuaternion( parentFrame ) ) :
			RAPIER.JointData.spherical( anchor, parentAnchor );
		const joint = this.#world.createImpulseJoint( data, rigidBodies.get( body ), rigidBodies.get( parent ), true );

		if ( hinge && limits ) {

			// Rapier measures a hinge's angle about its frames' X: turn X onto the axis in both frames, and the
			// parent's about the axis to where the limits are centred.
			const turn = new Quaternion().setFromUnitVectors( HINGE_AXIS, axis );

			joint.setFrameX1( new Quaternion().copy( frame ).multiply( turn ) );
			joint.setFrameX2( new Quaternion().copy( parentFrame ).multiply( new Quaternion().setFromAxisAngle( axis, center ) ).multiply( turn ) );
			joint.setLimits( limits[ 0 ], limits[ 1 ] );

		}

		joint.setContactsEnabled( collide );

	}

	disableCollision( a, b ) {

		this.#apart.add( pairKey( rigidBodies.get( a ).handle, rigidBodies.get( b ).handle ) );
		this.#events ??= new RAPIER.EventQueue( true );

	}

	step( dt ) {

		this.#touched = true;
		this.#world.timestep = dt;
		if ( this.#apart.size ) this.#world.step( this.#events, this.#hooks );
		else this.#world.step();

	}

	removeBody( body ) {

		this.#world.removeRigidBody( rigidBodies.get( body ) );

	}

	dispose() {

		this.#world.free();
		this.#events?.free();

	}

}

class RapierEngine extends PhysicsEngine {

	constructor() {

		super( 'rapier' );

	}

	createQueryWorld( solids ) {

		return new RapierQueryWorld( solids );

	}

	createDynamicWorld( description ) {

		return new RapierDynamicWorld( description );

	}

}

let loading = null;

/**
 * Loads Rapier's WebAssembly, once: every caller shares the engine.
 *
 * @return {Promise<RapierEngine>}
 */
function load() {

	loading ??= RAPIER.init().then( () => new RapierEngine() );

	return loading;

}

export { load };
