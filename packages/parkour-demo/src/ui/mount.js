// Puts the Svelte UI (src/ui/App.svelte) on the page, over the game, once the game and its player exist.

import { mount } from 'svelte';
import App from './App.svelte';

/**
 * @param {{game: Game, player: Player, qa: QA}} app
 */
function mountUi( app ) {

	return mount( App, { target: document.getElementById( 'ui' ), props: { app } } );

}

export { mountUi };
