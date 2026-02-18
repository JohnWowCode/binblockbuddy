import { state, DEFAULT_ROWS, DEFAULT_COLS, LAYOUT_STORAGE_KEY } from './state.js';
import { getBackgroundItem } from './utils.js';
import { pushHistory } from './history.js';
import { handleFreeformPointerDown, handleFreeformPointerMove, handleFreeformPointerUp } from './freeform.js';

// ── Callbacks (set by main to avoid circular imports) ────────────────────────

const callbacks = {
    bucketFill: null,
    updateExport: null,
    updateFreeformLayer: null,
    handleSelectionActionAt: null,
    mergeSelectionRects: null,
};

export function setCanvasCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

// ── Zoom helpers ─────────────────────────────────────────────────────────────

export function updateZoomButtonLabel() {
    const btn = document.getElementById("zoomButton");
    if (btn) {
        btn.textContent = `Fit`;
    }
}

export function cycleZoom() {
    state.viewport?.fitToView();
}

export function autoFitZoom() {
    state.viewport?.fitToView();
}

export function resetView() {
    state.viewport?.fitToView();
}

// ── Rows / cols helpers ──────────────────────────────────────────────────────

export function updateRowsColsInputs() {
    const rowsInput = document.getElementById("rowsInput");
    const colsInput = document.getElementById("colsInput");
    if (rowsInput) rowsInput.value = state.rows;
    if (colsInput) colsInput.value = state.cols;
}

// ── Grid generation and rendering ────────────────────────────────────────────

export function generateGrid() {
    const newRows = parseInt(document.getElementById("rowsInput").value);
    const newCols = parseInt(document.getElementById("colsInput").value);
    if (!Number.isFinite(newRows) || !Number.isFinite(newCols) || newRows < 1 || newCols < 1) {
        return;
    }

    const bg = getBackgroundItem(); // this will resolve to :00: as background

    if (!state.grid || !state.grid.length) {
        state.rows = newRows;
        state.cols = newCols;
        state.grid = Array.from({ length: state.rows }, () => Array(state.cols).fill(bg));
        state.history = [];
        state.future = [];
    } else {
        pushHistory();
        const oldGrid = state.grid;
        const resized = Array.from({ length: newRows }, (_, r) => {
            if (oldGrid[r]) {
                const row = [];
                for (let c = 0; c < newCols; c++) {
                    row.push(oldGrid[r][c] !== undefined ? oldGrid[r][c] : bg);
                }
                return row;
            }
            return Array(newCols).fill(bg);
        });
        state.rows = newRows;
        state.cols = newCols;
        state.grid = resized;
    }

    renderGrid();
    callbacks.updateExport?.();
}

export function clearGrid() {
    pushHistory();
    const bg = getBackgroundItem();
    state.grid = state.grid.map(row => row.map(() => bg));
    renderGrid();
    callbacks.updateExport?.();
    if (state.canvasMode === "freeform") {
        state.freeformStamps = [];
        state.freeformStampId = 0;
        callbacks.updateFreeformLayer?.();
    }
}

export function renderGrid() {
    if (state.viewport) {
        state.viewport.drawGrid().catch(err => console.error('drawGrid failed:', err));
    }
}

// ── Mode presets ─────────────────────────────────────────────────────────────

export function setMode(mode) {
    const rowsInput = document.getElementById("rowsInput");
    const colsInput = document.getElementById("colsInput");

    if (mode === "discord") {
        if (rowsInput) rowsInput.value = DEFAULT_ROWS;
        if (colsInput) colsInput.value = DEFAULT_COLS;
    } else if (mode === "discord-tall") {
        if (rowsInput) rowsInput.value = 16;
        if (colsInput) colsInput.value = 7;
    } else if (mode === "i-mode") {
        if (rowsInput) rowsInput.value = 100;
        if (colsInput) colsInput.value = 100;
    } else if (mode === "g-mode") {
        if (rowsInput) rowsInput.value = 50;
        if (colsInput) colsInput.value = 50;
    } else if (mode === "art-mode") {
        if (rowsInput) rowsInput.value = 32;
        if (colsInput) colsInput.value = 32;
    } else if (mode === "art-small") {
        if (rowsInput) rowsInput.value = 16;
        if (colsInput) colsInput.value = 16;
    } else if (mode === "artv-mode") {
        if (rowsInput) rowsInput.value = 32;
        if (colsInput) colsInput.value = 16;
    } else if (mode === "arth-mode") {
        if (rowsInput) rowsInput.value = 16;
        if (colsInput) colsInput.value = 32;
    }

    generateGrid();

    // Fit viewport after grid change
    state.viewport?.fitToView();
}

// ── Panel visibility ─────────────────────────────────────────────────────────

export function toggleSidePanel(which, hide) {
    const isPalette = which === "palette";
    const panel = document.getElementById(isPalette ? "palette" : "outputArea");
    const bar = document.getElementById(isPalette ? "paletteSidebarBar" : "outputSidebarBar");
    if (!panel || !bar) return;

    const currentlyHidden = panel.style.display === "none";
    const shouldHide = typeof hide === "boolean" ? hide : !currentlyHidden;

    panel.style.display = shouldHide ? "none" : "";
    bar.style.display = shouldHide ? "flex" : "none";

    persistLayoutState();
    // Recenter canvas after panel visibility changes
    setTimeout(() => state.viewport?.fitToView(), 50);
}

function persistLayoutState() {
    const layout = {
        paletteHidden: document.getElementById("palette")?.style.display === "none",
        outputHidden: document.getElementById("outputArea")?.style.display === "none",
    };
    try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch (e) { /* ignore storage errors */ }
}

function restoreLayoutState() {
    try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (!raw) return;
        const layout = JSON.parse(raw);
        if (layout.paletteHidden) toggleSidePanel("palette", true);
        if (layout.outputHidden) toggleSidePanel("output", true);
    } catch (e) { /* ignore storage errors */ }
}

// ── Viewport tool wiring ─────────────────────────────────────────────────────

export function wireViewportCallbacks() {
    const vp = state.viewport;
    if (!vp) return;

    // ── Freeform callbacks ───────────────────────────────────────────────
    vp.onFreeformDown = (e) => {
        if (state.canvasMode !== 'freeform') return;
        const worldPos = vp.screenToWorld(e.global.x, e.global.y);
        handleFreeformPointerDown(worldPos, e.data?.originalEvent || e);
    };

    vp.onFreeformMove = (e) => {
        if (state.canvasMode !== 'freeform') return;
        const worldPos = vp.screenToWorld(e.global.x, e.global.y);
        handleFreeformPointerMove(worldPos, e.data?.originalEvent || e);
    };

    vp.onFreeformUp = (e) => {
        handleFreeformPointerUp();
    };

    // ── Grid callbacks ───────────────────────────────────────────────────
    vp.onCellDown = (r, c, event) => {
        state.isMouseDown = true;

        if (state.currentTool === 'brush') {
            pushHistory();
            applyBrushAt(r, c);
            state.isPainting = true;
        } else if (state.currentTool === 'bucket') {
            pushHistory();
            callbacks.bucketFill?.(r, c);
            renderGrid();
            callbacks.updateExport?.();
        } else if (state.currentTool === 'select') {
            state.selectionStart = { r, c, ctrl: event.ctrlKey || event.metaKey };
            state.isSelectingDrag = true;
        }
    };

    vp.onCellEnter = (r, c) => {
        if (state.isMouseDown && state.isPainting && state.currentTool === 'brush') {
            applyBrushAt(r, c);
        }
        if (state.isSelectingDrag && state.currentTool === 'select') {
            handleSelectionDrag(r, c);
        }
    };

    vp.onPointerUp = (event) => {
        if (
            state.isSelectingDrag &&
            state.selection?.length &&
            ['move', 'copy', 'delete'].includes(state.selectionMode) &&
            state.dragTargetR !== undefined
        ) {
            callbacks.handleSelectionActionAt?.(state.dragTargetR, state.dragTargetC);
        }
        state.isMouseDown = false;
        state.isPainting = false;
        state.isSelectingDrag = false;
        state.selectionStart = null;
        state.moveHistoryPushed = false;
        state.dragTargetR = undefined;
        state.dragTargetC = undefined;
    };
}

function applyBrushAt(r, c) {
    if (!state.activeBrush) return;
    state.grid[r][c] = state.activeBrush;
    state.viewport?.updateCell(r, c);

    if (state.mirrorEnabled) {
        const mirrorC = state.cols - 1 - c;
        state.grid[r][mirrorC] = state.activeBrush;
        state.viewport?.updateCell(r, mirrorC);
    }

    callbacks.updateExport?.();
}

function handleSelectionDrag(r, c) {
    if (state.selection?.length && ['move', 'copy', 'delete'].includes(state.selectionMode)) {
        // Dragging a selection to a new position
        state.dragTargetR = r;
        state.dragTargetC = c;
        // Show preview by manipulating sprites directly
        renderGridWithPreview(r, c);
    } else {
        // Building a selection rectangle
        const top = Math.max(0, Math.min(state.selectionStart.r, r));
        const bottom = Math.min(state.rows - 1, Math.max(state.selectionStart.r, r));
        const left = Math.max(0, Math.min(state.selectionStart.c, c));
        const right = Math.min(state.cols - 1, Math.max(state.selectionStart.c, c));

        const newRect = { top, left, bottom, right };
        if (state.selectionStart.ctrl) {
            state.selection = callbacks.mergeSelectionRects?.(state.selection, newRect) ?? [newRect];
        } else {
            state.selection = [newRect];
        }
        // Redraw selection overlay without full grid rebuild
        state.viewport?.drawSelection();
    }
}

function renderGridWithPreview(previewR, previewC) {
    const vp = state.viewport;
    if (!vp || !state.selection?.length) return;

    // Reset all cell sprites to their actual state (texture + alpha=1)
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            const sprite = vp.cellSprites.get(`${r},${c}`);
            if (sprite) {
                const item = state.grid[r]?.[c];
                sprite.texture = vp.getTextureForItemCached(item);
                sprite.alpha = 1;
            }
        }
    }

    const top = Math.min(...state.selection.map(s => s.top));
    const left = Math.min(...state.selection.map(s => s.left));
    const bottom = Math.max(...state.selection.map(s => s.bottom));
    const right = Math.max(...state.selection.map(s => s.right));
    const h = bottom - top + 1;
    const w = right - left + 1;

    const adjustedR = Math.max(0, Math.min(previewR - Math.floor(h / 2), state.rows - h));
    const adjustedC = Math.max(0, Math.min(previewC - Math.floor(w / 2), state.cols - w));

    // If move mode, show background at original position
    if (state.selectionMode === 'move') {
        for (const rect of state.selection) {
            for (let rr = rect.top; rr <= rect.bottom; rr++) {
                for (let cc = rect.left; cc <= rect.right; cc++) {
                    const sprite = vp.cellSprites.get(`${rr},${cc}`);
                    if (sprite) {
                        sprite.texture = vp.getTextureForItemCached(getBackgroundItem());
                    }
                }
            }
        }
    }

    // Show preview content at destination
    for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
            const destR = adjustedR + i;
            const destC = adjustedC + j;
            const sourceR = top + i;
            const sourceC = left + j;
            const sprite = vp.cellSprites.get(`${destR},${destC}`);
            if (sprite) {
                const item = state.grid[sourceR]?.[sourceC];
                sprite.texture = vp.getTextureForItemCached(item);
                sprite.alpha = 0.7;
            }
        }
    }

    vp.drawSelection();
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initCanvas() {
    // Mode select dropdown
    document.getElementById('modeSelect')?.addEventListener('change', function() {
        setMode(this.value);
    });

    // Clear button
    document.getElementById('clearBtn')?.addEventListener('click', clearGrid);

    // Zoom button — fit to view
    document.getElementById('zoomButton')?.addEventListener('click', () => state.viewport?.fitToView());

    // Fit button — fit to view
    document.getElementById('resetViewBtn')?.addEventListener('click', () => state.viewport?.fitToView());

    // Row/col inputs
    const rowsInput = document.getElementById('rowsInput');
    const colsInput = document.getElementById('colsInput');
    const handleSizeChange = () => generateGrid();
    rowsInput?.addEventListener('change', handleSizeChange);
    rowsInput?.addEventListener('input', handleSizeChange);
    colsInput?.addEventListener('change', handleSizeChange);
    colsInput?.addEventListener('input', handleSizeChange);

    // Panel toggles
    document.getElementById('paletteHideBtn')?.addEventListener('click', () => toggleSidePanel('palette'));
    document.getElementById('outputHideBtn')?.addEventListener('click', () => toggleSidePanel('output'));

    // Sidebar bars (click anywhere on the bar to expand)
    const paletteSidebarBar = document.getElementById('paletteSidebarBar');
    const outputSidebarBar = document.getElementById('outputSidebarBar');
    paletteSidebarBar?.addEventListener('click', () => toggleSidePanel('palette', false));
    outputSidebarBar?.addEventListener('click', () => toggleSidePanel('output', false));

    // Restore saved layout state
    restoreLayoutState();
}
