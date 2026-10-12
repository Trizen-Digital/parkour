// The benchmark's script: the words its stations are written in. A station drives the runner through a list of steps,
// each saying what the autopilot holds and presses (as a player would: keys, the left mouse button, mouse flicks) and
// when the step is over. The conditions read the run as a player sees it: where the runner is along the station, its
// state, whether it is on the ground, how long the step has lasted.
//
// Places are the station's own: x and z in metres from its entry, the run going along +z, y above its floor. A step:
//
//   { run: 'sprint', hold: [ GRAB ], press: { [ JUMP ]: 0.05 }, flick: 'up', until: at( 6 ) }
//
//   run     how the stick is held: 'sprint' (W and Shift), 'walk' (W), 'stop' (nothing), 'back' (S), or keys
//   hold    more keys held for the step (GRAB is the left mouse button)
//   press   keys pressed as the step starts, each held so many seconds (it may outlast the step)
//   flick   the mouse flicked one frame as the step starts: a trick gesture in the air ('up', 'down', 'left', 'right')
//   steer   false leaves the mouse alone; on foot it otherwise turns the view to follow the station's line
//   face    a heading to turn the view to instead (degrees: 0 along the station, 90 toward +x, 180 back)
//   x       the line to follow, metres across (0 by default)
//   until   when the step is over (a condition below); `for` seconds is a shorthand for after()
//   limit   the station fails if the step lasts longer than this (s; 8 by default), naming the step by `say`

const W = 'KeyW', A = 'KeyA', S = 'KeyS', D = 'KeyD', SHIFT = 'ShiftLeft';
const JUMP = 'Space', GRAB = 'Mouse0', PRECISION = 'KeyE', FLIP = 'KeyF', WHEEL = 'KeyR', DIVE = 'KeyT';
const BACKFLIP = 'KeyG', SLIDE = 'KeyX', VIEW = 'KeyC', LIMP = 'Digit4';

// The stick, as held keys.
const RUNS = { sprint: [ W, SHIFT ], walk: [ W ], stop: [], back: [ S ], left: [ A ], right: [ D ], backSprint: [ S, SHIFT ] };

// The slopes up to decks and down from them rise at this angle (rad): run up and down at a sprint.
const RAMP_SLOPE = 20 * Math.PI / 180;

/** How long a slope up or down `height` metres is (m). */
const rampLength = ( height ) => height / Math.tan( RAMP_SLOPE );

// States in which the runner is on its feet and the mouse turns the view for it.
const ON_FOOT = new Set( [ 'standing', 'walking', 'sprinting' ] );

// ---- Conditions: ( s ) => boolean, where s is what the autopilot reads of the run (Autopilot.read).

/** Past z metres along the station. */
const at = ( z ) => ( s ) => s.z >= z;

/** In one of these states. */
const inState = ( ...names ) => ( s ) => names.includes( s.state );

/** In none of these states. */
const notState = ( ...names ) => ( s ) => ! names.includes( s.state );

/** On the ground (standing on a floor, in any state). */
const grounded = () => ( s ) => s.grounded;

/** Flying: under gravity, held to nothing. */
const airborne = () => ( s ) => s.mode === 'air';

/** Coming down: off the ground, falling. */
const falling = () => ( s ) => ! s.grounded && s.vy < 0;

/** On its feet and free to run (standing, walking or sprinting). */
const onFoot = () => ( s ) => s.onFoot;

/** The step has lasted this long (s). */
const after = ( seconds ) => ( s ) => s.t >= seconds - 1e-9;

/** The runner's feet are this high above the station's floor, or higher (m). */
const above = ( y ) => ( s ) => s.y >= y;

/** Lower than this (m). */
const below = ( y ) => ( s ) => s.y < y;

/** Slower than this across the ground (m/s). */
const slowerThan = ( speed ) => ( s ) => s.speed < speed;

/** A move (by name, or a pattern) is playing. */
const playing = ( move ) => ( s ) => typeof move === 'string' ? s.move === move : move.test( s.move ?? '' );

/** The ragdoll has the body. */
const limp = () => ( s ) => s.limp;

const all = ( ...tests ) => ( s ) => tests.every( ( test ) => test( s ) );
const any = ( ...tests ) => ( s ) => tests.some( ( test ) => test( s ) );
const not = ( test ) => ( s ) => ! test( s );

export {
	W, A, S, D, SHIFT, JUMP, GRAB, PRECISION, FLIP, WHEEL, DIVE, BACKFLIP, SLIDE, VIEW, LIMP, RUNS, ON_FOOT, RAMP_SLOPE, rampLength,
	at, inState, notState, grounded, airborne, falling, onFoot, after, above, below, slowerThan, playing, limp, all, any, not,
};
