import { Quaternion, Triangle, Vector3 } from 'three';

// Solids: the static pieces of a course as every physics engine is given them (a box, or a convex hull of points),
// with the collision groups they block and the tags the runner reads. A hull also keeps its own faces, so the face a
// contact lies on is worked out here, the same way whatever engine found the contact.

/**
 * The collision groups. A solid blocks a set of them; a query looks in one. Each is one bit, so the engines can
 * filter on them in their broad phase: a solid is seen by a query when `solid.groups & group`.
 */
const GROUPS = Object.freeze( {
	movement: 1, // the runner's capsule as it moves
	probe: 2, // what the runner looks for: floors, walls and ledges ahead
	camera: 4, // the camera's sphere
	ragdoll: 8, // the ragdoll's bodies
} );

const EVERY_GROUP = GROUPS.movement | GROUPS.probe | GROUPS.camera | GROUPS.ragdoll;

/**
 * @typedef {Object} Solid
 * @property {string} id
 * @property {string} owner The course piece it belongs to: its parent piece, or itself.
 * @property {{ kind: 'box', halfExtents: number[] } | { kind: 'hull', points: number[] }} shape A hull's points are
 *   flat [ x, y, z, x, y, z, … ] in world space.
 * @property {number[]} [position] A box's centre, [ x, y, z ].
 * @property {number[]} [rotation] A box's rotation, [ x, y, z, w ].
 * @property {number} groups The collision groups it blocks.
 * @property {string[]} tags 'noClimb' (no ledge or wall-run here), 'outOfBounds', 'bar' (a swing bar), 'barPost'
 *   (a post holding one up).
 * @property {{ normal: Vector3, triangles: Triangle[] }[]} [faces] A hull's faces, outward normals; the engines never
 *   see them.
 */

/**
 * A box solid.
 *
 * @param {{ id: string, owner?: string, position: number[], rotation?: number[], halfExtents: number[],
 *   groups?: number, tags?: string[] }} description
 * @return {Solid}
 */
function boxSolid( { id, owner = id, position, rotation = [ 0, 0, 0, 1 ], halfExtents, groups = EVERY_GROUP, tags = [] } ) {

	return { id, owner, shape: { kind: 'box', halfExtents }, position, rotation, groups, tags };

}

/**
 * A convex hull solid. `polygons` lists each flat face as point indices in order round it (either way round); without
 * them the hull has no faces of its own and a contact on it reports the contact normal as its face.
 *
 * @param {{ id: string, owner?: string, points: number[], polygons?: number[][], groups?: number,
 *   tags?: string[] }} description
 * @return {Solid}
 */
function hullSolid( { id, owner = id, points, polygons = [], groups = EVERY_GROUP, tags = [] } ) {

	return { id, owner, shape: { kind: 'hull', points }, groups, tags, faces: facesOf( points, polygons ) };

}

/**
 * A prism round the line from `a` to `b` as a convex hull solid, with its two ends and its sides as faces: a pole, a
 * pipe, a cable, anything round. Round things are prisms because every engine is given only boxes and hulls.
 *
 * @param {{ id: string, owner?: string, a: Vector3, b: Vector3, radius: number, sides?: number, groups?: number,
 *   tags?: string[] }} description `sides` is 16 unless given
 * @return {Solid}
 */
function prismSolid( { id, owner = id, a, b, radius, sides = 16, groups = EVERY_GROUP, tags = [] } ) {

	return hullSolid( { id, owner, groups, tags, ...prism( a, b, radius, sides ) } );

}

// A prism round the line from a to b: a ring of corners at each end, its two ends and its sides as faces.
function prism( a, b, radius, sides ) {

	const axis = new Vector3().subVectors( b, a ).normalize();
	const helper = Math.abs( axis.y ) < 0.9 ? new Vector3( 0, 1, 0 ) : new Vector3( 1, 0, 0 );
	const u = new Vector3().crossVectors( axis, helper ).normalize();
	const v = new Vector3().crossVectors( axis, u );
	const points = [];

	for ( const end of [ a, b ] ) {

		for ( let i = 0; i < sides; i ++ ) {

			const angle = i / sides * Math.PI * 2;

			points.push( ...end.clone().addScaledVector( u, Math.cos( angle ) * radius ).addScaledVector( v, Math.sin( angle ) * radius ).toArray() );

		}

	}

	const ring = ( offset ) => Array.from( { length: sides }, ( _, i ) => offset + i );
	const polygons = [ ring( 0 ), ring( sides ) ];

	for ( let i = 0; i < sides; i ++ ) polygons.push( [ i, ( i + 1 ) % sides, sides + ( i + 1 ) % sides, sides + i ] );

	return { points, polygons };

}

function facesOf( points, polygons ) {

	const point = ( index ) => new Vector3().fromArray( points, index * 3 );
	const centre = new Vector3();

	for ( let index = 0; index < points.length / 3; index ++ ) centre.add( point( index ) );
	centre.divideScalar( points.length / 3 );

	return polygons.map( ( polygon ) => {

		const corners = polygon.map( point );
		const triangles = [];

		for ( let k = 1; k < corners.length - 1; k ++ ) triangles.push( new Triangle( corners[ 0 ], corners[ k ], corners[ k + 1 ] ) );

		// Newell's normal uses every corner, so a face that is only nearly flat still gets one plane; it points
		// away from the middle of the hull whichever way round the polygon was listed.
		const normal = new Vector3();

		corners.forEach( ( a, k ) => {

			const b = corners[ ( k + 1 ) % corners.length ];

			normal.x += ( a.y - b.y ) * ( a.z + b.z );
			normal.y += ( a.z - b.z ) * ( a.x + b.x );
			normal.z += ( a.x - b.x ) * ( a.y + b.y );

		} );

		normal.normalize();
		if ( normal.dot( corners[ 0 ].clone().sub( centre ) ) < 0 ) normal.negate();

		return { normal, triangles };

	} );

}

// A contact on an edge or corner lies on several faces at once: every face this close to the nearest counts.
const ON_FACE = 0.00002;

// A face whose normal is this far against the contact normal is the face behind the contact, seen from inside.
const BEHIND = - 0.001;

const closest = new Vector3();

/**
 * The face of a solid a contact lies on: of the faces through the contact point (within 0.02 mm), the one turned
 * most against the motion, on the contact normal's side. An engine's contact normal at an edge or corner leans
 * between the faces; the runner wants the wall or floor it ran into.
 *
 * @param {Solid} solid
 * @param {Vector3} point The contact point.
 * @param {Vector3} motion How the shape was moving.
 * @param {Vector3} contactNormal The engine's contact normal, pointing out of the solid.
 * @return {Vector3}
 */
function faceNormal( solid, point, motion, contactNormal ) {

	const candidates = solid.shape.kind === 'box' ? boxCandidates( solid, point ) : hullCandidates( solid, point );

	if ( ! candidates.length ) return contactNormal.clone();

	const nearest = Math.min( ...candidates.map( ( candidate ) => candidate.distance ) );
	let result = contactNormal.clone();
	let opposition = Infinity;

	for ( const candidate of candidates ) {

		if ( candidate.distance > nearest + ON_FACE ) continue;
		if ( candidate.normal.dot( contactNormal ) < BEHIND ) candidate.normal.negate();

		const along = candidate.normal.dot( motion );

		if ( along < opposition ) {

			opposition = along;
			result = candidate.normal;

		}

	}

	return result;

}

// A box by its axes: on each axis, the face on the point's side and how far the point is from its plane.
function boxCandidates( solid, point ) {

	const rotation = new Quaternion().fromArray( solid.rotation );
	const local = point.clone().sub( new Vector3().fromArray( solid.position ) ).applyQuaternion( rotation.clone().invert() );
	const half = new Vector3().fromArray( solid.shape.halfExtents );

	return [ 'x', 'y', 'z' ].map( ( axis ) => {

		const normal = new Vector3();

		normal[ axis ] = Math.sign( local[ axis ] ) || 1;

		return { distance: Math.abs( Math.abs( local[ axis ] ) - half[ axis ] ), normal: normal.applyQuaternion( rotation ) };

	} );

}

function hullCandidates( solid, point ) {

	return solid.faces.map( ( face ) => {

		let distance = Infinity;

		for ( const triangle of face.triangles ) distance = Math.min( distance, triangle.closestPointToPoint( point, closest ).distanceTo( point ) );

		return { distance, normal: face.normal.clone() };

	} );

}

export { GROUPS, EVERY_GROUP, boxSolid, hullSolid, prismSolid, faceNormal };
