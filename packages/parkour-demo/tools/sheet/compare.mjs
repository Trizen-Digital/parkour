// Compares two saved frames of the same size: how many pixels differ and by how much (per pixel, the largest
// difference of its red, green or blue, 0…255), and optionally a PNG with the two side by side above their
// difference (amplified eight times).
//
//   node tools/sheet/compare.mjs <before> <after> [out.png]
import fs from 'node:fs';
import path from 'node:path';
import { OUT, load, png } from './png.mjs';

const [ beforeName, afterName, outName ] = process.argv.slice( 2 );
const a = load( beforeName ), b = load( afterName );
if ( a.w !== b.w || a.h !== b.h ) throw new Error( 'the frames differ in size' );

const { w, h } = a, pixels = w * h;
let largest = 0, sum = 0, same = 0, over2 = 0, over8 = 0;
for ( let i = 0; i < pixels; i ++ ) {

	let d = 0;
	for ( let c = 0; c < 3; c ++ ) d = Math.max( d, Math.abs( a.data[ i * 4 + c ] - b.data[ i * 4 + c ] ) );
	largest = Math.max( largest, d );
	sum += d;
	if ( d === 0 ) same ++;
	if ( d > 2 ) over2 ++;
	if ( d > 8 ) over8 ++;

}

const percent = ( n ) => + ( n / pixels * 100 ).toFixed( 3 );
console.log( `${beforeName} vs ${afterName}: ${JSON.stringify( { pixels, identical: percent( same ), meanDiff: + ( sum / pixels ).toFixed( 4 ), maxDiff: largest, over2: percent( over2 ), over8: percent( over8 ) } )}` );

if ( outName ) {

	const W = w * 2, H = h * 2, image = Buffer.alloc( W * H * 4 );
	for ( let y = 0; y < h; y ++ ) for ( let x = 0; x < w; x ++ ) {

		const from = ( y * w + x ) * 4;
		for ( let c = 0; c < 4; c ++ ) {

			image[ ( y * W + x ) * 4 + c ] = a.data[ from + c ];
			image[ ( y * W + x + w ) * 4 + c ] = b.data[ from + c ];
			image[ ( ( y + h ) * W + x + w / 2 ) * 4 + c ] = c === 3 ? 255 : Math.min( 255, Math.abs( a.data[ from + c ] - b.data[ from + c ] ) * 8 );

		}

	}

	fs.writeFileSync( path.join( OUT, outName ), png( W, H, image ) );

}
