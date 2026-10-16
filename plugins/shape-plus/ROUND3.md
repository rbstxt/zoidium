# Round 3 implementation notes

Work in progress on `t3/shape-plus-r3`, based on round 2 merge `f5b724e`.

The existing solid-paint compilation path remains the compatibility baseline.
New operators evaluate plain data in contents order, before later paints.
Gradient geometry and stop data use one shared shader, with no generated shaders.
Editor controls use native property channels and the existing gesture history.

Validation includes pure geometry oracles, prior-round image comparisons,
headless captures, shader program counts and the repository verification suite.
