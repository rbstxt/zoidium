"use strict";

const STORAGE_KEY = "zoidium.player-plus.transparency-grid";
const BUTTON_CLASS = "zoidium-player-plus-transparency-grid";
const style = `
  .zoidium-player-plus-transparency-grid[aria-pressed="true"] {
    color: var(--zui-value);
  }
  .zoidium-player-plus-transparency-grid::before {
    content: "";
    display: inline-block;
    width: 14px;
    height: 14px;
    vertical-align: middle;
    border: 1px solid currentColor;
    background: conic-gradient(transparent 25%, currentColor 0 50%, transparent 0 75%, currentColor 0)
      0 0 / 7px 7px;
  }
`;

function drawTransparencyGrid(viewport, noBlending, display, draw) {
  const { compositor, renderer } = viewport;
  const clear = compositor.clear;
  const ownClear = Object.hasOwn(compositor, "clear");
  const render = renderer.render;
  const color = renderer.getClearColor().clone();
  const alpha = renderer.getClearAlpha();
  let sequenceStarted = false;

  compositor.clear = function (index) {
    // The native and shared-camera compositors both start each sample here.
    if (index !== 0 || renderer.getClearAlpha() !== 1) return clear.apply(this, arguments);
    sequenceStarted = true;
    renderer.setClearColor(0, 0);
    try { return clear.apply(this, arguments); }
    finally { renderer.setClearColor(0, 1); }
  };
  renderer.render = function (scene, camera, target, forceClear) {
    if (!sequenceStarted || target !== null || forceClear !== true) return render.apply(this, arguments);
    // The final native copy normally blends to an opaque default framebuffer.
    // Preserve the premultiplied sample when copying to the display target.
    const material = compositor.copyPass.material;
    const blending = material.blending;
    material.blending = noBlending;
    try { return display(render, scene, camera, forceClear); }
    finally { material.blending = blending; }
  };
  try {
    // The compositor clears its motion-blur accumulation buffer first.
    renderer.setClearColor(0, 0);
    return draw();
  } finally {
    renderer.render = render;
    if (ownClear) compositor.clear = clear;
    else delete compositor.clear;
    renderer.setClearColor(color, alpha);
  }
}

function createTransparencyGrid(window) {
  let enabled = false;
  let button;
  let target;
  let pass;
  try { enabled = window.localStorage?.getItem(STORAGE_KEY) === "true"; }
  catch (_error) { /* Storage is optional. */ }

  function updateButton() {
    button?.setAttribute("aria-pressed", String(enabled));
  }

  const grid = {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { window.localStorage?.setItem(STORAGE_KEY, String(enabled)); }
      catch (_error) { /* Retain the preference for this session. */ }
      updateButton();
    },
    installButton(document, toolbar, nextSibling, refresh) {
      button?.remove();
      button = document.createElement("button");
      button.className = BUTTON_CLASS;
      button.type = "button";
      button.title = "Show transparency grid";
      button.setAttribute("aria-label", button.title);
      updateButton();
      button.addEventListener("click", () => {
        grid.toggle();
        refresh();
      });
      toolbar.insertBefore(button, nextSibling);
    },
    draw(viewport, draw) {
      const THREE = window.THREE;
      if (!enabled || !THREE) return draw();
      const { renderer, canvas } = viewport;
      return drawTransparencyGrid(viewport, THREE.NoBlending, (render, scene, camera, forceClear) => {
        if (!pass) {
          target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false });
          pass = new THREE.ShaderPass(new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            blending: THREE.NoBlending,
            uniforms: { image: { value: target.texture }, size: { value: new THREE.Vector2() } },
            vertexShader: `
              varying vec2 vUv;
              void main() {
                vUv = uv;
                gl_Position = vec4(position.xy, 0.0, 1.0);
              }
            `,
            fragmentShader: `
              uniform sampler2D image;
              uniform vec2 size;
              varying vec2 vUv;
              void main() {
                vec4 color = texture2D(image, vUv);
                vec2 tile = floor(vec2(vUv.x, 1.0 - vUv.y) * size / 8.0);
                float checker = mix(0.44, 0.66, mod(tile.x + tile.y, 2.0));
                gl_FragColor = vec4(color.rgb + vec3(checker * (1.0 - clamp(color.a, 0.0, 1.0))), 1.0);
              }
            `,
          }));
        }
        const { width, height } = renderer.getDrawingBufferSize();
        target.setSize(width, height);
        pass.uniforms.size.value.set(parseFloat(canvas.style.width) || width, parseFloat(canvas.style.height) || height);
        render.call(renderer, scene, camera, target, forceClear);
        return render.call(renderer, pass.scene, pass.camera, null, true);
      }, draw);
    },
    dispose() {
      button?.remove();
      target?.dispose();
      pass?.material.dispose();
      pass?.quad.geometry.dispose();
      button = target = pass = null;
    },
  };
  return grid;
}

module.exports = { createTransparencyGrid, drawTransparencyGrid, BUTTON_CLASS, style };
