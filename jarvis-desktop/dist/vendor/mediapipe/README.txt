MediaPipe Tasks Vision 1.0.1 (npm @mediapipe/tasks-vision), Apache-2.0.
Vendored so hand tracking works offline and never depends on a CDN:
  vision_bundle.js                 the IIFE build (global `Vision`)
  wasm/vision_wasm_internal.*      the SIMD runtime (WebView2 always has SIMD)
  hand_landmarker.task             the float16 hand landmark model
    (storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1)
Used by camera.html → gesture-zoom.js. The nosimd runtime is deliberately
not shipped: every WebView2 supports WebAssembly SIMD.
Privacy notice: https://goo.gle/mediapipe-privacy — everything runs locally;
no frame leaves the machine for hand tracking.
