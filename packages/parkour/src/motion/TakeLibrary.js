import { VectorKeyframeTrack } from 'three/webgpu';

// The take and move tables (`public/data/moves.json`, built by `npm run moves:build`).
//
// A take is a stretch of motion with a length in seconds; it always plays at rate 1. Its `pace` is how many times its
// capture's speed that is (the build has already sped it up): the pose graph judges a take's time left by its
// capture's clock, so it hands over at the same point of the motion whatever the pace. Its entry may carry the markers
// the game reacts to (`[ name, time ]`), the sound cues a game's sound plays (`sounds`, the same; the run never reads
// them), the root's travel when the runner follows it (`root`, positions in metres,
// +Z forward), how far one cycle of it carries the runner (`stride`, m: the turn blends play it in step by it), the
// take it is added over (`additive`) and how its root bone is held (`pinned`, `pinAt`). A move plays
// a `span` of one take into a `layer` over the pose graph, at its own `rate`, for its `length` (which is authored and
// wins over the span's), blending in and out over `blendIn` and `blendOut` seconds (`blendInCurve` when not
// straight); with `holdAtEnd` it waits on its last pose instead of blending out on its own.
class TakeLibrary {

	/**
	 * @param {{ takes: Object<string, object>, moves: Object<string, object> }} data
	 */
	constructor( data ) {

		/**
		 * Every take by name, each entry with its `name`, its `pace` (1 unless it has one), its `markers` and its `sounds`
		 * (or none).
		 */
		this.takes = new Map( Object.entries( data.takes ).map( ( [ name, take ] ) => [ name, Object.assign( take, { name, pace: take.pace ?? 1, markers: take.markers ?? [], sounds: take.sounds ?? [] } ) ] ) );

		/** Every move by name, each entry with its `name`. */
		this.moves = new Map( Object.entries( data.moves ).map( ( [ name, move ] ) => [ name, Object.assign( move, { name } ) ] ) );

		this.rootTracks = new Map();

	}

	/**
	 * The root's travel through a take as a track (built once), or null when the take moves no root.
	 * @returns {VectorKeyframeTrack|null}
	 */
	rootTrack( name ) {

		if ( ! this.rootTracks.has( name ) ) {

			const root = this.takes.get( name )?.root;
			this.rootTracks.set( name, root ? new VectorKeyframeTrack( 'root.position', root.times, root.positions ) : null );

		}

		return this.rootTracks.get( name );

	}

}

export { TakeLibrary };
