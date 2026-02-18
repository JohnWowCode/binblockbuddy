// BinBlockBuddy - Entry Point
// ES Module entry point that wires up all modules.

import { state } from './state.js';
import { getDefaultBrushCodeForPack } from './utils.js';

// Module inits
import { initPalette, renderPalette, setPaletteCallbacks, addToBrushHistory } from './palette.js';
import { initCanvas, setCanvasCallbacks, renderGrid, generateGrid, ensureSpacePanHandlers, clampPanOffsets, autoFitZoom, updateRowsColsInputs, applyZoom } from './canvas.js';
import { initTools, setToolCallbacks, setTool, setSelectionMode, bucketFill, mergeSelectionRects, renderGridWithPreview, handleSelectionActionAt } from './tools.js';
import { initExport, updateExport } from './export.js';
import { initHistory, setHistoryCallbacks } from './history.js';
import { initTheme } from './theme.js';
import { initAnimation, setAnimationCallbacks, updateFrameDisplay } from './animation.js';
import { initFreeform, updateFreeformLayer, updateCanvasModeUI } from './freeform.js';
import { initGenerators, setGeneratorCallbacks } from './generators.js';
import { initSerialization, setSerializationCallbacks } from './serialization.js';
import { initImport, setImportCallbacks } from './import.js';

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
    renderGridWithPreview,
});

setToolCallbacks({
    renderGrid,
    updateExport,
    updateFreeformLayer,
    applyZoom,
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

// Initial canvas setup
ensureSpacePanHandlers();
setTimeout(() => clampPanOffsets(), 100);
setTimeout(() => autoFitZoom(), 150);
