import { ClipPlayer } from '../ClipPlayer.js';
import { StateMachine } from '../StateMachine.js';

/**
 * On a ladder: getting on, then holding on, climbing hand over hand and sliding down on the rails.
 * @returns {StateMachine}
 */
function ladder() {

	const machine = new StateMachine( 'ladder', {
		grab: new ClipPlayer( 'ladder_grab' ),
		hold: new ClipPlayer( 'ladder_hold' ),
		climb: new ClipPlayer( 'ladder_climb_up', { loop: true } ),
		slideDown: new ClipPlayer( 'ladder_slide_down' ),
	}, 'grab' );

	const up = ( v ) => v.ladderGoing === 'up', down = ( v ) => v.ladderGoing === 'down';

	machine.from( 'grab' ).to( 'climb', 0.2, up ).to( 'slideDown', 0.2, down ).toWhenDone( 'hold', 0.2 );
	machine.from( 'hold' ).to( 'climb', 0.2, up ).to( 'slideDown', 0.2, down );
	machine.from( 'climb' ).to( 'slideDown', 0.2, down ).to( 'hold', 0.25, ( v ) => ! up( v ) );
	machine.from( 'slideDown' ).to( 'climb', 0.25, up ).to( 'hold', 0.2, ( v ) => ! down( v ) );

	return machine;

}

export { ladder };
