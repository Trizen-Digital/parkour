// Renders one frame from a given camera in the running game and posts it to the receiver (receiver.mjs). In the
// game's console: `await import( '/tools/sheet/shot.js' )`, then
// `await __shot( { stage, camera, pos, quat, fov, name } )`; `hide` lists objects to leave out of the frame.
import { PORT } from './port.js';

window.__shot = async function ( { stage, camera, hide = [], pos, quat, fov, frames = 24, w = 1280, h = 720, name, port = PORT } ) {

	const THREE = window.harness?.THREE ?? window.game?.THREE;
	const renderer = stage.renderer;
	renderer.setAnimationLoop( null );
	for ( const object of hide ) if ( object ) object.visible = false;
	renderer.setSize( w, h );
	for ( const resize of stage.onResize ) resize();
	const place = () => {

		camera.position.fromArray( pos );
		camera.quaternion.fromArray( quat );
		camera.fov = fov;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld( true );

	};

	const target = new THREE.RenderTarget( w, h );
	renderer.setOutputRenderTarget( target );
	renderer.setRenderTarget( target );
	// Enough frames for the exposure and the temporal passes to settle.
	for ( let i = 0; i < frames; i ++ ) {

		place();
		renderer._nodes.nodeFrame.update();
		stage.render( camera );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

	}

	const pixels = await renderer.readRenderTargetPixelsAsync( target, 0, 0, w, h );
	renderer.setOutputRenderTarget( null );
	renderer.setRenderTarget( null );
	await fetch( `http://127.0.0.1:${port}/${name}?w=${w}&h=${h}`, { method: 'POST', body: pixels } );
	return { name, bytes: pixels.length };

};
