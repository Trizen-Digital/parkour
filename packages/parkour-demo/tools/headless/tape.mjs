// Scripted tapes: a scenario (a course, a start, timed inputs) turned into the raw input of every frame, as a player
// would have produced it (`tape/1`). The golden tapes are written from scenarios.mjs with this.

const MOUSE_KEYS = [ 'Mouse0', 'Mouse1', 'Mouse2' ];

/**
 * Frame times over a scenario: `dt` each, or wobbling by up to `jitter` (a real display's frames), rounded to the
 * microsecond so a tape's times are exact in JSON.
 * @param {number} seconds
 * @param {number} dt
 * @param {number} jitter
 * @returns {number[]}
 */
function frameTimes( seconds, dt, jitter ) {

	const times = [];
	let t = 0, i = 0;
	while ( t < seconds ) {

		// Two incommensurate waves: an irregular wobble that is the same every time.
		const wobble = jitter ? jitter * Math.sin( i * 2.399963 ) * Math.cos( i * 0.7071 ) : 0;
		const step = Math.round( ( dt + wobble ) * 1e6 ) / 1e6;
		times.push( step );
		t += step;
		i ++;

	}

	return times;

}

/**
 * @param {object} scenario `name`, `course`, `start`, `seconds`, `dt` (1/60 by default), `jitter`, and `inputs`:
 *   `{ at, until, keys, buttons, mouse: [ x, y, wheel ] (counts a frame), pad }`
 * @returns {object} the tape
 */
function scriptTape( scenario ) {

	const times = frameTimes( scenario.seconds, scenario.dt ?? 1 / 60, scenario.jitter ?? 0 );
	const frames = [];
	let held = new Set(), buttons = new Set(), clock = 0;
	for ( const dt of times ) {

		const active = scenario.inputs.filter( ( input ) => clock >= input.at && clock < ( input.until ?? Infinity ) );
		const keys = new Set( active.flatMap( ( input ) => input.keys ?? [] ) );
		const mouseButtons = new Set( active.flatMap( ( input ) => input.buttons ?? [] ) );
		const edges = [];
		for ( const code of keys ) if ( ! held.has( code ) ) edges.push( [ code, 'pressed' ] );
		for ( const code of held ) if ( ! keys.has( code ) ) edges.push( [ code, 'released' ] );
		for ( const button of mouseButtons ) if ( ! buttons.has( button ) ) edges.push( [ MOUSE_KEYS[ button ], 'pressed' ] );
		for ( const button of buttons ) if ( ! mouseButtons.has( button ) ) edges.push( [ MOUSE_KEYS[ button ], 'released' ] );
		const mouse = active.reduce( ( sum, input ) => ( input.mouse ? [ sum[ 0 ] + input.mouse[ 0 ], sum[ 1 ] + input.mouse[ 1 ], sum[ 2 ] + ( input.mouse[ 2 ] ?? 0 ) ] : sum ), [ 0, 0, 0 ] );
		const pad = active.find( ( input ) => input.pad )?.pad ?? null;
		frames.push( { dt, keys: [ ...keys ], buttons: [ ...mouseButtons ], mouse, edges, pad, enabled: true, editing: false } );
		held = keys;
		buttons = mouseButtons;
		clock += dt;

	}

	return { format: 'tape/1', name: scenario.name, course: scenario.course, start: scenario.start ?? { spawn: 0 }, frames };

}

export { scriptTape, frameTimes };
