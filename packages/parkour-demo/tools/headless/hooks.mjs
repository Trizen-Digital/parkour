// Module resolution for headless runs: `three` is `three/webgpu`, as the page's bundler resolves it, so the game and
// three.js's addons share one copy of three.js.

export async function resolve( specifier, context, next ) {

	if ( specifier === 'three' ) return next( 'three/webgpu', context );
	return next( specifier, context );

}
