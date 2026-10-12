import { BLENDS } from '../blends.js';
import { ClipPlayer } from '../ClipPlayer.js';
import { DirectionalBlend } from '../DirectionalBlend.js';
import { StateMachine } from '../StateMachine.js';

/**
 * The ground slide, on any floor: the drop into it, then seated, tucked or upright, each steering with the turn.
 * @param {TakeLibrary} library
 * @returns {StateMachine}
 */
function slide( library ) {

	const steering = ( v ) => [ v.turnRate, v.speed ];

	const machine = new StateMachine( 'slide', {
		dropIn: new ClipPlayer( 'slide_drop_in' ),
		seated: new DirectionalBlend( BLENDS.slideSeated, steering, library ),
		tucked: new DirectionalBlend( BLENDS.slideTucked, steering, library ),
		upright: new DirectionalBlend( BLENDS.slideUpright, steering, library ),
	}, 'dropIn' );

	const tucked = ( v ) => v.slideTucked, upright = ( v ) => v.slideUpright;

	machine.from( 'dropIn' ).to( 'tucked', 0.25, tucked ).to( 'upright', 0.25, upright ).toWhenDone( 'seated', 0.35 );
	machine.from( 'seated' ).to( 'upright', 0.25, upright ).to( 'tucked', 0.3, tucked );
	machine.from( 'tucked' ).to( 'seated', 0.4, ( v ) => ! tucked( v ) );
	machine.from( 'upright' ).to( 'seated', 0.25, ( v ) => ! upright( v ) );

	return machine;

}

export { slide };
