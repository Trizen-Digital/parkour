// The runner's states, grouped by what they mean. The runner is in one state at a time, set by runner.setState();
// docs/ARCHITECTURE.md (The runner, States) lists them all, with what each one is and what moves the body in it.

// The states each traversal system moves the runner in: the runner's step hands it the body.
const PIPE_AND_ZIPLINE_STATES = new Set( [ 'onPipe', 'onLadder', 'toppingOut', 'onZipline' ] );
const LEDGE_STATES = new Set( [ 'hanging', 'catchingLedge', 'leapingToLedge', 'climbingUp', 'vaulting' ] );
const POLE_AND_BAR_STATES = new Set( [ 'onPole', 'onBar', 'onRope' ] );
const WALL_STATES = new Set( [ 'wallRunning', 'wallPlanted', 'wallKicking' ] );

// Hands on a ledge: catching it, hanging from it, or leaping from it to the next.
const HANGING = new Set( [ 'catchingLedge', 'hanging', 'leapingToLedge' ] );

// Settled on a ledge: hanging, or leaping from one ledge to the next.
const ON_LEDGE = new Set( [ 'hanging', 'leapingToLedge' ] );

// Ledge states in which a placement carries the body: they move the way the placement does (a hop onto a wall walks
// once it is on top, a vault flies).
const PLACED = new Set( [ 'climbingUp', 'catchingLedge', 'vaulting', 'leapingToLedge' ] );

// Held to something: a ledge, a wall, a bar, a rope, a pole, a pipe, a ladder or a zipline.
const HELD = new Set( [ 'hanging', 'wallRunning', 'wallPlanted', 'wallKicking', 'onBar', 'onRope', 'onPipe', 'onLadder', 'toppingOut', 'onPole', 'onZipline' ] );

/**
 * How the runner is moving (the trace's mode column): 'ground' on a walkable floor, 'air' under gravity, 'guided' held
 * to something or carried by a placement, a move or the bail that has the body.
 */
function movementMode( runner ) {

	if ( runner.state === 'bailing' ) return 'guided';

	if ( PLACED.has( runner.state ) ) {

		const mode = runner.ledges?.placement?.mode;

		if ( mode ) return mode;

	}

	if ( HELD.has( runner.state ) ) return 'guided';

	return runner.grounded ? 'ground' : 'air';

}

export { PIPE_AND_ZIPLINE_STATES, LEDGE_STATES, POLE_AND_BAR_STATES, WALL_STATES, HANGING, ON_LEDGE, movementMode };
