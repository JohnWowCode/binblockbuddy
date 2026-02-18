import { state, TILE_SIZE, zoomLevels, DEFAULT_ROWS, DEFAULT_COLS } from './state.js';
import { getBackgroundItem } from './utils.js';
import { pushHistory } from './history.js';

// ── Callbacks (set by main to avoid circular imports) ────────────────────────

const callbacks = {
    bucketFill: null,
    updateExport: null,
    updateFreeformLayer: null,
    handleSelectionActionAt: null,
    mergeSelectionRects: null,
    renderGridWithPreview: null,
};

export function setCanvasCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

// ── Pan mode helpers ─────────────────────────────────────────────────────────

export function isPanModeActive() {
    return state.isSpacePanHeld || (state.currentTool === "select" && state.selectionMode === "drag");
}

export function refreshPanCursorState() {
    const body = document.body;
    if (!body) return;
    body.classList.toggle("space-pan-mode", isPanModeActive());
}

// ── Canvas transform / zoom / pan ────────────────────────────────────────────

export function updateCanvasTransform() {
    const surface = document.getElementById("canvasSurface");
    const stack = document.getElementById("canvasStack");
    if (surface && stack) {
        // Surface is positioned at left: 50%, so we translate it back by -50% plus pan offsets
        // Pan is applied at screen level, zoom is applied to the stack
        surface.style.transform = `translateX(calc(-50% + ${state.canvasPanX}px)) translateY(${state.canvasPanY}px)`;
        stack.style.transformOrigin = "center center";
        stack.style.transform = `scale(${state.currentZoomFactor})`;
    }
}

export function clampPanOffsets() {
    const viewport = document.getElementById("canvasViewport");
    const stack = document.getElementById("canvasStack");
    if (!viewport || !stack) {
        updateCanvasTransform();
        return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const viewportWidth = viewportRect.width || viewport.clientWidth || 1;
    const viewportHeight = viewportRect.height || viewport.clientHeight || 1;
    const scaledWidth = stack.offsetWidth * state.currentZoomFactor;
    const scaledHeight = stack.offsetHeight * state.currentZoomFactor;

    if (!scaledWidth || !scaledHeight) {
        updateCanvasTransform();
        return;
    }

    // Horizontal: keep canvas roughly centered but allow movement.
    if (scaledWidth <= viewportWidth) {
        state.canvasPanX = 0;
    } else {
        const limitX = (scaledWidth - viewportWidth) / 2;
        state.canvasPanX = Math.max(-limitX, Math.min(limitX, state.canvasPanX));
    }

    // Vertical: when zoomed out (<1x), don't clamp Y so you can freely pan
    // to the bottom even if it means the canvas can move off-screen a bit.
    // For 1x and above, keep a safe range so the canvas never fully vanishes.
    if (state.currentZoomFactor >= 1) {
        // Canvas top is at panY, bottom is at panY + scaledHeight.
        // We want:
        //   - top can be at 0  (see top rows under the header)
        //   - bottom can be at viewportHeight (see very last rows)
        if (scaledHeight <= viewportHeight) {
            state.canvasPanY = 0;
        } else {
            const minPanY = viewportHeight - scaledHeight; // bottom exactly at viewport bottom
            const maxPanY = 0;                             // top exactly under header
            state.canvasPanY = Math.max(minPanY, Math.min(maxPanY, state.canvasPanY));
        }
    }

    updateCanvasTransform();
}

export function applyZoom(options = {}) {
    const viewport = document.getElementById("canvasViewport");
    const stack = document.getElementById("canvasStack");
    if (!viewport || !stack) return;

    const factor = zoomLevels[state.zoomIndex] || 1;
    state.currentZoomFactor = factor;

    // Reset pan when zooming – start with top aligned to viewport
    if (!options.skipCenter) {
        state.canvasPanX = 0;
        state.canvasPanY = 0;
    }

    updateCanvasTransform();
    clampPanOffsets();
}

export function updateZoomButtonLabel() {
    const btn = document.getElementById("zoomButton");
    if (btn) {
        const factor = zoomLevels[state.zoomIndex] || 1;
        btn.textContent = `Zoom ${factor.toFixed(2).replace(/\.00$/, "")}x`;
    }
}

export function cycleZoom() {
    state.zoomIndex = (state.zoomIndex + 1) % zoomLevels.length;
    updateZoomButtonLabel();
    applyZoom();
}

export function autoFitZoom() {
    // For this app, "Fit" should behave like "back to default 1x"
    const oneIndex = zoomLevels.indexOf(1);
    state.zoomIndex = oneIndex >= 0 ? oneIndex : 0;
    updateZoomButtonLabel();
    applyZoom();
}

export function resetView() {
    // Reset pan to center
    state.canvasPanX = 0;
    state.canvasPanY = 0;
    // Auto-fit zoom based on canvas size
    autoFitZoom();
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

    // Ensure canvas transform is updated after grid size change
    clampPanOffsets();
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
    const canvas = document.getElementById("canvas");
    canvas.style.gridTemplateColumns = `repeat(${state.cols}, 40px)`;
    canvas.innerHTML = "";

    // Use a fragment so we don't thrash the DOM with 10,000+ appends in I-Mode
    const frag = document.createDocumentFragment();

    canvas.onmousedown = () => {
        state.isMouseDown = true;
    };

    if (!state.mouseListenersAttached) {
        document.addEventListener("mouseup", () => {
            state.isMouseDown = false;
            state.isPainting = false;

            // Apply move/copy/delete action when mouse is released
            if (
                state.isSelectingDrag &&
                state.selection &&
                state.selection.length &&
                ["move", "copy", "delete"].includes(state.selectionMode) &&
                state.dragTargetR !== undefined &&
                state.dragTargetC !== undefined
            ) {
                callbacks.handleSelectionActionAt?.(state.dragTargetR, state.dragTargetC);
            }

            state.isSelectingDrag = false;
            state.selectionStart = null;
            state.moveHistoryPushed = false; // Reset history flag for next drag
            state.dragTargetR = undefined;
            state.dragTargetC = undefined;
        });
        document.addEventListener("mousemove", (evt) => {
            if (!state.isSelectingDrag || state.currentTool !== "select" || !state.selectionStart) return;
            const canvasRect = canvas.getBoundingClientRect();
            const x = evt.clientX - canvasRect.left;
            const y = evt.clientY - canvasRect.top;
            const c = Math.floor(x / 42); // approx cell width incl gap
            const r = Math.floor(y / 42);

            // If we have a selection and are in move/copy/delete mode, show preview while dragging
            if (state.selection && state.selection.length && ["move", "copy", "delete"].includes(state.selectionMode)) {
                state.dragTargetR = r;
                state.dragTargetC = c;
                // Show preview without modifying actual grid
                callbacks.renderGridWithPreview?.(r, c);
            } else {
                // Build selection rectangle
                const top = Math.max(0, Math.min(state.selectionStart.r, r));
                const bottom = Math.min(state.rows - 1, Math.max(state.selectionStart.r, r));
                const left = Math.max(0, Math.min(state.selectionStart.c, c));
                const right = Math.min(state.cols - 1, Math.max(state.selectionStart.c, c));

                const newRect = { top, left, bottom, right };
                if (state.selectionStart.ctrl) {
                    // additive selection
                    state.selection = callbacks.mergeSelectionRects?.(state.selection, newRect) ?? [newRect];
                } else {
                    state.selection = [newRect];
                }
                renderGrid();
            }
        });
        state.mouseListenersAttached = true;
    }

    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            const cell = document.createElement("div");
            cell.className = "canvas-cell";

            const val = state.grid[r][c];
            if (val) {
                if (val.type === "unicode") {
                    cell.textContent = val.char;
                    cell.style.backgroundImage = "";
                } else {
                    cell.textContent = "";
                    cell.style.backgroundImage = `url(${val.src})`;
                    cell.style.backgroundSize = "cover";
                }
            }

            // highlight any selected rects that include this cell
            if (state.selection && state.selection.length) {
                for (const rect of state.selection) {
                    if (r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right) {
                        cell.classList.add("selected");
                        break;
                    }
                }
            }

            const paintCell = (fromDrag = false) => {
                if (!state.activeBrush) return;
                // Only push a new history state on the initial click, not on every drag cell
                if (!fromDrag) {
                    pushHistory();
                }

                const canvasEl = document.getElementById("canvas");

                const applyBrushAt = (rr, cc) => {
                    if (rr < 0 || rr >= state.rows || cc < 0 || cc >= state.cols) return;
                    state.grid[rr][cc] = state.activeBrush;
                    if (!canvasEl) return;
                    const idx = rr * state.cols + cc;
                    const cellEl = canvasEl.children[idx];
                    if (!cellEl) return;
                    if (state.activeBrush.type === "unicode") {
                        cellEl.textContent = state.activeBrush.char;
                        cellEl.style.backgroundImage = "";
                    } else {
                        cellEl.textContent = "";
                        cellEl.style.backgroundImage = `url(${state.activeBrush.src})`;
                        cellEl.style.backgroundSize = "cover";
                    }
                };

                // main cell
                applyBrushAt(r, c);

                // mirrored cell horizontally if enabled
                if (state.mirrorEnabled) {
                    const mirrorC = state.cols - 1 - c;
                    applyBrushAt(r, mirrorC);
                }

                callbacks.updateExport?.();
            };

            cell.onmousedown = (e) => {
                e.preventDefault();
                if (state.currentTool === "brush") {
                    paintCell(false);
                    state.isPainting = true;
                } else if (state.currentTool === "bucket") {
                    pushHistory();
                    callbacks.bucketFill?.(r, c);
                    renderGrid();
                    callbacks.updateExport?.();
                } else if (state.currentTool === "select") {
                    if (!state.selectionStart) {
                        // start a drag selection
                        state.selectionStart = { r, c, ctrl: e.ctrlKey || e.metaKey };
                        state.isSelectingDrag = true;
                    }
                }
            };

            cell.onmouseenter = () => {
                if (state.isMouseDown && state.isPainting && state.currentTool === "brush") {
                    paintCell(true);
                }
            };

            frag.appendChild(cell);
        }
    }
    canvas.appendChild(frag);

    // Update canvas transform after grid is rendered to ensure proper sizing
    setTimeout(() => updateCanvasTransform(), 10);
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

    // Reset pan and default zoom (1x) for all presets
    state.canvasPanX = 0;
    state.canvasPanY = 0;
    const oneIndex = zoomLevels.indexOf(1);
    state.zoomIndex = oneIndex >= 0 ? oneIndex : 0;
    updateZoomButtonLabel();
    // Use setTimeout to ensure DOM has updated with new grid size
    setTimeout(() => {
        applyZoom();
    }, 50);
}

// ── Space-pan handlers ───────────────────────────────────────────────────────

function shouldIgnoreSpacePanKey(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function handleSpacePanKeyDown(event) {
    if (event.code !== "Space" || event.repeat) return;
    if (shouldIgnoreSpacePanKey(event.target)) return;
    event.preventDefault();
    state.isSpacePanHeld = true;
    document.body?.classList.add("space-pan-mode");
    attachSpacePanViewportHandlers();
}

function handleSpacePanKeyUp(event) {
    if (event.code !== "Space") return;
    event.preventDefault();
    state.isSpacePanHeld = false;
    document.body?.classList.remove("space-pan-mode");
    stopSpacePanDragging();
}

function handleSpacePanPointerDown(event) {
    if (!isPanModeActive()) return;
    const viewport = state.spacePanViewport || event.currentTarget;
    if (!viewport) return;
    event.preventDefault();
    state.isSpacePanDragging = true;
    state.spacePanPointerId = event.pointerId;
    state.spacePanStart = {
        x: event.clientX,
        y: event.clientY,
        panX: state.canvasPanX,
        panY: state.canvasPanY
    };
    state.spacePanViewport = viewport;
    viewport.classList.add("space-pan-grabbing");
    viewport.setPointerCapture?.(event.pointerId);
}

function handleSpacePanPointerMove(event) {
    if (!state.isSpacePanDragging || event.pointerId !== state.spacePanPointerId) return;
    const viewport = state.spacePanViewport;
    if (!viewport || !state.spacePanStart) return;
    event.preventDefault();
    const dx = event.clientX - state.spacePanStart.x;
    const dy = event.clientY - state.spacePanStart.y;
    // Update pan offsets - dragging right moves canvas right (positive X)
    state.canvasPanX = state.spacePanStart.panX + dx;
    state.canvasPanY = state.spacePanStart.panY + dy;
    clampPanOffsets();
}

function handleSpacePanPointerUp(event) {
    if (!state.isSpacePanDragging || event.pointerId !== state.spacePanPointerId) return;
    stopSpacePanDragging();
}

function stopSpacePanDragging() {
    const viewport = state.spacePanViewport;
    if (viewport) {
        viewport.classList.remove("space-pan-grabbing");
        if (state.spacePanPointerId !== null && viewport.releasePointerCapture) {
            try {
                viewport.releasePointerCapture(state.spacePanPointerId);
            } catch (err) {
                // ignore release errors
            }
        }
    }
    state.isSpacePanDragging = false;
    state.spacePanPointerId = null;
    state.spacePanStart = null;
}

function resetSpacePanState() {
    if (state.isSpacePanHeld || state.isSpacePanDragging) {
        state.isSpacePanHeld = false;
        document.body?.classList.remove("space-pan-mode");
        stopSpacePanDragging();
    }
}

function handleCanvasWheel(event) {
    event.preventDefault();

    // Ctrl+wheel = zoom
    if (event.ctrlKey) {
        if (event.deltaY > 0) {
            // Scroll down = zoom out
            if (state.zoomIndex < zoomLevels.length - 1) {
                state.zoomIndex++;
                updateZoomButtonLabel();
                applyZoom({ skipCenter: true });
            }
        } else if (event.deltaY < 0) {
            // Scroll up = zoom in
            if (state.zoomIndex > 0) {
                state.zoomIndex--;
                updateZoomButtonLabel();
                applyZoom({ skipCenter: true });
            }
        }
        return;
    }

    // Shift+wheel = horizontal pan
    if (event.shiftKey) {
        state.canvasPanX -= event.deltaY * 0.8;
        clampPanOffsets();
        return;
    }

    // Regular wheel = vertical pan
    if (event.deltaY !== 0) {
        state.canvasPanY -= event.deltaY * 0.8;
        clampPanOffsets();
    }
}

function attachSpacePanViewportHandlers() {
    const viewport = document.getElementById("canvasViewport");
    if (!viewport || viewport.dataset.spacePanAttached === "true") return;
    viewport.addEventListener("pointerdown", handleSpacePanPointerDown);
    viewport.addEventListener("pointermove", handleSpacePanPointerMove);
    viewport.addEventListener("pointerup", handleSpacePanPointerUp);
    viewport.addEventListener("pointerleave", handleSpacePanPointerUp);
    viewport.addEventListener("wheel", handleCanvasWheel, { passive: false });
    viewport.dataset.spacePanAttached = "true";
    state.spacePanViewport = viewport;
}

export function ensureSpacePanHandlers() {
    if (state.spacePanHandlersAttached) return;
    window.addEventListener("keydown", handleSpacePanKeyDown, true);
    window.addEventListener("keyup", handleSpacePanKeyUp, true);
    window.addEventListener("blur", resetSpacePanState, true);
    attachSpacePanViewportHandlers();
    state.spacePanHandlersAttached = true;
}

// ── Panel visibility ─────────────────────────────────────────────────────────

export function toggleSidePanel(which, hide) {
    const isPalette = which === "palette";
    const panel = isPalette ? document.getElementById("palette") : document.getElementById("outputArea");
    const tag = isPalette ? document.getElementById("paletteTag") : document.getElementById("exportTag");
    if (!panel || !tag) return;

    const currentlyHidden = panel.classList.contains("panel-hidden");
    let shouldHide = hide;
    if (typeof shouldHide !== "boolean") {
        shouldHide = !currentlyHidden;
    }

    if (shouldHide) {
        panel.classList.add("panel-hidden");
        tag.style.display = "block";
    } else {
        panel.classList.remove("panel-hidden");
        tag.style.display = "none";
    }

    updatePanelVisibilityState();
}

function updatePanelVisibilityState() {
    const paletteHidden = document.getElementById("palette")?.classList.contains("panel-hidden");
    const outputHidden = document.getElementById("outputArea")?.classList.contains("panel-hidden");
    const body = document.body;
    if (!body) return;
    const lockCanvas = paletteHidden && outputHidden;
    body.classList.toggle("palette-hidden", !!paletteHidden);
    body.classList.toggle("output-hidden", !!outputHidden);
    body.classList.toggle("panels-hidden", !!lockCanvas);
    // Recenter canvas after panel visibility changes
    setTimeout(() => clampPanOffsets(), 50);
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initCanvas() {
    // Mode select dropdown
    document.getElementById('modeSelect')?.addEventListener('change', function() {
        setMode(this.value);
    });

    // Clear button
    document.getElementById('clearBtn')?.addEventListener('click', clearGrid);

    // Zoom button
    document.getElementById('zoomButton')?.addEventListener('click', cycleZoom);

    // Fit button
    document.getElementById('resetViewBtn')?.addEventListener('click', resetView);

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
    document.getElementById('paletteTag')?.addEventListener('click', () => toggleSidePanel('palette', false));
    document.getElementById('exportTag')?.addEventListener('click', () => toggleSidePanel('output', false));

    // Initially hide edge tags
    const paletteTag = document.getElementById('paletteTag');
    const exportTag = document.getElementById('exportTag');
    if (paletteTag) paletteTag.style.display = 'none';
    if (exportTag) exportTag.style.display = 'none';

    // Space pan handlers
    ensureSpacePanHandlers();
}
