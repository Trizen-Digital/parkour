// Doors and the switches on walls: the shoulder barge through a door at a run, the kick that opens one from a walk,
// turning a valve wheel and pressing a button.

export const takes = {

	// The run's last strides into the shoulder, which meets the door at the end.
	door_barge: {
		from: { clip: 'parkour/door_barge', span: [ 0.75, 1.2666666666666666 ] },
		anchors: [ [ 0.75, 0, 'start' ], [ 1.2666666666666666, 0.5166666666666666, 'end' ] ]
	},

	// The front kick and the foot back down; the sole meets the door at `foot`.
	door_kick: {
		from: { clip: 'parkour/door_kick', span: [ 1.1, 2.2 ] },
		anchors: [ [ 1.1, 0, 'start' ], [ 1.55, 0.45, 'foot' ], [ 2.2, 1.1, 'end' ] ],
		pace: 1.4
	},

	// Hand over hand round the wheel.
	valve_turn: {
		from: { clip: 'parkour/valve_turn', span: [ 0, 4.183333333333334 ] },
		anchors: [ [ 0, 0, 'start' ], [ 4.183333333333334, 4.183333333333334, 'end' ] ],
		pace: 1.4
	},

	// The right hand out to a button at the right shoulder, a little ahead; it is pushed in at `press`.
	button_press: {
		from: { clip: 'parkour/button_press', span: [ 1.2, 2.4 ] },
		anchors: [ [ 1.2, 0, 'start' ], [ 1.7, 0.5, 'press' ], [ 2.4, 1.2, 'end' ] ],
		pace: 1.2
	},

	// The same with the left hand, to a button at the left shoulder (the capture mirrored).
	button_press_left: {
		from: { clip: 'parkour/button_press_m', span: [ 1.2, 2.4 ] },
		anchors: [ [ 1.2, 0, 'start' ], [ 1.7, 0.5, 'press' ], [ 2.4, 1.2, 'end' ] ],
		pace: 1.2
	}

};

export const moves = {

	// It waits shoulder-in until the runner is through (DoorsAndSwitches stops it).
	// The shoulder alone: the legs run on through the door beneath it.
	doorBarge: { take: 'door_barge', blendIn: 0.15, blendOut: 0.3, holdAtEnd: true, mask: 'upper' },
	doorKick: { take: 'door_kick', blendIn: 0.15, blendOut: 0.25 },
	valveTurn: { take: 'valve_turn', blendIn: 0.3, blendOut: 0.35 },
	buttonPress: { take: 'button_press', blendIn: 0.25, blendOut: 0.3 },
	buttonPressLeft: { take: 'button_press_left', blendIn: 0.25, blendOut: 0.3 }

};
