import { state, TILE_SIZE } from './state.js';
import { getBackgroundItem, itemsEqual } from './utils.js';
import { pushHistory } from './history.js';
import { refreshPanCursorState } from './canvas.js';

// ── Callbacks (set by main to avoid circular imports) ────────────────────────

const callbacks = {
    renderGrid: null,
    updateExport: null,
    updateFreeformLayer: null,
    applyZoom: null,
};

export function setToolCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

// ── Mirror toggle ────────────────────────────────────────────────────────────

export function toggleMirror() {
    state.mirrorEnabled = !state.mirrorEnabled;
    const btn = document.querySelector("#toolControls button:nth-child(4)");
    if (btn) {
        btn.textContent = state.mirrorEnabled ? "Mirror ON" : "Mirror";
    }
}

// ── Tool switching ───────────────────────────────────────────────────────────

export function setTool(tool) {
    state.currentTool = tool;
    const toolBar = document.getElementById("toolControls");
    if (toolBar) {
        Array.from(toolBar.children).forEach(btn => btn.classList.remove("tool-active"));
        if (tool === "brush") toolBar.children[0]?.classList.add("tool-active");
        else if (tool === "bucket") toolBar.children[1]?.classList.add("tool-active");
        else if (tool === "select") toolBar.children[2]?.classList.add("tool-active");
        else if (tool === "mirror") toolBar.children[3]?.classList.add("tool-active");
    }
    const selControls = document.getElementById("selectControls");
    if (selControls) {
        selControls.style.display = (tool === "select") ? "flex" : "none";
    }

    // When Select tool is clicked, default to "select" sub-mode unless user is in drag mode
    if (tool === "select") {
        if (state.selectionMode !== "drag") {
            setSelectionMode("select");
        } else {
            refreshPanCursorState();
        }
    }

    // When leaving Select tool, clear any active selection so it only works in Select mode
    if (tool !== "select") {
        if (state.selectionMode === "drag") {
            setSelectionMode("select");
        }
        if (state.selection && state.selection.length) {
            state.selection = [];
            callbacks.renderGrid?.();
        }
    }
}

// ── Bucket fill ──────────────────────────────────────────────────────────────

export function bucketFill(startR, startC) {
    if (!state.activeBrush) return;
    const target = state.grid[startR]?.[startC];
    if (itemsEqual(target, state.activeBrush)) return;

    const replacement = state.activeBrush;
    const stack = [[startR, startC]];
    while (stack.length) {
        const [r, c] = stack.pop();
        if (r < 0 || r >= state.rows || c < 0 || c >= state.cols) continue;
        if (!itemsEqual(state.grid[r][c], target)) continue;
        state.grid[r][c] = replacement;
        stack.push([r + 1, c]);
        stack.push([r - 1, c]);
        stack.push([r, c + 1]);
        stack.push([r, c - 1]);
    }
}

// ── Selection helpers ────────────────────────────────────────────────────────

export function createSelection(r1, c1, r2, c2) {
    const top = Math.min(r1, r2);
    const left = Math.min(c1, c2);
    const bottom = Math.max(r1, r2);
    const right = Math.max(c1, c2);

    const data = [];
    for (let r = top; r <= bottom; r++) {
        const row = [];
        for (let c = left; c <= right; c++) {
            row.push(state.grid[r][c]);
        }
        data.push(row);
    }

    state.selection = { top, left, bottom, right, data };
}

export function moveSelectionTo(destR, destC) {
    if (!state.selection) return;
    const height = state.selection.bottom - state.selection.top + 1;
    const width = state.selection.right - state.selection.left + 1;

    if (destR + height > state.rows || destC + width > state.cols) return;

    pushHistory();
    const bg = getBackgroundItem();

    // clear old area
    for (let r = state.selection.top; r <= state.selection.bottom; r++) {
        for (let c = state.selection.left; c <= state.selection.right; c++) {
            state.grid[r][c] = bg;
        }
    }

    // write to new area
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            state.grid[destR + i][destC + j] = state.selection.data[i][j];
        }
    }

    state.selection.top = destR;
    state.selection.left = destC;
    state.selection.bottom = destR + height - 1;
    state.selection.right = destC + width - 1;

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function setSelectionMode(mode) {
    state.selectionMode = mode;

    const selectBtn = document.getElementById("selectBtn");
    const moveBtn = document.getElementById("moveBtn");
    const copyBtn = document.getElementById("copyBtn");
    const deleteBtn = document.getElementById("deleteBtn");
    const dragBtn = document.getElementById("dragBtn");
    [dragBtn, selectBtn, moveBtn, copyBtn, deleteBtn].forEach(btn => btn && btn.classList.remove("tool-active"));

    if (mode === "drag" && dragBtn) dragBtn.classList.add("tool-active");
    if (mode === "select" && selectBtn) selectBtn.classList.add("tool-active");
    if (mode === "move" && moveBtn) moveBtn.classList.add("tool-active");
    if (mode === "copy" && copyBtn) copyBtn.classList.add("tool-active");
    if (mode === "delete" && deleteBtn) deleteBtn.classList.add("tool-active");

    refreshPanCursorState();

    const canvasEl = document.getElementById("canvas");
    if (canvasEl) {
        canvasEl.dataset.selectionMode = mode;
    }

    // Delete instantly when delete mode is selected and there's a selection
    if (mode === "delete" && state.selection && state.selection.length) {
        pushHistory();
        const bg = getBackgroundItem();
        for (const rect of state.selection) {
            for (let rr = rect.top; rr <= rect.bottom; rr++) {
                for (let cc = rect.left; cc <= rect.right; cc++) {
                    state.grid[rr][cc] = bg;
                }
            }
        }
        state.selection = [];
        callbacks.renderGrid?.();
        callbacks.updateExport?.();
        // Reset to select mode after delete
        setSelectionMode("select");
    }
}

export function mergeSelectionRects(existing, rect) {
    if (!existing || !existing.length) return [rect];
    return [...existing, rect];
}

// ── Selection preview rendering ──────────────────────────────────────────────

export function renderGridWithPreview(previewR, previewC) {
    const canvas = document.getElementById("canvas");
    canvas.innerHTML = "";

    const top = Math.min(...state.selection.map(r => r.top));
    const left = Math.min(...state.selection.map(r => r.left));
    const bottom = Math.max(...state.selection.map(r => r.bottom));
    const right = Math.max(...state.selection.map(r => r.right));
    const h = bottom - top + 1;
    const w = right - left + 1;

    // Adjust position to center on cursor
    const adjustedR = Math.max(0, Math.min(previewR - Math.floor(h / 2), state.rows - h));
    const adjustedC = Math.max(0, Math.min(previewC - Math.floor(w / 2), state.cols - w));

    // Build cells into a fragment to minimize layout thrash, then append once
    const frag = document.createDocumentFragment();

    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            const cell = document.createElement("div");
            cell.className = "canvas-cell";

            // Check if this cell is in the original selection
            let inOriginalSelection = false;
            for (const rect of state.selection) {
                if (r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right) {
                    inOriginalSelection = true;
                    break;
                }
            }

            // Check if this cell is in the preview area
            const inPreviewArea = r >= adjustedR && r < adjustedR + h && c >= adjustedC && c < adjustedC + w;

            if (inPreviewArea && !inOriginalSelection) {
                // Show preview content
                const sourceR = top + (r - adjustedR);
                const sourceC = left + (c - adjustedC);
                const val = state.grid[sourceR][sourceC];
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
                cell.style.opacity = "0.7"; // Make preview semi-transparent
            } else if (inOriginalSelection && state.selectionMode === "move") {
                // Show original area as background when moving
                const bg = getBackgroundItem();
                if (bg) {
                    if (bg.type === "unicode") {
                        cell.textContent = bg.char;
                        cell.style.backgroundImage = "";
                    } else {
                        cell.textContent = "";
                        cell.style.backgroundImage = `url(${bg.src})`;
                        cell.style.backgroundSize = "cover";
                    }
                }
            } else {
                // Show actual grid content
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
            }

            // Highlight original selection
            if (inOriginalSelection) {
                cell.classList.add("selected");
            }

            canvas.appendChild(cell);
        }
    }

    // re-apply zoom transform so large grids stay centered in the canvas area
    callbacks.applyZoom?.({ skipCenter: true });
}

// ── Selection action handler ─────────────────────────────────────────────────

export function handleSelectionActionAt(targetR, targetC) {
    if (!state.selection || !state.selection.length) return;

    const top = Math.min(...state.selection.map(r => r.top));
    const left = Math.min(...state.selection.map(r => r.left));
    const bottom = Math.max(...state.selection.map(r => r.bottom));
    const right = Math.max(...state.selection.map(r => r.right));
    const h = bottom - top + 1;
    const w = right - left + 1;

    if (state.selectionMode === "delete") {
        // Delete instantly: clear selected areas to background
        pushHistory();
        const bg = getBackgroundItem();
        for (const rect of state.selection) {
            for (let rr = rect.top; rr <= rect.bottom; rr++) {
                for (let cc = rect.left; cc <= rect.right; cc++) {
                    state.grid[rr][cc] = bg;
                }
            }
        }
        state.selection = [];
        callbacks.renderGrid?.();
        callbacks.updateExport?.();
    } else if (state.selectionMode === "move") {
        // Move: drag selected area to new position, leaving background behind
        if (!state.moveHistoryPushed) {
            pushHistory();
            state.moveHistoryPushed = true;
        }
        const bg = getBackgroundItem();

        // Copy data from old location
        const data = [];
        for (let i = 0; i < h; i++) {
            const row = [];
            for (let j = 0; j < w; j++) {
                row.push(state.grid[top + i][left + j]);
            }
            data.push(row);
        }

        // Clear old location
        for (let rr = top; rr <= bottom; rr++) {
            for (let cc = left; cc <= right; cc++) {
                state.grid[rr][cc] = bg;
            }
        }

        // Paste at new location (adjust position to center on cursor)
        const adjustedR = Math.max(0, Math.min(targetR - Math.floor(h / 2), state.rows - h));
        const adjustedC = Math.max(0, Math.min(targetC - Math.floor(w / 2), state.cols - w));

        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) {
                state.grid[adjustedR + i][adjustedC + j] = data[i][j];
            }
        }

        // Update selection to new position
        state.selection = [{
            top: adjustedR,
            left: adjustedC,
            bottom: adjustedR + h - 1,
            right: adjustedC + w - 1
        }];

        callbacks.renderGrid?.();
        callbacks.updateExport?.();
    } else if (state.selectionMode === "copy") {
        // Duplicate: copy selected area to new position
        if (!state.moveHistoryPushed) {
            pushHistory();
            state.moveHistoryPushed = true;
        }

        // Copy data from old location
        const data = [];
        for (let i = 0; i < h; i++) {
            const row = [];
            for (let j = 0; j < w; j++) {
                row.push(state.grid[top + i][left + j]);
            }
            data.push(row);
        }

        // Paste at new location (adjust position to center on cursor)
        const adjustedR = Math.max(0, Math.min(targetR - Math.floor(h / 2), state.rows - h));
        const adjustedC = Math.max(0, Math.min(targetC - Math.floor(w / 2), state.cols - w));

        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) {
                state.grid[adjustedR + i][adjustedC + j] = data[i][j];
            }
        }

        callbacks.renderGrid?.();
        callbacks.updateExport?.();
    }

    callbacks.updateFreeformLayer?.();
}

// ── Initialization ───────────────────────────────────────────────────────────

export function initTools() {
    // Tool buttons in #toolControls
    const toolControls = document.getElementById('toolControls');
    if (toolControls) {
        // Brush button (first child)
        toolControls.children[0]?.addEventListener('click', () => setTool('brush'));
        // Bucket button (second child)
        toolControls.children[1]?.addEventListener('click', () => setTool('bucket'));
        // Select button (third child)
        toolControls.children[2]?.addEventListener('click', () => setTool('select'));
        // Mirror button (fourth child)
        toolControls.children[3]?.addEventListener('click', toggleMirror);
    }

    // Selection sub-mode buttons
    document.getElementById('dragBtn')?.addEventListener('click', () => setSelectionMode('drag'));
    document.getElementById('selectBtn')?.addEventListener('click', () => setSelectionMode('select'));
    document.getElementById('moveBtn')?.addEventListener('click', () => setSelectionMode('move'));
    document.getElementById('copyBtn')?.addEventListener('click', () => setSelectionMode('copy'));
    document.getElementById('deleteBtn')?.addEventListener('click', () => setSelectionMode('delete'));
}
