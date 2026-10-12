import { Matrix4, Quaternion, Vector3 } from 'three';
import { boxSolid, hullSolid } from './solids.js';

// Catch volumes: where the runner can take hold of a pipe, a zipline or a ladder. Each is a solid of its own, kept
// apart from the course's solids in a query world of their own, so the runner's probes never see them and they never
// see anything but the runner. A ladder's volume is a pipe's: it is climbed the same way.

const UP = new Vector3( 0, 1, 0 );

// A pipe's volume stands 38 cm out from the pipe, on the runner's side of it.
const PIPE_STANDOFF = 0.38;

// A pipe's volume is 1.08 m square: half its size, front to back and side to side (m).
const PIPE_HALF_SIZE = 0.54;

// A pipe's volume stops this far short of its top: a runner that high climbs off instead (m).
const PIPE_TOP_CLEARANCE = 1.8;

// A zipline's volume runs 55 cm past each end of the cable. Its cross section is a square round the cable, square to
// its slope, 1.25 m across at the top end and 1.2 m at the bottom, with the cable near its middle. The square's lower
// left corner is found in two steps: 50 cm to the left of the cable and 50 cm straight down, then 12 cm further out
// along the square's own sides (which tilt with the slope).
const ZIPLINE_OVERRUN = 0.55;
const ZIPLINE_SET_BACK = 0.5;
const ZIPLINE_CORNER_OUTSET = 0.12;
const ZIPLINE_TOP_SIZE = 1.25;
const ZIPLINE_BOTTOM_SIZE = 1.2;

/**
 * A pipe's or zipline's frame: forward (the way the runner faces on it: into a pipe's wall, down a zipline), up, and
 * right.
 *
 * @param {{ forward: Vector3 }} route
 * @return {{ forward: Vector3, up: Vector3, right: Vector3 }}
 */
function routeBasis( route ) {

	const forward = route.forward.clone().normalize();
	const up = UP.clone();
	const right = new Vector3().crossVectors( forward, up ).normalize();

	return { forward, up, right };

}

/**
 * Where a pipe's volume sits: a box on the runner's side of the pipe, from its foot to 1.8 m below its top.
 *
 * @param {{ start: Vector3, end: Vector3, forward: Vector3 }} pipe
 * @return {{ position: number[], rotation: number[], halfExtents: number[] }}
 */
function pipeVolume( pipe ) {

	const { forward, up, right } = routeBasis( pipe );
	const height = pipe.end.clone().sub( pipe.start ).dot( up );
	const centre = pipe.start.clone().addScaledVector( forward, - PIPE_STANDOFF ).addScaledVector( up, height / 2 );
	const rotation = new Quaternion().setFromRotationMatrix( new Matrix4().makeBasis( forward, up, right ) );

	return {
		position: centre.toArray(),
		rotation: rotation.toArray(),
		halfExtents: [ PIPE_HALF_SIZE, Math.max( 0, height - PIPE_TOP_CLEARANCE ) / 2, PIPE_HALF_SIZE ]
	};

}

/**
 * A zipline's volume: the corners of a square slice round the cable a little past each end. Flat [ x, y, z, … ], the
 * top end's four first.
 *
 * @param {{ start: Vector3, end: Vector3, forward: Vector3 }} zipline
 * @return {number[]}
 */
function ziplineVolume( zipline ) {

	const { forward, up, right } = routeBasis( zipline );
	const along = zipline.end.clone().sub( zipline.start ).normalize();
	const sliceRight = new Vector3().crossVectors( along, up ).normalize();
	const sliceUp = new Vector3().crossVectors( sliceRight, along ).normalize();
	const points = [];

	for ( const atEnd of [ false, true ] ) {

		const corner = ( atEnd ? zipline.end : zipline.start )
			.clone()
			.addScaledVector( forward, atEnd ? ZIPLINE_OVERRUN : - ZIPLINE_OVERRUN )
			.addScaledVector( right, - ZIPLINE_SET_BACK )
			.addScaledVector( up, - ZIPLINE_SET_BACK );
		const size = atEnd ? ZIPLINE_BOTTOM_SIZE : ZIPLINE_TOP_SIZE;

		for ( const y of [ 0, 1 ] ) {

			for ( const z of [ 0, 1 ] ) {

				points.push( ...corner.clone().addScaledVector( sliceRight, y * size - ZIPLINE_CORNER_OUTSET ).addScaledVector( sliceUp, z * size - ZIPLINE_CORNER_OUTSET ).toArray() );

			}

		}

	}

	return points;

}

/**
 * A course's catch volumes as solids, the pipes' first, then the ziplines', then the ladders', each knowing its route
 * and kind.
 *
 * @param {Object[]} pipes
 * @param {Object[]} ziplines
 * @param {Object[]} [ladders]
 * @return {Object[]} Solids with `kind` ('pipe', 'zipline' or 'ladder') and `route`.
 */
function catchVolumes( pipes, ziplines, ladders = [] ) {

	return [
		...pipes.map( ( pipe ) => ( { ...boxSolid( { id: pipe.id, ...pipeVolume( pipe ) } ), kind: 'pipe', route: pipe } ) ),
		...ziplines.map( ( zipline ) => ( { ...hullSolid( { id: zipline.id, points: ziplineVolume( zipline ) } ), kind: 'zipline', route: zipline } ) ),
		...ladders.map( ( ladder ) => ( { ...boxSolid( { id: ladder.id, ...pipeVolume( ladder ) } ), kind: 'ladder', route: ladder } ) )
	];

}

export { routeBasis, pipeVolume, ziplineVolume, catchVolumes };
