import { BLENDS } from '../blends.js';
import { ClipPlayer } from '../ClipPlayer.js';
import { DirectionalBlend } from '../DirectionalBlend.js';
import { StateMachine } from '../StateMachine.js';
import { Switch } from '../Switch.js';

/**
 * Hanging from a ledge: the catch, then holding on (looking about with the stick) and shimmying either way, each
 * with the feet against the wall, or free when there is no wall under the ledge.
 * @param {TakeLibrary} library
 * @returns {StateMachine}
 */
function hang( library ) {

	const free = ( v ) => v.hangingFree;

	const catchWall = new ClipPlayer( 'ledge_catch' );
	const catchFree = new ClipPlayer( 'ledge_catch_free' );
	const holdFree = new ClipPlayer( 'ledge_hang_free', { loop: true } );
	const look = new DirectionalBlend( BLENDS.hangLook, ( v ) => [ v.stick.x, v.stick.y ], library );
	const shimmy = ( side ) => {

		const wall = new ClipPlayer( 'ledge_shimmy_' + side, { loop: true } );
		const open = new ClipPlayer( 'ledge_shimmy_free_' + side, { loop: true } );

		return { pose: new Switch( free, { on: 0.25, off: 0.25 }, open, wall ), players: [ wall, open ] };

	};

	const machine = new StateMachine( 'hang', {
		catch: { pose: new Switch( free, { on: 0.1, off: 0.1 }, catchFree, catchWall ), players: [ catchWall, catchFree ] },
		hold: { pose: new Switch( free, { on: 0.1, off: 0.1 }, holdFree, look ), players: [ holdFree, look ] },
		shimmyRight: shimmy( 'right' ),
		shimmyLeft: shimmy( 'left' ),
	}, 'catch' );

	machine.from( 'catch' ).toWhenDone( 'hold', 0.35 );
	machine.from( 'hold' ).to( 'shimmyLeft', 0.25, ( v ) => v.shimmyLeft ).to( 'shimmyRight', 0.25, ( v ) => v.shimmyRight );
	machine.from( 'shimmyRight' ).to( 'hold', 0.35, ( v ) => ! v.shimmyRight );
	machine.from( 'shimmyLeft' ).to( 'hold', 0.35, ( v ) => ! v.shimmyLeft );

	return machine;

}

export { hang };
