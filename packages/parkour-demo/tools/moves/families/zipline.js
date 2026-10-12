// Ziplines: grabbing the line, and riding it.

export const takes = {

	zip_hang: {
		fill: { kind: 'posed', reason: 'riding a zipline with both hands' },
		length: 2.1666667
	},

	zip_grab: {
		from: { clip: 'parkour/zip_grab', span: [ 2.15, 4.817 ] },
		kept: 'hips moved under the line',
		anchors: [ [ 2.15, 0, 'start' ], [ 4.817, 2.6670000000000003, 'end' ] ]
	}

};

export const moves = {

};
