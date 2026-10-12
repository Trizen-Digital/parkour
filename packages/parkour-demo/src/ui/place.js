// A Svelte action that puts an element a controller made (a timeline's canvas) inside the node, for as long as the
// node is there: the controller keeps drawing on it and listening to it whichever component shows it.

/**
 * @param {HTMLElement} node
 * @param {HTMLElement} child
 */
function place( node, child ) {

	node.appendChild( child );
	return { destroy: () => child.remove() };

}

export { place };
