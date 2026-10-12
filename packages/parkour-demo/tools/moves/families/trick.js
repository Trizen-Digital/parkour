// Tricks in the air and on the ground.

export const takes = {

	trick_spin_loop: {
		fill: { kind: 'acrobatics', reason: 'a flat spin in the air, chained after another' },
		length: 1.5,
		pace: 2.7,
		markers: [ [ 'trickStart', 0.021235948 ], [ 'capsuleRestore', 0.027350947 ], [ 'trickEnd', 1.1115583 ], [ 'airComboOpen', 1.1140276 ] ]
	},

	trick_spin: {
		fill: { kind: 'acrobatics', reason: 'a flat spin in the air' },
		length: 1.5,
		pace: 2.25,
		markers: [ [ 'trickStart', 0.014313061 ], [ 'capsuleRestore', 0.02042793 ], [ 'trickEnd', 0.8524753500000001 ], [ 'airComboOpen', 0.8612941 ] ]
	},

	trick_back_flip_run: {
		fill: { kind: 'acrobatics', reason: 'a back flip out of a run' },
		length: 1.7666667,
		pace: 1.35,
		markers: [ [ 'trickStart', 0.0001 ], [ 'capsuleRestore', 1.1110522 ], [ 'trickEnd', 1.1606658 ] ]
	},

	trick_back_flip_hold: {
		fill: { kind: 'acrobatics', reason: 'a back flip held tucked' },
		length: 2.0333333,
		pace: 2,
		markers: [ [ 'trickStart', 0.0001 ], [ 'capsuleShrink', 0.29074618 ], [ 'capsuleRestore', 1.6511338 ], [ 'trickEnd', 1.7016772 ] ]
	},

	trick_back_flip_layout: {
		fill: { kind: 'acrobatics', reason: 'a laid-out back flip' },
		length: 1.5,
		pace: 1.3,
		markers: [ [ 'trickStart', 0.008271805 ], [ 'capsuleRestore', 1.1509696 ], [ 'trickEnd', 1.3269747 ] ]
	},

	trick_back_flip_standing: {
		fill: { kind: 'acrobatics', reason: 'a back flip from standing' },
		length: 1.6666666,
		pace: 1.2,
		markers: [ [ 'trickStart', 0.24232494999999998 ], [ 'capsuleShrink', 0.26584262 ], [ 'capsuleRestore', 0.8630689 ], [ 'trickEnd', 0.93095005 ] ]
	},

	trick_back_cork: {
		fill: { kind: 'acrobatics', reason: 'a back flip with a corkscrew twist' },
		length: 1.6666666,
		pace: 1.25,
		markers: [ [ 'trickStart', 0.0001 ], [ 'trickEnd', 1.3137203 ] ]
	},

	trick_death_dive: {
		fill: { kind: 'acrobatics', reason: 'a head-first dive held flat until the landing' },
		length: 1.3,
		pace: 1.25,
		markers: [ [ 'trickStart', 0.0017088938 ], [ 'capsuleRestore', 0.94323504 ], [ 'trickEnd', 0.99873203 ] ]
	},

	trick_spin_dive_roll: {
		fill: { kind: 'acrobatics', reason: 'a spinning dive into a roll' },
		length: 0.8666667,
		pace: 0.8,
		markers: [ [ 'trickStart', 0.0001 ], [ 'capsuleShrink', 0.069856666 ], [ 'capsuleRestore', 0.5389634 ], [ 'trickEnd', 0.55659896 ] ]
	},

	trick_dive: {
		fill: { kind: 'acrobatics', reason: 'a dive into a roll (out of a bail or off a wall)' },
		length: 0.8,
		pace: 0.75,
		markers: [ [ 'trickStart', 0.0001 ], [ 'capsuleShrink', 0.0001 ], [ 'capsuleRestore', 0.47308612 ], [ 'trickEnd', 0.4861093 ] ]
	},

	trick_spin_front_flip: {
		fill: { kind: 'acrobatics', reason: 'a front flip with a spin' },
		length: 1.5555556,
		pace: 1.4,
		markers: [ [ 'trickStart', 0.024878655 ], [ 'capsuleShrink', 0.2732887 ], [ 'capsuleRestore', 1.181632 ], [ 'trickEnd', 1.2085681 ] ]
	},

	trick_dive_front_flip: {
		fill: { kind: 'acrobatics', reason: 'a diving front flip' },
		length: 1.2666667,
		pace: 1.28,
		markers: [ [ 'trickStart', 0.09195394 ], [ 'capsuleShrink', 0.17153952 ], [ 'capsuleRestore', 1.0466294 ], [ 'trickEnd', 1.0620055 ] ]
	},

	trick_front_flip_repeat: {
		fill: { kind: 'acrobatics', reason: 'a front flip in the air, chained after another' },
		length: 2.6333334,
		pace: 2.3,
		markers: [ [ 'trickStart', 0.018853992 ], [ 'capsuleShrink', 0.05795620399999999 ], [ 'airComboOpen', 0.9335304000000001 ], [ 'capsuleRestore', 1.513051 ], [ 'trickEnd', 1.539868 ] ]
	},

	trick_front_flip: {
		fill: { kind: 'acrobatics', reason: 'a front flip in the air' },
		length: 2.3,
		pace: 2.3,
		markers: [ [ 'trickStart', 0.0001 ], [ 'capsuleShrink', 0.42521906 ], [ 'airComboOpen', 0.98253465 ], [ 'capsuleRestore', 1.494197 ], [ 'trickEnd', 1.5210137 ] ]
	},

	// A cartwheel on the run, in line with it: from facing ahead, turned side-on over the hands and back to face ahead.
	// Paced to play as long as the cartwheel always has, carried on at its pace (6.15 m/s), its committed part the
	// same 0.586 s.
	trick_cartwheel: {
		from: { clip: 'final/cartwheel_run', span: [ 0.13, 1.73 ] },
		anchors: [ [ 0.13, 0, 'start' ], [ 1.73, 1.6, 'end' ] ],
		pace: 1.18737,
		markers: [ [ 'trickStart', 0.0001 ], [ 'trickEnd', 0.69580 ] ],
		root: {
			times: [ 0, 1.6 ],
			positions: [ 0, 0, 0, 0, 0, 8.28856 ]
		}
	},

	trick_side_flip_repeat: {
		fill: { kind: 'acrobatics', reason: 'a side flip in the air, chained after another' },
		length: 1.8333334,
		pace: 2.15,
		markers: [ [ 'trickStart', 0.027225679 ], [ 'capsuleShrink', 0.2522277 ], [ 'airComboOpen', 1.0377632 ], [ 'capsuleRestore', 1.2370337 ], [ 'trickEnd', 1.2694517000000003 ] ]
	},

	trick_side_flip: {
		fill: { kind: 'acrobatics', reason: 'a side flip in the air' },
		length: 1.6666666,
		pace: 2.15,
		markers: [ [ 'trickStart', 0.0001 ], [ 'capsuleShrink', 0.22500244 ], [ 'airComboOpen', 1.0018457 ], [ 'capsuleRestore', 1.1842563 ], [ 'trickEnd', 1.2406768 ] ],
		pinned: true
	},

	trick_vortex_repeat: {
		fill: { kind: 'acrobatics', reason: 'a vortex in the air, chained after another' },
		length: 1.1666666,
		pace: 1.55,
		markers: [ [ 'trickStart', 0.011344182 ], [ 'capsuleShrink', 0.024486814 ], [ 'airComboOpen', 0.7127322 ], [ 'capsuleRestore', 1.021506 ], [ 'trickEnd', 1.046931 ] ]
	},

	trick_vortex: {
		fill: { kind: 'acrobatics', reason: 'a vortex (an inverted twist) in the air' },
		length: 1.3333334,
		pace: 1.55,
		markers: [ [ 'trickStart', 0.0001 ], [ 'capsuleShrink', 0.23798463999999997 ], [ 'airComboOpen', 0.87134635 ], [ 'capsuleRestore', 1.0215064 ], [ 'trickEnd', 1.0469307 ] ]
	}

};

export const moves = {

	spinRepeat: { take: 'trick_spin_loop', length: 0.55555, blendIn: 0.25, blendOut: 0.25, holdAtEnd: true },
	spin: { take: 'trick_spin', length: 0.6666667, blendIn: 0.25, blendOut: 0.25 },
	standingBackflip: { take: 'trick_back_flip_standing', span: [ 0, 1.6666665999999999 ], length: 1.3888833999999999, blendIn: 0.15, blendOut: 0.35 },
	layoutBackflip: { take: 'trick_back_flip_layout', length: 1.15385, rate: 1.15, blendIn: 0.15, blendOut: 0.35 },
	runningBackflip: { take: 'trick_back_flip_run', length: 1.30865, blendIn: 0.25, blendOut: 0.25 },
	heldBackflip: { take: 'trick_back_flip_hold', length: 1.0166667, rate: 0.9, blendIn: 0.25, blendOut: 0.25 },
	backCork: { take: 'trick_back_cork', span: [ 0, 1.6666665999999999 ], length: 1.3333333999999997, rate: 1.15, blendIn: 0.25, blendOut: 0.25 },
	deathDive: { take: 'trick_death_dive', blendIn: 0.25, blendOut: 0.35 },
	spinDiveRoll: { take: 'trick_spin_dive_roll', span: [ 0, 0.8333332999999999 ], length: 1.0416665999999999, blendIn: 0.2, blendOut: 0.15 },
	diveOut: { take: 'trick_dive', span: [ 0, 0.8000000000000002 ], length: 1.0666667000000003, blendIn: 0.2, blendOut: 0.15 },
	spinFrontFlip: { take: 'trick_spin_front_flip', length: 1.1111166, blendIn: 0.25, blendOut: 0.25 },
	diveFrontFlip: { take: 'trick_dive_front_flip', length: 0.9895833, blendIn: 0.15, blendOut: 0.25 },
	frontFlipRepeat: { take: 'trick_front_flip_repeat', length: 1.1449333, blendIn: 0.25, blendOut: 0.25 },
	frontFlip: { take: 'trick_front_flip', blendIn: 0.25, blendOut: 0.35 },
	cartwheel: { take: 'trick_cartwheel', blendIn: 0.25, blendOut: 0.25 },
	sideFlipRepeat: { take: 'trick_side_flip_repeat', length: 0.8527167, blendIn: 0.25, blendOut: 0.35 },
	sideFlip: { take: 'trick_side_flip', span: [ 0, 1.6666665999999999 ], length: 0.7751999999999999, blendIn: 0.25, blendOut: 0.35 },
	vortexRepeat: { take: 'trick_vortex_repeat', length: 0.75268334, blendIn: 0.25, blendOut: 0.25 },
	vortex: { take: 'trick_vortex', length: 0.8602167, blendIn: 0.25, blendOut: 0.25 }

};
