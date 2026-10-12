/**
 * A grid over the ground plane (x, z) that finds the items whose bounds overlap a rectangle. The course keeps one for
 * its solids and one for its affordances, so a query looks at the few things near it instead of the whole course.
 *
 * Items are any objects; the grid writes a `_stamp` on each so an item spanning several cells is returned once.
 */
export class SpatialGrid {

	/**
	 * @param {number} cell The side of a square cell (m).
	 * @param {number} [big] Items wider than this on x or z go on a list every query returns: a floor slab would
	 * otherwise fill thousands of cells.
	 */
	constructor( cell, big = 64 ) {

		this.cell = cell;
		this.bigSize = big;
		this.cells = new Map();
		this.big = [];
		this.stamp = 0;

	}

	/** One number per cell; ±32768 cells either side of the origin is far more than any course. */
	key( ix, iz ) {

		return ( ix + 32768 ) * 65536 + ( iz + 32768 );

	}

	/**
	 * Adds an item under its bounds' footprint.
	 * @param {Object} item
	 * @param {THREE.Vector3} min
	 * @param {THREE.Vector3} max
	 */
	add( item, min, max ) {

		item._stamp = 0;
		if ( max.x - min.x > this.bigSize || max.z - min.z > this.bigSize ) {

			this.big.push( item );
			return;

		}

		const c = this.cell;
		for ( let ix = Math.floor( min.x / c ); ix <= Math.floor( max.x / c ); ix ++ ) {

			for ( let iz = Math.floor( min.z / c ); iz <= Math.floor( max.z / c ); iz ++ ) {

				const k = this.key( ix, iz );
				let list = this.cells.get( k );
				if ( ! list ) this.cells.set( k, list = [] );
				list.push( item );

			}

		}

	}

	/**
	 * The items in the cells a rectangle touches, each once: the big ones first, then cell by cell along x, then z.
	 * Queries take the first of equal answers, so this order is part of what they return.
	 * @param {number} x0
	 * @param {number} z0
	 * @param {number} x1
	 * @param {number} z1
	 * @param {Array} out Filled and returned.
	 * @return {Array}
	 */
	gather( x0, z0, x1, z1, out ) {

		out.length = 0;
		const stamp = ++ this.stamp, c = this.cell;
		for ( const item of this.big ) {

			item._stamp = stamp;
			out.push( item );

		}

		const ix1 = Math.floor( x1 / c ), iz1 = Math.floor( z1 / c );
		for ( let ix = Math.floor( x0 / c ); ix <= ix1; ix ++ ) {

			for ( let iz = Math.floor( z0 / c ); iz <= iz1; iz ++ ) {

				const list = this.cells.get( this.key( ix, iz ) );
				if ( ! list ) continue;
				for ( let i = 0; i < list.length; i ++ ) {

					const item = list[ i ];
					if ( item._stamp === stamp ) continue;
					item._stamp = stamp;
					out.push( item );

				}

			}

		}

		return out;

	}

	/** The items listed in one cell, or undefined: a ray walks the grid a cell at a time. */
	cellAt( ix, iz ) {

		return this.cells.get( this.key( ix, iz ) );

	}

}
