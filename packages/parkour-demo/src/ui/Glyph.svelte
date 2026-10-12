<!-- One key, mouse button, pad button or touch control, drawn as the game's prompts draw them (src/ui/glyphs.js names
	them). -->
<script>
	import { glyphOf } from './glyphs.js';

	/** @type {{code: string}} */
	let { code } = $props();
	const glyph = $derived( glyphOf( code ) );
</script>

{#if glyph.kind === 'mouse'}
	<svg class="mouse" viewBox="0 0 16 24" aria-label="mouse {glyph.button}">
		<rect x="1" y="1" width="14" height="22" rx="7" fill="none" stroke="currentColor" stroke-width="1.8" />
		<line x1="8" y1="1.5" x2="8" y2="10" stroke="currentColor" stroke-width="1.4" />
		<line x1="1.5" y1="10" x2="14.5" y2="10" stroke="currentColor" stroke-width="1.4" />
		{#if glyph.button === 'left'}<path d="M8 1.9 A6.1 6.1 0 0 0 1.9 8 V9.3 H7.3 V1.9 Z" fill="currentColor" />{/if}
		{#if glyph.button === 'right'}<path d="M8 1.9 A6.1 6.1 0 0 1 14.1 8 V9.3 H8.7 V1.9 Z" fill="currentColor" />{/if}
		{#if glyph.button === 'middle' || glyph.button === 'wheel'}<rect x="6.6" y="3.4" width="2.8" height="5" rx="1.4" fill="currentColor" />{/if}
		{#if glyph.button === 'move'}<path d="M8 13.5 l2.2 2.4 h-1.4 v2.6 h-1.6 v-2.6 h-1.4 Z" fill="currentColor" />{/if}
	</svg>
{:else}
	<kbd class="{glyph.kind} {glyph.shape ?? ''}">{glyph.label}</kbd>
{/if}

<style>
	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		min-width: 1.55em;
		height: 1.55em;
		padding: 0 0.42em;
		border-radius: 0.28em;
		background: #f4f5f7;
		color: #15171b;
		font: 700 0.8em/1 var(--font);
		box-shadow: inset 0 -0.12em 0 rgba(0, 0, 0, 0.28);
		white-space: nowrap;
	}

	.pad {
		font-size: 0.78em;
		box-shadow: none;
	}

	.face,
	.stick {
		width: 1.75em;
		height: 1.75em;
		min-width: 0;
		padding: 0;
		border-radius: 50%;
	}

	.stick {
		box-shadow: inset 0 0 0 0.16em #15171b, inset 0 0 0 0.26em #f4f5f7, inset 0 0 0 0.36em #15171b;
		font-size: 0.66em;
		width: 2em;
		height: 2em;
	}

	.bumper,
	.trigger {
		min-width: 2.5em;
		height: 1.6em;
		border-radius: 0.8em 0.8em 0.35em 0.35em;
	}

	.trigger {
		border-radius: 0.35em 0.35em 0.8em 0.8em;
	}

	.dpad {
		width: 1.7em;
		min-width: 0;
		padding: 0;
		border-radius: 0.3em;
	}

	.pill {
		border-radius: 0.8em;
		padding: 0 0.6em;
	}

	/* A touch control, as its button looks on the screen. */
	.touch {
		height: 1.9em;
		padding: 0 0.75em;
		border-radius: 0.95em;
		background: rgba(12, 14, 18, 0.5);
		color: var(--text);
		box-shadow: inset 0 0 0 0.13em rgba(255, 255, 255, 0.6);
		font-size: 0.68em;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.mouse {
		width: 0.95em;
		height: 1.45em;
		flex: none;
		vertical-align: middle;
		color: #f4f5f7;
	}
</style>
