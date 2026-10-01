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

### Shortcuts

`W` move · `E` rotate · `R` scale · `X` world/local · `S` snapping (hold `Shift`
while dragging to snap temporarily) · `F` focus selected · `A` fit scene ·
`1`/`3`/`7` front/right/top (with `Ctrl` for back/left/bottom) · `5`
perspective/ortho · `Home` reset camera · `Del` delete · `Ctrl D` duplicate ·
`F2` rename · `H` hide · `L` lock · `Ctrl A` select all · `Esc` deselect ·
`Ctrl Z` / `Ctrl Shift Z` undo/redo · `?` all shortcuts.
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

## Testing

`tests/e2e.mjs` drives the real app in Chromium through the complete workflow:
create a project, import nine models in six formats at once, select in both the
hierarchy and the viewport, move/rotate/scale (properties panel and gizmo drag),
undo/redo, duplicate/rename/hide/lock/delete, place side by side, every camera
view, autosave, close the browser, reopen, find the project (with thumbnail) on
the home screen, open it by save code and compare the restored scene, plus
"Project not found." / "Unable to load project." paths.

```
bash tests/fetch-fixtures.sh      # Khronos glTF samples + three.js example models
npm run dev -- --port 5199 &
node tests/e2e.mjs                # needs `playwright` resolvable
```
