/**
 * Test-only preload: @oma3/omatrust/identity fails under tsx's CJS resolution
 * (multiformats "./cid" export), but loads fine as native ESM. Shim CJS requires
 * so service modules under test can import identity without changing production code.
 */
import Module from "node:module";

const identity = await import("@oma3/omatrust/identity");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "@oma3/omatrust/identity") {
    return identity;
  }
  return originalLoad.call(this, request, parent, isMain);
};
