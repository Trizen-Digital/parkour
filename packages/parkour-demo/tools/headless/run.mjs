// Runs a tape headless: its course, its start, then every recorded frame's raw input, and returns the trace.
//
//   node tools/headless/run.mjs <tape.json> <trace.json> [ybot|stub] [rapier|box3d]
//
// The figure is the Y Bot (the trace the goldens keep) or the timing-only stub (purity.mjs: the simulation must not
// care); the physics engine is Rapier unless asked. The camera is 16:9 and the look sensitivity 1, as the tapes were
// scripted.

import fs from 'node:fs';
import path from 'node:path';
import './env.mjs';

const { Simulation } = await import( '@trizendigital/parkour/sim/Simulation.js' );
const { DeviceState } = await import( '@trizendigital/parkour/input/deviceState.js' );
const { Figure } = await import( '@trizendigital/parkour/figure/Figure.js' );
const { YBotFigure } = await import( '../../src/figure/YBotFigure.js' );
const { backendOf } = await import( '../../src/engines.js' );
const { worldFor } = await import( './courses.mjs' );
const { Trace } = await import( './trace.mjs' );

// The look sensitivity the tapes' mouse counts were scripted at (the default before 1× came to mean half the base look
// speeds), so a scripted turn turns as far as it was written to whatever the default is now.
const SCRIPTED_SENSITIVITY = 1;

/**
 * A loaded simulation on a tape's course.
 * @param {object} tape
 * @param {object} [options]
 * @param {string} [options.figure] 'ybot' or 'stub'
 * @param {string} [options.engine] 'rapier' or 'box3d'
 * @returns {Promise<Simulation>}
 */
async function build( tape, { figure = 'ybot', engine = 'rapier' } = {} ) {

	const sim = new Simulation( { world: worldFor( tape.course ), figure: figure === 'stub' ? new Figure() : new YBotFigure(), engine: backendOf( engine ) } );
	sim.tuning.values = { ...sim.tuning.values, mouseSensitivity: SCRIPTED_SENSITIVITY };
	await sim.load();
	sim.camera.aspect = 1280 / 720;
	sim.camera.updateProjectionMatrix();
	return sim;

}

/**
 * @param {object} tape `tape/1`: course, start (a spawn's index as `{ spawn }`, or a place and heading), frames
 * @param {object} [options] as build()
 * @returns {Promise<object>} the trace
 */
async function run( tape, options ) {

	const sim = await build( tape, options );
	const raw = new DeviceState( sim.input );
	const trace = new Trace( sim );
	sim.respawn( tape.start.spawn ?? tape.start );
	raw.play();
	sim.onStep = () => trace.step();
	for ( const frame of tape.frames ) {

		sim.frame( frame.dt, () => raw.apply( frame ) );
		trace.frame();

	}

	// One process runs many tapes (purity.mjs), and box3d keeps only so many worlds alive.
	const result = trace.toJSON();
	sim.dispose();
	return result;

}

if ( process.argv[ 1 ] && import.meta.url.endsWith( path.basename( process.argv[ 1 ] ) ) ) {

	const [ tapeFile, traceFile, figure, engine ] = process.argv.slice( 2 );
	const tape = JSON.parse( fs.readFileSync( tapeFile, 'utf8' ) );
	const trace = await run( tape, { figure: figure || undefined, engine: engine || undefined } );
	fs.writeFileSync( traceFile, JSON.stringify( trace ) );
	console.log( `${path.basename( tapeFile )}: ${trace.steps.length} steps, ${trace.frames.length} frames` );
	process.exit( 0 );

}

export { run, build };
