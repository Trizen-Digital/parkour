// The camera's numbers: how the third-person camera trails the runner, where the first-person camera sits on the
// head, how long the framing eases take, and the shakes the runner's moves start. Metres, seconds, radians. A rate
// is per second: a damped value closes the fraction 1 − e^(−rate·dt) of its gap in dt, whatever the frame rate.
// The player's own settings (distances, field of view, the slow follow) are in the tuning.

import { DEG } from '../math.js';

const CAMERA = {

	thirdPerson: {

		// The follow point trails the drawn runner: quickly across the ground (it closes 43 % of its gap each 60 Hz
		// frame), more slowly up and down so a jump, a step or a landing does not jolt the view (17 %).
		followRate: 33.3,
		verticalFollowRate: 10.9,

		// The arm's root trails the follow point in turn (half its gap a frame). Two lags in a row start and stop the
		// camera along an S rather than a kink; the root never falls further behind than maxLag.
		armRate: 40,
		maxLag: 1.5,

		// At rest the camera hangs this much further back and the view is this much narrower than the setting; the
		// speed zoom takes both away as the runner gets going.
		restArm: 0.25,
		restFov: 10 * DEG,

		// The aim zoom (a precision jump) brings the camera to this height and this far forward, over the shoulder.
		aimHeight: 0.41,
		aimForward: 1.5,

		// On a wall run on the shoulder's side the camera swings over to the other shoulder, off the wall (the
		// shoulder's offset turning over at shoulderRate), and stays there while the wall is still beside the runner:
		// within the shoulder's offset and wallMargin more of a ray across from wallUp above its centre (m).
		shoulderRate: 5,
		wallMargin: 0.4,
		wallUp: 0.5,

		// The camera looks down on the runner by this, and by fallingPitch once the fall tilt is in.
		pitch: 8.5 * DEG,
		fallingPitch: 25.5 * DEG

	},

	firstPerson: {

		// From the head bone to the eyes, in the head's frame.
		eyes: [ 0.075, 0, 0 ],

		// The camera sits this far ahead of the eyes, so the near plane clears the face. It is kept out of walls (the
		// camera collision group) by a sphere of probeRadius swept there from the top of the capsule, which is never in
		// one: wide enough that the corners of the near plane (0.025 m out, at the widest field of view) clear them too.
		forward: 0.15,
		probeRadius: 0.12,

		// On a pipe or a ladder the camera stands this far back from the eyes, off the pipe, looking at it (m).
		climbBack: 0.15,

		// On a wall run the view leans this far away from the wall (rad), easing in and out at leanRate.
		wallRunLean: 6 * DEG,
		leanRate: 6,

		// The view follows the aim, or the head when it rides it, at this rate (it closes 18 % of the angle each 60 Hz
		// frame).
		turnRate: 12.3

	},

	// How long each framing ease takes from nothing to full (a smoothstep), and back.
	eases: {
		speedZoom: 1.5,
		aimZoom: 1,
		fallTilt: 1.8
	},

	// Shakes: the camera moves along its own right, up and forward axes (m) and turns about them (pitch up, yaw left
	// and roll left are positive; rad). A part either sways along a sine at `frequency` Hz, starting at a random
	// point of its swing on each axis (except those in `fixedPhase`, which start from the middle, going the positive
	// way), or makes one smooth bump that is at its height at `peak` s and settles by the end (with `hold` it stays
	// there until the shake fades; with `windUp` it first draws back by that much of its height). The whole shake
	// fades in over `fadeIn` and out over the last `fadeOut` of its `duration`.
	shakes: {

		// Every landing and every jump off the ground: a quick shudder that always pushes forward first.
		landing: {
			duration: 0.35, fadeIn: 0.1, fadeOut: 0.2,
			move: { right: 0.035, up: 0.035, forward: 0.035, frequency: 4.06, fixedPhase: [ 'forward' ] }
		},

		// Bursting a door open with the shoulder: a jolt back as it gives, and a short shudder.
		barge: {
			duration: 0.4, fadeIn: 0.05, fadeOut: 0.25,
			move: { right: 0.04, up: 0.03, forward: - 0.06, frequency: 5.5, fixedPhase: [ 'forward' ] },
			turn: { roll: 1.5 * DEG, frequency: 4 }
		},

		// A jump off a wall or into a cartwheel: the camera dips as the runner pushes off and stays low through the
		// flight, nodding up as it goes.
		jump: {
			duration: 4 / 3, fadeIn: 0.2, fadeOut: 0.4,
			move: { up: - 0.15, peak: 1 / 3, hold: true },
			turn: { pitch: 1.5 * DEG, peak: 1 }
		},

		// A charged jump at speed (and, at about half, a precision jump): the view tips down over the take-off.
		styleJump: {
			duration: 2, fadeIn: 0.2, fadeOut: 0.4,
			turn: { pitch: - 8 * DEG, peak: 0.73 }
		},

		// A hard landing out of a trick: the camera carries on forward and sinks.
		hardLanding: {
			duration: 1, fadeIn: 0.2, fadeOut: 0.4,
			move: { right: - 0.05, up: - 0.11, forward: 0.21, peak: 1 / 3 }
		},

		// A roll on landing: the same, twice as far.
		roll: {
			duration: 1, fadeIn: 0.2, fadeOut: 0.4,
			move: { right: - 0.11, up: - 0.25, forward: 0.41, peak: 1 / 3 }
		},

		// A large trick off a wall or the ground: the camera rises with the runner and looks down on it.
		trick: {
			duration: 5 / 3, fadeIn: 0.2, fadeOut: 0.4,
			move: { up: 0.85, peak: 0.5 },
			turn: { pitch: - 18.5 * DEG, peak: 0.5 }
		},

		cartwheel: {
			duration: 2, fadeIn: 0.2, fadeOut: 0.4,
			move: { up: 0.65, forward: - 0.055, peak: 0.5 },
			turn: { pitch: - 15.5 * DEG, peak: 0.5 }
		},

		// A power jump off a ledge: the camera follows the launch up and forward.
		powerJump: {
			duration: 1.7, fadeIn: 0.2, fadeOut: 0.4,
			move: { up: 0.35, forward: 0.25, peak: 2 / 3 },
			turn: { pitch: - 5.5 * DEG, peak: 2 / 3 }
		},

		// A swing round a bar: the camera draws back, then swings forward with it, along the swing's own facing (not
		// the view's).
		barSwing: {
			duration: 1, fadeIn: 0.2, fadeOut: 0.4,
			move: { forward: 0.85, peak: 2 / 3, windUp: 0.3 },
			turn: { pitch: 3 * DEG, peak: 2 / 3 }
		},

		// Starting a wall run: the camera surges forward and leans in toward the wall (the follow camera swings it
		// over to the shoulder away from the wall).
		wallRunLeft: {
			duration: 5 / 3, fadeIn: 0.2, fadeOut: 0.4,
			move: { forward: 0.11, peak: 1 / 3 },
			turn: { yaw: 1.5 * DEG, roll: 2.25 * DEG, peak: 0.4 }
		},

		wallRunRight: {
			duration: 5 / 3, fadeIn: 0.2, fadeOut: 0.4,
			move: { forward: 0.11, peak: 0.45 },
			turn: { yaw: - 1.5 * DEG, roll: - 2.25 * DEG, peak: 0.4 }
		},

		// The run bob, started every 0.2 s while running flat out with the pad's sprint held: each is a small drift
		// of the camera (too slow a sway to swing back within its half second), so together they wander.
		runBob: {
			duration: 0.5, fadeIn: 0.35, fadeOut: 0.5,
			move: { right: 0.005, up: 0.02, frequency: 0.2 }
		},

		runBobFirstPerson: {
			duration: 0.5, fadeIn: 0.35, fadeOut: 0.5,
			move: { right: 0.005, up: 0.01, frequency: 0.02 },
			turn: { pitch: 0.25 * DEG, roll: 0.5 * DEG, frequency: 0.02 }
		}

	}

};

export { CAMERA };
