// Frames the receiver saved (tools/sheet/out/<name>.rgba with its size in <name>.json), and PNG files of them.
//
//   node tools/sheet/png.mjs <name>          writes tools/sheet/out/<name>.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join( path.dirname( fileURLToPath( import.meta.url ) ), 'out' );

/** A saved frame: `{ w, h, data }` with `data` its RGBA bytes, rows top to bottom. */
function load( name ) {

	const { w, h } = JSON.parse( fs.readFileSync( path.join( OUT, name + '.json' ) ) );
	return { w, h, data: fs.readFileSync( path.join( OUT, name + '.rgba' ) ) };

}

function crc32( bytes ) {

	let crc = 0xffffffff;
	for ( const byte of bytes ) {

		crc ^= byte;
		for ( let k = 0; k < 8; k ++ ) crc = crc & 1 ? 0xedb88320 ^ ( crc >>> 1 ) : crc >>> 1;

	}

	return ( crc ^ 0xffffffff ) >>> 0;

}

/** An RGBA image as a PNG file's bytes (a byte per colour, no filtering). */
function png( w, h, rgba ) {

	// Each row starts with its filter type (0: none).
	const rows = Buffer.alloc( ( w * 4 + 1 ) * h );
	for ( let y = 0; y < h; y ++ ) rgba.copy( rows, y * ( w * 4 + 1 ) + 1, y * w * 4, ( y + 1 ) * w * 4 );

	const chunk = ( type, data ) => {

		const length = Buffer.alloc( 4 ), crc = Buffer.alloc( 4 ), body = Buffer.concat( [ Buffer.from( type ), data ] );
		length.writeUInt32BE( data.length );
		crc.writeUInt32BE( crc32( body ) );
		return Buffer.concat( [ length, body, crc ] );

	};

	const header = Buffer.alloc( 13 );
	header.writeUInt32BE( w, 0 );
	header.writeUInt32BE( h, 4 );
	header[ 8 ] = 8; // bits per colour
	header[ 9 ] = 6; // RGBA
	const signature = Buffer.from( [ 137, 80, 78, 71, 13, 10, 26, 10 ] );
	return Buffer.concat( [ signature, chunk( 'IHDR', header ), chunk( 'IDAT', zlib.deflateSync( rows ) ), chunk( 'IEND', Buffer.alloc( 0 ) ) ] );

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const name = process.argv[ 2 ];
	const { w, h, data } = load( name );
	fs.writeFileSync( path.join( OUT, name + '.png' ), png( w, h, data ) );
	console.log( path.join( OUT, name + '.png' ) );

}

export { OUT, load, png };
