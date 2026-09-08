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
    typeof PZ.schedule.combineTracks !== "function" ||
    typeof PZ.ui.generateIcon !== "function"
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
    button.title = enabled ? "disable track" : "enable track";
    button.setAttribute("aria-label", button.title);
    icon.style.fill = enabled ? "#ccc" : "#8a2828";
  }

  function restoreAudioPosition(playback, sequence) {
    if (!playback || !sequence || !sequence.audioSchedules) return;

    var frame = Number.isFinite(playback._exactFrame)
      ? playback._exactFrame
      : playback.currentFrame;
    var rate = Number.isFinite(playback.frameRate)
      ? playback.frameRate
      : sequence.properties.rate.get();
    if (!Number.isFinite(frame) || !Number.isFinite(rate)) return;

    for (var i = 0; i < sequence.audioSchedules.length; i += 1) {
      var schedule = sequence.audioSchedules[i];
      if (!schedule || !schedule.el || !schedule.items || !schedule.items.length) continue;

      schedule.update(frame, rate);
      if (!schedule.currentItem) continue;

      var localFrame = frame - schedule.currentItem.start;
      var currentTime = schedule.currentItem.clip.properties.time.get(localFrame);
      if (!Number.isFinite(currentTime)) continue;

      try {
        schedule.el.currentTime = currentTime;
      } catch (_error) {
        // The media element may not have metadata yet; playback will retry it.
      }
    }
  }

  function analyzeSequenceWithoutSeeking(timeline, sequence) {
    var playback = timeline && timeline.editor && timeline.editor.playback;
    var currentFrame = playback && Number.isFinite(playback.currentFrame)
      ? playback.currentFrame
      : null;
    var exactFrame = playback && Number.isFinite(playback._exactFrame)
      ? playback._exactFrame
      : null;
    var speed = playback && Number.isFinite(playback.speed) ? playback.speed : null;
    var scrollLeft = timeline && timeline.scrollBar && timeline.scrollBar.scrollLeft;

    PZ.schedule.analyzeSequence(sequence);

    if (playback) {
      if (exactFrame !== null) playback.currentFrame = exactFrame;
      else if (currentFrame !== null) playback.currentFrame = currentFrame;
      if (exactFrame !== null && "_exactFrame" in playback) playback._exactFrame = exactFrame;
      if (speed !== null) playback.speed = speed;
      restoreAudioPosition(playback, sequence);
    }
    if (timeline && timeline.scrollBar && Number.isFinite(scrollLeft)) {
      timeline.scrollBar.scrollLeft = scrollLeft;
    }
  }

  tracksPrototype.createTrackLabel = function (track, type, index) {
    var label = originalCreateTrackLabel.call(this, track, type, index);
    if (type !== audioTrackType || !isAudioTrack(track)) return label;

    if (track.enabled !== false) track.enabled = true;

    var button = document.createElement("button");
    button.type = "button";
    button.style.width = "16px";
    button.style.height = "16px";
    button.style.verticalAlign = "inherit";
    button.classList.add("actionbutton");

    var icon = PZ.ui.generateIcon("audio");
    icon.style.width = "16px";
    icon.style.height = "16px";
    button.appendChild(icon);
    setAudioButtonState(track, button, icon);

    button.onclick = function () {
      track.enabled = track.enabled === false;
      setAudioButtonState(track, button, icon);
      if (this.timeline && this.timeline.sequence) {
        analyzeSequenceWithoutSeeking(this.timeline, this.timeline.sequence);
      }
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
