// Zoidium bezier easing presets
// Each preset either:
//   - has a `tween` integer (Linear or built-in easing from PZ.tween.easingList)
//   - OR has `controlPoints` + sets tween=256 (Bezier mode, custom curve)
//
// Panzoid's tween encoding: `tween = (interp << 8) | easeIndex`
//   - 1   = Linear (easeList[1] = linear no-op)
//   - 2..32 = built-in easings (Quadratic, Cubic, ..., Bounce; OutIn for last one)
//   - 256 = Bezier (interp=1, ease=0=none), uses controlPoints
//   - 257 = Bezier + linear easing (redundant)
//
// CSS `cubic-bezier(p1x, p1y, p2x, p2y)` mapped to controlPoints:
//   controlPoints = [[p1x * duration, p1y], [p2x * duration, p2y]]
// X is in absolute frames from the keyframe; Panzoid's PZ.tween.correctCurve
// will scale X down if the handle distance exceeds the frame interval.
//
// "duration" is approximated as 30 frames (typical Panzoid keyframe interval).
// The user can adjust per-project by editing the numeric inputs in the editor.

window.ZOIDIUM_BEZIER_PRESETS = [
  // ---- CSS standard ----
  {
    id: 'linear',
    label: 'linear',
    desc: 'Constant velocity. (tween=1, easeList[1]=linear no-op)',
    tween: 1,
    controlPoints: null,
  },
  {
    id: 'ease',
    label: 'ease',
    desc: 'CSS default ease. cubic-bezier(0.25, 0.1, 0.25, 1.0)',
    tween: 256,
    controlPoints: [[7.5, 0.1], [7.5, 1.0]],
  },
  {
    id: 'ease-in',
    label: 'ease-in',
    desc: 'CSS ease-in. cubic-bezier(0.42, 0, 1, 1)',
    tween: 256,
    controlPoints: [[12.6, 0], [30, 1]],
  },
  {
    id: 'ease-out',
    label: 'ease-out',
    desc: 'CSS ease-out. cubic-bezier(0, 0, 0.58, 1)',
    tween: 256,
    controlPoints: [[0, 0], [17.4, 1]],
  },
  {
    id: 'ease-in-out',
    label: 'ease-in-out',
    desc: 'CSS ease-in-out. cubic-bezier(0.42, 0, 0.58, 1)',
    tween: 256,
    controlPoints: [[12.6, 0], [17.4, 1]],
  },

  // ---- Material Design ----
  {
    id: 'material-standard',
    label: 'material/standard',
    desc: 'Material Design standard. cubic-bezier(0.4, 0, 0.2, 1)',
    tween: 256,
    controlPoints: [[12, 0], [6, 1]],
  },
  {
    id: 'material-decelerate',
    label: 'material/decelerate',
    desc: 'Material Design decelerate (ease-out). cubic-bezier(0, 0, 0.2, 1)',
    tween: 256,
    controlPoints: [[0, 0], [6, 1]],
  },
  {
    id: 'material-accelerate',
    label: 'material/accelerate',
    desc: 'Material Design accelerate (ease-in). cubic-bezier(0.4, 0, 1, 1)',
    tween: 256,
    controlPoints: [[12, 0], [30, 1]],
  },

  // ---- Panzoid built-in easings (no controlPoints needed) ----
  {
    id: 'quadratic-in',
    label: 'quadratic in',
    desc: 'Built-in. (tween=2, easeList[2])',
    tween: 2,
    controlPoints: null,
  },
  {
    id: 'quadratic-out',
    label: 'quadratic out',
    desc: 'Built-in. (tween=3)',
    tween: 3,
    controlPoints: null,
  },
  {
    id: 'quadratic-in-out',
    label: 'quadratic in-out',
    desc: 'Built-in. (tween=4)',
    tween: 4,
    controlPoints: null,
  },
  {
    id: 'cubic-in',
    label: 'cubic in',
    desc: 'Built-in. (tween=5)',
    tween: 5,
    controlPoints: null,
  },
  {
    id: 'cubic-out',
    label: 'cubic out',
    desc: 'Built-in. (tween=6)',
    tween: 6,
    controlPoints: null,
  },
  {
    id: 'cubic-in-out',
    label: 'cubic in-out',
    desc: 'Built-in. (tween=7)',
    tween: 7,
    controlPoints: null,
  },
  {
    id: 'back-in',
    label: 'back in',
    desc: 'Overshoot in. Built-in. (tween=26)',
    tween: 26,
    controlPoints: null,
  },
  {
    id: 'back-out',
    label: 'back out',
    desc: 'Overshoot out. Built-in. (tween=27)',
    tween: 27,
    controlPoints: null,
  },
  {
    id: 'bounce-in',
    label: 'bounce in',
    desc: 'Built-in. (tween=30)',
    tween: 30,
    controlPoints: null,
  },
  {
    id: 'bounce-out',
    label: 'bounce out',
    desc: 'Built-in. (tween=31)',
    tween: 31,
    controlPoints: null,
  },

  // ---- Reset to default linear keyframe ----
  {
    id: 'default-linear',
    label: '(default linear)',
    desc: 'Reset to Panzoid default. controlPoints=[[-10,0],[10,0]]',
    tween: 1,
    controlPoints: [[-10, 0], [10, 0]],
  },
];
