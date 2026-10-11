// Tracery property definitions (split from tracery.js).
// Factories plus the full effect property surface.

function trNum(name, value, min, max, step, decimals) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.NUMBER,
        value: value,
        min: min,
        max: max,
        step: step,
        decimals: decimals,
    };
}

function trOption(name, value, items) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.OPTION,
        value: value,
        items: items,
    };
}

function trColor(name, r, g, b) {
    return {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: name + ".R", type: PZ.property.type.NUMBER, value: r, min: 0, max: 1 },
            { dynamic: true, name: name + ".G", type: PZ.property.type.NUMBER, value: g, min: 0, max: 1 },
            { dynamic: true, name: name + ".B", type: PZ.property.type.NUMBER, value: b, min: 0, max: 1 },
        ],
        name: name,
        type: PZ.property.type.COLOR,
    };
}

function trText(name, value) {
    return { name: name, type: PZ.property.type.TEXT, value: value };
}

function trPointDefs(n) {
    return {
        // Point 1 starts on at the frame centre, so a new effect shows a marker
        // at once (DaviFX's version started with every point off, which left a
        // new effect looking broken). Saved projects keep their saved value.
        ["point" + n + "Enable"]: trOption("Point " + n, n === 1 ? 1 : 0, "off;on"),
        ["point" + n + "X"]: trNum("Point " + n + " X [%]", 50, 0, 100, 0.1, 1),
        ["point" + n + "Y"]: trNum("Point " + n + " Y [%]", 50, 0, 100, 0.1, 1),
        ["point" + n + "Size"]: trNum("Point " + n + " size", 120, 1, 2000, 1, 0),
        ["point" + n + "Label"]: trText("Point " + n + " label", "P" + n),
        ["point" + n + "LabelDX"]: trNum("Point " + n + " label dX", 150, -2000, 2000, 1, 0),
        ["point" + n + "LabelDY"]: trNum("Point " + n + " label dY", -70, -2000, 2000, 1, 0),
    };
}

function trMerge(dst, src) {
    for (var k in src) dst[k] = src[k];
    return dst;
}

function trPointSet() {
    var defs = {};
    for (var n = 1; n <= 6; n++) trMerge(defs, trPointDefs(n));
    return defs;
}

function traceryPropertyDefinitions() {
    return trMerge(
    {
        enabled: {
            dynamic: true,
            name: "Enabled",
            type: PZ.property.type.OPTION,
            value: 1,
            items: "off;on",
        },
        detectEnable: trOption("Detection", 1, "off;on"),
        keyColor: trColor("Key Color", 1, 1, 1),
        threshold: trNum("Threshold", 50, 0, 100, 0.5, 1),
        showMask: trOption("Show Mask", 0, "off;on"),
        blurStrength: trNum("Blur Strength", 5, 0, 8, 0.5, 1),
        alphaLayer: trOption("Alpha Layer", 0, "off;on"),
        detectionQuality: trOption("Detection Quality", 2, "low;medium;high;extreme"),
        boxEnable: trOption("Box", 1, "off;on"),
        boxShape: trOption("Box shape", 0, "rectangle;square;ellipse;circle"),
        boxColor: trColor("Box color", 1, 1, 1),
        boxOpacity: trNum("Box opacity", 1, 0, 1, 0.01, 2),
        boxLineWidth: trNum("Box line width", 2, 0.5, 20, 0.5, 1),
        boxFill: trOption("Box fill", 0, "none;solid;diagonal hatch;invert"),
        boxFillColor: trColor("Box fill color", 1, 1, 1),
        boxFillOpacity: trNum("Box fill opacity", 0.25, 0, 1, 0.01, 2),
        markerShape: trOption("Marker shape", 0, "dot;plus;cross;polygon"),
        markerSize: trNum("Marker size", 14, 1, 200, 1, 0),
        markerColor: trColor("Marker color", 1, 0.15, 0.15),
        markerOpacity: trNum("Marker opacity", 1, 0, 1, 0.01, 2),
        markerRotation: trNum("Marker rotation", 0, -180, 180, 1, 0),
        markerSides: trNum("Polygon sides", 5, 3, 12, 1, 0),
        markerFilled: trOption("Marker filled", 1, "off;on"),
        gridEnable: trOption("Grid", 0, "off;on"),
        gridMode: trOption("Grid mode", 0, "cartesian;edge"),
        gridDivisions: trNum("Grid divisions", 8, 1, 32, 1, 0),
        gridColor: trColor("Grid color", 1, 1, 1),
        gridOpacity: trNum("Grid opacity", 0.25, 0, 1, 0.01, 2),
        linesEnable: trOption("Connection lines", 1, "off;on"),
        lineType: trOption("Connection type", 0, "spline;pcb traces;smooth bend;step bend"),
        lineColor: trColor("Connection color", 1, 1, 1),
        lineOpacity: trNum("Connection opacity", 1, 0, 1, 0.01, 2),
        lineThickness: trNum("Connection thickness", 3.6, 0.5, 30, 0.1, 1),
        splineTension: trNum("Spline tension", 0, -1, 1, 0.01, 2),
        splineContinuity: trNum("Spline continuity", 0, -1, 1, 0.01, 2),
        splineBias: trNum("Spline bias", 0, -1, 1, 0.01, 2),
        showHandles: trOption("Spline handles", 0, "off;on"),
        lineCorner: trNum("Step corner", 0.5, 0, 1, 0.01, 2),
        dashEnable: trOption("Dash", 0, "off;on"),
        dashLength: trNum("Dash length", 10, 1, 200, 1, 0),
        dashGap: trNum("Gap length", 5, 1, 200, 1, 0),
        arrowEnable: trOption("Arrow", 0, "off;on"),
        arrowColor: trColor("Arrow color", 0.6, 0.6, 1),
        arrowOpacity: trNum("Arrow opacity", 1, 0, 1, 0.01, 2),
        arrowSize: trNum("Arrow size", 23, 1, 200, 1, 0),
        arrowAngle: trNum("Arrow angle", 0.4, 0.05, 1.5, 0.01, 2),
        arrowPosition: trNum("Arrow position", 0.7, 0, 1, 0.01, 2),
        arrowFilled: trOption("Arrow filled", 1, "off;on"),
        labelsEnable: trOption("Labels", 1, "off;on"),
        labelMode: trOption("Label display", 0, "coordinates;dimensions;area;node id;custom"),
        labelFontSize: trNum("Label size", 20, 6, 120, 1, 0),
        labelColor: trColor("Label color", 1, 1, 1),
        labelOpacity: trNum("Label opacity", 1, 0, 1, 0.01, 2),
    },
    trPointSet()
    );
}

module.exports = {
    trNum,
    trOption,
    trColor,
    trText,
    trPointDefs,
    trMerge,
    trPointSet,
    traceryPropertyDefinitions,
};

