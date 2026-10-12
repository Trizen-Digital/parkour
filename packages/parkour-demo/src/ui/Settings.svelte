<!-- The settings: a tab per part of the game (src/ui/settings.js), rows stepped with left and right, each tab put
	back to its defaults with Restore Default. -->
<script>
	import { getContext, onMount } from 'svelte';
	import Screen from './Screen.svelte';
	import Row from './Row.svelte';
	import { takeMoves } from './nav.js';
	import { chooseRow, selectable, stepRow } from './rows.js';
	import { settingsTabs } from './settings.js';
	import { ui } from './state.svelte.js';

	const app = getContext( 'app' );
	const tabs = settingsTabs( app );

	const rows = $derived( ( tabs.find( ( tab ) => tab.id === ui.tab ) ?? tabs[ 0 ] ).rows );
	let selected = $state( 0 );
	// The rows' values live in the game: a change bumps this so the rows read them again.
	let version = $state( 0 );

	const first = () => rows.findIndex( selectable );

	function showTab( id ) {

		ui.tab = id;
		selected = first();

	}

	selected = first();

	// After a change, and again once one that takes time (another physics engine, a course generated) is done.
	function changed( result ) {

		version ++;
		if ( result instanceof Promise ) result.then( () => version ++, () => version ++ );

	}

	function move( by ) {

		for ( let i = selected + by; i >= 0 && i < rows.length; i += by ) {

			if ( selectable( rows[ i ] ) ) return selected = i;

		}

	}

	function restore() {

		for ( const row of rows ) {

			if ( row.def !== undefined && row.get() !== row.def ) changed( row.set( row.def ) );

		}

		version ++;

	}

	const back = () => ui.screen = 'pause';

	onMount( () => takeMoves( ( action, { shift } ) => {

		const row = rows[ selected ];
		if ( action === 'up' ) move( - 1 );
		else if ( action === 'down' ) move( 1 );
		else if ( action === 'left' || action === 'right' ) changed( stepRow( row, action === 'left' ? - 1 : 1, shift ) );
		else if ( action === 'select' ) changed( chooseRow( row ) );
		else if ( action === 'previous' || action === 'next' ) {

			const i = tabs.findIndex( ( tab ) => tab.id === ui.tab );
			showTab( tabs[ ( i + ( action === 'previous' ? - 1 : 1 ) + tabs.length ) % tabs.length ].id );

		} else if ( action === 'alt' ) restore();
		else if ( action === 'back' ) back();
		else if ( action === 'start' ) app.qa.resume();
		else return false;
		return true;

	} ) );
</script>

<Screen
	title="Settings"
	tabs={tabs.map( ( { id, name } ) => ( { id, name } ) )}
	tab={ui.tab}
	onTab={showTab}
	prompts={[
		{ key: 'KeyR', pad: 'pad:north', label: 'Restore Default', run: restore },
		{ key: 'Escape', pad: 'pad:east', label: 'Back', run: back },
	]}
>
	{#each rows as row, i ( ui.tab + i )}
		<Row {row} {version} selected={i === selected} onhover={() => selected = i} onchange={changed} />
	{/each}
	{#snippet about()}{rows[ selected ]?.about ?? ''}{/snippet}
</Screen>
