MediaPipe Tasks Vision 1.0.1 (npm @mediapipe/tasks-vision), Apache-2.0.
Vendored so hand tracking works offline and never depends on a CDN:
  vision_bundle.js                 the IIFE build (global `Vision`)
  wasm/vision_wasm_internal.*      the SIMD runtime (WebView2 always has SIMD)
  hand_landmarker.task             the float16 hand landmark model
    (storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1)
  pose_landmarker_lite.task        the float16 pose landmark model (lite), for the web
                                   shooters' forearm: elbow to wrist (2.26.0)
    (storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1,
     sha256 59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a)
Used by camera.html → gesture-zoom.js (hands) and webshooter.js (pose, only
while the web shooters are on). The nosimd runtime is deliberately
not shipped: every WebView2 supports WebAssembly SIMD.
Privacy notice: https://goo.gle/mediapipe-privacy — everything runs locally;
no frame leaves the machine for hand tracking.
