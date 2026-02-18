// BinBlockBuddy - Entry Point
// ES Module entry point that wires up all modules.

import { state } from './state.js';
import { getDefaultBrushCodeForPack } from './utils.js';

// Module inits
import { initPalette, renderPalette, setPaletteCallbacks, addToBrushHistory } from './palette.js';
import { initCanvas, setCanvasCallbacks, renderGrid, generateGrid, updateRowsColsInputs, wireViewportCallbacks } from './canvas.js';
import { initTools, setToolCallbacks, setTool, setSelectionMode, bucketFill, mergeSelectionRects, handleSelectionActionAt } from './tools.js';
import { initExport, updateExport } from './export.js';
import { initHistory, setHistoryCallbacks } from './history.js';
import { initTheme } from './theme.js';
import { initAnimation, setAnimationCallbacks, updateFrameDisplay } from './animation.js';
import { initFreeform, updateFreeformLayer, updateCanvasModeUI } from './freeform.js';
import { initGenerators, setGeneratorCallbacks } from './generators.js';
import { initSerialization, setSerializationCallbacks } from './serialization.js';
import { initImport, setImportCallbacks } from './import.js';
import { initTopbar } from './topbar.js';
import { initRibbon } from './ribbon.js';
import { Viewport } from './viewport.js';

// ── Wire up cross-module callbacks ──────────────────────────────

setHistoryCallbacks({
    renderGrid,
    updateExport,
    updateFreeformLayer,
    updateCanvasModeUI,
});

setCanvasCallbacks({
    bucketFill,
    updateExport,
    updateFreeformLayer,
    handleSelectionActionAt,
    mergeSelectionRects,
});

setToolCallbacks({
    renderGrid,
    updateExport,
    updateFreeformLayer,
});

setPaletteCallbacks({
    updateExport,
});

setGeneratorCallbacks({
    renderGrid,
    updateExport,
});

setSerializationCallbacks({
    renderPalette,
    renderGrid,
    updateExport,
    updateFreeformLayer,
    updateFrameDisplay,
    updateCanvasModeUI,
    updateRowsColsInputs,
});

setImportCallbacks({
    renderGrid,
    updateExport,
    updateFreeformLayer,
});

setAnimationCallbacks({
    renderGrid,
    updateExport,
    updateFreeformLayer,
});

// ── Initialize all modules (binds event listeners) ──────────────

initTopbar();
initRibbon();
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

// ── Initialize PixiJS viewport ──────────────────────────────────
const container = document.getElementById('pixiContainer');
if (container) {
    const viewport = await Viewport.create(container);
    state.viewport = viewport;
    wireViewportCallbacks();
}

// ── Initial application state ───────────────────────────────────

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
