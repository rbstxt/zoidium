(function installSceneBackdrop(global) {
  "use strict";

  const { PZ, THREE } = global;
  const scenePrototype = PZ?.layer?.scene?.prototype;
  const passPrototype = THREE?.RenderPass?.prototype;
  if (!scenePrototype?.load || !passPrototype?.render || PZ.zoidium?.sceneBackdrop) return;

  const type = PZ.property.type;
  const mode = "zoidiumBackdropMode";
  const color = "zoidiumBackdropColor";
  const opacity = "zoidiumBackdropOpacity";
  const definitions = {
    [mode]: { name: "Scene Backdrop", type: type.OPTION, value: 0, items: ["Transparent", "Solid Color"] },
    [color]: { name: "Backdrop Color", type: type.COLOR, value: [0, 0, 0] },
    [opacity]: { name: "Backdrop Opacity", type: type.NUMBER, value: 1, min: 0, max: 1, step: 0.05, decimals: 2 },
  };
  const settings = new WeakMap();
  const load = scenePrototype.load;
  scenePrototype.load = function () {
    const properties = this.properties.childProperties;
    if (!properties[mode]) properties.addAll(definitions);
    const result = load.apply(this, arguments);
    settings.set(this.threeObj, properties);
    return result;
  };

  function clamp(value, fallback) {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
  }

  function drawColor(scene, renderer, draw) {
    const properties = settings.get(scene);
    if (properties?.[mode].get() !== 1) return draw();

    const alpha = clamp(properties[opacity].get(), 1);
    const rgb = properties[color].get() || [];
    const scale = renderer.getContextAttributes()?.premultipliedAlpha === false ? alpha : 1;
    const backdrop = new THREE.Color().setRGB(
      clamp(rgb[0], 0) * scale,
      clamp(rgb[1], 0) * scale,
      clamp(rgb[2], 0) * scale,
    );
    const previousColor = renderer.getClearColor().clone();
    const previousAlpha = renderer.getClearAlpha();
    try {
      renderer.setClearColor(backdrop, alpha);
      return draw();
    } finally {
      renderer.setClearColor(previousColor, previousAlpha);
    }
  }

  const render = passPrototype.render;
  passPrototype.render = function (renderer, target) {
    const scene = this.scene;
    if (settings.get(scene)?.[mode].get() !== 1) return render.apply(this, arguments);

    const renderScene = renderer.render;
    renderer.render = (renderedScene, camera, output, ...args) => {
      const draw = () => renderScene.call(renderer, renderedScene, camera, output, ...args);
      // The native pass may also render cube-map faces and velocity.
      if (renderedScene !== scene || camera !== this.camera || output !== target) return draw();
      return drawColor(scene, renderer, draw);
    };
    try {
      return render.apply(this, arguments);
    } finally {
      renderer.render = renderScene;
    }
  };

  PZ.zoidium = PZ.zoidium || {};
  PZ.zoidium.sceneBackdrop = { drawColor };
})(typeof window !== "undefined" ? window : globalThis);
