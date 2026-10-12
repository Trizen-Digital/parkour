// The controls page: every control by group, with its keyboard and pad bindings read from the core's action table
// (@trizen/parkour/data/actions.js), so the page shows what the game does. A binding is a list of tokens: glyph codes
// (src/ui/glyphs.js) and the separators between them ('+' held together, '→' one after the other, '/' either). The
// lessons also name the touch controls' parts (src/touch/TouchInput.js), which have no page of their own.

import { ACTIONS } from '@trizen/parkour/data/actions.js';
import { BUTTONS } from '../touch/TouchInput.js';
import { keyName } from './glyphs.js';

// Each row: its label and the action it shows, or its bindings written out where no one action has them.
const GROUPS = [
	[ 'Movement', [
		[ 'Run', 'move' ], [ 'Look', { keys: [ 'Mouse' ], pad: [ 'pad:stickR' ] } ], [ 'Sprint', 'sprint' ], [ 'Jump', 'jump' ],
		[ 'Roll on Landing', 'tuck' ], [ 'Grab', 'grab' ], [ 'Slide', 'slide' ], [ 'Precision', 'precision' ], [ 'Interact', 'interact' ],
	] ],
	[ 'Tricks', [ [ 'Flip', 'flip' ], [ 'Wheel', 'wheel' ], [ 'Dive', 'dive' ], [ 'Back Flip', 'backflip' ], [ 'Spin Dive', 'spinDive' ] ] ],
	[ 'Camera', [
		[ 'First Person', 'toggleView' ], [ 'Free Look', 'freeLook' ], [ 'Slow Motion', 'slowMotion' ],
		[ 'Field of View', { keys: [ 'Wheel' ], pad: [ 'pad:r1', '+', 'pad:up', '/', 'pad:down' ] } ],
	] ],
	[ 'Ragdoll', [ [ 'Go Limp', 'goLimp' ], [ 'Stand Up', 'standUp' ] ] ],
	[ 'Game', [ [ 'Menu', 'pause' ], [ 'Restart Course', 'restart' ], [ 'Set Mark', 'setMark' ], [ 'Back to Mark', 'backToMark' ], [ 'Easy Mode', 'easyMode' ], [ 'Hide HUD', 'toggleUi' ] ] ],
	[ 'QA', [ [ 'Capture', 'captureReplay' ], [ 'Replays', 'replayLibrary' ], [ 'Benchmark', 'benchmark' ] ] ],
];

// One action's bindings on a device as tokens: each binding a code or a chord, either of them ('/'); keys that read
// the same (the two Shifts) once.
function tokensOf( list, prefix ) {

	const seen = new Set(), tokens = [];
	for ( const entry of list ?? [] ) {

		const codes = ( Array.isArray( entry ) ? entry : [ typeof entry === 'object' ? entry.button : entry ] ).map( ( code ) => prefix + code );
		const name = codes.map( keyName ).join( '+' );
		if ( seen.has( name ) ) continue;
		seen.add( name );
		if ( tokens.length ) tokens.push( '/' );
		codes.forEach( ( code, i ) => tokens.push( ...( i ? [ '+', code ] : [ code ] ) ) );

	}

	return tokens;

}

function bindingsOf( name ) {

	const action = ACTIONS[ name ];
	if ( action.sequence ) {

		// A sequence: the first press, then the second.
		const [ first, then ] = action.sequence.map( bindingsOf );
		const join = ( a, b ) => a.length && b.length ? [ a[ 0 ], '→', b[ 0 ] ] : [];
		return { keys: join( first.keys, then.keys ), pad: join( first.pad, then.pad ) };

	}

	if ( action.kind === 'move' ) return { keys: [ action.keys.forward, action.keys.left, action.keys.back, action.keys.right ], pad: [ 'pad:stickL' ] };
	return { keys: tokensOf( action.keys, '' ), pad: tokensOf( action.pad, 'pad:' ) };

}

// Bindings the tutorial's lessons name that no one action has (src/tutorial/lessons.js): looking round, the stick's
// pushes on their own, and the shimmy along a ledge.
const LESSON_BINDINGS = {
	look: { keys: [ 'Mouse' ], pad: [ 'pad:stickR' ] },
	forward: { keys: [ 'KeyW' ], pad: [ 'pad:stickL' ] },
	back: { keys: [ 'KeyS' ], pad: [ 'pad:stickL' ] },
	shimmy: { keys: [ 'KeyA', '/', 'KeyD' ], pad: [ 'pad:stickL' ] },
};

// The touch controls' parts by action or lesson binding: a button for each action it presses, the stick for the moves,
// and Jump for what shares its key (the roll on landing, standing up).
const TOUCH = {
	...Object.fromEntries( BUTTONS.map( ( action ) => [ action, [ `touch:${action}` ] ] ) ),
	move: [ 'touch:stick' ], forward: [ 'touch:stickUp' ], back: [ 'touch:stickDown' ], shimmy: [ 'touch:stickSide' ], look: [ 'touch:look' ],
	tuck: [ 'touch:jump' ], standUp: [ 'touch:jump' ], pause: [ 'touch:menu' ],
};

/**
 * One action's bindings, or one of the lessons' own, with the touch controls' part for it (none where they have none).
 * @param {string} name
 * @returns {{keys: string[], pad: string[], touch: string[]}}
 */
function bindingOf( name ) {

	return { ...( LESSON_BINDINGS[ name ] ?? bindingsOf( name ) ), touch: TOUCH[ name ] ?? [] };

}

/** @type {{name: string, rows: {label: string, keys: string[], pad: string[]}[]}[]} */
const CONTROLS = GROUPS.map( ( [ name, rows ] ) => ( {
	name,
	rows: rows.map( ( [ label, source ] ) => ( { label, ...( typeof source === 'string' ? bindingsOf( source ) : source ) } ) ),
} ) );

export { CONTROLS, bindingOf };
