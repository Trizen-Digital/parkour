// Sliding: dropping in, and the seated, tucked and upright slides the steering blends between.

export const takes = {

	slide_tuck_right: {
		fill: { kind: 'posed', reason: 'sliding tucked low, steering right' },
		length: 1.3333334
	},

	slide_tuck: {
		fill: { kind: 'posed', reason: 'sliding tucked low, steering left' },
		length: 1.3333334
	},

	slide_stand_left: {
		fill: { kind: 'posed', reason: 'sliding upright, steering left' },
		length: 1.3333334
	},

	slide_stand_right: {
		fill: { kind: 'posed', reason: 'sliding upright, steering right' },
		length: 1.3333334
	},

	slide_seat_left: {
		fill: { kind: 'posed', reason: 'sliding seated, steering left' },
		length: 1.3333334
	},

	slide_seat_right: {
		fill: { kind: 'posed', reason: 'sliding seated, steering right' },
		length: 1.3333334
	},

	slide_seat: {
		fill: { kind: 'posed', reason: 'sliding seated, going straight' },
		length: 1.3333334
	},

	slide_drop_in: {
		from: { clip: 'parkour/slide', span: [ 0.9, 1.6 ] },
		anchors: [ [ 0.9, 0, 'start' ], [ 1.6, 0.7000000000000001, 'end' ] ],
		pace: 1.15,
		root: {
			times: [ 0 ],
			positions: [ 0, 0, 0 ]
		}
	}

};

export const moves = {

};
