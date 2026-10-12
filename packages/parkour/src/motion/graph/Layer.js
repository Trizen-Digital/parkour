/**
 * Where one-shot moves show over the graph: the moves playing into the layer named `name` (Moves) laid over its
 * source. A move covering the layer fully stops the source being updated (unless `alwaysUpdateSource`), so a state
 * machine under it starts again once the move blends out.
 */
class Layer {

	/**
	 * @param {string} name `body`, `landing`, `climb` or `ledgeLeap`
	 * @param {object} source a node, or a recipe that never changes (REST)
	 * @param {object} [options]
	 * @param {boolean} [options.alwaysUpdateSource] update the source even while a move covers it
	 */
	constructor( name, source, { alwaysUpdateSource = false } = {} ) {

		this.name = name;
		this.source = source;
		this.alwaysUpdateSource = alwaysUpdateSource;

	}

	reset() {

		this.source.reset?.();

	}

	update( graph ) {

		const source = this.source;

		return graph.moves.layer( this.name, source.update ? () => source.update( graph ) : source, this.alwaysUpdateSource );

	}

}

export { Layer };
