"use strict";

// Shared mutable Effector plugin state. The pure evaluation library lives in
// effector-core.js and effector-fracture.js; these holders are set by the
// entry on activation and are read at evaluation time by the object classes
// and the deformation support.
const state = {
  library: null,
  meshDeformerCache: null,
  meshDeformerThree: null,
  meshJobs: null,
  deformationSupport: null,
  cancelRedraw: null,
};

module.exports = state;
