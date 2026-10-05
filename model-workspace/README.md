# 3D Workspace

A personal 3D model workspace: import many models into persistent projects,
arrange them side by side, inspect them from every angle, and pick up exactly
where you left off. Runs entirely in the browser — projects and model files are
stored locally in IndexedDB.

```
npm install          # also copies the Draco / KTX2 decoders into public/decoders
npm run dev          # http://localhost:5173
npm run build        # type-check + production build into dist/
```

## Using it

1. **Home** lists your projects (thumbnail, name, last saved, model count, save code).
   Search, sort (recent / name / model count), and open, rename, duplicate,
   copy the code of, or delete any project from its `⋯` menu or right-click.
2. **New Project** asks for a name and opens the editor. Every project gets an
   internal id and a **save code** such as `3D-7K29-XP4M` — type it into
   **Open with Save Code** to find the project. The code identifies a project;
   it is not a password.
3. **Import** with the button, by dropping files (or whole folders) on the
   viewport, or by clicking a sample in **Assets**. Supported: GLB, glTF (with
   its `.bin` and textures dropped together), OBJ (+ MTL and textures), FBX,
   STL, PLY. Draco, Meshopt and KTX2-compressed glTF decode offline.
   New models are placed beside what's already there, standing on the floor.
4. Everything **auto-saves** a moment after each change; the pill in the top bar
   shows *Unsaved changes → Saving… → Saved ✓*. Leaving the editor flushes the
   save and captures a fresh thumbnail.

| Area   | What's there |
|--------|--------------|
| Left   | **Scene** hierarchy (select, shift-click multi-select, double-click rename, drag to reorder, eye / lock / delete, right-click menu) and **Assets** (samples + every model you've imported — click to add another instance) |
| Centre | The 3D world: brown matte floor with the white diagonal X grid, transform gizmo, orientation widget (click an axis to look along it) |
| Right  | **Properties** — transform (drag the X/Y/Z labels to scrub, linked or free scale), dimensions, triangles, vertices, meshes, materials, textures with resolution, animation clips with play/pause. With nothing selected: render quality, lighting, environment, floor & grid, snapping |
| Bottom | Front / Back / Left / Right / Top / Bottom, Fit selected, Fit scene, Reset, Perspective / Orthographic, FPS / triangles / draw calls, quality mode |

### Inspection & productivity tools

The bar at the top of the 3D view:

- **View modes** — Shaded, **Clay** (form without textures), **Wireframe** (topology),
  **X-Ray** (see through), **Normals** (spot flipped faces). `V` cycles.
- **Measure** (`M`) — click two points on models or the floor; distances (with
  ΔX/ΔY/ΔZ) stay listed until cleared. The gizmo steps aside while measuring.
- **Section plane** (`C`) — cut through every model along X, Y or Z with a slider;
  flip the kept side. The floor is never cut.
- **Turntable** (`T`) — slow automatic orbit for presenting; touching the camera stops it.
- **Isolate** (`I`) — show only the selection; saved visibility is untouched. `Esc` exits.
- **Capture** (`P`) — PNG at viewport size, ×2, Full HD, 4K or square; optional
  hidden floor. No gizmo or outlines in the image.

Also:

- **Saved views** (bottom bar → Views) — bookmark camera angles; saved with the project.
- **Notes** per model in the Properties panel (undoable, saved).
- **Export GLB** — a model, the selection or the whole scene, with real materials,
  textures and (for a single model) animations.
- **Project files (`.3dws`)** — one file with the project and every model it uses.
  Export from Project Settings or a card's menu; **Import project** on the home
  screen. This is how projects move between computers, or between the browser and
  the desktop app. Importing never overwrites: clashing ids and save codes get new ones.
- **Command palette** (`Ctrl K`) — run any command or jump to any model by typing.
- **Hide panels** (`Tab`) for a full-width view.

### Performance

- The view redraws only when something changes; an idle scene costs nothing.
- Selection and hover outlines are one cheap pass (draws only the outlined models
  into a small mask) instead of two OutlinePasses — 20 render passes per frame
  became ~5.
- Shadows are re-rendered only when the scene changes, never for camera moves.
- **Adaptive resolution**: while you orbit or drag, frame times are measured and the
  render resolution scales between 50% and the quality mode's maximum (shown as
  *Res* in the bottom bar); it recovers when there's headroom.
- The floor is a matte (Lambert) material with a pre-baked grain texture, since it
  covers most of the screen; overlays above the 3D view avoid backdrop blur.
- Mouse hit-testing pauses while the camera is being dragged.

### Shortcuts

`W` move · `E` rotate · `R` scale · `X` world/local · `S` snapping (hold `Shift`
while dragging to snap temporarily) · `F` focus selected · `A` fit scene ·
`1`/`3`/`7` front/right/top (with `Ctrl` for back/left/bottom) · `5`
perspective/ortho · `Home` reset camera · `Del` delete · `Ctrl D` duplicate ·
`F2` rename · `H` hide · `L` lock · `Ctrl A` select all · `Esc` deselect ·
`Ctrl Z` / `Ctrl Shift Z` undo/redo · `M` measure · `C` section · `V` view mode ·
`I` isolate · `T` turntable · `P` capture · `Tab` hide panels · `Ctrl K` command
palette · `?` all shortcuts.
Mouse: left-drag orbit, right-drag pan, wheel zoom toward the cursor (it keeps
going past the pivot, so you can get as close as you like).

## Architecture

```
src/
  core/          ids + save codes, formatting helpers
  persistence/   IndexedDB wrapper, project + asset repositories
  project/       document types, defaults, validation, project service (create/open/duplicate/delete/GC)
  state/         zustand stores: editor (scene, selection, history), ui (routing, toasts), stats
  loading/       format detection, loaders (GLTF/Draco/KTX2/Meshopt, OBJ+MTL, FBX, STL, PLY), asset cache, model stats
  assets/        procedural sample models (car, chair, table, robot with animation, lamp, material spheres)
  scene/         R3F viewport: floor shader, environments, lights, instances, gizmo, camera rig, post-processing, registry
  editor/        import pipeline, auto-placement & arrange tools, autosave, keyboard shortcuts
  ui/            home screen, editor panels, dialogs, shared controls
  styles/        design tokens + home/editor styles
```

Key decisions:

- **The scene is data.** `InstanceState[]` (asset id, name, transform,
  visibility, lock, animation) plus `SceneSettings` is the single source of
  truth; the viewport reconciles Three.js objects to it. That makes saving a
  plain JSON write and **undo/redo** a snapshot stack (with coalescing for
  slider drags) that covers every edit, including imports and scene settings.
- **Assets are stored once.** Imported files are kept as blobs in IndexedDB,
  de-duplicated by content hash, and shared across instances and projects.
  In memory each asset loads once; instances clone the scene graph but share
  geometry, materials and textures (one GPU copy). Assets are reference-counted
  and disposed shortly after their last instance goes; deleting a project
  garbage-collects assets nothing else uses.
- **No quality loss.** Models render with their own materials and full-resolution
  textures; texture anisotropy follows the quality mode. Large meshes get a BVH
  so hover/picking stays fast, and frustum culling stays on.
- **Rendering.** Neutral (Khronos PBR) tone mapping, image-based lighting from a
  procedural studio (three presets), a key light whose shadow frustum is fitted
  to the scene, HDR composer with MSAA, outline passes for hover/selection and
  GTAO ambient occlusion on Ultra.
- **The floor** is a standard PBR material extended in its shader: procedural
  grain, and two families of 45° lines drawn analytically with screen-space
  derivatives, so the X pattern stays crisp at any distance and fades into the
  horizon instead of aliasing. The plane follows the camera, so it never ends.

## Desktop app

`src-tauri/` wraps the app in Tauri. The workflow
`.github/workflows/workspace-desktop.yml` builds the Windows installer on every
push that touches `model-workspace/` and publishes it as a GitHub Release.

## Testing

`tests/e2e.mjs` drives the real app in Chromium through the complete workflow:
create a project, import nine models in six formats at once, select in both the
hierarchy and the viewport, move/rotate/scale (properties panel and gizmo drag),
undo/redo, duplicate/rename/hide/lock/delete, place side by side, every camera
view, autosave, close the browser, reopen, find the project (with thumbnail) on
the home screen, open it by save code and compare the restored scene, plus
"Project not found." / "Unable to load project." paths.

`tests/tools.mjs` covers the inspection tools and the performance budget: render
passes per frame with a selection and a hover (≤ 6), no shadow re-render during
camera moves, every view mode, section, measure (models and floor), isolate,
turntable, saved views, notes, the palette, hiding panels, a 1920×1080 capture
(checked from the PNG header), GLB export, and a `.3dws` export → import round trip.

`tests/features.mjs` covers the rest: sample assets and instancing, animation
playback, orthographic camera, all three quality modes, environment presets,
undo of scene settings, and project rename / duplicate / delete from both the
editor and the home screen.

```
npm run test:fixtures             # Khronos glTF samples + three.js example models
npm run build && npx vite preview --port 5199 &
npm run test:e2e                  # needs `playwright` resolvable (npm i -D playwright)
node tests/tools.mjs
```
