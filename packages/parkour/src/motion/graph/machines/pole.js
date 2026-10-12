import { ClipPlayer } from '../ClipPlayer.js';
import { StateMachine } from '../StateMachine.js';

/**
 * On a pole: the grab, sliding down round it, and coiling to kick off while jump is held.
 * @returns {StateMachine}
 */
function pole() {

	const machine = new StateMachine( 'pole', {
		grab: new ClipPlayer( 'pole_grab' ),
		slide: new ClipPlayer( 'pole_slide', { loop: true } ),
		kickReady: new ClipPlayer( 'pole_kick_ready_left' ),
	}, 'grab' );

	const kicking = ( v ) => v.poleKicking;

	machine.from( 'grab' ).to( 'kickReady', 0.2, kicking ).toWhenDone( 'slide', 0.05 );
	machine.from( 'slide' ).to( 'kickReady', 0.2, kicking );

	return machine;

}

export { pole };
