"use strict";

// Shared surface runtime entry: installs the PBR material behavior onto a
// donor material. Shader chunks come from surface-shader.js, material
// methods from surface-material.js, and the property table from
// surface-props.js. Loaded through plain require under Node and through
// the shared bundle module loader (`context.apis.modules.createRequire`)
// in the Zoidium runtime.

const createSurfaceShader = require("./surface-shader.js");
const installSurfaceMaterial = require("./surface-material.js");
const installSurfaceProps = require("./surface-props.js");

function installSurface(PZ, THREE, nodes, document) {
this.defaultName = "PBR Material";
    const env = { PZ, THREE, nodes, document, ...createSurfaceShader(THREE, document) };
    installSurfaceMaterial(this, env);
this.prepare = async function (e) {
    if (nodes && !this.pzUnloaded) {
        await nodes.prepareImages(nodes.parse(this.properties.graph.get()), this);
        if (!this.pzUnloaded) this.update(e);
    }
    var slots = Object.keys(this.pzImages);
    for (var i = 0; i < slots.length; i++) {
        var asset = this.pzImages[slots[i]];
        if (asset) {
            await asset.loading;
        }
    }
};
this.update = function (e) {
    var t = this.threeObj;
    var props = this.properties;
    var uniforms = this.pzUniforms;
    var rate = 30;
    if (this.parentProject && this.parentProject.sequence && this.parentProject.sequence.properties.rate) {
        rate = this.parentProject.sequence.properties.rate.get() || 30;
    }
    var time = (e || 0) / rate;
    this.pzTime = time;
    if (!this.pzBaking && this.pzBakeKey !== this.graphBakeKey(time)) {
        
        this.bakeGraph(time);
    }
    t.color.setRGB(1, 1, 1);
    t.opacity = props.opacity.get(e);
    t.bumpScale = props.bumpStrength.get(e);
    t.clearCoat = props.reflReflection.get() === 1 ? props.reflReflectionStrength.get(e) * props.reflReflectionOpacity.get(e) : 0;
    t.clearCoatRoughness = props.reflReflectionRoughness.get(e);
    t.envMapIntensity = props.reflGlobalReflectionBrightness.get(e);
    var v = props.color.get(e);
    uniforms.uPzColor.value.set(v[0], v[1], v[2]);
    uniforms.uPzRampFactor.value = props.rampFactor.get(e);
    var repeat = props.repeat.get(e);
    var offset = props.offset.get(e);
    var center = props.center.get(e);
    var rotation = props.rotation.get(e);
    this.applyUvTransform(t.map, repeat, offset, center, rotation);
    this.applyUvTransform(t.normalMap, repeat, offset, center, rotation);
    this.applyUvTransform(t.bumpMap, repeat, offset, center, rotation);
    uniforms.uPzRepeat.value.set(repeat[0], repeat[1]);
    uniforms.uPzOffset.value.set(offset[0], offset[1]);
    uniforms.uPzCenter.value.set(center[0], center[1]);
    uniforms.uPzRotation.value = rotation;
    uniforms.uPzProjRotation.value.set(...props.projRotation.get(e));
    var scale = props.projScale.get(e);
    uniforms.uPzProjScale.value.set(...(props.projLockAspect.get() === 1 ? [scale[0], scale[0], scale[0]] : scale));
    uniforms.uPzProjTranslate.value.set(...props.projTranslate.get(e));
    v = props.emissive.get(e);
    t.emissive.setRGB(v[0], v[1], v[2]);
    // A connected graph Fresnel node wins over the channel controls.
    if (!this.pzFresnel) {
        v = props.fresnelColor.get(e);
        uniforms.uPzFresnelColor.value.set(v[0], v[1], v[2]);
        uniforms.uPzFresnelPower.value = props.fresnelPower.get(e);
        uniforms.uPzFresnelMix.value = props.fresnelMixStrength.get(e);
    }
    uniforms.uPzAOIntensity.value = props.aoIntensity.get(e);
    uniforms.uPzAODistance.value = props.aoDistance.get(e);
    v = props.aoColor.get(e);
    uniforms.uPzAOColor.value.set(v[0], v[1], v[2]);
    uniforms.uPzCelSteps.value = props.celSteps.get(e);
    uniforms.uPzCelSmoothness.value = props.celSmoothness.get(e);
    uniforms.uPzCelSpecularSteps.value = props.celSpecularSteps.get(e);
    uniforms.uPzSpecularStrength.value = props.reflSpecularStrength.get(e);
    uniforms.uPzSpecularEnabled.value = props.reflSpecular.get() === 1 ? 1 : 0;
    uniforms.uPzSpecularOpacity.value = props.reflSpecularOpacity.get(e);
};
    installSurfaceProps(this, env);
delete this.props.nodeEditor;
this.props.graph.value = JSON.stringify({ schemaVersion: 1, nodes: [{ id: "output", type: "output", x: 640, y: 80, params: {} }], links: [] });
this.props.aoEnabled.name = "Ambient occlusion map";
this.props.aoTexture.name = "Ambient occlusion map texture";
this.properties.addAll(this.props);

}

module.exports = installSurface;
