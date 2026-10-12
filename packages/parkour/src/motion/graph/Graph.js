import { Vector3 } from 'three';
import { random as seeded } from '../../sim/random.js';
import { Additive } from './Additive.js';
import { BLENDS } from './blends.js';
import { ClipPlayer } from './ClipPlayer.js';
import { DirectionalBlend } from './DirectionalBlend.js';
import { FootIK } from './FootIK.js';
import { Layer } from './Layer.js';
import { LegIK } from './LegIK.js';
import { REST } from './recipes.js';
import { Switch } from './Switch.js';
import { hang } from './machines/hang.js';
import { ladder } from './machines/ladder.js';
import { locomotion } from './machines/locomotion.js';
import { pipe } from './machines/pipe.js';
import { pole } from './machines/pole.js';
import { rope } from './machines/rope.js';
import { slide } from './machines/slide.js';
import { zipline } from './machines/zipline.js';

// Going limp faster than this (m/s) the body flails; slower, it tumbles.
const LIMP_FLAILING = 2;

// Where the knees point while the feet stand against the wall, in the skeleton's space (m): far ahead and above, a
// little out to each side, so the knees bend toward the wall and apart.
const LEFT_KNEE = new Vector3( 0.5, 2.5, 2.5 );
const RIGHT_KNEE = new Vector3( - 0.5, 2.5, 2.5 );

// How much of the landing dip the body takes.
const LANDING_DIP = 0.5;

/**
 * The pose graph: a tree of nodes the motion updates once a step, giving the step's recipe. Nodes keep their own
 * times; `update` hands each the step through the graph: `dt`, `inputs` (what the runner is doing), `frame` (the
 * update's number, by which a node knows whether it was updated in the update before), the take `library`, the
 * `moves` the layers show and the `random` stream the idles are shuffled by.
 */
class Graph {

	/**
	 * @param {TakeLibrary} library
	 * @param {Moves} moves
	 * @param {() => number} [random]
	 */
	constructor( library, moves, random = seeded.stream( 'idleChoice' ) ) {

		this.library = library;
		this.moves = moves;
		this.random = random;
		this.frame = 0;
		this.dt = 0;
		this.inputs = null;

		/** The eight state machines by name (each one's `current` state says what it shows). */
		this.machines = {
			locomotion: locomotion( library ), hang: hang( library ), pipe: pipe(), ladder: ladder(), pole: pole(),
			rope: rope( library ), zipline: zipline(), slide: slide( library )
		};
		this.root = build( this.machines, library );

	}

	/**
	 * @param {number} dt
	 * @param {object} inputs
	 * @returns {object} the step's recipe
	 */
	update( dt, inputs ) {

		this.frame ++;
		this.dt = dt;
		this.inputs = inputs;

		return this.root.update( this );

	}

}

// The whole graph. From the top: the feet put on the ground over all; the limp body or the runner's own; then sliding,
// hanging, on a pipe, a ladder, a pole, a rope or a zipline, else on foot. The switches' blend times are timing as
// well as looks: a branch switched away from stops being updated, and its machine starts again when it comes back.
function build( { locomotion, hang, pipe, ladder, pole, rope, zipline, slide }, library ) {

	// Hanging: climbing up and leaping from the ledge are moves over the hang, the feet against the wall under it all.
	// The feet go four fifths of the way to the wall at most, so the hang's own pose keeps a say.
	const ledgeIK = ( v ) => v.ledgeIK / 1.25;
	const hanging = new LegIK(
		new LegIK( new Layer( 'ledgeLeap', new Layer( 'climb', hang ) ), { foot: 'leftFoot', target: ( v ) => v.leftFootTarget, knee: LEFT_KNEE, weight: ledgeIK } ),
		{ foot: 'rightFoot', target: ( v ) => v.rightFootTarget, knee: RIGHT_KNEE, weight: ledgeIK }
	);

	// On foot: moves over the locomotion; the crouch of a charging jump, the lean (seen from behind only) and the
	// landing dip added on top.
	const onFoot = new Additive(
		new Additive(
			new Additive(
				new Layer( 'body', locomotion ),
				new ClipPlayer( 'pose_jump_crouch' ),
				{ toggle: ( v ) => v.jumpCharging, fadeIn: 0.25, fadeOut: 0.15 }
			),
			new DirectionalBlend( BLENDS.lean, ( v ) => [ v.lean ], library ),
			{ weight: ( v ) => ( v.thirdPerson ? 1 : 0 ) }
		),
		new Layer( 'landing', REST, { alwaysUpdateSource: true } ),
		{ weight: LANDING_DIP }
	);

	const own = new Switch( ( v ) => v.sliding, { on: 0.25, off: 0.35 }, slide,
		new Switch( ( v ) => v.hanging, { on: 0.15, off: 0.25 }, hanging,
			new Switch( ( v ) => v.onPipe, { on: 0.2, off: 0.25 }, new Layer( 'body', pipe ),
				new Switch( ( v ) => v.onLadder, { on: 0.2, off: 0.25 }, new Layer( 'body', ladder ),
					new Switch( ( v ) => v.onPole, { on: 0.15, off: 0.4 }, pole,
						new Switch( ( v ) => v.onRope, { on: 0.15, off: 0.3 }, rope,
							new Switch( ( v ) => v.onZipline, { on: 0.1, off: 0.25 }, zipline, onFoot ) ) ) ) ) ) );

	const limp = new Switch( ( v ) => v.speed > LIMP_FLAILING, { on: 0.35, off: 0.25 },
		new ClipPlayer( 'air_flail', { loop: true } ),
		new ClipPlayer( 'air_tumble', { loop: true } ) );

	return new FootIK( new Switch( ( v ) => ! v.limp, { on: 0, off: 0.35 }, own, limp ), { weight: ( v ) => v.groundIK } );

}

export { Graph };
