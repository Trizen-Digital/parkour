<!-- A long job in the middle of the screen: what it is and how far it has got. -->
<script>
	/** @type {{text: string, progress?: number|null}} */
	let { text, progress = null } = $props();
</script>

<div class="loading">
	<div class="text"><i></i>{text}</div>
	{#if progress !== null}<div class="progress"><div style:width="{Math.round( progress * 100 )}%"></div></div>{/if}
</div>

<style>
	.loading {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(22em, calc(100vw - 32px));
		padding: 1.1em 1.2em;
		background: var(--panel);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		font-size: var(--u);
		pointer-events: auto;
	}

	.text {
		display: flex;
		align-items: center;
		gap: 0.7em;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.progress {
		margin-top: 0.9em;
	}

	i {
		width: 0.9em;
		height: 0.9em;
		border-radius: 50%;
		border: 2px solid rgba(255, 255, 255, 0.2);
		border-top-color: var(--accent);
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
