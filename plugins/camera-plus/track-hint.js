// Camera+ 3D-track guidance: pure detection logic plus the once-per-project
// notification helper. A Camera+ only drives layers on video tracks whose
// "3D" toggle (track header) is enabled; other layers keep their own camera.
// This part never touches rendering or saved data: it only reads the live
// track flags and, through callbacks the runtime supplies, shows a toast or a
// property-panel note. UI text is English.
//
// Evaluated with (PZ, THREE, parts) by camera-runtime.js; publishes parts.hint.
parts.hint = (function () {
  const TITLE = "Camera+";
  const MESSAGE = "Camera+ drives tracks with 3D enabled. Turn on 3D in a track header to follow this camera.";
  const ENABLE_FAILED = "Could not enable 3D tracking.";

  function videoTracksOf(project) {
    const tracks = project && project.sequence && project.sequence.videoTracks;
    return Array.isArray(tracks) ? tracks : [];
  }

  function projectHas3DTrack(project) {
    return videoTracksOf(project).some(function (track) {
      return !!(track && track.track3d);
    });
  }

  // True while guidance applies: the project has video tracks but none of
  // them follows the shared camera. Projects without video tracks get no
  // hint; there is no track header to point at.
  function needsHint(project) {
    if (!project) return false;
    return videoTracksOf(project).length > 0 && !projectHas3DTrack(project);
  }

  // First video track that does not follow the shared camera, with its
  // 1-based video-track number for the one-click button label.
  function firstTrackWithout3D(project) {
    const tracks = videoTracksOf(project);
    for (let index = 0; index < tracks.length; index++) {
      if (tracks[index] && !tracks[index].track3d) return { track: tracks[index], number: index + 1 };
    }
    return null;
  }

  function enableLabel(target) {
    return "Enable 3D on track " + target.number;
  }

  function enableHint(target) {
    return "Follow this camera on video track " + target.number;
  }

  // Notify once per project object. host: { getProject(), notify(detail),
  // notified }. Returns true when the hint applied (even if the toast itself
  // failed); the project is marked so repeats stay silent.
  function maybeNotify(host) {
    if (!host || typeof host.getProject !== "function") return false;
    const project = host.getProject();
    if (!needsHint(project)) return false;
    if (host.notified) {
      try {
        if (host.notified.has(project)) return false;
      } catch (_error) { /* an unusable set must not block guidance */ }
      try {
        host.notified.add(project);
      } catch (_error) { /* best-effort */ }
    }
    try {
      if (typeof host.notify === "function") host.notify({ title: TITLE, message: MESSAGE });
    } catch (_error) { /* notification is best-effort */ }
    return true;
  }

  return {
    TITLE: TITLE,
    MESSAGE: MESSAGE,
    ENABLE_FAILED: ENABLE_FAILED,
    videoTracksOf: videoTracksOf,
    projectHas3DTrack: projectHas3DTrack,
    needsHint: needsHint,
    firstTrackWithout3D: firstTrackWithout3D,
    enableLabel: enableLabel,
    enableHint: enableHint,
    maybeNotify: maybeNotify,
  };
})();
