<!-- The button prompts along the bottom of a screen: a glyph and what it does, the pad's or the keyboard's by the
	device in use (on touch, what it does alone). Each is also a button to click or tap. -->
<script>
	import Glyph from './Glyph.svelte';
	import { ui } from './state.svelte.js';

	/** @type {{prompts: {key: string|string[], pad?: string, label: string, run?: () => void}[]}} */
	let { prompts } = $props();
</script>

<div class="prompts">
	{#each prompts as prompt ( prompt.label )}
		<button type="button" onclick={() => prompt.run?.()} tabindex="-1">
			{#if ui.device === 'touch'}
				<!-- Nothing to press but the prompt itself. -->
			{:else if ui.device === 'pad' && prompt.pad}
				<Glyph code={prompt.pad} />
			{:else}
				{#each [ prompt.key ].flat() as code ( code )}<Glyph {code} />{/each}
			{/if}
			<span>{prompt.label}</span>
		</button>
	{/each}
</div>

<style>
	.prompts {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 0.5em 1.6em;
	}

	button {
		appearance: none;
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		border: 0;
		background: none;
		padding: 0;
		color: var(--text);
		font: 600 1em/1 var(--font);
		cursor: pointer;
		pointer-events: auto;
	}

	button:hover span {
		color: var(--accent);
	}

	/* On a menu screen on touch there is no key to show, only the prompt to tap: a button 44 px tall, as phones advise,
	   shaded like a row so it reads as one. */
	:global(.screen.touch) button {
		min-height: 44px;
		padding: 0 1em;
		background: var(--row);
		border-radius: 2px;
	}
</style>
