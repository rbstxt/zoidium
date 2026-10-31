"use strict";
// WebGL1 render targets have no canvas MSAA. Render at twice the explicit
// destination viewport resolution or four times up to 2048 pixels, then
// box-resolve with bilinear taps. Every intermediate stores premultiplied RGBA.
// An optional 2D affine [a, b, c, d, e, f] (x' = a*x + c*y + e,
// y' = b*x + d*y + f) bakes the layer transform into the rasterization so the
// output is already in composition space and stays vector-sharp at any scale.
// Unchanged content, target size and transform reuse the previous raster and
// only repeat the resolve into the (shared) destination.
const paintShader = require("./paint-shader.js");
function inverseAffine(t) {
  if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite)) return null;
  const [a, b, c, d, e, f] = t, det = a * d - b * c;
  if (!(Math.abs(det) > 1e-12)) return null;
  const inverse = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  return inverse.every(Number.isFinite) ? inverse : null;
}
function setAffine(matrix, t, z) { matrix.set(t[0], t[2], 0, t[4], t[1], t[3], 0, t[5], 0, 0, 1, z, 0, 0, 0, 1); }
function createRenderer(THREE, sampleScale = "auto") {
  if (!["auto", 1, 2, 4].includes(sampleScale)) throw Error("Invalid Shape+ sample scale");
  const targets = [], allocations = new Set();
  // Retain one warm material per shader variant through structural changes.
  // Three otherwise releases its last program before replacement meshes draw.
  const warmMaterials = new Map(), materialKeys = new WeakMap();
  let borrowedMaterials = new Set();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  camera.position.z = 10;
  const vertexShader = "varying vec2 uvShape; void main(){uvShape=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  const textureShader = "varying vec2 uvShape; uniform sampler2D image; uniform float opacity; void main(){gl_FragColor=texture2D(image,uvShape)*opacity;}";
  function material(fragmentShader, uniforms, blend = true, vertex = vertexShader) {
    const key = JSON.stringify([vertex, fragmentShader, blend]);
    const warm = warmMaterials.get(key);
    if (warm) {
      warmMaterials.delete(key); borrowedMaterials.add(warm);
      for (const name of Object.keys(uniforms)) warm.uniforms[name].value = uniforms[name].value;
      return warm;
    }
    const m = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader, uniforms, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: blend,
      blending: blend ? THREE.CustomBlending : THREE.NoBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation });
    allocations.add(m); materialKeys.set(m, key); return m;
  }
  function geometry(positions) {
    const values = new Float32Array(positions);
    if (!values.every(Number.isFinite)) throw Error("Shape+ geometry exceeds Float32 range");
    const g = new THREE.BufferGeometry();
    g.addAttribute("position", new THREE.BufferAttribute(values, 3));
    allocations.add(g); return g;
  }
  const coverageGeometries = new Map();
  function coverageGeometry(positions) {
    let entry=coverageGeometries.get(positions);
    if(!entry) {entry={geometry:geometry(positions),count:0};coverageGeometries.set(positions,entry);}
    entry.count++;return entry.geometry;
  }
  function releaseCoverage(positions) {
    const entry=coverageGeometries.get(positions);
    if(entry && --entry.count===0) {
      entry.geometry.dispose();allocations.delete(entry.geometry);paintAllocations.delete(entry.geometry);coverageGeometries.delete(positions);
    }
  }
  function coverageTransform(mesh,command) {
    const m=command.coverageMatrix;
    if(!m){if(mesh.matrixAutoUpdate===false){mesh.matrix.identity();mesh.matrixAutoUpdate=true;}return;}
    mesh.matrixAutoUpdate=false;
    mesh.matrix.set(m[0],m[2],0,m[4],m[1],m[3],0,m[5],0,0,1,0,0,0,0,1);
  }
  function plane() { const g = new THREE.PlaneBufferGeometry(2, 2); allocations.add(g); return g; }
  const resolveScene = new THREE.Scene();
  const resolveShader = "varying vec2 uvShape; uniform sampler2D image; uniform vec2 texel; uniform float samples; void main(){if(samples>2.5){vec4 c=texture2D(image,uvShape+texel)+texture2D(image,uvShape-texel)+texture2D(image,uvShape+vec2(texel.x,-texel.y))+texture2D(image,uvShape+vec2(-texel.x,texel.y));gl_FragColor=c*.25;}else{gl_FragColor=texture2D(image,uvShape);}}";
  const resolveMaterial = material(resolveShader, { image: { value: null }, samples: { value: 2 }, texel: { value: new THREE.Vector2() } }, false);
  resolveScene.add(new THREE.Mesh(plane(), resolveMaterial));
  function target() {
    const t = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
    t.texture.generateMipmaps = false; targets.push(t); return t;
  }
  let coverageTarget = null;
  let root = null, paintAllocations = new Set(), size = [0, 0], resolution = [1, 1], structureKey = null;
  // Full-frame planes that composite isolated child targets; they must stay
  // screen-aligned when a layer transform is baked into the camera.
  const planes = [];
  // appliedTransform: undefined = unknown (force), null = identity, else the key.
  let contentVersion = 0, rasterKey = null, rasterRenderer = null, appliedTransform;
  function releaseTree() {
    for (const value of paintAllocations) {
      const key = materialKeys.get(value);
      if (key && !warmMaterials.has(key)) warmMaterials.set(key, value);
      else { value.dispose(); allocations.delete(value); }
    }
    paintAllocations.clear(); coverageGeometries.clear();
    for (const t of targets) t.dispose();
    targets.length = 0; coverageTarget = null; root = null; structureKey = null;
    planes.length = 0; rasterKey = null; appliedTransform = undefined; contentVersion++;
  }
  function build(commands) {
    const scene = new THREE.Scene(), children = [], entries = [];
    let order = 0;
    for (const command of commands) {
      let mesh, child = null;
      if (command.kind === "isolation") {
        child = build(command.commands); children.push(child);
        const g = plane(); g.scale(resolution[0] / 2, resolution[1] / 2, 1);
        mesh = new THREE.Mesh(g, material(textureShader, { image: { value: child.target.texture }, opacity: { value: command.opacity } }));
        planes.push(mesh);
      } else {
        if (!command.positions.length) { entries.push(null); continue; }
        let fragment = command.gradient ? paintShader.fragmentShader : "uniform vec3 color; uniform float opacity; void main(){gl_FragColor=vec4(color*opacity,opacity);}";
        const uniforms = command.gradient ? paintShader.uniforms(THREE, command) : { color: { value: new THREE.Color(...command.color) }, opacity: { value: command.opacity } };
        if (command.coverage) {
          const scene = new THREE.Scene();
          const coverageMesh = new THREE.Mesh(coverageGeometry(command.coverage), material("void main(){gl_FragColor=vec4(1.0);}", {}, false));
          coverageTransform(coverageMesh,command);
          coverageMesh.frustumCulled = false; scene.add(coverageMesh);
          child = { scene, children: [], entries: [], target: coverageTarget || (coverageTarget = target()), coverageMesh, coverage:command.coverage };
          children.push(child);
          uniforms.coverage = { value: child.target.texture };
          uniforms.coverageSize = { value: new THREE.Vector2() };
          fragment = "uniform sampler2D coverage; uniform vec2 coverageSize;\n" + fragment.replace(/}\s*$/, "gl_FragColor*=texture2D(coverage,gl_FragCoord.xy/coverageSize);}");
        }
        mesh = new THREE.Mesh(geometry(command.positions), material(fragment, uniforms, true, command.gradient ? paintShader.vertexShader : vertexShader));
      }
      const singleScene = new THREE.Scene(); singleScene.children.push(mesh);
      entries.push({ mesh, child, singleScene, positionsSnapshot: command.positions && Float64Array.from(command.positions) });
      mesh.renderOrder = order++; mesh.frustumCulled = false; scene.add(mesh);
    }
    return { scene, children, entries, target: target() };
  }
  function updateTree(node, commands) {
    commands.forEach((command, index) => {
      const entry = node.entries[index];
      if (!entry) return;
      entry.mesh.material.uniforms.opacity.value = command.opacity;
      if (entry.child && !entry.child.coverageMesh) updateTree(entry.child, command.commands);
      else {
        if (entry.child?.coverageMesh) {
          if (command.coverage !== entry.child.coverage) {
            const previous = entry.child.coverage;
            entry.child.coverageMesh.geometry = coverageGeometry(command.coverage);paintAllocations.add(entry.child.coverageMesh.geometry);
            releaseCoverage(previous);entry.child.coverage=command.coverage;
          }
          coverageTransform(entry.child.coverageMesh,command);
        }
        if (command.gradient) {
          const uniforms = paintShader.uniforms(THREE, command);
          for (const key of Object.keys(uniforms)) entry.mesh.material.uniforms[key].value = uniforms[key].value;
        } else entry.mesh.material.uniforms.color.value = new THREE.Color(...command.color);
        const changed = command.positions.length !== entry.positionsSnapshot.length || command.positions.some((value,i)=>value!==entry.positionsSnapshot[i]);
        if (changed) {
          if (command.positions.length === entry.positionsSnapshot.length) {
            // Equal element counts reuse the GPU buffer: copy the new Float32
            // values into the existing attribute and flag it with the r91
            // update mechanism instead of reallocating. A changed length keeps
            // the dispose-and-replace route below.
            const values = new Float32Array(command.positions);
            if (!values.every(Number.isFinite)) throw Error("Shape+ geometry exceeds Float32 range");
            const attribute = typeof entry.mesh.geometry.getAttribute === "function"
              ? entry.mesh.geometry.getAttribute("position")
              : entry.mesh.geometry.attributes.position;
            attribute.array.set(values);
            attribute.needsUpdate = true;
            entry.positionsSnapshot = Float64Array.from(command.positions);
          } else {
            const previous = entry.mesh.geometry;
            entry.mesh.geometry = geometry(command.positions); paintAllocations.add(entry.mesh.geometry);
            previous.dispose(); allocations.delete(previous); paintAllocations.delete(previous);
            entry.positionsSnapshot = Float64Array.from(command.positions);
          }
        }
      }
    });
  }
  function setCommands(commands, logicalResolution) {
    const structure = list => list.map(c => c.kind === "isolation" ? [c.kind, c.id, structure(c.commands)] : [c.kind, c.id, !!c.positions.length, !!c.gradient, !!c.coverage]);
    const key = JSON.stringify([logicalResolution, structure(commands)]);
    // Callers only pass changed commands; every call invalidates the raster.
    contentVersion++; rasterKey = null;
    if (root && key === structureKey) { updateTree(root, commands); return; }
    releaseTree(); resolution = logicalResolution.slice();
    const before = new Set(allocations); borrowedMaterials = new Set();
    try { root = build(commands); }
    catch (error) {
      paintAllocations = new Set([...borrowedMaterials, ...[...allocations].filter(value => !before.has(value))]);
      releaseTree(); throw error;
    }
    paintAllocations = new Set([...borrowedMaterials, ...[...allocations].filter(value => !before.has(value))]);
    structureKey = key; size = [0, 0];
  }
  const shapeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  shapeCamera.position.z = 10;
  function renderTree(node, renderer) {
    for (const child of node.children) if (!child.coverageMesh) renderTree(child, renderer);
    for (const entry of node.entries) if (entry?.mesh.material.uniforms.coverageSize) entry.mesh.material.uniforms.coverageSize.value.set(size[0], size[1]);
    if (node.entries.some(entry=>entry?.child?.coverageMesh)) {
      // All stroke masks share one target. Consume each mask immediately,
      // before the next paint overwrites it, in the normal paint order.
      const autoClear=renderer.autoClear;let first=true;
      try {
        renderer.autoClear=false;
        for (const entry of node.entries) if (entry) {
          if (entry.child?.coverageMesh) renderer.render(entry.child.scene,shapeCamera,entry.child.target,true);
          renderer.render(entry.singleScene,shapeCamera,node.target,first);first=false;
        }
      } finally {renderer.autoClear=autoClear;}
    } else renderer.render(node.scene, shapeCamera, node.target, true);
  }
  // r91 Camera.updateMatrixWorld rebuilds matrixWorldInverse from matrix, so a
  // camera at L^-1 * T(0, 0, 10) draws content at L. Isolation planes use L^-1
  // so the view cancels it and their comp-space child targets stay aligned.
  function applyTransform(inverse) {
    const key = inverse ? inverse.join() : null;
    if (key === appliedTransform) return;
    appliedTransform = key;
    if (inverse) setAffine(shapeCamera.matrix, inverse, 10);
    shapeCamera.matrixAutoUpdate = !inverse; shapeCamera.matrixWorldNeedsUpdate = true;
    for (const mesh of planes) {
      if (inverse) setAffine(mesh.matrix, inverse, 0);
      mesh.matrixAutoUpdate = !inverse; mesh.matrixWorldNeedsUpdate = true;
    }
  }
  const stats = { renders: 0, treeRenders: 0, skips: 0, width: 0, height: 0, supersample: sampleScale, transform: null };
  function render(renderer, destination, transform = null) {
    if (!root) return;
    const inverse = transform == null ? null : inverseAffine(transform);
    if (transform != null && !inverse) throw Error("Invalid Shape+ layer transform");
    const width = Math.max(1, Math.round(destination.viewport.z)), height = Math.max(1, Math.round(destination.viewport.w));
    const scale = sampleScale === "auto" ? (Math.max(width, height) <= 2048 && width * height * 16 * targets.length <= 67108864 ? 4 : 2) : sampleScale;
    const w = width * scale, h = height * scale;
    stats.supersample = scale;
    const max = renderer.capabilities.maxTextureSize;
    if (w > max || h > max || w * h * targets.length > 67108864) throw Error("Shape+ antialiasing target budget exceeded");
    if (size[0] !== w || size[1] !== h) {
      for (const t of targets) t.setSize(w, h);
      size = [w, h]; stats.width = w; stats.height = h;
    }
    const key = JSON.stringify([contentVersion, w, h, inverse && transform]);
    const cached = key === rasterKey && renderer === rasterRenderer;
    stats.transform = inverse ? transform.slice() : null;
    const clearColor = renderer.getClearColor().clone(), clearAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    const previousTarget = renderer.getRenderTarget?.();
    try {
      renderer.setClearColor(0, 0); renderer.autoClear = true;
      if (cached) stats.skips++;
      else {
        rasterKey = null;
        shapeCamera.left = -resolution[0] / 2; shapeCamera.right = resolution[0] / 2;
        shapeCamera.top = resolution[1] / 2; shapeCamera.bottom = -resolution[1] / 2; shapeCamera.updateProjectionMatrix();
        applyTransform(inverse);
        renderTree(root, renderer);
        rasterKey = key; rasterRenderer = renderer; stats.treeRenders++;
      }
      resolveMaterial.uniforms.image.value = root.target.texture;
      resolveMaterial.uniforms.texel.value.set(1 / w, 1 / h);
      resolveMaterial.uniforms.samples.value = scale;
      renderer.render(resolveScene, camera, destination, true);
      stats.renders++;
    } catch (error) {
      renderer.state?.reset();
      throw error;
    } finally { renderer.setClearColor(clearColor, clearAlpha); renderer.autoClear = autoClear;
      if (renderer.setRenderTarget && previousTarget !== undefined) renderer.setRenderTarget(previousTarget);
    }
  }
  function dispose() { releaseTree(); for (const resource of allocations) resource.dispose(); allocations.clear(); warmMaterials.clear(); }
  return { render, setCommands, dispose, stats, get scene() { return root?.scene; }, camera: shapeCamera };
}
module.exports = { createRenderer };
