// What the library shows of a replay: one card's worth. The dev server's QA store (tools/qa-store.js) and the
// browser's (store.js, on the hosted demo) both make it here, so a card reads the same wherever the replay is kept.

/**
 * @param {object} replay the replay (qa-replay/1)
 * @param {object} where
 * @param {string} where.place 'curated', 'local' or 'incoming'
 * @param {boolean} where.thumb whether it has a thumbnail (<id>.jpg)
 * @returns {object}
 */
function librarySummary( replay, { place, thumb } ) {

	return {
		id: replay.id, place, title: replay.title ?? '', category: replay.category ?? null, created: replay.created, updated: replay.updated,
		course: replay.course?.name ?? '', lane: replay.course?.lane ?? null, device: replay.setup?.device ?? '',
		duration: replay.window ? replay.window.t1 - replay.window.t0 : replay.duration,
		notes: ( replay.notes ?? [] ).map( ( note ) => ( { t: note.t, text: note.text } ) ),
		description: replay.description ?? '', verified: replay.verified ?? null, checked: replay.checked ?? null, commit: replay.build?.commit ?? '',
		thumb: thumb ? `${replay.id}.jpg` : null,
		moves: replay.summary?.moves ?? [],
	};

}

export { librarySummary };
