import Box3D from 'box3d.js/inline';
import { Quaternion, Vector3 } from 'three';
import { Body, DynamicWorld, PhysicsEngine, QueryWorld } from '@trizen/parkour/physics/engine.js';
import { faceNormal } from '@trizen/parkour/world/solids.js';

// The engine interface on box3d (box3d.js, with its WebAssembly inlined so it loads the same way in node and in the
// page). box3d answers the contract's questions by its own conventions; this backend turns them into the contract's:
//
// - A shape cast stops a linear slop (5 mm) from touching: that far into the solid for a rounded shape, that far short
//   of it for a sharp one. So a sphere or capsule is cast grown by the slop, which makes it stop touching (for one at
//   least the slop round, as every query shape is), and a box is cast as it is and then moved on until it touches (or
//   is found to pass by: a box that passes within the slop of an edge reads as a hit).
// - A cast that starts within a quarter of the slop of a solid, or inside it, meets it at once with no normal, and
//   there is no stop-at-penetration flag. The contact where the shape starts says whether it is inside and which way
//   is out; a shape clear of the solid and moving towards it is cast at that solid again from further back along its
//   path, which finds where it really touches.
// - There is no penetration query: the mover's contact planes give a sphere's or capsule's depth while its core is
//   outside the solid, and the contact manifold the solver would use gives the rest, and every box's.
// - Two solids met at the same point of a cast or a ray (a deck and the top edge of a ramp flush with it) come in
//   whichever order box3d's tree gives; the one whose own face is most against the motion is the one reported.
// - An overlap counts a gap under half a millimetre, so the shape is shrunk by that much first.
// - A ray starting inside a solid hits it at 0 only through the cast with a callback (the closest-hit cast skips it).
// - Contacts take the geometric mean of two frictions and the larger restitution, where the contract takes the mean of
//   each: the dynamic world gives its static solids the values that make their contacts with the bodies come out so.
// - A world cannot be put back as it was, so a fresh world is built again, on an idle frame when the page has one.
// - Engine objects stay in private fields and a module map, so nothing in the game (or a snapshot) ever holds one.

/** box3d's linear slop (m): how far from touching a shape cast stops. */
const SLOP = 0.005;

// A cast that starts this close to a solid (m) meets it at fraction 0: a quarter of the slop for a shape grown by the
// slop, the slop and a quarter for a sharp one.
const ROUNDED_BAND = 0.00125;
const SHARP_BAND = 0.00625;

// A cast at one solid again from further back along its path starts this far (m) outside its band, and no further
// back than this (m): a path that only just closes on the solid takes the contact plane's estimate instead.
const BAND_CLEARANCE = 0.001;
const FARTHEST_BACK = 10;

// Solids met within this much (m) of each other along a cast or a ray are met together.
const SAME_PLACE = 0.000001;

// A box moved on towards a solid touches it once this close (m); it is moved on at most this many times.
const TOUCHING = 0.00001;
const BOX_STEPS = 12;

// An overlap counts a gap under this (m) as overlapping.
const OVERLAP_SLOP = 0.0005;

// box3d's joints are springs, at most a quarter of the substep rate stiff (240 Hz at 120 steps of 8 substeps a
// second); its default of 60 Hz lets a limb come 3 to 5 cm off its joint in a fall. Asked for more than any step
// allows (Hz), a joint is as stiff as box3d makes it.
const JOINT_STIFFNESS = 10000;

// box3d's contacts are springs as well, 30 Hz stiff by default: against joints it can make at most 240 Hz stiff, a
// fallen body is held hard where it lies, its joints pulled millimetres apart (as the square of the contacts'
// frequency) and left bent past their limits further than the ragdoll's limit springs bring back. At 20 Hz a body falls
// and comes to rest as it does on Rapier: over 288 drops and throws of the Y Bot the chest rests 14° past its bend on
// average (Rapier 15°, box3d's default 25°) and locked axes 4.5° (4.5°, 7°), settling as fast. Only the dynamic
// world simulates.
const CONTACT_HERTZ = 20;

// The most worlds one box3d module holds at once.
const MOST_WORLDS = 128;

// Every collision category; a solid's own are the groups it blocks.
const EVERY_BIT = 0xffffffffffffffffn;

const IDENTITY = Object.freeze( { x: 0, y: 0, z: 0, w: 1 } );
const Z = new Vector3( 0, 0, 1 );

// The module, once loaded; and scratch for what box3d reads and writes in place.
let b3 = null;
let planeResult = null;
const scratchPoints = new Float32Array( 24 );
const scratch = [ 0, 0, 0, 0 ];

const array = ( v ) => [ v.x, v.y, v.z ];
const quaternionArray = ( q ) => [ q.x, q.y, q.z, q.w ];

// v turned by the rotation q, into out.
function rotate( out, q, x, y, z ) {

	const tx = 2 * ( q.y * z - q.z * y ), ty = 2 * ( q.z * x - q.x * z ), tz = 2 * ( q.x * y - q.y * x );

	out[ 0 ] = x + q.w * tx + q.y * tz - q.z * ty;
	out[ 1 ] = y + q.w * ty + q.z * tx - q.x * tz;
	out[ 2 ] = z + q.w * tz + q.x * ty - q.y * tx;

	return out;

}

/**
 * A query shape as box3d takes it: points round the shape's centre (turned) and a radius about them. `grow` widens a
 * sphere's or capsule's radius, or a box's half extents; a negative `grow` shrinks them.
 */
function proxyOf( shape, rotation, grow ) {

	const points = scratchPoints, point = scratch;

	if ( shape.kind === 'sphere' ) {

		points.fill( 0, 0, 3 );

		return { points: points.subarray( 0, 3 ), radius: Math.max( 0, shape.radius + grow ) };

	}

	if ( shape.kind === 'capsule' ) {

		// The contract's half height reaches a tip; box3d's capsule is the straight middle's two ends.
		const half = Math.max( 0, shape.halfHeight - shape.radius );

		points.set( rotate( point, rotation, 0, - half, 0 ).slice( 0, 3 ), 0 );
		points.set( rotate( point, rotation, 0, half, 0 ).slice( 0, 3 ), 3 );

		return { points: points.subarray( 0, 6 ), radius: Math.max( 0, shape.radius + grow ) };

	}

	const x = Math.max( 0, shape.halfExtents.x + grow ), y = Math.max( 0, shape.halfExtents.y + grow ), z = Math.max( 0, shape.halfExtents.z + grow );
	let i = 0;

	for ( const sx of [ - x, x ] ) for ( const sy of [ - y, y ] ) for ( const sz of [ - z, z ] ) {

		rotate( point, rotation, sx, sy, sz );
		points[ i ++ ] = point[ 0 ];
		points[ i ++ ] = point[ 1 ];
		points[ i ++ ] = point[ 2 ];

	}

	return { points, radius: 0 };

}

function boxCorners( x, y, z ) {

	const points = [];

	for ( const sx of [ - x, x ] ) for ( const sy of [ - y, y ] ) for ( const sz of [ - z, z ] ) points.push( sx, sy, sz );

	return points;

}

// A new box3d world; past box3d's limit, a clear error rather than box3d's dead world.
function createWorld( gravity, contactHertz ) {

	const definition = b3.b3DefaultWorldDef();

	definition.gravity = gravity;
	if ( contactHertz ) definition.contactHertz = contactHertz;

	const world = b3.b3CreateWorld( definition );

	if ( ! b3.b3World_IsValid( world ) ) throw new Error( `box3d holds at most ${ MOST_WORLDS } worlds at once: dispose of the simulations no longer in use` );

	return world;

}

// A static body holding a solid, and its shape: a box at its pose, or a hull on a body at the hull's middle, so the
// hull's own points stay small (box3d keeps them in single precision). Null for a hull box3d finds flat or too complex.
function addSolid( world, solid, shapeDefinition ) {

	const body = b3.b3DefaultBodyDef();

	if ( solid.shape.kind === 'box' ) {

		body.position = solid.position;
		body.rotation = solid.rotation;

		const [ x, y, z ] = solid.shape.halfExtents;

		return b3.b3CreateBoxShape( b3.b3CreateBody( world, body ), shapeDefinition, x, y, z );

	}

	const points = solid.shape.points, count = points.length / 3;
	const middle = [ 0, 0, 0 ];

	for ( let i = 0; i < points.length; i ++ ) middle[ i % 3 ] += points[ i ] / count;

	// The body sits where single precision puts it exactly, so the points measured from it lose nothing more.
	middle.forEach( ( value, k ) => middle[ k ] = Math.fround( value ) );

	const local = new Float32Array( points.length );

	for ( let i = 0; i < points.length; i ++ ) local[ i ] = points[ i ] - middle[ i % 3 ];

	const hull = b3.b3CreateHull( local );

	if ( ! hull ) return null;

	body.position = middle;

	const shape = b3.b3CreateHullShape( b3.b3CreateBody( world, body ), shapeDefinition, hull );

	// The world keeps a copy of the hull.
	hull.delete();

	return shape;

}

/**
 * @typedef {Object} SolidRecord A solid as this backend keeps it.
 * @property {Solid} solid
 * @property {number} order Its place in the order the solids were added.
 * @property {Object} shape Its box3d shape.
 * @property {Object} body Its static box3d body.
 * @property {number[]} position The body's place as box3d holds it.
 * @property {number[]} rotation The body's rotation as box3d holds it.
 * @property {Float32Array} [points] Its hull's corners in its body, once a box's distance from it was asked.
 */

class Box3DQueryWorld extends QueryWorld {

	#world;

	// Each solid's record, by its box3d shape's index (unique in a world).
	#records = [];

	// A solid's hull as the contact manifold takes it, by record, made the first time a contact needs it.
	#hulls = new Map();

	// A query box as a hull, for its contact manifold, and its corners, for its distance from a solid, by size.
	#boxes = new Map();
	#corners = new Map();

	// The query filter of each group.
	#filters = new Map();

	constructor( solids ) {

		super();

		this.#world = createWorld( [ 0, 0, 0 ] );

		solids.forEach( ( solid, order ) => {

			const definition = b3.b3DefaultShapeDef();

			// A solid's categories are the groups it blocks; a query asks for its own group, so box3d filters in its
			// broad phase.
			definition.filter = { categoryBits: BigInt( solid.groups ), maskBits: EVERY_BIT, groupIndex: 0 };

			const shape = addSolid( this.#world, solid, definition );

			if ( ! shape ) return;

			const body = b3.b3Shape_GetBody( shape );
			const [ position, rotation ] = b3.b3Body_GetTransform( [ 0, 0, 0 ], [ 0, 0, 0, 1 ], body );

			this.#records[ shape.index1 ] = { solid, order, shape, body, position, rotation };

		} );

	}

	#filter( group ) {

		let filter = this.#filters.get( group );

		if ( ! filter ) {

			filter = b3.b3DefaultQueryFilter();
			if ( group !== undefined ) filter.maskBits = BigInt( group );
			this.#filters.set( group, filter );

		}

		return filter;

	}

	cast( shape, from, to, { group, rotation = IDENTITY, stopAtPenetration = true } = {} ) {

		const motion = new Vector3().subVectors( to, from );
		const length = motion.length();

		if ( length === 0 ) {

			const contact = this.penetration( shape, from, { group, rotation, touching: true } );

			return contact && { fraction: 0, point: contact.point, normal: contact.normal, solid: contact.solid };

		}

		const sharp = shape.kind === 'box';
		const { points, radius } = proxyOf( shape, rotation, sharp ? 0 : SLOP );
		const cast = { shape, from, rotation, motion, length, group, sharp, points, radius, filter: this.#filter( group ), stopAtPenetration };
		let best = null;

		b3.b3World_CastShape( this.#world, array( from ), points, radius, array( motion ), cast.filter, ( shapeId, point, normal, fraction ) => {

			const record = this.#records[ shapeId.index1 ];
			const hit = fraction === 0 ? this.#fromStart( cast, record ) : sharp ? this.#touchingBox( cast, record, fraction, point, normal ) : landed( fraction, point, normal );

			if ( ! hit ) return - 1;

			hit.record = record;
			if ( ! best || nearer( hit, best, motion ) ) best = hit;

			// Solids a hair further on are still looked at: they may be met together with it.
			return best.fraction + SAME_PLACE / length;

		} );

		if ( ! best ) return null;

		return { fraction: best.fraction, point: best.point, normal: best.normal, solid: best.record.solid };

	}

	// A solid box3d says the cast meets at once: it starts inside it, or within box3d's band of it.
	#fromStart( cast, record ) {

		const contact = this.#contactAt( cast.shape, cast.from, cast.rotation, record, cast.group, SLOP );

		// Nothing found where box3d says it touches (it never should): blocked, rather than let through.
		if ( ! contact ) return { fraction: 0, point: new Vector3().copy( cast.from ), normal: cast.motion.clone().negate().normalize() };

		// How fast the motion closes on the solid, per metre of the path.
		const closing = - cast.motion.dot( contact.normal ) / cast.length;

		if ( contact.depth > 0 ) return cast.stopAtPenetration || closing > 0 ? { fraction: 0, point: contact.point, normal: contact.normal } : null;

		// Clear of it: moving away or along, or not reaching its contact plane (which the solid lies behind), it is
		// not met.
		const gap = - contact.depth;

		if ( closing <= 0 || gap >= closing * cast.length ) return null;

		return this.#castFromBack( cast, record, contact, gap, closing );

	}

	// The cast at one solid again, from far enough back along its path to start outside box3d's band: where it touches.
	#castFromBack( cast, record, contact, gap, closing ) {

		const band = cast.sharp ? SHARP_BAND : ROUNDED_BAND;
		const back = ( band + BAND_CLEARANCE - gap ) / closing;
		const planeEstimate = { fraction: gap / ( closing * cast.length ), point: contact.point, normal: contact.normal };

		if ( back > FARTHEST_BACK ) return planeEstimate;

		const path = cast.length + back;
		const start = new Vector3().copy( cast.from ).addScaledVector( cast.motion, - back / cast.length );
		const motion = cast.motion.clone().multiplyScalar( path / cast.length );
		const again = b3.b3Body_CastShape( record.body, array( start ), cast.points, cast.radius, array( motion ), cast.filter, 1, false, { position: record.position, quaternion: record.rotation } );

		if ( ! again.hit ) return null;
		if ( again.fraction === 0 ) return planeEstimate;

		const hit = cast.sharp ?
			this.#touchingBox( { ...cast, from: start, motion, length: path }, record, again.fraction, again.point, again.normal ) :
			landed( again.fraction, again.point, again.normal );

		if ( ! hit ) return null;

		const fraction = Math.max( 0, ( hit.fraction * path - back ) / cast.length );

		return fraction > 1 ? null : { ...hit, fraction };

	}

	// A box cast as it is, which box3d stopped the slop short of a solid: moved on along its path, by how far it still is
	// from the solid over how fast it closes on it, until it touches. On a face that is one move; at an edge or a
	// corner a few, and a box only passing within the slop of one never gets there (it stops closing, or the cast
	// ends first). Each move is the most it can go without passing into the solid, the solid being convex.
	#touchingBox( cast, record, fraction, point, normal ) {

		let last = { point: new Vector3().fromArray( point ), normal: new Vector3().fromArray( normal ) };

		for ( let move = 0; move < BOX_STEPS; move ++ ) {

			const apart = this.#boxDistance( cast, record, fraction );

			// Touching. Two points this close give no direction, so the normal is the last one measured apart (on the
			// same face or edge it has been closing on); just in, by the last bit, the point is too.
			if ( apart.distance <= TOUCHING ) return { fraction, point: apart.distance > 0 ? apart.point : last.point, normal: last.normal };

			const closing = - cast.motion.dot( apart.normal ) / cast.length;

			if ( closing <= 0 ) return null;

			fraction += apart.distance / ( closing * cast.length );

			if ( fraction > 1 ) return null;

			last = apart;

		}

		return null;

	}

	// How far a cast's box, at a fraction of the way, is from a solid: the distance, the solid's normal towards the box,
	// and the closest point on the solid.
	#boxDistance( cast, record, fraction ) {

		record.points ??= Float32Array.from( b3.b3Shape_GetHullVertices( record.shape ) );

		const { x, y, z } = cast.shape.halfExtents;
		const key = `${ x },${ y },${ z }`;
		let corners = this.#corners.get( key );

		if ( ! corners ) this.#corners.set( key, corners = new Float32Array( boxCorners( x, y, z ) ) );

		// The box's pose in the solid's body.
		const bodyRotation = new Quaternion().fromArray( record.rotation ), bodyPosition = new Vector3().fromArray( record.position );
		const inverse = bodyRotation.clone().invert();
		const centre = new Vector3().copy( cast.from ).addScaledVector( cast.motion, fraction ).sub( bodyPosition ).applyQuaternion( inverse );
		const turn = inverse.multiply( new Quaternion().copy( cast.rotation ) );
		const result = b3.b3ShapeDistance( record.points, 0, corners, 0, { position: centre.toArray(), quaternion: turn.toArray() }, false );

		return {
			distance: result.distance,
			normal: new Vector3().fromArray( result.normal ).applyQuaternion( bodyRotation ),
			point: new Vector3().fromArray( result.pointA ).applyQuaternion( bodyRotation ).add( bodyPosition )
		};

	}

	// The contact of a shape placed at a point with one solid (null if they are further apart than `reach`): a sphere's
	// or capsule's from the mover's contact planes within `reach`, else (its core inside the solid, or a box) from
	// the contact manifold.
	#contactAt( shape, at, rotation, record, group, reach ) {

		if ( shape.kind !== 'box' ) {

			const contact = this.#planeContacts( shape, at, rotation, group, reach ).get( record );

			if ( contact ) return contact;

		}

		return this.#manifoldContact( shape, at, rotation, record );

	}

	// The mover's contact planes, by record: the deepest each solid gives a sphere or capsule `reach` larger than
	// itself. Their depth is the shape's own (negative: a gap). Box3d gives no plane for a solid the core is inside.
	#planeContacts( shape, at, rotation, group, reach ) {

		const half = shape.kind === 'capsule' ? Math.max( 0, shape.halfHeight - shape.radius ) : 0;
		const mover = { center1: rotate( [ 0, 0, 0 ], rotation, 0, - half, 0 ), center2: rotate( [ 0, 0, 0 ], rotation, 0, half, 0 ), radius: shape.radius + reach };
		const contacts = new Map();

		b3.b3World_CollideMover( this.#world, array( at ), mover, this.#filter( group ), ( shapeId, planes ) => {

			const record = this.#records[ shapeId.index1 ];

			for ( let i = 0, count = b3.getNumPlaneResults( planes ); i < count; i ++ ) {

				const { plane, point } = b3.getPlaneResultAt( planeResult, planes, i );
				const depth = plane.offset - reach;

				if ( depth <= ( contacts.get( record )?.depth ?? - Infinity ) ) continue;

				// The point comes back measured from the shape's centre, on the solid.
				contacts.set( record, {
					record, depth,
					normal: new Vector3().fromArray( plane.normal ),
					point: new Vector3( point[ 0 ] + at.x, point[ 1 ] + at.y, point[ 2 ] + at.z )
				} );

			}

			return true;

		} );

		return contacts;

	}

	// The contact manifold of a shape at a point and one solid, as box3d's solver would make it (it answers a shape deep
	// inside a solid, and a box): its deepest point, if within a couple of centimetres. The manifold's normal points
	// from the solid to the shape, and its points sit halfway between the two surfaces.
	#manifoldContact( shape, at, rotation, record ) {

		let hull = this.#hulls.get( record );

		if ( ! hull ) {

			hull = b3.b3CreateHull( b3.b3Shape_GetHullVertices( record.shape ) );
			this.#hulls.set( record, hull );

		}

		// The shape's pose in the solid's body.
		const bodyRotation = new Quaternion().fromArray( record.rotation ), bodyPosition = new Vector3().fromArray( record.position );
		const inverse = bodyRotation.clone().invert();
		const pose = {
			position: new Vector3().copy( at ).sub( bodyPosition ).applyQuaternion( inverse ).toArray(),
			quaternion: inverse.clone().multiply( new Quaternion().copy( rotation ) ).toArray()
		};
		let manifold;

		if ( shape.kind === 'capsule' ) {

			const half = Math.max( 0, shape.halfHeight - shape.radius );

			manifold = b3.b3CollideHullAndCapsule( hull, { center1: [ 0, - half, 0 ], center2: [ 0, half, 0 ], radius: shape.radius }, pose );

		} else if ( shape.kind === 'sphere' ) {

			manifold = b3.b3CollideHullAndSphere( hull, { center: [ 0, 0, 0 ], radius: shape.radius }, pose );

		} else {

			manifold = b3.b3CollideHulls( hull, this.#boxHull( shape.halfExtents ), pose );

		}

		if ( ! manifold?.points?.length ) return null;

		let deepest = manifold.points[ 0 ];

		for ( const point of manifold.points ) if ( point.separation < deepest.separation ) deepest = point;

		const normal = new Vector3().fromArray( manifold.normal );
		const point = new Vector3().fromArray( deepest.point ).addScaledVector( normal, - deepest.separation / 2 );

		return {
			record,
			depth: - deepest.separation,
			normal: normal.applyQuaternion( bodyRotation ),
			point: point.applyQuaternion( bodyRotation ).add( bodyPosition )
		};

	}

	#boxHull( halfExtents ) {

		const key = `${ halfExtents.x },${ halfExtents.y },${ halfExtents.z }`;
		let hull = this.#boxes.get( key );

		if ( ! hull ) {

			hull = b3.b3CreateHull( boxCorners( halfExtents.x, halfExtents.y, halfExtents.z ) );
			this.#boxes.set( key, hull );

		}

		return hull;

	}

	// The records of the solids a shape overlaps by more than `minDepth`, in the order they were added.
	#overlapping( shape, at, rotation, group, minDepth ) {

		const { points, radius } = proxyOf( shape, rotation, - ( minDepth + OVERLAP_SLOP ) );
		const records = [];

		b3.b3World_OverlapShape( this.#world, array( at ), points, radius, this.#filter( group ), ( shapeId ) => {

			records.push( this.#records[ shapeId.index1 ] );

			return true;

		} );

		return records.sort( ( a, b ) => a.order - b.order );

	}

	overlap( shape, at, { group, rotation = IDENTITY, minDepth = 0 } = {} ) {

		return this.#overlapping( shape, at, rotation, group, minDepth ).map( ( record ) => record.solid );

	}

	penetration( shape, at, { group, rotation = IDENTITY, touching = false } = {} ) {

		const inside = this.#overlapping( shape, at, rotation, group, 0 );

		if ( ! inside.length ) return null;

		const planes = shape.kind === 'box' ? null : this.#planeContacts( shape, at, rotation, group, 0 );
		let deepest = null;

		for ( const record of inside ) {

			const contact = planes?.get( record ) ?? this.#manifoldContact( shape, at, rotation, record );

			if ( ! contact || ( touching ? contact.depth < 0 : contact.depth <= 0 ) ) continue;
			if ( ! deepest || contact.depth > deepest.depth ) deepest = contact;

		}

		return deepest && { depth: deepest.depth, point: deepest.point, normal: deepest.normal, solid: deepest.record.solid };

	}

	ray( origin, direction, distance, { group } = {} ) {

		const travel = new Vector3().copy( direction ).multiplyScalar( distance );
		let best = null;

		// The cast with a callback reports a solid the ray starts inside at 0, with no normal (a solid ray).
		b3.b3World_CastRay( this.#world, array( origin ), array( travel ), this.#filter( group ), ( shapeId, point, normal, fraction ) => {

			const hit = { fraction, point: new Vector3().copy( origin ).addScaledVector( direction, fraction * distance ), normal: new Vector3().fromArray( normal ), record: this.#records[ shapeId.index1 ] };

			if ( ! best || nearer( hit, best, travel ) ) best = hit;

			return best.fraction + SAME_PLACE / distance;

		} );

		if ( ! best ) return null;

		return { distance: best.fraction * distance, point: best.point, normal: best.normal, solid: best.record.solid };

	}

	dispose() {

		if ( ! this.#world ) return;

		b3.b3DestroyWorld( this.#world );
		this.#world = null;

		for ( const hull of [ ...this.#hulls.values(), ...this.#boxes.values() ] ) hull.delete();
		this.#hulls.clear();
		this.#boxes.clear();

	}

}

// Whether a hit comes before the best so far along a motion: nearer by more than a hair, or as near with its solid's
// own face more against the motion (then the solid added first).
function nearer( hit, best, motion ) {

	const ahead = ( best.fraction - hit.fraction ) * motion.length();

	if ( Math.abs( ahead ) > SAME_PLACE ) return ahead > 0;

	const facing = ( h ) => h.facing ??= h.normal.lengthSq() > 0 ? faceNormal( h.record.solid, h.point, motion, h.normal ).dot( motion ) : 0;

	if ( facing( hit ) !== facing( best ) ) return facing( hit ) < facing( best );

	return hit.record.order < best.record.order;

}

// A hit box3d found as it is.
function landed( fraction, point, normal ) {

	return { fraction, point: new Vector3().fromArray( point ), normal: new Vector3().fromArray( normal ) };

}

// Each body's box3d body and the world build it belongs to, kept here so no game code can reach them.
const bodies = new WeakMap();

class Box3DBody extends Body {

	constructor( id, build ) {

		super();
		bodies.set( this, { id, build } );

	}

	// box3d does not catch a dead body's id: it would read whatever body took its place.
	get #id() {

		const entry = bodies.get( this );

		if ( ! entry || ! entry.build.alive ) throw new Error( 'this body is gone: removed, or its world made fresh' );

		return entry.id;

	}

	position() {

		return new Vector3().fromArray( b3.b3Body_GetPosition( scratch, this.#id ) );

	}

	rotation() {

		return new Quaternion().fromArray( b3.b3Body_GetRotation( scratch, this.#id ) );

	}

	linearVelocity() {

		return new Vector3().fromArray( b3.b3Body_GetLinearVelocity( scratch, this.#id ) );

	}

	angularVelocity() {

		return new Vector3().fromArray( b3.b3Body_GetAngularVelocity( scratch, this.#id ) );

	}

	mass() {

		return b3.b3Body_GetMass( this.#id );

	}

	inverseInertiaWorld() {

		// box3d gives the matrix's columns; it is symmetric.
		const { cx, cy, cz } = b3.b3Body_GetWorldInverseRotationalInertia( this.#id );

		return [ cx[ 0 ], cy[ 0 ], cz[ 0 ], cy[ 1 ], cz[ 1 ], cz[ 2 ] ];

	}

	applyImpulse( impulse ) {

		b3.b3Body_ApplyLinearImpulseToCenter( this.#id, array( impulse ), true );

	}

	applyAngularImpulse( impulse ) {

		b3.b3Body_ApplyAngularImpulse( this.#id, array( impulse ), true );

	}

}

// The friction and restitution a static solid needs so that its contacts with a body of the given material come out
// at the mean of the two, as the contract has them: box3d mixes frictions by their geometric mean and takes the larger
// restitution. (A body more bouncy than the mean keeps its own bounce.)
function groundFor( ground, body ) {

	if ( ! body ) return ground;

	const friction = ( ground.friction + body.friction ) / 2;

	return {
		friction: body.friction > 0 ? friction * friction / body.friction : ground.friction,
		restitution: ( ground.restitution + body.restitution ) / 2
	};

}

const sameMaterial = ( a, b ) => a?.friction === b?.friction && a?.restitution === b?.restitution;

// Builds a fresh world when the page is idle, where the page says when that is.
const whenIdle = globalThis.requestIdleCallback?.bind( globalThis ) ?? null;
const cancelIdle = globalThis.cancelIdleCallback?.bind( globalThis ) ?? null;

class Box3DDynamicWorld extends DynamicWorld {

	#description;

	// The box3d world, or null while a fresh one waits to be built.
	#world = null;

	// The current build: its bodies are alive while it is.
	#build = null;

	// The static solids' shapes, and the bodies' material their friction and restitution are set for (the first body's:
	// a world's bodies share one material, as the ragdoll's do).
	#statics = [];
	#paired = null;

	// Whether anything has happened since the world was built.
	#touched = false;

	#idle = null;
	#disposed = false;

	constructor( description ) {

		super();

		this.#description = description;
		this.#make();

	}

	#make() {

		const { gravity, solids, friction, restitution } = this.#description;
		const ground = groundFor( { friction, restitution }, this.#paired );

		this.#world = createWorld( array( gravity ), CONTACT_HERTZ );
		this.#build = { alive: true };
		this.#statics = [];

		for ( const solid of solids ) {

			const definition = b3.b3DefaultShapeDef();

			definition.baseMaterial.friction = ground.friction;
			definition.baseMaterial.restitution = ground.restitution;

			const shape = addSolid( this.#world, solid, definition );

			if ( shape ) this.#statics.push( shape );

		}

	}

	// The world, built if a fresh one is waiting.
	#ready() {

		if ( this.#disposed ) throw new Error( 'this dynamic world is disposed' );

		if ( this.#idle !== null ) {

			cancelIdle( this.#idle );
			this.#idle = null;

		}

		if ( ! this.#world ) this.#make();
		this.#touched = true;

		return this.#world;

	}

	#destroy() {

		if ( this.#idle !== null ) cancelIdle( this.#idle );
		this.#idle = null;
		if ( this.#world ) b3.b3DestroyWorld( this.#world );
		this.#world = null;
		if ( this.#build ) this.#build.alive = false;

	}

	fresh() {

		if ( ! this.#touched || this.#disposed ) return;

		this.#destroy();
		this.#touched = false;

		// Building takes a few milliseconds on a large course: on an idle frame if the page has one, else when next used.
		if ( whenIdle ) this.#idle = whenIdle( () => {

			this.#idle = null;
			if ( ! this.#world && ! this.#disposed ) this.#make();

		} );

	}

	addBody( { position, rotation, linearVelocity, linearDamping, angularDamping, continuous, shapes } ) {

		const world = this.#ready();

		if ( shapes.length ) this.#pair( shapes[ 0 ] );

		const definition = b3.b3DefaultBodyDef();

		definition.type = b3.b3BodyType.b3_dynamicBody;
		definition.position = array( position );
		definition.rotation = quaternionArray( rotation );
		definition.linearVelocity = array( linearVelocity );
		definition.linearDamping = linearDamping;
		definition.angularDamping = angularDamping;
		definition.isBullet = continuous;

		const id = b3.b3CreateBody( world, definition );

		for ( const part of shapes ) {

			const shapeDefinition = b3.b3DefaultShapeDef();

			// box3d's own default density is 1000 kg/m³.
			shapeDefinition.density = part.density;
			shapeDefinition.baseMaterial.friction = part.friction;
			shapeDefinition.baseMaterial.restitution = part.restitution;

			if ( part.shape.kind === 'capsule' ) {

				const axis = new Vector3( 0, part.shape.halfLength, 0 ).applyQuaternion( part.rotation );

				b3.b3CreateCapsuleShape( id, shapeDefinition, {
					center1: array( new Vector3().copy( part.offset ).sub( axis ) ),
					center2: array( new Vector3().copy( part.offset ).add( axis ) ),
					radius: part.shape.radius
				} );

			} else {

				const { x, y, z } = part.shape.halfExtents;
				const corners = boxCorners( x, y, z );
				const corner = new Vector3();

				for ( let i = 0; i < corners.length; i += 3 ) corner.fromArray( corners, i ).applyQuaternion( part.rotation ).add( part.offset ).toArray( corners, i );

				const hull = b3.b3CreateHull( corners );

				b3.b3CreateHullShape( id, shapeDefinition, hull );
				hull.delete();

			}

		}

		return new Box3DBody( id, this.#build );

	}

	// The static solids' friction and restitution set for a body material.
	#pair( material ) {

		const body = { friction: material.friction, restitution: material.restitution };

		if ( sameMaterial( body, this.#paired ) ) return;

		this.#paired = body;

		const { friction, restitution } = this.#description;
		const ground = groundFor( { friction, restitution }, body );

		for ( const shape of this.#statics ) {

			b3.b3Shape_SetFriction( shape, ground.friction );
			b3.b3Shape_SetRestitution( shape, ground.restitution );

		}

	}

	addJoint( { kind, body, parent, anchor, parentAnchor, frame = IDENTITY, parentFrame = IDENTITY, axis, limits, center = 0, collide = true } ) {

		const world = this.#ready();
		const frameA = new Quaternion().copy( frame ), frameB = new Quaternion().copy( parentFrame );
		let definition;

		if ( kind === 'hinge' ) {

			// box3d's hinge turns about its frames' Z: turn Z onto the axis in both frames, and the parent's about the
			// axis to where the limits are centred.
			const turn = new Quaternion().setFromUnitVectors( Z, axis );

			frameA.multiply( turn );
			frameB.multiply( new Quaternion().setFromAxisAngle( axis, center ) ).multiply( turn );
			definition = b3.b3DefaultRevoluteJointDef();

			if ( limits ) {

				definition.enableLimit = true;
				definition.lowerAngle = limits[ 0 ];
				definition.upperAngle = limits[ 1 ];

			}

		} else {

			definition = b3.b3DefaultSphericalJointDef();

		}

		Object.assign( definition.base, {
			bodyIdA: bodies.get( body ).id,
			bodyIdB: bodies.get( parent ).id,
			localFrameA: { position: array( anchor ), quaternion: quaternionArray( frameA ) },
			localFrameB: { position: array( parentAnchor ), quaternion: quaternionArray( frameB ) },
			collideConnected: collide,
			constraintHertz: JOINT_STIFFNESS
		} );

		if ( kind === 'hinge' ) b3.b3CreateRevoluteJoint( world, definition );
		else b3.b3CreateSphericalJoint( world, definition );

	}

	disableCollision( a, b ) {

		const world = this.#ready();
		const definition = b3.b3DefaultFilterJointDef();

		// A filter joint does nothing but keep its two bodies from touching.
		definition.base.bodyIdA = bodies.get( a ).id;
		definition.base.bodyIdB = bodies.get( b ).id;
		b3.b3CreateFilterJoint( world, definition );

	}

	step( dt ) {

		// box3d's solver divides each step into substeps rather than iterating over the whole step.
		b3.b3World_Step( this.#ready(), dt, this.#description.iterations );

	}

	removeBody( body ) {

		this.#ready();

		// Its shapes and joints go with it.
		b3.b3DestroyBody( bodies.get( body ).id );
		bodies.delete( body );

	}

	dispose() {

		this.#destroy();
		this.#disposed = true;

	}

}

class Box3DEngine extends PhysicsEngine {

	constructor() {

		super( 'box3d' );

	}

	createQueryWorld( solids ) {

		return new Box3DQueryWorld( solids );

	}

	createDynamicWorld( description ) {

		return new Box3DDynamicWorld( description );

	}

}

let loading = null;

/**
 * Loads box3d's WebAssembly, once: every caller shares the module, and its limit of 128 worlds alive at once.
 *
 * @return {Promise<Box3DEngine>}
 */
function load() {

	loading ??= Box3D().then( ( module ) => {

		b3 = module;
		planeResult = b3.createPlaneResult();

		return new Box3DEngine();

	} );

	return loading;

}

export { load };
