import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import '../tools/headless/env.mjs';

const { TakeLibrary } = await import( '@trizendigital/parkour/motion/TakeLibrary.js' );
const { Moves } = await import( '@trizendigital/parkour/motion/Moves.js' );
const { loadClips } = await import( '@trizendigital/parkour/figure/clips.js' );
const { loadSpecs, isBuilt, takePace, MARKERS, LAYERS } = await import( '../tools/moves/lib/specs.js' );
const { cut } = await import( '../tools/moves/lib/clips.js' );
const { check } = await import( '../tools/moves/check.mjs' );
const { captureList } = await import( '../tools/moves/captures.mjs' );

const read = async ( path ) => JSON.parse( await fs.readFile( new URL( '../public/data/' + path, import.meta.url ), 'utf8' ) );
const table = await read( 'moves.json' );
const library = new TakeLibrary( await read( 'moves.json' ) );

// Times were measured to the microsecond: a span or a key may reach that far past its take's end.
const SLACK = 1e-6;
const STEP = 1 / 120;

test( 'every take plays at rate 1: it has a length and no rate of its own, and each move plays a span inside its take', () => {

	assert.ok( library.takes.size > 100 && library.moves.size > 60 );

	for ( const take of library.takes.values() ) {

		assert.ok( take.length > 0, take.name );
		assert.equal( table.takes[ take.name ].rate, undefined, take.name );

	}

	for ( const move of library.moves.values() ) {

		const take = library.takes.get( move.take );
		assert.ok( take, `${ move.name } plays ${ move.take }` );
		assert.ok( move.span[ 0 ] >= 0 && move.span[ 0 ] < move.span[ 1 ] && move.span[ 1 ] <= take.length + SLACK, move.name );
		assert.ok( move.length > 0 && move.rate > 0 && move.blendIn >= 0 && move.blendOut >= 0, move.name );
		assert.ok( LAYERS.includes( move.layer ), move.name );

	}

} );

test( 'a take\'s entry keeps the pace its spec gave it, and the library reads 1 when it has none', async () => {

	const { takes } = await loadSpecs();

	for ( const spec of takes.values() ) {

		const pace = takePace( spec );
		assert.equal( table.takes[ spec.name ].pace, pace === 1 ? undefined : pace, spec.name );
		assert.equal( library.takes.get( spec.name ).pace, pace, spec.name );

	}

	// The pipe's grab plays 1.25 times its capture's speed.
	assert.equal( library.takes.get( 'pipe_grab' ).pace, 1.25 );
	assert.equal( library.takes.get( 'ground_idle' ).pace, 1 );

} );

test( 'a take of steps keeps its stride; one paced for a speed plays its stride at that speed', async () => {

	const { takes } = await loadSpecs();

	for ( const spec of takes.values() ) assert.equal( table.takes[ spec.name ].stride, spec.stride, spec.name );

	// The leaning runs are two cycles of their captures: the sprint's claim a tenth more than twice its 2.1609 m
	// stride, so the full-speed run plays a little slower; the run's are twice its 2.0355 m.
	assert.equal( library.takes.get( 'ground_run_lean_left' ).stride, 4.754 );
	assert.equal( library.takes.get( 'ground_run_lean_right_slow' ).stride, 2 * 2.0355 );

	// A speed to pace for needs a stride and stands in for a pace.
	const { validate } = await import( '../tools/moves/lib/specs.js' );
	const lone = { name: 'lone', kept: 'test', length: 1, speed: 2 };
	const both = { name: 'both', kept: 'test', length: 1, stride: 1, speed: 2, pace: 2 };
	const problems = validate( { takes: new Map( [ [ 'lone', lone ], [ 'both', both ] ] ), moves: new Map() }, () => undefined );
	assert.equal( problems.filter( ( problem ) => /speed to pace for/.test( problem ) ).length, 2 );
	assert.equal( takePace( { length: 2, stride: 3, speed: 6 } ), 4 );

} );

test( 'a take carries only the markers the game reads, inside it; the roll was paced up by 1.1 and its markers with it', () => {

	for ( const take of library.takes.values() ) {

		for ( const [ name, time ] of take.markers ) {

			assert.ok( MARKERS.includes( name ), `${ take.name }: ${ name }` );
			assert.ok( time >= 0 && time <= take.length + SLACK, `${ take.name }: ${ name } at ${ time }` );

		}

	}

	// Recorded over 1.11 s with the roll ending at 0.60467 s and starting a tenth of a millisecond in, then paced up.
	const roll = library.takes.get( 'land_roll' );
	assert.equal( roll.length, 1.11 / 1.1 );
	assert.deepEqual( roll.markers, [ [ 'rollStart', 0.0001 / 1.1 ], [ 'rollEnd', 0.60467 / 1.1 ] ] );

} );

test( 'only a take the runner follows carries the root\'s travel, keyed from its start to its end', () => {

	const withRoot = [ ...library.takes.values() ].filter( ( take ) => take.root );
	assert.ok( withRoot.length >= 15 && withRoot.length < library.takes.size / 2 );

	for ( const take of withRoot ) {

		const { times, positions } = take.root;
		assert.equal( times[ 0 ], 0, take.name );
		assert.ok( times.every( ( time, i ) => i === 0 || time > times[ i - 1 ] ), take.name );
		assert.ok( times.at( - 1 ) <= take.length + SLACK, take.name );
		assert.equal( positions.length, times.length * 3, take.name );

	}

	// The roll carries the runner 5.7 m forward and no further.
	const track = library.rootTrack( 'land_roll' ).createInterpolant();
	assert.ok( Math.abs( track.evaluate( library.takes.get( 'land_roll' ).length )[ 2 ] - 5.700536 ) < 1e-5 );
	assert.equal( library.rootTrack( 'ground_idle' ), null );

} );

test( 'a move fires its take\'s markers as its own time crosses them, at the move\'s rate', () => {

	const moves = new Moves( library );
	moves.play( 'landingRoll' );

	// The roll ends 0.5497 s into the take; the move plays at rate 1, so the 66th step (to 0.55 s) crosses it.
	const fired = [];
	for ( let step = 1; step <= 70; step ++ ) {

		for ( const marker of moves.update( STEP ) ) fired.push( [ marker.name, step ] );

	}

	assert.deepEqual( fired, [ [ 'rollStart', 1 ], [ 'rollEnd', 66 ] ] );

} );

test( 'a clip holds one row of key times every track shares, values to five decimals, and its take\'s length', async () => {

	const names = [ 'land_roll', 'ground_idle', 'trick_cartwheel', 'pose_lean_forward' ];
	const clips = await loadClips( './data/takes/', new Map( names.map( ( name ) => [ name, library.takes.get( name ) ] ) ) );

	for ( const name of names ) {

		const clip = clips.get( name ), file = await read( `takes/${ name }.json` );
		assert.equal( clip.duration, library.takes.get( name ).length, name );
		assert.ok( clip.tracks.length > 50, name );
		assert.ok( clip.tracks.every( ( track ) => track.times === clip.tracks[ 0 ].times ), name );
		assert.ok( Object.values( file.tracks ).flat().concat( file.times ).every( ( value ) => Math.round( value * 1e5 ) / 1e5 === value ), name );

	}

} );

test( 'the move builder rebuilds the shipped table and every clip it cuts from a capture, exactly', async () => {

	const { specs, problems } = await check();
	assert.deepEqual( problems, [] );
	assert.ok( [ ...specs.takes.values() ].filter( isBuilt ).length >= 10 );

} );

test( 'a take cut from a capture gets a key on each beat its anchors pin', async () => {

	const { takes } = await loadSpecs();
	const roll = cut( takes.get( 'land_roll' ) );

	// The roll's end is anchored at 0.9497 s of the capture, 0.60467 s into the take before its pace of 1.1.
	assert.ok( roll.times.includes( Math.round( 0.60467 / 1.1 * 1e5 ) / 1e5 ) );
	assert.equal( roll.length, library.takes.get( 'land_roll' ).length );
	assert.equal( roll.times[ 0 ], 0 );

} );

test( 'the capture list names every placeholder with what it is for, the family holding up most moves first', async () => {

	const specs = await loadSpecs();
	const list = captureList( specs );
	const entries = list.flatMap( ( family ) => family.entries );
	const fills = [ ...specs.takes.values() ].filter( ( take ) => take.fill );

	assert.equal( entries.length, fills.length );
	assert.ok( entries.every( ( entry ) => entry.reason.length > 10 ) );
	assert.equal( list[ 0 ].family, 'trick' );
	assert.deepEqual( entries.find( ( entry ) => entry.take === 'trick_front_flip' ).moves, [ 'frontFlip' ] );

	// A take with nothing of ours is never built, and a take built from a capture is not on the list.
	assert.ok( fills.every( ( take ) => ! isBuilt( take ) ) );
	assert.ok( ! entries.some( ( entry ) => entry.take === 'land_roll' || entry.take === 'trick_cartwheel' ) );

} );
