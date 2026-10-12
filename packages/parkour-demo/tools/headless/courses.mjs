// Courses for headless runs, by name: an authored course from public/courses, or `generated-<seed>` (a generated
// course, as the page's course tools make it). Each course is built once per process; each simulation gets a World of
// its own over it.

import fs from 'node:fs';
import path from 'node:path';
import { PROJECT } from './env.mjs';

const { Course } = await import( '../../src/course/Course.js' );
const { metrics } = await import( '../../src/course/metrics.js' );
const { generate } = await import( '../../src/course/generate.js' );
const { validate } = await import( '../../src/course/validate.js' );
const { World } = await import( '@trizendigital/parkour/world/World.js' );
const { fromCourse } = await import( '../../src/world/fromCourse.js' );

/** The generated courses the golden tapes run on; another seed gets length 14, difficulty 0.5. */
const GENERATED = [ { seed: 4242, length: 14, difficulty: 0.6 }, { seed: 7, length: 12, difficulty: 0.3 }, { seed: 99, length: 16, difficulty: 0.8 } ];

/**
 * @param {string} name
 * @returns {object} the course's definition
 */
function definition( name ) {

	const generated = /^generated-(\d+)$/.exec( name );
	if ( generated ) {

		const seed = Number( generated[ 1 ] );
		const settings = GENERATED.find( ( g ) => g.seed === seed ) ?? { seed, length: 14, difficulty: 0.5 };
		// The generator retries the challenges the validator finds no way through.
		const check = ( candidate ) => {

			const course = new Course( candidate, { metrics } );
			const report = validate( course );
			course.dispose();
			return [ ...new Set( report.violations.map( ( violation ) => violation.link.params.challenge ).filter( ( i ) => i !== undefined ) ) ];

		};

		return { ...generate( { ...settings, check } ).def, name };

	}

	return JSON.parse( fs.readFileSync( path.join( PROJECT, 'public/courses', `${name}.json` ), 'utf8' ) );

}

const courses = new Map();

/**
 * @param {string} name
 * @returns {Course} built once per process
 */
function courseFor( name ) {

	if ( ! courses.has( name ) ) courses.set( name, new Course( definition( name ), { metrics } ) );
	return courses.get( name );

}

/**
 * @param {string} name
 * @returns {World} a fresh World for one simulation
 */
function worldFor( name ) {

	const world = new World( fromCourse( courseFor( name ) ) );
	world.name = name;
	return world;

}

export { definition, courseFor, worldFor, GENERATED };
