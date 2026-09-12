# Text+

Text+ adds six parent objects to 3D Scene. Put one or more 3D Text objects
inside any parent, directly or through ordinary Groups, and Text+ renders
each character as an independent 3D mesh. Non-text descendants keep their
normal Group behavior.

- `Character Transform` controls keyframed position, scale, rotation, and delay.
- `Gradient Transform` blends transforms from the first character to the last.
- `Character Shake` controls phase-driven, axis-based rotational shake.
- `Selected Character Transform` transforms only entered character numbers.
- `Selected Character Shake` shakes only entered character numbers.
- `Random Scatter` gives every character a seeded random transform.

The source Text object still owns its text, font, extrusion, bevel, material,
center point, and object transform. Text+ preserves those settings and adds the
following animated controls around each character's own geometry center.

The standard `Properties` category contains the parent layer's transform.
Text+ puts every per-character control in a separate `Character` category, so
the two sets of Position, Rotation, and Scale controls do not look identical.

Character Transform and Selected Character Transform have:

- `Position` on X, Y, and Z.
- `Scale` on X, Y, and Z.
- `Rotation` on X, Y, and Z, plus `Rotation order`.
- `Delay`, `Delay order`, and `Seed`.

Gradient Transform has:

- `First position`, `First scale`, and `First rotation`.
- `Last position`, `Last scale`, and `Last rotation`.
- `Rotation order`.

The first character uses the First values and the last character uses the Last
values. Characters between them receive an even linear blend. A one-character
text uses the First values. All six transform vectors are animatable, and both
Scale controls link X, Y, and Z.

Character Shake and Selected Character Shake have:

- `Amplitude`, `Period`, and `Phase`.
- `Axis` as an X/Y/Z vector in character-local 3D space.
- `Phase offset`, `Offset order`, and `Seed`.

Every Scale control links X, Y, and Z. Editing one value updates the other two.

Shake uses this angle:

```text
amplitude * sin(2 * pi * (phase - per-character phase offset) / period)
```

The timeline frame is not added automatically. A fixed Phase produces a fixed
pose; animate Phase to create the shake. The editor displays amplitude in
degrees and period, phase, and per-character phase offset in frames. An
amplitude or period of zero disables shake. The axis vector is normalized at
runtime, so `[1, 0, 0]`, `[0, 1, 0]`, and `[0, 0, 1]` rotate around the local X,
Y, and Z axes. Three components are required because Text+ operates on actual
3D geometry.

## Per-character delay

Character Transform uses a true property delay. At a delay of 3 frames,
character 1 uses the current frame, character 2 uses 3 frames earlier, and
character 3 uses 6 frames earlier. Frames before zero hold at frame zero.

Character Shake instead offsets Phase by the configured number of frames per
character. Negative phase values remain valid, so no character waits in a
frozen state at the beginning. All shake properties are evaluated at the
current timeline frame.

Each parent has its own order control with these choices:

- `Forward`
- `Reverse`
- `Center out`
- `Random`

Each parent also has its own random seed. A seed selects a deterministic
shuffle, so its delay or phase-offset order stays identical during playback,
export, and repeated renders.

## Selected characters

The selected variants have a `Characters` text field. Enter one-based
numbers separated by commas, such as `1,4,5`, to affect the first, fourth, and
fifth characters. Spaces and full-width commas are accepted. Duplicate,
invalid, and out-of-range numbers are ignored. Delay order runs across the
selected characters only, so `1,4,5` with a 3-frame delay produces offsets of
0, 3, and 6 frames.

## Random scatter

`Random Scatter` has `Amount`, `Seed`, and `Min` and `Max` ranges for position,
rotation, and scale. Each character receives one deterministic value
inside every range. Changing `Seed` creates another layout without flicker.

`Amount` is animatable. At 0, characters keep their original transforms. At 1,
they reach their assigned random transforms. Values above 1 continue moving,
rotating, and scaling in the same direction. This makes one Amount animation
enough to spread or gather all characters. Random Scatter evaluates the
transform in its parent space around each character center, so overlapping Text
layers with different local depth or scale stay aligned.

## Nesting

Text+ parents can contain each other. Each enclosed Text object is split only
once. For every character, the runtime applies the outer parent transform and
then the inner parent transform through nested 3D transform nodes. Text+ also
finds Text objects below ordinary Groups, and it works when placed inside other
Group-like objects such as Repeater.

The per-character meshes exist only at runtime. Project JSON stores the Text+
object, its controls, and the original child objects once.
