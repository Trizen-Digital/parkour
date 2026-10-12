// Ladders: getting on, holding on, climbing up, and sliding down holding the rails. Off the top the runner climbs out
// as off a pipe (pipeTopOut).
//
// The game holds the runner a quarter of a metre out from the rungs (PipesAndZiplines). Each capture's actor stood
// elsewhere against its ladder, so each is shifted to put the hands and feet on the rungs there.

export const takes = {

	// Reaching for the rails, the hop on, the first foot onto a rung.
	ladder_grab: {
		from: { clip: 'parkour/ladder_mount', span: [ 1.6, 2.4 ] },
		anchors: [ [ 1.6, 0, 'start' ], [ 2.4, 0.8, 'end' ] ],
		pace: 1.25,
		shift: [ 0, 0, - 0.2 ]
	},

	// Still on the rungs: the climb's first frame, held.
	ladder_hold: {
		from: { clip: 'parkour/ladder_climb', span: [ 0, 0.016666666666666666 ] },
		anchors: [ [ 0, 0, 'start' ], [ 0.016666666666666666, 1, 'end' ] ],
		shift: [ 0, 0, 0.28 ]
	},

	// Hand over hand, two rungs a cycle.
	ladder_climb_up: {
		from: { clip: 'parkour/ladder_climb', span: [ 0, 1.5583333333333333 ] },
		anchors: [ [ 0, 0, 'start' ], [ 1.5583333333333333, 1.5583333333333333, 'end' ] ],
		sounds: [ [ 'rung', 0.144 ], [ 'rung', 0.888 ] ],
		pace: 2.4,
		shift: [ 0, 0, 0.28 ]
	},

	// Upright, arms up on the rails, feet off the rungs: held while sliding.
	ladder_slide_down: {
		from: { clip: 'parkour/ladder_slide', span: [ 1.7, 1.7166666666666666 ] },
		anchors: [ [ 1.7, 0, 'start' ], [ 1.7166666666666666, 1, 'end' ] ],
		shift: [ 0, 0, 0.12 ]
	}

};
