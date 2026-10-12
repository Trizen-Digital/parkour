// A world made by hand, with no course: the core runs the runner in any world description, as a game with a world of
// its own would give it (AGENTS.md, Adapting a world), through the packages' public entry points only. And World
// refuses a description that would fail later, saying what is wrong.

import test from 'node:test';
import assert from 'node:assert/strict';

await import( '../tools/headless/env.mjs' );
const { Vector3 } = await import( 'three' );
const { Simulation, World, Figure, boxSolid, prismSolid } = await import( '@trizen/parkour' );
const box3d = ( await import( '@trizen/parkour-box3d' ) ).default;
const rapier = ( await import( '@trizen/parkour-rapier' ) ).default;

const NO_PAGE = { storage: null, eventWindow: null, eventDocument: null, navigator: null };

// The example in AGENTS.md: a floor, a wall and a pole, the spawn 2 m up so the runner drops onto the floor.
const description = () => ( {
	name: 'a world made by hand',
	spawns: [ { position: new Vector3( 0, 2, 0 ), yaw: 0 } ],
	solids: [
		boxSolid( { id: 'floor', position: [ 0, - 0.5, 0 ], halfExtents: [ 50, 0.5, 50 ] } ),
		boxSolid( { id: 'wall', position: [ 0, 1.5, 6 ], halfExtents: [ 3, 1.5, 0.25 ] } ),
		prismSolid( { id: 'pole', a: new Vector3( 4, 0, 4 ), b: new Vector3( 4, 4, 4 ), radius: 0.06, tags: [ 'pole' ] } ),
	],
	poles: [ { id: 'pole', bottom: new Vector3( 4, 0, 4 ), top: new Vector3( 4, 4, 4 ), radius: 0.06 } ],
} );

// Two seconds at 60 frames a second, with W held from the second half on.
async function run( engine ) {

	const sim = new Simulation( { world: new World( description() ), figure: new Figure(), engine, page: NO_PAGE } );
	await sim.load();
	const path = [];
	for ( let f = 0; f < 120; f ++ ) {

		const keys = f >= 60 ? [ 'KeyW' ] : [];
		for ( const key of keys ) if ( ! sim.input.keys.has( key ) ) sim.input.queueKey( key, 'pressed' );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( keys );
			input.enabled = true;

		} );
		path.push( sim.runner.position.toArray() );

	}

	return { sim, path };

}

for ( const engine of [ box3d, rapier ] ) {

	test( `the runner lands and runs in a world made by hand, on ${engine.name}, the same every time`, async () => {

		const first = await run( engine ), second = await run( engine );
		const [ x, y, z ] = first.path.at( - 1 );
		assert.equal( first.sim.engine, engine.name );
		assert.ok( Math.abs( y - 0.9215 ) < 0.05, `stands on the floor (capsule centre ${y})` );
		assert.ok( z > 0.5 && Math.abs( x ) < 0.1, `ran forward, along +Z (${x}, ${z})` );
		assert.deepEqual( second.path, first.path, 'the same input in the same world makes the same run' );

	} );

}

test( 'World says what is wrong with a description', () => {

	const fails = ( change, message ) => {

		const d = description();
		change( d );
		assert.throws( () => new World( d ), message );

	};

	fails( ( d ) => d.spawns = [], /spawns: at least one spawn/ );
	fails( ( d ) => d.solids[ 1 ].shape.halfExtents = [ 1, 0, 1 ], /solids\[1\] \(wall\): a box needs three positive half extents/ );
	fails( ( d ) => d.solids.push( { id: 'flat', groups: 15, tags: [], shape: { kind: 'hull', points: [ 0, 0, 0, 1, 0, 0, 0, 0, 1 ] } } ), /a hull needs at least four points/ );
	fails( ( d ) => d.poles[ 0 ].radius = undefined, /poles\[0\] \(pole\): radius must be a number/ );
	fails( ( d ) => d.floor = 'low', /floor: must be a number/ );
	assert.throws( () => new World( { name: 'a course', prims: [], spawn: {} } ), /a course, not a world description/ );
	assert.throws( () => new Simulation( { world: new World( description() ), page: NO_PAGE } ), /options.engine must be a physics engine backend/ );
	assert.equal( new World( description() ).floor, - 30 );

} );
