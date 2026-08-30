(function (global) {
  "use strict";

  // Keep the CM3 media UI available while omitting its online-only section.
  // The no-op constructor prevents both DOM allocation and the community API
  // request that the original constructor starts.
  var PZ = global.PZ;
  if (!PZ || !PZ.ui || !PZ.ui.media || !PZ.ui.media.list) return;
  if (typeof PZ.ui.media.list.community !== "function") return;

  var CommunityMedia = PZ.ui.media.list.community;
  var DisabledCommunityMedia = function () {};
  DisabledCommunityMedia.prototype = CommunityMedia.prototype;
  PZ.ui.media.list.community = DisabledCommunityMedia;
})(window);
