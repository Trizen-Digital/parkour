// Precision: crouching to aim, the jump to a perch, landing on it, stepping up and slipping off it, and the strides.

// A stride runs on past its landing, over the foot it came down on and then the other, so the runner goes on along the
// top it landed on and the next stride can pick up the step it has got to (Precision.js). Its root carries the body on
// from 0.55 s into the take (where a stride has got to as the body reaches its target, the foot coming down just after)
// at the speed the capture's body goes on over the foot on the ground, frame by frame (3-4 m/s), so that foot stays put.
const STRIDE_RUN_ON = {
	times: [ 0, 0.55, 0.568333, 0.586667, 0.605, 0.623333, 0.641667, 0.66, 0.678333, 0.696667, 0.715, 0.733333, 0.751667, 0.77, 0.788333, 0.806667, 0.825, 0.843333, 0.861667, 0.88, 0.898333, 0.916667, 0.935, 0.953333, 0.971667, 0.99, 1.008333, 1.026667, 1.045, 1.063333, 1.081667, 1.1, 1.118333, 1.136667, 1.155 ],
	positions: [ 0, 0, 0, 0, 0, 0, 0, 0, 0.054963, 0, 0, 0.109926, 0, 0, 0.165457, 0, 0, 0.222169, 0, 0, 0.281223, 0, 0, 0.34296, 0, 0, 0.406712, 0, 0, 0.471215, 0, 0, 0.536556, 0, 0, 0.60203, 0, 0, 0.667827, 0, 0, 0.733363, 0, 0, 0.797531, 0, 0, 0.858919, 0, 0, 0.914924, 0, 0, 0.966602, 0, 0, 1.015868, 0, 0, 1.065146, 0, 0, 1.115126, 0, 0, 1.165099, 0, 0, 1.214715, 0, 0, 1.263971, 0, 0, 1.31287, 0, 0, 1.364819, 0, 0, 1.419876, 0, 0, 1.477407, 0, 0, 1.533867, 0, 0, 1.589111, 0, 0, 1.643231, 0, 0, 1.697531, 0, 0, 1.751385, 0, 0, 1.804764, 0, 0, 1.856619 ]
};

export const takes = {

	perch_step_up: {
		from: { clip: 'parkour/step_up', span: [ 0.81, 1.61 ] },
		anchors: [ [ 0.81, 0, 'start' ], [ 0.9639, 0.22315499999999988, 'touchdown' ], [ 1.61, 0.9450000000000001, 'end' ] ]
	},

	// The leap off one foot onto the other, and on (STRIDE_RUN_ON) until the other foot has come down (its step at
	// 0.9163 s) and pushes off.
	stride_left: {
		from: { clip: 'parkour/jump_short_m', span: [ 0.7, 1.75 ] },
		anchors: [ [ 0.7, 0, 'start' ], [ 1.2178, 0.5695800000000001, 'touchdown' ], [ 1.75, 1.155, 'end' ] ],
		sounds: [ [ 'step', 0.5695800000000001 ], [ 'step', 0.9163 ] ],
		root: STRIDE_RUN_ON
	},

	// The same, mirrored.
	stride_right: {
		from: { clip: 'parkour/jump_short', span: [ 0.7, 1.75 ] },
		anchors: [ [ 0.7, 0, 'start' ], [ 1.2178, 0.5695800000000001, 'touchdown' ], [ 1.75, 1.155, 'end' ] ],
		sounds: [ [ 'step', 0.5695800000000001 ], [ 'step', 0.9163 ] ],
		root: STRIDE_RUN_ON
	},

	perch_land: {
		fill: { kind: 'acrobatics', reason: 'landing balanced on a narrow perch' },
		length: 1.0666667,
		root: {
			times: [ 0 ],
			positions: [ 0, 0, 0 ]
		}
	},

	// Its crouch held a moment so the push meets the launch, tucking late and shallow, the body tipped forward a little,
	// elbows bent, the arms' swing back cut (tools/moves/reshape.mjs, then tuck.mjs).
	precision_jump: {
		fill: { kind: 'acrobatics', reason: 'the jump to a perch, feet together' },
		length: 1.157496,
		pace: 0.85
	},

	precision_crouch: {
		fill: { kind: 'acrobatics', reason: 'crouching to aim a precision jump' },
		length: 2.2333333,
		pace: 1.55
	}

};

export const moves = {

	perchStepUp: { take: 'perch_step_up', span: [ 0, 0.8371166951171038 ], rate: 1.45, blendIn: 0.25, blendOut: 0.25 },
	strideLeft: { take: 'stride_left', rate: 1.1, blendIn: 0.1, blendOut: 0.1 },
	strideRight: { take: 'stride_right', rate: 1.1, blendIn: 0.1, blendOut: 0.1 },
	perchLand: { take: 'perch_land', length: 1.06667, blendIn: 0.15, blendOut: 0.25 },
	precisionJump: { take: 'precision_jump', length: 1.36176, blendIn: 0.1, blendOut: 0.25 },
	precisionCrouch: { take: 'precision_crouch', length: 1.4408667, blendIn: 0.35, blendOut: 0.25 },
	// A perch with no floor under a foot: the stumble off it (the take of a bump into a wall).
	perchSlip: { take: 'ground_wall_bump', blendIn: 0.1, blendOut: 0.25 }

};
