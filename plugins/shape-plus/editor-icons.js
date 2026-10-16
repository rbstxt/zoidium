"use strict";
const paths = {
  group: "M2 6h7l2 2h11v13H2Z M2 6V3h7l2 3",
  path: "M4 19C4 4 20 20 20 5 M2 17h4v4H2Z M18 3h4v4h-4Z",
  rectangle: "M3 5h18v14H3Z",
  ellipse: "M21 12a9 7 0 1 1-18 0 9 7 0 1 1 18 0Z",
  polystar: "m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z",
  fill: "m4 10 7-7 9 9-7 7Z M3 21h14 M17 4l-6 6 M20 16q4 5 0 5-4 0 0-5Z",
  stroke: "M3 17 8 7l7 10 6-10 M3 22h18",
  gradientFill: "M3 3h18v18H3Z M7 4v16 M11 4v16 M15 4v16 M18 4v16",
  gradientStroke: "M3 18 8 6l7 12 6-12 M2 22h3 M8 22h5 M16 22h6",
  trim: "M4 7h9q7 0 7 7v4 M3 4v6 M17 18h6 M10 7h2 M20 12v2",
  repeater: "M2 2h10v10H2Z M8 8h10v10 M14 14h8v8h-8Z",
  roundCorners: "M3 21V11a8 8 0 0 1 8-8h10 M3 3h5 M3 3v5 M16 10v6h-6",
  select: "m5 2 14 12-7 1-3 7Z",
  pen: "m4 20 3-11 9-7 6 6-7 9Z M4 20l9-9 M11 9h4v4h-4Z",
  hand: "M7 12V6q0-3 3-1V3q2-3 3 0v2q3-3 3 1v2q3-2 3 1v8q-2 6-8 5l-7-7q-2-4 1-3l2 2Z",
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
  svg.classList.add("sp-owned-icon");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}
module.exports = { icon, paths };
