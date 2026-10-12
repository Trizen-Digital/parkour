// A course seen from above, for the Game Mode screen's still: each prim's footprint in a course file, the tops shaded
// by height (darker lower) and the apparatus in the graybox's colours (src/course/metrics.js), drawn highest last.
// +X runs right and -Z up the page, as the course tools' overhead view sees it.

import { colors } from '../course/metrics.js';

const hue = ( name ) => `#${colors.surfaces[ name ].graybox.toString( 16 ).padStart( 6, '0' )}`;

// The lowest and highest tops shade from this grey to this one.
const LOW = [ 46, 50, 56 ];
const HIGH = [ 226, 228, 226 ];

// How far round the course the still shows (m).
const MARGIN = 3;

// The lines' widths (m): a cable or a bar, a beam.
const THIN = 0.5;
const BEAM = 0.7;

const DEG = Math.PI / 180;

/**
 * @param {object} def a course file's contents
 * @returns {{viewBox: string, shapes: {kind: string, fill?: string, stroke?: string, width?: number, points?: string, x?: number, y?: number, r?: number}[], size: string, highest: string}}
 */
function planOf( def ) {

	const tops = [], lines = [], dots = [];
	let lo = Infinity, hi = - Infinity;

	for ( const prim of def.prims ?? [] ) {

		const roles = prim.roles ?? [];
		if ( roles.includes( 'out' ) || prim.collide === false ) continue;

		if ( prim.type === 'box' || prim.type === 'stairs' || prim.type === 'springboard' || prim.type === 'wedge' ) {

			const { corners, top } = footprint( prim );
			tops.push( { corners, top, fill: prim.type === 'wedge' ? hue( 'slide' ) : prim.type === 'springboard' ? hue( 'vault' ) : roles.includes( 'noRun' ) ? hue( 'noRun' ) : null } );
			lo = Math.min( lo, top );
			hi = Math.max( hi, top );

		} else if ( prim.type === 'cylinder' ) {

			dots.push( { x: prim.p[ 0 ], y: prim.p[ 2 ], r: Math.max( prim.r ?? 0.1, 0.35 ), top: prim.p[ 1 ] + ( prim.h ?? 1 ), fill: null } );

		} else if ( prim.type === 'beam' ) {

			lines.push( { a: prim.a, b: prim.b, stroke: hue( 'balance' ), width: BEAM } );

		} else if ( prim.type === 'bar' || prim.type === 'cable' || prim.type === 'rope' ) {

			lines.push( { a: prim.a, b: prim.b ?? prim.a, stroke: hue( 'swing' ), width: THIN } );

		} else if ( prim.type === 'pipe' || prim.type === 'ladder' ) {

			dots.push( { x: ( prim.a ?? prim.p )[ 0 ], y: ( prim.a ?? prim.p )[ 2 ], r: 0.45, top: Infinity, fill: hue( 'climb' ) } );

		} else if ( prim.type === 'door' || prim.type === 'valve' || prim.type === 'button' ) {

			dots.push( { x: prim.p[ 0 ], y: prim.p[ 2 ], r: 0.45, top: Infinity, fill: hue( 'interact' ) } );

		}

	}

	if ( ! tops.length ) return { viewBox: '0 0 16 9', shapes: [] };

	const shade = ( top ) => {

		const t = hi > lo ? ( top - lo ) / ( hi - lo ) : 1;
		return `rgb(${LOW.map( ( c, i ) => Math.round( c + ( HIGH[ i ] - c ) * t ) ).join( ',' )})`;

	};

	const shapes = [];
	let x0 = Infinity, z0 = Infinity, x1 = - Infinity, z1 = - Infinity;
	for ( const t of tops.sort( ( a, b ) => a.top - b.top ) ) {

		for ( const [ x, z ] of t.corners ) {

			x0 = Math.min( x0, x );
			z0 = Math.min( z0, z );
			x1 = Math.max( x1, x );
			z1 = Math.max( z1, z );

		}

		shapes.push( { kind: 'polygon', points: t.corners.map( ( p ) => p.join( ',' ) ).join( ' ' ), fill: t.fill ?? shade( t.top ) } );

	}

	for ( const d of dots.sort( ( a, b ) => a.top - b.top ) ) shapes.push( { kind: 'circle', x: d.x, y: d.y, r: d.r, fill: d.fill ?? shade( d.top ) } );
	for ( const l of lines ) shapes.push( { kind: 'line', points: `${l.a[ 0 ]},${l.a[ 2 ]} ${l.b[ 0 ]},${l.b[ 2 ]}`, stroke: l.stroke, width: l.width } );

	const spawn = def.spawn?.p;
	if ( spawn ) shapes.push( { kind: 'spawn', x: spawn[ 0 ], y: spawn[ 2 ], r: 1.2 } );

	return {
		viewBox: `${x0 - MARGIN} ${z0 - MARGIN} ${x1 - x0 + 2 * MARGIN} ${z1 - z0 + 2 * MARGIN}`,
		shapes,
		size: `${Math.round( x1 - x0 )} × ${Math.round( z1 - z0 )} m`,
		highest: `${+ hi.toFixed( 1 )} m`,
	};

}

// A solid's corners in plan, and its top: by its corners, or by the middle of its base, its size and its yaw.
function footprint( prim ) {

	if ( prim.min ) {

		const [ x0, , z0 ] = prim.min, [ x1, top, z1 ] = prim.max;
		return { corners: [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ], top };

	}

	const p = prim.p ?? [ 0, 0, 0 ], yaw = ( prim.yaw ?? 0 ) * DEG;
	let [ w, h, l ] = prim.size ?? [ 1.2, 0.6, 0.6 ];
	if ( prim.type === 'stairs' ) {

		const steps = prim.steps ?? Math.round( ( prim.h ?? 3 ) / ( prim.rise ?? 0.25 ) );
		[ w, h, l ] = [ prim.width ?? 2, steps * ( prim.rise ?? 0.25 ), steps * ( prim.run ?? 0.3 ) ];

	}

	// A stair's flight starts at p; a box's, a wedge's and a springboard's base is centred on it.
	const from = prim.type === 'stairs' ? 0 : - l / 2, to = prim.type === 'stairs' ? l : l / 2;
	const fx = Math.sin( yaw ), fz = Math.cos( yaw ), sx = Math.cos( yaw ), sz = - Math.sin( yaw );
	const at = ( s, f ) => [ p[ 0 ] + sx * s + fx * f, p[ 2 ] + sz * s + fz * f ];
	return { corners: [ at( - w / 2, from ), at( w / 2, from ), at( w / 2, to ), at( - w / 2, to ) ], top: p[ 1 ] + h };

}

export { planOf };
