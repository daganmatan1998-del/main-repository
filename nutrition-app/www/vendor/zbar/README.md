@undecaf/zbar-wasm 0.11.0 (a WebAssembly build of the ZBar barcode reader) (only the sourceMappingURL comment removed):
dist/index.mjs -> zbar.mjs, dist/zbar.wasm -> zbar.wasm. Licence: GNU LGPL 2.1 (LICENSE).
Replace both files with a newer release of the package to update; the wasm is loaded
next to the module, from the same origin.
