// Recipes: what the graph hands the figure each step. A recipe is a small tree of plain objects, made afresh every
// step, saying which takes to sample at which times and how to put them together; the figure turns it into bones
// (figure/PoseSampler.js). The motion also reads the clips in it, for the markers they cross, and a state machine
// reads a state's last recipe to judge how long its main clip has left.
//
//   { kind: 'rest' }                                          the standing pose
//   { kind: 'clip', take, time, from, to, loop, player }      a take at `time`; this step its clock went from `from`
//                                                             to `to` (counted on past the end when it loops), on
//                                                             `player`'s time (markers are kept apart per player)
//   { kind: 'mix', a, b, weight }                             two poses, b's share `weight`
//   { kind: 'blend', samples: [ { recipe, weight } ], markers }  poses by weight; with `markers: 'heaviest'` only the
//                                                             heaviest sample's markers fire (one set of footfalls)
//   { kind: 'add', base, add, weight }                        an additive take's difference laid on a base
//   { kind: 'mask', base, over, weight, mask }                `over` laid on `base` by `weight` on part of the body
//                                                             only (`upper`: from the spine up)
//   { kind: 'legIK', source, foot, target, knee, weight }     a leg reaching for a point in the world
//   { kind: 'feet', source, weight }                          the feet put down on the ground under them
//
// A clip's `player` is the object whose clock it runs on: a clip player, one sample of a directional blend, one take
// of the idle shuffle. Its `owner` (the player itself when it has none) is the node that made it.

/** The standing pose. */
const REST = Object.freeze( { kind: 'rest' } );

/**
 * Calls `visit( clip, weight )` for every clip in a recipe, with its share of the whole pose. A share of nothing is
 * not visited.
 * @param {object} recipe
 * @param {(clip: object, weight: number) => void} visit
 * @param {boolean} [heaviestOnly] a blend that says `markers: 'heaviest'` passes on only its heaviest sample (the
 *   rule for markers)
 * @param {number} [weight] the recipe's own share
 */
function eachClip( recipe, visit, heaviestOnly = false, weight = 1 ) {

	if ( ! recipe || weight <= 0 ) return;

	switch ( recipe.kind ) {

		case 'clip':
			visit( recipe, weight );
			break;

		case 'mix':
			eachClip( recipe.a, visit, heaviestOnly, weight * ( 1 - recipe.weight ) );
			eachClip( recipe.b, visit, heaviestOnly, weight * recipe.weight );
			break;

		case 'blend':
			if ( heaviestOnly && recipe.markers === 'heaviest' ) {

				// The first of the heaviest, so a tie goes to the sample listed first.
				const heaviest = recipe.samples.reduce( ( best, sample ) => ( ! best || sample.weight > best.weight ? sample : best ), null );
				if ( heaviest ) eachClip( heaviest.recipe, visit, heaviestOnly, weight * heaviest.weight );

			} else {

				for ( const sample of recipe.samples ) eachClip( sample.recipe, visit, heaviestOnly, weight * sample.weight );

			}

			break;

		case 'add':
			eachClip( recipe.base, visit, heaviestOnly, weight );
			eachClip( recipe.add, visit, heaviestOnly, weight * recipe.weight );
			break;

		case 'mask':
			eachClip( recipe.base, visit, heaviestOnly, weight );
			eachClip( recipe.over, visit, heaviestOnly, weight * recipe.weight );
			break;

		case 'legIK':
		case 'feet':
			eachClip( recipe.source, visit, heaviestOnly, weight );
			break;

	}

}

/** A looping take's time within its cycle (its clock never runs backwards). */
function wrap( time, length ) {

	return time % length;

}

export { REST, eachClip, wrap };
