// Leaving the ground and the air: the takeoffs, the hold in the air, the hop off an edge, and the limp flail and
// tumble of a bail.

export const takes = {

	air_takeoff_run: {
		kept: 'cut from captures not on record',
		anchors: [ [ 0.8511, 0, 'start' ], [ 1.7378, 1.0666667, 'end' ] ],
		pace: 1.05
	},

	air_takeoff_standing: {
		kept: 'cut from captures not on record',
		anchors: [ [ 0.6, 0, 'start' ], [ 1.1133, 1.0666667, 'end' ] ],
		pace: 0.65
	},

	air_takeoff_left: {
		kept: 'cut from captures not on record',
		anchors: [ [ 1.1678, 0, 'start' ], [ 1.9211, 1.3, 'end' ] ],
		pace: 0.85,
		pinned: true
	},

	air_takeoff_right: {
		kept: 'cut from captures not on record',
		anchors: [ [ 1.1678, 0, 'start' ], [ 1.9211, 1.2666667, 'end' ] ],
		pace: 0.85
	},

	air_hold: {
		kept: 'cut from captures not on record',
		anchors: [ [ 1.3478, 0, 'start' ], [ 1.9211, 2.5333333, 'end' ] ],
		pace: 1.65
	},

	air_walk_off: {
		kept: 'cut from captures not on record',
		anchors: [ [ 0.9511000000000001, 0, 'start' ], [ 1.4711, 1.3333334, 'end' ] ],
		pace: 1.25
	},

	air_flail: {
		fill: { kind: 'keyed', reason: 'limp and flailing in a fast fall (a bail)' },
		length: 4.633333
	},

	air_tumble: {
		fill: { kind: 'keyed', reason: 'limp and tumbling at low speed (a bail)' },
		length: 4.0666666
	}

};

export const moves = {

	walkOffHop: { take: 'air_walk_off', length: 1.0666667, blendIn: 0.25, blendOut: 0.25 }

};
