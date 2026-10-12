<!-- The pause menu: the hub between the run, the game modes, the replays and the settings. The benchmark is a game
	mode (and K opens it from play). -->
<script>
	import { getContext, onMount } from 'svelte';
	import Screen from './Screen.svelte';
	import Row from './Row.svelte';
	import { takeMoves } from './nav.js';
	import { ui } from './state.svelte.js';

	const { qa, player } = getContext( 'app' );

	const settings = ( tab ) => {

		ui.tab = tab;
		ui.screen = 'settings';

	};

	const items = [
		{ kind: 'action', label: 'Resume', about: 'Continue the run.', run: () => qa.resume() },
		{ kind: 'action', label: 'Restart', about: player.tutorial.active ? 'Back to the lesson\'s flag.' : 'Start the course again.', run: () => qa.restart() },
		{ kind: 'action', label: 'Game Mode', about: 'The tutorial, the sandbox\'s courses, or the benchmark.', run: () => {

			ui.modeBack = 'pause';
			ui.screen = 'mode';

		} },
		{ kind: 'action', label: 'Replays', about: 'Your saved captures.', run: () => qa.openGallery() },
		{ kind: 'action', label: 'Settings', about: 'Change game options.', run: () => settings( 'game' ) },
		{ kind: 'action', label: 'Controls', about: 'See the keys and buttons.', run: () => settings( 'controls' ) },
	];

	// The item last chosen, selected again on the way back from a screen it opened (ui.menuItem, which opening the
	// menu from play puts back on Resume).
	let selected = $state( ui.menuItem );

	function choose( i ) {

		ui.menuItem = selected = i;
		items[ i ].run();

	}

	onMount( () => takeMoves( ( move ) => {

		if ( move === 'up' || move === 'down' ) selected = ( selected + ( move === 'up' ? - 1 : 1 ) + items.length ) % items.length;
		else if ( move === 'select' ) choose( selected );
		else if ( move === 'back' || move === 'start' ) qa.resume();
		else return false;
		return true;

	} ) );
</script>

<Screen
	title="Paused"
	prompts={[
		{ key: 'Enter', pad: 'pad:south', label: 'Select', run: () => choose( selected ) },
		{ key: 'Escape', pad: 'pad:east', label: 'Resume', run: () => qa.resume() },
	]}
>
	{#each items as item, i ( item.label )}
		<Row row={item} selected={i === selected} onhover={() => selected = i} onchange={() => ui.menuItem = i} />
	{/each}
	{#snippet about()}{items[ selected ].about}{/snippet}
</Screen>
