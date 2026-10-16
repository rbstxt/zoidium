"use strict";
// IDs are arbitrary saved strings. Encoding the tuple keeps anchors and
// handles distinct even when an old vertex ID itself contains punctuation.
const selectionKey = (id, side = null) => JSON.stringify([id, side]);
const selectionPart = (key) => {
  const [id, side] = JSON.parse(key);
  return { id, side };
};
module.exports = { selectionKey, selectionPart };
