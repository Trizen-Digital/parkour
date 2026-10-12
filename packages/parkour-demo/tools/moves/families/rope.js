// Ropes: catching a hanging rope and swinging on it. The figure hangs along the rope (PoseInputs' tilt), and the
// swing mixes a pose with the legs thrown forward and one with them trailing by which way the body swings.

export const takes = {

	// The hands closing on the rope above the head, the legs swinging through.
	rope_catch: {
		from: { clip: 'parkour/rope_swing', span: [ 0.7, 1.25 ] },
		anchors: [ [ 0.7, 0, 'start' ], [ 1.25, 0.55, 'end' ] ],
		pace: 1.1
	},

	// Swinging forward: the legs thrown out ahead. One frame, held.
	rope_swing_forward: {
		from: { clip: 'parkour/rope_swing', span: [ 1.45, 1.4666666666666666 ] },
		anchors: [ [ 1.45, 0, 'start' ], [ 1.4666666666666666, 1, 'end' ] ]
	},

	// Swinging back: the legs trailing. One frame, held.
	rope_swing_back: {
		from: { clip: 'parkour/rope_swing', span: [ 1.05, 1.0666666666666667 ] },
		anchors: [ [ 1.05, 0, 'start' ], [ 1.0666666666666667, 1, 'end' ] ]
	}

};
