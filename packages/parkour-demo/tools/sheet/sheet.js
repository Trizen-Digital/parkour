// A contact sheet of poses on the Y Bot, rendered in the running game and posted to the receiver (receiver.mjs).
// In the game's console: `await import( '/tools/sheet/sheet.js' )`, then `await __sheet( { cells } )`.
//
// A cell is `[ take, time ]` (a take's frame), or `{ recipe, at, yaw, settle }`: any pose recipe with the figure at
// `at` (the runner's centre, on the course loaded) turned to `yaw`, stepped for `settle` seconds first so that a
// `feet` recipe has put the feet on the course's ground (the figure keeps its foot placement from cell to cell).
// The camera looks at each cell's figure from `side` (relative to it).
import { PORT } from './port.js';

const STEP = 1 / 120;

window.__sheet = async function ( { cells, cols = 6, w = 320, h = 320, at = [ 0, 1.5, 0 ], side = [ 3.2, 0.2, 0.6 ], lookAt = [ 0, - 0.15, 0 ], fov = 45, frames = 6, name = 'sheet', port = PORT } ) {

	const THREE = window.game.THREE;
	// Cell widths a multiple of 64: rows of the read-back pixels are padded to 256 bytes.
	w = Math.ceil( w / 64 ) * 64;
	const stage = window.game.stage, renderer = stage.renderer, camera = window.game.camera;
	const player = window.game.player, figure = player.sim.figure;
	player.frame = () => {};
	renderer.setAnimationLoop( null );
	renderer.setSize( w, h );
	for ( const resize of stage.onResize ) resize();

	const rows = Math.ceil( cells.length / cols );
	const sheet = new Uint8Array( cols * w * rows * h * 4 );
	const target = new THREE.RenderTarget( w, h );

	for ( let i = 0; i < cells.length; i ++ ) {

		const cell = Array.isArray( cells[ i ] ) ? { recipe: { kind: 'clip', take: cells[ i ][ 0 ], time: cells[ i ][ 1 ] } } : cells[ i ];
		const centre = new THREE.Vector3().fromArray( cell.at ?? at );
		const steps = Math.max( 1, Math.round( ( cell.settle ?? 0 ) / STEP ) );
		for ( let step = 0; step < steps; step ++ ) figure.step( STEP, cell.recipe, centre, cell.yaw ?? 0 );
		figure.root.updateMatrixWorld( true );

		camera.position.copy( centre ).add( new THREE.Vector3().fromArray( side ) );
		camera.lookAt( centre.clone().add( new THREE.Vector3().fromArray( lookAt ) ) );
		camera.fov = fov;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setOutputRenderTarget( target );
		renderer.setRenderTarget( target );
		// A few frames, so shadows and the post passes have caught up with the new pose.
		for ( let f = 0; f < frames; f ++ ) {

			renderer._nodes.nodeFrame.update();
			stage.render( camera );
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

		}

		const pixels = await renderer.readRenderTargetPixelsAsync( target, 0, 0, w, h );
		const x = i % cols, y = Math.floor( i / cols );
		for ( let row = 0; row < h; row ++ ) sheet.set( pixels.subarray( row * w * 4, ( row + 1 ) * w * 4 ), ( ( y * h + row ) * cols * w + x * w ) * 4 );

	}

	renderer.setOutputRenderTarget( null );
	renderer.setRenderTarget( null );
	await fetch( `http://127.0.0.1:${port}/${name}?w=${cols * w}&h=${rows * h}`, { method: 'POST', body: sheet } );
	return { name, cells: cells.length };

};
