// Single poses the graph adds over others: the crouch of a charging jump, the lean, and the poses they are
// measured from.

export const takes = {

	pose_jump_crouch: {
		fill: { kind: 'keyed', reason: 'the crouch added while a running jump charges' },
		length: 0.033333335,
		additive: 'pose_lean_base',
		pinAt: 'firstFrame'
	},

	pose_lean_base: {
		fill: { kind: 'keyed', reason: 'the upright pose the forward and back leans are measured from' },
		length: 0.033333335
	},

	pose_lean_forward: {
		fill: { kind: 'keyed', reason: 'the body leaning forward, accelerating' },
		length: 0.033333335,
		additive: 'pose_lean_base'
	},

	pose_lean_back: {
		fill: { kind: 'keyed', reason: 'the body leaning back, braking' },
		length: 0.033333335,
		additive: 'pose_lean_base'
	},

	pose_landing_base: {
		fill: { kind: 'hold', reason: 'the standing pose the landing dip is measured from' },
		length: 0.033333335
	}

};

export const moves = {

};
