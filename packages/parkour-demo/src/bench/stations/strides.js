// Strides across gapped surfaces: a dozen gaps of different widths in a row, walked with grab held, the runner
// striding from each top's edge to the next. A stride's target is the first top 2.25-3.5 m ahead of where it takes off
// (about half a metre short of the edge), with room for the body just short of it, so a gap fits from about 1.6 m to
// 2.95 m: these run 1.7-2.85 m, never two alike in a row. On the level, stepping up and down, and over narrow stones.

import { GRAB, at, onFoot } from '../script.js';

// The take-off floor ends here along a station (m); the tops reach down this far (m), past any pit's bottom.
const EDGE = 10, FOOT = - 8;

// The gaps, and the length of the top after each (m): uneven, the last a deck to walk off.
const GAPS = [ 1.7, 2.6, 2.0, 2.85, 1.8, 2.3, 2.75, 1.9, 2.5, 2.1, 2.8, 2.2 ];
const TOPS = [ 1.2, 0.9, 1.6, 1.0, 1.4, 0.8, 1.1, 1.5, 0.9, 1.3, 1.0, 6 ];

// The steps' tops (m above the floor): each within 0.4 m of the one before, back to the floor at the end.
const RISES = [ 0.3, 0.1, - 0.2, 0.2, 0.5, 0.2, - 0.1, - 0.4, 0, 0.3, 0.1, 0 ];

/**
 * A dozen strides in a row across GAPS.
 * @param {string} kind 'level', 'steps' (the tops at RISES) or 'stones' (each top 0.6 m across)
 */
export function strides( kind ) {

	const width = kind === 'stones' ? 0.6 : 4;
	const end = EDGE + GAPS.reduce( ( sum, gap, i ) => sum + gap + TOPS[ i ], 0 );
	const length = Math.ceil( end + 4 );
	return {
		id: `strides-${kind}`, family: 'strides', name: `A dozen strides across uneven gaps${ { level: '', steps: ', stepping up and down', stones: ', over stepping stones' }[ kind ]}`, size: GAPS.length, length, ground: false, low: kind === 'steps' ? - 0.4 : 0, limit: 40,
		build( b ) {

			b.floor( 0, EDGE );
			let z = EDGE;
			GAPS.forEach( ( gap, i ) => {

				const top = kind === 'steps' ? RISES[ i ] : 0, across = i === GAPS.length - 1 ? 4 : width;
				b.box( [ - across / 2, FOOT, z + gap ], [ across / 2, top, z + gap + TOPS[ i ] ] );
				z += gap + TOPS[ i ];

			} );
			b.floor( z, length );

		},
		steps: [
			{ run: 'sprint', until: at( EDGE - 4 ) },
			{ run: 'walk', hold: [ GRAB ], until: at( end - 4 ), limit: 36, say: 'stride the dozen gaps' },
			{ run: 'sprint', until: onFoot() },
		],
		expect: { states: [ 'striding' ] },
	};

}
