// Boot: the stage, the game and its player, the UI over them (src/ui/), then the render loop. The simulation keeps its
// own fixed step; the loop gives it each frame's time. The loading screen (index.html) stays up until everything is
// in (the sky, the sounds, the course, the Y Bot and its takes, the physics) and the graphics are set: the detector
// times the first frames, which also compile the shaders out of sight.

import './ui/theme.css';
import * as THREE from 'three/webgpu';
import { Stage } from './stage/stage.js';
import { Game } from './app/Game.js';
import { Player } from './app/Player.js';
import { store } from './qa/store.js';
import { mountUi } from './ui/mount.js';
import { setOption, ui } from './ui/state.svelte.js';
import { startMode } from './app/modes.js';
import { applyGraphics, detectTier, tierOf } from './stage/quality.js';

// A frame counts as at most this long (s): after a stall (a background tab) everything goes on from where it was.
const LONGEST_FRAME = 1 / 20;

// The frame rate on the HUD is averaged over this long (s).
const FPS_WINDOW = 0.5;

// About how many steps the load reports (the progress bar's whole): the renderer, the sky and sounds, the course,
// the simulation's five, and the graphics.
const LOAD_STEPS = 10;

const loading = document.getElementById( 'loading' );
const loadingText = document.getElementById( 'loading-text' );
const loadingBar = document.getElementById( 'loading-bar' );

let steps = 0;

// A step of the load: its words on the loading screen, and the bar on by one.
function step( text ) {

	loadingText.textContent = text.replace( /…$/, '' );
	loadingBar.style.width = `${Math.min( 95, ++ steps / LOAD_STEPS * 100 )}%`;

}

async function main() {

	step( 'Starting the renderer…' );
	const stage = await new Stage( document.getElementById( 'app' ) ).init();
	const game = new Game( stage );
	game.progress = step;
	await game.start( ( started ) => Player.create( started ) );
	// Courses loaded later show their own loading (the Game Mode screen).
	game.progress = () => {};

	// Scripts run in the page (the QA console, contact sheets) reach the game here, and three.js through it.
	game.THREE = THREE;
	window.game = game;
	mountUi( { game, player: game.player, qa: game.player.qa } );

	// The menus' footer: the demo's version and the commit it runs.
	store.build().then( ( build ) => ui.build = build ? `${build.version} · ${build.commit}${build.dirty ? '+' : ''}` : '' ).catch( () => {} );

	const timer = new THREE.Timer();
	timer.connect( document );
	let fpsTime = 0, fpsFrames = 0;
	stage.renderer.setAnimationLoop( ( time ) => {

		timer.update( time );
		game.frame( Math.min( timer.getDelta(), LONGEST_FRAME ) );
		stage.render( game.camera );

		fpsTime += timer.getDelta();
		fpsFrames ++;
		if ( fpsTime > FPS_WINDOW ) {

			const backend = stage.renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
			ui.hud.fps = `${Math.round( fpsFrames / fpsTime )} FPS · ${backend}`;
			fpsTime = 0;
			fpsFrames = 0;

		}

	} );

	await setGraphics( game );

	// `?bench=1` opens the benchmark: in `view` (third or first), on the `engine` the page runs on, at `at` seconds, a
	// `station` (its id) or a `comment` (its id).
	const page = new URLSearchParams( location.search );
	// `?replay=<id>` opens a replay from the library in the editor (npm run qa:open -- <zip> --serve links here).
	// The game pauses for the library first, as when a replay is opened from it.
	if ( page.has( 'replay' ) ) {

		game.player.qa.openGallery();
		game.player.qa.openReplay( page.get( 'replay' ) );

	}

	if ( page.get( 'bench' ) === '1' ) {

		const at = page.has( 'at' ) ? Number( page.get( 'at' ) ) : null;
		game.player.qa.openBench( { view: page.get( 'view' ) ?? undefined, at, station: page.get( 'station' ), comment: page.get( 'comment' ) } );

	}

	// `?mode=tutorial|sandbox|bench` plays that mode; the first load ever opens the Game Mode screen.
	startMode( { game, qa: game.player.qa }, page );

	loadingBar.style.width = '100%';
	loading.classList.add( 'done' );
	setTimeout( () => loading.remove(), 400 );

}

// The graphics: Auto times the tiers and keeps the best that holds 60 frames a second (in a hidden tab, where frames
// do not come, the last one found); a tier picked in the settings is set as it is; Custom as the player left it.
async function setGraphics( game ) {

	const { quality, detected } = ui.options;
	if ( quality === 'custom' ) return applyGraphics( game, ui.options );
	let tier = tierOf( quality );
	if ( ! tier ) {

		tier = document.hidden ? tierOf( detected ) ?? tierOf( 'high' ) : await detectTier( game, step );
		setOption( 'detected', tier.id );

	}

	applyGraphics( game, tier );
	setOption( 'renderScale', tier.renderScale );
	setOption( 'ssgi', tier.ssgi );

}

main().catch( ( error ) => {

	console.error( error );
	loading.classList.add( 'failed' );
	loadingText.textContent = `Failed to start · ${error.message}`;

} );
