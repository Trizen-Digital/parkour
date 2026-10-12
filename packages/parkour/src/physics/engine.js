// The physics engine as the game sees it. A backend package answers for one engine (@trizen/parkour-box3d,
// @trizen/parkour-rapier): query worlds (the world's solids; the catch volumes) that answer casts, overlaps,
// penetrations and rays, and a dynamic world (the ragdoll's) with bodies and joints. The game holds only solids, hits
// and bodies, never an engine's own objects, and each engine's conventions (how close a cast stops, what counts as
// starting in contact, how filters and object lifetimes work) stay inside its backend, so every backend keeps the same
// contract (the demo's tests/engine.test.mjs checks it). A backend extends the classes here.
//
// Vectors are { x, y, z } and rotations { x, y, z, w } (three.js's Vector3 and Quaternion are both); results are new
// Vector3s and Quaternions. Solids are plain descriptions (world/solids.js); a query gives back the solid it met.

// A method a backend leaves out fails loudly when asked.
function unanswered( what ) {

	throw new Error( `${ what }: not answered by this physics engine` );

}

/**
 * A shape a query sweeps or places. A capsule's half height runs from its centre to a tip, along its local Y.
 *
 * @typedef {{ kind: 'sphere', radius: number }
 *   | { kind: 'capsule', radius: number, halfHeight: number }
 *   | { kind: 'box', halfExtents: { x: number, y: number, z: number } }} Shape
 */

/** @typedef {import( '../world/solids.js' ).Solid} Solid */

/**
 * @typedef {Object} CastHit
 * @property {number} fraction How much of the way from `from` to `to` the shape went before it touched, 0 to 1.
 * @property {Vector3} point Where it touched, on the solid.
 * @property {Vector3} normal The solid's outward normal there, towards the shape (unit to the engine's precision).
 * @property {Solid} solid
 */

/**
 * @typedef {Object} Contact
 * @property {number} depth How far the shape is in; 0 when it only touches.
 * @property {Vector3} point The deepest point, on the solid.
 * @property {Vector3} normal The way out: the solid's outward normal there, towards the shape.
 * @property {Solid} solid
 */

/**
 * @typedef {Object} RayHit
 * @property {number} distance How far along the ray.
 * @property {Vector3} point
 * @property {Vector3} normal The solid's outward normal there.
 * @property {Solid} solid
 */

/**
 * A static world of solids that answers questions and never changes: the same solids, added in the same order, give
 * the same answers on every run. A query sees a solid when `solid.groups & group`; with no group it sees them all.
 */
class QueryWorld {

	/**
	 * The first solid the shape meets as its centre moves from `from` to `to` without turning. With
	 * `stopAtPenetration` (probes) a solid the shape starts in is met at fraction 0; without it (movement) a solid it
	 * starts in is passed over while the motion takes the shape out of it.
	 *
	 * @param {Shape} shape
	 * @param {Vector3} from
	 * @param {Vector3} to Not `from`: a shape that does not move asks `penetration`.
	 * @param {{ group?: number, rotation?: Quaternion, stopAtPenetration?: boolean }} [options]
	 * @return {CastHit|null}
	 */
	cast( shape, from, to, options ) {

		unanswered( 'QueryWorld.cast' );

	}

	/**
	 * Every solid the shape overlaps by more than `minDepth`; at 0, touching counts.
	 *
	 * @param {Shape} shape
	 * @param {Vector3} at
	 * @param {{ group?: number, rotation?: Quaternion, minDepth?: number }} [options]
	 * @return {Solid[]}
	 */
	overlap( shape, at, options ) {

		unanswered( 'QueryWorld.overlap' );

	}

	/**
	 * The deepest contact of a shape placed at a point: one it is inside (depth > 0), or with `touching` also one it
	 * only touches. Of equally deep contacts, the first solid added.
	 *
	 * @param {Shape} shape
	 * @param {Vector3} at
	 * @param {{ group?: number, rotation?: Quaternion, touching?: boolean }} [options]
	 * @return {Contact|null}
	 */
	penetration( shape, at, options ) {

		unanswered( 'QueryWorld.penetration' );

	}

	/**
	 * The first solid along a ray. A ray that starts inside a solid hits it at 0.
	 *
	 * @param {Vector3} origin
	 * @param {Vector3} direction Unit.
	 * @param {number} distance
	 * @param {{ group?: number }} [options]
	 * @return {RayHit|null}
	 */
	ray( origin, direction, distance, options ) {

		unanswered( 'QueryWorld.ray' );

	}

	dispose() {}

}

/**
 * A body in a dynamic world.
 */
class Body {

	/** @return {Vector3} */
	position() {

		unanswered( 'Body.position' );

	}

	/** @return {Quaternion} */
	rotation() {

		unanswered( 'Body.rotation' );

	}

	/** @return {Vector3} */
	linearVelocity() {

		unanswered( 'Body.linearVelocity' );

	}

	/** @return {Vector3} */
	angularVelocity() {

		unanswered( 'Body.angularVelocity' );

	}

	/** @return {number} kg, from its shapes' densities */
	mass() {

		unanswered( 'Body.mass' );

	}

	/**
	 * The inverse of its inertia tensor in world space (symmetric, so six numbers).
	 *
	 * @return {number[]} [ m11, m12, m13, m22, m23, m33 ]
	 */
	inverseInertiaWorld() {

		unanswered( 'Body.inverseInertiaWorld' );

	}

	/**
	 * Pushes the body at its centre of mass, waking it.
	 *
	 * @param {Vector3} impulse N·s
	 */
	applyImpulse( impulse ) {

		unanswered( 'Body.applyImpulse' );

	}

	/**
	 * Turns the body, waking it.
	 *
	 * @param {Vector3} impulse N·m·s
	 */
	applyAngularImpulse( impulse ) {

		unanswered( 'Body.applyAngularImpulse' );

	}

}

/**
 * A world that simulates bodies among static solids. What it does next depends on everything that happened in it
 * before, on every engine, so a run that wants the same outcome every time starts from `fresh()`.
 */
class DynamicWorld {

	/**
	 * Back to the world as it was made: the static solids, no bodies, never stepped. Bodies from before are gone.
	 */
	fresh() {

		unanswered( 'DynamicWorld.fresh' );

	}

	/**
	 * A moving body made of shapes. Its mass, centre of mass and inertia come from the shapes' densities. A capsule
	 * here is the body description's: `halfLength` is half its straight middle, along the shape's local Y.
	 *
	 * @param {{ position: Vector3, rotation: Quaternion, linearVelocity: Vector3, linearDamping: number,
	 *   angularDamping: number, continuous: boolean, shapes: { shape: { kind: 'capsule', radius: number,
	 *   halfLength: number } | { kind: 'box', halfExtents: Vector3 }, offset: Vector3, rotation: Quaternion,
	 *   density: number, friction: number, restitution: number }[] }} description `continuous`: swept between
	 *   steps, so a fast thin body does not pass through a solid.
	 * @return {Body}
	 */
	addBody( description ) {

		unanswered( 'DynamicWorld.addBody' );

	}

	/**
	 * Joins a body to its parent where `anchor` (in the body) meets `parentAnchor` (in the parent). A ball joint
	 * turns freely; a hinge turns only about `axis` of the joint frames (`frame` in the body, `parentFrame` in the
	 * parent), and with `limits` only between those angles, measured from the parent's frame turned by `center` about
	 * the axis. `collide: false`: the two never touch.
	 *
	 * @param {{ kind: 'ball' | 'hinge', body: Body, parent: Body, anchor: Vector3, parentAnchor: Vector3,
	 *   frame?: Quaternion, parentFrame?: Quaternion, axis?: Vector3, limits?: number[], center?: number,
	 *   collide?: boolean }} description
	 */
	addJoint( description ) {

		unanswered( 'DynamicWorld.addJoint' );

	}

	/**
	 * No contacts between two bodies.
	 *
	 * @param {Body} a
	 * @param {Body} b
	 */
	disableCollision( a, b ) {

		unanswered( 'DynamicWorld.disableCollision' );

	}

	/**
	 * @param {number} dt s
	 */
	step( dt ) {

		unanswered( 'DynamicWorld.step' );

	}

	/**
	 * Takes a body out, with its joints.
	 *
	 * @param {Body} body
	 */
	removeBody( body ) {

		unanswered( 'DynamicWorld.removeBody' );

	}

	dispose() {}

}

/**
 * One engine: it makes the worlds.
 */
class PhysicsEngine {

	/**
	 * @param {string} name
	 */
	constructor( name ) {

		this.name = name;

	}

	/**
	 * A query world of solids, added in the order given.
	 *
	 * @param {Solid[]} solids
	 * @return {QueryWorld}
	 */
	createQueryWorld( solids ) {

		unanswered( 'PhysicsEngine.createQueryWorld' );

	}

	/**
	 * A dynamic world with these solids as its static ground, added in the order given, all with one friction and
	 * restitution.
	 *
	 * @param {{ gravity: Vector3, iterations: number, solids: Solid[], friction: number,
	 *   restitution: number }} description `iterations`: the solver's passes over the contacts and joints each step.
	 * @return {DynamicWorld}
	 */
	createDynamicWorld( description ) {

		unanswered( 'PhysicsEngine.createDynamicWorld' );

	}

}

/**
 * A physics engine as a backend package gives it (@trizen/parkour-box3d, @trizen/parkour-rapier): its name, which runs
 * and replays record, and how to load it. Loading is slow the first time (the engine's WebAssembly), so a run loads
 * its engine once while it loads.
 *
 * @typedef {{ name: string, load: () => Promise<PhysicsEngine> }} Backend
 */

export { QueryWorld, Body, DynamicWorld, PhysicsEngine };
