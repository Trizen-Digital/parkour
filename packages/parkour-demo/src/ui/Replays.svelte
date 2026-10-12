<!-- The replay library (src/qa/Gallery.js): a tab per category, the replays in it as rows, the selected one's still
	and details beside them. Left and right move a replay to the category before or after; dragging one onto a tab files
	it there. A shared .qa.zip dropped anywhere opens it. -->
<script>
	import { getContext, onMount } from 'svelte';
	import Screen from './Screen.svelte';
	import Row from './Row.svelte';
	import { takeMoves } from './nav.js';
	import { store } from '../qa/store.js';

	const { qa } = getContext( 'app' );
	const gallery = qa.gallery, view = gallery.view;

	// Where a replay is kept.
	const SOURCES = { curated: 'Curated', local: 'Yours', incoming: 'Shared' };

	const tabs = $derived( [ { id: '', name: 'Inbox' }, ...view.categories.map( ( { id, name } ) => ( { id, name } ) ) ] );
	const category = $derived( view.categories.find( ( c ) => c.id === view.tab ) ?? null );
	const listed = $derived( gallery.listed( view.tab ) );
	let selected = $state( 0 );
	const replay = $derived( listed[ Math.min( selected, listed.length - 1 ) ] ?? null );
	const promotable = $derived( store.kind === 'files' && replay && replay.place !== 'curated' );

	// Renaming or describing the category on show: which, and the text being written.
	let editing = $state( null ), text = $state( '' ), file = $state();

	const when = ( iso ) => {

		const date = new Date( iso );
		return isNaN( date ) ? '' : date.toLocaleString( undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } );

	};

	function check( r ) {

		const result = r.checked ?? r.verified;
		if ( ! result ) return null;
		return result.ok ? { ok: true, text: 'Exact' } : { ok: false, text: `Differs at ${result.at} s` };

	}

	const rowOf = ( r ) => ( {
		kind: 'action',
		label: r.title || 'Untitled',
		value: () => `${r.course} · ${( r.duration ?? 0 ).toFixed( 1 )} s`,
		run: () => qa.openReplay( r.id ),
	} );

	function showTab( id ) {

		view.tab = id;
		selected = 0;
		editing = null;

	}

	// The selected replay into the category before or after this one.
	function move( by ) {

		if ( ! replay ) return;
		const ids = tabs.map( ( t ) => t.id ), to = ids[ ids.indexOf( view.tab ) + by ];
		if ( to === undefined ) return;
		gallery.file( replay.id, to || null );
		selected = Math.max( 0, Math.min( selected, listed.length - 2 ) );

	}

	async function remove() {

		if ( replay && await gallery.remove( replay ) ) selected = Math.max( 0, Math.min( selected, listed.length - 1 ) );

	}

	async function addCategory() {

		const made = await gallery.addCategory();
		showTab( made.id );
		edit( 'name' );

	}

	function edit( what ) {

		if ( ! category ) return;
		editing = what;
		text = what === 'name' ? category.name : category.description ?? '';

	}

	function finish( keep ) {

		if ( ! editing ) return;
		if ( keep && category ) gallery.editCategory( category.id, editing === 'name' ? { name: text.trim() || category.name } : { description: text.trim() } );
		editing = null;

	}

	function field( node ) {

		node.focus();
		node.select?.();

	}

	function drop( event ) {

		const [ dropped ] = event.dataTransfer.files ?? [];
		if ( ! dropped ) return;
		event.preventDefault();
		gallery.openShared( dropped );

	}

	const back = () => qa.closeGallery();

	onMount( () => takeMoves( ( action, { code } ) => {

		if ( action === 'up' || action === 'down' ) {

			if ( listed.length ) selected = ( selected + ( action === 'up' ? - 1 : 1 ) + listed.length ) % listed.length;

		} else if ( action === 'left' || action === 'right' ) move( action === 'left' ? - 1 : 1 );
		else if ( action === 'previous' || action === 'next' ) {

			const i = tabs.findIndex( ( t ) => t.id === view.tab );
			showTab( tabs[ ( i + ( action === 'previous' ? - 1 : 1 ) + tabs.length ) % tabs.length ].id );

		} else if ( action === 'select' ) replay && qa.openReplay( replay.id );
		else if ( action === 'alt' || code === 'KeyF' ) replay && gallery.share( replay );
		else if ( action === 'x' || code === 'KeyX' ) remove();
		else if ( code === 'KeyP' ) promotable && gallery.promote( replay );
		else if ( code === 'KeyN' ) addCategory();
		else if ( code === 'KeyO' ) file.click();
		else if ( action === 'back' ) back();
		else return false;
		return true;

	} ) );
</script>

<div class="drop" ondragover={( e ) => e.dataTransfer.types.includes( 'Files' ) && e.preventDefault()} ondrop={drop} role="presentation">
	<Screen
		title="Replays"
		{tabs}
		tab={view.tab}
		onTab={showTab}
		onDropTab={( id, event ) => {

			const dragged = event.dataTransfer.getData( 'text/qa-replay' );
			if ( dragged ) gallery.file( dragged, id || null );

		}}
		side="panel"
		prompts={[
			{ key: 'Enter', pad: 'pad:south', label: 'Open', run: () => replay && qa.openReplay( replay.id ) },
			{ key: [ 'ArrowLeft', 'ArrowRight' ], pad: 'pad:left', label: 'Move', run: () => move( 1 ) },
			{ key: 'KeyF', pad: 'pad:north', label: 'Share', run: () => replay && gallery.share( replay ) },
			...( promotable ? [ { key: 'KeyP', label: 'Promote', run: () => gallery.promote( replay ) } ] : [] ),
			{ key: 'KeyX', pad: 'pad:west', label: 'Delete', run: remove },
			{ key: 'Escape', pad: 'pad:east', label: 'Back', run: back },
		]}
	>
		{#snippet header()}
			<div class="category">
				{#if editing}
					<input
						class="field"
						bind:value={text}
						placeholder={editing === 'name' ? 'Name' : 'Description'}
						use:field
						onkeydown={( e ) => {

							e.stopPropagation();
							if ( e.key === 'Enter' ) finish( true );
							if ( e.key === 'Escape' ) finish( false );

						}}
						onblur={() => finish( true )}
					/>
				{:else if category}
					<button type="button" class="text" class:empty={! category.description} onclick={() => edit( 'description' )}>{category.description || 'Add a description'}</button>
					<button type="button" class="link" onclick={() => edit( 'name' )}>Rename</button>
					<button type="button" class="link" onclick={() => gallery.deleteCategory( category.id )}>Delete</button>
				{/if}
				<span class="spacer"></span>
				<button type="button" class="link" onclick={addCategory} title="N">New Category</button>
				<button type="button" class="link" onclick={() => file.click()} title="O">Open File</button>
				<input class="field search" type="search" placeholder="Search" bind:value={view.filter} />
				<input type="file" accept=".zip,application/zip" hidden bind:this={file} onchange={( e ) => {

					const [ picked ] = e.target.files;
					e.target.value = '';
					if ( picked ) gallery.openShared( picked );

				}} />
			</div>
		{/snippet}

		{#if view.loading}
			<p class="empty">Loading</p>
		{:else if view.error}
			<p class="empty">{view.error}</p>
		{:else if ! listed.length}
			<p class="empty">No replays</p>
		{:else}
			{#each listed as r, i ( r.id )}
				{@const result = check( r )}
				<div draggable="true" ondragstart={( e ) => e.dataTransfer.setData( 'text/qa-replay', r.id )} role="listitem">
					<Row row={rowOf( r )} selected={i === selected} onhover={() => selected = i}>
						{#if result}<b class="mark" class:bad={! result.ok}>{result.ok ? '✓' : '!'}</b>{/if}
					</Row>
				</div>
			{/each}
		{/if}

		{#snippet about()}
			{#if replay}
				{@const result = check( replay )}
				<div class="detail">
					<div class="still" style:background-image={replay.thumb ? `url('${store.fileUrl( replay.thumb, replay.updated ?? '' )}')` : null}></div>
					<h2>{replay.title || 'Untitled'}</h2>
					{#if replay.notes?.[ 0 ]?.text || replay.description}<p>{replay.notes?.[ 0 ]?.text ?? replay.description}</p>{/if}
					<dl>
						<dt>Course</dt><dd>{replay.course}{replay.lane !== null && replay.lane !== undefined ? ` · Lane ${replay.lane + 1}` : ''}</dd>
						<dt>Length</dt><dd>{( replay.duration ?? 0 ).toFixed( 1 )} s</dd>
						<dt>Recorded</dt><dd>{when( replay.created )}</dd>
						<dt>Notes</dt><dd>{replay.notes?.length ?? 0}</dd>
						<dt>Source</dt><dd>{SOURCES[ replay.place ] ?? SOURCES.local}</dd>
						{#if result}<dt>Check</dt><dd class:good={result.ok} class:bad={! result.ok}>{result.text}</dd>{/if}
					</dl>
				</div>
			{/if}
		{/snippet}
	</Screen>
</div>

<style>
	.drop {
		display: contents;
	}

	.category {
		display: flex;
		align-items: center;
		gap: 1em;
		min-height: 2.2em;
		margin: -0.5em 0 1em;
		max-width: 53.9em;
	}

	.category .field {
		max-width: 28em;
	}

	.category .search {
		width: 14em;
	}

	.text,
	.link {
		appearance: none;
		border: 0;
		background: none;
		padding: 0;
		color: var(--muted);
		font: 600 1em/1.3 var(--font);
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.text.empty {
		color: var(--faint);
	}

	.link {
		color: var(--faint);
		font-size: 0.85em;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.text:hover,
	.link:hover {
		color: var(--accent);
	}

	.spacer {
		flex: 1;
	}

	.empty {
		margin: 0.4em 0.1em;
		color: var(--muted);
		font-weight: 600;
	}

	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.2em;
		height: 1.2em;
		border-radius: 50%;
		background: var(--good);
		color: #0b0d10;
		font-size: 0.75em;
		font-weight: 700;
	}

	.mark.bad {
		background: var(--warn);
	}

	.detail {
		background: var(--panel);
		padding: 1em;
		max-width: 30em;
	}

	.still {
		aspect-ratio: 16 / 9;
		background: rgba(255, 255, 255, 0.05) center / cover no-repeat;
		margin-bottom: 0.9em;
	}

	h2 {
		margin: 0 0 0.4em;
		font-size: 1.35em;
		font-weight: 700;
		line-height: 1.2;
	}

	p {
		margin: 0 0 0.9em;
		color: var(--muted);
		font-weight: 500;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.35em 1.2em;
		margin: 0;
		font-size: 0.92em;
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
		text-align: right;
	}

	.good {
		color: var(--good);
	}

	.bad {
		color: var(--warn);
	}
</style>
