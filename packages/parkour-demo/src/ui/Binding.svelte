<!-- A binding as tokens (src/ui/controls.js): glyphs, with '+', '→' and '/' between them. -->
<script>
	import Glyph from './Glyph.svelte';

	/** @type {{tokens: string[]}} */
	let { tokens } = $props();
</script>

<span class="binding">
	{#each tokens as token, i ( i )}
		{#if token === '+' || token === '→' || token === '/'}
			<span class="join">{token}</span>
		{:else}
			<Glyph code={token} />
		{/if}
	{/each}
</span>

<style>
	.binding {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
	}

	.join {
		color: inherit;
		opacity: 0.75;
		font-weight: 600;
		padding: 0 0.1em;
	}
</style>
