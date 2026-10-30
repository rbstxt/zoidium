"use strict";
const paths = {
  text: "M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3",
  group: "M3 6h7l2 2h9v11H3Z",
  rectangle: "M4 6h16v12H4Z",
  ellipse: "M4 12a8 6.5 0 1 0 16 0a8 6.5 0 1 0-16 0Z",
  polystar: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7Z",
  path: "M5 18C8 5 16 19 19 6 M3.5 16.5h3v3h-3Z M17.5 4.5h3v3h-3Z",
  fill: "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z",
  stroke: "M4 18c3-7 6 2 9-4s4-7 7-8 M4 21h16",
  gradientFill: "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z M7 14h10 M8 17h8",
  gradientStroke: "M4 18c3-7 6 2 9-4s4-7 7-8 M4 21h4 M10 21h4 M16 21h4",
  trim: "M3.5 6a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M3.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M8 7.5 20 17 M8 16.5 20 7",
  repeater: "M3 10h7v7H3Z M7 7h7v7 M11 4h7v7h-4",
  roundCorners: "M5 20V11a6 6 0 0 1 6-6h9",
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
