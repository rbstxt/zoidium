"use strict";

(function (root) {
  // Fixed host shader. Packages supply only validated numeric plans.
  function create(THREE, template) {
    const uniforms = { gain: { value: 1 } };
    let declarations = "uniform float gain; varying vec2 vUv;", sum = "vec4 c=vec4(0.0);";
    for (let i = 0; i < 8; i++) {
      uniforms["tap" + i] = { value: null };
      uniforms["weight" + i] = { value: 0 };
      uniforms["scale" + i] = { value: new THREE.Vector2(1, 1) };
      declarations += `uniform sampler2D tap${i}; uniform float weight${i}; uniform vec2 scale${i};`;
      sum += `if(weight${i}>0.0)c+=texture2D(tap${i},vUv*scale${i})*weight${i};`;
    }
    const material = new THREE.ShaderMaterial({ uniforms,
      vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: declarations + "void main(){" + sum + "gl_FragColor=" +
        (template === "gain-v1" ? "vec4(c.rgb*gain,c.a)" : "c") + ";}",
      depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    const pass = new THREE.ShaderPass(material);
    return {
      render(renderer, writeBuffer, readBuffer, plan, gain) {
        uniforms.gain.value = gain;
        for (let i = 0; i < 8; i++) {
          const sample = plan.samples[i];
          uniforms["tap" + i].value = sample?.texture || readBuffer.texture;
          uniforms["weight" + i].value = plan.weights[i] || 0;
          if (sample) uniforms["scale" + i].value.set(sample.target.viewport.z / sample.target.width,
            sample.target.viewport.w / sample.target.height);
        }
        pass.render(renderer, writeBuffer, readBuffer, true);
        for (let i = 0; i < 8; i++) uniforms["tap" + i].value = null;
      },
      release() { material.dispose(); pass.quad?.geometry?.dispose(); },
    };
  }
  if (typeof module === "object" && module.exports) module.exports = { create };
  else root.ZoidiumCommunityTemporalPass = { create };
})(globalThis);
