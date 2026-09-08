(function (global) {
  "use strict";

  var PZ = global.PZ;
  var tracks = PZ && PZ.ui && PZ.ui.timeline && PZ.ui.timeline.tracks;

  if (
    !PZ ||
    !PZ.schedule ||
    !PZ.track ||
    !PZ.track.audio ||
    !tracks ||
    !tracks.prototype ||
    typeof tracks.prototype.createTrackLabel !== "function" ||
    typeof PZ.schedule.combineTracks !== "function"
  ) return;
  if (tracks.prototype.__zoidiumAudioTrackVisibility) return;

  var tracksPrototype = tracks.prototype;
  var originalCreateTrackLabel = tracksPrototype.createTrackLabel;
  var originalCombineTracks = PZ.schedule.combineTracks;
  var audioTrackType = PZ.track.audio.prototype.type;

  function isAudioTrack(track) {
    return track && track.type === audioTrackType;
  }

  function setAudioButtonState(track, button, icon) {
    var enabled = track.enabled !== false;
    button.title = enabled ? "mute track" : "unmute track";
    button.setAttribute("aria-label", button.title);
    icon.style.fill = enabled ? "#ccc" : "#8a2828";
    PZ.ui.switchIcon(icon, enabled ? "audio" : "mute");
  }

  tracksPrototype.createTrackLabel = function (track, type, index) {
    var label = originalCreateTrackLabel.call(this, track, type, index);
    if (type !== audioTrackType || !isAudioTrack(track)) return label;

    if (track.enabled !== false) track.enabled = true;

    var button = document.createElement("button");
    button.type = "button";
    button.style = "width: 16px;height: 16px;vertical-align:inherit;";
    button.classList.add("actionbutton");

    var icon = PZ.ui.generateIcon("audio");
    icon.style = "width: 16px;height: 16px;";
    button.appendChild(icon);
    setAudioButtonState(track, button, icon);

    button.onclick = function () {
      track.enabled = track.enabled === false;
      setAudioButtonState(track, button, icon);
      if (this.timeline.sequence) PZ.schedule.analyzeSequence(this.timeline.sequence);
    }.bind(this);

    label.insertBefore(button, label.lastElementChild);
    return label;
  };

  PZ.schedule.combineTracks = function (trackList) {
    var enabledTracks = Array.prototype.filter.call(trackList || [], function (track) {
      return !isAudioTrack(track) || track.enabled !== false;
    });
    return originalCombineTracks.call(this, enabledTracks);
  };

  tracksPrototype.__zoidiumAudioTrackVisibility = true;
})(window);
