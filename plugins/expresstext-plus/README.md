# ExpressText+

Tracked-letter text effector stack for editable 3D Text.

Put an **ExpressText+** container above a 3D Text object. The container
splits the text into separately tracked letters (own namespace — Text+ and
the stock text pipeline are untouched; when a Text+ container owns the text,
ExpressText+ steps aside). One single group, no effector objects anywhere.

Personalize with the stock **Custom properties +** row: its dialog is
scoped so it offers only effectors — Shake, Plain, Random, Formula, Delay,
Spline, Orbit, Repeater, Twist, Wrap and Voronoi — never vectors, numbers
or colors. Each pick appends that effector's controls inline; delete its
rows to remove it. Everything rides the stock panel, stock undo and stock
save/load.

## Effectors

- **Shake** — sinusoidal XYZ position/rotation/scale with Amount
  (the XYZ vectors), Frequency (cycles/sec at 30fps), Offset (cycles),
  per-letter Delay (frames), Delay order, Seed, letter selection,
  Strength 0-100 and Linear/Box/Sphere fields.
- **Plain** — static XYZ pose for the selected letters ("1,4,5",
  "1+2", ranges like "2-6"), with Strength 0-100 and fields. Blank selection
  means every letter. Invert odd mirrors position and rotation on
  odd-numbered letters (1st, 3rd, 5th…).
- **Random** — like C4D's Random effector: deterministic per-letter
  XYZ in Min/Max ranges, rescaled by Minimum/Maximum %. Mode picks how
  values are drawn: Random (uniform), Gaussian (clustered mids), Noise
  and Turbulence (smooth spatial noise, animated by Animation Speed —
  good for living scatter), Sorted (every letter a distinct evenly
  spread value). Synchronized shares one value across position, rotation
  and scale; Indexed samples each axis separately for Noise/Turbulence
  (off drifts diagonally, per the manual). Space pins noise to the
  world (Global) or to the letter (UV); Noise Scale sets the feature
  size. Seed re-rolls everything; Strength enters freely (over 100%
  amplifies, negative mirrors). Fields gate which letters scatter.
- **Formula** — like C4D's Formula effector: one typed expression drives
  every letter (e.g. `sin(u*360)` waves across the line, `t` animates,
  `id`/`count` stagger, `falloff` reads the field). Trig takes degrees;
  anything unknown, empty or non-finite safely reads 0, so a typo can
  never run code or poison a frame. Minimum/Maximum % rescale the
  output; Position/Rotation/Scale set the amplitudes it multiplies.
- **Delay** — the trailer, like C4D's Delay effector: the effects of the
  other sections on position, scale and rotation do not begin abruptly
  but with a delay, so an effect trail drags behind the motion. Each
  letter chases its own target — always the same chase, never random —
  so forward and reversed sweeps time identically; the cascade itself
  comes from the field sweep (or animated values), the Delay only adds
  the trail. Mode sets how the trail catches up: Even closes in at
  uniform speed, Blend merges quickly then slowly, Spring rides springs
  (higher Strength = softer springs = more residual wobble, per the C4D
  manual). Strength paces the trail: 0% follows the target exactly
  (off), 100% is the full trail. Position/Scale/Rotation pick which
  channels trail; Letters and Fields limit which letters it applies to.
  Static poses simply hold (like C4D: still in, still out). Like C4D:
  the trail needs motion — animate the Plain (or sweep its field) and
  Delay drags behind it.
- **Spline** — like C4D's Spline effector: arranges letters along a
  built-in Line, Circle or Helix path (no dragged-in spline object
  needed). Step spaces evenly, Falloff flows with the field weight
  (great with a sweeping Linear field), Relative keeps the letters'
  proportional spacing. Offset wanders letters along the path (animate
  it); Start/End fence the area (invert them to flip direction, per the
  manual's tip); Clamp piles overflow at the ends, off wraps around.
  Strength blends the distance to the path. Position/Rotation pick
  which channels follow (rotation turns letters to the path tangent);
  Heading/Pitch/Bank add user orientation on top. Tilt orients the whole
  path in space (letters follow in full 3D). Single-contour paths
  only (no segments, rails or ellipse rings); scale the text for
  elliptical rings.
- **Orbit** — our own effector (no C4D counterpart): the selected
  letters revolve rigidly about their own center, glyphs turning with
  the orbit — a pair swaps places at 180 degrees. Angle is XYZ
  (Z swaps side by side, X flips in place along the line, Y swaps with
  a yaw); animate it for full revolutions. Radius scales the orbit size
  (0% gathers at the center; a lone letter spins in place). Different
  numbers rotate differently by construction.
- **Repeater** — our own effector (no C4D counterpart): multiplies every
  letter into ghosts. Mode picks the arrangement: Linear (copies step
  along Offset), Random (copies scatter in the Min/Max range volume by
  Seed), Echo (copies smear along the letter's motion by Lag frames —
  still letters show no spread). Copies caps at 64 per section (mesh
  counts multiply per letter); Fade decays ghost opacity; Strength
  scales the offsets. Ghosts share the letter's orientation in world
  space and hide with unselected, weak or disabled letters.
- **Twist** — ribbon twirl in the letter run: each letter turns about
  the chosen Axis in proportion to its position, centered so the middle
  letter holds still and the ends counter-rotate (Angle is the total
  end-to-end twirl). A lone letter holds — there is no line to twist
  across. Letters/Delay/Field gate which letters twirl.
- **Wrap** — flag wave in the letter run: sine displacement along
  Direction (X/Y/Z) with Frequency cycles across the run and animatable
  Phase (degrees). Upright letters, no tilt math; Amplitude 0 is the
  identity, Strength scales the whole wave.
- **Voronoi** — shatters each selected letter into Chunks (1–64) by
  seeded Voronoi cells, then Explodes the pieces outward along their own
  centers and spins them by Spin (XYZ degrees). Strength blends the
  shatter; the base letter hides while its chunks are displaced at 100%.
  Other sections can address the parts: a Delay section with Letters
  `voronoi-1` trails the chunks of the first Voronoi section (every
  section kind answers `kind-N` tokens: `plain-2`, `shake-1`, ...).

Every XYZ effector has independent position, rotation (degrees) and
scale plus a Character/Text pivot. Ancestor effectors evaluate
outermost first; Delay layers trail every effector of the stack; the
container owns tracking plus the shared rotation order. Letters number
continuously across every text under one container (first text's letters
first) — texts may sit directly under the container or inside Groups —
so selections, id/u/count, ranks and centers span texts; each text keeps
its own placement, composed through any Group wrappers.

## Bouncing text, the C4D way

1. Put an **ExpressText+** container above a 3D Text object (it splits
   the text into tracked letters by itself — no Fracture setup needed).
2. Add a **Plain** section: set the transformation (e.g. Position or a
   360° Rotation) and pick a **Field** (Linear/Box/Sphere plus position
   and scale) to gate which letters move.
3. **Animate** it: keyframe the Plain rows (or the field position) in
   the timeline, like keyframing C4D's Plain P.X.
4. Add a **Delay** section: Strength paces the trail, Mode picks
   Even (uniform trail), Blend (trail that merges quickly then slowly)
   or Spring (trail plus a spring bounce on arrival).
5. Play: each letter trails its own motion; sweep the field (or reverse
   the sweep) and the trail mirrors exactly.

Delay Letters takes letter lists and `kind-N` tokens that copy the
selection of the Nth section of that kind (e.g. `plain-2`, `voronoi-1`);
unselected letters stay untouched. Fields limit which letters the delay
applies to.
