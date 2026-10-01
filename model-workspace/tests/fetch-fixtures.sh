#!/usr/bin/env bash
# Downloads public sample models (Khronos glTF samples + three.js examples) used by tests/e2e.mjs.
set -euo pipefail
DIR="${1:-tests/fixtures}"
mkdir -p "$DIR/duck"
K=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models
T=https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models
get() { [ -s "$DIR/$2" ] || curl -sSfL -o "$DIR/$2" "$1"; }
get "$K/DamagedHelmet/glTF-Binary/DamagedHelmet.glb" DamagedHelmet.glb
get "$K/Fox/glTF-Binary/Fox.glb" Fox.glb
get "$K/SheenChair/glTF-Binary/SheenChair.glb" SheenChair.glb
get "$K/ToyCar/glTF-Binary/ToyCar.glb" ToyCar.glb
get "$K/Duck/glTF/Duck.gltf" duck/Duck.gltf
get "$K/Duck/glTF/Duck0.bin" duck/Duck0.bin
get "$K/Duck/glTF/DuckCM.png" duck/DuckCM.png
get "$T/fbx/Samba%20Dancing.fbx" SambaDancing.fbx
get "$T/stl/binary/pr2_head_pan.stl" pr2_head_pan.stl
get "$T/ply/ascii/dolphins.ply" dolphins.ply
get "$T/obj/walt/WaltHead.obj" WaltHead.obj
get "$T/obj/walt/WaltHead.mtl" WaltHead.mtl
echo "fixtures ready in $DIR"
