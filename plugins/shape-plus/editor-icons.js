"use strict";
const paths = {
  twist: "M4 12c0-9 16-9 16 0 0 7-12 7-12 0 0-4 8-4 8 0 0 2-4 2-4 0",
  zigZag: "M2 16l4-9 4 10 4-10 4 10 4-9",
  puckerBloat: "M4 4Q12 10 20 4Q14 12 20 20Q12 14 4 20Q10 12 4 4Z",
  wigglePaths: "M2 14q3-16 7-4t7 0 6 2",
  wiggleTransform: "M5 5h11v11H5Z M3 20h16M16 17l3 3-3 3M20 3v12M17 6l3-3 3 3",
  offsetPaths: "M3 3h18v18H3Z M8 8h8v8H8Z",
  mergePaths: "M3 3h12v12H3Z M9 9h12v12H9Z",
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
