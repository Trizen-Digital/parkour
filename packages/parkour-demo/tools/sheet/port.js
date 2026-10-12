// The port the receiver (receiver.mjs) listens on and the game posts its frames to (sheet.js, shot.js). A module of
// its own, with nothing of node's in it, so the scripts the game loads in the browser can share it.
const PORT = 5998;

export { PORT };
