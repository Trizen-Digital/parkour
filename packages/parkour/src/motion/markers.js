// Markers: named instants on a take (a foot coming down, a trick starting, the capsule shrinking) that fire as the
// take plays across them. The runner reacts to them a step later (MarkerResponses).
//
// A take's sound cues (`sounds`, `[ name, time ]`: a foot on the ground, a hand on a rung) fire the same way, typed
// 'sound', for a game's sound to play. They are kept apart from the markers (Motion.update): the runner never hears
// them and the traces never record them, so cues can be added or moved without changing a run.

// A take blended in more lightly than this fires none of its markers.
const WEIGHT_THRESHOLD = 0.00001;

/**
 * The markers and sound cues a take's clock crossed going from `from` to `to` (s): those at or after `from` and before
 * `to`, every cycle again when it loops.
 * @param {object} take the take's entry (`markers` and `sounds`: `[ name, time ]` pairs, `length`)
 * @param {number} from
 * @param {number} to
 * @param {object} [options]
 * @param {number} [options.weight] how much the take shows
 * @param {boolean} [options.loop] its clock counts on past its length, round and round
 * @returns {Array<{ type: 'marker'|'sound', name: string, weight: number }>} in the order they were crossed, each
 *   cycle's markers before its sound cues
 */
function markersCrossed( take, from, to, { weight = 1, loop = false } = {} ) {

	const crossed = [];

	const sounds = take.sounds ?? [];
	if ( ! ( to >= from ) || weight < WEIGHT_THRESHOLD || ! ( take.markers.length || sounds.length ) ) return crossed;

	const length = take.length;
	const firstCycle = loop ? Math.floor( from / length ) : 0;
	const lastCycle = loop ? Math.floor( to / length ) : 0;

	for ( let cycle = firstCycle; cycle <= lastCycle; cycle ++ ) {

		for ( const [ name, at ] of take.markers ) {

			const time = cycle * length + at;
			if ( time >= from && time < to ) crossed.push( { type: 'marker', name, weight } );

		}

		for ( const [ name, at ] of sounds ) {

			const time = cycle * length + at;
			if ( time >= from && time < to ) crossed.push( { type: 'sound', name, weight } );

		}

	}

	return crossed;

}

export { markersCrossed };
