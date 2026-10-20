"use strict";
const mathModes = ["Add", "Subtract", "Multiply", "Divide", "Minimum", "Maximum", "Power", "Modulo", "Absolute", "Invert", "Clamp", "Compare", "Sine", "Round", "Square Root", "Logarithm", "Exponent", "Floor", "Ceiling", "Fraction", "Sign", "Smooth Minimum", "Smooth Maximum", "Snap", "Wrap", "Ping-Pong", "Cosine", "Tangent", "Arctan2", "Greater Than", "Less Than"];
const blendModes = ["normal", "add", "subtract", "multiply", "screen", "overlay", "darken", "lighten", "difference", "soft light", "dodge", "burn", "linear light", "divide", "exclusion", "hue", "saturation", "color", "value"];
const port = (id, label, type = "float") => ({ id, label, type });
const number = (id, label, value, min, max) => ({ id, label, control: "number", default: value, min, max, step: .01, socket: true });
const option = (id, label, labels) => ({ id, label, control: "select", default: 0, options: labels.map((label, value) => ({ label, value })) });
const color = (id, label, value = "#ffffff") => ({ id, label, control: "color", default: value, socket: true });
const def = (title, category, inputs = [], outputs = [port("out", "Value")], params = [], aliases = []) => ({ title, category, inputs, outputs, params, aliases });
const uv = port("uv", "UV", "vector"), c = port("color", "Color", "color");
const types = {
 layer: def("Layer Color", "Input", [], [c, port("alpha", "Alpha")], [], ["Input", "Source", "Image"]),
 uv: def("UV", "Input", [], [port("out", "UV", "vector")]),
 pixel: def("Pixel Coordinate", "Input", [], [port("out", "Position", "vector")], [], ["Position", "Coordinates"]),
 resolution: def("Resolution", "Input", [], [port("out", "Size", "vector")]),
 time: def("Time", "Input", [], [port("out", "Seconds")]),
 parameter: def("Parameter", "Input", [], [port("out", "Value", "color")], [
  {id:"name",label:"Name",control:"text",default:"Amount"}, option("kind", "Type", ["Float", "Color", "Vector2 point"]),
  number("value", "Default", .5), color("color", "Default color"), number("x", "Default X", .5), number("y", "Default Y", .5), number("min", "Minimum", 0), number("max", "Maximum", 1),
 ], ["Expose", "Uniform", "Float", "Point"]),
 noise: def("Noise", "Pattern", [uv], [port("out", "Value"), c], [number("scale", "Scale", 8), number("time", "Time", 0), number("seed", "Seed", 0)], ["Value noise", "Random"]),
 voronoi: def("Voronoi", "Pattern", [uv], [port("out", "Value")], [option("mode", "Distance", ["F1", "F2", "Edge"]), number("scale", "Scale", 8), number("time", "Time", 0)], ["Cells", "Worley"]),
 gradient: def("Gradient", "Pattern", [uv], undefined, [option("mode", "Type", ["Linear", "Radial", "Angular"]), number("angle", "Angle", 0)]),
 checker: def("Checker", "Pattern", [uv], [c, port("out", "Factor")], [number("scale", "Scale", 8), color("a", "Color A", "#000000"), color("b", "Color B")], ["Checkerboard"]),
 wave: def("Wave", "Pattern", [uv], undefined, [number("scale", "Scale", 8), number("time", "Time", 0), number("angle", "Angle", 0)], ["Sine Wave"]),
 math: def("Math", "Math", [], undefined, [option("mode", "Operation", mathModes), number("a", "A", .5), number("b", "B", .5), number("c", "C", .5)]),
 vectorMath: def("Vector Math", "Math", [port("a", "A", "vector"),port("b", "B", "vector")], [port("out", "Vector", "vector"),port("value", "Value")], [option("mode", "Operation", ["Add", "Subtract", "Multiply", "Divide", "Normalize", "Dot Product", "Length", "Distance", "Cross Product"])]),
 mapRange: def("Map Range", "Math", [], undefined, [number("value", "Value", .5),number("fromMin", "From min", 0),number("fromMax", "From max", 1),number("toMin", "To min", 0),number("toMax", "To max", 1),option("clamp", "Clamp", ["Off", "On"])], ["Remap"]),
 clamp: def("Clamp", "Math", [], undefined, [number("value", "Value", .5),number("min", "Minimum", 0),number("max", "Maximum", 1)]),
 mix: def("Mix", "Color", [], [c], [option("mode", "Blend mode", blendModes),color("a", "A", "#000000"),color("b", "B"),number("factor", "Factor", .5,0,1)], ["Blend", "Lerp"]),
 colorRamp: def("Color Ramp", "Color", [], [c,port("alpha", "Alpha")], [number("factor", "Factor", .5),option("interpolation", "Interpolation", ["Constant", "Linear", "Ease", "Cardinal"]),{id:"stops",label:"Stops",control:"ramp",default:[[0,0,0,0,1],[1,1,1,1,1]]}], ["ColorRamp", "Ramp"]),
 hue: def("Hue/Saturation", "Color", [c], [c], [number("hue", "Hue", 0),number("saturation", "Saturation", 1),number("value", "Value", 1)], ["HSV"]),
 brightness: def("Brightness/Contrast", "Color", [c], [c], [number("brightness", "Brightness", 0),number("contrast", "Contrast", 0)]),
 levels: def("Levels", "Color", [c], [c], [number("black", "Input black", 0),number("white", "Input white", 1),number("gamma", "Gamma", 1),number("outBlack", "Output black", 0),number("outWhite", "Output white", 1)]),
 invert: def("Invert", "Color", [c], [c], [number("factor", "Factor", 1)]),
 output: {...def("Output", "Output", [c], [], [number("alpha", "Alpha", 1,0,1)]),maxInstances:1,deletable:false},
};
for (const space of ["RGB", "HSV"]) {
 const keys = space === "RGB" ? ["r","g","b"] : ["h","s","v"];
 const labels = space === "RGB" ? ["Red","Green","Blue"] : ["Hue","Saturation","Value"];
 types["separate"+space] = def("Separate "+space,"Color",[c],keys.map((key,i)=>port(key,labels[i])));
 types["combine"+space] = def("Combine "+space,"Color",[],[c],keys.map((key,i)=>number(key,labels[i],0)));
}
for (const spec of Object.values(types)) {
 spec.outputs ||= [port("out","Value")];
 // Every local numeric/color field can be driven per pixel by a socket.
 if (spec.title !== "Parameter") {
  for (const p of spec.params) if (p.socket) spec.inputs.push(port(p.id,p.label,p.control === "color" ? "color" : "float"));
 } else { for (const p of spec.params) p.socket = false; }
}
function rampSample(stops,t,mode,out) {
 let i=0; while(i<stops.length-1 && stops[i+1][0]<=t) i++;
 const a=stops[i],b=stops[Math.min(i+1,stops.length-1)];
 let f=Math.max(0,Math.min(1,(t-a[0])/(b[0]-a[0]||1)));
 if(mode===0) f=0; if(mode===2) f=f*f*(3-2*f);
 for(let c=0;c<4;c++) {
  const x=a[c+1],y=b[c+1],before=stops[Math.max(0,i-1)][c+1],after=stops[Math.min(stops.length-1,i+2)][c+1];
  out[c]=Math.max(0,Math.min(1,mode===3 ? .5*(2*x+(-before+y)*f+(2*before-5*x+4*y-after)*f*f+(-before+3*x-3*y+after)*f*f*f) : x+(y-x)*f));
 }
 return out;
}
types.colorRamp.params.find(p=>p.id==="interpolation").default=1;
types.colorRamp.params.find(p=>p.id==="stops").sample=rampSample;
module.exports={types,mathModes,blendModes,rampSample};
