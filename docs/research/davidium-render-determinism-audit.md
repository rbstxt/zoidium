# Davidium render determinism audit

> This report records the initial audit. Follow-up fixes are documented in
> [the implementation report](davidium-integration-fixes.md). Source links now
> point to the repaired working trees; initial failure descriptions are historical.

Audited on 2026-10-01. Source snapshot: the modified working tree at `/Users/dia/Projects/GitHub/Davidium/zoidium`, HEAD `0faf124f681dd8ea378ddc5ec49b132c875ef062`. Target: the existing, modified working tree at `/Users/dia/Projects/GitHub/Zoidium`, based on commit `1d643a2c0f07da342df0fc2320c94bdb491cdfe0`. Neither HEAD describes all local edits. This report uses local code as primary evidence; it does not claim that this snapshot is identical to the latest GitHub branch. No feature code was merged. No CM3 resources were copied into the target repository.

## Acceptance rule

For a fixed project, assets, settings and render configuration, `frame(t)` must have one result. Visiting `t` directly, playing forward to `t`, seeking backward to `t`, rendering `t` repeatedly, exporting `t`, and revisiting `t` after another clip or nested composition must produce the same scene state and image. Resolution and explicit quality settings are additional fixed inputs. GPU differences across devices need a stated pixel tolerance; same-device history dependence is a separate problem.

A seeded random generator alone does not establish this rule. A solver can use seeded randomness and still change its result when the integration steps or respawn times change. Likewise, clearing history on reverse seek removes stale pixels but does not reconstruct the correct earlier image.

## Candidate decisions

These are decisions about the render implementation. UI, licensing, serialized IDs, cleanup, packaging and host compatibility can still block a whole-plugin merge.

| Feature | Decision | Reason and next step |
| --- | --- | --- |
| Existing Native FX, Particles+, Layer Input, Material+, Geometry+, Text+, Easing+, Player+, AlipFX and Light+ | Already present | Editable JavaScript in these existing directories matches the target after normalizing CRLF. Do not list these as new Davidium render work. |
| Jpeg Damage | First extraction candidate, with ordinary integration fixes | Reads current input texture, explicit time and seed; no rolling framebuffer. Split it out of Setup Legacy, remove the copied CM3 common vertex resource, dispose its material/pass, validate its expensive shader and timing units. |
| Camera vibrate calculation | First extraction candidate | Hash noise is a direct function of time and seed; camera update resets the base pose before adding shake. Extract independently of the compositor replacements. |
| Expanded lights | Improve before merging | Per-frame properties are stateless, but numeric light subtypes and Light+ ownership need migration. Several names overstate the backend implementation. |
| Twist and Warp | Keep target implementation; selectively port useful fields | Donor formulas use immutable base positions and frame properties, but target already contains newer namespaced Twist/Warp and geometry quality controls. Replacing Scene+ would remove them. |
| Voronoi Fracture, also described as shatter | Improve before merging | Seeded topology and transforms recompute from base geometry; promising. Port to the target deformer framework, namespace its type, bound rebuild costs and test caching/invalidation. |
| Optical Flares renderer | Improve before merging | Shader time and seed are explicit. Move occlusion/light evaluation after all scene transforms, fix mesh-cache invalidation and keep designer state isolated from ordinary render/export. |
| Form | Improve before merging | Deformation starts from base positions; asynchronous model/mask/map loading is not awaited by `prepare()`. Base topology rebuild key only checks total count. |
| Plexus without sound | Improve before merging | Fresh point generation and seeded noise are promising, but async image/OBJ loads are not awaited, and `prepare()` is empty. |
| Particular, GPU analytic subset | Improve before merging, only as an explicit limited feature | Its shader computes positions from age directly. Keep physics/parent emitters/live audio out of this subset; validate all visible settings actually affect the shader. |
| Particular CPU physics, turbulence, fluid, flocking, bounce and parent emission | Defer and discuss with author | Incremental simulation depends on the last visited time, truncates elapsed time, resets at the seek destination and seeds respawns from visitation-dependent times. Needs deterministic simulation design. |
| Particular audio reactors and Plexus sound effector | Defer and discuss with author | Read live WebAudio analyser output, with a different synthetic fallback. Needs offline project-audio sampling indexed by timeline time. |
| Camera+ video motion blur | Defer and discuss with author | Uses a ring of the last three render calls, not samples at defined timestamps. Repeated, backward and direct rendering select different neighbors. |
| Camera+, remaining shared cameras / DOF / 3D tracks | Improve before merging as separate parts | Several parts are stateless, but the pack replaces compositor methods used by the existing deterministic temporal system. Needs host hooks and combined tests. |
| Echo Legacy and Posterize Time Legacy | Do not merge as new implementations; migrate to existing Native FX | Their advertised behavior duplicates existing deterministic tools through history buffers. Preserve legacy type IDs through an explicit migration if project compatibility is needed. |
| Datamosh preview | Defer and discuss with author | Recurrence writes a new feedback result every render call, even at unchanged time. Agree on deterministic reconstruction or a deliberately restricted live mode. |
| VHS persistence | Defer feedback portion; improve stateless portion before merging | Default persistence is nonzero and feeds the output back every render. Split stateless signal/CRT/noise from temporal persistence. |
| Export-time true datamosh | Defer product integration and discuss with author | Deterministic byte processing of a fixed input can exist, but it is distinct from preview rendering and corrupts/removes codec reference frames. Preview/export parity and codec behavior need an explicit product decision. |
| Precomp+ | Improve before merging | This module mainly edits composition media/tabs. No independent history-based shader was found. Nested-instance timing, dependency cycles, serialization and integration with temporal/shared-camera systems remain acceptance requirements. |

## Proven history and time-path problems

### Datamosh and VHS feed back every render call

Datamosh binds `history.texture` to `tPrev`, renders a new output and copies that output back into history every call. There is no timestamp guard or seek reconstruction. `update(e)` only supplies properties and shader time. The shader consumes old pixels for its motion/smear calculations, so unchanged uniforms do not freeze the image. [Datamosh pass, lines 351-369](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/datamosh.js:351), [property update, lines 472-493](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/datamosh.js:472), [history sampling](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/datamosh.js:243).

VHS does the same, copying its final output to `history` each call. Persistence defaults to `0.25`; time and persistence are explicit uniforms but history is an implicit input. [VHS pass, lines 894-909](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/vhs.js:894), [persistence default](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/vhs.js:995), [property update](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/vhs.js:1022).

The source-code probe calls the actual pass methods with a symbolic mock renderer. For both passes, identical `same-frame` input reads `hasHistory=0` first and `hasHistory=1` with the last generated output next. The resulting dependency expressions are `feedback(same-frame,none)` and `feedback(same-frame,feedback(same-frame,none))`. This proves different inputs to the shader, rather than measuring GPU pixels.

A suitable redesign uses one of these declared models:

- A bounded-window effect renders upstream frames at fixed offsets and applies explicit weights. VHS persistence can use `sum(w_k * upstream(t-k*delta))`, with a fixed sample count and attenuation. This changes an infinite recurrence into an explicit finite visual model.
- A recurrence effect defines canonical simulation ticks and an initial state. To render tick N, replay ticks 0 through N or start from a checkpoint computed by that exact replay. Cache keys must include project revision, assets, effect settings, resolution and sampling configuration. Repeated rendering reads cached output without advancing the recurrence. Preview and export use the same ticks.
- A baked asset contains the processed frames. The editor then samples that asset by timestamp. This makes runtime rendering cheap, but authoring/export latency and storage need agreement.

Changing only `if (time === lastTime) return` addresses stationary drift but leaves direct seek, reverse seek, skipped frames, motion blur and export dependent on the visited path.

### Echo Legacy freezes writes but still evaluates history differently

`update(e)` sets `holdHistory` on exactly equal times. Negative jumps clear `valid` when `clearOnJump` is enabled. Clearing is a reset, not a reconstruction of earlier echoes. The pass computes K from the existing `valid` count and pushes the current frame after output, so its first render at `t=0` uses no history while a second render at the same time uses the newly stored history. [Echo update, lines 410-431](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/echo-legacy.js:410), [render K and push, lines 238-283](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/echo-legacy.js:238).

There is also a tap-index bug: `tapTexture(k)` treats k as a zero-based offset and rejects `k >= valid`, but render starts at `k=1`. When one entry is valid, the first requested tap is blank. With two valid entries, it skips the newest slot and includes a blank at the end. The source probe shows a dry first render at frame 0, then an echo-with-blank branch at the same frame. The effect's mode and shader determine the pixel impact; the branch and tap mismatch are established by code. [Tap indexing, lines 211-217](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/echo-legacy.js:211), [tap call](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/echo-legacy.js:261).

The existing Native FX Echo already declares a frame-sampling request with count, explicit frame offset, opacity and decay. It blends textures resolved by the temporal host. Use that model, with deliberate mapping for smear/max/add/screen and property migration. A migration cannot honestly preserve every path-dependent legacy output, because no unique historical image existed. [Native FX Echo request](/Users/dia/Projects/GitHub/Zoidium/plugins/native-fx/effects/echo.js:165), [host sample plan](/Users/dia/Projects/GitHub/Zoidium/plugins/core/temporal-render.js:56).

### Posterize Time Legacy captures whichever frame enters a bucket first

Its update computes `floor(t * fps / projectRate)` and captures current `readBuffer` whenever the key changes. It never evaluates the exact quantized bucket timestamp. Thus at project rate 30 and effect rate 8, visiting `[0,1,2]` leaves frame 2 displaying source frame 0; visiting `[2]` displays source frame 2; visiting `[3,2]` displays source frame 3. All three destinations are frame 2 and all three source times are in the same bucket. [Capture pass, lines 95-112](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/posterizetime-legacy.js:95), [bucket detection, lines 201-219](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/posterizetime-legacy.js:201).

The target already evaluates `floor((frame / rate) * fps) / fps * rate` through the temporal host, independently of visitation order. Do not replace it with held-buffer behavior. [Target quantizer](/Users/dia/Projects/GitHub/Zoidium/plugins/core/temporal-render.js:27).

### Camera+ video blur uses rendered neighbors rather than time neighbors

`applyVideoMotionBlur` writes every call into a three-target ring, selects `newest`, `middle` and `oldest`, and advances `_mbHead` and `_mbCount` without comparing timestamps. In the actual-source symbolic probe with motionBlurTrackFrame=1, `[0,1,2]` ends with `mix(source@2,source@1)`, repeated frame 2 changes to `mix(source@2,source@2)`, direct `[2]` returns `source@2`, and reverse `[4,3,2]` ends with `mix(source@2,source@3)`. Warp mode changes the combination algorithm but still selects the same history ring. [Ring and neighbor selection, lines 179-219](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/render-layer.js:179), [mix/warp dispatch, lines 220-283](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/render-layer.js:220), [advance](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/render-layer.js:292).

Use explicit shutter sample times, prepare the source video at those times, then blend or calculate motion between fixed neighboring samples. Blur samples must not refer to the previous preview render. Future samples needed for a forward shutter must be decoded explicitly. If optical-flow warp is retained, its input pair, algorithm and boundary behavior must be fixed.

Camera+ also replaces `renderLayer` and `renderSequence`, then wraps these replacements. The target temporal host wraps these same methods and stores original methods. Depending on activation order and what the host rewraps, a copied replacement can bypass temporal mapping or capture a method already wrapped earlier. This is a code integration risk, not a demonstrated current-browser failure. The safe integration is a host compositor hook for camera selection, DOF and explicit shutter plans, not competing wholesale replacements. [Camera install targets](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-runtime.js:1420), [camera shutter loop](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/render-sequence.js:52), [target temporal wrappers](/Users/dia/Projects/GitHub/Zoidium/plugins/core/temporal-render.js:895).

### Particular CPU simulation depends on time increments

CPU mode is enabled by animated emitters, parent systems, physics, bounce, meander, flocking, fluid, turbulence and several deformers. It is not an obscure optional code path. [CPU mode conditions](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:626).

The update computes `dt = simTime - _simTime`. A negative dt or dt over .25 resets particles at the current destination and sets dt to zero; positive dt is simulated with `min(dt,.1)`. A .2-second skip therefore integrates only .1 second. A direct first visit sets `_simTime=destination` and performs no integration. Reinitializing ages at the destination does not reconstruct the positions that forces produced earlier. [CPU scheduler, lines 1089-1111](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:1089), [initialization](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:709).

The probe instruments this exact scheduler branch with a scalar stand-in for the solver. At 30 fps, frames `[0,1,2,3,4,5,6]` integrate .2 seconds, `[0,6]` integrate .1, and `[6]` integrate zero. Seeking back resets the scalar to zero at the new time. These numbers describe scheduling, not measured particle trajectories. The actual solver increments ages, velocities and positions, and seeds respawns from `floor(time*1000)` at the update that notices expiration, so different step partitioning also changes respawn randomness. [Age update and respawn seed](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:912), [velocity force update](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:943), [parent-position interpolation](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:790).

The author should choose the simulation contract before integration:

1. Keep simple particles analytic. Compute identity and birth time from emission rate/seed, evaluate emitter properties at birth time, then compute age, initial pose and ballistic motion at requested time.
2. Use a fixed simulation frequency for interactions and non-analytic forces. Replay from the canonical origin or a valid immutable checkpoint. Evaluate animated properties at each simulation tick, use birth index/cycle as random identity, process parent systems in dependency order, and make fractional-frame interpolation explicit.
3. Bound particle counts, checkpoint memory and seek replay cost. Expose a deterministic bake if interactive replay cannot meet the agreed latency.

The GPU branch computes age and `ipos + emission + velocity*age + acceleration*age²/2` directly from shader time. This is a useful restricted implementation, but cannot be used as proof that the whole plugin is deterministic. Its hash randomness does not visibly include the emitter seed, and current uniforms sample several properties at render time rather than birth time. Those are feature/semantics issues even where path dependence is absent. [Analytic shader](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:72), [uniform updates](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:1120).

### Live audio reactors cannot reproduce silent seek or offline export

Particular reads `CM.playback.audioDst.getByteFrequencyData`; Plexus does the same for its sound effector. Those samples describe current playback/analyser state and smoothing, not an immutable audio window at requested project time. Particular substitutes level .5 without an analyser; Plexus substitutes a sine wave. This makes preview/export and playing/paused behavior different by construction. [Particular analyser](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/particular.js:496), [Plexus analyser and fallback](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/plexus.js:1061).

Add project-audio analysis that reads decoded PCM for a specified timeline time/window/channel/band. Cache analysis by asset hash, edit revision, sample rate and analysis parameters. RMS/FFT windows, padding, smoothing and clip mix semantics must be explicit and shared by preview and export. A playback analyser may visualize the editor's meters, but should not drive saved-project render output.

## Stateless candidates still need correct dependencies

### Form and Plexus asset readiness

Form copies `basePositions` before each deformation, which prevents incremental drift. However, model, mask and layer-map loaders start promises from update helpers, render fallback points while pending and install new source data later. `prepare()` only awaits its sprite texture. A stationary timeline can therefore show different geometry when an asset finishes, and early export frames can use fallback points. Also, `update()` rebuilds base geometry only when total point count changes. Equal totals with different grid dimensions, base sizes, types or model scales need a complete geometry signature. [Base rebuild](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/form.js:301), [model/mask/maps loaders](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/form.js:409), [fresh deformation copy](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/form.js:583), [update and prepare](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/form.js:1040).

Plexus generates points afresh and then applies effectors. Image/OBJ modes start async loaders and initially substitute primitives or other fallback geometry. Its `prepare()` is empty. [Fresh point update](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/plexus.js:327), [image fallback/load](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/plexus.js:759), [OBJ loading](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/plexus.js:859), [empty prepare](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/plexus.js:482).

Move all dependencies into `prepare(time)` and await them before final output. Use request generation IDs so a stale async result cannot replace a newly selected asset. Clear or key caches by asset identity/revision and the complete geometry parameters. Editor loading placeholders are reasonable if visibly provisional; export must await the final dependencies. Do not equate network/download readiness with timeline simulation state.

### Optical Flares

The shader uses explicit `uTime`, seed-derived hashes and trigonometric animation; no incremental framebuffer was found. Custom image loading is awaited by `prepare()`, which is better than Form/Plexus. [Time and seed uniforms](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares.js:1125), [custom texture prepare](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares.js:1183).

Occlusion and projected light positions are computed during this object's `update()`, using other objects' current THREE transforms. Refreshing world matrices does not update animated properties of sibling objects that have not yet received the requested time. That makes scene update order a risk, especially when revisiting different frames. The raycast mesh cache uses only the layer identity and root `objects.length`; replacing a mesh/geometry or adding/removing nested children can keep the count unchanged and leave stale references. `_designerPreview` also alters position, brightness and scale outside serialized scene properties. [Mesh cache/occlusion](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares.js:998), [light projection](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares.js:1067), [designer render override](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/optical-flares/optflares.js:1101).

Use a post-transform evaluation phase: update all scene properties at t, update matrices, then calculate camera/light/occlusion dependencies. Invalidate meshes from scene structure/geometry revision, not root length. Give designer previews their own render context, and commit changes through undoable project transactions before normal rendering. These are identified code risks, not pixel regressions already reproduced in a live scene.

### Jpeg Damage

`update(e)` reads effect properties at e and fills a plain ShaderPass. Its GLSL hashes coordinates, `randSeed` and an explicit time bucket; no earlier rendered texture is read. This makes it the clearest useful extraction from Setup Legacy. [Uniform update](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/jpegdamage.js:179), [time/seed bucket](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/shaders/fx_jpegdamage.glsl:223).

The donor pack embeds `shaders/common.glsl`, which the parent audit compared byte-for-byte after stripping outer whitespace with the target ignored CM3 common vertex shader. The repo resource rule prohibits importing that CM3 shader into checked-in plugin resources. Use the normal host asset pipeline for the CM3 vertex dependency, as existing Native FX does, or an independently authored Zoidium vertex shader. Therefore neither Jpeg Damage nor the legacy pack is ready to copy unchanged. [Donor common resource declaration](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/manifest.json:70), [effect bundle vertex lookup](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/jpegdamage.js:94).

Fix `unload()` to dispose its material/pass rather than only unloading shader assets. Confirm whether `time` means seconds and replace hardcoded `time*30` with declared project/effect sampling semantics if `jitterFrames` is meant to follow project frames. The shader performs 8x8 block transform work inside each output fragment; profile representative preview/export resolutions before default inclusion. A deterministic shader can still be too expensive for interactive use. [Missing pass disposal](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/effects/jpegdamage.js:158), [DCT shader](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/shaders/fx_jpegdamage.glsl:72).

### Lights, shake and deformers

Vibrate hashes an integer noise segment with seed and interpolates at input time. Camera update first assigns base position/rotation and then adds shake, so repeated updates do not accumulate shake. Integrate this as a small camera extension with a stated frames/seconds convention. [Noise and application](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/vibrate.js:6), [base pose reset](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/camera-plus/camera-class.js:114).

The expanded light updater assigns properties at the requested time. However, donor `objectType=4` means Area while current Light+ uses 4 for Hemisphere. Donor migrates payloads with groundColor and no width/height, but the full plugin must own all picker/import defaults consistently. IES currently uses a SpotLight with an `iesProfile` tag, Dome is a HemisphereLight, Physical Sun is a DirectionalLight plus elevation tint, and Portal is a RectAreaLight or fallback. The implementation does not demonstrate IES photometric distribution, HDRI environment lighting or a physical GI portal. Agree on truthful names or implement those behaviors before promising them. [Current Light+ type 4](/Users/dia/Projects/GitHub/Zoidium/plugins/light-plus/manifest.json:52), [donor backends](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/lights-c4d.js:314), [migration](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/lights-c4d.js:368), [stateless update](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/trapcode-suite/lights-c4d.js:385).

Effector+ saves original vertex arrays, starts each chain from a fresh copy and applies properties at the supplied time. Voronoi uses a newly seeded RNG when topology rebuilds, compares incoming base/deformed positions for cache validity and recomputes shard transforms from the baked surface. This is the correct broad shape for time determinism. Do not replace target Scene+ with donor Scene+: target already has namespaced `zoidium:repeater/twist` and `zoidium:repeater/warp`, migration and polygon/curve quality controls that donor omits. Donor registers numeric 7/8/9; introducing another numeric type family increases collision risk. Port useful field behavior and fracture into the current namespaced system. [Immutable mesh data](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/effector-plus/deform-framework.js:25), [fresh chain copy](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/effector-plus/deform-framework.js:149), [Voronoi cache and transforms](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/effector-plus/deformer-objects.js:669), [target IDs and quality settings](/Users/dia/Projects/GitHub/Zoidium/plugins/scene-plus/scene-plus.js:4).

For fracture, test same-frame repeat, reverse seek, changed upstream deformation, geometry replacement, shared geometry instances, disabling/removing the deformer and repeated enable/unload. Set a cell-count/triangle-count budget. Rebuilding fracture topology for every animated upstream position array can be expensive even where it is deterministic.

## Questions to settle with the author

1. Is Datamosh intended as deterministic synthetic frame processing, a canonical feedback simulation, or an export-only codec operation? The preview shader and exported keyframe removal currently represent different algorithms. The export helper itself documents prediction-chain damage and imprecise seeking. Merely installing `PZ.datamoshRender` does not establish a complete export flow. [Export installer](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/datamosh-export.js:3), [processor contract](/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/openzoid-legacy/datamosh-render.js:4).
2. What startup state, tick frequency, emission model, seek latency and checkpoint/bake budget are acceptable for Particular physics and parent systems? Can the analytic subset ship separately with unsupported controls removed?
3. Should legacy Echo/Posterize/VHS projects retain visual settings under a new deterministic interpretation, or become baked assets? Keep IDs stable, but describe any semantic change in migration notes.
4. What does each audio reactor measure: pre/post clip mix, frequency band, channel, window length and smoothing? Which render-time audio service should all plugins use?
5. Can video motion blur sample actual adjacent source frames at fixed shutter times? Should optical flow be retained, or replaced by explicit multi-sample blur until a deterministic implementation is available?
6. What is the intended shared-camera rule inside precompositions and multiple instances of the same composition? Each instance needs an evaluation context and its own local time without persistent camera/particle state leaking between instances.

## Verification performed and remaining work

- Normalized editable-JavaScript comparison against the current target showed new render families in Camera+, Effector+, OpenZoid Legacy, Optical Flares, Precomp+ and Trapcode Suite; existing render families listed above are equal. Scene+ differs because the target includes newer deformer work.
- `node --test test/effector-plus.test.js test/precomp-plus.test.js` in the donor passed 7 tests. These are stub-runtime formula/registration/UI tests, not GPU determinism certification. [Effector tests](/Users/dia/Projects/GitHub/Davidium/zoidium/test/effector-plus.test.js:76), [Precomp tests](/Users/dia/Projects/GitHub/Davidium/zoidium/test/precomp-plus.test.js:109).
- `node /tmp/davidium-audit-probes.cjs` passed and produced `/tmp/davidium-audit-probes.out`. Its full source is reproduced below. It executes actual legacy pass methods, actual Camera+ video blur code and the actual Particular scheduling branch with deliberate mocks. It does not evaluate fragment shaders or compare screenshots.
- A live CM3 project, GPU pixel checks, audio assets and export decoding were not exercised by this sub-audit. Static risks are labeled as risks; verified scheduling/history counterexamples are labeled as probes. Existing tests passing cannot clear these defects.

Acceptance tests should compare the same destination frames under direct, forward, backward, shuffled and repeated evaluation. Use at least two project rates and two export rates; include fractional shutter/echo samples, nested compositions, two instances of one comp, animated emitter/camera/light properties, asset replacement at unchanged time and delayed asset readiness. Compare CPU scene snapshots and pixel hashes/tolerance on the same device. Reset caches between a canonical baseline and each alternate traversal. Preview and export must use the same quality setting for parity checks. Repeat under each relevant plugin activation order, especially temporal host + Camera+ + Effector+ + scene repeater + Particular/Form/Plexus + Optical Flares.

## Reproducible source probes

Save the following as a `.cjs` file outside the repository and run `node filename.cjs`. Change `base` if the donor snapshot lives elsewhere. The mock renderer records texture dependencies rather than GPU color; the scalar Particular solver measures integration scheduling rather than physics output.

```javascript
const fs = require('node:fs');
const base='/Users/dia/Projects/GitHub/Davidium/zoidium/plugins/';
function read(p){return fs.readFileSync(base+p,'utf8').replaceAll('\r\n','\n');}
function three(){
 function Pass(){};
 class RT{constructor(w,h){this.width=w;this.height=h;this.texture={value:'empty'};}setSize(w,h){this.width=w;this.height=h;}dispose(){}}
 class V2{constructor(x,y){this.x=x;this.y=y;}set(x,y){this.x=x;this.y=y;}copy(v){this.x=v.x;this.y=v.y;}}
 class Scene{constructor(){this.children=[];}add(o){this.children.push(o);}}
 class Mesh{constructor(g,m){this.geometry=g;this.material=m;}}
 class Material{constructor(p){Object.assign(this,p);}dispose(){}}
 return {Pass,WebGLRenderTarget:RT,Vector2:V2,Scene,Mesh,ShaderMaterial:Material,OrthographicCamera:class{},PlaneBufferGeometry:class{dispose(){}},DataTexture:class{constructor(){this.value='blank'}dispose(){}},LinearFilter:1,RGBAFormat:1};
}
const PZ={property:{type:new Proxy({},{get:()=>1})},asset:{type:{SHADER:1}}};
function effect(){return {parentProject:{assets:{createFromPreset:()=>1}},properties:{addAll(){}}};}
function install(path){const T=three(),e=effect();new Function('PZ','THREE',read(path)).call(e,PZ,T);return {T,e};}
function renderer(){return {autoClear:true,calls:[],render(scene,camera,target){const m=scene.children[0].material,u=m.uniforms;
 const history=u.tPrev?.value?.value;
 let value;
 if(u.tPrev){value=`feedback(${u.tDiffuse.value.value},${u.hasHistory.value?history:'none'})`;this.calls.push({history,hasHistory:u.hasHistory.value});}
 else if(u.tDiffuse){value=u.tDiffuse.value.value;}
 else if(u.tHeld){value=u.tHeld.value.value;}
 else if(u.tDry){value=`mix(${u.tDry.value.value},${u.tWet.value.value})`;}
 else if(u.tBase){value=`echo(${u.tBase.value.value},${u.tTap.value.value})`;}
 target.texture.value=value;
}};}
for(const [path,name] of [['openzoid-legacy/effects/datamosh.js','DatamoshPass'],['openzoid-legacy/effects/vhs.js','VHSPass']]){
 const {T}=install(path),pass=new T[name](),r=renderer(),out=new T.WebGLRenderTarget(2,2),input={texture:{value:'same-frame'}};
 pass.render(r,out,input);const first=out.texture.value;pass.render(r,out,input);console.log(name,JSON.stringify({sameInputFirst:first,sameInputSecond:out.texture.value,historyReads:r.calls}));
}
const {T:pt,e:pe}=install('openzoid-legacy/effects/posterizetime-legacy.js');
function posterize(sequence){const e={...pe,pass:new pt.PosterizeTimePass({uniforms:{tHeld:{value:null}}}),properties:{enabled:{get:()=>1},frameRate:{get:()=>8}},parentProject:{sequence:{properties:{rate:{get:()=>30}}}}},r=renderer(),out=new pt.WebGLRenderTarget(2,2);for(const frame of sequence){e.update(frame);e.pass.render(r,out,{texture:{value:`source@${frame}`}});}return out.texture.value;}
console.log('PosterizeTimePass',JSON.stringify({forwardTo2:posterize([0,1,2]),directTo2:posterize([2]),reverseTo2:posterize([3,2])}));
const {T:et,e:ee}=install('openzoid-legacy/effects/echo-legacy.js');
function echo(sequence){const uniforms={uvScale:{value:new et.Vector2(1,1)},tBase:{value:null},tTap:{value:null},threshold:{},weight:{},wsum:{},finalize:{},useScaledBase:{}};const e={...ee,pass:new et.EchoPass({uniforms},100),properties:Object.fromEntries(Object.entries({strength:1,echoes:2,threshold:0,decay:.88,enabled:1,clearOnJump:1}).map(([k,v])=>[k,{get:()=>v}]))},r=renderer(),out=new et.WebGLRenderTarget(2,2),results=[];for(const frame of sequence){e.update(frame);e.pass.render(r,out,{texture:{value:`source@${frame}`}});results.push({frame,output:out.texture.value,valid:e.pass.valid,hold:e.pass.holdHistory});}return results;}
console.log('EchoPass',JSON.stringify({repeat:echo([0,0]),forward:echo([0,1,2]),reverse:echo([2,1,0])}));
// Instrument only the actual Particular CPU scheduling block; do not claim
// that the replacement scalar simulate routine is the real particle solver.
const particular=read('trapcode-suite/particular.js');const begin=particular.indexOf('            if (useCPU) {\n                var simTime = e / this.sceneRate();');const end=particular.indexOf('            } else {\n                this.updateGeometry();',begin);const block=particular.slice(begin,end)+'\n            }';
const run=new Function('e','useCPU','count',block);
function schedule(frames){const self={material:{},cpu:{positions:[0,0,0],phases:[0]},sceneRate:()=>30,threeObj:{geometry:{attributes:{position:{array:[]},life:{array:[]}}}},updateGeometryCPU(){},initCPU(count,time){this.cpu.positions=[0,0,0];this.initializedAt=time;},simulate(dt,time){this.cpu.positions[0]+=dt;this.steps.push({dt,time});},steps:[]};for(const f of frames)run.call(self,f,true,1);return {elapsedIntegrated:self.cpu.positions[0],initializedAt:self.initializedAt??null,steps:self.steps};}
console.log('ParticularCPU scheduling',JSON.stringify({forward6:schedule([0,1,2,3,4,5,6]),direct6:schedule([6]),sparse6:schedule([0,6]),reverse5:schedule([0,1,2,3,4,5,6,5])}));
const cameraSource=read('camera-plus/render-layer.js');const cameraBlock=cameraSource.slice(cameraSource.indexOf('PZ.compositor.prototype.applyVideoMotionBlur ='));
const ct=three(),CPZ={compositor:function(){}};class Video{};new Function('PZ','THREE','HTMLVideoElement',cameraBlock)(CPZ,ct,Video);
function makePass(kind){const uniforms=new Proxy({}, {get:(target,k)=>target[k]||(target[k]={value:new ct.Vector2(1,1)})});return {uniforms,render(r,dest){const u=uniforms;dest.texture.value=kind==='mix'?`mix(${u.tA.value.value},${u.tB.value.value})`:u.tDiffuse.value.value;}};}
function cameraRun(frames){const properties=Object.fromEntries(Object.entries({motionBlur:1,motionBlurSensitivity:100,motionBlurShutter:1,motionBlurTrackFrame:1,motionBlurVideoMode:0}).map(([k,v])=>[k,{get:()=>v}]));const self={_sequence:{properties},readBuffer:new ct.WebGLRenderTarget(2,2),videoBlurTemp:new ct.WebGLRenderTarget(2,2),videoBlurTemp2:new ct.WebGLRenderTarget(2,2),videoBlurPass:makePass('blur'),copyPass:makePass('copy'),videoMixPass:makePass('mix'),bufferParams:{}};const layer={texture:{image:new Video()},properties:{motionBlurAmount:{get:()=>1}},_renderTime:0};const results=[];for(const f of frames){layer._renderTime=f;self._sequenceTime=f;self.readBuffer.texture.value=`source@${f}`;CPZ.compositor.prototype.applyVideoMotionBlur.call(self,layer);results.push({frame:f,head:layer._mbHead,count:layer._mbCount,output:self.readBuffer.texture.value});}return results;}
console.log('Camera video history',JSON.stringify({repeat:cameraRun([0,1,2,2,2]),direct2:cameraRun([2]),reverse2:cameraRun([4,3,2])}));

```
