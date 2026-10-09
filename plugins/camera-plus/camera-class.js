// Camera+ object: a standalone perspective camera with film controls,
// depth of field, and vibrate. It is a separate object type, so the CM3
// camera (PZ.object3d.camera) keeps its vanilla class and behavior. A scene
// renders through a Camera+ only while that object is active; see
// camera-runtime.js for the selection rule.
//
// Evaluated with (PZ, THREE, parts) by camera-runtime.js; publishes parts.camera.
parts.camera = (function () {
  const OBJECT_TYPE = "zoidium:camera-plus/camera";
  const FOCUS_CONTROL_ID = "camera-plus/focus-tools";
  const SCHEMA_VERSION = 1;

  const FILM_GATES = [
    { name: "Classic 35 (36mm)", value: 36 },
    { name: "Photo 35 (36mm)", value: 36 },
    { name: "Full 35 (36mm)", value: 36 },
    { name: "Academy (21.95mm)", value: 21.95 },
    { name: "Super 35 (24.89mm)", value: 24.89 },
    { name: "APS-C (23.6mm)", value: 23.6 },
    { name: "APS-C C (22.3mm)", value: 22.3 },
    { name: "MFT (17.3mm)", value: 17.3 },
    { name: "1 inch (13.2mm)", value: 13.2 },
    { name: "2/3 inch (8.8mm)", value: 8.8 },
    { name: "Super 16 (12.52mm)", value: 12.52 },
    { name: "16 mm (10.26mm)", value: 10.26 },
  ];

  // Fresh definition objects on every call: CM3 property.create may mutate
  // the definition it receives.
  function createDefinitions(PZ) {
    const T = PZ.property.type;
    return {
      name: { visible: false, name: "Name", type: T.TEXT, value: "Camera+" },
      active: { name: "Active Camera", type: T.OPTION, value: 1, items: "off;on" },
      position: {
        dynamic: true,
        group: true,
        objects: [
          { dynamic: true, name: "Position.X", type: T.NUMBER, value: 0, step: 1, decimals: 2 },
          { dynamic: true, name: "Position.Y", type: T.NUMBER, value: 0, step: 1, decimals: 2 },
          { dynamic: true, name: "Position.Z", type: T.NUMBER, value: 80, step: 1, decimals: 2 },
        ],
        name: "Position",
        type: T.VECTOR3,
      },
      rotation: {
        dynamic: true,
        group: true,
        objects: [
          { dynamic: true, name: "Rotation.X", type: T.NUMBER, value: 0, scaleFactor: Math.PI / 180, step: 1 },
          { dynamic: true, name: "Rotation.Y", type: T.NUMBER, value: 0, scaleFactor: Math.PI / 180, step: 1 },
          { dynamic: true, name: "Rotation.Z", type: T.NUMBER, value: 0, scaleFactor: Math.PI / 180, step: 1 },
        ],
        name: "Rotation",
        type: T.VECTOR3,
        scaleFactor: Math.PI / 180,
      },
      eulerOrder: {
        name: "Rotation order",
        type: T.LIST,
        value: "XYZ",
        items: PZ.object3d.eulerOrders,
        changed: function () {
          this.parentObject.threeObj.rotation.order = this.value;
        },
      },
      projection: { name: "Projection", type: T.LIST, value: "perspective", items: [{ name: "Perspective", value: "perspective" }, { name: "Orthographic", value: "orthographic" }] },
      focalLength: { dynamic: true, name: "Focal Length", type: T.NUMBER, value: 35, min: 1, max: 10000, step: 1, decimals: 2 },
      filmGate: { name: "Sensor", type: T.LIST, value: 36, items: FILM_GATES.map((gate) => ({ name: gate.name, value: gate.value })) },
      zoom: { dynamic: true, name: "Zoom", type: T.NUMBER, value: 1, min: 0.01, max: 1000, step: 0.01, decimals: 2 },
      filmOffsetX: { dynamic: true, name: "Film Offset X", type: T.NUMBER, value: 0, min: -1000, max: 1000, step: 0.1, decimals: 2 },
      filmOffsetY: { dynamic: true, name: "Film Offset Y", type: T.NUMBER, value: 0, min: -1000, max: 1000, step: 0.1, decimals: 2 },
    };
  }

  function createDepthOfFieldProperties(PZ) {
    const T = PZ.property.type;
    const list = new PZ.propertyList({
      enabled: { dynamic: true, name: "Depth of Field", type: T.OPTION, value: 0, items: "off;on" },
      focusDistance: { dynamic: true, name: "Focus Distance", type: T.NUMBER, value: 80, min: 0, max: 5000, step: 1, decimals: 2 },
      aperture: { dynamic: true, name: "Aperture", type: T.NUMBER, value: 3, min: 0, max: 40, step: 0.1, decimals: 1 },
      focusAreaWidth: { dynamic: true, name: "Focus Width", type: T.NUMBER, value: 0, min: 0, max: 4000, step: 1, decimals: 0 },
      nearBlurLevel: { dynamic: true, name: "Near Blur Level", type: T.NUMBER, value: 100, min: 0, max: 400, step: 1, decimals: 0 },
      farBlurLevel: { dynamic: true, name: "Far Blur Level", type: T.NUMBER, value: 100, min: 0, max: 400, step: 1, decimals: 0 },
      focusTools: { name: "Focus", type: T.TEXT, value: "", zoidiumControl: FOCUS_CONTROL_ID },
    });
    Object.defineProperty(list, "displayName", { value: "Depth of Field", writable: true });
    return list;
  }

  function createMotionBlurProperties(PZ) {
    const T = PZ.property.type;
    const list = new PZ.propertyList({
      enabled: { name: "Camera Motion Blur", type: T.OPTION, value: 0, items: "off;on" },
      samples: { name: "Samples", type: T.NUMBER, value: 4, min: 1, max: 8, step: 1, decimals: 0 },
      shutter: { dynamic: true, name: "Shutter (frames)", type: T.NUMBER, value: 0.5, min: 0, max: 2, step: 0.05, decimals: 2 },
    });
    Object.defineProperty(list, "displayName", { value: "Motion Blur", writable: true });
    return list;
  }

  // Reads a dynamic property at time t, falling back when the value is not
  // finite (for example a broken focus expression).
  function readNumber(property, time, fallback) {
    try {
      const value = property.get(time);
      return typeof value === "number" && isFinite(value) ? value : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  // World-space distance between two Camera+/object3d instances. Matrices
  // are refreshed first so the result reflects the current transforms.
  function worldDistance(THREE, from, to) {
    from.threeObj.updateMatrixWorld(true);
    to.threeObj.updateMatrixWorld(true);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    from.threeObj.getWorldPosition(a);
    to.threeObj.getWorldPosition(b);
    return a.distanceTo(b);
  }

  function createClass(PZ, THREE, vibrate) {
    class CameraPlus extends PZ.object3d {
      constructor() {
        super();
        this.threeObj = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
        this.vibrateProperties = vibrate.createProperties(PZ);
        this._time = 0;
        this.properties.addAll(createDefinitions(PZ));
        this.properties.add("depthOfField", createDepthOfFieldProperties(PZ));
        this.properties.add("vibrate", this.vibrateProperties);
        this.properties.add("motionBlur", createMotionBlurProperties(PZ));
      }

      load(data) {
        this.properties.load(data && data.properties);
        this.threeObj.rotation.order = this.properties.eulerOrder.get();
        this.updateProjection(this._time);
      }

      toJSON() {
        return { type: this.type, schemaVersion: SCHEMA_VERSION, properties: this.properties };
      }

      isActive() {
        return this.properties.active.get() === 1;
      }

      // Perspective film model, matching the CM3 camera's film math.
      updateProjection(time) {
        const p = this.properties;
        const orthographic = p.projection.get() === "orthographic";
        if (orthographic !== Boolean(this.threeObj.isOrthographicCamera)) {
          const previous = this.threeObj;
          const parent = previous.parent;
          this.threeObj = orthographic
            ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000)
            : new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
          this.threeObj.rotation.order = p.eulerOrder.get();
          if (parent) { parent.remove(previous); parent.add(this.threeObj); }
        }
        const camera = this.threeObj;
        const resolution = this.getSequenceResolution();
        const gate = p.filmGate.get(time);
        const focal = p.focalLength.get(time);
        const zoom = p.zoom.get(time);
        const offsetX = p.filmOffsetX.get(time);
        const offsetY = p.filmOffsetY.get(time);
        if (orthographic) {
          const halfWidth = 0.05 * resolution[0] / Math.max(zoom, 0.0001);
          const halfHeight = 0.05 * resolution[1] / Math.max(zoom, 0.0001);
          const x = 2 * halfWidth * offsetX / 100;
          const y = 2 * halfHeight * offsetY / 100;
          camera.left = -halfWidth - x;
          camera.right = halfWidth - x;
          camera.top = halfHeight + y;
          camera.bottom = -halfHeight + y;
          camera.updateProjectionMatrix();
          return;
        }
        camera.aspect = resolution[0] / Math.max(resolution[1], 1);
        camera.filmGauge = gate;
        camera.zoom = zoom;
        camera.filmOffset = gate * (offsetX / 100);
        if (focal > 0) {
          camera.fov = 2 * Math.atan(camera.getFilmHeight() / 2 / focal) * (180 / Math.PI);
        }
        camera.updateProjectionMatrix();
        if (offsetY) camera.projectionMatrix.elements[9] += 2 * (offsetY / 100);
      }

      getSequenceResolution() {
        try {
          const value = this.parentProject.sequence.properties.resolution.get();
          if (value && value[0] > 0 && value[1] > 0) return value;
        } catch (_error) { /* not in a project yet */ }
        return [1920, 1080];
      }

      // Pose for time t: base transform first, then the stateless vibrate.
      update(time) {
        this._time = time;
        this.updateProjection(time);
        const position = this.properties.position.get(time);
        const rotation = this.properties.rotation.get(time);
        this.threeObj.position.set(position[0], position[1], position[2]);
        this.threeObj.rotation.set(rotation[0], rotation[1], rotation[2]);
        vibrate.applyVibrate(this.vibrateProperties, time, this.threeObj, position, rotation);
      }

      readMotionBlur(time) {
        const p = this.properties.motionBlur;
        if (readNumber(p.enabled, time, 0) !== 1) return null;
        const shutter = Math.max(0, Math.min(2, readNumber(p.shutter, time, 0.5)));
        const samples = Math.max(1, Math.min(8, Math.round(readNumber(p.samples, time, 4))));
        return shutter > 0 && samples > 1 ? { shutter, samples } : null;
      }

      // Depth-of-field settings at time t, or null when DOF is off.
      readDepthOfField(time) {
        const d = this.properties.depthOfField;
        if (readNumber(d.enabled, time, 0) !== 1) return null;
        return {
          orthographic: Boolean(this.threeObj.isOrthographicCamera),
          near: this.threeObj.near,
          far: this.threeObj.far,
          aperture: readNumber(d.aperture, time, 0),
          focusDistance: readNumber(d.focusDistance, time, 80),
          focusAreaWidth: readNumber(d.focusAreaWidth, time, 0),
          nearBlurLevel: readNumber(d.nearBlurLevel, time, 100) / 100,
          farBlurLevel: readNumber(d.farBlurLevel, time, 100) / 100,
        };
      }
    }
    CameraPlus.prototype.defaultName = "Camera+";
    return CameraPlus;
  }

  return {
    OBJECT_TYPE: OBJECT_TYPE,
    FOCUS_CONTROL_ID: FOCUS_CONTROL_ID,
    SCHEMA_VERSION: SCHEMA_VERSION,
    createDefinitions: createDefinitions,
    createClass: createClass,
    worldDistance: worldDistance,
  };
})();
