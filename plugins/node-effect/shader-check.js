"use strict";
// Validate in an owned context before replacing a working viewport shader.
// Link errors such as an exceeded uniform budget are graph errors too.
function createShaderCheck(document) {
 let gl=null;
 return {
  check(source) {
   gl ||= document.createElement("canvas").getContext("webgl");
   if(!gl)throw new Error("WebGL shader validation is unavailable.");
   const vertex=gl.createShader(gl.VERTEX_SHADER),fragment=gl.createShader(gl.FRAGMENT_SHADER),program=gl.createProgram();
   try {
    gl.shaderSource(vertex,"attribute vec2 position; varying vec2 vUv; void main(){vUv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}");
    gl.shaderSource(fragment,source);
    for(const shader of [vertex,fragment]) {
     gl.compileShader(shader);
     if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error("Shader could not compile. "+gl.getShaderInfoLog(shader));
     gl.attachShader(program,shader);
    }
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error("Shader exceeds the GPU limits. "+gl.getProgramInfoLog(program));
   }finally{gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);}
  },
  dispose(){gl?.getExtension("WEBGL_lose_context")?.loseContext();gl=null;},
 };
}
module.exports={createShaderCheck};
