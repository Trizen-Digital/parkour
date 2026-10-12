// The physics engines the demo runs on, by name, the default first: the settings and `?engine=`, the bench, the
// tools' `--engine`, and the name a replay records all go through here to the backend packages.

import box3d from '@trizendigital/parkour-box3d';
import rapier from '@trizendigital/parkour-rapier';

const BACKENDS = { box3d, rapier };

/** The engines' names, the default first. */
const ENGINES = Object.freeze( Object.keys( BACKENDS ) );

/**
 * The backend a name stands for, to give a Simulation.
 *
 * @param {string} name one of ENGINES
 * @return {import( '@trizendigital/parkour/physics/engine.js' ).Backend}
 */
function backendOf( name ) {

	const backend = BACKENDS[ name ];
	if ( ! backend ) throw new Error( `no physics engine '${ name }': ${ ENGINES.join( ', ' ) }` );
	return backend;

}

/**
 * Loads an engine by name, for what asks an engine directly rather than through a run (the tests).
 *
 * @param {string} name one of ENGINES
 * @return {Promise<import( '@trizendigital/parkour/physics/engine.js' ).PhysicsEngine>}
 */
function createEngine( name ) {

	return backendOf( name ).load();

}

export { ENGINES, backendOf, createEngine };
