"use strict";
const paths = {
  pen: "m4 20 3-11 9-7 6 6-7 9Z M4 20l9-9 M11 9h4v4h-4Z",
};
function icon(document, name) {
  if (!paths[name]) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("stroke-linecap", "round");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}
module.exports = { icon, paths };
