import { fileURLToPath } from 'node:url';
import base from './vite.config.js';

export default ( env ) => {

	const config = base( env );

	return {
		...config,
		cacheDir: fileURLToPath( new URL( './node_modules/.vite-nohmr', import.meta.url ) ),
		server: { ...config.server, port: Number( process.env.PORT ) || 5411, strictPort: true, hmr: false },
	};

};
