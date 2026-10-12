import { BLENDS } from '../blends.js';
import { ClipPlayer } from '../ClipPlayer.js';
import { DirectionalBlend } from '../DirectionalBlend.js';
import { StateMachine } from '../StateMachine.js';

/**
 * On a rope: the catch, then the swing, its legs thrown forward or trailing by which way the body swings. The figure
 * hangs along the rope by its tilt (PoseInputs).
 * @param {TakeLibrary} library
 * @returns {StateMachine}
 */
function rope( library ) {

	const machine = new StateMachine( 'rope', {
		grab: new ClipPlayer( 'rope_catch' ),
		swing: new DirectionalBlend( BLENDS.ropeSwing, ( v ) => [ v.ropeSwing ], library ),
	}, 'grab' );

	machine.from( 'grab' ).toWhenDone( 'swing', 0.25 );

	return machine;

}

export { rope };
