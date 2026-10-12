import { Matrix4, Quaternion, Vector3 } from 'three';
import { Box, Cylinder, Tube, Wedge } from '../course/shapes.js';
import { boxSolid, hullSolid, prismSolid } from '@trizendigital/parkour/world/solids.js';

// The demo's world adapter: a Course turned into the world description the core's World takes (the solids to collide
// with, the poles, pipes, ladders, ropes and ziplines to take hold of, the doors and the switches that open them, and
// the spawns). Built piece by piece in the course's order (the engines' answers depend on the order solids are added,
// so the same course always gives the same solids in the same order). A game with a world of its own writes an adapter
// like this one (AGENTS.md, Adapting a world).

const X = new Vector3( 1, 0, 0 );

// A cylinder is a pole the runner can climb when it is this thin and this tall (m), and not decoration.
const POLE_RADIUS = 0.25;
const POLE_HEIGHT = 2;

// A door's leaf is this thick (m): the course's leaf solid, which the world leaves out (DoorsAndSwitches stands in for
// it while the door is shut, since a world never changes).
const LEAF_THICKNESS = 0.05;

// Round things become prisms: 16 sides, 8 for cables and tubes.
const SIDES = 16;
const THIN_SIDES = 8;

// A spawn is a capsule centre: half its height plus the gap it floats above the floor, above the ground (m).
const SPAWN_LIFT = 0.9215;

// A wedge's six corners, as signs along its axes: the floor's four, then the top edge at the high end.
const WEDGE_CORNERS = [ [ - 1, - 1, - 1 ], [ 1, - 1, - 1 ], [ - 1, - 1, 1 ], [ 1, - 1, 1 ], [ - 1, 1, 1 ], [ 1, 1, 1 ] ];

// Its faces: the floor, the high end, the slope and the two sides.
const WEDGE_FACES = [ [ 0, 1, 3, 2 ], [ 2, 3, 5, 4 ], [ 0, 1, 5, 4 ], [ 0, 2, 4 ], [ 1, 3, 5 ] ];

/**
 * @param {Object} course A Course.
 * @return {{ name: string, spawns: Object[], solids: Object[], poles: Object[], pipes: Object[], ziplines: Object[],
 *   ladders: Object[], ropes: Object[], doors: Object[], switches: Object[] }}
 */
function fromCourse( course ) {

	const solids = [], poles = [], pipes = [], ziplines = [];
	const lineOf = new Map( ( course.lines ?? [] ).map( ( line ) => [ line.prim, line ] ) );
	const objectOf = new Map( ( course.objects ?? [] ).map( ( object ) => [ object.prim, object ] ) );
	const bars = new Set( course.prims.filter( ( prim ) => prim.type === 'bar' && prim.shape && prim.collide ).map( ( prim ) => prim.id ) );

	// What every solid of a piece shares: its names and the tags the runner reads.
	const about = ( prim ) => {

		const tags = [];

		if ( prim.type === 'bar' ) tags.push( 'bar' );
		if ( prim.roles.has( 'beam' ) ) tags.push( 'beam' );
		if ( prim.parent && bars.has( prim.parent.id ) ) tags.push( 'barPost' );
		if ( prim.roles.has( 'noClimb' ) || prim.roles.has( 'out' ) ) tags.push( 'noClimb' );
		if ( prim.roles.has( 'out' ) ) tags.push( 'outOfBounds' );

		return { id: prim.id, owner: prim.parent?.id ?? prim.id, tags };

	};

	for ( const prim of course.prims ) {

		const shape = prim.shape;

		if ( ! shape || ! prim.collide ) continue;

		// A door's leaf opens: the doors stand in for it (a breach panel's stays a solid).
		if ( prim.type === 'leaf' && objectOf.get( prim.parent )?.kind === 'door' ) continue;

		if ( prim.type === 'bar' ) {

			// A bar is a box along it, as thick as the bar.
			const along = new Vector3().subVectors( shape.b, shape.a );
			const rotation = new Quaternion().setFromUnitVectors( X, along.clone().normalize() );
			const centre = shape.a.clone().add( shape.b ).multiplyScalar( 0.5 );

			solids.push( boxSolid( { ...about( prim ), position: centre.toArray(), rotation: rotation.toArray(), halfExtents: [ along.length() / 2, shape.r, shape.r ] } ) );

		} else if ( prim.type === 'cable' ) {

			if ( lineOf.get( prim )?.cable?.kind === 'zipline' ) {

				// A zipline is ridden from its high end down; nothing collides with it.
				const [ start, end ] = shape.a.y >= shape.b.y ? [ shape.a, shape.b ] : [ shape.b, shape.a ];
				const forward = new Vector3( end.x - start.x, 0, end.z - start.z ).normalize();

				ziplines.push( { id: prim.id, start: start.clone(), end: end.clone(), forward, radius: shape.r } );

			} else {

				solids.push( prismSolid( { ...about( prim ), a: shape.a, b: shape.b, radius: shape.r, sides: THIN_SIDES } ) );

			}

		} else if ( prim.type === 'pipe' ) {

			// On a pipe the runner faces its wall (against the wall's normal); one with no wall is faced along +z.
			const wall = lineOf.get( prim )?.pipe?.n;
			const forward = wall ? new Vector3( - wall.x, 0, - wall.z ).normalize() : new Vector3( 0, 0, 1 );

			solids.push( prismSolid( { ...about( prim ), a: shape.a, b: shape.b, radius: shape.r, sides: SIDES } ) );
			pipes.push( { id: prim.id, start: shape.a.clone(), end: shape.b.clone(), forward, radius: shape.r } );

		} else if ( shape instanceof Box ) {

			const rotation = new Quaternion().setFromRotationMatrix( new Matrix4().makeBasis( shape.ux, shape.uy, shape.uz ) );

			solids.push( boxSolid( { ...about( prim ), position: shape.c.toArray(), rotation: rotation.toArray(), halfExtents: shape.h.toArray() } ) );

		} else if ( shape instanceof Wedge ) {

			const { c, h, ux, uy, uz } = shape;
			const points = WEDGE_CORNERS.flatMap( ( [ x, y, z ] ) => c.clone().addScaledVector( ux, x * h.x ).addScaledVector( uy, y * h.y ).addScaledVector( uz, z * h.z ).toArray() );

			solids.push( hullSolid( { ...about( prim ), points, polygons: WEDGE_FACES } ) );

		} else if ( shape instanceof Cylinder ) {

			const bottom = new Vector3( shape.x, shape.y0, shape.z ), top = new Vector3( shape.x, shape.y1, shape.z );

			const pole = shape.r <= POLE_RADIUS && shape.y1 - shape.y0 >= POLE_HEIGHT && ! prim.roles.has( 'decor' );
			const named = about( prim );

			// A pole is tagged so: the runner takes hold of it, never plants against it as on a wall.
			if ( pole ) {

				poles.push( { id: prim.id, bottom: bottom.clone(), top: top.clone(), radius: shape.r } );
				named.tags.push( 'pole' );

			}

			solids.push( prismSolid( { ...named, a: bottom, b: top, radius: shape.r, sides: SIDES } ) );

		} else if ( shape instanceof Tube ) {

			solids.push( prismSolid( { ...about( prim ), a: shape.a, b: shape.b, radius: shape.r, sides: THIN_SIDES } ) );

		}

	}

	// On a ladder the runner faces into its wall; a rope swings from its anchor.
	const ladders = [], ropes = [];

	for ( const line of course.lines ?? [] ) {

		if ( line.kind === 'ladder' ) {

			const out = line.ladder.n;

			ladders.push( { id: line.prim.id, start: line.a.clone(), end: line.b.clone(), forward: new Vector3( - out.x, 0, - out.z ).normalize(), width: line.ladder.width } );

		} else if ( line.kind === 'rope' ) {

			ropes.push( { id: line.prim.id, anchor: line.a.clone(), end: line.b.clone(), length: line.a.distanceTo( line.b ) } );

		}

	}

	// A door is its doorway: the middle of its sill, the way it faces (`normal`), the way across it, its size and the
	// hinge side. Valves and buttons face out of their walls; a valve's wheel has its radius, a button its size.
	const doors = [], switches = [];

	for ( const object of course.objects ?? [] ) {

		if ( object.kind === 'door' ) {

			const across = new Vector3( Math.cos( object.yaw ), 0, - Math.sin( object.yaw ) );

			doors.push( {
				id: object.prim.id,
				position: object.p.clone(),
				normal: object.n.clone(),
				across,
				width: object.width,
				height: object.height,
				thickness: LEAF_THICKNESS,
				hinge: object.hinge.clone()
			} );

		} else if ( object.kind === 'valve' || object.kind === 'button' ) {

			switches.push( { id: object.prim.id, kind: object.kind, position: object.p.clone(), normal: object.n.clone(), radius: object.r ?? null, size: object.size ?? null } );

		}

	}

	const spawns = [ { position: new Vector3( course.spawn.position.x, course.spawn.position.y + SPAWN_LIFT, course.spawn.position.z ), yaw: course.spawn.yaw } ];

	for ( const lane of course.def?.lanes ?? [] ) {

		spawns.push( { position: new Vector3( lane.start[ 0 ], lane.start[ 1 ] + SPAWN_LIFT, lane.start[ 2 ] ), yaw: ( lane.yaw ?? 0 ) * Math.PI / 180 } );

	}

	// The course file's named spawns (the tutorial's flags), after the lanes' (spawnIndex finds one).
	for ( const spawn of course.def?.spawns ?? [] ) {

		spawns.push( { position: new Vector3( spawn.p[ 0 ], spawn.p[ 1 ] + SPAWN_LIFT, spawn.p[ 2 ] ), yaw: ( spawn.yaw ?? 0 ) * Math.PI / 180 } );

	}

	return { name: course.name, spawns, solids, poles, pipes, ziplines, ladders, ropes, doors, switches };

}

/**
 * Where a course file's named spawn (one of its `spawns`, by `id`) is among its world's spawns: after the course's own
 * spawn and its lanes'. The course's own (0) when there is none by that name.
 * @param {Object} course A Course.
 * @param {string} id
 * @return {number}
 */
function spawnIndex( course, id ) {

	const i = ( course.def?.spawns ?? [] ).findIndex( ( spawn ) => spawn.id === id );
	return i < 0 ? 0 : 1 + ( course.def?.lanes?.length ?? 0 ) + i;

}

export { fromCourse, spawnIndex };
