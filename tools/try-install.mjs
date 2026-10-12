// Installs the packages the way npm will hand them out, and runs the demo from that install: every package is packed
// (`npm pack`, so only what each package's `files` lets through goes in, and the demo's prepack builds it), the
// tarballs are installed into a fresh project outside the repo (../.try/), and the installed demo is started there
// with `npx parkour-demo` on http://localhost:5412/. Replays saved there are kept in ../.try/qa/ across runs.
//
//   npm run try                 pack, install, serve
//   npm run try -- --check      pack, install, then run the tests and the golden traces in the installed demo

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath( new URL( '../', import.meta.url ) );
const PACKS = path.join( ROOT, '.packs' );
const TRY = path.resolve( ROOT, '../.try' );
const PACKAGES = [ '@trizendigital/parkour', '@trizendigital/parkour-box3d', '@trizendigital/parkour-rapier', '@trizendigital/parkour-demo' ];

const run = ( command, args, cwd ) => execFileSync( command, args, { cwd, stdio: 'inherit' } );

fs.rmSync( PACKS, { recursive: true, force: true } );
fs.mkdirSync( PACKS );
// The demo's build first (its prepack), so the pack's own output is only the list of what it packed.
console.log( 'Building the demo for the package…' );
run( 'npm', [ 'run', 'build:package', '-w', '@trizendigital/parkour-demo' ], ROOT );
console.log( 'Packing…' );
const packed = JSON.parse( execFileSync( 'npm', [ 'pack', '--json', '--ignore-scripts', '--pack-destination', PACKS, ...PACKAGES.flatMap( ( name ) => [ '-w', name ] ) ], { cwd: ROOT, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'inherit' ], maxBuffer: 256 * 1024 * 1024 } ) );

const mb = ( bytes ) => `${( bytes / 1e6 ).toFixed( 1 )} MB`;
for ( const pack of packed ) console.log( `  ${pack.name.padEnd( 24 )} ${String( pack.entryCount ).padStart( 5 )} files  ${mb( pack.size ).padStart( 8 )} packed  ${mb( pack.unpackedSize ).padStart( 8 )} unpacked` );

// A fresh project each time; its qa/ (the replays saved in it) stays.
fs.mkdirSync( TRY, { recursive: true } );
for ( const entry of [ 'node_modules', 'package.json', 'package-lock.json' ] ) fs.rmSync( path.join( TRY, entry ), { recursive: true, force: true } );
fs.writeFileSync( path.join( TRY, 'package.json' ), JSON.stringify( { name: 'parkour-try', private: true, type: 'module' }, null, '\t' ) + '\n' );

// Every tarball in one install, so each package's dependency on another is met by its tarball, not the registry.
console.log( `\nInstalling into ${TRY}…` );
run( 'npm', [ 'install', '--no-audit', '--no-fund', ...packed.map( ( pack ) => path.join( PACKS, pack.filename ) ) ], TRY );

if ( process.argv.includes( '--check' ) ) {

	const demo = path.join( TRY, 'node_modules/@trizendigital/parkour-demo' );
	console.log( '\nThe tests, in the installed demo…' );
	run( 'node', [ '--test', ...fs.readdirSync( path.join( demo, 'tests' ) ).filter( ( file ) => file.endsWith( '.test.mjs' ) ).map( ( file ) => `tests/${file}` ) ], demo );
	for ( const engine of [ 'box3d', 'rapier' ] ) run( 'node', [ 'tools/headless/golden.mjs', 'verify', '--engine', engine ], demo );

} else {

	console.log( '\nStarting the installed demo…' );
	spawn( 'npx', [ 'parkour-demo' ], { cwd: TRY, stdio: 'inherit' } );

}
