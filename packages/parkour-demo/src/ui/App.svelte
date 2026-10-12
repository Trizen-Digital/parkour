<!-- The page's UI over the game: the HUD, the touch controls, whichever menu screen is open (ui.screen), the replay
	editor and the benchmark. The game, the player and the QA tools reach every component through the 'app' context. -->
<script>
	import { setContext } from 'svelte';
	import Hud from './Hud.svelte';
	import TouchControls from './TouchControls.svelte';
	import Pause from './Pause.svelte';
	import Settings from './Settings.svelte';
	import GameMode from './GameMode.svelte';
	import Replays from './Replays.svelte';
	import Editor from './Editor.svelte';
	import Bench from './Bench.svelte';
	import { ui } from './state.svelte.js';

	/** @type {{app: {game: Game, player: Player, qa: QA}}} */
	let { app } = $props();
	// The game, the player and the QA tools are made once, before the UI: the first value is the only one.
	// svelte-ignore state_referenced_locally
	setContext( 'app', app );
</script>

<Hud />
<TouchControls />
{#if ui.screen === 'pause'}
	<Pause />
{:else if ui.screen === 'settings'}
	<Settings />
{:else if ui.screen === 'mode'}
	<GameMode />
{:else if ui.screen === 'replays'}
	<Replays />
{/if}
<Editor />
<Bench />
