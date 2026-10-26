import { newVariant, newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
import { parse } from "acorn";
import wasm from "community-wasm";
export { parse };
export function create() {
  const bytes = Uint8Array.from(atob(wasm), c => c.charCodeAt(0));
  return newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, {
    wasmBinary: bytes.buffer,
    wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: 1024 }),
    // Emscripten asks for a locator even when wasmBinary is supplied.
    locateFile: () => "data:application/wasm;base64,",
  }));
}
