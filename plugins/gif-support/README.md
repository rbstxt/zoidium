# Animated GIF

Decodes animated GIF image assets and animates them deterministically
wherever Clipmaker Gen3 uses image assets: the Image material on 3D objects,
image textures in effects and materials, and 2D image layers.

The GIF decoder (GIF87a/89a, LZW, interlace, palettes, transparency and
disposal modes 0-3, 512-frame / 64-megapixel caps) is ported from the gif.js
decoder in DaviFX's OpenZoid project (https://www.youtube.com/@davifxarts).
The render integration is a Zoidium rewrite: the shown frame is a pure
function of clip-local media time (`clip.properties.time` at the frame
already relative to the clip start), falling back to project time
(frame / sequence rate) where no clip context exists. GIFs loop, decoding is
awaited through the existing `prepare()` chains so exports never render the
loading placeholder, and disabling the plugin restores every patched
prototype.
