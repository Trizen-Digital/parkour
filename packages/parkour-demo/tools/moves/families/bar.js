// Swinging on a bar.

export const takes = {

	bar_swing: {
		from: { clip: 'parkour/bar_swing', span: [ 2.4177999999999997, 3.9833333333333334 ] },
		kept: 'hips moved under the bar',
		anchors: [ [ 2.4177999999999997, 0, 'start' ], [ 3.9833333333333334, 1.2816666, 'end' ] ],
		pace: 1.15
	}

};

export const moves = {

	barSwing: { take: 'bar_swing', length: 1.1145, blendIn: 0.25, blendOut: 0.25 }

};
