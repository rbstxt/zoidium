(function installTrackSwitchState(global) {
  "use strict";

  const PZ = global.PZ;
  const trackPrototype = PZ?.track?.prototype;
  if (!trackPrototype) return;

  const fields = ["zoidiumSolo", "zoidiumLocked"];
  const load = trackPrototype.load;
  const toJSON = trackPrototype.toJSON;
  trackPrototype.load = function (data) {
    for (const field of fields) this[field] = data?.[field] === true;
    return load.apply(this, arguments);
  };
  trackPrototype.toJSON = function () {
    const data = toJSON.apply(this, arguments);
    for (const field of fields) {
      if (this[field] === true) data[field] = true;
      else delete data[field];
    }
    return data;
  };

  function hasSolo(tracks) {
    return tracks?.some(track => track.zoidiumSolo === true) === true;
  }

  function excludedBySolo(track, tracks) {
    return track?.zoidiumSolo !== true && hasSolo(tracks);
  }

  function isLocked(object) {
    for (let owner = object; owner; owner = owner.parent) {
      if (owner instanceof PZ.track && owner.zoidiumLocked === true) return true;
    }
    return false;
  }

  const sequence = PZ.sequence?.prototype;
  if (sequence?.update) {
    const update = sequence.update;
    sequence.update = function () {
      const result = update.apply(this, arguments);
      // Preview and export both select their draw layers here. Keep the clips
      // available to camera lookup and Layer Input even when their row is hidden.
      if (hasSolo(this.videoTracks)) {
        for (const track of this.videoTracks) {
          if (track.zoidiumSolo !== true) track.layer = null;
        }
      }
      return result;
    };
  }

  if (PZ.schedule?.combineTracks) {
    const combineTracks = PZ.schedule.combineTracks;
    PZ.schedule.combineTracks = function (tracks) {
      if (tracks?.[0]?.type === 1 && hasSolo(tracks)) {
        return combineTracks.call(this, Array.from(tracks).filter(track => track.zoidiumSolo === true));
      }
      return combineTracks.apply(this, arguments);
    };
  }

  global.ZoidiumTrackSwitches = { hasSolo, excludedBySolo, isLocked };
})(window);
