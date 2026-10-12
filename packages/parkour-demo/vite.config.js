import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, normalizePath } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { qaStore } from './tools/qa-store.js';
import { buildInfo } from './tools/build-info.mjs';

function courses() {

	const dir = normalizePath( fileURLToPath( new URL( './public/courses/', import.meta.url ) ) );
	const list = () => readdirSync( dir ).filter( ( f ) => f.endsWith( '.json' ) && f !== 'index.json' ).map( ( f ) => f.slice( 0, - 5 ) ).sort();

	return {
		name: 'courses',
		configureServer( server ) {

			server.middlewares.use( `${server.config.base}courses/index.json`, ( req, res ) => {

				res.setHeader( 'Content-Type', 'application/json' );
				res.setHeader( 'Cache-Control', 'no-store' );
				res.end( JSON.stringify( list() ) );

			} );

		},
		hotUpdate( { file, type } ) {

			if ( ! normalizePath( file ).startsWith( dir ) || ! file.endsWith( '.json' ) ) return;
			if ( this.environment.name === 'client' ) this.environment.hot.send( { type: 'custom', event: 'game:course', data: { name: basename( file, '.json' ), type } } );
			return [];

		},
		generateBundle() {

			this.emitFile( { type: 'asset', fileName: 'courses/index.json', source: JSON.stringify( list() ) } );

		},
	};

}

// What a built page runs (tools/build-info.mjs), baked in as __PARKOUR_BUILD__ so its replays can say: `hosted` for
// parkour.trizen.dev (`vite build`), `installed` for the npm package (`vite build --mode package`). The dev server's
// replays ask the QA store instead, live from git; there it is null.
function bakedBuild( how ) {

	const build = buildInfo( { how } );

	return {
		name: 'baked-build',
		config: () => ( { define: { __PARKOUR_BUILD__: JSON.stringify( build ) } } ),
		// The installed demo's server reads it too (bin/parkour-demo.mjs).
		generateBundle() {

			if ( how === 'installed' ) this.emitFile( { type: 'asset', fileName: 'build.json', source: JSON.stringify( build, null, '\t' ) } );

		},
	};

}

export default defineConfig( ( { command, mode } ) => ( {
	// The package's build (app/) is not the page's source: writing it reloads nothing.
	server: { port: Number( process.env.PORT ) || 5410, strictPort: true, watch: { ignored: [ normalizePath( fileURLToPath( new URL( './app/', import.meta.url ) ) ) + '**' ] } },
	preview: { port: 5413, strictPort: true },
	// The package's build leaves public/ out: the npm package carries public/ itself, and the installed demo's server
	// serves the two side by side (bin/parkour-demo.mjs), so the takes are not in the package twice.
	build: mode === 'package'
		? { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: 'app', copyPublicDir: false }
		: { target: 'es2022', chunkSizeWarningLimit: 2000 },
	define: command === 'serve' ? { __PARKOUR_BUILD__: 'null' } : {},
	resolve: { alias: [ { find: /^three$/, replacement: 'three/webgpu' } ] },
	// The physics engines' backends load their engines when a run asks for one (each backend package's index.js), which
	// the dependency scan cannot follow: those packages are bundled ahead, so loading an engine does not make the page
	// reload.
	optimizeDeps: { include: [ '@dimforge/rapier3d-compat', 'box3d.js/inline' ] },
	// The UI over the game is Svelte (src/ui/).
	plugins: [ svelte( { configFile: false } ), courses(), qaStore(), ...( command === 'build' ? [ bakedBuild( mode === 'package' ? 'installed' : 'hosted' ) ] : [] ) ],
} ) );
