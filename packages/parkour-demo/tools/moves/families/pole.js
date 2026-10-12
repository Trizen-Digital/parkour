// Poles: grabbing one, sliding down, and coiling to kick off.

export const takes = {

	pole_kick_ready_left: {
		fill: { kind: 'posed', reason: 'coiled on a pole, ready to kick off' },
		length: 1.3333334,
		pace: 1.35
	},

	pole_grab: {
		from: { clip: 'parkour/pipe_slide', span: [ 0, 0.85 ] },
		kept: 'hips moved onto the pole',
		anchors: [ [ 0, 0, 'start' ], [ 0.85, 2.3666666999999997, 'end' ] ],
		pace: 3
	},

	pole_slide: {
		fill: { kind: 'posed', reason: 'sliding down a pole' },
		length: 2,
		pace: 3.55
	}

};

// The grab is the pole machine's first state (the pose graph's), not a move. The kick off a pole is the push of the
// kick off a wall (from its coil, which the pole's kick-ready pose holds already): the feet drive off the pole as the
// body leaves it.
export const moves = {

	poleKick: { take: 'wall_kick_left', span: [ 0.16, 0.66666670000000002 ], blendIn: 0.1, blendOut: 0.3 }

};
