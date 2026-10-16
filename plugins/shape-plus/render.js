"use strict";
// WebGL1 render targets have no canvas MSAA. Render at twice the explicit
// destination viewport resolution or four times up to 2048 pixels, then
// box-resolve with bilinear taps. Every intermediate stores premultiplied RGBA.
function createRenderer(THREE, sampleScale = "auto") {
  if (!["auto", 1, 2, 4].includes(sampleScale)) throw Error("Invalid Shape+ sample scale");
  const targets = [], allocations = new Set();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  camera.position.z = 10;
  const vertexShader = "varying vec2 uvShape; void main(){uvShape=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}";
  const textureShader = "varying vec2 uvShape; uniform sampler2D image; uniform float opacity; void main(){gl_FragColor=texture2D(image,uvShape)*opacity;}";
  function material(fragmentShader, uniforms, blend = true) {
    const m = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: blend,
      blending: blend ? THREE.CustomBlending : THREE.NoBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation });
    allocations.add(m); return m;
  }
  function geometry(positions) {
    const g = new THREE.BufferGeometry();
    g.addAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    allocations.add(g); return g;
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
  let root = null, paintAllocations = new Set(), size = [0, 0], resolution = [1, 1], structureKey = null;
  function releaseTree() {
    for (const value of paintAllocations) { value.dispose(); allocations.delete(value); }
    paintAllocations.clear();
    for (const t of targets) t.dispose();
    targets.length = 0; root = null; structureKey = null;
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
      } else {
        if (!command.positions.length) { entries.push(null); continue; }
        mesh = new THREE.Mesh(geometry(command.positions), material("uniform vec3 color; uniform float opacity; void main(){gl_FragColor=vec4(color*opacity,opacity);}", { color: { value: new THREE.Color(...command.color) }, opacity: { value: command.opacity } }));
      }
      entries.push({ mesh, child, positionsKey: command.positions && JSON.stringify(command.positions) });
      mesh.renderOrder = order++; mesh.frustumCulled = false; scene.add(mesh);
    }
    return { scene, children, entries, target: target() };
  }
  function updateTree(node, commands) {
    commands.forEach((command, index) => {
      const entry = node.entries[index];
      if (!entry) return;
      entry.mesh.material.uniforms.opacity.value = command.opacity;
      if (entry.child) updateTree(entry.child, command.commands);
      else {
        entry.mesh.material.uniforms.color.value = new THREE.Color(...command.color);
        const key = JSON.stringify(command.positions);
        if (key !== entry.positionsKey) {
          const previous = entry.mesh.geometry;
          entry.mesh.geometry = geometry(command.positions); paintAllocations.add(entry.mesh.geometry);
          previous.dispose(); allocations.delete(previous); paintAllocations.delete(previous);
          entry.positionsKey = key;
        }
      }
    });
  }
  function setCommands(commands, logicalResolution) {
    const structure = list => list.map(c => c.kind === "isolation" ? [c.kind, c.id, structure(c.commands)] : [c.kind, c.id, !!c.positions.length]);
    const key = JSON.stringify([logicalResolution, structure(commands)]);
    if (root && key === structureKey) { updateTree(root, commands); return; }
    releaseTree(); resolution = logicalResolution.slice();
    const before = new Set(allocations);
    try { root = build(commands); }
    catch (error) {
      paintAllocations = new Set([...allocations].filter(value => !before.has(value)));
      releaseTree(); throw error;
    }
    paintAllocations = new Set([...allocations].filter(value => !before.has(value)));
    structureKey = key; size = [0, 0];
  }
  const shapeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100);
  shapeCamera.position.z = 10;
  function renderTree(node, renderer) {
    for (const child of node.children) renderTree(child, renderer);
    renderer.render(node.scene, shapeCamera, node.target, true);
  }
  const stats = { renders: 0, width: 0, height: 0, supersample: sampleScale };
  function render(renderer, destination) {
    if (!root) return;
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
    shapeCamera.left = -resolution[0] / 2; shapeCamera.right = resolution[0] / 2;
    shapeCamera.top = resolution[1] / 2; shapeCamera.bottom = -resolution[1] / 2; shapeCamera.updateProjectionMatrix();
    const clearColor = renderer.getClearColor().clone(), clearAlpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    try {
      renderer.setClearColor(0, 0); renderer.autoClear = true;
      renderTree(root, renderer);
      resolveMaterial.uniforms.image.value = root.target.texture;
      resolveMaterial.uniforms.texel.value.set(1 / w, 1 / h);
      resolveMaterial.uniforms.samples.value = scale;
      renderer.render(resolveScene, camera, destination, true);
      stats.renders++;
    } finally { renderer.setClearColor(clearColor, clearAlpha); renderer.autoClear = autoClear; }
  }
  function dispose() { releaseTree(); for (const resource of allocations) resource.dispose(); allocations.clear(); }
  return { render, setCommands, dispose, stats, get scene() { return root?.scene; }, camera: shapeCamera };
}
module.exports = { createRenderer };
