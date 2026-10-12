import { Vector3 } from 'three';
import { clamp } from '../math.js';

/**
 * How far moves carry the root. While a move whose take has a root track plays, the runner moves by the take's root
 * instead of by its own velocity; only the move playing counts (not one blending out), and takes carry no root turn.
 */
class RootMotion {

	/**
	 * @param {TakeLibrary} library
	 * @param {Moves} moves
	 */
	constructor( library, moves ) {

		this.library = library;
		this.moves = moves;

		// A sampler of each take's root track (null for a take with none), made when first asked for.
		this.samplers = new Map();

	}

	/** Whether a move instance's take carries the root. */
	hasMotion( instance ) {

		return Boolean( this.library.takes.get( instance.move.take ).root );

	}

	/**
	 * Where a take's root is at one of its times (m), in the take's own frame (+Z forward from where it starts).
	 * @returns {Vector3}
	 */
	position( take, time ) {

		let sampler = this.samplers.get( take );

		if ( sampler === undefined ) {

			sampler = this.library.rootTrack( take )?.createInterpolant() ?? null;
			this.samplers.set( take, sampler );

		}

		return sampler ? new Vector3().fromArray( sampler.evaluate( time ) ) : new Vector3();

	}

	/**
	 * The root's travel over the next `dt` of the move playing, without moving it on.
	 * @returns {{ translation: Vector3 }|null} null when no move that carries the root plays
	 */
	extract( dt ) {

		const instance = this.moves.instances.findLast( ( item ) => ! item.stopping && this.hasMotion( item ) );

		if ( ! instance ) return null;

		const ahead = Math.max( 0, dt * instance.rate );
		const translation = ahead > 0 ? this.travel( instance, instance.time, Math.min( instance.move.length, instance.time + ahead ) ) : new Vector3();

		return { translation };

	}

	/**
	 * The root's travel through a move between two of its times before its own rate (a stunt's time on its own clock
	 * times the rate it was started at), its take's times kept within the take.
	 * @param {object} move a move's entry
	 * @returns {Vector3}
	 */
	moveDelta( move, from, to ) {

		const length = this.library.takes.get( move.take ).length;
		const at = ( time ) => this.position( move.take, clamp( move.span[ 0 ] + time * move.rate, 0, length ) );

		return at( to ).sub( at( from ) );

	}

	// The root's travel between two of a move's times, within its span of the take. Added onto a zero vector, so no
	// part of it is ever negative zero.
	travel( instance, from, to ) {

		const translation = new Vector3();
		const move = instance.move;
		const a = Math.max( from, 0 ), b = Math.min( to, this.moves.spanLength( move ) );

		if ( b > a && this.hasMotion( instance ) ) translation.add( this.position( move.take, move.span[ 0 ] + b ).sub( this.position( move.take, move.span[ 0 ] + a ) ) );

		return translation;

	}

}

export { RootMotion };
