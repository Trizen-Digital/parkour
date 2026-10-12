// Easy mode's pilot on the vault lanes: it plans a jump by looking ahead from a snapshot, and lets go of the charged
// jump where the look-ahead reaches something.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { PROJECT } = await import( '../tools/headless/env.mjs' );
const { worldFor } = await import( '../tools/headless/courses.mjs' );
const { Simulation } = await import( '@trizendigital/parkour/sim/Simulation.js' );
const { Figure } = await import( '@trizendigital/parkour/figure/Figure.js' );
const { Pilot } = await import( '@trizendigital/parkour/pilot/Pilot.js' );
const { LaneDriver, laneStart } = await import( '../src/qa/lanes.js' );
const { ENGINES, backendOf } = await import( '../src/engines.js' );

const VAULTS = JSON.parse( fs.readFileSync( path.join( PROJECT, 'public/courses/test_vaults.json' ), 'utf8' ) );
const lane = ( name ) => VAULTS.lanes.find( ( l ) => l.name.startsWith( name ) );

// A lane driven as the lanes tool drives it (Space tapped 0.6 m early), by hand or in Easy; what the runner caught,
// and the frame after the tap at which the pilot let go of jump.
async function drive( definition, { easy, engine } ) {

	const sim = new Simulation( { world: worldFor( 'test_vaults' ), figure: new Figure(), engine: backendOf( engine ) } );
	await sim.load();
	sim.respawn( laneStart( definition ) );
	const pilot = new Pilot( sim );
	pilot.toggle( easy );
	const driver = new LaneDriver( definition, { early: 0.6 } );
	let release = null;
	while ( ! driver.done ) {

		const { keys, edges } = driver.next( sim.runner );
		for ( const [ key, edge ] of edges ) sim.input.queueKey( key, edge );
		pilot.think( 1 / 60 );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( keys );
			input.enabled = true;
			pilot.apply( input );

		} );
		if ( easy && release === null && driver.pressedAt !== null && ! pilot.holding.jump ) release = driver.frame - driver.pressedAt;
		driver.after( sim );

	}

	const result = driver.result( sim );
	sim.dispose();
	return { ...result, release };

}

for ( const engine of ENGINES ) {

	test( `${engine}: Easy makes the 2 m high vaults the tap alone does not, letting go just short of the wall`, async () => {

		for ( const name of [ '2 m, 0.4 m deep at a run', '2 m, 3 m deep at a run' ] ) {

			const definition = lane( name );
			const byHand = await drive( definition, { easy: false, engine } );
			const inEasy = await drive( definition, { easy: true, engine } );

			assert.equal( byHand.made, false, `${name}: by hand` );
			assert.equal( inEasy.made, true, `${name}: in Easy` );
			assert.equal( inEasy.caught, 'catchingLedge', name );
			// The fixed releases are 1, 4, 9, 16, 26 and 40 frames: 16 already meets the wall, standing.
			assert.ok( inEasy.release > 9 && inEasy.release < 16, `${name}: let go at ${inEasy.release}` );

		}

	} );

}

// Limp, Space stands the runner up whether or not the pilot holds the keys: in Easy it plays them as the player does.
test( 'Easy: Space stands the runner up from limp, as it does by hand', async () => {

	const { YBotFigure } = await import( '../src/figure/YBotFigure.js' );

	for ( const easy of [ false, true ] ) {

		const sim = new Simulation( { world: worldFor( 'test_basic' ), figure: new YBotFigure(), engine: backendOf( ENGINES[ 0 ] ) } );
		await sim.load();
		sim.respawn( 0 );
		const pilot = new Pilot( sim );
		pilot.toggle( easy );
		const frame = ( keys = [], edges = [] ) => {

			for ( const [ key, edge ] of edges ) sim.input.queueKey( key, edge );
			pilot.think( 1 / 60 );
			sim.frame( 1 / 60, ( input ) => {

				input.keys = new Set( keys );
				input.enabled = true;
				pilot.apply( input );

			} );

		};

		for ( let i = 0; i < 30; i ++ ) frame();
		frame( [ 'Digit4' ], [ [ 'Digit4', 'pressed' ] ] );
		frame( [], [ [ 'Digit4', 'released' ] ] );
		for ( let i = 0; i < 180; i ++ ) frame();
		assert.ok( sim.ragdoll.active, `easy ${easy}: limp` );

		frame( [ 'Space' ], [ [ 'Space', 'pressed' ] ] );
		for ( let i = 0; i < 30 && sim.ragdoll.active; i ++ ) frame( [ 'Space' ] );
		assert.equal( sim.ragdoll.active, false, `easy ${easy}: stood up` );
		sim.dispose();

	}

} );
