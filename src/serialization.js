import { state, BINBLOCK_VERSION, TILE_SIZE } from './state.js';
import { readFileAsText, getBackgroundItem } from './utils.js';
import { cloneGrid, cloneFreeformArray } from './history.js';

// Callbacks set by other modules to avoid circular imports
const callbacks = {
    renderPalette: null,
    renderGrid: null,
    updateExport: null,
    updateFreeformLayer: null,
    updateFrameDisplay: null,
    updateCanvasModeUI: null,
    updateRowsColsInputs: null,
};

export function setSerializationCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

export function serializeBrushItem(item) {
    if (!item) return null;
    return {
        type: item.type || null,
        char: item.char || null,
        src: item.src || null,
        color: item.color || null,
        category: item.category || null,
        favorite: !!item.favorite
    };
}

export function deserializeBrushItem(data) {
    if (!data) return null;
    const result = {};
    if (data.type) result.type = data.type;
    if (data.char) result.char = data.char;
    if (data.src) result.src = data.src;
    if (data.color) result.color = data.color;
    if (data.category) result.category = data.category;
    if (data.favorite) result.favorite = true;
    return Object.keys(result).length ? result : null;
}

export function serializeGridStateData(gridData) {
    if (!Array.isArray(gridData)) return [];
    return gridData.map(row => (row || []).map(cell => serializeBrushItem(cell)));
}

export function deserializeGridStateData(gridData) {
    if (!Array.isArray(gridData)) return [];
    return gridData.map(row => (Array.isArray(row) ? row.map(deserializeBrushItem) : []));
}

export function serializeFreeformStamps(stamps) {
    if (!Array.isArray(stamps)) return [];
    return stamps.map(stamp => ({
        id: stamp.id,
        x: stamp.x,
        y: stamp.y,
        item: serializeBrushItem(stamp.item)
    }));
}

export function deserializeFreeformStamps(stamps) {
    if (!Array.isArray(stamps)) return [];
    return stamps.map(stamp => ({
        id: stamp.id ?? 0,
        x: typeof stamp.x === "number" ? stamp.x : 0,
        y: typeof stamp.y === "number" ? stamp.y : 0,
        item: deserializeBrushItem(stamp.item)
    }));
}

export function buildBinblockPayload() {
    return {
        version: BINBLOCK_VERSION,
        savedAt: new Date().toISOString(),
        rows: state.rows,
        cols: state.cols,
        tileSize: TILE_SIZE,
        canvasMode: state.canvasMode,
        animateMode: state.animateMode,
        frameCount: state.frames.length,
        grid: serializeGridStateData(state.grid),
        freeform: serializeFreeformStamps(state.freeformStamps),
        frames: state.frames.map(frame => serializeGridStateData(frame)),
        palette: {
            custom: state.customPalette.map(serializeBrushItem).filter(Boolean),
            activeBrush: serializeBrushItem(state.activeBrush)
        }
    };
}

export function normalizeGridData(data, targetRows, targetCols) {
    const bg = getBackgroundItem();
    const safeRows = Math.max(1, targetRows || 1);
    const safeCols = Math.max(1, targetCols || 1);
    const result = Array.from({ length: safeRows }, (_, r) => {
        const sourceRow = data[r] || [];
        return Array.from({ length: safeCols }, (_, c) => sourceRow[c] ?? null ?? bg);
    });
    return result;
}

export function normalizeFrameData(frameData, targetRows, targetCols) {
    if (!Array.isArray(frameData)) return normalizeGridData([], targetRows, targetCols);
    return normalizeGridData(frameData, targetRows, targetCols);
}

export function saveBinblock() {
    try {
        const payload = buildBinblockPayload();
        const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `binbag-${timestamp}.binblock`;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            URL.revokeObjectURL(link.href);
            link.remove();
        }, 0);
    } catch (err) {
        console.error("Failed to save .binblock", err);
        alert("Could not create .binblock file. Please try again.");
    }
}

export function triggerBinblockLoad() {
    const input = document.getElementById("binblockInput");
    if (input) input.click();
}

export async function handleBinblockFileChange(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
        const text = await readFileAsText(file);
        const payload = JSON.parse(text);
        applyBinblockPayload(payload);
    } catch (err) {
        console.error("Failed to load .binblock", err);
        alert("Could not load .binblock file. Make sure it was exported from BinBag.");
    } finally {
        if (event.target) {
            event.target.value = "";
        }
    }
}

export function applyBinblockPayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Invalid payload");
    }
    if (payload.version && payload.version > BINBLOCK_VERSION) {
        throw new Error("This file was created with a newer version of BinBag.");
    }

    const loadedRows = payload.rows || payload.meta?.rows || (payload.grid?.length ?? state.rows);
    const loadedCols = payload.cols || payload.meta?.cols || (payload.grid?.[0]?.length ?? state.cols);
    state.rows = Math.max(1, loadedRows || state.rows);
    state.cols = Math.max(1, loadedCols || state.cols);
    callbacks.updateRowsColsInputs?.();

    const paletteData = payload.palette || {};
    const loadedCustomPalette = Array.isArray(paletteData.custom)
        ? paletteData.custom.map(deserializeBrushItem).filter(Boolean)
        : [];
    state.customPalette = loadedCustomPalette;
    state.palette = [...state.basePalette, ...state.imageDefaults, ...state.customPalette];
    callbacks.renderPalette?.();

    const gridData = deserializeGridStateData(payload.grid);
    state.grid = normalizeGridData(gridData, state.rows, state.cols);

    state.freeformStamps = deserializeFreeformStamps(payload.freeform);
    state.freeformStampId = state.freeformStamps.reduce((max, stamp) => Math.max(max, stamp.id || 0), 0);

    if (Array.isArray(payload.frames) && payload.frames.length) {
        state.frames = payload.frames.map(frame => normalizeFrameData(deserializeGridStateData(frame), state.rows, state.cols));
    } else {
        state.frames = state.grid.length ? [cloneGrid(state.grid)] : [];
    }
    state.currentFrame = 0;

    const active = deserializeBrushItem(paletteData.activeBrush);
    if (active) {
        state.activeBrush = active;
    }

    if (typeof payload.canvasMode === "string") {
        state.canvasMode = payload.canvasMode === "freeform" ? "freeform" : "grid";
        callbacks.updateCanvasModeUI?.();
    } else {
        callbacks.renderGrid?.();
        callbacks.updateFreeformLayer?.();
    }

    if (typeof payload.animateMode === "boolean") {
        state.animateMode = payload.animateMode;
        const btn = document.getElementById("animateToggle");
        const frameGroup = document.getElementById("ribbonFrameGroup");
        const saveGifBtn = document.getElementById("saveGifBtn");
        if (btn) {
            btn.textContent = state.animateMode ? "Animate: On" : "Animate: Off";
            btn.classList.toggle("tool-active", state.animateMode);
        }
        if (frameGroup) {
            frameGroup.style.display = state.animateMode ? "flex" : "none";
        }
        if (saveGifBtn) {
            saveGifBtn.style.display = state.animateMode ? "" : "none";
        }
    }

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
    callbacks.updateFreeformLayer?.();
    callbacks.updateFrameDisplay?.();
    alert("Loaded .binblock project successfully!");
}

export function initSerialization() {
    document.getElementById('saveBinblockBtn')?.addEventListener('click', saveBinblock);
    document.getElementById('loadBinblockBtn')?.addEventListener('click', triggerBinblockLoad);
    document.getElementById('binblockInput')?.addEventListener('change', handleBinblockFileChange);
}
