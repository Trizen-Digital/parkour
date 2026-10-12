import { ClipPlayer } from '../ClipPlayer.js';
import { StateMachine } from '../StateMachine.js';

/**
 * On a pipe: the grab, then holding on, climbing and sliding down, each with a halt as it stops.
 * @returns {StateMachine}
 */
function pipe() {

	const machine = new StateMachine( 'pipe', {
		grab: new ClipPlayer( 'pipe_grab' ),
		hold: new ClipPlayer( 'pipe_hold', { loop: true } ),
		// Hand over hand at the pace the runner climbs (PoseInputs.pipeClimbRate).
		climb: new ClipPlayer( 'pipe_climb_up', { loop: true, rate: ( v ) => v.pipeClimbRate } ),
		slideDown: new ClipPlayer( 'pipe_slide_down', { loop: true } ),
		slideStop: new ClipPlayer( 'pipe_slide_halt' ),
		climbStop: new ClipPlayer( 'pipe_climb_halt' ),
	}, 'grab' );

	const up = ( v ) => v.pipeGoing === 'up', down = ( v ) => v.pipeGoing === 'down';

	machine.from( 'grab' ).to( 'climb', 0.2, up ).toWhenDone( 'hold', 0.2 );
	machine.from( 'hold' ).to( 'slideDown', 0.25, down ).to( 'climb', 0.25, up );
	machine.from( 'climb' ).to( 'climbStop', 0.25, ( v ) => ! up( v ) );
	machine.from( 'slideDown' ).to( 'slideStop', 0.15, ( v ) => ! down( v ) );
	machine.from( 'slideStop' ).to( 'climb', 0.25, up ).toWhenDone( 'hold', 0.25 );
	machine.from( 'climbStop' ).to( 'slideDown', 0.25, down ).toWhenDone( 'hold', 0.25 );

	return machine;

}

export { pipe };
