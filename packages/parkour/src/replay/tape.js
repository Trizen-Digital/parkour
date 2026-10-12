// QA replays on paper: the recorded run's raw input frames (deviceState.js) packed for storage, the settings it
// started with and changed between frames, its per-frame trace, the player's presses for the timeline, and a short
// written summary. `Tape` is the recording itself while it runs.

import { buttonsInFrame } from '../input/Input.js';

const FORMAT = 'qa-replay/1';

// −0 survives JSON as a string, so a replayed frame gets the very numbers that were recorded.
const pack = ( x ) => Object.is( x, - 0 ) ? '-0' : x;
const unpack = ( x ) => typeof x === 'string' ? Number( x ) : x;

// The settings a run plays by: the physics engine, the tuning, the player's preferences, the camera's aspect and the
// random seed. The engine is the simulation's own (a replay is run on a simulation built on it); the rest are applied
// to whatever simulation replays the run, and may change between frames.
function readSettings( sim ) {

	return {
		engine: sim.engine,
		tuning: { ...sim.tuning.values },
		preferences: { ...sim.input.preferences.values },
		aspect: sim.camera.aspect,
		seed: sim.random.seed
	};

}

/** The physics engine a recording was made on: Rapier, the default, unless its settings name another. */
function engineOf( settings ) {

	return settings?.engine ?? 'rapier';

}

function applySettings( sim, settings ) {

	if ( settings.tuning ) sim.tuning.values = { ...sim.tuning.values, ...settings.tuning };
	if ( settings.preferences ) sim.input.preferences.values = { ...sim.input.preferences.values, ...settings.preferences };

	if ( settings.aspect !== undefined && sim.camera.aspect !== settings.aspect ) {

		sim.camera.aspect = settings.aspect;
		sim.camera.updateProjectionMatrix();

	}

	if ( settings.seed !== undefined ) sim.random.seed = settings.seed;

}

/** What changed from settings `a` to `b` (tuning, preferences, aspect), or null. */
function settingsDiff( a, b ) {

	let diff = null;

	for ( const group of [ 'tuning', 'preferences' ] ) {

		for ( const key of new Set( [ ...Object.keys( a[ group ] ), ...Object.keys( b[ group ] ) ] ) ) {

			if ( ! Object.is( a[ group ][ key ], b[ group ][ key ] ) ) ( ( diff ??= {} )[ group ] ??= {} )[ key ] = b[ group ][ key ];

		}

	}

	if ( a.aspect !== b.aspect ) ( diff ??= {} ).aspect = b.aspect;

	return diff;

}

function applyDiff( settings, diff ) {

	if ( diff.tuning ) Object.assign( settings.tuning, diff.tuning );
	if ( diff.preferences ) Object.assign( settings.preferences, diff.preferences );
	if ( diff.aspect !== undefined ) settings.aspect = diff.aspect;

}

// A pad in a stored replay: [ id, axes, buttons ], a button a single number when its value equals its pressed state.
function packPad( pad ) {

	if ( ! pad ) return null;
	return [ pad.id, pad.axes.map( pack ), pad.buttons.map( ( [ pressed, value ] ) => value === pressed ? pressed : [ pressed, pack( value ) ] ) ];

}

function unpackPad( packed ) {

	if ( ! packed ) return null;
	const [ id, axes, buttons ] = packed;
	return { id, axes: axes.map( unpack ), buttons: buttons.map( ( button ) => typeof button === 'number' ? [ button, button ] : [ button[ 0 ], unpack( button[ 1 ] ) ] ) };

}

/**
 * Raw frames packed for storage: the mouse and frame times per frame, the key edges where there are any, and every
 * other field as runs of [ frame, value ] (it rarely changes from frame to frame).
 */
function encodeInput( frames ) {

	const out = { dt: [], mx: [], my: [], wheel: [], edges: [], keys: [], buttons: [], pad: [], enabled: [], editing: [] };
	const last = {};
	const run = ( name, f, value ) => {

		const key = JSON.stringify( value );
		if ( f > 0 && last[ name ] === key ) return;
		last[ name ] = key;
		out[ name ].push( [ f, value ] );

	};

	frames.forEach( ( frame, f ) => {

		out.dt.push( pack( frame.dt ) );
		out.mx.push( pack( frame.mouse[ 0 ] ) );
		out.my.push( pack( frame.mouse[ 1 ] ) );
		out.wheel.push( pack( frame.mouse[ 2 ] ) );
		if ( frame.edges.length ) out.edges.push( [ f, frame.edges ] );
		run( 'keys', f, frame.keys );
		run( 'buttons', f, frame.buttons );
		run( 'pad', f, packPad( frame.pad ) );
		run( 'enabled', f, frame.enabled );
		run( 'editing', f, frame.editing );

	} );

	return out;

}

function decodeInput( input ) {

	const runs = ( list ) => {

		let i = 0, value = null;

		return ( f ) => {

			while ( i < list.length && list[ i ][ 0 ] <= f ) value = list[ i ++ ][ 1 ];
			return value;

		};

	};

	const keys = runs( input.keys ), buttons = runs( input.buttons ), pad = runs( input.pad ), enabled = runs( input.enabled ), editing = runs( input.editing );
	const edges = new Map( input.edges );
	const frames = [];

	for ( let f = 0; f < input.dt.length; f ++ ) {

		frames.push( {
			dt: unpack( input.dt[ f ] ),
			keys: [ ...keys( f ) ],
			buttons: [ ...buttons( f ) ],
			mouse: [ unpack( input.mx[ f ] ), unpack( input.my[ f ] ), unpack( input.wheel[ f ] ) ],
			edges: ( edges.get( f ) ?? [] ).map( ( edge ) => edge.slice() ),
			pad: unpackPad( pad( f ) ),
			enabled: enabled( f ),
			editing: editing( f )
		} );

	}

	return frames;

}

/** The time at the start of each frame (s), and at the end of the last; a frame counts for at most 0.05 s, as in a run. */
function timesOf( dts ) {

	const times = [ 0 ];
	for ( const dt of dts ) times.push( times[ times.length - 1 ] + Math.min( unpack( dt ), 0.05 ) );
	return times;

}

/** The presses the timeline marks, each an action of the table, with its letter (none: a bar only) and colour. */
const PRESSES = [
	{ name: 'jump', action: 'jump', letter: 'J', color: '#4fb3c8' },
	{ name: 'grab', action: 'grab', letter: 'G', color: '#63d297' },
	{ name: 'precision', action: 'precision', letter: 'P', color: '#a78bfa' },
	{ name: 'sprint', action: 'sprint', letter: '', color: '#f0b45a' },
	{ name: 'slide', action: 'slide', letter: 'S', color: '#f0b45a' },
	{ name: 'dive', action: 'dive', letter: 'T', color: '#f472b6' },
	{ name: 'wheel trick', action: 'wheel', letter: 'W', color: '#f472b6' },
	{ name: 'flip', action: 'flip', letter: 'F', color: '#f472b6' },
	{ name: 'slow motion', action: 'slowMotion', letter: 'O', color: '#8b95a3' },
	{ name: 'view', action: 'toggleView', letter: 'V', color: '#8b95a3' },
	{ name: 'limp', action: 'goLimp', letter: 'L', color: '#e0796b' },
	{ name: 'mark', action: 'setMark', letter: 'M', color: '#8b95a3' },
	{ name: 'back to mark', action: 'backToMark', letter: 'K', color: '#8b95a3' },
	{ name: 'pause', action: 'pause', letter: '‖', color: '#8b95a3' },
	{ name: 'easy', action: 'easyMode', letter: 'E', color: '#63d297' }
];

/**
 * The player's presses through the frames, by the action table's bindings on foot: per frame the presses held, and
 * [ frame, name ] each time one goes down or is tapped between frames.
 */
function pressesOf( frames ) {

	const held = [], presses = [];
	let before = new Set();

	frames.forEach( ( frame, f ) => {

		const buttons = buttonsInFrame( frame );
		const now = new Set( PRESSES.filter( ( press ) => buttons.held.has( press.action ) ).map( ( press ) => press.name ) );
		const tapped = new Set( PRESSES.filter( ( press ) => buttons.tapped.has( press.action ) ).map( ( press ) => press.name ) );

		for ( const name of new Set( [ ...now, ...tapped ] ) ) if ( ! before.has( name ) || tapped.has( name ) ) presses.push( [ f, name ] );
		held.push( now );
		before = now;

	} );

	return { held, presses };

}

/** A short hash of a text (FNV-1a), for telling recordings and courses apart. */
function hashString( text ) {

	let hash = 2166136261;
	for ( let i = 0; i < text.length; i ++ ) hash = Math.imul( hash ^ text.charCodeAt( i ), 16777619 );
	return ( hash >>> 0 ).toString( 16 ).padStart( 8, '0' );

}

// The per-frame trace: numbers in columns (the frame trace's rows, qa/trace.js), and runs of the named states.
const COLUMNS = [ 'x', 'y', 'z', 'yaw', 'v', 'vy', 'cy', 'cp', 'tau', 'steps', 'acc', 'hash' ];
const RUNS = [ 'state', 'move', 'mode', 'easy' ];

/** A run being recorded: its frames, their trace rows, the events between frames, and where it started. */
class Tape {

	constructor( start, settings ) {

		this.start = start;
		this.settings = settings;
		this.frames = [];
		this.rows = [];
		this.events = [];
		// The time at the start of each frame.
		this.t = [ 0 ];
		// Frames cut from the front since recording began.
		this.base = 0;

	}

	get n() {

		return this.frames.length;

	}

	get duration() {

		return this.t[ this.n ];

	}

	push( frame ) {

		this.frames.push( frame );
		this.t.push( this.t[ this.t.length - 1 ] + Math.min( frame.dt, 0.05 ) );

	}

	/** Something that happened before frame `f`: a respawn, a settings change, a clear of the input. */
	event( f, e ) {

		this.events.push( { f, ...e } );

	}

	// The frames a replay can start from: the first, and each respawn.
	starts() {

		return [ 0, ...this.events.filter( ( e ) => e.respawn && e.f > 0 ).map( ( e ) => e.f ) ];

	}

	/** The first frame starting at or after time `t`. */
	frameAt( t ) {

		let lo = 0, hi = this.n;

		while ( lo < hi ) {

			const mid = ( lo + hi ) >> 1;
			if ( this.t[ mid ] < t ) lo = mid + 1;
			else hi = mid;

		}

		return lo;

	}

	startBefore( f ) {

		return this.starts().filter( ( s ) => s <= f ).pop() ?? 0;

	}

	/** Where a replay starting at frame `f` begins, and with which settings. */
	stateAt( f ) {

		let start = this.start, settings = structuredClone( this.settings );

		for ( const e of this.events ) {

			if ( e.f > f || ( e.f === f && ! e.respawn ) ) continue;
			if ( e.respawn ) start = e.respawn;
			if ( e.settings && e.f < f ) applyDiff( settings, e.settings );

		}

		return { start, settings };

	}

	/** Keeps the last `keep` seconds or a little more: everything from the start before them. */
	prune( keep ) {

		const s = this.startBefore( this.frameAt( this.duration - keep ) );
		if ( s > 0 ) this.cut( s );

	}

	cut( s ) {

		const { start, settings } = this.stateAt( s );
		this.start = start;
		this.settings = settings;
		this.frames.splice( 0, s );
		this.rows.splice( 0, s );
		const t0 = this.t[ s ];
		this.t = this.t.slice( s ).map( ( t ) => t - t0 );
		this.events = this.events.filter( ( e ) => e.f >= s ).map( ( e ) => ( { ...e, f: e.f - s } ) );
		this.base += s;

	}

	/** The frames from `s` to `to` as a replay (a respawn or the start at `s`). */
	record( s, to ) {

		const { start, settings } = this.stateAt( s );
		const frames = this.frames.slice( s, to + 1 ), t = this.t;

		return {
			start,
			settings,
			events: this.events.filter( ( e ) => e.f >= s && e.f <= to ).map( ( e ) => ( { ...e, f: e.f - s } ) ),
			frames: frames.length,
			duration: + ( t[ to + 1 ] - t[ s ] ).toFixed( 6 ),
			input: encodeInput( frames ),
			trace: traceOf( this.rows.slice( s, to + 1 ) )
		};

	}

	/** A tape that carries on recording after frame `to` of a saved replay. */
	static from( rec, to, rows ) {

		const tape = new Tape( rec.start, structuredClone( rec.settings ) );
		for ( const frame of decodeInput( rec.input ).slice( 0, to + 1 ) ) tape.push( frame );
		tape.rows = rows.slice( 0, to + 1 );
		tape.events = ( rec.events ?? [] ).filter( ( e ) => e.f <= to ).map( ( e ) => structuredClone( e ) );
		return tape;

	}

}

function traceOf( rows ) {

	const trace = Object.fromEntries( COLUMNS.map( ( column ) => [ column, rows.map( ( row ) => row[ column ] ?? 0 ) ] ) );

	for ( const name of RUNS ) {

		const list = trace[ `${name}s` ] = [];

		rows.forEach( ( row, f ) => {

			const value = row[ name ] ?? '';
			if ( ! list.length || list[ list.length - 1 ][ 1 ] !== value ) list.push( [ f, value ] );

		} );

	}

	return trace;

}

/**
 * Frames where the figure's joints jolt (`acc`, m/s²): two frames in a row above `min` and `k` times the frames
 * around them.
 */
function findPops( acc, from = 0, to = acc.length - 1, k = 2.5, min = 150 ) {

	const pops = [];

	for ( let i = Math.max( 2, from ); i < Math.min( acc.length - 3, to ); i ++ ) {

		const a = acc[ i ], b = acc[ i + 1 ], around = Math.max( acc[ i - 2 ], acc[ i - 1 ], acc[ i + 2 ], acc[ i + 3 ] );
		if ( Math.min( a, b ) > min && Math.min( a, b ) > k * around ) pops.push( i );

	}

	return pops;

}

/** A run's value at frame `f`. */
function runAt( runs, f ) {

	let value = '';

	for ( const [ g, v ] of runs ) {

		if ( g > f ) break;
		value = v;

	}

	return value;

}

/** A replay's window in words: what the runner did, what the player pressed, where the figure jolted. */
function summarize( rec, frames = decodeInput( rec.input ) ) {

	const t = timesOf( rec.input.dt ), w = rec.window, T = rec.trace;
	const at = ( f ) => ( t[ f ] - t[ w.from ] ).toFixed( 2 );
	const inWindow = ( f ) => f >= w.from && f <= w.to;

	const flow = [ `0.00 ${runAt( T.states, w.from )}${runAt( T.moves, w.from ) ? ` > ${runAt( T.moves, w.from )}` : ''}` ];
	const changes = [ ...T.states.map( ( [ f, s ] ) => [ f, s ] ), ...T.moves.filter( ( [ , m ] ) => m ).map( ( [ f, m ] ) => [ f, `> ${m}` ] ) ].sort( ( a, b ) => a[ 0 ] - b[ 0 ] );
	for ( const [ f, s ] of changes ) if ( f > w.from && f <= w.to ) flow.push( `${at( f )} ${s}` );

	const presses = pressesOf( frames ).presses.filter( ( [ f ] ) => inWindow( f ) ).map( ( [ f, name ] ) => [ f, `${at( f )} ${name}` ] );

	for ( const e of rec.events ) {

		if ( ! inWindow( e.f ) ) continue;
		if ( e.respawn ) presses.push( [ e.f, `${at( e.f )} respawn` ] );
		if ( e.clear ) presses.push( [ e.f, `${at( e.f )} input cleared` ] );
		if ( e.settings ) presses.push( [ e.f, `${at( e.f )} settings ${JSON.stringify( e.settings )}` ] );

	}

	for ( const [ f, on ] of T.easys ?? [] ) if ( inWindow( f ) && f > 0 ) presses.push( [ f, `${at( f )} Easy mode ${on ? 'on' : 'off'}` ] );

	return {
		flow,
		presses: presses.sort( ( a, b ) => a[ 0 ] - b[ 0 ] ).map( ( [ , s ] ) => s ),
		pops: findPops( T.acc, w.from, w.to ).map( ( f ) => `${at( f )} ${T.acc[ f ]}/${T.acc[ f + 1 ]} m/s²` ),
		moves: [ ...new Set( T.moves.filter( ( [ f, m ] ) => m && f <= w.to ).map( ( [ , m ] ) => m ) ) ],
		maxAcc: Math.max( 0, ...T.acc.slice( w.from + 3, w.to + 1 ) )
	};

}

export { FORMAT, readSettings, engineOf, applySettings, settingsDiff, encodeInput, decodeInput, timesOf, PRESSES, pressesOf, hashString, Tape, traceOf, findPops, runAt, summarize };
