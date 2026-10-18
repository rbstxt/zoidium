"use strict";

// Native ASSET properties give Environment the same save, retention, Replace,
// missing-file and undo behavior as the other Material+ image slots.
module.exports = function installSurfaceControls(target, { PZ, THREE, document }) {
    const number = (name, value, max) => ({ name, dynamic: true, type: PZ.property.type.NUMBER,
        value, min: 0, ...(max === undefined ? {} : { max }), step: 0.01 });
    Object.assign(target.props, {
        emissionStrength: number("Emission strength", 1),
        clearcoat: number("Clearcoat", 0, 1),
        clearcoatRoughness: number("Clearcoat roughness", 0, 1),
        reflectivity: number("Reflectivity", 0.5, 1),
        environment: { name: "Environment image", type: PZ.property.type.ASSET,
            assetType: PZ.asset.type.IMAGE, accept: "image/*", value: null,
            changed() {
                const m = this.parentObject;
                if (!m.pzLoading && !m._zoidiumLoading && m.threeObj) m.pzLoadEnvironment();
            } },
        environmentIntensity: number("Environment intensity", 1),
        environmentRotation: { name: "Environment rotation", dynamic: true, type: PZ.property.type.NUMBER,
            value: 0, step: 0.5, scaleFactor: Math.PI / 180 },
        shadowSide: { name: "Shadow side", type: PZ.property.type.OPTION,
            value: 0, items: "Auto;Front;Back;Double", changed() {
                const m = this.parentObject;
                if (!m.pzLoading && !m._zoidiumLoading && m.threeObj) m.pzSyncShadowSide();
            } },
    });
    target.pzSyncShadowSide = function () {
        const side = this.properties.shadowSide.get();
        this.threeObj.shadowSide = side ? [null, THREE.FrontSide, THREE.BackSide, THREE.DoubleSide][side]
            : this.properties.side.get() === 2 ? THREE.BackSide : null;
    };
    target.pzDisposeEnvironment = function () {
        const entry = this.pzEnvironment;
        this.pzEnvironment = null;
        if (!entry) return;
        entry.disposed = true;
        if (this.threeObj?.envMap === entry.texture) this.threeObj.envMap = null;
        entry.texture?.dispose();
        if (entry.asset) this.parentProject.assets.unload(entry.asset);
    };
    target.pzLoadEnvironment = function () {
        this.pzDisposeEnvironment();
        const key = this.properties.environment.get();
        if (!key) {
            this.initReflection();
            this.updateDefines();
            return;
        }
        const entry = this.pzEnvironment = { key, asset: null, texture: null, disposed: false };
        const failed = error => {
            if (entry.disposed) return;
            // Keep the authored reference even when decoding fails. Locate or
            // Reload in Assets can restore it without changing the project.
            console.warn("[Zoidium] Material+: could not decode an environment image", error);
        };
        try {
            entry.asset = this.parentProject.assets.load(key);
            const image = entry.image = new PZ.asset.image(entry.asset);
            image.getImage();
            entry.loading = Promise.resolve(image.loading).then(() => {
                if (entry.disposed) return;
                const source = image.getImage();
                if (!source?.width || !source?.height) return;
                // WebGL 1 needs power-of-two images for roughness mip sampling.
                // Native project images are LDR; intensity supplies exposure.
                const canvas = document.createElement("canvas");
                canvas.width = 2 ** Math.floor(Math.log2(Math.min(4096, source.width)));
                canvas.height = 2 ** Math.floor(Math.log2(Math.min(2048, source.height)));
                canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
                const texture = entry.texture = new THREE.CanvasTexture(canvas);
                texture.mapping = THREE.EquirectangularReflectionMapping;
                texture.minFilter = THREE.LinearMipmapLinearFilter ?? THREE.LinearMipMapLinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.generateMipmaps = true;
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                texture.needsUpdate = true;
                this.initReflection();
                this.updateDefines();
            }).catch(failed);
        } catch (error) { failed(error); entry.loading = Promise.resolve(); }
    };
    target.pzUpdateSurfaceControls = function (frame) {
        const props = this.properties;
        const t = this.threeObj;
        if (props.reflReflection.get() !== 1) {
            t.clearCoat = props.clearcoat.get(frame);
            t.clearCoatRoughness = props.clearcoatRoughness.get(frame);
        }
        t.reflectivity = props.reflectivity.get(frame);
        this.pzUniforms.uPzEmissionStrength.value = props.emissionStrength.get(frame);
        this.pzUniforms.uPzEnvironmentRotation.value = props.environmentRotation.get(frame);
        if (this.pzEnvironment?.texture) {
            const brightness = this._nodeBaseMap ? props.reflectionBrightness.get(frame)
                : props.reflectionIntensity.get(frame) * props.reflGlobalReflectionBrightness.get(frame);
            t.envMapIntensity = brightness * props.environmentIntensity.get(frame);
        }
        this.pzSyncShadowSide();
    };
};
