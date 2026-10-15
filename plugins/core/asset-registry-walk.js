(function (global) {
  "use strict";
  const parts = global.ZoidiumAssetRegistryParts = global.ZoidiumAssetRegistryParts || {};
  function nameOf(object, fallback) {
    const property = object?.properties?.name;
    const value = property && (property.value ?? property.keyframes?.[0]?.value);
    return String(value || object?._zoidiumCategoryName || object?.definition?.name || fallback || "");
  }
  function title(key) { return String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase()); }
  function addressOf(object) {
    try { return object?.getAddress?.() || null; } catch (_error) { return null; }
  }
  // Follow authored CM3 children only. Render clones, decoder caches and parent
  // pointers must never contribute additional authored references.
  function walkLive(project, PZ, visit, observe) {
    const seen = new Set();
    function walk(node, path, owner, clip) {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      // Native numeric/vector/color property groups contain only component
      // numbers. Their edits arrive through project history; walking those
      // component trees cannot discover an asset or a plugin reference owner.
      if (node.definition && node.definition.type >= 0 && node.definition.type <= 4) return;
      seen.add(node);
      observe?.(node);
      const property = !!node.definition;
      const list = PZ.propertyList && node instanceof PZ.propertyList;
      const array = Array.isArray(node);
      if (!array && !list && !property) {
        if (PZ.clip && node instanceof PZ.clip) clip = node;
        let label = node === project.sequence ? "" : nameOf(node, node.defaultName);
        if (node === clip && node.parent?.parent) {
          const track = node.parent.parent;
          const video = project.sequence.videoTracks?.indexOf(track) ?? -1;
          const audio = project.sequence.audioTracks?.indexOf(track) ?? -1;
          if (video >= 0) label = "V" + (video + 1) + " " + label;
          else if (audio >= 0) label = "A" + (audio + 1) + " " + label;
        }
        if (label) path = path.concat(label);
        owner = node;
        visit({ node, path, owner, clip });
      }
      if (property && node.definition.type === (PZ.property?.type?.ASSET ?? 8)) {
        const label = nameOf(node, title(node.definition.id || "Property"));
        visit({ node, path: path.concat(label), owner, clip, property: true });
      }
      if (list) {
        for (const key of Object.keys(node)) {
          const child = node[key];
          if (child && typeof child === "object") {
            const category = PZ.propertyList && child instanceof PZ.propertyList;
            walk(child, category ? path.concat(nameOf(child, title(key))) : path, owner, clip);
          }
        }
      } else if (array) {
        for (const child of node) walk(child, path, owner, clip);
      } else if (node.children) {
        for (const child of node.children) {
          if (property && child === node.properties) continue;
          // Precomp exposes its current rendered children through the native
          // composite objects list. Their authored uses belong to stored comps.
          if (node.type === 2 && node.compId && child === node.objects) continue;
          walk(child, path, owner, clip);
        }
      }
    }
    walk(project.sequence, [], null, null);
  }
  function collectProperties(project, PZ, emit, observe, recordOwner) {
    walkLive(project, PZ, entry => {
      recordOwner?.(entry);
      const property = entry.node;
      if (!entry.property || property.definition.type !== (PZ.property?.type?.ASSET ?? 8)) return;
      // Material+ exposes this selection field as a transient UI mirror. Its
      // authored graph nodes are emitted by that plugin's adapter instead.
      if (entry.owner?.properties?.nodeImage === property) return;
      const common = { path: entry.path, owner: entry.owner, clip: entry.clip,
        address: addressOf(property), property, assetType: property.definition.assetType,
        propertyName: property.definition.name || "", revealable: true };
      if (property.keyframes?.length) {
        const values = new Set();
        for (const keyframe of property.keyframes) {
          const key = keyframe.value;
          if (typeof key !== "string" || !key || values.has(key)) continue;
          values.add(key);
          emit({ ...common, key, kind: "keyframe", frame: keyframe.frame });
        }
      } else if (typeof property.value === "string" && property.value) {
        emit({ ...common, key: property.value, kind: "property", frame: null });
      }
    }, observe);
  }
  // Stored composition data is plain JSON. Matching listed keys avoids guesses
  // about plugins' serialized property definitions and never hydrates a clip.
  function walkStored(value, keys, emit, composition, path, adapters, seen = new Set(), frame = null) {
    if (typeof value === "string") {
      if (keys.has(value)) emit({ key: value, path, composition, kind: frame === null ? "property" : "keyframe", frame, revealable: false });
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const name = value.properties?.name;
      const label = typeof name === "string" ? name : name?.value;
      if (label) path = path.concat(label);
      if (value.type === 2 && typeof value.compId === "string") {
        emit({ key: "comp:" + value.compId, path, composition, kind: "composition", revealable: false });
      }
      adapters?.(value, path, composition);
    }
    const keyframeValues = new Set();
    for (const [key, child] of Object.entries(value)) {
      if (["assets", "nodeImage", "compId", "name"].includes(key)) continue;
      if (key === "keyframes" && Array.isArray(child)) {
        for (const kf of child) {
          if (typeof kf.value === "string" && keyframeValues.has(kf.value)) continue;
          keyframeValues.add(kf.value);
          walkStored(kf.value, keys, emit, composition, path, adapters, seen, kf.frame ?? null);
        }
        continue;
      }
      const structural = ["properties", "children", "clips", "object", "value", "data", "videoTracks", "audioTracks"].includes(key) || /^\d+$/.test(key);
      walkStored(child, keys, emit, composition, structural ? path : path.concat(title(key)), adapters, seen, frame);
    }
  }
  parts.walk = { walkLive, collectProperties, walkStored, addressOf, nameOf };
})(globalThis);
