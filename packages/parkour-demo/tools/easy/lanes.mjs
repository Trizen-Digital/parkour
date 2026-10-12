// The jump lanes of every family course, driven by hand and in Easy mode: how many each makes.
//
//   node tools/easy/lanes.mjs [course filter] [--early m] [--limit lanes per course] [--engine box3d|rapier]
//
// A lane counts if it is pressed `up` (a jump) and not expected to fail. By hand, the jump is tapped `early` metres
// (0.6 by default) before the lane's own point, as a player who jumps a little soon; in Easy, the pilot decides.

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT } from '../headless/env.mjs';

const { worldFor } = await import( '../headless/courses.mjs' );
const { Simulation } = await import( '@trizendigital/parkour/sim/Simulation.js' );
const { Figure } = await import( '@trizendigital/parkour/figure/Figure.js' );
const { Pilot } = await import( '@trizendigital/parkour/pilot/Pilot.js' );
const { ENGINES, backendOf } = await import( '../../src/engines.js' );
const { LaneDriver, laneStart } = await import( '../../src/qa/lanes.js' );

const args = process.argv.slice( 2 );
const option = ( name, fallback ) => args.includes( name ) ? Number( args[ args.indexOf( name ) + 1 ] ) : fallback;
const early = option( '--early', 0.6 ), limit = option( '--limit', Infinity );
const engine = args.includes( '--engine' ) ? args[ args.indexOf( '--engine' ) + 1 ] : ENGINES[ 0 ];
const filter = args.find( ( arg, i ) => ! arg.startsWith( '--' ) && ! args[ i - 1 ]?.startsWith( '--' ) );

const courses = fs.readdirSync( path.join( PROJECT, 'public/courses' ) ).filter( ( file ) => file.startsWith( 'test_' ) && ( ! filter || file.includes( filter ) ) ).map( ( file ) => file.slice( 0, - 5 ) );

async function drive( course, lane, easy ) {

	const sim = new Simulation( { world: worldFor( course ), figure: new Figure(), engine: backendOf( engine ) } );
	await sim.load();
	sim.respawn( laneStart( lane ) );
	const pilot = new Pilot( sim );
	pilot.toggle( easy );
	const driver = new LaneDriver( lane, { early } );
	while ( ! driver.done ) {

		const { keys, edges } = driver.next( sim.runner );
		for ( const [ key, edge ] of edges ) sim.input.queueKey( key, edge );
		pilot.think( 1 / 60 );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( keys );
			input.enabled = true;
			pilot.apply( input );

		} );
		driver.after( sim );

	}

	// A simulation per lane: each lets go of its physics worlds (box3d keeps only so many alive at once).
	const result = driver.result( sim );
	sim.dispose();
	return result;

}

let manual = 0, easy = 0, total = 0;
for ( const course of courses ) {

	const definition = JSON.parse( fs.readFileSync( path.join( PROJECT, 'public/courses', `${course}.json` ), 'utf8' ) );
	const lanes = ( definition.lanes ?? [] ).filter( ( lane ) => lane.press === 'up' && lane.expect !== 'fail' ).slice( 0, limit );
	for ( const lane of lanes ) {

		const byHand = await drive( course, lane, false ), inEasy = await drive( course, lane, true );
		total ++;
		manual += byHand.made;
		easy += inEasy.made;
		const mark = ( result ) => result.made ? `made${result.caught ? ' (' + result.caught + ')' : ''}` : result.bailed ? 'bailed' : `short (${result.past} m)`;
		console.log( `${course} ${lane.name.padEnd( 44 ).slice( 0, 44 )}  manual: ${mark( byHand ).padEnd( 26 )} easy: ${mark( inEasy )}` );

	}

}

console.log( `\n${total} lanes, a tap ${early} m early: manual made ${manual}, easy made ${easy}` );
process.exit( 0 );
