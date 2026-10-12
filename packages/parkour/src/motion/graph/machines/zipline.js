import { ClipPlayer } from '../ClipPlayer.js';
import { StateMachine } from '../StateMachine.js';

/**
 * Riding a zipline: the grab, then hanging by both hands.
 * @returns {StateMachine}
 */
function zipline() {

	const machine = new StateMachine( 'zipline', {
		grab: new ClipPlayer( 'zip_grab' ),
		ride: new ClipPlayer( 'zip_hang', { loop: true } ),
	}, 'grab' );

	machine.from( 'grab' ).toWhenDone( 'ride', 0.35 );

	return machine;

}

export { zipline };
