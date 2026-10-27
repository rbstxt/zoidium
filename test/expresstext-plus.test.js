"use strict";

// ExpressText+ tests: DaviFX's Phase-1 coverage, split by topic.
// Shared harnesses live in ./expresstext-plus-helpers.js; each part below
// registers its tests on require, so `node --test test/expresstext-plus.test.js`
// runs the whole set.

require("./expresstext-plus-select.js");
require("./expresstext-plus-delay.js");
require("./expresstext-plus-effectors-a.js");
require("./expresstext-plus-effectors-b.js");
require("./expresstext-plus-stack.js");
require("./expresstext-plus-render-a.js");
require("./expresstext-plus-render-b.js");
