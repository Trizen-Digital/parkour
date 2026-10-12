// The move builder's input: one module per family of takes in `families/`, each exporting the takes it authors and
// the moves that play them. Everything the game reads about a take or a move is built from these specs, never edited
// in the shipped files.
//
// A take is one of three things:
// - built from a capture: `from: { clip, span }`, a part of a mocap clip in `assets/mocap/` (`'final/roll_run'`)
//   re-timed by its anchors;
// - kept as stored: `kept: '…'`, a clip made from captures by hand, beyond what the builder does (what was done is
//   the note; `from` says which capture, when that is known);
// - a placeholder: `fill: { kind, reason }`, made without a capture of ours (keyed by hand, fitted, cut together from
//   others, posed); its stored clip is kept until a capture replaces it, and `captures` lists it.
//
// Its timing: `anchors`, `[ clipTime, takeTime, label ]`, pin beats of the capture to times of the take (straight
// lines between them; the last one is the take's length), or just a `length`; `loop` when the anchors run past the
// span and the capture's cycle plays again. Times in a take's spec (anchors, markers, root keys, a move's span) run
// on the take's own timeline; `pace` says how much faster than that the take plays, and the build divides every one
// of them by it, so a shipped take plays at rate 1 (its entry keeps the pace, for the pose graph's hand-overs).
// A take of steps may give its `stride` instead of a pace: how far one cycle of it carries the runner (m); with a
// `speed` (m/s), the speed it is paced for, its pace is that speed over its own (its stride over its length).
// A take built from a capture may `shift` the body, `[ x, y, z ]` (m, +Z forward), added to the hips' track: a
// capture whose actor stood off where the game holds the runner (a ladder's rungs a body's length out) is moved onto
// it.
//
// What the game reads of it: `markers`, `[ name, time ]`; `sounds`, the same for the demo's sound (src/sound/: a foot
// on the ground, a hand or foot on a rung), which the run never reads; `root`, `{ times, positions }`, the travel of a
// take the runner follows (metres, +Z forward); `stride`, by which the turn blends play it in step with the runner's
// speed; `additive`, the take whose first pose it adds over; `pinned` (the root bone is always held) and
// `pinAt: 'firstFrame'` (held at the take's first pose rather than the rest pose).
//
// A move: the `take` it plays, the `span` of it (default all), `length` (in playing seconds; default the span's),
// `rate` (default 1), `blendIn`, `blendInCurve` (default straight), `blendOut`, `holdAtEnd` (wait on the last pose
// instead of blending out on its own), the `layer` it plays into (default the body) and `mask` (`upper`: it shows from
// the spine up, the body beneath it going on).

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FAMILIES = new URL( '../families/', import.meta.url );

// The markers the game reads (MarkerResponses, Tricks): a take may carry only these.
const MARKERS = [ 'leftFoot', 'rightFoot', 'rollStart', 'rollEnd', 'trickStart', 'trickEnd', 'airComboOpen', 'capsuleShrink',
	'capsuleRestore' ];

// The sound cues the demo's sound plays (src/sound/Sound.js): a take's `sounds` may carry only these.
const SOUNDS = [ 'step', 'rung' ];

// How a placeholder was made.
const FILLS = [ 'keyed', 'fitted', 'cuts', 'acrobatics', 'posed', 'hold' ];

// The layers a move plays into (the pose graph's), and the parts of the body a move may show on alone.
const LAYERS = [ 'body', 'landing', 'climb', 'ledgeLeap' ];
const MASKS = [ 'upper' ];

// How far past its take a time may reach and still count as its end: times were measured to the microsecond.
const END_SLACK = 1e-6;

/**
 * Every family's takes and moves, by name, each with the family it came from.
 * @returns {Promise<{ families: string[], takes: Map<string, object>, moves: Map<string, object> }>}
 */
async function loadSpecs( folder = FAMILIES ) {

	const families = readdirSync( fileURLToPath( folder ) ).filter( ( file ) => file.endsWith( '.js' ) ).map( ( file ) => file.slice( 0, - 3 ) ).sort();
	const takes = new Map(), moves = new Map();

	for ( const family of families ) {

		const spec = await import( new URL( family + '.js', folder ) );

		for ( const [ name, take ] of Object.entries( spec.takes ?? {} ) ) {

			if ( takes.has( name ) ) throw new Error( `take ${ name } is in both ${ takes.get( name ).family } and ${ family }` );
			takes.set( name, { ...take, name, family } );

		}

		for ( const [ name, move ] of Object.entries( spec.moves ?? {} ) ) {

			if ( moves.has( name ) ) throw new Error( `move ${ name } is in both ${ moves.get( name ).family } and ${ family }` );
			moves.set( name, { ...move, name, family } );

		}

	}

	return { families, takes, moves };

}

// A take's length on its own timeline: where its last anchor lands, or the length it is given.
function specLength( take ) {

	return take.anchors ? take.anchors.at( - 1 )[ 1 ] : take.length;

}

// How many times faster than its own timeline a take plays: its pace, or for a take paced for a speed, that speed
// over the take's own (its stride over its length); 1 when it has neither.
function takePace( take ) {

	return take.speed !== undefined ? take.speed / ( take.stride / specLength( take ) ) : take.pace ?? 1;

}

// Whether the build makes this take's clip from its capture (rather than keeping the stored one).
function isBuilt( take ) {

	return Boolean( take.from ) && ! take.kept && ! take.fill;

}

/**
 * Everything wrong with the specs, as sentences (empty when they hold together).
 */
function validate( { takes, moves }, captureLength ) {

	const problems = [];
	const say = ( name, text ) => problems.push( `${ name }: ${ text }` );

	for ( const take of takes.values() ) {

		const name = take.name;
		const kinds = [ isBuilt( take ), Boolean( take.kept ), Boolean( take.fill ) ].filter( Boolean ).length;
		if ( kinds !== 1 ) say( name, 'needs exactly one of a capture to build from, a kept note or a fill' );
		if ( take.fill && take.from ) say( name, 'a placeholder has no capture' );
		if ( take.fill && ( ! FILLS.includes( take.fill.kind ) || ! take.fill.reason ) ) say( name, `a placeholder needs a kind (${ FILLS.join( ', ' ) }) and a reason` );
		if ( Boolean( take.anchors ) === ( take.length !== undefined ) ) say( name, 'needs anchors or a length, not both' );
		if ( isBuilt( take ) && ! take.anchors ) say( name, 'a take built from a capture needs anchors' );
		if ( ! ( ( take.pace ?? 1 ) > 0 ) ) say( name, 'pace must be positive' );
		if ( take.stride !== undefined && ! ( take.stride > 0 ) ) say( name, 'stride must be positive' );
		if ( take.speed !== undefined && ( take.stride === undefined || take.pace !== undefined || ! ( take.speed > 0 ) ) ) say( name, 'a speed to pace for needs a stride, and no pace of its own' );
		if ( take.shift !== undefined && ( ! isBuilt( take ) || take.shift.length !== 3 || ! take.shift.every( Number.isFinite ) ) ) say( name, 'a shift is three numbers, on a take built from a capture' );

		const length = specLength( take );
		if ( ! ( length > 0 ) ) say( name, 'has no length' );

		if ( take.from ) {

			const [ start, end ] = take.from.span;
			const available = captureLength( take.from.clip );
			if ( available === undefined ) say( name, `no capture ${ take.from.clip } in assets/mocap` );
			else if ( ! ( start >= 0 && start < end && end <= available + END_SLACK ) ) say( name, `span ${ start }…${ end } is not inside ${ take.from.clip } (0…${ available })` );

		}

		if ( take.anchors ) {

			const anchors = take.anchors;
			if ( anchors.length < 2 ) say( name, 'needs at least two anchors' );
			if ( anchors[ 0 ][ 1 ] !== 0 ) say( name, 'its first anchor must land at take time 0' );
			for ( let i = 1; i < anchors.length; i ++ ) {

				if ( ! ( anchors[ i ][ 1 ] > anchors[ i - 1 ][ 1 ] ) ) say( name, `anchor ${ i } does not move forward in take time` );
				if ( ! ( anchors[ i ][ 0 ] >= anchors[ i - 1 ][ 0 ] ) ) say( name, `anchor ${ i } goes back in clip time` );

			}

			if ( isBuilt( take ) && ! take.loop ) {

				const [ start, end ] = take.from.span;
				for ( const [ clip ] of anchors ) if ( clip < start - 1e-9 || clip > end + 1e-9 ) say( name, `anchor at clip time ${ clip } is outside its span` );

			}

		}

		for ( const [ marker, time ] of take.markers ?? [] ) {

			if ( ! MARKERS.includes( marker ) ) say( name, `the game reads no marker ${ marker }` );
			if ( ! ( time >= 0 && time <= length + END_SLACK ) ) say( name, `marker ${ marker } at ${ time } is outside the take` );

		}

		for ( const [ sound, time ] of take.sounds ?? [] ) {

			if ( ! SOUNDS.includes( sound ) ) say( name, `the sound plays no cue ${ sound }` );
			if ( ! ( time >= 0 && time <= length + END_SLACK ) ) say( name, `sound ${ sound } at ${ time } is outside the take` );

		}

		// An anchor named after a marker pins that beat: the two must agree.
		for ( const [ , time, label ] of take.anchors ?? [] ) {

			const marker = ( take.markers ?? [] ).find( ( [ markerName ] ) => markerName === label );
			if ( MARKERS.includes( label ) && ( ! marker || marker[ 1 ] !== time ) ) say( name, `anchor ${ label } at ${ time } has no marker at that time` );

		}

		if ( take.root ) {

			const { times, positions } = take.root;
			if ( times[ 0 ] !== 0 || times.some( ( time, i ) => i > 0 && ! ( time > times[ i - 1 ] ) ) || times.at( - 1 ) > length + END_SLACK ) say( name, 'root key times must rise from 0 within the take' );
			if ( positions.length !== times.length * 3 ) say( name, 'root needs three numbers per key' );

		}

		if ( take.additive && ! takes.has( take.additive ) ) say( name, `additive over a take that does not exist: ${ take.additive }` );
		if ( take.pinAt !== undefined && take.pinAt !== 'firstFrame' ) say( name, 'pinAt is firstFrame or nothing (the rest pose)' );

	}

	for ( const move of moves.values() ) {

		const name = move.name, take = takes.get( move.take );
		if ( ! take ) {

			say( name, `plays a take that does not exist: ${ move.take }` );
			continue;

		}

		const [ from, to ] = move.span ?? [ 0, specLength( take ) ];
		if ( ! ( from >= 0 && from < to && to <= specLength( take ) + END_SLACK ) ) say( name, `span ${ from }…${ to } is not inside ${ move.take }` );
		if ( move.length !== undefined && ! ( move.length > 0 ) ) say( name, 'length must be positive' );
		if ( ! ( ( move.rate ?? 1 ) > 0 ) ) say( name, 'rate must be positive' );
		if ( ! ( move.blendIn >= 0 ) || ! ( move.blendOut >= 0 ) ) say( name, 'needs blend-in and blend-out times' );
		if ( move.blendInCurve !== undefined && ! [ 'smoothstep', 'circleOut' ].includes( move.blendInCurve ) ) say( name, 'blendInCurve is smoothstep or circleOut (default straight)' );
		if ( ! LAYERS.includes( move.layer ?? 'body' ) ) say( name, `layer is one of ${ LAYERS.join( ', ' ) }` );
		if ( move.mask !== undefined && ! MASKS.includes( move.mask ) ) say( name, `mask is one of ${ MASKS.join( ', ' ) }` );

	}

	return problems;

}

export { loadSpecs, validate, specLength, takePace, isBuilt, MARKERS, SOUNDS, FILLS, LAYERS };
