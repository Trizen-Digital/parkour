import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Quaternion, Vector3 } from 'three';
import { createEngine } from '../src/engines.js';
import { Queries } from '@trizen/parkour/physics/Queries.js';
import { GROUPS, boxSolid, hullSolid } from '@trizen/parkour/world/solids.js';

// The contract every physics engine keeps, checked on each engine whose backend is present: the course's query world
// (casts, overlaps, penetration, rays, groups) against answers worked out by hand, the dynamic world (bodies, joints,
// starting fresh), and, with two engines, the two against each other over a course.

const ENGINES = {};

for ( const name of [ 'rapier', 'box3d' ] ) {

	try {

		ENGINES[ name ] = await createEngine( name );

	} catch ( error ) {

		// The first engine is always there; the second only once its backend is.
		if ( name === 'rapier' || error.code !== 'ERR_MODULE_NOT_FOUND' || ! error.message.includes( `engines/${ name }.js` ) ) throw error;

	}

}

const DEGREE = Math.PI / 180;
const UP = new Vector3( 0, 1, 0 );
const CAPSULE = { kind: 'capsule', radius: 0.185, halfHeight: 0.9 };
const MM = 0.001;

// A seeded stream of numbers in [ a, b ), so every run asks the same questions.
function randomStream( seed ) {

	return ( a = 0, b = 1 ) => {

		seed = ( seed + 0x6d2b79f5 ) | 0;
		let t = Math.imul( seed ^ ( seed >>> 15 ), 1 | seed );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return a + ( b - a ) * ( ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296 );

	};

}

const turn = ( random ) => new Quaternion().setFromEuler( new Euler( random( - 1, 1 ), random( - 3, 3 ), random( - 1, 1 ) ) );

// A floor whose top is at height 0, `size` across.
const floor = ( size = 20, extra = {} ) => boxSolid( { id: 'floor', position: [ 0, - 0.5, 0 ], halfExtents: [ size / 2, 0.5, size / 2 ], ...extra } );

// A prism of `sides` round the line from a to b, with its faces.
function prism( id, a, b, radius, sides, extra = {} ) {

	const axis = new Vector3().subVectors( b, a ).normalize();
	const u = new Vector3().crossVectors( axis, Math.abs( axis.y ) < 0.9 ? UP : new Vector3( 1, 0, 0 ) ).normalize();
	const v = new Vector3().crossVectors( axis, u );
	const points = [];

	for ( const end of [ a, b ] ) for ( let i = 0; i < sides; i ++ ) points.push( ...end.clone().addScaledVector( u, Math.cos( i / sides * Math.PI * 2 ) * radius ).addScaledVector( v, Math.sin( i / sides * Math.PI * 2 ) * radius ).toArray() );

	const polygons = [ [ ...Array( sides ).keys() ], [ ...Array( sides ).keys() ].map( ( i ) => sides + i ) ];

	for ( let i = 0; i < sides; i ++ ) polygons.push( [ i, ( i + 1 ) % sides, sides + ( i + 1 ) % sides, sides + i ] );

	return hullSolid( { id, points, polygons, ...extra } );

}

// A ramp: a wedge rising along +z from `low` to `high` over `length`, `width` wide, standing on y = 0.
function wedge( id, centre, width, height, length ) {

	const corners = [ [ - 1, 0, - 1 ], [ 1, 0, - 1 ], [ - 1, 0, 1 ], [ 1, 0, 1 ], [ - 1, 1, 1 ], [ 1, 1, 1 ] ];
	const points = corners.flatMap( ( [ x, y, z ] ) => [ centre.x + x * width / 2, centre.y + y * height, centre.z + z * length / 2 ] );

	return hullSolid( { id, points, polygons: [ [ 0, 1, 3, 2 ], [ 2, 3, 5, 4 ], [ 0, 1, 5, 4 ], [ 0, 2, 4 ], [ 1, 3, 5 ] ] } );

}

// A course to ask random questions of: a 30 m floor and boxes (a third of them tilted), ramps, poles and thin tubes
// over it, every tenth solid blocking only some groups.
function course( seed = 7 ) {

	const random = randomStream( seed );
	const solids = [ floor( 30 ) ];
	const groups = ( k ) => k % 10 === 3 ? GROUPS.movement : k % 10 === 6 ? GROUPS.probe | GROUPS.camera : k % 10 === 9 ? GROUPS.camera : undefined;
	const extra = ( k ) => ( groups( k ) ? { groups: groups( k ) } : {} );

	for ( let k = 0; k < 60; k ++ ) {

		const size = [ random( 0.3, 4 ), random( 0.2, 3 ), random( 0.3, 4 ) ];
		const rotation = new Quaternion().setFromAxisAngle( UP, random( 0, Math.PI * 2 ) );

		if ( k % 3 === 0 ) rotation.multiply( new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), random( - 0.6, 0.6 ) ) );
		solids.push( boxSolid( { id: `box${ k }`, position: [ random( - 13, 13 ), size[ 1 ] / 2 + random( 0, 2 ), random( - 13, 13 ) ], rotation: rotation.toArray(), halfExtents: size.map( ( s ) => s / 2 ), ...extra( k ) } ) );

	}

	for ( let k = 0; k < 20; k ++ ) solids.push( { ...wedge( `ramp${ k }`, new Vector3( random( - 13, 13 ), 0, random( - 13, 13 ) ), random( 1, 4 ), random( 0.3, 1.5 ), random( 1, 5 ) ), ...extra( k ) } );

	for ( let k = 0; k < 20; k ++ ) {

		const x = random( - 13, 13 ), z = random( - 13, 13 );

		solids.push( prism( `pole${ k }`, new Vector3( x, 0, z ), new Vector3( x, random( 2, 5 ), z ), random( 0.08, 0.5 ), 16, extra( k ) ) );

	}

	for ( let k = 0; k < 15; k ++ ) {

		const a = new Vector3( random( - 13, 13 ), random( 0.5, 3 ), random( - 13, 13 ) );

		solids.push( prism( `tube${ k }`, a, a.clone().add( new Vector3( random( - 4, 4 ), random( - 1, 1 ), random( - 4, 4 ) ) ), random( 0.04, 0.2 ), 8, extra( k ) ) );

	}

	return solids;

}

const angle = ( a, b ) => a.angleTo( b ) / DEGREE;

for ( const [ name, engine ] of Object.entries( ENGINES ) ) {

	test( `${ name }: a cast stops where the shape touches a flat or sloped face, to within 5 mm`, () => {

		// Slabs whose tops slope by 0°, 15°, 30° and 45°; shapes swept down into them from steep to nearly grazing.
		const slabs = [ 0, 15, 30, 45 ].map( ( degrees, k ) => {

			const rotation = new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), degrees * DEGREE );
			const normal = UP.clone().applyQuaternion( rotation );
			const top = new Vector3( k * 30, 0, 0 );

			return { normal, top, solid: boxSolid( { id: `slab${ degrees }`, position: top.clone().addScaledVector( normal, - 0.5 ).toArray(), rotation: rotation.toArray(), halfExtents: [ 10, 0.5, 10 ] } ) };

		} );
		const world = engine.createQueryWorld( slabs.map( ( slab ) => slab.solid ) );
		const random = randomStream( 3 );

		for ( const kind of [ 'sphere', 'capsule', 'box' ] ) {

			const errors = [];

			for ( let k = 0; k < 300; k ++ ) {

				const { normal, top } = slabs[ k % slabs.length ];
				const rotation = kind === 'sphere' ? new Quaternion() : turn( random );
				const shape = kind === 'sphere' ? { kind, radius: random( 0.05, 0.5 ) } : kind === 'capsule' ? CAPSULE : { kind, halfExtents: new Vector3( random( 0.05, 0.6 ), random( 0.05, 1 ), random( 0.05, 0.6 ) ) };

				// How far the shape reaches below its centre, along the slab's normal.
				let reach = shape.radius ?? 0;

				if ( kind === 'capsule' ) reach += Math.abs( new Vector3( 0, shape.halfHeight - shape.radius, 0 ).applyQuaternion( rotation ).dot( normal ) );
				if ( kind === 'box' ) for ( const x of [ - 1, 1 ] ) for ( const y of [ - 1, 1 ] ) for ( const z of [ - 1, 1 ] ) reach = Math.max( reach, - new Vector3( x, y, z ).multiply( shape.halfExtents ).applyQuaternion( rotation ).dot( normal ) );

				const height = reach + random( 0.05, 2 );
				const from = top.clone().add( new Vector3( random( - 3, 3 ), 0, random( - 3, 3 ) ).projectOnPlane( normal ) ).addScaledVector( normal, height );
				const tilt = random( 5, 90 ) * DEGREE;
				const along = new Vector3( random( - 1, 1 ), 0, random( - 1, 1 ) ).projectOnPlane( normal ).normalize().multiplyScalar( Math.cos( tilt ) ).addScaledVector( normal, - Math.sin( tilt ) );
				const length = ( height - reach ) / Math.sin( tilt ) + random( 0.1, 1 );
				const hit = world.cast( shape, from, from.clone().addScaledVector( along, length ), { rotation } );

				// Only hits on the slab's top: near its edge a sweep can catch its side.
				if ( hit && angle( hit.normal, normal ) < 5 ) errors.push( ( hit.fraction * length - ( height - reach ) / Math.sin( tilt ) ) * Math.sin( tilt ) );

			}

			assert.ok( errors.length > 270, `${ kind }: ${ errors.length } of 300 casts met the slab` );
			assert.ok( Math.max( ...errors.map( Math.abs ) ) < 5 * MM, `${ kind }: worst ${ Math.max( ...errors.map( Math.abs ) ) / MM } mm` );

		}

		world.dispose();

	} );

	test( `${ name }: a cast reports how far it went, where it touched on the solid, and the solid's normal there`, () => {

		const ramp = wedge( 'ramp', new Vector3( 0, 0, 20 ), 4, 2, 4 );
		const wall = boxSolid( { id: 'wall', position: [ 20, 1, 0 ], halfExtents: [ 0.5, 2, 2 ] } );
		const world = engine.createQueryWorld( [ floor( 20 ), wall, ramp ] );
		const near = ( actual, expected, tolerance = 0.1 * MM ) => assert.ok( Math.abs( actual - expected ) < tolerance, `${ actual } is not ${ expected }` );

		// The capsule straight down onto the floor: its bottom (0.9 m below its centre) meets the floor's top.
		let hit = world.cast( CAPSULE, new Vector3( 0, 3, 0 ), new Vector3( 0, - 1, 0 ) );
		near( hit.fraction, 2.1 / 4 );
		assert.ok( angle( hit.normal, UP ) < 0.01 );
		near( hit.point.y, 0 );
		near( hit.point.x, 0, 1 * MM );
		assert.equal( hit.solid.id, 'floor' );

		// A sphere, and the floor sweep's box turned 45° about the vertical, the same way.
		near( world.cast( { kind: 'sphere', radius: 0.3 }, new Vector3( 0.5, 3, 0.5 ), new Vector3( 0.5, - 1, 0.5 ) ).fraction, 2.7 / 4 );
		hit = world.cast( { kind: 'box', halfExtents: new Vector3( 0.13, 0.9, 0.13 ) }, new Vector3( 0.2, 3, 0.2 ), new Vector3( 0.2, - 1, 0.2 ), { rotation: new Quaternion().setFromAxisAngle( UP, Math.PI / 4 ) } );
		near( hit.fraction, 2.1 / 4 );
		assert.ok( angle( hit.normal, UP ) < 0.01 );

		// The capsule sideways into the wall: its side meets the wall's face at x = 19.5.
		hit = world.cast( CAPSULE, new Vector3( 15, 1.5, 0 ), new Vector3( 25, 1.5, 0 ) );
		near( hit.fraction * 10, 4.5 - 0.185 );
		assert.ok( angle( hit.normal, new Vector3( - 1, 0, 0 ) ) < 0.01 );
		near( hit.point.x, 19.5 );
		assert.equal( hit.solid.id, 'wall' );

		// A sphere level into the ramp's slope (a hull): at its height the slope is at z = 20, and the sphere stops
		// one radius off it along the slope's normal.
		const slope = new Vector3( 0, 2, - 1 ).normalize();
		hit = world.cast( { kind: 'sphere', radius: 0.1 }, new Vector3( 0, 1, 15 ), new Vector3( 0, 1, 25 ) );
		near( 15 + hit.fraction * 10, 20 - 0.1 / - slope.z, 0.5 * MM );
		assert.ok( angle( hit.normal, slope ) < 0.1 );
		assert.equal( hit.solid.id, 'ramp' );

		// Nothing in the way: no hit.
		assert.equal( world.cast( CAPSULE, new Vector3( 0, 3, 0 ), new Vector3( 0, 2, 0 ) ), null );

		world.dispose();

	} );

	test( `${ name }: a sweep that starts inside a solid meets it at once when probing, and passes out of it when moving`, () => {

		const world = engine.createQueryWorld( [ floor( 20 ) ] );

		// The capsule with its bottom `gap` above the floor (below it when negative), pushed 1 m at an angle.
		const sweep = ( gap, degrees, stopAtPenetration ) => {

			const from = new Vector3( 0, 0.9 + gap, 0 );

			return world.cast( CAPSULE, from, from.clone().add( new Vector3( Math.cos( degrees * DEGREE ), Math.sin( degrees * DEGREE ), 0 ) ), { stopAtPenetration } );

		};

		// 5 cm in: a probe meets the floor at once whichever way it goes; a move out of it, or along it, passes.
		for ( const degrees of [ 90, 30, 0, - 30, - 90 ] ) assert.equal( sweep( - 0.05, degrees, true )?.fraction, 0, `${ degrees }°` );
		for ( const degrees of [ 90, 30, 0 ] ) assert.equal( sweep( - 0.05, degrees, false ), null, `${ degrees }°` );
		for ( const degrees of [ - 30, - 90 ] ) assert.equal( sweep( - 0.05, degrees, false )?.fraction, 0, `${ degrees }°` );

		// 2 mm above: down meets it 2 mm on (4 mm along a 30° sweep); away or along misses it.
		for ( const stopAtPenetration of [ true, false ] ) {

			assert.ok( Math.abs( sweep( 0.002, - 90, stopAtPenetration ).fraction - 0.002 ) < 0.1 * MM );
			assert.ok( Math.abs( sweep( 0.002, - 30, stopAtPenetration ).fraction - 0.004 ) < 0.1 * MM );
			for ( const degrees of [ 90, 30, 0 ] ) assert.equal( sweep( 0.002, degrees, stopAtPenetration ), null, `${ degrees }°` );

		}

		world.dispose();

	} );

	test( `${ name }: penetration is the deepest contact a shape is inside, with the way out; touching is not inside`, () => {

		const world = engine.createQueryWorld( [ floor( 20 ) ] );

		for ( const [ y, depth ] of [ [ 0.95, null ], [ 0.9, null ], [ 0.899, 0.001 ], [ 0.85, 0.05 ], [ 0.6, 0.3 ], [ 0.3, 0.6 ] ] ) {

			const contact = world.penetration( CAPSULE, new Vector3( 1, y, 2 ) );

			if ( depth === null ) {

				assert.equal( contact, null, `at ${ y }` );
				continue;

			}

			assert.ok( Math.abs( contact.depth - depth ) < 0.01 * MM, `at ${ y }: ${ contact.depth }` );
			assert.ok( angle( contact.normal, UP ) < 0.01 );
			assert.ok( Math.abs( contact.point.y ) < 0.01 * MM );
			assert.equal( contact.solid.id, 'floor' );

			// Counting a touch changes nothing where the shape is inside.
			assert.equal( world.penetration( CAPSULE, new Vector3( 1, y, 2 ), { touching: true } ).solid.id, 'floor' );

		}

		// The deepest of two: a sphere 10 cm into a wall and 1 cm into the floor.
		const two = engine.createQueryWorld( [ floor( 20 ), boxSolid( { id: 'wall', position: [ 1, 1, 0 ], halfExtents: [ 0.5, 1, 1 ] } ) ] );
		const contact = two.penetration( { kind: 'sphere', radius: 0.3 }, new Vector3( 0.3, 0.29, 0 ) );

		assert.equal( contact.solid.id, 'wall' );
		assert.ok( Math.abs( contact.depth - 0.1 ) < 0.01 * MM );
		assert.ok( angle( contact.normal, new Vector3( - 1, 0, 0 ) ) < 0.01 );

		world.dispose();
		two.dispose();

	} );

	test( `${ name }: overlap lists every solid a shape is in, past a depth if asked`, () => {

		const left = boxSolid( { id: 'left', position: [ 0, 0.5, 0 ], halfExtents: [ 0.5, 0.5, 0.5 ] } );
		const right = boxSolid( { id: 'right', position: [ 1.5, 0.5, 0 ], halfExtents: [ 0.5, 0.5, 0.5 ] } );
		const world = engine.createQueryWorld( [ left, right ] );
		const ids = ( solids ) => solids.map( ( solid ) => solid.id ).sort();
		const sphere = ( radius ) => ( { kind: 'sphere', radius } );

		// Between the two, 25 cm from each.
		assert.deepEqual( ids( world.overlap( sphere( 0.4 ), new Vector3( 0.75, 0.5, 0 ) ) ), [ 'left', 'right' ] );
		assert.deepEqual( ids( world.overlap( sphere( 0.4 ), new Vector3( 0.75, 0.5, 0 ), { minDepth: 0.1 } ) ), [ 'left', 'right' ] );
		assert.deepEqual( ids( world.overlap( sphere( 0.4 ), new Vector3( 0.75, 0.5, 0 ), { minDepth: 0.2 } ) ), [] );
		assert.deepEqual( ids( world.overlap( sphere( 0.3 ), new Vector3( 0.6, 0.5, 0 ) ) ), [ 'left' ] );
		assert.deepEqual( ids( world.overlap( sphere( 0.2 ), new Vector3( 0.75, 0.5, 0 ) ) ), [] );

		// A box turned 45° about the vertical reaches further than square on.
		const box = { kind: 'box', halfExtents: new Vector3( 0.2, 0.2, 0.2 ) };
		assert.deepEqual( ids( world.overlap( box, new Vector3( 0.75, 0.5, 0 ) ) ), [] );
		assert.deepEqual( ids( world.overlap( box, new Vector3( 0.75, 0.5, 0 ), { rotation: new Quaternion().setFromAxisAngle( UP, Math.PI / 4 ) } ) ), [ 'left', 'right' ] );

		world.dispose();

	} );

	test( `${ name }: penetration finds a capsule sunk 1 to 150 mm into a 20 m floor, to 0.02 mm`, () => {

		const world = engine.createQueryWorld( [ floor( 20 ) ] );
		const random = randomStream( 5 );

		for ( let k = 0; k < 300; k ++ ) {

			const depth = random( 0.001, 0.15 );
			const contact = world.penetration( CAPSULE, new Vector3( random( - 9, 9 ), 0.9 - depth, random( - 9, 9 ) ) );

			assert.ok( contact && Math.abs( contact.depth - depth ) < 0.02 * MM, `${ depth }: ${ contact?.depth }` );

		}

		world.dispose();

	} );

	test( `${ name }: a ray hits the nearest solid within its reach, and one it starts inside at once`, () => {

		const pole = prism( 'pole', new Vector3( 0, 0, - 5 ), new Vector3( 0, 4, - 5 ), 0.3, 16 );
		const world = engine.createQueryWorld( [ floor( 20 ), boxSolid( { id: 'block', position: [ 0, 1, 5 ], halfExtents: [ 1, 1, 1 ] } ), pole ] );
		const near = ( actual, expected ) => assert.ok( Math.abs( actual - expected ) < 0.01 * MM, `${ actual } is not ${ expected }` );
		const ahead = new Vector3( 0, 0, 1 );

		let hit = world.ray( new Vector3( 0, 1, 0 ), ahead, 10 );
		near( hit.distance, 4 );
		near( hit.point.z, 4 );
		assert.ok( angle( hit.normal, new Vector3( 0, 0, - 1 ) ) < 0.01 );
		assert.equal( hit.solid.id, 'block' );

		assert.equal( world.ray( new Vector3( 0, 1, 0 ), ahead, 3.9 ), null );

		hit = world.ray( new Vector3( 3, 2, 0 ), new Vector3( 0, - 1, 0 ), 5 );
		near( hit.distance, 2 );
		assert.equal( hit.solid.id, 'floor' );

		// From inside the block: at once.
		hit = world.ray( new Vector3( 0, 1, 5 ), ahead, 10 );
		assert.equal( hit.distance, 0 );
		assert.equal( hit.solid.id, 'block' );

		// A hull: at the middle of one of the pole's sixteen faces, square on to it.
		const face = new Vector3( Math.sin( Math.PI / 16 ), 0, Math.cos( Math.PI / 16 ) );
		hit = world.ray( new Vector3( 0, 1, - 5 ).addScaledVector( face, 3 ), face.clone().negate(), 10 );
		near( hit.distance, 3 - 0.3 * Math.cos( Math.PI / 16 ) );
		assert.ok( angle( hit.normal, face ) < 0.01 );
		assert.equal( hit.solid.id, 'pole' );

		world.dispose();

	} );

	test( `${ name }: a query sees only the solids that block its group, and every solid with no group`, () => {

		const camera = boxSolid( { id: 'camera', position: [ 0, 1, 3 ], halfExtents: [ 1, 1, 0.5 ], groups: GROUPS.camera } );
		const world = engine.createQueryWorld( [ floor( 20 ), camera ] );
		const sphere = { kind: 'sphere', radius: 0.2 };
		const from = new Vector3( 0, 1, 0 ), to = new Vector3( 0, 1, 6 ), inside = new Vector3( 0, 1, 3 );

		for ( const [ group, sees ] of [ [ GROUPS.camera, true ], [ undefined, true ], [ GROUPS.probe, false ], [ GROUPS.movement, false ], [ GROUPS.ragdoll, false ] ] ) {

			assert.equal( world.cast( sphere, from, to, { group } )?.solid.id === 'camera', sees, `cast, group ${ group }` );
			assert.equal( world.overlap( sphere, inside, { group } ).length === 1, sees, `overlap, group ${ group }` );
			assert.equal( world.penetration( sphere, inside, { group } )?.solid.id === 'camera', sees, `penetration, group ${ group }` );
			assert.equal( world.ray( from, new Vector3( 0, 0, 1 ), 6, { group } )?.solid.id === 'camera', sees, `ray, group ${ group }` );

		}

		// The floor blocks every group.
		for ( const group of Object.values( GROUPS ) ) assert.equal( world.ray( new Vector3( 5, 1, 0 ), new Vector3( 0, - 1, 0 ), 2, { group } )?.solid.id, 'floor' );

		world.dispose();

	} );

	test( `${ name }: the same solids added in the same order give the same answers, bit for bit`, () => {

		const solids = course();
		const worlds = [ engine.createQueryWorld( solids ), engine.createQueryWorld( solids ) ];
		const random = randomStream( 9 );

		for ( let k = 0; k < 300; k ++ ) {

			const from = new Vector3( random( - 14, 14 ), random( 0.3, 4 ), random( - 14, 14 ) );
			const to = from.clone().add( new Vector3( random( - 6, 6 ), random( - 4, 1 ), random( - 6, 6 ) ) );
			const shape = [ CAPSULE, { kind: 'sphere', radius: random( 0.05, 0.5 ) }, { kind: 'box', halfExtents: new Vector3( 0.3, 0.6, 0.2 ) } ][ k % 3 ];
			const rotation = turn( random );
			const answers = worlds.map( ( world ) => JSON.stringify( [
				world.cast( shape, from, to, { rotation } ),
				world.penetration( shape, from, { rotation } ),
				world.overlap( shape, from, { rotation } ).map( ( solid ) => solid.id ),
				world.ray( from, to.clone().sub( from ).normalize(), 6 )
			], ( key, value ) => key === 'solid' ? value.id : value ) );

			assert.equal( answers[ 0 ], answers[ 1 ] );

		}

		for ( const world of worlds ) world.dispose();

	} );

	test( `${ name }: a hit's face is the solid's own, whatever the engine's contact normal at an edge`, () => {

		const ramp = wedge( 'ramp', new Vector3( 0, 0, 0 ), 4, 2, 4 );
		const tilted = new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), 0.3 );
		const block = boxSolid( { id: 'block', position: [ 10, 1, 0 ], rotation: tilted.toArray(), halfExtents: [ 1, 1, 1 ] } );
		const queries = new Queries( engine.createQueryWorld( [ ramp, block ] ) );
		const [ , high, slope, side ] = ramp.faces;

		// Down onto the ramp's top edge: the contact leans between the slope and the high end; the face met going down
		// is the slope.
		let hit = queries.capsuleCast( new Vector3( 0, 4, 2 ), new Vector3( 0, 0, 2 ), 0.185, 0.9, { group: 'movement' } );
		assert.ok( Math.abs( hit.point.z - 2 ) < 1 * MM && Math.abs( hit.point.y - 2 ) < 1 * MM );
		assert.deepEqual( hit.faceNormal.toArray(), slope.normal.toArray() );

		// Level into the same edge from beyond the high end: the face met is the high end's.
		hit = queries.sphereCast( new Vector3( 0, 2, 5 ), new Vector3( 0, 2, - 1 ), 0.2, { group: 'probe' } );
		assert.deepEqual( hit.faceNormal.toArray(), high.normal.toArray() );

		// Sideways into its side.
		hit = queries.sphereCast( new Vector3( - 5, 0.5, 0 ), new Vector3( 0, 0.5, 0 ), 0.2, { group: 'probe' } );
		assert.deepEqual( hit.faceNormal.toArray(), side.normal.toArray() );

		// A box's face by its own axes: the tilted block's top.
		hit = queries.sphereCast( new Vector3( 10, 5, 0 ), new Vector3( 10, 0, 0 ), 0.2, { group: 'probe' } );
		assert.deepEqual( hit.faceNormal.toArray(), UP.clone().applyQuaternion( tilted ).toArray() );

		queries.world.dispose();

	} );

	// The dynamic world, as the ragdoll uses it: the game's gravity and solver passes, the course's material.
	const dynamicWorld = ( { gravity = - 9.8, solids = [ floor( 20 ) ] } = {} ) => engine.createDynamicWorld( { gravity: new Vector3( 0, gravity, 0 ), iterations: 8, solids, friction: 0.7, restitution: 0.3 } );

	const cube = ( position, { half = 0.5, density = 100, velocity = new Vector3(), shape } = {} ) => ( {
		position,
		rotation: new Quaternion(),
		linearVelocity: velocity,
		linearDamping: 0,
		angularDamping: 0,
		continuous: false,
		shapes: [ { shape: shape ?? { kind: 'box', halfExtents: new Vector3( half, half, half ) }, offset: new Vector3(), rotation: new Quaternion(), density, friction: 0.55, restitution: 0 } ]
	} );

	const run = ( world, steps ) => {

		for ( let k = 0; k < steps; k ++ ) world.step( 1 / 120 );

	};

	test( `${ name }: a body falls and comes to rest on a solid`, () => {

		const world = dynamicWorld();
		const body = world.addBody( cube( new Vector3( 0, 2, 0 ) ) );

		run( world, 30 );
		assert.ok( body.linearVelocity().y < - 2 );
		run( world, 210 );
		assert.ok( Math.abs( body.position().y - 0.5 ) < 0.01, `${ body.position().y }` );
		assert.ok( body.linearVelocity().length() < 0.05 );

		world.dispose();

	} );

	test( `${ name }: a body's mass and inertia come from its shapes, and impulses move and turn it by them`, () => {

		const world = dynamicWorld( { gravity: 0, solids: [] } );
		const body = world.addBody( cube( new Vector3( 0, 5, 0 ), { half: 0.5, density: 100 } ) );
		const close = ( actual, expected, tolerance ) => assert.ok( Math.abs( actual - expected ) < tolerance, `${ actual } is not ${ expected }` );

		// A 1 m cube of 100 kg/m³: 100 kg, and 100 · ( 1 + 1 ) / 12 kg·m² about each axis.
		close( body.mass(), 100, 0.01 );
		const [ m11, m12, m13, m22, m23, m33 ] = body.inverseInertiaWorld();
		for ( const diagonal of [ m11, m22, m33 ] ) close( diagonal, 0.06, 1e-5 );
		for ( const off of [ m12, m13, m23 ] ) close( off, 0, 1e-6 );

		body.applyImpulse( new Vector3( 10, 0, 0 ) );
		close( body.linearVelocity().x, 0.1, 1e-6 );
		body.applyAngularImpulse( new Vector3( 0, 1, 0 ) );
		close( body.angularVelocity().y, 0.06, 1e-6 );

		// A capsule: its mass is the density over its whole volume, the hemispheres included.
		const capsule = world.addBody( cube( new Vector3( 5, 5, 0 ), { shape: { kind: 'capsule', radius: 0.1, halfLength: 0.2 }, density: 1000 } ) );
		close( capsule.mass(), 1000 * ( Math.PI * 0.01 * 0.4 + 4 / 3 * Math.PI * 0.001 ), 0.01 );

		world.dispose();

	} );

	const jointed = ( kind, extra = {} ) => {

		const world = dynamicWorld( { gravity: 0, solids: [] } );
		const parent = world.addBody( cube( new Vector3( 0, 5, 0 ), { half: 0.25 } ) );
		const body = world.addBody( cube( new Vector3( 1, 5, 0 ), { half: 0.25 } ) );

		world.addJoint( { kind, body, parent, anchor: new Vector3( - 0.5, 0, 0 ), parentAnchor: new Vector3( 0.5, 0, 0 ), collide: false, ...extra } );

		// Where the two anchors are now.
		const anchors = () => [ [ body, - 0.5 ], [ parent, 0.5 ] ].map( ( [ b, x ] ) => new Vector3( x, 0, 0 ).applyQuaternion( b.rotation() ).add( b.position() ) );

		return { world, parent, body, anchors };

	};

	test( `${ name }: a ball joint keeps its anchors together however the bodies turn`, () => {

		const { world, body, anchors } = jointed( 'ball' );

		body.applyImpulse( new Vector3( 0, 20, 10 ) );
		body.applyAngularImpulse( new Vector3( 1, 2, 3 ) );
		run( world, 120 );

		const [ a, b ] = anchors();
		assert.ok( a.distanceTo( b ) < 0.01, `${ a.distanceTo( b ) }` );
		assert.ok( body.rotation().angleTo( new Quaternion() ) > 0.1 );

		world.dispose();

	} );

	test( `${ name }: a hinge turns only about its axis, and only as far as its limits`, () => {

		const { world, body, parent, anchors } = jointed( 'hinge', { axis: new Vector3( 0, 0, 1 ), frame: new Quaternion(), parentFrame: new Quaternion(), limits: [ - 0.3, 0.3 ], center: 0 } );

		body.applyAngularImpulse( new Vector3( 2, 2, 5 ) );
		body.applyImpulse( new Vector3( 0, 10, 0 ) );

		let widest = 0;

		for ( let k = 0; k < 240; k ++ ) {

			world.step( 1 / 120 );

			// The body's turn relative to its parent: its X axis swung about Z, its Z axis kept.
			const relative = parent.rotation().invert().multiply( body.rotation() );
			const x = new Vector3( 1, 0, 0 ).applyQuaternion( relative );

			widest = Math.max( widest, Math.abs( Math.atan2( x.y, x.x ) ) );
			assert.ok( new Vector3( 0, 0, 1 ).applyQuaternion( relative ).angleTo( new Vector3( 0, 0, 1 ) ) < 0.05 );

		}

		assert.ok( widest > 0.2 && widest < 0.35, `${ widest }` );
		const [ a, b ] = anchors();
		assert.ok( a.distanceTo( b ) < 0.01 );

		world.dispose();

	} );

	test( `${ name }: a hinge's limits hold the same way round on every engine`, () => {

		// Limits of [ 0, 0.5 ] measure the parent's turn from the body: the body may turn back about the axis by up to
		// 0.5 rad, and not forward at all.
		for ( const spin of [ 2, - 2 ] ) {

			const { world, body, parent } = jointed( 'hinge', { axis: new Vector3( 0, 0, 1 ), frame: new Quaternion(), parentFrame: new Quaternion(), limits: [ 0, 0.5 ], center: 0 } );
			let least = 0, most = 0;

			body.applyAngularImpulse( new Vector3( 0, 0, spin ) );

			for ( let k = 0; k < 240; k ++ ) {

				world.step( 1 / 120 );

				const x = new Vector3( 1, 0, 0 ).applyQuaternion( parent.rotation().invert().multiply( body.rotation() ) );
				const turned = Math.atan2( x.y, x.x );

				least = Math.min( least, turned );
				most = Math.max( most, turned );

			}

			if ( spin > 0 ) assert.ok( most < 0.01, `spun forward: turned to ${ most }` );
			else assert.ok( least > - 0.52 && least < - 0.45, `spun back: turned to ${ least }` );

			world.dispose();

		}

	} );

	test( `${ name }: two bodies kept apart pass through each other; any others push apart`, () => {

		for ( const apart of [ false, true ] ) {

			const world = dynamicWorld( { gravity: 0, solids: [] } );
			const a = world.addBody( cube( new Vector3( 0, 5, 0 ) ) );
			const b = world.addBody( cube( new Vector3( 0.5, 5, 0 ) ) );

			if ( apart ) world.disableCollision( a, b );
			run( world, 60 );
			assert.equal( b.position().x - a.position().x > 0.9, ! apart );

			world.dispose();

		}

	} );

	test( `${ name }: a fresh world runs the same again, bit for bit, and a removed body leaves it`, () => {

		const world = dynamicWorld();

		const drop = () => {

			const parent = world.addBody( cube( new Vector3( 0, 1.5, 0 ), { half: 0.25, velocity: new Vector3( 1, 0, 0 ) } ) );
			const body = world.addBody( cube( new Vector3( 0.6, 1.8, 0.1 ), { half: 0.2 } ) );

			world.addJoint( { kind: 'ball', body, parent, anchor: new Vector3( - 0.3, 0, 0 ), parentAnchor: new Vector3( 0.3, 0.3, 0 ), collide: false } );
			world.disableCollision( body, parent );
			run( world, 120 );

			return { parent, body, rest: [ parent, body ].flatMap( ( b ) => [ ...b.position().toArray(), ...b.rotation().toArray() ] ) };

		};

		const first = drop();

		world.fresh();
		assert.deepEqual( drop().rest, first.rest );

		// Take the bodies out: one dropped where they lay falls to the floor.
		world.fresh();
		const again = drop();
		const where = again.parent.position().setY( 2 );
		world.removeBody( again.parent );
		world.removeBody( again.body );
		const body = world.addBody( cube( where, { half: 0.25 } ) );
		run( world, 180 );
		assert.ok( Math.abs( body.position().y - 0.25 ) < 0.01, `${ body.position().y }` );

		world.dispose();

	} );

}

// Two engines over the same course: they answer alike, to within what each engine's own precision allows (a cast on a
// 30 m floor can stop a few millimetres apart; at an edge the contact normals may lean differently).
const [ first, second ] = Object.keys( ENGINES );
const both = { skip: second ? false : 'only one engine is present' };

test( 'two engines agree on sweeps over a course: hit or miss, the solid, how far, and the normal', both, () => {

	const solids = course();
	const [ a, b ] = [ first, second ].map( ( name ) => ENGINES[ name ].createQueryWorld( solids ) );
	const random = randomStream( 11 );

	for ( const kind of [ 'sphere', 'capsule', 'box' ] ) {

		let agree = 0, sameSolid = 0, close = 0, aligned = 0, outside = 0;
		const count = 1000;

		for ( let k = 0; k < count; k ++ ) {

			const from = new Vector3( random( - 14, 14 ), random( 0.3, 5 ), random( - 14, 14 ) );
			const along = new Vector3( random( - 1, 1 ), random( - 1, 0.4 ), random( - 1, 1 ) ).normalize();
			const to = from.clone().addScaledVector( along, random( 0.5, 8 ) );
			const rotation = random() < 0.5 ? turn( random ) : new Quaternion();
			const shape = kind === 'sphere' ? { kind, radius: random( 0.05, 0.5 ) } : kind === 'capsule' ? { kind, radius: random( 0.1, 0.3 ), halfHeight: random( 0.35, 1 ) } : { kind, halfExtents: new Vector3( random( 0.05, 0.6 ), random( 0.05, 1 ), random( 0.05, 0.6 ) ) };
			const group = [ GROUPS.movement, GROUPS.probe, GROUPS.camera ][ k % 3 ];
			const [ x, y ] = [ a, b ].map( ( world ) => world.cast( shape, from, to, { group, rotation } ) );

			if ( !! x === !! y ) agree ++;
			if ( ! x || ! y || x.fraction === 0 || y.fraction === 0 ) continue;

			outside ++;
			if ( x.solid === y.solid ) sameSolid ++;
			if ( Math.abs( x.fraction - y.fraction ) * from.distanceTo( to ) * Math.abs( along.dot( x.normal ) ) < 5 * MM ) close ++;
			if ( angle( x.normal, y.normal ) < 5 ) aligned ++;

		}

		assert.ok( agree >= 0.995 * count, `${ kind }: hit or miss agree ${ agree } of ${ count }` );
		assert.ok( sameSolid >= 0.99 * outside, `${ kind }: same solid ${ sameSolid } of ${ outside }` );
		assert.ok( close >= 0.99 * outside, `${ kind }: within 5 mm ${ close } of ${ outside }` );
		assert.ok( aligned >= 0.98 * outside, `${ kind }: normals within 5° ${ aligned } of ${ outside }` );

	}

	a.dispose();
	b.dispose();

} );

test( 'two engines agree on overlaps, penetration and rays over a course', both, () => {

	const solids = course();
	const [ a, b ] = [ first, second ].map( ( name ) => ENGINES[ name ].createQueryWorld( solids ) );
	const random = randomStream( 21 );
	const ids = ( list ) => list.map( ( solid ) => solid.id ).sort().join( ' ' );
	const count = 1500;
	let sameOverlap = 0, deep = 0, closeDepth = 0, rays = 0, sameRay = 0;

	for ( let k = 0; k < count; k ++ ) {

		const at = new Vector3( random( - 14, 14 ), random( 0.2, 4 ), random( - 14, 14 ) );
		const rotation = turn( random );
		const shape = k % 3 === 0 ? { kind: 'sphere', radius: random( 0.1, 0.9 ) } : k % 3 === 1 ? CAPSULE : { kind: 'box', halfExtents: new Vector3( random( 0.1, 1 ), random( 0.1, 1 ), random( 0.1, 1 ) ) };

		if ( ids( a.overlap( shape, at, { rotation } ) ) === ids( b.overlap( shape, at, { rotation } ) ) ) sameOverlap ++;

		// Shallow contacts, where the mover works: the depth and the way out.
		const [ x, y ] = [ a, b ].map( ( world ) => world.penetration( shape, at, { rotation } ) );

		if ( shape.kind !== 'box' && x && y && x.depth < shape.radius && y.depth < shape.radius ) {

			deep ++;
			if ( Math.abs( x.depth - y.depth ) < 0.5 * MM && angle( x.normal, y.normal ) < 1 ) closeDepth ++;

		}

		const direction = new Vector3( random( - 1, 1 ), random( - 1, 0.3 ), random( - 1, 1 ) ).normalize();
		const [ r, s ] = [ a, b ].map( ( world ) => world.ray( at, direction, 10 ) );

		// A ray that starts where two solids overlap starts inside both: either is the right answer.
		rays ++;
		if ( ( ! r && ! s ) || ( r && s && r.distance === 0 && s.distance === 0 ) || ( r && s && r.solid === s.solid && Math.abs( r.distance - s.distance ) < 0.1 * MM ) ) sameRay ++;

	}

	assert.ok( sameOverlap >= 0.995 * count, `overlaps agree ${ sameOverlap } of ${ count }` );
	assert.ok( closeDepth >= 0.99 * deep, `shallow penetrations agree ${ closeDepth } of ${ deep }` );
	assert.ok( sameRay >= 0.995 * rays, `rays agree ${ sameRay } of ${ rays }` );

	a.dispose();
	b.dispose();

} );
