import { GROUPS, faceNormal } from '../world/solids.js';

// The game's questions about the course: a shape swept along a path, a shape placed at a point, a ray, asked of the
// course's query world by group name ('movement', 'probe', 'camera', 'ragdoll'). A hit says where the shape touched,
// where its centre was then, the contact normal and the face it met (`faceNormal`, worked out from the solid's own
// faces, so it is the same on every engine), how far along the path, whether the shape started inside, and the solid.

// A sweep that starts in contact counts as starting inside only when the shape is more than 0.1 mm in: a capsule
// resting on a floor merely touches it.
const INSIDE = 0.0001;

/**
 * @typedef {Object} Hit
 * @property {Vector3} point Where the shape touched, on the solid.
 * @property {Vector3} centre The shape's centre then.
 * @property {Vector3} normal The contact normal, out of the solid, unit.
 * @property {Vector3} faceNormal The normal of the solid's face the shape met.
 * @property {number} fraction How much of the sweep the shape went, 0 to 1.
 * @property {number} distance How far its centre went (m).
 * @property {boolean} startedInside
 * @property {import( '../world/solids.js' ).Solid} solid
 */

class Queries {

	/**
	 * @param {import( './engine.js' ).QueryWorld} world
	 */
	constructor( world ) {

		this.world = world;

	}

	/**
	 * @param {Vector3} from
	 * @param {Vector3} to
	 * @param {number} radius
	 * @param {{ group?: string, stopAtPenetration?: boolean }} [options]
	 * @return {Hit|null}
	 */
	sphereCast( from, to, radius, options ) {

		return this.cast( { kind: 'sphere', radius }, from, to, options );

	}

	/**
	 * A capsule standing along its local Y, `halfHeight` from its centre to a tip, turned by `rotation`.
	 *
	 * @param {Vector3} from
	 * @param {Vector3} to
	 * @param {number} radius
	 * @param {number} halfHeight
	 * @param {{ group?: string, rotation?: Quaternion, stopAtPenetration?: boolean }} [options]
	 * @return {Hit|null}
	 */
	capsuleCast( from, to, radius, halfHeight, options ) {

		return this.cast( { kind: 'capsule', radius, halfHeight }, from, to, options );

	}

	/**
	 * @param {Vector3} from
	 * @param {Vector3} to
	 * @param {Vector3} halfExtents
	 * @param {Quaternion} rotation
	 * @param {{ group?: string, stopAtPenetration?: boolean }} [options]
	 * @return {Hit|null}
	 */
	boxCast( from, to, halfExtents, rotation, options ) {

		return this.cast( { kind: 'box', halfExtents }, from, to, { ...options, rotation } );

	}

	/**
	 * Whether a sphere placed at a point is in or touching a solid: the deepest contact, as a hit at fraction 0.
	 *
	 * @param {Vector3} at
	 * @param {number} radius
	 * @param {{ group?: string }} [options]
	 * @return {Hit|null}
	 */
	overlapSphere( at, radius, options ) {

		return this.overlap( { kind: 'sphere', radius }, at, options );

	}

	/**
	 * @param {Vector3} at
	 * @param {number} radius
	 * @param {number} halfHeight
	 * @param {{ group?: string, rotation?: Quaternion }} [options]
	 * @return {Hit|null}
	 */
	overlapCapsule( at, radius, halfHeight, options ) {

		return this.overlap( { kind: 'capsule', radius, halfHeight }, at, options );

	}

	/**
	 * @param {Vector3} at
	 * @param {Vector3} halfExtents
	 * @param {Quaternion} rotation
	 * @param {{ group?: string }} [options]
	 * @return {Hit|null}
	 */
	overlapBox( at, halfExtents, rotation, options ) {

		return this.overlap( { kind: 'box', halfExtents }, at, { ...options, rotation } );

	}

	/**
	 * The first solid along a ray; one that starts inside a solid hits it at 0.
	 *
	 * @param {Vector3} origin
	 * @param {Vector3} direction Any length.
	 * @param {number} distance
	 * @param {string} [group]
	 * @return {import( './engine.js' ).RayHit|null}
	 */
	ray( origin, direction, distance, group = 'probe' ) {

		return this.world.ray( origin, direction.clone().normalize(), distance, { group: GROUPS[ group ] } );

	}

	/**
	 * How deep a shape placed at a point is inside the solids, and which way is out: the deepest contact.
	 *
	 * @param {import( './engine.js' ).Shape} shape
	 * @param {Vector3} at
	 * @param {{ group?: string, rotation?: Quaternion }} [options]
	 * @return {import( './engine.js' ).Contact|null}
	 */
	penetration( shape, at, { group = 'movement', rotation } = {} ) {

		return this.world.penetration( shape, at, { group: GROUPS[ group ], rotation } );

	}

	/**
	 * Any shape swept from `from` to `to`: the first solid it meets.
	 *
	 * @param {import( './engine.js' ).Shape} shape
	 * @param {Vector3} from
	 * @param {Vector3} to
	 * @param {{ group?: string, rotation?: Quaternion, stopAtPenetration?: boolean }} [options]
	 * @return {Hit|null}
	 */
	cast( shape, from, to, { group = 'probe', rotation, stopAtPenetration = true } = {} ) {

		const motion = to.clone().sub( from );

		// A sweep that goes nowhere asks what the shape is in where it stands.
		if ( motion.lengthSq() === 0 ) return this.overlap( shape, from, { group, rotation } );

		const bits = GROUPS[ group ];
		const hit = this.world.cast( shape, from, to, { group: bits, rotation, stopAtPenetration } );

		if ( ! hit ) return null;

		const normal = hit.normal.clone().normalize();

		return {
			point: hit.point,
			centre: from.clone().addScaledVector( motion, hit.fraction ),
			normal,
			faceNormal: faceNormal( hit.solid, hit.point, motion, normal ),
			distance: motion.length() * hit.fraction,
			fraction: hit.fraction,
			startedInside: hit.fraction === 0 && this.world.penetration( shape, from, { group: bits, rotation } )?.depth > INSIDE,
			solid: hit.solid
		};

	}

	/**
	 * Any shape placed at a point: the deepest solid it is in or touches, as a hit at fraction 0 whose face is the
	 * contact's (a shape that does not move meets no face first).
	 *
	 * @param {import( './engine.js' ).Shape} shape
	 * @param {Vector3} at
	 * @param {{ group?: string, rotation?: Quaternion }} [options]
	 * @return {Hit|null}
	 */
	overlap( shape, at, { group = 'probe', rotation } = {} ) {

		const contact = this.world.penetration( shape, at, { group: GROUPS[ group ], rotation, touching: true } );

		if ( ! contact ) return null;

		const normal = contact.normal.clone().normalize();

		return {
			point: contact.point,
			centre: at.clone(),
			normal,
			faceNormal: normal.clone(),
			distance: 0,
			fraction: 0,
			startedInside: true,
			solid: contact.solid
		};

	}

}

export { Queries };
