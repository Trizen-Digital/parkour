// The benchmark headless: the autopilot plays every station on a physics engine and a view, and says how each went.
//
//   node tools/bench/run.mjs [filter] [--engine box3d|rapier|all] [--view third|first|all] [--figure ybot|stub]
//                            [--dump id] [--every n] [--json out.json]
//   node tools/bench/run.mjs --comment <id> [--every n]
//
// A filter runs only the stations whose id contains it, end to end on a course of their own (each station stands on
// its own floor, so it plays the same; only its start frame moves). --dump prints a station's frames (every n-th):
// where the runner is along the station, its state and move, and the keys held. The Y Bot is the figure by default,
// as in the page (the ragdoll and the first-person camera read its body); the stub is quicker for trying a script.
// --comment plays the whole benchmark on the engine and in the view a comment (qa/bench/comments.json) was made on
// (or those given), and prints the frames across its stretch, found again by its station and the time into it.

import fs from 'node:fs';
import '../headless/env.mjs';

const { Course } = await import( '../../src/course/Course.js' );
const { metrics } = await import( '../../src/course/metrics.js' );
const { World } = await import( '@trizen/parkour/world/World.js' );
const { fromCourse } = await import( '../../src/world/fromCourse.js' );
const { Simulation } = await import( '@trizen/parkour/sim/Simulation.js' );
const { Figure } = await import( '@trizen/parkour/figure/Figure.js' );
const { YBotFigure } = await import( '../../src/figure/YBotFigure.js' );
const { ENGINES, backendOf } = await import( '../../src/engines.js' );
const { STATIONS } = await import( '../../src/bench/stations.js' );
const { benchCourse } = await import( '../../src/bench/course.js' );
const { BenchRun } = await import( '../../src/bench/BenchRun.js' );
const { DT } = await import( '../../src/bench/Autopilot.js' );
const { placeComment } = await import( '../../src/bench/comments.js' );

const args = process.argv.slice( 2 );
const option = ( name, fallback ) => args.includes( name ) ? args[ args.indexOf( name ) + 1 ] : fallback;
const filter = args.find( ( arg, i ) => ! arg.startsWith( '--' ) && ! args[ i - 1 ]?.startsWith( '--' ) );
const commentId = option( '--comment', null );
// The comments are this copy's own (qa/bench/ is not in git): none until some are made here.
const commentsFile = new URL( '../../qa/bench/comments.json', import.meta.url );
const comment = commentId && fs.existsSync( commentsFile ) ? JSON.parse( fs.readFileSync( commentsFile, 'utf8' ) ).comments.find( ( c ) => c.id === commentId ) : null;
if ( commentId && ! comment ) {

	console.log( `no comment ${commentId} in qa/bench/comments.json` );
	process.exit( 2 );

}

const engines = option( '--engine', comment?.made.engine ?? ENGINES[ 0 ] ) === 'all' ? ENGINES : [ option( '--engine', comment?.made.engine ?? ENGINES[ 0 ] ) ];
const views = option( '--view', comment?.made.view ?? 'third' ) === 'all' ? [ 'third', 'first' ] : [ option( '--view', comment?.made.view ?? 'third' ) ];
const figure = option( '--figure', 'ybot' );
const dump = option( '--dump', null );
const every = Number( option( '--every', 6 ) );
const jsonOut = option( '--json', null );

const stations = STATIONS.filter( ( station ) => ! filter || station.id.includes( filter ) );
if ( ! stations.length ) {

	console.log( `no station's id contains ${filter}` );
	process.exit( 2 );

}

const { def, placed } = benchCourse( stations );
const course = new Course( def, { metrics } );
const report = {};
let failures = 0;

for ( const engine of engines ) for ( const view of views ) {

	const world = new World( fromCourse( course ) );
	const sim = new Simulation( { world, figure: figure === 'stub' ? new Figure() : new YBotFigure(), engine: backendOf( engine ), page: { storage: null, eventWindow: null, eventDocument: null, navigator: null } } );
	await sim.load();
	sim.camera.aspect = 16 / 9;
	sim.camera.updateProjectionMatrix();

	const run = new BenchRun( sim, placed, { view } ).start();
	const started = Date.now();
	const dumped = dump ? placed.find( ( place ) => place.station.id === dump ) : null;
	if ( dumped ) {

		const onStep = sim.onStep;
		let f = 0;
		sim.onStep = ( s ) => onStep( s );
		const step = run.compute.bind( run );
		run.compute = () => {

			step();
			const index = run.stationOf[ run.frames - 1 ];
			if ( index === dumped.index && ( ( f ++ ) % every === 0 ) ) {

				const r = sim.runner, frame = run.frameAt( run.frames - 1 ), pilot = run.pilot.state;
				const moving = sim.motion.moves.instances.findLast( ( instance ) => ! instance.stopping );
				console.log( [
					`f${run.frames - 1}`.padEnd( 7 ), `step ${pilot.step}`,
					`x ${r.position.x.toFixed( 2 )} y ${( r.position.y - 0.9215 ).toFixed( 2 )} z ${( r.position.z - dumped.z0 ).toFixed( 2 )}`,
					`v ${r.speed.toFixed( 2 )} vy ${r.velocity.y.toFixed( 2 )}`,
					`${sim.ragdoll.active ? 'LIMP' : r.state}${r.grounded ? '' : '~'}`.padEnd( 16 ),
					( moving?.move?.name ?? '-' ).padEnd( 18 ),
					[ ...frame.keys, ...frame.buttons.map( ( b ) => `M${b}` ) ].join( '+' ) + ( frame.mouse[ 0 ] || frame.mouse[ 1 ] ? ` m${frame.mouse[ 0 ]},${frame.mouse[ 1 ]}` : '' ),
				].join( '  ' ) );

			}

		};

	}

	const lines = [];
	run.runToEnd( ( record ) => {

		const place = placed[ record.index ];
		const seconds = ( record.end - record.start ) * DT;
		const mark = record.result === 'pass' ? 'pass' : record.result === 'missed' ? 'MISSED' : 'FAIL';
		if ( record.result !== 'pass' ) failures ++;
		lines.push( record );
		console.log( `${engine} ${view} ${String( record.index ).padStart( 3 )} ${place.station.id.padEnd( 28 )} ${mark.padEnd( 6 )} ${seconds.toFixed( 1 ).padStart( 5 )} s  ${record.reason ?? ''}` );

	} );

	if ( comment ) {

		// The comment's stretch on this run: each end at the same time into the same station as where it was made.
		const { f0, f1, exact } = placeComment( comment, run, { engine, view } );
		console.log( `\n${comment.id}: "${comment.text}" (${comment.view}, ${comment.engine}; made on ${comment.made.engine} ${comment.made.view})` );
		console.log( `on ${engine} ${view}: ${( f0 * DT ).toFixed( 2 )}-${( f1 * DT ).toFixed( 2 )} s, frames ${f0}-${f1}${exact ? ', exactly where it was made' : ''}` );
		for ( const row of run.rows( f0, f1, Number( option( '--every', 6 ) ) ) ) console.log( [ `f${row.f}`.padEnd( 7 ), `${row.t.toFixed( 2 )}s`, row.station.padEnd( 22 ), row.state.padEnd( 14 ), row.move.padEnd( 22 ), `x ${row.x.toFixed( 2 )} y ${row.y.toFixed( 2 )} z ${row.z.toFixed( 2 )}`, `v ${row.v.toFixed( 2 )} vy ${row.vy.toFixed( 2 )}`, row.keys ].join( '  ' ) );

	}

	const passed = lines.filter( ( record ) => record.result === 'pass' ).length;
	console.log( `${engine} ${view}: ${passed} of ${lines.length} stations, ${run.duration.toFixed( 1 )} s of run (fingerprint ${run.fingerprint()}), worked out in ${( ( Date.now() - started ) / 1000 ).toFixed( 1 )} s${run.mismatch ? `; came out differently at frame ${run.mismatch.f}` : ''}\n` );
	report[ `${engine}/${view}` ] = { duration: run.duration, fingerprint: run.fingerprint(), stations: lines.map( ( record ) => ( { ...record, id: placed[ record.index ].station.id, seconds: ( record.end - record.start ) * DT } ) ) };
	run.end();
	sim.dispose();

}

if ( jsonOut ) fs.writeFileSync( jsonOut, JSON.stringify( report, null, '\t' ) );
process.exit( failures ? 1 : 0 );
