/**
 * A leg reaching for a point in the world (the feet against the wall while hanging): the `legIK` recipe the figure
 * solves with its two-bone leg.
 */
class LegIK {

	/**
	 * @param {object} source
	 * @param {object} leg
	 * @param {string} leg.foot the foot's bone role
	 * @param {(inputs: object) => Vector3} leg.target where the foot goes, in the world (m)
	 * @param {Vector3} leg.knee where the knee points, in the skeleton's space (m)
	 * @param {(inputs: object) => number} leg.weight
	 */
	constructor( source, { foot, target, knee, weight } ) {

		this.source = source;
		this.foot = foot;
		this.target = target;
		this.knee = knee;
		this.weight = weight;

	}

	reset() {

		this.source.reset();

	}

	update( graph ) {

		const inputs = graph.inputs;

		return { kind: 'legIK', source: this.source.update( graph ), foot: this.foot, target: this.target( inputs ), knee: this.knee, weight: this.weight( inputs ) };

	}

}

export { LegIK };
