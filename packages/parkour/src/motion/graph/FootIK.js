/**
 * The feet put down on the ground under them while the runner stands (the `feet` recipe, the figure's foot
 * placement), by a weight read from the runner.
 */
class FootIK {

	/**
	 * @param {object} source
	 * @param {object} options
	 * @param {(inputs: object) => number} options.weight
	 */
	constructor( source, { weight } ) {

		this.source = source;
		this.weight = weight;

	}

	reset() {

		this.source.reset();

	}

	update( graph ) {

		return { kind: 'feet', source: this.source.update( graph ), weight: this.weight( graph.inputs ) };

	}

}

export { FootIK };
