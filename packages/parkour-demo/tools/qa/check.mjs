// Runs a QA replay again headless and says whether it comes out exactly as recorded: every frame's hash the same, or
// the first frame that differs. `npm run qa:open` runs it on the code at the replay's commit (a worktree) and on the
// code as it is now. The check itself is always this file, given the copy of the demo to check with `--demo`: that
// copy's code, motion data and packages are the ones loaded, so a bug in an old commit's tools cannot stop a check of
// that commit.
//
//   node tools/qa/check.mjs <replay.json> <course.json> [--demo <the demo's folder>] [--json]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fingerprintOf } from './fingerprint.mjs';

const args = process.argv.slice( 2 );
const demo = path.resolve( args.includes( '--demo' ) ? args.splice( args.indexOf( '--demo' ), 2 )[ 1 ] : fileURLToPath( new URL( '../../', import.meta.url ) ) );
const [ replayFile, courseFile ] = args.filter( ( arg ) => ! arg.startsWith( '--' ) );
if ( ! replayFile || ! courseFile ) {

	console.log( 'usage: node tools/qa/check.mjs <replay.json> <course.json> [--demo <folder>] [--json]' );
	process.exit( 2 );

}

// That copy's modules: its node shim first (it serves that copy's public/), then what a replay needs, and the core's
// tape module found from that copy as its own code finds it.
const from = ( file ) => import( pathToFileURL( path.join( demo, file ) ).href );
await from( 'tools/headless/env.mjs' );
const { replaySim, Replay } = await from( 'src/qa/replay.js' );
const { YBotFigure } = await from( 'src/figure/YBotFigure.js' );
const core = path.dirname( createRequire( path.join( demo, 'package.json' ) ).resolve( '@trizen/parkour' ) );
const { engineOf, timesOf } = await import( pathToFileURL( path.join( core, 'replay/tape.js' ) ).href );

const rec = JSON.parse( fs.readFileSync( replayFile, 'utf8' ) );
const definition = JSON.parse( fs.readFileSync( courseFile, 'utf8' ) );
const engine = engineOf( rec.settings );

// The Y Bot, as the editor runs replays: the ragdoll reads its bones.
const sim = await replaySim( definition, { figure: new YBotFigure(), engine } );
const replay = new Replay( sim, rec, { meter: false } );
const hashes = [];
for ( let f = 0; f < rec.frames; f ++ ) hashes.push( replay.step().hash );
replay.end();

const t = timesOf( rec.input.dt ), start = rec.range?.from ?? 0, at = replay.divergedAt;
const result = {
	id: rec.id, engine, frames: rec.frames, exact: at === null, divergedAt: at, fingerprint: fingerprintOf( hashes ),
	at: at === null ? null : + ( t[ at ] - t[ start ] ).toFixed( 3 ),
	ran: { node: process.version, platform: os.platform(), release: os.release(), arch: os.arch() },
};

if ( args.includes( '--json' ) ) console.log( JSON.stringify( result ) );
else console.log( result.exact ? `${rec.id}: exact (${rec.frames} frames on ${engine})` : `${rec.id}: comes out differently from frame ${at} (${result.at} s) on ${engine}` );
process.exit( 0 );
