"use strict";

const STORAGE_KEY = "zoidium.player-plus.transparency-grid";
const BUTTON_CLASS = "zoidium-player-plus-transparency-grid";
const style = `
  .zoidium-player-plus-transparency-grid {
    color: var(--zui-text-muted, #acacac);
  }
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
      const renderTransparent = window.PZ?.zoidium?.alphaExportRender?.drawTransparentSequence;
      if (!enabled || !THREE || !renderTransparent) return draw();
      const { compositor, renderer, canvas } = viewport;
      return renderTransparent(compositor, THREE.NoBlending, (render, scene, camera, forceClear) => {
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

module.exports = { createTransparencyGrid, BUTTON_CLASS, style };
