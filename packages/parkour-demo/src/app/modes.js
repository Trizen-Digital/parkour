// The game modes, chosen on the Game Mode screen (src/ui/GameMode.svelte) or by the page's `?mode=`: the tutorial
// (its course, from the flag of the first lesson not done), the sandbox (a course, from its first spawn) and the
// benchmark. Choosing the tutorial or the sandbox is a course load: the run starts from the simulation as it loaded,
// so a capture made in either replays exactly. The mode and the sandbox's course are demo options
// (src/ui/state.svelte.js): neither changes a run, so neither goes on a QA tape.

import { setOption, toast, ui } from '../ui/state.svelte.js';

/** The tutorial's course file. */
const TUTORIAL = 'tutorial';

const MODES = [ 'tutorial', 'sandbox', 'bench' ];

/**
 * The courses the Sandbox chooses between: every course but the tutorial's, in the game's order (the Foundry first,
 * Generated last).
 * @param {Game} game
 * @returns {string[]}
 */
function sandboxCourses( game ) {

	return game.courses.filter( ( course ) => course !== TUTORIAL );

}

/**
 * A course file's name as the menus show it: test_wallruns is Wallruns.
 * @param {string} course
 * @returns {string}
 */
function courseName( course ) {

	return course.replace( /^test_/, '' ).replace( /_/g, ' ' ).replace( /(^|\s)([a-z])/g, ( _, space, letter ) => space + letter.toUpperCase() );

}

/**
 * Loads a course and plays it from where the player starts on it, out of the menu if it is open.
 * @param {{game: Game, qa: QA}} app
 * @param {string} course
 * @returns {Promise<boolean>} whether it loaded
 */
async function play( { game, qa }, course ) {

	try {

		await game.loadCourse( course );

	} catch ( error ) {

		console.error( error );
		toast( `${courseName( course )} failed to load`, 'warn' );
		return false;

	}

	qa.resume();
	return true;

}

/**
 * The tutorial, at the first lesson not done (src/tutorial/Tutorial.js puts the runner at its flag).
 * @param {{game: Game, qa: QA}} app
 */
function playTutorial( app ) {

	setOption( 'mode', 'tutorial' );
	return play( app, TUTORIAL );

}

/**
 * The sandbox on a course.
 * @param {{game: Game, qa: QA}} app
 * @param {string} [course] the sandbox's last course unless given
 */
function playSandbox( app, course = ui.options.sandbox ) {

	if ( ! sandboxCourses( app.game ).includes( course ) ) course = sandboxCourses( app.game )[ 0 ];
	setOption( 'mode', 'sandbox' );
	setOption( 'sandbox', course );
	return play( app, course );

}

/**
 * The benchmark, as K opens it. It is not a mode a later load starts in.
 * @param {{qa: QA}} app
 */
function openBenchmark( { qa } ) {

	return qa.openBench();

}

/**
 * The course a page load starts on: `?course=`, else the tutorial's when the tutorial was the last mode (or
 * `?mode=tutorial` asks for it), else the sandbox's.
 * @param {string[]} courses
 * @param {URLSearchParams} page
 * @returns {string}
 */
function startingCourse( courses, page ) {

	const mode = page.get( 'mode' ) ?? ui.options.mode;
	if ( page.has( 'course' ) ) return page.get( 'course' );
	if ( mode === 'tutorial' ) return TUTORIAL;
	return courses.includes( ui.options.sandbox ) ? ui.options.sandbox : courses[ 0 ];

}

/**
 * What a page load does once the game is up: `?mode=bench` opens the benchmark, and the first load ever (no mode
 * chosen, none asked for) opens the Game Mode screen over the game.
 * @param {{qa: QA}} app
 * @param {URLSearchParams} page
 */
function startMode( { qa }, page ) {

	const asked = page.get( 'mode' );
	if ( asked === 'bench' ) return qa.openBench();
	if ( MODES.includes( asked ) || page.has( 'course' ) || page.has( 'replay' ) || page.has( 'bench' ) ) return;
	if ( ui.options.mode ) return;
	ui.modeBack = null;
	qa.openMenu( 'mode' );

}

export { TUTORIAL, sandboxCourses, courseName, playTutorial, playSandbox, openBenchmark, startingCourse, startMode };
