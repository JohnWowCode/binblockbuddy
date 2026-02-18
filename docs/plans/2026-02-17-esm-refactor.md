# ES Module Refactoring Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the monolithic `main.js` (4,389 lines) into ~12 ES modules under `src/`, wire up with import maps, and remove all inline `onclick` handlers from the HTML -- without changing any visible behavior.

**Architecture:** Central `state.js` module exports a shared mutable state object. All other modules import from it. Each module exports an `init()` function that binds DOM event listeners. `src/main.js` is the entry point that imports and calls all init functions. CDN deps (omggif, gif.js) are mapped via `<script type="importmap">` but still loaded lazily via dynamic `import()`.

**Tech Stack:** Vanilla ES modules, import maps, no build system, no frameworks.

---

## Inline onclick handlers to remove

There are ~50 inline handlers in `index.html`. Each must be replaced by an `addEventListener` call in the owning module's `init()` function. Here is the complete mapping:

| HTML element | Current handler | Module | Binding |
|---|---|---|---|
| `.panel-toggle` (palette) | `onclick="toggleSidePanel('palette')"` | canvas.js | `initCanvas()` |
| Upload btn | `onclick="addImageEmoji()"` | palette.js | `initPalette()` |
| Rename btn | `onclick="renameSelectedEmoji()"` | palette.js | `initPalette()` |
| Settings btn | `onclick="openSettingsPanel()"` | theme.js | `initTheme()` |
| Help btn | `onclick="openHelpPanel()"` | theme.js | `initTheme()` |
| Changelog btn | `onclick="openChangelog()"` | theme.js | `initTheme()` |
| Warning btn | `onclick="openExperimentalWarning()"` | theme.js | `initTheme()` |
| Mode toggle | `onclick="toggleCanvasMode()"` | freeform.js | `initFreeform()` |
| Mode select | `onchange="setMode(this.value)"` | canvas.js | `initCanvas()` |
| Clear btn | `onclick="clearGrid()"` | canvas.js | `initCanvas()` |
| Undo btn | `onclick="undo()"` | history.js | `initHistory()` |
| Redo btn | `onclick="redo()"` | history.js | `initHistory()` |
| Import btn | `onclick="openImportDialog()"` | import.js | `initImport()` |
| Gimport btn | `onclick="openGimportDialog()"` | animation.js | `initAnimation()` |
| Random Infinite | `onclick="randomInfinite()"` | generators.js | `initGenerators()` |
| Random Face | `onclick="randomFace()"` | generators.js | `initGenerators()` |
| Random Flower | `onclick="randomFlower()"` | generators.js | `initGenerators()` |
| Random House | `onclick="randomHouse()"` | generators.js | `initGenerators()` |
| Brush btn | `onclick="setTool('brush')"` | tools.js | `initTools()` |
| Bucket btn | `onclick="setTool('bucket')"` | tools.js | `initTools()` |
| Select btn | `onclick="setTool('select')"` | tools.js | `initTools()` |
| Mirror btn | `onclick="toggleMirror()"` | tools.js | `initTools()` |
| Zoom btn | `onclick="cycleZoom()"` | canvas.js | `initCanvas()` |
| Fit btn | `onclick="resetView()"` | canvas.js | `initCanvas()` |
| Animate toggle | `onclick="toggleAnimateMode()"` | animation.js | `initAnimation()` |
| Drag btn | `onclick="setSelectionMode('drag')"` | tools.js | `initTools()` |
| Select sub-btn | `onclick="setSelectionMode('select')"` | tools.js | `initTools()` |
| Move sub-btn | `onclick="setSelectionMode('move')"` | tools.js | `initTools()` |
| Copy sub-btn | `onclick="setSelectionMode('copy')"` | tools.js | `initTools()` |
| Delete sub-btn | `onclick="setSelectionMode('delete')"` | tools.js | `initTools()` |
| Prev frame | `onclick="prevFrame()"` | animation.js | `initAnimation()` |
| Next frame | `onclick="nextFrame()"` | animation.js | `initAnimation()` |
| Play/Stop | `onclick="togglePlayStop()"` | animation.js | `initAnimation()` |
| Add Frame | `onclick="addFrame()"` | animation.js | `initAnimation()` |
| Delete Frame | `onclick="deleteFrame()"` | animation.js | `initAnimation()` |
| Duplicate Frame | `onclick="duplicateFrame()"` | animation.js | `initAnimation()` |
| Save PNG | `onclick="savePng()"` | export.js | `initExport()` |
| Save GIF | `onclick="saveGif()"` | animation.js | `initAnimation()` |
| Save .binblock | `onclick="saveBinblock()"` | serialization.js | `initSerialization()` |
| Load .binblock | `onclick="triggerBinblockLoad()"` | serialization.js | `initSerialization()` |
| binblockInput | `onchange="handleBinblockFileChange(event)"` | serialization.js | `initSerialization()` |
| `.panel-toggle` (output) | `onclick="toggleSidePanel('output')"` | canvas.js | `initCanvas()` |
| Copy All | `onclick="copyExport()"` | export.js | `initExport()` |
| Rows-per-part slider | `oninput="updateHalfRowsFromUI(this.value)"` | export.js | `initExport()` |
| Preview container | `onclick="openPreviewModal()"` | export.js | `initExport()` |
| Palette tag | `onclick="toggleSidePanel('palette', false)"` | canvas.js | `initCanvas()` |
| Export tag | `onclick="toggleSidePanel('output', false)"` | canvas.js | `initCanvas()` |
| Theme presets (x6) | `onclick="applyThemePreset('...')"` | theme.js | `initTheme()` |
| Theme color inputs (x6) | `oninput="saveThemeSettingsFromUI()"` | theme.js | `initTheme()` |
| Reset theme | `onclick="resetThemeToDefaults()"` | theme.js | `initTheme()` |
| Close settings | `onclick="closeSettingsPanel()"` | theme.js | `initTheme()` |
| Close help | `onclick="closeHelpPanel()"` | theme.js | `initTheme()` |
| Close changelog | `onclick="closeChangelog()"` | theme.js | `initTheme()` |
| Close preview | `onclick="closePreviewModal()"` | export.js | `initExport()` |

---

## Module map with function assignments

### `src/state.js` (~80 lines)
Constants and shared mutable state. Imports nothing.

**Exports:**
- `TILE_SIZE`, `BINBLOCK_VERSION`, `MAX_FRAMES`, `MAX_IMPORT_SIZE`, `DEFAULT_ROWS`, `DEFAULT_COLS`
- `FREEFORM_DISTANCE_THRESHOLD`
- `zoomLevels`, `brushSizeRadii`
- `bandColors`, `tips`
- `state` object containing all mutable state:
  - grid, rows, cols, activeBrush, isMouseDown, isPainting
  - basePalette, imageDefaults, customPalette, palette, paletteColorCache, paletteColorPromises
  - currentTool, mirrorEnabled, selection, selectionMode, selectionStart, isSelectingDrag, mouseListenersAttached, clipboardSelection
  - canvasMode, zoomIndex, currentZoomFactor, canvasPanX, canvasPanY
  - history, future, brushHistory, brushHistoryIndex
  - animateMode, frames, currentFrame, isPlaying, playbackInterval
  - freeformStamps, freeformStampId, isFreeformPainting, lastFreeformPoint, freeformLayerListenersAttached, freeformHistoryPushed, currentBrushSizeIndex, brushOffsetsCache, freeformSelectionIds, isFreeformSelecting, freeformSelectionStart, isFreeformDraggingSelection, freeformDragStartPoint, freeformSelectionSnapshot, freeformSelectionRect
  - spacePanHandlersAttached, isSpacePanHeld, isSpacePanDragging, spacePanStart, spacePanPointerId, spacePanViewport
  - currentAssetPack
  - themeSettings
  - exportChunks, exportHalfChunks, exportTopChunks, exportLabel, lastExportText, rowsPerPart
  - moveHistoryPushed, dragTargetR, dragTargetC
  - omggifLoadingPromise, gifJsPromise, imageElementCache

### `src/utils.js` (~80 lines)
Pure utility functions. No DOM access. Imports only `state.js`.

**Exports:**
- `clamp(value, min, max)`
- `waitForAnimationFrame()`
- `shouldUseCrossOrigin(src)`, `applyCrossOriginIfNeeded(img, src)`
- `readFileAsText(file)`, `readFileAsDataURL(file)`
- `loadImageSource(src)`
- `colorDistance(c1, c2)`, `brightenColor(hex)`
- `cloneBrushItem(item)`, `itemsEqual(a, b)`
- `getCanvasDimensions()`
- `getBandColor(index)`
- `getDefaultBrushCodeForPack()`, `getDefaultBackgroundCodeForPack()`
- `getBackgroundItem()` (reads state.palette)
- `getRandomPaletteItem()` (reads state.palette)

### `src/palette.js` (~300 lines)
Palette data management, rendering, asset packs, color matching, custom emoji.

**Imports:** state.js, utils.js
**Exports:** `initPalette()`, `renderPalette()`, `rebuildImageDefaults()`, `getAllPaletteEntries()`, `ensurePaletteColors()`, `getPaletteCacheKey()`, `findPaletteMatch()`, `findClosestPaletteEntry()`, `setAssetPack()`

**Contains:**
- `normalizeAssetPack()`, `loadAssetPackSetting()`, `persistAssetPackSetting()`, `setAssetPack()`, `updateAssetPackUI()`, `rebuildImageDefaults()`
- `getAllPaletteEntries()`, `getPaletteCacheKey()`, `computeAverageColorFromImage()`, `ensurePaletteColor()`, `ensurePaletteColors()`
- `findPaletteMatch()`, `findClosestPaletteEntry()`
- `rebuildPaletteFromFlags()`, `renderPalette()`
- `addImageEmoji()`, `renameSelectedEmoji()`
- `addToBrushHistory()`, `navigateBrushHistory()`
- `initPalette()`: binds favorites checkbox, asset pack radios, file input, keyboard shortcuts for brush history

### `src/history.js` (~80 lines)
Undo/redo stack management.

**Imports:** state.js, canvas.js (renderGrid, updateFreeformLayer), export.js (updateExport)
**Exports:** `initHistory()`, `pushHistory()`, `undo()`, `redo()`, `cloneGrid()`, `cloneFreeformArray()`, `captureEditorState()`, `applyEditorState()`

**Contains:**
- `cloneGrid()`, `cloneFreeformArray()`, `captureEditorState()`, `applyEditorState()`
- `pushHistory()`, `undo()`, `redo()`
- `initHistory()`: binds Ctrl+Z, Ctrl+Shift+Z keyboard shortcuts, undo/redo buttons

### `src/tools.js` (~250 lines)
Tool logic: brush, bucket, selection, mirror.

**Imports:** state.js, utils.js, history.js (pushHistory), canvas.js (renderGrid, refreshPanCursorState), export.js (updateExport), freeform.js (updateFreeformLayer)
**Exports:** `initTools()`, `setTool()`, `setSelectionMode()`, `bucketFill()`, `toggleMirror()`

**Contains:**
- `setTool()`, `toggleMirror()`
- `bucketFill()`
- `createSelection()`, `moveSelectionTo()`
- `setSelectionMode()`
- `mergeSelectionRects()`, `renderGridWithPreview()`, `handleSelectionActionAt()`
- `initTools()`: binds tool buttons, selection sub-mode buttons

### `src/canvas.js` (~500 lines)
Grid rendering, zoom, pan, viewport, panel visibility, mode presets.

**Imports:** state.js, utils.js, history.js (pushHistory), tools.js (bucketFill), export.js (updateExport)
**Exports:** `initCanvas()`, `renderGrid()`, `generateGrid()`, `clearGrid()`, `applyZoom()`, `updateCanvasTransform()`, `clampPanOffsets()`, `toggleSidePanel()`, `isPanModeActive()`, `refreshPanCursorState()`, `ensureSpacePanHandlers()`, `autoFitZoom()`, `updateZoomButtonLabel()`, `setMode()`, `updateRowsColsInputs()`

**Contains:**
- `generateGrid()`, `clearGrid()`, `renderGrid()` (the big cell-building loop + event binding)
- `setMode()`, `updateRowsColsInputs()`
- `applyZoom()`, `updateZoomButtonLabel()`, `cycleZoom()`, `resetView()`, `autoFitZoom()`
- `updateCanvasTransform()`, `clampPanOffsets()`
- `isPanModeActive()`, `refreshPanCursorState()`
- `ensureSpacePanHandlers()`, `attachSpacePanViewportHandlers()`, `handleCanvasWheel()`, all space-pan handlers
- `toggleSidePanel()`, `updatePanelVisibilityState()`
- `initCanvas()`: binds mode select, clear, zoom, fit, pan handlers, row/col inputs, panel toggles

### `src/export.js` (~350 lines)
Text export, copy-to-clipboard, chunking, visual preview, PNG save, tips.

**Imports:** state.js, utils.js, canvas.js (for overlay functions)
**Exports:** `initExport()`, `updateExport()`, `savePng()`, `setSavingOverlay()`, `updateSavingOverlayStatus()`

**Contains:**
- `updateExport()` (the big export builder with colored text, chunks, preview)
- `updateHalfRowsFromUI()`
- `copyExport()`, `copyExportChunk()`, `copyExportHalfChunk()`
- `savePng()`
- `setSavingOverlay()`, `updateSavingOverlayStatus()`
- `renderTips()`
- `openPreviewModal()`, `closePreviewModal()`
- `initExport()`: binds Copy All, slider, preview click, Save PNG button

### `src/theme.js` (~200 lines)
Theme presets, color customization, settings/help/changelog overlays.

**Imports:** state.js
**Exports:** `initTheme()`, `applyThemeSettings()`, `loadThemeSettings()`

**Contains:**
- `themeDefaults`, `themePresets`, `THEME_STORAGE_KEY`
- `loadThemeSettings()`, `persistThemeSettings()`, `applyThemeSettings()`
- `openSettingsPanel()`, `closeSettingsPanel()`
- `openHelpPanel()`, `closeHelpPanel()`
- `openChangelog()`, `closeChangelog()`
- `openExperimentalWarning()`
- `saveThemeSettingsFromUI()`, `resetThemeToDefaults()`, `applyThemePreset()`
- `toggleTheme()`
- `initTheme()`: binds settings button, help, changelog, warning, theme color inputs, preset buttons, close buttons

### `src/serialization.js` (~200 lines)
.binblock save/load, data normalization, brush serialization.

**Imports:** state.js, utils.js, palette.js (renderPalette), canvas.js (renderGrid, generateGrid, updateRowsColsInputs), export.js (updateExport), history.js (cloneGrid, cloneFreeformArray), animation.js (updateFrameDisplay), freeform.js (updateFreeformLayer, updateCanvasModeUI)
**Exports:** `initSerialization()`, `serializeBrushItem()`, `deserializeBrushItem()`, `serializeGridStateData()`, `deserializeGridStateData()`, `serializeFreeformStamps()`, `deserializeFreeformStamps()`, `normalizeGridData()`, `normalizeFrameData()`, `buildBinblockPayload()`

**Contains:**
- `serializeBrushItem()`, `deserializeBrushItem()`
- `serializeGridStateData()`, `deserializeGridStateData()`
- `serializeFreeformStamps()`, `deserializeFreeformStamps()`
- `buildBinblockPayload()`, `normalizeGridData()`, `normalizeFrameData()`
- `saveBinblock()`, `triggerBinblockLoad()`, `handleBinblockFileChange()`, `applyBinblockPayload()`
- `initSerialization()`: binds save/load buttons, binblockInput change handler

### `src/animation.js` (~350 lines)
Multi-frame animation, GIF export, GIF import.

**Imports:** state.js, utils.js, history.js (cloneGrid, cloneFreeformArray), canvas.js (renderGrid), export.js (updateExport, setSavingOverlay, updateSavingOverlayStatus, savePng), freeform.js (updateFreeformLayer), palette.js (getAllPaletteEntries, ensurePaletteColors, getPaletteCacheKey, findClosestPaletteEntry)
**Exports:** `initAnimation()`, `toggleAnimateMode()`, `updateFrameDisplay()`, `saveCurrentFrame()`, `loadFrame()`

**Contains:**
- `toggleAnimateMode()`, `updateFrameDisplay()`
- `saveCurrentFrame()`, `loadFrame()`, `loadFreeformFrame()`
- `prevFrame()`, `nextFrame()`, `addFrame()`, `deleteFrame()`, `duplicateFrame()`
- `togglePlayStop()`
- `saveGif()`, `ensureGifJs()`, `loadGifJs()`, `loadGifWorkerBlob()`
- `openGimportDialog()`, `handleGimportChange()`, `importGifFile()`, `parseGifFrames()`, `decodeGifWithImageDecoder()`, `parseGifFramesFallback()`
- `gridFromImageData()` (used by GIF import for frame conversion)
- `initAnimation()`: binds animate toggle, frame nav, play/stop, add/delete/duplicate frame, save GIF, gimport input

### `src/import.js` (~200 lines)
Image import (non-GIF). Separated from animation because it's a distinct feature.

**Imports:** state.js, utils.js, palette.js (getAllPaletteEntries, ensurePaletteColors, getPaletteCacheKey, findClosestPaletteEntry), history.js (pushHistory), canvas.js (renderGrid), export.js (updateExport, setSavingOverlay, updateSavingOverlayStatus), freeform.js (updateFreeformLayer)
**Exports:** `initImport()`, `importImageFile()`

**Contains:**
- `openImportDialog()`, `handleImportImageChange()`, `importImageFile()`
- `applyImageToGrid()`, `gridFromImageDataForImport()`
- `getImageElement()`, `ensureOmggif()` (moved to animation.js or shared)
- `initImport()`: binds import button, importImageInput change handler

### `src/freeform.js` (~400 lines)
Freeform mode, stamp painting, brush shapes, freeform selection.

**Imports:** state.js, utils.js, history.js (pushHistory), canvas.js
**Exports:** `initFreeform()`, `updateFreeformLayer()`, `updateCanvasModeUI()`, `setCanvasMode()`

**Contains:**
- `toggleCanvasMode()`, `setCanvasMode()`, `updateCanvasModeUI()`
- `ensureFreeformLayerListeners()`, `handleFreeformPointerDown()`, `handleFreeformPointerMove()`, `handleFreeformPointerUp()`
- `freeformBucketFill()`, `placeFreeformStamp()`
- `addFreeformStampAtPosition()`, `addStampWithMirror()`
- `getCanvasPointFromEvent()`, `pointToCell()`
- `getBrushOffsets()`, `isShapePoint()`
- `updateFreeformLayer()`
- `initFreeform()`: binds mode toggle button, brush shape select

### `src/generators.js` (~350 lines)
Random generators: infinite, face, flower, house, car, cat, dog, alien.

**Imports:** state.js, utils.js, history.js (pushHistory), canvas.js (renderGrid), export.js (updateExport)
**Exports:** `initGenerators()`

**Contains:**
- `randomInfinite()`, `randomFace()`, `randomFlower()`, `randomHouse()`
- `randomCar()`, `randomCat()`, `randomDog()`, `randomAlien()`
- `initGenerators()`: binds all random buttons

### `src/gif-encoder.js` (~250 lines)
Inline SimpleGIFEncoder, ByteArray, LZWEncoder classes. No DOM access.

**Imports:** nothing
**Exports:** `SimpleGIFEncoder`, `ByteArray`, `LZWEncoder`

### `src/main.js` (~50 lines)
Entry point. Imports everything, calls init functions, runs startup logic.

**Imports:** all modules
**Contains:**
- Import all init functions
- Call them in order on DOMContentLoaded (or at top-level since modules are deferred)
- Initial `generateGrid()`, `setTool('brush')`, `setSelectionMode('select')`, default brush setup, `ensureSpacePanHandlers()`, initial `clampPanOffsets()`

---

## Circular dependency analysis

The main risk is between `canvas.js` and `tools.js`:
- `tools.js` calls `renderGrid()` from `canvas.js`
- `canvas.js`'s `renderGrid()` inline handlers call `bucketFill()` from `tools.js`

**Resolution:** `renderGrid()` attaches cell mousedown handlers that reference `bucketFill` from tools.js. Since these are closures executed later (not at import time), the circular import resolves fine -- by the time a user clicks a cell, both modules are fully loaded. ES modules handle this correctly as long as the circular reference isn't used during module evaluation.

Same pattern for `undo()`/`redo()` calling `renderGrid()` and `updateExport()`.

---

## Tasks

### Task 1: Create `src/state.js`

**Files:**
- Create: `src/state.js`

**Step 1: Write the state module**

Extract all constants and mutable state from `main.js` lines 1-44, 538, 744-755, 881-882, 1502-1553, 1555-1618, 3431-3437, 3746-3756. Group into a single `state` object and named constant exports.

The `state` object must contain every `let` variable that is mutated across module boundaries. Constants that never change (`TILE_SIZE`, `zoomLevels`, etc.) are separate named exports.

**Step 2: Verify** no functions or DOM access in state.js -- it's pure data.

---

### Task 2: Create `src/utils.js`

**Files:**
- Create: `src/utils.js`

**Step 1:** Extract pure utility functions that have no DOM side effects (or minimal DOM for things like `loadImageSource`):
- `clamp` (line 2890)
- `waitForAnimationFrame` (line 157)
- `shouldUseCrossOrigin`, `applyCrossOriginIfNeeded` (lines 58-69)
- `readFileAsText`, `readFileAsDataURL` (lines 456-935)
- `loadImageSource` (line 937)
- `colorDistance`, `brightenColor` (lines 1012-1774)
- `cloneBrushItem`, `itemsEqual` (lines 257, 3167)
- `getCanvasDimensions` (line 45)
- `getBandColor` (line 1548)
- `getDefaultBrushCodeForPack`, `getDefaultBackgroundCodeForPack` (lines 108-114)
- `getBackgroundItem`, `getRandomPaletteItem` (lines 1138-1146)

All of these import `state` for reading `state.currentAssetPack`, `state.palette`, etc.

---

### Task 3: Create `src/gif-encoder.js`

**Files:**
- Create: `src/gif-encoder.js`

**Step 1:** Move the three classes verbatim (lines 3832-4085): `SimpleGIFEncoder`, `ByteArray`, `LZWEncoder`. Add `export` before each class declaration.

---

### Task 4: Create `src/history.js`

**Files:**
- Create: `src/history.js`

**Step 1:** Extract undo/redo functions (lines 1915-2023):
- `cloneGrid`, `cloneFreeformArray`, `captureEditorState`, `applyEditorState`
- `pushHistory`, `undo`, `redo`
- Keyboard listener for Ctrl+Z / Ctrl+Shift+Z (lines 2005-2023)
- Undo/redo button binding

Import `renderGrid` from canvas.js, `updateExport` from export.js, `updateFreeformLayer` from freeform.js. These are used inside `undo()`/`redo()` but called at runtime (not import time), so circular deps are safe.

---

### Task 5: Create `src/palette.js`

**Files:**
- Create: `src/palette.js`

**Step 1:** Extract palette functions:
- Asset pack management (lines 71-155): `normalizeAssetPack`, `loadAssetPackSetting`, `persistAssetPackSetting`, `setAssetPack`, `updateAssetPackUI`, `rebuildImageDefaults`
- Palette rendering (lines 1776-1843): `rebuildPaletteFromFlags`, `renderPalette`
- Color matching (lines 749-838): `getAllPaletteEntries`, `getPaletteCacheKey`, `computeAverageColorFromImage`, `ensurePaletteColor`, `ensurePaletteColors`, `findPaletteMatch`, `findClosestPaletteEntry`
- Custom emoji (lines 3059-3093): `addImageEmoji`, `renameSelectedEmoji`
- Brush history (lines 1973-2003): `addToBrushHistory`, `navigateBrushHistory`
- `initPalette()`: favorites checkbox, asset pack radios, brush history keyboard shortcuts (Ctrl+Arrow), initial palette render

---

### Task 6: Create `src/theme.js`

**Files:**
- Create: `src/theme.js`

**Step 1:** Extract theme functions (lines 1555-1747):
- Theme defaults, presets, storage key (as module-level constants, NOT in state)
- `loadThemeSettings`, `persistThemeSettings`, `applyThemeSettings`
- `openSettingsPanel`, `closeSettingsPanel`
- `openHelpPanel`, `closeHelpPanel`
- `openChangelog`, `closeChangelog`
- `openExperimentalWarning`
- `saveThemeSettingsFromUI`, `resetThemeToDefaults`, `applyThemePreset`
- `toggleTheme`
- `initTheme()`: bind all settings/help/changelog buttons, theme color inputs, preset buttons

---

### Task 7: Create `src/export.js`

**Files:**
- Create: `src/export.js`

**Step 1:** Extract export functions:
- `updateExport` (lines 2248-2447) -- the big export builder
- `updateHalfRowsFromUI` (line 1750)
- `copyExport`, `copyExportChunk`, `copyExportHalfChunk` (lines 2449-2465)
- `savePng` (lines 2931-3044)
- `setSavingOverlay`, `updateSavingOverlayStatus` (lines 3806-3829)
- `renderTips` (line 3046)
- `openPreviewModal`, `closePreviewModal` (these are referenced in HTML but not yet defined in main.js -- they need to be created if missing, or the onclick can be a no-op)
- `initExport()`: bind Copy All, slider, preview click, Save PNG

---

### Task 8: Create `src/canvas.js`

**Files:**
- Create: `src/canvas.js`

**Step 1:** Extract canvas/grid functions:
- `generateGrid`, `clearGrid` (lines 2026-2077)
- `renderGrid` (lines 2079-2245) -- including cell event handlers
- `setMode` (lines 884-926)
- `updateRowsColsInputs` (line 407)
- Zoom/pan functions (lines 2467-2656): `applyZoom`, `updateZoomButtonLabel`, `cycleZoom`, `resetView`, `autoFitZoom`, `ensureSpacePanHandlers`, all space-pan handlers
- `updateCanvasTransform`, `clampPanOffsets` (lines 177-234)
- `isPanModeActive`, `refreshPanCursorState` (lines 167-175)
- Panel visibility (lines 2894-2928): `toggleSidePanel`, `updatePanelVisibilityState`
- `initCanvas()`: bind mode select, clear, zoom, fit, row/col inputs, panel toggles, edge tags

---

### Task 9: Create `src/tools.js`

**Files:**
- Create: `src/tools.js`

**Step 1:** Extract tool functions:
- `setTool` (lines 3131-3165)
- `toggleMirror` (lines 3122-3128)
- `bucketFill` (lines 3176-3193)
- `createSelection`, `moveSelectionTo` (lines 3195-3244)
- `setSelectionMode` (lines 3246-3286)
- `mergeSelectionRects` (line 540)
- `renderGridWithPreview` (lines 545-635) -- this is selection-specific grid rendering
- `handleSelectionActionAt` (lines 637-738)
- `initTools()`: bind brush/bucket/select/mirror buttons, selection sub-mode buttons

---

### Task 10: Create `src/freeform.js`

**Files:**
- Create: `src/freeform.js`

**Step 1:** Extract freeform functions:
- `toggleCanvasMode`, `setCanvasMode`, `updateCanvasModeUI` (lines 2658-2684)
- `ensureFreeformLayerListeners` (line 2686)
- All freeform pointer handlers (lines 2699-2834)
- `freeformBucketFill` (line 2728)
- `addFreeformStampAtPosition`, `addStampWithMirror` (lines 271-296)
- `getCanvasPointFromEvent`, `pointToCell` (lines 298-315)
- `getBrushOffsets`, `isShapePoint` (lines 236-251, 2836-2851)
- `updateFreeformLayer` (lines 2853-2888)
- `initFreeform()`: bind mode toggle button

---

### Task 11: Create `src/import.js`

**Files:**
- Create: `src/import.js`

**Step 1:** Extract image import functions:
- `openImportDialog`, `handleImportImageChange` (lines 844-865)
- `importImageFile`, `applyImageToGrid` (lines 990-1084)
- `gridFromImageDataForImport` (lines 1107-1135)
- `getImageElement` (lines 980-988)
- `ensureOmggif` (lines 947-978) -- shared with animation.js, put it here since import uses it too
- `initImport()`: bind import button, importImageInput change handler

---

### Task 12: Create `src/animation.js`

**Files:**
- Create: `src/animation.js`

**Step 1:** Extract animation + GIF functions:
- Animation state management (lines 3439-3589): `toggleAnimateMode`, `updateFrameDisplay`, `saveCurrentFrame`, `loadFrame`, `loadFreeformFrame`, `prevFrame`, `nextFrame`, `addFrame`, `deleteFrame`, `duplicateFrame`, `togglePlayStop`
- GIF export (lines 3591-3804): `saveGif`, `ensureGifJs`, `loadGifJs`, `loadGifWorkerBlob`, GIF_JS_SOURCES, GIF_WORKER_SOURCES
- GIF import (lines 4087-4389): `openGimportDialog`, `handleGimportChange`, `importGifFile`, `parseGifFrames`, `decodeGifWithImageDecoder`, `parseGifFramesFallback`, `gridFromImageData`
- `initAnimation()`: bind animate toggle, frame buttons, save GIF, gimport input

---

### Task 13: Create `src/generators.js`

**Files:**
- Create: `src/generators.js`

**Step 1:** Extract all random generators (lines 1137-1500, 3287-3428):
- `randomInfinite`, `randomFace`, `randomFlower`, `randomHouse`
- `randomCar`, `randomCat`, `randomDog`, `randomAlien`
- `initGenerators()`: bind the 4 random buttons (infinite, face, flower, house)

---

### Task 14: Create `src/main.js` entry point

**Files:**
- Create: `src/main.js`

**Step 1:** Write the entry point that imports all modules and calls init:

```js
import { state } from './state.js';
import { initPalette, rebuildImageDefaults, renderPalette } from './palette.js';
import { initCanvas, generateGrid, ensureSpacePanHandlers, clampPanOffsets, autoFitZoom } from './canvas.js';
import { initTools, setTool, setSelectionMode } from './tools.js';
import { initExport } from './export.js';
import { initHistory } from './history.js';
import { initTheme, loadThemeSettings, applyThemeSettings } from './theme.js';
import { initAnimation } from './animation.js';
import { initFreeform } from './freeform.js';
import { initGenerators } from './generators.js';
import { initSerialization } from './serialization.js';
import { initImport } from './import.js';
import { getDefaultBrushCodeForPack } from './utils.js';
import { addToBrushHistory } from './palette.js';

// Build palette data before any rendering
rebuildImageDefaults();

// Init all modules (binds event listeners)
initTheme();
initPalette();
initCanvas();
initTools();
initExport();
initHistory();
initAnimation();
initFreeform();
initGenerators();
initSerialization();
initImport();

// Initial grid and tool setup
generateGrid();
setTool('brush');
setSelectionMode('select');

// Set default brush
const defaultBrush = [...state.imageDefaults, ...state.customPalette]
    .find(item => item.char === getDefaultBrushCodeForPack());
if (defaultBrush) {
    state.activeBrush = defaultBrush;
    addToBrushHistory(defaultBrush);
}

// Load and apply theme
loadThemeSettings();
applyThemeSettings();

// Render palette and tips
renderPalette();

ensureSpacePanHandlers();
setTimeout(() => clampPanOffsets(), 100);
setTimeout(() => autoFitZoom(), 100);
```

---

### Task 15: Update `index.html`

**Files:**
- Modify: `index.html`

**Step 1:** Add import map and change script tag:

Replace:
```html
<script src="main.js"></script>
```

With:
```html
<script type="importmap">
{
    "imports": {
        "omggif": "https://unpkg.com/omggif@1.0.10/omggif.js",
        "gif.js": "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js"
    }
}
</script>
<script type="module" src="src/main.js"></script>
```

**Step 2:** Remove ALL inline event handlers from every element. Strip `onclick="..."`, `onchange="..."`, `oninput="..."` attributes. Leave the elements otherwise unchanged. The specific handlers are listed in the table at the top of this document.

Important: some elements need `id` attributes added so modules can find them. Check each button -- most already have ids. The ones that don't (random buttons, clear, undo, redo, upload, rename) need ids added:
- Clear button: add `id="clearBtn"`
- Undo button: add `id="undoBtn"`  
- Redo button: add `id="redoBtn"`
- Upload emoji button: add `id="uploadEmojiBtn"`
- Rename emoji button: add `id="renameEmojiBtn"`
- Random buttons: add `id="randomInfiniteBtn"`, `id="randomFaceBtn"`, `id="randomFlowerBtn"`, `id="randomHouseBtn"`
- Palette hide button: add `id="paletteHideBtn"`
- Output hide button: add `id="outputHideBtn"`
- Copy All button: add `id="copyAllBtn"`
- Theme preset buttons: add `data-preset="defaultDark"` etc.
- Theme close/reset buttons: add ids
- Help close, changelog close, preview close buttons: add ids

---

### Task 16: Handle `openPreviewModal` / `closePreviewModal`

These are referenced in the HTML but appear to be missing from `main.js`. Either they exist but I missed them, or they need to be created. Check and implement in `export.js` if missing.

---

### Task 17: Rename old `main.js`

**Files:**
- Rename: `main.js` -> `main.js.old` (keep as reference during migration, delete after verification)

---

### Task 18: Verify the application works

**Step 1:** Serve the app with a local static server (ES modules require HTTP, not file://):
```bash
npx serve .
```

**Step 2:** Open in browser, verify:
- Palette renders with tile images
- Painting on grid works (brush, bucket, drag)
- Undo/redo works
- Export text appears and Copy All works
- Theme settings open and presets apply
- Size presets change grid
- Import image works
- Save/load .binblock works
- Animation mode, frame navigation, GIF export
- Freeform mode painting
- Random generators
- Panel hide/show
- Zoom and pan

---

### Task 19: Delete `main.js.old`

Once everything is verified working, delete the old file.

---

## Execution notes

- **All state references change**: bare `grid` becomes `state.grid`, `rows` becomes `state.rows`, etc. This is the bulk of the mechanical work.
- **The `window.addEventListener("load", ...)` block** (lines 1846-1913) gets dissolved -- its contents distributed to the relevant `init*()` functions.
- **The document-level `addEventListener("keydown", ...)` block** (lines 2005-2023) moves to `initHistory()`.
- **Top-level side-effect code** (lines 740-741 `loadAssetPackSetting()`, `rebuildImageDefaults()`, line 3096-3109 init calls) moves to `src/main.js`.
- **Module script type="module" is automatically deferred**, so it runs after DOM is ready -- no need for DOMContentLoaded wrapper.
