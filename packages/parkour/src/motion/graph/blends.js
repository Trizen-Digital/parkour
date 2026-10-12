// The directional blends: takes placed at points on one or two axes, mixed by where an input falls among them
// (DirectionalBlend).
//
// Each blend's `axes` bound its input. `samples` place a take `at` a point. Two axes are cut into `triangles` of
// samples (by index), one axis is a `segment` between two samples. `weightRate` eases the weights toward where the
// input calls for (1/s; 0 snaps), `smoothing` eases the input on each axis (s; 0 leaves it as it is), and `length` is
// the blend's nominal cycle, by which a state judges how long it has left: the take whose cycle it is (by name).
//
// A sample's take goes round in its own length, unless the blend has a `speedAxis` (the axis that is the runner's
// speed, m/s) and the take a stride (how far one cycle of it carries the runner): then it goes round in the time its
// stride takes at the sample's speed, so the feet keep in step with the ground (DirectionalBlend plays it at the rate
// that does).

import { clamp } from '../../math.js';

// The fastest turn the leaning takes lean for (rad/s): an eighth of a turn a second.
const TURN = Math.PI / 4;

const BLENDS = {

	// Hanging, looking about with the stick: across, then up.
	hangLook: {
		length: 'ledge_hang',
		weightRate: 2,
		smoothing: [ 0, 0 ],
		axes: [ { min: - 1, max: 1 }, { min: - 1, max: 1 } ],
		samples: [
			{ take: 'ledge_hang_look_up', at: [ 0, 0.5 ] },
			{ take: 'ledge_hang_look_down', at: [ 0, - 0.5 ] },
			{ take: 'ledge_hang', at: [ 0, 0 ] },
			{ take: 'ledge_hang_look_up_left', at: [ - 0.5, 0.5 ] },
			{ take: 'ledge_hang_look_up_right', at: [ 0.5, 0.5 ] },
			{ take: 'ledge_hang_look_down_left', at: [ - 0.5, - 0.5 ] },
			{ take: 'ledge_hang_look_down_right', at: [ 0.5, - 0.5 ] },
			{ take: 'ledge_hang_look_left', at: [ - 1, 0 ] },
			{ take: 'ledge_hang_look_right', at: [ 1, 0 ] }
		],
		triangles: [ [ 1, 6, 2 ], [ 1, 2, 5 ], [ 7, 5, 2 ], [ 6, 8, 2 ], [ 7, 2, 3 ], [ 8, 4, 2 ], [ 3, 2, 0 ], [ 2, 4, 0 ] ]
	},

	// The run, leaning into its turns: the turn rate across (rad/s), the speed up (m/s). The slow takes are a run's
	// stride, the fast ones a sprint's, each played in step with its speed.
	runTurn: {
		length: 'ground_run_lean_left',
		speedAxis: 1,
		weightRate: 1,
		smoothing: [ 0, 0 ],
		axes: [ { min: - TURN, max: TURN }, { min: 2.5, max: 5.85 } ],
		samples: [
			{ take: 'ground_run_lean_left', at: [ - TURN, 5.85 ] },
			{ take: 'ground_run_lean_right', at: [ TURN, 5.85 ] },
			{ take: 'ground_run_lean_left_slow', at: [ - TURN, 2.5 ] },
			{ take: 'ground_run_lean_right_slow', at: [ TURN, 2.5 ] }
		],
		triangles: [ [ 2, 3, 0 ], [ 3, 1, 0 ] ]
	},

	// Along a beam, arms out: the turn rate across (rad/s; no lean, so either side is the same take), the speed up
	// (m/s), from the balance walk slow to its quicker steps, each in step with its speed.
	balanceWalk: {
		length: 'ground_balance_walk',
		speedAxis: 1,
		weightRate: 1,
		smoothing: [ 0, 0 ],
		axes: [ { min: - TURN, max: TURN }, { min: 0.2, max: 2.5 } ],
		samples: [
			{ take: 'ground_balance_run', at: [ - TURN, 2.5 ] },
			{ take: 'ground_balance_run', at: [ TURN, 2.5 ] },
			{ take: 'ground_balance_walk', at: [ - TURN, 0.2 ] },
			{ take: 'ground_balance_walk', at: [ TURN, 0.2 ] }
		],
		triangles: [ [ 2, 3, 0 ], [ 3, 1, 0 ] ]
	},

	// The walk, leaning into its turns: the turn rate across (rad/s), the speed up (m/s).
	walkTurn: {
		length: 'ground_walk_lean_left',
		speedAxis: 1,
		weightRate: 1,
		smoothing: [ 0, 0 ],
		axes: [ { min: - TURN, max: TURN }, { min: 0.2, max: 2 } ],
		samples: [
			{ take: 'ground_walk_lean_left', at: [ - TURN, 2 ] },
			{ take: 'ground_walk_lean_right', at: [ TURN, 2 ] },
			{ take: 'ground_walk_lean_left_slow', at: [ - TURN, 0.2 ] },
			{ take: 'ground_walk_lean_right_slow', at: [ TURN, 0.2 ] }
		],
		triangles: [ [ 2, 3, 0 ], [ 3, 1, 0 ] ]
	},

	// Sliding seated, steering: the turn rate across (rad/s), the speed up (m/s).
	slideSeated: {
		length: 'slide_seat',
		weightRate: 2,
		smoothing: [ 0, 0 ],
		axes: [ { min: - TURN, max: TURN }, { min: 2.5, max: 5.85 } ],
		samples: [
			{ take: 'slide_seat', at: [ 0, 5.85 ] },
			{ take: 'slide_seat', at: [ 0, 2.5 ] },
			{ take: 'slide_seat_left', at: [ - TURN, 5.85 ] },
			{ take: 'slide_seat_left', at: [ - TURN, 2.5 ] },
			{ take: 'slide_seat_right', at: [ TURN, 5.85 ] },
			{ take: 'slide_seat_right', at: [ TURN, 2.5 ] }
		],
		triangles: [ [ 3, 1, 0 ], [ 1, 5, 0 ], [ 3, 0, 2 ], [ 5, 4, 0 ] ]
	},

	// Sliding tucked, steering.
	slideTucked: {
		length: 'slide_tuck',
		weightRate: 1,
		smoothing: [ 0, 0 ],
		axes: [ { min: - TURN, max: TURN }, { min: 2.5, max: 5.85 } ],
		samples: [
			{ take: 'slide_tuck', at: [ - TURN, 5.85 ] },
			{ take: 'slide_tuck', at: [ - TURN, 2.5 ] },
			{ take: 'slide_tuck_right', at: [ TURN, 2.5 ] },
			{ take: 'slide_tuck_right', at: [ TURN, 5.85 ] }
		],
		triangles: [ [ 1, 2, 0 ], [ 2, 3, 0 ] ]
	},

	// Sliding upright, steering.
	slideUpright: {
		length: 'slide_stand_left',
		weightRate: 1,
		smoothing: [ 0, 0 ],
		axes: [ { min: - TURN, max: TURN }, { min: 2.5, max: 5.85 } ],
		samples: [
			{ take: 'slide_stand_left', at: [ - TURN, 5.85 ] },
			{ take: 'slide_stand_right', at: [ TURN, 5.85 ] },
			{ take: 'slide_stand_left', at: [ - TURN, 2.5 ] },
			{ take: 'slide_stand_right', at: [ TURN, 2.5 ] }
		],
		triangles: [ [ 2, 3, 0 ], [ 3, 1, 0 ] ]
	},

	// Swinging on a rope (PoseInputs.ropeSwing): the legs trailing as it swings back at -1, thrown out ahead as it swings
	// forward at 1, its input eased over 0.15 s.
	ropeSwing: {
		length: 'rope_swing_forward',
		weightRate: 0,
		smoothing: [ 0.15 ],
		axes: [ { min: - 1, max: 1 } ],
		samples: [
			{ take: 'rope_swing_back', at: [ - 1 ] },
			{ take: 'rope_swing_forward', at: [ 1 ] }
		],
		segment: [ 0, 1 ]
	},

	// The body's lean (PoseInputs.lean): into the run at -1, back at 1, its input eased over 0.2 s. Additive takes.
	lean: {
		length: 'pose_lean_back',
		weightRate: 0,
		smoothing: [ 0.2 ],
		axes: [ { min: - 1, max: 1 } ],
		samples: [
			{ take: 'pose_lean_back', at: [ 1 ] },
			{ take: 'pose_lean_forward', at: [ - 1 ] }
		],
		segment: [ 1, 0 ]
	}

};

// Where a value falls on an axis, 0…1 (kept on the axis).
function along( axis, value ) {

	return ( clamp( value, axis.min, axis.max ) - axis.min ) / ( axis.max - axis.min );

}

// Each sample's point on the axes in their 0…1 space, which the triangles and segments are measured in.
for ( const blend of Object.values( BLENDS ) ) {

	const corners = blend.samples.map( ( sample ) => sample.at.map( ( value, axis ) => along( blend.axes[ axis ], value ) ) );

	if ( blend.triangles ) blend.triangles = blend.triangles.map( ( indices ) => ( { indices, corners: indices.map( ( index ) => corners[ index ] ) } ) );
	if ( blend.segment ) blend.segment = { indices: blend.segment, ends: blend.segment.map( ( index ) => corners[ index ][ 0 ] ) };

}

deepFreeze( BLENDS );

function deepFreeze( object ) {

	for ( const value of Object.values( object ) ) if ( value && typeof value === 'object' ) deepFreeze( value );
	return Object.freeze( object );

}

/**
 * The samples a blend mixes at an input, with their weights: on its segment, or in the triangle holding the input,
 * else on the nearest edge of any triangle.
 * @param {object} blend one of BLENDS
 * @param {number[]} input a value per axis
 * @returns {Array<{ index: number, take: string, weight: number }>} the samples with any weight (above a millionth)
 */
function blendWeights( blend, input ) {

	const point = blend.axes.map( ( axis, index ) => along( axis, input[ index ] ) );
	let weights = null;

	if ( blend.segment ) {

		const [ low, high ] = blend.segment.ends, range = high - low;
		const weight = range ? clamp( ( point[ 0 ] - low ) / range, 0, 1 ) : 0;

		weights = blend.segment.indices.map( ( index, end ) => ( { index, weight: end ? weight : 1 - weight } ) );

	}

	const [ px, py ] = point;

	for ( const triangle of blend.triangles ?? [] ) {

		const [ a, b, c ] = triangle.corners;
		const denominator = ( b[ 1 ] - c[ 1 ] ) * ( a[ 0 ] - c[ 0 ] ) + ( c[ 0 ] - b[ 0 ] ) * ( a[ 1 ] - c[ 1 ] );

		if ( Math.abs( denominator ) < 1e-9 ) continue;

		const wa = ( ( b[ 1 ] - c[ 1 ] ) * ( px - c[ 0 ] ) + ( c[ 0 ] - b[ 0 ] ) * ( py - c[ 1 ] ) ) / denominator;
		const wb = ( ( c[ 1 ] - a[ 1 ] ) * ( px - c[ 0 ] ) + ( a[ 0 ] - c[ 0 ] ) * ( py - c[ 1 ] ) ) / denominator;
		const wc = 1 - wa - wb;

		// Inside, allowing for rounding on an edge.
		if ( Math.min( wa, wb, wc ) >= - 1e-6 ) {

			weights = triangle.indices.map( ( index, corner ) => ( { index, weight: Math.max( 0, [ wa, wb, wc ][ corner ] ) } ) );
			break;

		}

	}

	if ( ! weights && blend.triangles?.length ) {

		let distance = Infinity;

		for ( const triangle of blend.triangles ) {

			for ( let edge = 0; edge < 3; edge ++ ) {

				const next = ( edge + 1 ) % 3;
				const a = triangle.corners[ edge ], b = triangle.corners[ next ];
				const dx = b[ 0 ] - a[ 0 ], dy = b[ 1 ] - a[ 1 ];
				const t = clamp( ( ( px - a[ 0 ] ) * dx + ( py - a[ 1 ] ) * dy ) / ( dx * dx + dy * dy ), 0, 1 );
				const squared = ( px - a[ 0 ] - t * dx ) ** 2 + ( py - a[ 1 ] - t * dy ) ** 2;

				if ( squared < distance ) {

					distance = squared;
					weights = [ edge, next ].map( ( corner, end ) => ( { index: triangle.indices[ corner ], weight: end ? t : 1 - t } ) );

				}

			}

		}

	}

	return weights
		.filter( ( sample ) => sample.weight > 1e-6 )
		.map( ( { index, weight } ) => ( { index, take: blend.samples[ index ].take, weight } ) );

}

export { BLENDS, blendWeights };
