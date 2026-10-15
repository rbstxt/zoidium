"use strict";

// Layer Input source model: track identity, source tokens, Loaded through the shared bundle loader; created per activation
// by the plugin entry with (state, deps), where deps carries the sibling
// parts once the entry has wired them.

const shared = require("./layer-input-state.js");
const state = shared.state;

module.exports = function createSources(state, deps) {
  function isVideoTrack(value) {
    return Boolean(state.PZ?.track?.video && value instanceof state.PZ.track.video);
  }

  function getParentObject(value) {
    if (!value) return null;
    // Detached or partially unloaded objects may throw on access.
    try {
      return value.parentObject || null;
    } catch (_error) {
      return null;
    }
  }

  function getOwnerTrack(value) {
    let current = value;
    for (let depth = 0; current && depth < 64; depth += 1) {
      if (isVideoTrack(current)) return current;
      const parent = getParentObject(current);
      if (parent === current) return null;
      current = parent;
    }
    return null;
  }

  function getProject(value) {
    // Detached objects may throw when reading their project link.
    try {
      return value?.parentProject || null;
    } catch (_error) {
      return null;
    }
  }

  function readNumericProperty(property, frame, fallback) {
    try {
      const value = property?.get?.(frame);
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function isAttachedTrack(track, project) {
    return isVideoTrack(track) && (!project || getProject(track) === project);
  }

  function hasTrackId(track, id) {
    const project = getProject(track) || state.editor?.project;
    return getProjectTracks(project).some(
      (candidate) => candidate !== track && candidate?._zoidiumLayerInputId === id
    );
  }

  function generateTrackId(track) {
    let id = "";
    do {
      id = `track-${state.nextTrackId}`;
      state.nextTrackId += 1;
    } while (hasTrackId(track, id));
    return id;
  }

  function ensureTrackId(track, requestedId) {
    if (!track || typeof track !== "object") return "";
    let id = track._zoidiumLayerInputId;
    if (typeof requestedId === "string" && requestedId.trim()) id = requestedId.trim();
    if (typeof id !== "string" || !id || hasTrackId(track, id)) id = generateTrackId(track);
    // Non-extensible host objects may reject defineProperty; plain assignment carries the same id.
    try {
      Object.defineProperty(track, "_zoidiumLayerInputId", {
        configurable: true,
        enumerable: false,
        value: id,
        writable: true,
      });
    } catch (_error) {
      track._zoidiumLayerInputId = id;
    }
    return id;
  }

  function trackToken(track) {
    if (!track || typeof track !== "object") return "";
    let id = state.trackIds.get(track);
    if (!id) {
      id = ensureTrackId(track);
      state.trackIds.set(track, id);
    }
    return `${shared.SOURCE_ID_PREFIX}${id}`;
  }

  function parseTrackToken(value) {
    if (typeof value !== "string" || !value.startsWith(shared.SOURCE_PREFIX)) return null;
    if (value.startsWith(shared.SOURCE_ID_PREFIX)) {
      const id = value.slice(shared.SOURCE_ID_PREFIX.length).trim();
      return id ? { id } : null;
    }
    try {
      const address = JSON.parse(value.slice(shared.SOURCE_PREFIX.length));
      return Array.isArray(address) ? { address } : null;
    } catch (_error) {
      return null;
    }
  }

  function resolveTrackToken(consumer, value) {
    const parsed = parseTrackToken(value);
    if (!parsed) return null;
    const project = getProject(consumer) || state.editor?.project;
    if (!project) return null;
    if (parsed.id) {
      return (
        getProjectTracks(project).find((track) => ensureTrackId(track) === parsed.id) || null
      );
    }
    if (!project.addressLookup) return null;
    // A stale address may throw; the caller reports the track as missing.
    try {
      const track = project.addressLookup(parsed.address);
      return isAttachedTrack(track, project) ? track : null;
    } catch (_error) {
      return null;
    }
  }

  function getSourceProperties(consumer) {
    if (!consumer) return [];
    const customProperties = consumer.customProperties;
    if (customProperties && consumer.type === 1) {
      const properties = Array.from(customProperties).filter(
        (property) => property?.definition?._zoidiumLayerSource
      );
      if (properties.length > 0) return properties;
    }
    const property = consumer.properties?.source;
    return property ? [property] : [];
  }

  function getSourceProperty(consumer, sourceProperty) {
    return sourceProperty || getSourceProperties(consumer)[0] || null;
  }

  function getSourceState(consumer, sourceProperty) {
    const property = getSourceProperty(consumer, sourceProperty);
    return property && property !== consumer?.properties?.source ? property : consumer;
  }

  function getConsumerTrack(consumer, sourceProperty) {
    if (!consumer) return null;
    const property = getSourceProperty(consumer, sourceProperty);
    const sourceState = getSourceState(consumer, property);
    const project = getProject(consumer) || state.editor?.project;
    if (isAttachedTrack(sourceState?._zoidiumSourceTrack, project)) {
      return sourceState._zoidiumSourceTrack;
    }
    const track = resolveTrackToken(consumer, property?.get?.());
    if (sourceState) sourceState._zoidiumSourceTrack = track || null;
    if (property?.get?.()) {
      if (sourceState) sourceState._zoidiumSourceError = track ? "" : "missing";
    } else if (sourceState?._zoidiumSourceError !== "cycle" && sourceState) {
      sourceState._zoidiumSourceError = "";
    }
    return track;
  }

  function getSourceError(consumer, sourceProperty) {
    return getSourceState(consumer, sourceProperty)?._zoidiumSourceError || "";
  }

  function normalizeSourceMode(value) {
    const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
    return shared.SOURCE_MODE_VALUES.has(mode) ? mode : shared.DEFAULT_SOURCE_MODE;
  }

  function getSourceMode(consumer, sourceProperty) {
    const property = getSourceProperty(consumer, sourceProperty);
    const sourceState = getSourceState(consumer, property);
    return normalizeSourceMode(
      sourceState?._zoidiumSourceMode ??
        property?._zoidiumSourceMode ??
        property?.type?._zoidiumLayerInputMode ??
        property?.definition?._zoidiumLayerInputMode
    );
  }

  function setSourceMode(consumer, value, options = {}) {
    if (!consumer) return false;
    const property = getSourceProperty(consumer, options.sourceProperty);
    if (!property) return false;

    const sourceState = getSourceState(consumer, property);
    const previous = getSourceMode(consumer, property);
    const mode = normalizeSourceMode(value);
    if (sourceState) sourceState._zoidiumSourceMode = mode;
    property._zoidiumSourceMode = mode;

    // Custom shader properties serialize their custom type definition. Keep
    // the selected mode on a per-property copy so separate inputs do not
    // mutate the shared Layer Input picker definition.
    if (property.type && typeof property.type === "object") {
      property.type = { ...property.type, _zoidiumLayerInputMode: mode };
    }

    if (previous !== mode) {
      consumer.fragmentShaderNeedsUpdate = true;
      property.onChanged?.update?.(property.get?.());
    }
    return true;
  }

  function getSourceModeOptions() {
    return shared.SOURCE_MODE_OPTIONS.map((option) => ({ ...option }));
  }

  function getProjectTracks(project) {
    const tracks = project?.sequence?.videoTracks;
    return tracks && typeof tracks.length === "number" ? Array.from(tracks) : [];
  }

  function getConsumerEdges(project, overrideConsumer, overrideTrack, overrideProperty) {
    const edges = new Map();
    for (const consumer of state.consumers) {
      if (getProject(consumer) !== project) continue;
      const owner = getOwnerTrack(consumer);
      if (!owner) continue;
      for (const property of getSourceProperties(consumer)) {
        const target =
          consumer === overrideConsumer && property === overrideProperty
            ? overrideTrack
            : getConsumerTrack(consumer, property);
        if (!target) continue;
        const targets = edges.get(owner) || new Set();
        targets.add(target);
        edges.set(owner, targets);
      }
    }
    if (overrideConsumer && overrideTrack && !getSourceProperties(overrideConsumer).includes(overrideProperty)) {
      const owner = getOwnerTrack(overrideConsumer);
      if (owner) {
        const targets = edges.get(owner) || new Set();
        targets.add(overrideTrack);
        edges.set(owner, targets);
      }
    }
    return edges;
  }

  function canReach(edges, start, target) {
    if (start === target) return true;
    const visited = new Set();
    const pending = [start];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of edges.get(current) || []) {
        if (!visited.has(next)) pending.push(next);
      }
    }
    return false;
  }

  function wouldCreateCycle(consumer, target, sourceProperty) {
    const project = getProject(consumer) || state.editor?.project;
    const owner = getOwnerTrack(consumer);
    if (!project || !owner || !target) return false;
    const property = getSourceProperty(consumer, sourceProperty);
    const edges = getConsumerEdges(project, consumer, target, property);
    return canReach(edges, target, owner);
  }

  function clearSourceProperty(consumer, sourceProperty) {
    const property = getSourceProperty(consumer, sourceProperty);
    const sourceState = getSourceState(consumer, property);
    if (!property || !property.get?.() || sourceState?._zoidiumSourceUpdating) return;
    sourceState._zoidiumSourceUpdating = true;
    try {
      property.set("");
    } finally {
      sourceState._zoidiumSourceUpdating = false;
    }
  }

  function setConsumerSource(consumer, value, options = {}) {
    if (!consumer) return false;
    const property = getSourceProperty(consumer, options.sourceProperty);
    const sourceState = getSourceState(consumer, property);
    const sourceValue = typeof value === "string" ? value : "";
    if (!sourceValue) {
      sourceState._zoidiumSourceTrack = null;
      sourceState._zoidiumSourceError = "";
      return true;
    }

    const target = resolveTrackToken(consumer, sourceValue);
    if (!target) {
      sourceState._zoidiumSourceTrack = null;
      sourceState._zoidiumSourceError = "missing";
      if (options.fromUser && !sourceState._zoidiumSourceUpdating) {
        clearSourceProperty(consumer, property);
        sourceState._zoidiumSourceError = "missing";
      }
      return false;
    }
    if (wouldCreateCycle(consumer, target, property)) {
      sourceState._zoidiumSourceTrack = null;
      sourceState._zoidiumSourceError = "cycle";
      clearSourceProperty(consumer, property);
      sourceState._zoidiumSourceError = "cycle";
      return false;
    }

    sourceState._zoidiumSourceTrack = target;
    sourceState._zoidiumSourceError = "";
    if (property && property.get?.() !== sourceValue && !sourceState._zoidiumSourceUpdating) {
      sourceState._zoidiumSourceUpdating = true;
      try {
        property.set(sourceValue);
      } finally {
        sourceState._zoidiumSourceUpdating = false;
      }
    }
    deps.scheduleValidation(getProject(consumer) || state.editor?.project);
    return true;
  }

  function getCurrentSourceToken(consumer, sourceProperty) {
    const property = getSourceProperty(consumer, sourceProperty);
    const target = getConsumerTrack(consumer, property);
    return target ? trackToken(target) : property?.get?.() || "";
  }

  function getClipLabel(track) {
    const clip = track?.clips?.[0];
    try {
      const value = clip?.properties?.name?.get?.();
      return value ? String(value) : "";
    } catch (_error) {
      return "";
    }
  }

  function getSourceOptions(consumer, sourceProperty) {
    const project = getProject(consumer) || state.editor?.project;
    const owner = getOwnerTrack(consumer);
    const options = [{ value: "", label: "(No source)", disabled: false }];
    for (const [index, track] of getProjectTracks(project).entries()) {
      const clipLabel = getClipLabel(track);
      const suffix = clipLabel ? ` — ${clipLabel}` : "";
      options.push({
        value: trackToken(track),
        label: `Track ${index + 1}${suffix}`,
        disabled: track === owner || wouldCreateCycle(consumer, track, sourceProperty),
      });
    }
    const current = getCurrentSourceToken(consumer, sourceProperty);
    if (current && !options.some((option) => option.value === current)) {
      options.push({ value: current, label: "(Missing source)", disabled: true });
    }
    return options;
  }

  function getSourceStatus(consumer, sourceProperty) {
    switch (getSourceError(consumer, sourceProperty)) {
      case "cycle":
        return "Circular source reference";
      case "missing":
        return "Source track is missing";
      default:
        return "";
    }
  }

  function getConsumerFrame(consumer, context) {
    const localFrame = consumer?._zoidiumLocalFrame;
    const clip = consumer?.tryGetParentOfType?.(state.PZ?.clip);
    if (Number.isFinite(localFrame) && clip && Number.isFinite(clip.start)) {
      return clip.start + localFrame;
    }
    return context?.frame || 0;
  }

  return {
    canReach,
    clearSourceProperty,
    ensureTrackId,
    generateTrackId,
    getClipLabel,
    getConsumerEdges,
    getConsumerFrame,
    getConsumerTrack,
    getCurrentSourceToken,
    getOwnerTrack,
    getParentObject,
    getProject,
    getProjectTracks,
    getSourceError,
    getSourceMode,
    getSourceModeOptions,
    getSourceOptions,
    getSourceProperties,
    getSourceProperty,
    getSourceState,
    getSourceStatus,
    hasTrackId,
    isAttachedTrack,
    isVideoTrack,
    normalizeSourceMode,
    parseTrackToken,
    readNumericProperty,
    resolveTrackToken,
    setConsumerSource,
    setSourceMode,
    trackToken,
    wouldCreateCycle,
  };
};
