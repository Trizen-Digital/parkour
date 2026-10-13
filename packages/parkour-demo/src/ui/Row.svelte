<!-- One menu row: its name, and its value between arrows that show only where the value can go (src/ui/rows.js).
	A number also has a bar to drag; a binding shows its glyphs; a header names the rows under it. -->
<script>
	import Binding from './Binding.svelte';
	import { canStep, chooseRow, fractionOf, setFraction, stepRow, valueText } from './rows.js';

	/**
	 * @type {{
	 *   row: object,
	 *   selected?: boolean,
	 *   version?: number,
	 *   onhover?: () => void,
	 *   onchange?: (result: any) => void,
	 *   children?: import('svelte').Snippet,
	 * }}
	 */
	let { row, selected = false, version = 0, onhover = () => {}, onchange = () => {}, children } = $props();

	// The values live in the game, not in Svelte: `version` says when to read them again.
	const text = $derived.by( () => ( version, valueText( row ) ) );
	const left = $derived.by( () => ( version, canStep( row, - 1 ) ) );
	const right = $derived.by( () => ( version, canStep( row, 1 ) ) );
	const fill = $derived.by( () => ( version, row.kind === 'number' ? fractionOf( row ) : 0 ) );
	const stepping = $derived( row.kind === 'toggle' || row.kind === 'choice' || row.kind === 'number' );

	let element = $state();
	$effect( () => {

		if ( selected ) element?.scrollIntoView( { block: 'nearest' } );

	} );

	function step( event, by ) {

		event.stopPropagation();
		onchange( stepRow( row, by, event.shiftKey ) );

	}

	// The row is selected when it is pressed, by any pointer, and when the mouse moves over it. A finger has no hover:
	// the mouse events a browser makes up from a tap are not taken as one (on an iPhone a change made on them can eat
	// the tap).
	const hover = ( event ) => event.pointerType === 'mouse' && onhover();

	// Dragging a number's value sets it from where the pointer is along it.
	function drag( event ) {

		if ( row.kind !== 'number' ) return;
		onhover();
		event.stopPropagation();
		const box = event.currentTarget, rect = box.getBoundingClientRect();
		const move = ( e ) => onchange( setFraction( row, ( e.clientX - rect.left ) / rect.width ) );
		move( event );
		box.setPointerCapture( event.pointerId );
		box.onpointermove = move;
		box.onpointerup = () => box.onpointermove = box.onpointerup = null;

	}
</script>

{#if row.kind === 'header'}
	<h3>{row.label}</h3>
{:else}
	<div
		class="row"
		class:selected
		bind:this={element}
		onpointerdown={onhover}
		onpointermove={hover}
		onclick={() => onchange( chooseRow( row ) )}
		onkeydown={() => {}}
		role="button"
		tabindex="-1"
	>
		<span class="name">{row.label}{@render children?.()}</span>
		{#if row.kind === 'binding'}
			<span class="value binding"><Binding tokens={row.tokens} /></span>
		{:else if stepping}
			<span class="value" class:upper={row.kind !== 'number'}>
				<button type="button" class="arrow" class:off={! left} onclick={( e ) => step( e, - 1 )} tabindex="-1" aria-label="Previous">
					<svg viewBox="0 0 10 12"><path d="M9 0.5 V11.5 L0.5 6 Z" /></svg>
				</button>
				<span class="text" class:number={row.kind === 'number'} onpointerdown={drag} role="presentation">
					{text}
					{#if row.kind === 'number'}<i style:width="{fill * 100}%"></i>{/if}
				</span>
				<button type="button" class="arrow" class:off={! right} onclick={( e ) => step( e, 1 )} tabindex="-1" aria-label="Next">
					<svg viewBox="0 0 10 12"><path d="M1 0.5 V11.5 L9.5 6 Z" /></svg>
				</button>
			</span>
		{:else}
			<span class="value plain">{text}</span>
		{/if}
	</div>
{/if}

<style>
	h3 {
		margin: 1.35em 0 0.55em 0.1em;
		font-size: 0.8em;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h3:first-child {
		margin-top: 0.2em;
	}

	.row {
		display: grid;
		grid-template-columns: 62.4% minmax(0, 1fr);
		align-items: center;
		height: 2.1em;
		margin-bottom: 0.42em;
		padding: 0 0.9em;
		background: var(--row);
		font-weight: 600;
		cursor: pointer;
		outline: none;
	}

	.row.selected {
		background: var(--accent);
	}

	/* On touch (src/ui/Screen.svelte says so), the row and its arrows big enough to tap: 44 px, as phones advise. */
	:global(.screen.touch) .row {
		height: max(2.1em, 44px);
	}

	:global(.screen.touch) .value {
		grid-template-columns: max(1.3em, 44px) minmax(0, 1fr) max(1.3em, 44px);
	}

	.name {
		display: flex;
		align-items: center;
		gap: 0.6em;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.value {
		display: grid;
		grid-template-columns: 1.3em minmax(0, 1fr) 1.3em;
		align-items: center;
		height: 100%;
	}

	.value.upper {
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.value.plain {
		display: block;
		height: auto;
		text-align: right;
		text-transform: none;
		color: rgba(255, 255, 255, 0.72);
		font-size: 0.9em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row.selected .value.plain {
		color: var(--text);
	}

	.value.binding {
		display: flex;
		justify-content: center;
		text-transform: none;
	}

	.text {
		position: relative;
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
		white-space: nowrap;
	}

	/* A finger dragging along the bar sets the number; one moving up and down still scrolls the list. */
	.text.number {
		cursor: ew-resize;
		touch-action: pan-y;
	}

	.text i {
		position: absolute;
		left: 0;
		bottom: 0.32em;
		height: 2px;
		background: rgba(255, 255, 255, 0.85);
	}

	.text.number::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0.32em;
		height: 2px;
		background: rgba(255, 255, 255, 0.18);
	}

	.arrow {
		appearance: none;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		border: 0;
		background: none;
		padding: 0;
		color: var(--text);
		cursor: pointer;
	}

	.arrow svg {
		width: 0.62em;
		height: 0.75em;
		fill: currentColor;
	}

	.arrow.off {
		visibility: hidden;
	}
</style>
