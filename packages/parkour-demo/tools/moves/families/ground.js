// On the ground: standing (the idle variations), the walk and run the turn blends lean, starting a run and skidding
// to a stop, bumping into a wall, and walking a beam with the arms out.
//
// A leaning take is two cycles of its capture, and its `stride` is how far those carry the runner (twice the
// capture's stride): the turn blends play it at the rate that puts that stride under the runner at its speed. The
// sprint's leaning takes claim a tenth more stride than the capture's (4.3218 m), so the full-speed run plays a
// little slower: in step, it looked overplayed.

export const takes = {

	ground_idle_shift: {
		from: { clip: 'parkour/idle_scan', span: [ 0, 7.666666666666667 ] },
		anchors: [ [ 0, 0, 'start' ], [ 7.666666666666667, 9.583333333333334, 'end' ] ],
		pace: 1.25
	},

	ground_idle_look: {
		from: { clip: 'final/idle_fidget', span: [ 0, 4.625 ] },
		anchors: [ [ 0, 0, 'start' ], [ 4.625, 4.625, 'end' ] ]
	},

	ground_idle: {
		from: { clip: 'final/idle', span: [ 0, 4.041666666666667 ] },
		anchors: [ [ 0, 0, 'start' ], [ 4.041666666666667, 4.041666666666667, 'end' ] ]
	},

	ground_run_lean_left: {
		from: { clip: 'final/sprint', span: [ 0, 0.5972222222222222 ] },
		kept: 'leaned into the turn',
		anchors: [ [ 0, 0, 'start' ], [ 1.1944444444444444, 1.1944444444444444, 'end' ] ],
		loop: true,
		stride: 4.754,
		markers: [ [ 'leftFoot', 0.12791978916100566 ], [ 'rightFoot', 0.3963851563370618 ], [ 'leftFoot', 0.70267556105082 ], [ 'rightFoot', 1.009888352858989 ] ],
		sounds: [ [ 'step', 0.12791978916100566 ], [ 'step', 0.3963851563370618 ], [ 'step', 0.70267556105082 ], [ 'step', 1.009888352858989 ] ],
		pinned: true
	},

	ground_run_lean_right: {
		from: { clip: 'final/sprint', span: [ 0, 0.5972222222222222 ] },
		kept: 'leaned into the turn',
		anchors: [ [ 0, 0, 'start' ], [ 1.1944444444444444, 1.1944444444444444, 'end' ] ],
		loop: true,
		stride: 4.754,
		markers: [ [ 'leftFoot', 0.12607465046068 ], [ 'rightFoot', 0.406533255467584 ], [ 'leftFoot', 0.6823333725586218 ], [ 'rightFoot', 0.9905145046233885 ] ],
		sounds: [ [ 'step', 0.12607465046068 ], [ 'step', 0.406533255467584 ], [ 'step', 0.6823333725586218 ], [ 'step', 0.9905145046233885 ] ],
		pinned: true
	},

	ground_run_start: {
		from: { clip: 'parkour/start_run', span: [ 0.25, 0.95 ] },
		anchors: [ [ 0.25, 0, 'start' ], [ 0.95, 0.77, 'end' ] ],
		sounds: [ [ 'step', 0.5 ] ],
		pace: 1.1,
		pinned: true
	},

	ground_run_stop: {
		fill: { kind: 'keyed', reason: 'skidding to a stop from a run' },
		length: 1.6666666,
		pace: 1.1,
		root: {
			times: [ 0, 0.033333, 0.066667, 0.1, 0.133333, 0.16666700000000004, 0.2, 0.233333, 0.266667, 0.3, 0.333333, 0.366667, 0.4, 0.433333, 0.466667, 0.5, 0.533333, 0.566667, 0.6, 0.633333, 0.666667, 0.7, 0.733333, 0.766667, 0.8, 0.833333, 0.866667, 0.9, 0.933333, 0.9666670000000002, 1, 1.033333, 1.066667, 1.1, 1.133333, 1.166667, 1.2, 1.233333, 1.266667, 1.3, 1.333333, 1.366666, 1.4, 1.433333, 1.466667, 1.5, 1.533333, 1.566667, 1.6, 1.633333, 1.666666 ],
			positions: [ 0.000002, 0, 0, 0.000002, 0, 0.12507, 0.000002, 0, 0.23887, 0.000002, 0, 0.349927, 0.000002, 0, 0.458179, 0.000002, 0, 0.565369, 0.000002, 0, 0.673937, 0.000002, 0, 0.783242, 0.000002, 0, 0.894569, 0.000002, 0, 1.011911, 0.000002, 0, 1.127165, 0.000002, 0, 1.23873, 0.000002, 0, 1.352688, 0.000002, 0, 1.457472, 0.000002, 0, 1.552545, 0.000002, 0, 1.644153, 0.000002, 0, 1.736241, 0.000002, 0, 1.834062, 0.000002, 0, 1.927862, 0.000002, 0, 2.021581, 0.000002, 0, 2.110653, 0.000002, 0, 2.184816, 0.000002, 0, 2.25434, 0.000002, 0, 2.319208, 0.000002, 0, 2.383994, 0.000002, 0, 2.449288, 0.000002, 0, 2.511587, 0.000002, 0, 2.571414, 0.000002, 0, 2.626042, 0.000002, 0, 2.673095, 0.000002, 0, 2.713532, 0.000002, 0, 2.747033, 0.000002, 0, 2.77538, 0.000002, 0, 2.80064, 0.000002, 0, 2.82307, 0.000002, 0, 2.843191, 0.000002, 0, 2.862296, 0.000002, 0, 2.880852, 0.000002, 0, 2.898146, 0.000002, 0, 2.913931, 0.000002, 0, 2.927962, 0.000002, 0, 2.939994, 0.000002, 0, 2.94978, 0.000002, 0, 2.957074, 0.000002, 0, 2.961631, 0.000002, 0, 2.963205, 0.000002, 0, 2.963205, 0.000002, 0, 2.963205, 0.000002, 0, 2.963205, 0.000002, 0, 2.963205, 0.000002, 0, 2.963205 ]
		}
	},

	ground_walk_lean_left: {
		from: { clip: 'final/walk_quicker', span: [ 0, 1.1362871928781029 ] },
		kept: 'leaned into the turn; strides lengthened a quarter (tools/moves/stride.mjs)',
		anchors: [ [ 0, 0, 'start' ], [ 2.2725743857562057, 2.2725743857562057, 'end' ] ],
		sounds: [ [ 'step', 0.322 ], [ 'step', 0.868 ], [ 'step', 1.458 ], [ 'step', 2.008 ] ],
		loop: true,
		stride: 3.16625,
		pinned: true,
		pinAt: 'firstFrame'
	},

	ground_walk_lean_right: {
		from: { clip: 'final/walk_quicker', span: [ 0, 1.1362871928781029 ] },
		kept: 'leaned into the turn; strides lengthened a quarter (tools/moves/stride.mjs)',
		anchors: [ [ 0, 0, 'start' ], [ 2.2725743857562057, 2.2725743857562057, 'end' ] ],
		sounds: [ [ 'step', 0.288 ], [ 'step', 0.838 ], [ 'step', 1.423 ], [ 'step', 1.973 ] ],
		loop: true,
		stride: 3.16625,
		pinned: true,
		pinAt: 'firstFrame'
	},

	ground_wall_bump: {
		from: { clip: 'parkour/wall_bump', span: [ 0.7545000000000001, 1.5511000000000001 ] },
		kept: 'reposed after the cut',
		anchors: [ [ 0.7545000000000001, 0, 'start' ], [ 1.5511000000000001, 1.4737100000000003, 'end' ] ],
		pace: 1.85
	},

	ground_run_lean_left_slow: {
		from: { clip: 'final/run', span: [ 0, 0.6677738841456816 ] },
		kept: 'leaned into the turn',
		anchors: [ [ 0, 0, 'start' ], [ 1.3355477682913632, 1.3355477682913632, 'end' ] ],
		loop: true,
		stride: 4.071,
		markers: [ [ 'leftFoot', 0.14303133957288797 ], [ 'rightFoot', 0.44321133008075103 ], [ 'leftFoot', 0.7856847438649989 ], [ 'rightFoot', 1.1291895091124067 ] ],
		sounds: [ [ 'step', 0.14303133957288797 ], [ 'step', 0.44321133008075103 ], [ 'step', 0.7856847438649989 ], [ 'step', 1.1291895091124067 ] ],
		pinned: true
	},

	ground_run_lean_right_slow: {
		from: { clip: 'final/run', span: [ 0, 0.6677738841456816 ] },
		kept: 'leaned into the turn',
		anchors: [ [ 0, 0, 'start' ], [ 1.3355477682913632, 1.3355477682913632, 'end' ] ],
		loop: true,
		stride: 4.071,
		markers: [ [ 'leftFoot', 0.14096822907422082 ], [ 'rightFoot', 0.4545582547612642 ], [ 'leftFoot', 0.7629394713081377 ], [ 'rightFoot', 1.1075269697665047 ] ],
		sounds: [ [ 'step', 0.14096822907422082 ], [ 'step', 0.4545582547612642 ], [ 'step', 0.7629394713081377 ], [ 'step', 1.1075269697665047 ] ],
		pinned: true
	},

	ground_walk_lean_left_slow: {
		from: { clip: 'final/walk', span: [ 0, 1.5394507465223157 ] },
		kept: 'leaned into the turn; strides lengthened a quarter (tools/moves/stride.mjs)',
		anchors: [ [ 0, 0, 'start' ], [ 3.0789014930446315, 3.0789014930446315, 'end' ] ],
		sounds: [ [ 'step', 0.445 ], [ 'step', 1.19 ], [ 'step', 1.985 ], [ 'step', 2.73 ] ],
		loop: true,
		stride: 2.53025,
		pinned: true,
		pinAt: 'firstFrame'
	},

	ground_walk_lean_right_slow: {
		from: { clip: 'final/walk', span: [ 0, 1.5394507465223157 ] },
		kept: 'leaned into the turn; strides lengthened a quarter (tools/moves/stride.mjs)',
		anchors: [ [ 0, 0, 'start' ], [ 3.0789014930446315, 3.0789014930446315, 'end' ] ],
		sounds: [ [ 'step', 0.4 ], [ 'step', 1.143 ], [ 'step', 1.94 ], [ 'step', 2.68 ] ],
		loop: true,
		stride: 2.53025,
		pinned: true,
		pinAt: 'firstFrame'
	},

	// Along a beam, arms out for balance: one cycle each, the walk carrying the runner 1.028 m (its planted feet go back
	// at 1.02 m/s), the quicker steps 1.15 m (about 1.65 m/s).
	ground_balance_walk: {
		from: { clip: 'parkour/balance_walk', span: [ 0, 1.0083333333333333 ] },
		anchors: [ [ 0, 0, 'start' ], [ 1.0083333333333333, 1.0083333333333333, 'end' ] ],
		sounds: [ [ 'step', 0.53 ], [ 'step', 0.983 ] ],
		loop: true,
		stride: 1.028,
		pinned: true,
		pinAt: 'firstFrame'
	},

	ground_balance_run: {
		from: { clip: 'parkour/balance_run', span: [ 0, 0.6958333333333333 ] },
		anchors: [ [ 0, 0, 'start' ], [ 0.6958333333333333, 0.6958333333333333, 'end' ] ],
		sounds: [ [ 'step', 0.285 ], [ 'step', 0.665 ] ],
		loop: true,
		stride: 1.15,
		pinned: true,
		pinAt: 'firstFrame'
	}

};

export const moves = {

	skidStop: { take: 'ground_run_stop', span: [ 0, 1.6666665999999999 ], length: 1.5151499999999998, blendIn: 0.25, blendOut: 0.35 }

};
