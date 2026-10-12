<!-- The replay editor (src/qa/Editor.js) over the replay: the title top left, the details and notes on the right, the
	transport and the timeline along the bottom. -->
<script>
	import { getContext, tick } from 'svelte';
	import Loading from './Loading.svelte';
	import Prompts from './Prompts.svelte';
	import { place } from './place.js';

	const { qa } = getContext( 'app' );
	const editor = qa.editor, view = editor.view;

	const categories = $derived( [ { id: null, name: 'None' }, ...view.categories ] );
	const categoryIndex = $derived( Math.max( 0, categories.findIndex( ( c ) => c.id === view.category ) ) );
	let note = $state( '' );

	const stepCategory = ( by ) => editor.pickCategory( categories[ Math.max( 0, Math.min( categories.length - 1, categoryIndex + by ) ) ].id );

	function addNote() {

		editor.addNote( note );
		note = '';

	}

	// A capture opens with its title to fill in.
	function focusTitle( node ) {

		if ( view.kind === 'capture' ) tick().then( () => node.focus() );

	}
</script>

{#if view.mode === 'loading'}
	<Loading text={view.loadingText} progress={view.progress} />
{:else if view.mode === 'edit'}
	<div class="editor">
		<header class="top">
			<span class="kind" class:capture={view.kind === 'capture'}>{view.kind === 'capture' ? 'Capture' : 'Replay'}</span>
			<input
				class="title"
				value={view.title}
				placeholder="Title"
				spellcheck="true"
				oninput={( e ) => editor.edit( { title: view.title = e.target.value } )}
				use:focusTitle
			/>
		</header>

		<aside class="side">
			<div class="carousel">
				<span class="label">Category</span>
				<span class="value">
					<button type="button" class:off={categoryIndex === 0} onclick={() => stepCategory( - 1 )} aria-label="Previous"><svg viewBox="0 0 10 12"><path d="M9 0.5 V11.5 L0.5 6 Z" /></svg></button>
					<span>{categories[ categoryIndex ].name}</span>
					<button type="button" class:off={categoryIndex === categories.length - 1} onclick={() => stepCategory( 1 )} aria-label="Next"><svg viewBox="0 0 10 12"><path d="M1 0.5 V11.5 L9.5 6 Z" /></svg></button>
				</span>
			</div>
			<textarea class="field" rows="2" placeholder="Description" value={view.description} oninput={( e ) => editor.edit( { description: view.description = e.target.value } )}></textarea>

			<dl>
				{#each view.details as [ name, value ] ( name )}<dt>{name}</dt><dd>{value}</dd>{/each}
				{#if view.check}
					<dt>Check</dt><dd class:good={view.check.ok} class:bad={! view.check.ok}>{view.check.text}</dd>
					{#if view.check.cause}<dt>Cause</dt><dd class="bad">{view.check.cause}</dd>{/if}
				{/if}
			</dl>

			<h3 class="label">Notes</h3>
			<ol class="notes">
				{#each view.notes as n ( n.id )}
					<li class:out={n.out}>
						<button type="button" class="time mono" onclick={() => editor.seek( n.f )}>{n.time}</button>
						<div class="text" contenteditable="plaintext-only" role="textbox" tabindex="0" onblur={( e ) => editor.editNote( n.id, e.currentTarget.textContent )}>{n.text}</div>
						<button type="button" class="remove" onclick={() => editor.removeNote( n.id )} aria-label="Delete note">✕</button>
					</li>
				{/each}
			</ol>
			<input
				class="field note-add"
				bind:value={note}
				placeholder="Note at {view.noteAt} s"
				onkeydown={( e ) => {

					if ( e.key === 'Enter' ) addNote();

				}}
			/>

			<footer>
				{#if view.kind === 'capture'}
					<button type="button" class="btn" onclick={() => editor.discard()}>Discard</button>
					<span class="spacer"></span>
					<button type="button" class="btn primary" onclick={() => editor.save()}>Save</button>
				{:else}
					<button type="button" class="btn" onclick={() => qa.openGallery()}>Replays</button>
					<button type="button" class="btn" onclick={() => editor.share()}>Share</button>
					<span class="spacer"></span>
					<span class="saved">{view.saved}</span>
				{/if}
			</footer>
		</aside>

		<section class="bar">
			<div class="controls">
				<button type="button" class="btn icon" onclick={() => editor.toggle()} title="Play (Space)">
					{#if view.playing}<svg viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" /></svg>{:else}<svg viewBox="0 0 12 12"><path d="M2.5 1 L11 6 L2.5 11 Z" /></svg>{/if}
				</button>
				<button type="button" class="btn icon" onclick={() => editor.seek( editor.frame - 1 )} title="Previous frame (←)">‹</button>
				<button type="button" class="btn icon" onclick={() => editor.seek( editor.frame + 1 )} title="Next frame (→)">›</button>
				<div class="seg">
					{#each editor.speeds as speed ( speed )}<button type="button" class:on={view.speed === speed} onclick={() => editor.setSpeed( speed )}>{speed}×</button>{/each}
				</div>
				<span class="time mono">{view.time} <span>/ {view.total}</span></span>
				<span class="frame mono">F {view.frame}</span>
				<span class="readout mono">{view.readout}</span>
				<span class="spacer"></span>
				<button type="button" class="btn" class:on={view.orbit} onclick={() => editor.setOrbit( ! view.orbit )}>Orbit</button>
				<button type="button" class="btn" class:on={view.path} onclick={() => editor.showPath( ! view.path )}>Path</button>
				<button type="button" class="btn primary" onclick={() => editor.takeOver()}>Play From Here</button>
			</div>
			<div class="canvas" use:place={editor.canvas}></div>
			<Prompts prompts={[
				{ key: 'Space', label: 'Play', run: () => editor.toggle() },
				{ key: [ 'ArrowLeft', 'ArrowRight' ], label: 'Frame' },
				{ key: [ 'KeyI', 'KeyO' ], label: 'Trim' },
				{ key: 'KeyN', label: 'Note', run: () => document.querySelector( '.note-add' )?.focus() },
				{ key: 'Escape', label: view.kind === 'capture' ? 'Discard' : 'Back', run: () => editor.leave() },
			]} />
		</section>
	</div>
{/if}

<style>
	.editor {
		position: fixed;
		inset: 0;
		font-size: clamp(12px, 0.8vw, 15px);
		pointer-events: none;
	}

	.editor > * {
		pointer-events: auto;
	}

	.top {
		position: absolute;
		left: 1.6em;
		top: 1.5em;
		right: 26em;
		display: flex;
		align-items: center;
		gap: 0.9em;
	}

	.kind {
		padding: 0.35em 0.6em;
		background: rgba(255, 255, 255, 0.12);
		font-weight: 700;
		font-size: 0.85em;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.kind.capture {
		background: #d8402f;
	}

	.title {
		flex: 1;
		min-width: 0;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--text);
		font: 700 2em/1.2 var(--font);
		outline: none;
		text-shadow: 0 1px 8px rgba(0, 0, 0, 0.5);
	}

	.title:focus {
		border-bottom-color: var(--accent);
	}

	.title::placeholder {
		color: rgba(255, 255, 255, 0.45);
	}

	.side {
		position: absolute;
		right: 1.6em;
		top: 1.5em;
		bottom: 1.4em;
		width: 23em;
		display: flex;
		flex-direction: column;
		gap: 0.8em;
		padding: 1em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		overflow-y: auto;
	}

	.carousel {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 1em;
		padding: 0 0.2em 0 0.65em;
		height: 2.3em;
		background: rgba(255, 255, 255, 0.05);
	}

	.carousel .value {
		display: grid;
		grid-template-columns: 1.6em 1fr 1.6em;
		align-items: center;
		text-align: center;
		font-weight: 600;
		text-transform: uppercase;
	}

	.carousel button {
		appearance: none;
		border: 0;
		background: none;
		color: var(--text);
		cursor: pointer;
		padding: 0.4em;
	}

	.carousel button.off {
		visibility: hidden;
	}

	.carousel svg {
		width: 0.6em;
		height: 0.72em;
		fill: currentColor;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.3em 1em;
		margin: 0.2em 0;
		font-size: 0.92em;
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
		text-align: right;
		overflow-wrap: anywhere;
	}

	.good {
		color: var(--good);
	}

	.bad {
		color: var(--warn);
	}

	h3 {
		margin: 0.4em 0 0;
	}

	.notes {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3em;
	}

	.notes li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: start;
		gap: 0.6em;
		padding: 0.45em 0.5em;
		background: rgba(255, 255, 255, 0.05);
	}

	.notes li.out {
		opacity: 0.5;
	}

	.notes .time,
	.notes .remove {
		appearance: none;
		border: 0;
		background: none;
		padding: 0;
		cursor: pointer;
		color: var(--accent);
		font-size: 0.9em;
	}

	.notes .remove {
		color: var(--faint);
	}

	.notes .remove:hover {
		color: var(--text);
	}

	.notes .text {
		outline: none;
		overflow-wrap: anywhere;
	}

	footer {
		display: flex;
		align-items: center;
		gap: 0.5em;
		margin-top: auto;
		padding-top: 0.4em;
	}

	.spacer {
		flex: 1;
	}

	.saved {
		color: var(--muted);
		font-weight: 600;
	}

	.bar {
		position: absolute;
		left: 1.6em;
		right: 26.2em;
		bottom: 1.4em;
		display: flex;
		flex-direction: column;
		gap: 0.7em;
		padding: 0.8em 1em 0.9em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.5em;
		min-width: 0;
	}

	.btn svg {
		width: 0.85em;
		height: 0.85em;
		fill: currentColor;
	}

	.time {
		margin-left: 0.6em;
		font-size: 1.05em;
		white-space: nowrap;
	}

	.time span,
	.frame {
		color: var(--muted);
	}

	.readout {
		margin-left: 0.4em;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex: 0 1 auto;
	}

	.canvas :global(canvas) {
		display: block;
		width: 100%;
		cursor: crosshair;
	}

	.bar :global(.prompts) {
		font-size: 0.92em;
	}
</style>
