(function installProjectMediaFpsPatch() {
  "use strict";

  const mediaPrototype = PZ.ui && PZ.ui.media && PZ.ui.media.prototype;
  if (!mediaPrototype || mediaPrototype.__zoidiumProjectMediaFpsPatch) return;

  function getProjectFrameRate(mediaPanel) {
    const sequence =
      (mediaPanel.editor && mediaPanel.editor.sequence) ||
      (typeof CM !== "undefined" && CM.sequence);
    const rateProperty = sequence && sequence.properties && sequence.properties.rate;
    const frameRate = rateProperty && rateProperty.get();

    return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  }

  function useProjectFrameRate(originalLoader) {
    return async function loadMediaAtProjectFrameRate(asset) {
      const clip = await originalLoader.call(this, asset);
      if (!clip || !asset || !Number.isFinite(asset.length)) return clip;

      clip.length = Math.floor(asset.length * getProjectFrameRate(this));
      return clip;
    };
  }

  mediaPrototype.loadVideo = useProjectFrameRate(mediaPrototype.loadVideo);
  mediaPrototype.loadAudio = useProjectFrameRate(mediaPrototype.loadAudio);
  mediaPrototype.__zoidiumProjectMediaFpsPatch = true;
})();
