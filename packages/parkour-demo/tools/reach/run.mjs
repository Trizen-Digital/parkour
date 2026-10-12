// Every route link of every authored course, tried by hand and in Easy mode: which moves the runner makes, which only
// Easy makes, and which it has no move for.
//
//   node tools/reach/run.mjs [course filter] [--json out.json] [--engine box3d|rapier]
//
// A course's route is nodes (places) joined by links (a move from one to the next). Each link is run from the start
// of the run-up that leads into it: sprinting at the take-off, Space tapped 0.4 m before it for a move that is a press
// (grab held once in the air, by hand), and judged made on catching on (a ledge, a bar, a wall run, …) or standing at
// the link's end. A link that works a valve or a button walks up to it, taps Interact (E) 0.4 m before the take-off,
// and is made when the switch is worked.

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT } from '../headless/env.mjs';

const { worldFor } = await import( '../headless/courses.mjs' );
const { Simulation } = await import( '@trizendigital/parkour/sim/Simulation.js' );
const { Figure } = await import( '@trizendigital/parkour/figure/Figure.js' );
const { Pilot } = await import( '@trizendigital/parkour/pilot/Pilot.js' );
const { ENGINES, backendOf } = await import( '../../src/engines.js' );
const { SUCCESS_STATES } = await import( '../../src/qa/lanes.js' );
const { Vector3 } = await import( 'three' );

const args = process.argv.slice( 2 );
const jsonOut = args.includes( '--json' ) ? args[ args.indexOf( '--json' ) + 1 ] : null;
const engine = args.includes( '--engine' ) ? args[ args.indexOf( '--engine' ) + 1 ] : ENGINES[ 0 ];
const filter = args.find( ( arg, i ) => ! arg.startsWith( '--' ) && ! args[ i - 1 ]?.startsWith( '--' ) );

// Moves the routes name that the runner has no way to do, and why.
const MISSING = {
	beam: 'no balance walk: a beam is plain geometry to run along',
	pullUp: 'no rope climb',
	breach: 'no rope breach',
	crouch: 'no crouch walk',
	slideUnder: 'no slide under: the slide keeps the capsule\'s height until it ducks',
	corridor: 'no wall-to-wall corridor run',
	wallclimbTurn: 'no climb-and-turn off a wall',
	ledgeWalk: 'no ledge walk',
};

// Moves made from a hang, judged by the links that lead into the hang.
const FROM_HANG = new Set( [ 'shimmy', 'climbUp', 'transfer' ] );

// Moves that are a press of Space at the take-off.
const PRESS = new Set( [ 'jump', 'vault', 'climb', 'wallclimb', 'wallrun', 'swing', 'zipline', 'pipe', 'ladder', 'springboard' ] );

// The capsule's centre stands this far above the floor (as at a spawn).
const STANDING_HEIGHT = 0.9215;

// Space is tapped this far (m) before the take-off, and held this many frames.
const PRESS_AHEAD = 0.4;
const TAP_FRAMES = 3;

async function drive( course, start, link, nodes, easy ) {

	const sim = new Simulation( { world: worldFor( course ), figure: new Figure(), engine: backendOf( engine ) } );
	await sim.load();
	const from = new Vector3().fromArray( start.p ), takeoff = new Vector3().fromArray( nodes.get( link.from ).p ), target = new Vector3().fromArray( nodes.get( link.to ).p );
	const toward = target.clone().sub( from ).setY( 0 );
	const yaw = Math.atan2( toward.x, toward.z );
	sim.respawn( { position: [ from.x, from.y + STANDING_HEIGHT, from.z ], yaw } );
	const pilot = new Pilot( sim );
	pilot.toggle( easy );
	const forward = new Vector3( Math.sin( yaw ), 0, Math.cos( yaw ) );
	// A link made from a standstill stands for its first 8 frames, presses at frame 10, then runs.
	const standing = ( link.speed?.comfortable ?? link.speed?.min ?? link.params?.speed ?? 1 ) <= 0;
	const interact = link.move === 'interact';
	const keys = interact ? [ 'KeyW' ] : [ 'KeyW', 'ShiftLeft' ];
	const key = interact ? 'KeyE' : 'Space';
	const runner = sim.runner;
	let pressedAt = null, caught = null, bailed = false, frame = 0;
	const press = PRESS.has( link.move ) || interact ? PRESS_AHEAD : null;
	const worked = () => runner.doorsAndSwitches.switches.some( ( state ) => state.workedAt > - Infinity );
	const frames = 60 * ( 6 + from.distanceTo( takeoff ) / 4 );
	for ( ; frame < frames; frame ++ ) {

		const ahead = takeoff.clone().sub( runner.position ).dot( forward );
		if ( press !== null && pressedAt === null && ( standing ? frame === 10 : ahead <= press ) ) pressedAt = frame;
		const tap = pressedAt !== null && frame - pressedAt < TAP_FRAMES;
		if ( pressedAt === frame ) sim.input.queueKey( key, 'pressed' );
		if ( pressedAt !== null && frame - pressedAt === TAP_FRAMES ) sim.input.queueKey( key, 'released' );
		const grab = ! easy && pressedAt !== null && ! runner.grounded;
		pilot.think( 1 / 60 );
		sim.frame( 1 / 60, ( input ) => {

			input.keys = new Set( [ ...( standing && frame < 8 ? [] : keys ), ...( tap ? [ key ] : [] ) ] );
			input.mouseButtons = new Set( grab ? [ 0 ] : [] );
			input.enabled = true;
			pilot.apply( input );

		} );
		if ( SUCCESS_STATES.has( runner.state ) && caught === null ) caught = runner.state;
		if ( runner.state === 'bailing' || sim.ragdoll.active ) {

			bailed = true;
			break;

		}

		const feet = runner.position.y - STANDING_HEIGHT;
		const there = Math.hypot( runner.position.x - target.x, runner.position.z - target.z ) < 1 && Math.abs( feet - target.y ) < 0.6 && runner.grounded;
		if ( interact ? worked() : caught !== null || there || runner.position.clone().sub( target ).dot( forward ) > 3 && runner.grounded ) break;

	}

	// Made: caught on, or at the end's height within 1.5 m of it (or past it on the ground, near the line).
	const feet = runner.position.y - STANDING_HEIGHT, past = runner.position.clone().sub( target ).setY( 0 );
	const along = past.dot( forward ), aside = Math.abs( past.x * forward.z - past.z * forward.x );
	const reached = Math.abs( feet - target.y ) < 0.6 && ( Math.hypot( past.x, past.z ) < 1.5 || runner.grounded && along > 0 && aside < 1.5 );

	// A simulation per try: each lets go of its physics worlds (box3d keeps only so many alive at once).
	sim.dispose();
	const made = ! bailed && ( interact ? worked() : caught !== null || reached );
	return { made, caught, bailed, end: [ runner.position.x, feet, runner.position.z ].map( ( v ) => Math.round( v * 100 ) / 100 ), state: runner.state };

}

const rows = [];
for ( const file of fs.readdirSync( path.join( PROJECT, 'public/courses' ) ) ) {

	const course = file.slice( 0, - 5 );
	if ( filter && ! course.includes( filter ) ) continue;
	const definition = JSON.parse( fs.readFileSync( path.join( PROJECT, 'public/courses', file ), 'utf8' ) );
	const route = definition.route;
	if ( ! route?.links?.length ) continue;
	const nodes = new Map( route.nodes.map( ( node ) => [ node.id, node ] ) );
	for ( const link of route.links ) {

		if ( link.move === 'run' ) {

			rows.push( { course, link: `${link.from}→${link.to}`, move: 'run', result: 'run (no move)' } );
			continue;

		}

		const row = { course, link: `${link.from}→${link.to}`, move: link.move, params: link.params };
		if ( MISSING[ link.move ] ) row.result = `can't: ${MISSING[ link.move ]}`;
		else if ( FROM_HANG.has( link.move ) ) row.result = 'from a hang: see the links into it';
		else {

			const runUp = route.links.find( ( other ) => other.to === link.from && other.move === 'run' );
			const start = nodes.get( runUp?.from ?? link.from );
			row.manual = await drive( course, start, link, nodes, false );
			row.easy = await drive( course, start, link, nodes, true );
			row.result = row.manual.made ? 'made' : row.easy.made ? 'made in Easy' : row.manual.bailed ? 'bailed' : 'not made';

		}

		rows.push( row );
		if ( row.move !== 'run' ) console.log( `${course.padEnd( 15 )} ${row.link.padEnd( 14 )} ${row.move.padEnd( 12 )} ${JSON.stringify( row.params ?? {} ).slice( 0, 60 ).padEnd( 60 )} ${row.result}${row.manual && ! row.manual.made ? `  (manual ends ${row.manual.state} at ${row.manual.end})` : ''}` );

	}

}

const moves = rows.filter( ( row ) => row.move !== 'run' );
const count = ( test ) => moves.filter( test ).length;
console.log( `\n${moves.length} move links: ${count( ( row ) => row.result === 'made' )} made, ${count( ( row ) => row.result === 'made in Easy' )} more in Easy, ${count( ( row ) => row.result.startsWith( 'can\'t' ) )} with no move for them, ${count( ( row ) => row.result.startsWith( 'from a hang' ) )} from a hang, ${count( ( row ) => row.result === 'not made' || row.result === 'bailed' )} not made` );
if ( jsonOut ) fs.writeFileSync( jsonOut, JSON.stringify( rows, null, '\t' ) );
process.exit( 0 );
