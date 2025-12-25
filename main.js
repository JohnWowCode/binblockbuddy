// Store palette items (image emojis only)
// basePalette exists for future extension but starts empty; palette is built
// from numbered assets (imageDefaults) plus user uploads (customPalette).
const basePalette = [];
const TILE_SIZE = 40;
const BINBLOCK_VERSION = 1;
const FREEFORM_DISTANCE_THRESHOLD = TILE_SIZE / 2;

// zoom levels for canvas (added more levels for very large canvases)
let canvasMode = "grid";
const zoomLevels = [1, 0.75, 0.5, 0.35, 0.25, 0.15, 0.1, 0.05];
let zoomIndex = 0;
let currentZoomFactor = 1;

// freeform layer
let freeformStamps = [];
let freeformStampId = 0;
let isFreeformPainting = false;
let lastFreeformPoint = null;
let freeformLayerListenersAttached = false;
let freeformHistoryPushed = false;
const brushSizeRadii = [0, 0.5, 1, 1.5, 2.2];
let currentBrushSizeIndex = 2;
const brushOffsetsCache = new Map();
let freeformSelectionIds = new Set();
let isFreeformSelecting = false;
let freeformSelectionStart = null;
let isFreeformDraggingSelection = false;
let freeformDragStartPoint = null;
let freeformSelectionSnapshot = null;
let freeformSelectionRect = null;
let canvasPanX = 0;
let canvasPanY = 0;
let spacePanHandlersAttached = false;
let isSpacePanHeld = false;
let isSpacePanDragging = false;
let spacePanStart = null;
let spacePanPointerId = null;
let spacePanViewport = null;

function getCanvasDimensions() {
    return {
        width: cols * TILE_SIZE,
        height: rows * TILE_SIZE
    };
}

function shouldUseCrossOrigin(src) {
    if (!src) return false;
    if (src.startsWith("data:") || src.startsWith("blob:")) return false;
    return /^https?:\/\//i.test(src);
}

function applyCrossOriginIfNeeded(img, src) {
    if (shouldUseCrossOrigin(src)) {
        img.crossOrigin = "anonymous";
        img.referrerPolicy = "no-referrer";
    }
}

function waitForAnimationFrame() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(resolve);
        } else {
            setTimeout(resolve, 16);
        }
    });
}

function isPanModeActive() {
    return isSpacePanHeld || (currentTool === "select" && selectionMode === "drag");
}

function refreshPanCursorState() {
    const body = document.body;
    if (!body) return;
    body.classList.toggle("space-pan-mode", isPanModeActive());
}

function updateCanvasTransform() {
    const surface = document.getElementById("canvasSurface");
    const stack = document.getElementById("canvasStack");
    if (surface && stack) {
        // Surface is positioned at left: 50%, so we translate it back by -50% plus pan offsets
        // Pan is applied at screen level, zoom is applied to the stack
        surface.style.transform = `translateX(calc(-50% + ${canvasPanX}px)) translateY(${canvasPanY}px)`;
        stack.style.transformOrigin = "center center";
        stack.style.transform = `scale(${currentZoomFactor})`;
    }
}

function clampPanOffsets() {
    const viewport = document.getElementById("canvasViewport");
    const stack = document.getElementById("canvasStack");
    if (!viewport || !stack) {
        updateCanvasTransform();
        return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const viewportWidth = viewportRect.width || viewport.clientWidth || 1;
    const viewportHeight = viewportRect.height || viewport.clientHeight || 1;
    const scaledWidth = stack.offsetWidth * currentZoomFactor;
    const scaledHeight = stack.offsetHeight * currentZoomFactor;

    if (!scaledWidth || !scaledHeight) {
        updateCanvasTransform();
        return;
    }

    // Horizontal: same as before – keep canvas roughly centered but allow movement.
    if (scaledWidth <= viewportWidth) {
        canvasPanX = 0;
    } else {
        const limitX = (scaledWidth - viewportWidth) / 2;
        canvasPanX = Math.max(-limitX, Math.min(limitX, canvasPanX));
    }

    // Vertical: when zoomed out (<1x), don't clamp Y so you can freely pan
    // to the bottom even if it means the canvas can move off-screen a bit.
    // For 1x and above, keep a safe range so the canvas never fully vanishes.
    if (currentZoomFactor >= 1) {
        // Canvas top is at panY, bottom is at panY + scaledHeight.
        // We want:
        //   - top can be at 0  (see top rows under the header)
        //   - bottom can be at viewportHeight (see very last rows)
        if (scaledHeight <= viewportHeight) {
            canvasPanY = 0;
        } else {
            const minPanY = viewportHeight - scaledHeight; // bottom exactly at viewport bottom
            const maxPanY = 0;                             // top exactly under header
            canvasPanY = Math.max(minPanY, Math.min(maxPanY, canvasPanY));
        }
    }

    updateCanvasTransform();
}

function getBrushOffsets(index) {
    if (brushOffsetsCache.has(index)) {
        return brushOffsetsCache.get(index);
    }
    const radius = brushSizeRadii[index] ?? 0;
    const offsets = [];
    const maxOffset = Math.max(0, Math.ceil(radius));
    for (let dx = -maxOffset; dx <= maxOffset; dx++) {
        for (let dy = -maxOffset; dy <= maxOffset; dy++) {
            if (Math.hypot(dx, dy) <= radius + 0.01) {
                offsets.push({ x: dx * TILE_SIZE, y: dy * TILE_SIZE });
            }
        }
    }
    if (!offsets.length) {
        offsets.push({ x: 0, y: 0 });
    }
    brushOffsetsCache.set(index, offsets);
    return offsets;
}

function cloneBrushItem(item) {
    if (!item) return null;
    return { ...item };
}

function findPaletteMatch(item) {
    if (!item) return null;
    return palette.find(
        (p) =>
            p?.char === item.char &&
            (p?.src ? p.src === item.src : true)
    ) || null;
}

function addFreeformStampAtPosition(x, y, item) {
    const { width, height } = getCanvasDimensions();
    const clampedX = clamp(x, -TILE_SIZE, width);
    const clampedY = clamp(y, -TILE_SIZE, height);
    const stamp = {
        id: ++freeformStampId,
        x: clampedX,
        y: clampedY,
        item: cloneBrushItem(item)
    };
    freeformStamps.push(stamp);
    return stamp;
}

function addStampWithMirror(x, y, item) {
    const { width } = getCanvasDimensions();
    const mainStamp = addFreeformStampAtPosition(x, y, item);
    if (!mirrorEnabled) {
        return;
    }
    const mirroredX = width - (mainStamp.x + TILE_SIZE);
    if (Math.abs(mirroredX - mainStamp.x) <= 0.5) {
        return;
    }
    addFreeformStampAtPosition(mirroredX, mainStamp.y, item);
}

function getCanvasPointFromEvent(evt) {
    const layer = document.getElementById("freeformLayer");
    if (!layer) {
        return { x: 0, y: 0 };
    }
    const rect = layer.getBoundingClientRect();
    return {
        x: (evt.clientX - rect.left) / currentZoomFactor,
        y: (evt.clientY - rect.top) / currentZoomFactor
    };
}

function pointToCell(point) {
    return {
        r: clamp(Math.floor(point.y / TILE_SIZE), 0, rows - 1),
        c: clamp(Math.floor(point.x / TILE_SIZE), 0, cols - 1)
    };
}

function serializeBrushItem(item) {
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

function deserializeBrushItem(data) {
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

function serializeGridStateData(state) {
    if (!Array.isArray(state)) return [];
    return state.map(row => (row || []).map(cell => serializeBrushItem(cell)));
}

function deserializeGridStateData(state) {
    if (!Array.isArray(state)) return [];
    return state.map(row => (Array.isArray(row) ? row.map(deserializeBrushItem) : []));
}

function serializeFreeformStamps(stamps) {
    if (!Array.isArray(stamps)) return [];
    return stamps.map(stamp => ({
        id: stamp.id,
        x: stamp.x,
        y: stamp.y,
        item: serializeBrushItem(stamp.item)
    }));
}

function deserializeFreeformStamps(stamps) {
    if (!Array.isArray(stamps)) return [];
    return stamps.map(stamp => ({
        id: stamp.id ?? 0,
        x: typeof stamp.x === "number" ? stamp.x : 0,
        y: typeof stamp.y === "number" ? stamp.y : 0,
        item: deserializeBrushItem(stamp.item)
    }));
}

function buildBinblockPayload() {
    return {
        version: BINBLOCK_VERSION,
        savedAt: new Date().toISOString(),
        rows,
        cols,
        tileSize: TILE_SIZE,
        canvasMode,
        animateMode,
        frameCount: frames.length,
        grid: serializeGridStateData(grid),
        freeform: serializeFreeformStamps(freeformStamps),
        frames: frames.map(frame => serializeGridStateData(frame)),
        palette: {
            custom: customPalette.map(serializeBrushItem).filter(Boolean),
            activeBrush: serializeBrushItem(activeBrush)
        }
    };
}

function normalizeGridData(data, targetRows, targetCols) {
    const bg = getBackgroundItem();
    const safeRows = Math.max(1, targetRows || 1);
    const safeCols = Math.max(1, targetCols || 1);
    const result = Array.from({ length: safeRows }, (_, r) => {
        const sourceRow = data[r] || [];
        return Array.from({ length: safeCols }, (_, c) => sourceRow[c] ?? null ?? bg);
    });
    return result;
}

function normalizeFrameData(frameData, targetRows, targetCols) {
    if (!Array.isArray(frameData)) return normalizeGridData([], targetRows, targetCols);
    return normalizeGridData(frameData, targetRows, targetCols);
}

function updateRowsColsInputs() {
    const rowsInput = document.getElementById("rowsInput");
    const colsInput = document.getElementById("colsInput");
    if (rowsInput) rowsInput.value = rows;
    if (colsInput) colsInput.value = cols;
}

function saveBinblock() {
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

function triggerBinblockLoad() {
    const input = document.getElementById("binblockInput");
    if (input) input.click();
}

async function handleBinblockFileChange(event) {
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

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Unable to read file"));
        reader.readAsText(file);
    });
}

function applyBinblockPayload(payload) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Invalid payload");
    }
    if (payload.version && payload.version > BINBLOCK_VERSION) {
        throw new Error("This file was created with a newer version of BinBag.");
    }

    const loadedRows = payload.rows || payload.meta?.rows || (payload.grid?.length ?? rows);
    const loadedCols = payload.cols || payload.meta?.cols || (payload.grid?.[0]?.length ?? cols);
    rows = Math.max(1, loadedRows || rows);
    cols = Math.max(1, loadedCols || cols);
    updateRowsColsInputs();

    const paletteData = payload.palette || {};
    const loadedCustomPalette = Array.isArray(paletteData.custom)
        ? paletteData.custom.map(deserializeBrushItem).filter(Boolean)
        : [];
    customPalette = loadedCustomPalette;
    palette = [...basePalette, ...imageDefaults, ...customPalette];
    renderPalette();

    const gridData = deserializeGridStateData(payload.grid);
    grid = normalizeGridData(gridData, rows, cols);

    freeformStamps = deserializeFreeformStamps(payload.freeform);
    freeformStampId = freeformStamps.reduce((max, stamp) => Math.max(max, stamp.id || 0), 0);

    if (Array.isArray(payload.frames) && payload.frames.length) {
        frames = payload.frames.map(frame => normalizeFrameData(deserializeGridStateData(frame), rows, cols));
    } else {
        frames = grid.length ? [cloneGrid(grid)] : [];
    }
    currentFrame = 0;

    const active = deserializeBrushItem(paletteData.activeBrush);
    if (active) {
        activeBrush = active;
    }

    if (typeof payload.canvasMode === "string") {
        canvasMode = payload.canvasMode === "freeform" ? "freeform" : "grid";
        updateCanvasModeUI();
    } else {
        renderGrid();
        updateFreeformLayer();
    }

    if (typeof payload.animateMode === "boolean") {
        animateMode = payload.animateMode;
        const btn = document.getElementById("animateToggle");
        const animControls = document.getElementById("animationControls");
        const saveGifBtn = document.getElementById("saveGifBtn");
        if (btn) {
            btn.textContent = animateMode ? "Animate: On" : "Animate: Off";
            btn.classList.toggle("tool-active", animateMode);
        }
        if (animControls) {
            animControls.style.display = animateMode ? "flex" : "none";
        }
        if (saveGifBtn) {
            saveGifBtn.style.display = animateMode ? "inline-block" : "none";
        }
    }

    renderGrid();
    updateExport();
    updateFreeformLayer();
    updateFrameDisplay();
    alert("Loaded .binblock project successfully!");
}

// imageDefaults: assets 00.png..95.png as default emojis (skip 63 which doesn't exist)
const imageDefaults = [];
for (let i = 0; i <= 95; i++) {
    if (i === 63) continue;
    const num = i.toString().padStart(2, "0");
    // use updated art for 8 and 49 while keeping :08: and :49: codes
    let fileName;
    if (num === "08") {
        fileName = "8new.png"; // actual file present in assets
    } else if (num === "49") {
        fileName = "49new.png";
    } else {
        fileName = `${num}.png`;
    }

// --- SELECTION HELPERS ---
function mergeSelectionRects(existing, rect) {
    if (!existing || !existing.length) return [rect];
    return [...existing, rect];
}

function renderGridWithPreview(previewR, previewC) {
    const canvas = document.getElementById("canvas");
    canvas.innerHTML = "";

    const top = Math.min(...selection.map(r => r.top));
    const left = Math.min(...selection.map(r => r.left));
    const bottom = Math.max(...selection.map(r => r.bottom));
    const right = Math.max(...selection.map(r => r.right));
    const h = bottom - top + 1;
    const w = right - left + 1;

    // Adjust position to center on cursor
    const adjustedR = Math.max(0, Math.min(previewR - Math.floor(h/2), rows - h));
    const adjustedC = Math.max(0, Math.min(previewC - Math.floor(w/2), cols - w));

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement("div");
            cell.className = "canvas-cell";

            // Check if this cell is in the original selection
            let inOriginalSelection = false;
            for (const rect of selection) {
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
                const val = grid[sourceR][sourceC];
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
            } else if (inOriginalSelection && selectionMode === "move") {
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
                const val = grid[r][c];
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
    applyZoom({ skipCenter: true });
}

function handleSelectionActionAt(targetR, targetC) {
    if (!selection || !selection.length) return;
    
    const top = Math.min(...selection.map(r => r.top));
    const left = Math.min(...selection.map(r => r.left));
    const bottom = Math.max(...selection.map(r => r.bottom));
    const right = Math.max(...selection.map(r => r.right));
    const h = bottom - top + 1;
    const w = right - left + 1;

    if (selectionMode === "delete") {
        // Delete instantly: clear selected areas to background
        pushHistory();
        const bg = getBackgroundItem();
        for (const rect of selection) {
            for (let rr = rect.top; rr <= rect.bottom; rr++) {
                for (let cc = rect.left; cc <= rect.right; cc++) {
                    grid[rr][cc] = bg;
                }
            }
        }
        selection = [];
        renderGrid();
        updateExport();
    } else if (selectionMode === "move") {
        // Move: drag selected area to new position, leaving :00: behind
        if (!window.moveHistoryPushed) {
            pushHistory();
            window.moveHistoryPushed = true;
        }
        const bg = getBackgroundItem();

        // Copy data from old location
        const data = [];
        for (let i = 0; i < h; i++) {
            const row = [];
            for (let j = 0; j < w; j++) {
                row.push(grid[top + i][left + j]);
            }
            data.push(row);
        }

        // Clear old location
        for (let rr = top; rr <= bottom; rr++) {
            for (let cc = left; cc <= right; cc++) {
                grid[rr][cc] = bg;
            }
        }

        // Paste at new location (adjust position to center on cursor)
        const adjustedR = Math.max(0, Math.min(targetR - Math.floor(h/2), rows - h));
        const adjustedC = Math.max(0, Math.min(targetC - Math.floor(w/2), cols - w));
        
        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) {
                grid[adjustedR + i][adjustedC + j] = data[i][j];
            }
        }

        // Update selection to new position
        selection = [{
            top: adjustedR,
            left: adjustedC,
            bottom: adjustedR + h - 1,
            right: adjustedC + w - 1
        }];

        renderGrid();
        updateExport();
    } else if (selectionMode === "copy") {
        // Duplicate: copy selected area to new position
        if (!window.moveHistoryPushed) {
            pushHistory();
            window.moveHistoryPushed = true;
        }

        // Copy data from old location
        const data = [];
        for (let i = 0; i < h; i++) {
            const row = [];
            for (let j = 0; j < w; j++) {
                row.push(grid[top + i][left + j]);
            }
            data.push(row);
        }

        // Paste at new location (adjust position to center on cursor)
        const adjustedR = Math.max(0, Math.min(targetR - Math.floor(h/2), rows - h));
        const adjustedC = Math.max(0, Math.min(targetC - Math.floor(w/2), cols - w));
        
        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) {
                grid[adjustedR + i][adjustedC + j] = data[i][j];
            }
        }

        renderGrid();
        updateExport();
    }

    updateFreeformLayer();
}
    imageDefaults.push({
        type: "img",
        src: `assets/${fileName}`,
        char: `:${num}:`,
        category: "default"
    });
}

// customPalette: images user uploads
let customPalette = [];

// full palette used for painting / randomization is derived each render
let palette = [...basePalette, ...imageDefaults];

function getAllPaletteEntries() {
    return [...basePalette, ...imageDefaults, ...customPalette];
}

const MAX_IMPORT_SIZE = 100;
const paletteColorCache = new Map();
const paletteColorPromises = new Map();

function getPaletteCacheKey(entry) {
    if (!entry) return "";
    if (entry.type === "img" && entry.src) return entry.src;
    return entry.char || JSON.stringify(entry);
}

function computeAverageColorFromImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        applyCrossOriginIfNeeded(img, src);
        img.decoding = "async";
        img.onload = () => {
            try {
                const sampleSize = 32;
                const canvas = document.createElement("canvas");
                canvas.width = sampleSize;
                canvas.height = sampleSize;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    resolve({ r: 0, g: 0, b: 0 });
                    return;
                }
                ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
                const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
                let r = 0, g = 0, b = 0, count = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const alpha = data[i + 3];
                    if (alpha < 10) continue;
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }
                if (!count) {
                    resolve({ r: 0, g: 0, b: 0 });
                    return;
                }
                resolve({
                    r: Math.round(r / count),
                    g: Math.round(g / count),
                    b: Math.round(b / count)
                });
            } catch (err) {
                console.error("Failed to sample palette image", err);
                resolve({ r: 0, g: 0, b: 0 });
            }
        };
        img.onerror = () => resolve({ r: 0, g: 0, b: 0 });
        img.src = src;
    });
}

async function ensurePaletteColor(entry) {
    const key = getPaletteCacheKey(entry);
    if (!key) return null;
    if (paletteColorCache.has(key)) {
        return paletteColorCache.get(key);
    }
    if (paletteColorPromises.has(key)) {
        return paletteColorPromises.get(key);
    }

    const promise = (async () => {
        if (entry.type === "img" && entry.src) {
            const color = await computeAverageColorFromImage(entry.src);
            paletteColorCache.set(key, color);
            return color;
        }
        // default fallback for unicode entries
        const fallback = { r: 128, g: 128, b: 128 };
        paletteColorCache.set(key, fallback);
        return fallback;
    })();

    paletteColorPromises.set(key, promise);
    try {
        const color = await promise;
        return color;
    } finally {
        paletteColorPromises.delete(key);
    }
}

async function ensurePaletteColors(entries) {
    await Promise.all(entries.map((entry) => ensurePaletteColor(entry)));
}

function openImportDialog() {
    const input = document.getElementById("importImageInput");
    if (input) input.click();
}

function openGimportDialog() {
    const input = document.getElementById("gimportInput");
    if (input) input.click();
}

async function handleImportImageChange(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
        await importImageFile(file);
    } catch (err) {
        console.error("Failed to import image", err);
        alert("Import failed. Please try a different image.");
    } finally {
        event.target.value = "";
    }
}

async function handleGimportChange(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
        await importGifFile(file);
    } catch (err) {
        console.error("Failed to import GIF", err);
        alert("GIF import failed. Please try a different file.");
    } finally {
        event.target.value = "";
    }
}

// --- MODE SELECTION ---
const DEFAULT_ROWS = 4;
const DEFAULT_COLS = 7;

function setMode(mode) {
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
    canvasPanX = 0;
    canvasPanY = 0;
    const oneIndex = zoomLevels.indexOf(1);
    zoomIndex = oneIndex >= 0 ? oneIndex : 0;
    updateZoomButtonLabel();
    // Use setTimeout to ensure DOM has updated with new grid size
    setTimeout(() => {
        applyZoom();
    }, 50);
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Unable to read file"));
        reader.readAsDataURL(file);
    });
}

function loadImageSource(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        applyCrossOriginIfNeeded(img, src);
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Unable to load image"));
        img.src = src;
    });
}

let omggifLoadingPromise = null;
function ensureOmggif() {
    if (typeof GifReader !== "undefined") return Promise.resolve();
    if (!omggifLoadingPromise) {
        omggifLoadingPromise = new Promise((resolve) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.js";
            script.onload = () => {
                console.log("omggif loaded successfully");
                resolve();
            };
            script.onerror = (err) => {
                console.error("Failed to load omggif from CDN", err);
                resolve();
            };
            document.head.appendChild(script);
        });
    }
    return omggifLoadingPromise;
}

const imageElementCache = new Map();
async function getImageElement(src) {
    if (imageElementCache.has(src)) {
        return imageElementCache.get(src);
    }
    const img = await loadImageSource(src);
    imageElementCache.set(src, img);
    return img;
}

async function importImageFile(file) {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImageSource(dataUrl);
    await applyImageToGrid(img);
}

function colorDistance(c1, c2) {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return dr * dr + dg * dg + db * db;
}

function findClosestPaletteEntry(color, paletteColors, backgroundItem) {
    if (!paletteColors.length) return backgroundItem;
    let best = backgroundItem;
    let bestScore = Infinity;
    for (const item of paletteColors) {
        if (!item.color) continue;
        const score = colorDistance(color, item.color);
        if (score < bestScore) {
            bestScore = score;
            best = item.entry;
        }
    }
    return best || backgroundItem;
}

async function applyImageToGrid(img) {
    const paletteEntries = getAllPaletteEntries();
    if (!paletteEntries.length) return;

    await ensurePaletteColors(paletteEntries);
    const paletteColors = paletteEntries
        .map(entry => ({
            entry,
            color: paletteColorCache.get(getPaletteCacheKey(entry))
        }))
        .filter(item => item.color);

    // Use current grid size instead of scaling to max
    const targetRows = rows || 4;
    const targetCols = cols || 7;

    const canvas = document.createElement("canvas");
    canvas.width = targetCols;
    canvas.height = targetRows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetCols, targetRows);

    const imageData = ctx.getImageData(0, 0, targetCols, targetRows).data;
    const bgItem = getBackgroundItem();

    const newGrid = gridFromImageData(imageData, targetRows, targetCols, paletteColors, bgItem);

    if (grid && grid.length) {
        pushHistory();
    }

    grid = newGrid;

    renderGrid();
    updateExport();
    updateFreeformLayer();
}

function gridFromImageData(imageData, targetRows, targetCols, paletteColors, bgItem) {
    const newGrid = Array.from({ length: targetRows }, () => Array(targetCols).fill(bgItem));
    for (let r = 0; r < targetRows; r++) {
        for (let c = 0; c < targetCols; c++) {
            const idx = (r * targetCols + c) * 4;
            const alpha = imageData[idx + 3];
            if (alpha < 10) {
                newGrid[r][c] = bgItem;
                continue;
            }
            const color = {
                r: imageData[idx],
                g: imageData[idx + 1],
                b: imageData[idx + 2]
            };
            newGrid[r][c] = findClosestPaletteEntry(color, paletteColors, bgItem);
        }
    }
    return newGrid;
}

// --- RANDOM GENERATORS ---
function getRandomPaletteItem() {
    return palette[Math.floor(Math.random() * palette.length)];
}

function getBackgroundItem() {
    const zero = palette.find(p => p.char === ":00:");
    return zero || palette[0];
}

function randomInfinite() {
    if (!rows || !cols) return;
    pushHistory();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid[r][c] = getRandomPaletteItem();
        }
    }
    renderGrid();
    updateExport();
}

function randomCar() {
    if (!rows || !cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid[r][c] = bg;
        }
    }

    const choices = palette.filter(p => p !== bg);
    const body = choices[Math.floor(Math.random() * choices.length)] || bg;
    const windowTile = choices[Math.floor(Math.random() * choices.length)] || body;
    const wheel = choices[Math.floor(Math.random() * choices.length)] || body;

    // vehicle type: 0 = car, 1 = truck, 2 = bus
    const type = Math.floor(Math.random() * 3);

    const bodyHeight = type === 2 ? Math.max(3, Math.floor(rows * 0.3)) : Math.max(2, Math.floor(rows * 0.25));
    const bodyWidth = (() => {
        if (type === 0) return Math.max(4, Math.floor(cols * 0.4));
        if (type === 1) return Math.max(5, Math.floor(cols * 0.6));
        return Math.max(6, Math.floor(cols * 0.7));
    })();

    const left = Math.max(1, Math.floor((cols - bodyWidth) / 2));
    const right = Math.min(cols - 2, left + bodyWidth - 1);
    const bottom = rows - 2;
    const top = Math.max(1, bottom - bodyHeight + 1);

    // body
    for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
            grid[r][c] = body;
        }
    }

    // windows row
    const windowRow = top + 1;
    if (grid[windowRow]) {
        const segments = type === 0 ? 2 : type === 1 ? 3 : 4;
        const segWidth = Math.max(1, Math.floor((right - left + 1) / (segments + 1)));
        for (let s = 1; s <= segments; s++) {
            const start = left + s * segWidth - 1;
            if (start < left || start > right) continue;
            if (grid[windowRow][start] !== undefined) grid[windowRow][start] = windowTile;
        }
    }

    // wheels
    const wheelRow = bottom + 1;
    if (grid[wheelRow]) {
        const wheelCount = type === 0 ? 2 : 3;
        for (let i = 0; i < wheelCount; i++) {
            const t = i / (wheelCount - 1 || 1);
            const col = left + Math.round(t * (right - left));
            if (grid[wheelRow][col] !== undefined) grid[wheelRow][col] = wheel;
        }
    }

    renderGrid();
    updateExport();
}

function randomFace() {
    if (!rows || !cols) return;
    pushHistory();
    const bg = getBackgroundItem();

    // fill with background first
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid[r][c] = bg;
        }
    }

    // choose random palette items for features
    const choices = palette.filter(p => p !== bg);
    const border = choices[Math.floor(Math.random() * choices.length)] || bg;
    const fill = choices[Math.floor(Math.random() * choices.length)] || bg;
    const eye = choices[Math.floor(Math.random() * choices.length)] || fill;
    const mouth = choices[Math.floor(Math.random() * choices.length)] || eye;

    // draw head area
    for (let r = 1; r < rows - 1; r++) {
        for (let c = 1; c < cols - 1; c++) {
            let val = fill;
            if (r === 1 || r === rows - 2 || c === 1 || c === cols - 2) {
                val = border;
            }
            grid[r][c] = val;
        }
    }

    const eyeRow = Math.max(2, Math.floor(rows / 3));
    const leftEyeCol = Math.max(2, Math.floor(cols / 3));
    const rightEyeCol = Math.min(cols - 3, Math.floor(2 * cols / 3));
    const mouthRow = Math.min(rows - 3, Math.floor(2 * rows / 3));

    if (grid[eyeRow]) {
        grid[eyeRow][leftEyeCol] = eye;
        grid[eyeRow][rightEyeCol] = eye;
    }

    // random mouth style
    if (grid[mouthRow]) {
        const style = Math.floor(Math.random() * 3); // 0: flat, 1: smile, 2: frown
        for (let c = leftEyeCol; c <= rightEyeCol; c++) {
            let mr = mouthRow;
            if (style === 1 && (c === leftEyeCol || c === rightEyeCol)) mr = mouthRow - 1;
            if (style === 2 && (c === leftEyeCol || c === rightEyeCol)) mr = mouthRow + 1;
            if (grid[mr]) grid[mr][c] = mouth;
        }
    }

    renderGrid();
    updateExport();
}

function randomFlower() {
    if (!rows || !cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    // fill with background
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid[r][c] = bg;
        }
    }

    const choices = palette.filter(p => p !== bg);
    const stem = choices[Math.floor(Math.random() * choices.length)] || bg;
    const petal = choices[Math.floor(Math.random() * choices.length)] || stem;
    const center = choices[Math.floor(Math.random() * choices.length)] || petal;

    const flowerCount = Math.random() < 0.4 && cols >= 6 ? 2 : 1;
    for (let f = 0; f < flowerCount; f++) {
        const centerRow = 1 + Math.floor(Math.random() * Math.max(1, Math.floor(rows / 3)));
        const centerCol = 1 + Math.floor(Math.random() * (cols - 2));

        if (!grid[centerRow]) continue;
        grid[centerRow][centerCol] = center;

        // random petal pattern: 0 = plus, 1 = diamond, 2 = ring
        const variant = Math.floor(Math.random() * 3);
        const offsets = [
            { dr: -1, dc: 0 },
            { dr: 1, dc: 0 },
            { dr: 0, dc: -1 },
            { dr: 0, dc: 1 }
        ];

        offsets.forEach(({ dr, dc }) => {
            const rr = centerRow + dr;
            const cc = centerCol + dc;
            if (grid[rr] && grid[rr][cc] !== undefined) grid[rr][cc] = petal;
        });

        if (variant >= 1) {
            // extra diagonal petals
            const diag = [
                { dr: -1, dc: -1 },
                { dr: -1, dc: 1 },
                { dr: 1, dc: -1 },
                { dr: 1, dc: 1 }
            ];
            diag.forEach(({ dr, dc }) => {
                const rr = centerRow + dr;
                const cc = centerCol + dc;
                if (grid[rr] && grid[rr][cc] !== undefined) grid[rr][cc] = petal;
            });
        }

        // stem downward
        const stemStart = centerRow + 1;
        for (let r = stemStart; r < rows; r++) {
            const width = 1 + Math.floor(Math.random() * 2); // 1 or 2 wide stem
            for (let w = 0; w < width; w++) {
                const cc = centerCol + (variant % 2 === 0 ? w : -w);
                if (grid[r] && grid[r][cc] !== undefined) grid[r][cc] = stem;
            }
            // occasional leaf
            if (Math.random() < 0.25) {
                const side = Math.random() < 0.5 ? -1 : 1;
                const lc = centerCol + side * 2;
                if (grid[r] && grid[r][lc] !== undefined) grid[r][lc] = stem;
            }
        }
    }

    renderGrid();
    updateExport();
}

function randomHouse() {
    if (!rows || !cols) return;
    pushHistory();
    const bg = getBackgroundItem();

    const choices = palette.filter(p => p !== bg);
    const wall = choices[Math.floor(Math.random() * choices.length)] || bg;
    const roof = choices[Math.floor(Math.random() * choices.length)] || wall;
    const door = choices[Math.floor(Math.random() * choices.length)] || roof;
    const windowTile = choices[Math.floor(Math.random() * choices.length)] || door;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid[r][c] = bg;
        }
    }

    const baseHeight = Math.max(3, Math.floor(rows * 0.4));
    const baseWidth = Math.max(3, Math.floor(cols * (0.4 + Math.random() * 0.4)));
    const baseLeft = Math.floor((cols - baseWidth) / 2);
    const baseRight = baseLeft + baseWidth - 1;
    const baseBottom = rows - 1;
    const baseTop = baseBottom - baseHeight + 1;

    for (let r = baseTop; r <= baseBottom; r++) {
        for (let c = baseLeft; c <= baseRight; c++) {
            grid[r][c] = wall;
        }
    }

    // roof variants: 0 = flat, 1 = tall triangle, 2 = short triangle
    const roofVariant = Math.floor(Math.random() * 3);
    const roofCenterCol = Math.floor((baseLeft + baseRight) / 2);
    const roofHeight = roofVariant === 0 ? 1 : Math.max(1, Math.floor(baseHeight / (roofVariant === 1 ? 1.5 : 2.5)));

    for (let h = 0; h < roofHeight; h++) {
        const row = baseTop - 1 - h;
        if (row < 0) break;
        const span = roofVariant === 0
            ? [baseLeft, baseRight]
            : [roofCenterCol - (baseWidth / 2 | 0) + h, roofCenterCol + (baseWidth / 2 | 0) - h];
        for (let c = span[0]; c <= span[1]; c++) {
            if (grid[row] && c >= 0 && c < cols) grid[row][c] = roof;
        }
    }

    // door position: left, center, or right
    const doorWidth = Math.max(1, Math.floor(baseWidth / 5));
    const doorModes = [baseLeft + 1, roofCenterCol - Math.floor(doorWidth / 2), baseRight - doorWidth];
    const doorLeft = doorModes[Math.floor(Math.random() * doorModes.length)];
    for (let r = baseBottom; r >= baseBottom - Math.floor(baseHeight / 2); r--) {
        for (let c = doorLeft; c < doorLeft + doorWidth; c++) {
            if (grid[r] && c >= 0 && c < cols) grid[r][c] = door;
        }
    }

    // windows: one or two rows
    const windowRows = [];
    if (baseHeight > 3) windowRows.push(baseTop + 1);
    if (baseHeight > 5 && Math.random() < 0.7) windowRows.push(baseTop + 2 + Math.floor(baseHeight / 4));
    windowRows.forEach(wr => {
        if (!grid[wr]) return;
        const leftWinCol = baseLeft + 1;
        const rightWinCol = baseRight - 1;
        if (leftWinCol >= 0 && leftWinCol < cols) grid[wr][leftWinCol] = windowTile;
        if (rightWinCol >= 0 && rightWinCol < cols) grid[wr][rightWinCol] = windowTile;
    });

    // optional chimney
    if (Math.random() < 0.6) {
        const chimCol = roofCenterCol + (Math.random() < 0.5 ? -Math.floor(baseWidth / 4) : Math.floor(baseWidth / 4));
        for (let r = baseTop - roofHeight - 1; r < baseTop; r++) {
            if (grid[r] && chimCol >= 0 && chimCol < cols) grid[r][chimCol] = roof;
        }
    }

    renderGrid();
    updateExport();
}

function randomAlien() {
    if (!rows || !cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid[r][c] = bg;
        }
    }

    const choices = palette.filter(p => p !== bg);
    const body = choices[Math.floor(Math.random() * choices.length)] || bg;
    const eye = choices[Math.floor(Math.random() * choices.length)] || body;
    const accent = choices[Math.floor(Math.random() * choices.length)] || body;

    const templates = [
        [
            "00100",
            "01110",
            "11111",
            "10101",
            "01010"
        ],
        [
            "01110",
            "11111",
            "10101",
            "11111",
            "01010"
        ],
        [
            "00100",
            "01110",
            "11111",
            "11011",
            "10101"
        ]
    ];

    const tmpl = templates[Math.floor(Math.random() * templates.length)];
    const h = tmpl.length;
    const w = tmpl[0].length;

    const startRow = Math.max(1, Math.floor((rows - h) / 2));
    const startCol = Math.max(1, Math.floor((cols - w) / 2));

    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            if (tmpl[r][c] === "1") {
                const rr = startRow + r;
                const cc = startCol + c;
                if (!grid[rr] || grid[rr][cc] === undefined) continue;
                // eyes on second row
                if (r === 1 && (c === 1 || c === w - 2)) {
                    grid[rr][cc] = eye;
                } else if (r === 2 && c === Math.floor(w / 2)) {
                    grid[rr][cc] = accent;
                } else {
                    grid[rr][cc] = body;
                }
            }
        }
    }

    renderGrid();
    updateExport();
}

let activeBrush = null;
let grid = [];
let rows = 4, cols = 7;
let isMouseDown = false;
let isPainting = false;
let history = [];
let future = [];
let exportChunks = [];
let exportHalfChunks = [];
let exportTopChunks = [];
let mirrorEnabled = false;
let currentTool = "brush";
let selection = [];         // array of { top, left, bottom, right, data }
let selectionStart = null;  // { r, c }
let selectionMode = "move"; // "move" | "copy" | "delete"
let isSelectingDrag = false;
let mouseListenersAttached = false;
let clipboardSelection = null; // for copy/paste
let exportLabel = "";         // optional label line above export
let lastExportText = "";      // raw text used for Copy All
let brushHistory = [];        // history of used brushes
let brushHistoryIndex = -1;   // current position in brush history
const tips = [
    "Generally 8x9 or 9x8 binblocks are the maximum size before you need to set a new line",
    "There are wrong ways to bin block",
    "The original name of this program was BinBlock Buddy",
    "If you have ideas to make this program better please let John know.",
    "You can press and hold space to drag around the canvas.",
    "G-Mode import ensures gifs show up in good quality but will be big filesizes.",
    "Harrhy is competition and tough competition in the bin block program creation sub culture.",
    "Random Alien, Random Cat, Random Dog, and Random Car are rare abandoned ware.",
    "This was made with AI code and human creativity."
];

// --- BAND COLORS FOR EXPORT PARTS ---
const bandColors = [
    "#00ff00",
    "#ff77ff",
    "#ffa500",
    "#ff0000",
    "#00aaff",
    "#aa00ff",
    "#8b4513",
    "#ffff00"
];

function getBandColor(index) {
    return bandColors[index % bandColors.length];
}

// How many rows are in each export part (Copy 1, 2, ...). Default 8.
let rowsPerPart = 8;

// --- THEME SETTINGS (for Settings panel) ---
const THEME_STORAGE_KEY = "binbag-theme";

const themeDefaults = {
    mainBg: "#080808",   // body background
    panelBg: "#1a1a1a",  // left/right panels
    canvasBg: "#000000", // export/canvas inner bg
    gridBg: "#1a1a1a",   // grid/canvas background
    buttonBg: "#151515",
    buttonText: "#00ff00"
};

let themeSettings = { ...themeDefaults };

const themePresets = {
    defaultDark: {
        mainBg: "#080808",
        panelBg: "#1a1a1a",
        canvasBg: "#000000",
        gridBg: "#1a1a1a",
        buttonBg: "#151515",
        buttonText: "#00ff00"
    },
    defaultLight: {
        mainBg: "#f5f5f5",
        panelBg: "#ffffff",
        canvasBg: "#ffffff",
        gridBg: "#f0f0f0",
        buttonBg: "#ffffff",
        buttonText: "#0088ff"
    },
    ozy: {
        mainBg: "#070312",
        panelBg: "#120826",
        canvasBg: "#050010",
        gridBg: "#1a0a2e",
        buttonBg: "#2a0c4f",
        buttonText: "#ffddff"
    },
    jack: {
        mainBg: "#ffffff",
        panelBg: "#f8f8ff",
        canvasBg: "#ffffff",
        gridBg: "#f0f0ff",
        buttonBg: "#0000ff",
        buttonText: "#ffff00"
    },
    slime: {
        mainBg: "#031105",
        panelBg: "#05240a",
        canvasBg: "#020803",
        gridBg: "#0a3a0f",
        buttonBg: "#118833",
        buttonText: "#b6ff6b"
    },
    lava: {
        mainBg: "#150000",
        panelBg: "#240202",
        canvasBg: "#0a0000",
        gridBg: "#2a0a0a",
        buttonBg: "#b32600",
        buttonText: "#ffd27f"
    }
};

function loadThemeSettings() {
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        themeSettings = { ...themeDefaults, ...parsed };
    } catch (e) {
        themeSettings = { ...themeDefaults };
    }
}

function persistThemeSettings() {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themeSettings));
    } catch (e) {
        // ignore storage errors
    }
}

function applyThemeSettings() {
    const body = document.body;
    if (body) {
        body.style.backgroundColor = themeSettings.mainBg;
    }

    const paletteEl = document.getElementById("palette");
    const outputEl = document.getElementById("outputArea");
    if (paletteEl) paletteEl.style.backgroundColor = themeSettings.panelBg;
    if (outputEl) outputEl.style.backgroundColor = themeSettings.panelBg;

    const exportPreview = document.getElementById("exportPreview");
    if (exportPreview) exportPreview.style.backgroundColor = themeSettings.canvasBg;

    const canvasStack = document.getElementById("canvasStack");
    if (canvasStack) canvasStack.style.backgroundColor = themeSettings.gridBg;

    const buttons = document.querySelectorAll("button");
    buttons.forEach((btn) => {
        btn.style.backgroundColor = themeSettings.buttonBg;
        btn.style.color = themeSettings.buttonText;
    });
}

function openSettingsPanel() {
    const overlay = document.getElementById("settingsOverlay");
    if (!overlay) return;
    // ensure latest settings are reflected in inputs
    const mainInput = document.getElementById("themeMainBg");
    const panelInput = document.getElementById("themePanelBg");
    const canvasInput = document.getElementById("themeCanvasBg");
    const gridInput = document.getElementById("themeGridBg");
    const buttonBgInput = document.getElementById("themeButtonBg");
    const buttonTextInput = document.getElementById("themeButtonText");

    if (mainInput) mainInput.value = themeSettings.mainBg;
    if (panelInput) panelInput.value = themeSettings.panelBg;
    if (canvasInput) canvasInput.value = themeSettings.canvasBg;
    if (gridInput) gridInput.value = themeSettings.gridBg;
    if (buttonBgInput) buttonBgInput.value = themeSettings.buttonBg;
    if (buttonTextInput) buttonTextInput.value = themeSettings.buttonText;

    overlay.style.display = "flex";
}

function closeSettingsPanel() {
    const overlay = document.getElementById("settingsOverlay");
    if (overlay) overlay.style.display = "none";
}

function openHelpPanel() {
    const overlay = document.getElementById("helpOverlay");
    if (overlay) overlay.style.display = "flex";
}

function closeHelpPanel() {
    const overlay = document.getElementById("helpOverlay");
    if (overlay) overlay.style.display = "none";
}

function openExperimentalWarning() {
    alert("⚠️ Experimental Features Warning\n\nGimport and large animations are experimental, as is Freeform mode.\n\nG-Mode and I-Mode are mainly designed for importing and exporting and can cause some slight issues to occur.");
}

function saveThemeSettingsFromUI() {
    const mainInput = document.getElementById("themeMainBg");
    const panelInput = document.getElementById("themePanelBg");
    const canvasInput = document.getElementById("themeCanvasBg");
    const gridInput = document.getElementById("themeGridBg");
    const buttonBgInput = document.getElementById("themeButtonBg");
    const buttonTextInput = document.getElementById("themeButtonText");

    if (mainInput && mainInput.value) themeSettings.mainBg = mainInput.value;
    if (panelInput && panelInput.value) themeSettings.panelBg = panelInput.value;
    if (canvasInput && canvasInput.value) themeSettings.canvasBg = canvasInput.value;
    if (gridInput && gridInput.value) themeSettings.gridBg = gridInput.value;
    if (buttonBgInput && buttonBgInput.value) themeSettings.buttonBg = buttonBgInput.value;
    if (buttonTextInput && buttonTextInput.value) themeSettings.buttonText = buttonTextInput.value;

    persistThemeSettings();
    applyThemeSettings();
}

function resetThemeToDefaults() {
    themeSettings = { ...themeDefaults };
    persistThemeSettings();
    applyThemeSettings();
    // refresh UI inputs if panel is open
    openSettingsPanel();
}

function applyThemePreset(key) {
    const preset = themePresets[key];
    if (!preset) return;
    themeSettings = { ...themeDefaults, ...preset };
    persistThemeSettings();
    applyThemeSettings();
    openSettingsPanel();
}

// --- EXPORT CONFIG UI ---
function updateHalfRowsFromUI(value) {
    const num = parseInt(value, 10);
    if (!Number.isFinite(num)) return;
    const clamped = Math.max(1, Math.min(16, num));
    // 1 -> 2 rows, otherwise rowsPerPart = clamped
    rowsPerPart = clamped === 1 ? 2 : clamped;
    const label = document.getElementById("halfRowsLabel");
    if (label) label.textContent = String(rowsPerPart);
    updateExport();
}

// Slightly brighten a hex color for half-part buttons
function brightenColor(hex) {
    if (!hex || hex[0] !== "#" || (hex.length !== 7)) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const factor = 0.7; // mix strongly with white so it looks clearly brighter
    const nr = Math.min(255, Math.round(r + (255 - r) * factor));
    const ng = Math.min(255, Math.round(g + (255 - g) * factor));
    const nb = Math.min(255, Math.round(b + (255 - b) * factor));
    return `#${nr.toString(16).padStart(2, "0")}${ng
        .toString(16)
        .padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

// --- PALETTE RENDER ---
function rebuildPaletteFromFlags() {
    const favOnly = document.getElementById("showFavoritesOnly")?.checked;

    palette = [...basePalette, ...imageDefaults, ...customPalette];

    if (favOnly) {
        palette = palette.filter(p => p.favorite);
    }

    if (!palette.length) {
        palette = [...imageDefaults];
    }

    if (!palette.includes(activeBrush)) {
        // Prefer :00: as default brush if present, otherwise first palette item
        const zero = palette.find(p => p.char === ":00:");
        activeBrush = zero || palette[0];
    }
}

function renderPalette() {
    rebuildPaletteFromFlags();

    const container = document.getElementById("emojiPalette");
    container.innerHTML = "";

    palette.forEach((p) => {
        const div = document.createElement("div");
        div.className = "palette-item";

        if (p.category === "default") {
            div.classList.add("palette-default");
        } else if (p.category === "custom") {
            div.classList.add("palette-custom");
        }

        if (p.favorite) {
            div.classList.add("palette-favorite");
        }

        if (p === activeBrush) {
            div.classList.add("active-brush");
        }

        if (p.type === "unicode") {
            div.textContent = p.char;
        } else {
            const img = document.createElement("img");
            img.src = p.src;
            div.appendChild(img);
        }

        div.onclick = () => {
            activeBrush = p;
            addToBrushHistory(p);
            renderPalette();
        };

        div.oncontextmenu = (e) => {
            e.preventDefault();
            p.favorite = !p.favorite;
            renderPalette();
        };

        container.appendChild(div);
    });
}

// initialize palette + favorites toggle
window.addEventListener("load", () => {
    const favCb = document.getElementById("showFavoritesOnly");
    if (favCb) {
        favCb.checked = false;
        favCb.addEventListener("change", renderPalette);
    }
    renderPalette();
    loadThemeSettings();
    applyThemeSettings();
    const rowsInput = document.getElementById("rowsInput");
    const colsInput = document.getElementById("colsInput");
    const handleSizeChange = () => generateGrid();
    rowsInput?.addEventListener("change", handleSizeChange);
    rowsInput?.addEventListener("input", handleSizeChange);
    colsInput?.addEventListener("change", handleSizeChange);
    colsInput?.addEventListener("input", handleSizeChange);

    const importInput = document.getElementById("importImageInput");
    if (importInput) {
        importInput.addEventListener("change", handleImportImageChange);
    }

    const gimportInput = document.getElementById("gimportInput");
    if (gimportInput) {
        gimportInput.addEventListener("change", handleGimportChange);
    }

    // initially hide edge tags
    const paletteTag = document.getElementById("paletteTag");
    const exportTag = document.getElementById("exportTag");
    if (paletteTag) paletteTag.style.display = "none";
    if (exportTag) exportTag.style.display = "none";

    // Brush size button handlers
    const brushSizeBtns = document.querySelectorAll(".brush-size-btn");
    brushSizeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.sizeIndex, 10);
            if (!Number.isFinite(idx) || idx < 0 || idx >= brushSizeRadii.length) return;
            currentBrushSizeIndex = idx;
            brushSizeBtns.forEach(b => b.classList.remove("brush-size-active"));
            btn.classList.add("brush-size-active");
        });
    });

    renderTips();
    
    // Initialize canvas with proper pan handlers and auto-fit zoom
    ensureSpacePanHandlers();
    setTimeout(() => {
        autoFitZoom();
    }, 100);
});

// --- HISTORY (UNDO / REDO) ---
function cloneGrid(src) {
    return src.map(row => row.slice());
}

function cloneFreeformArray(arr) {
    return arr.map(stamp => ({
        id: stamp.id,
        x: stamp.x,
        y: stamp.y,
        item: stamp.item ? { ...stamp.item } : null
    }));
}

function captureEditorState() {
    return {
        grid: cloneGrid(grid),
        freeform: cloneFreeformArray(freeformStamps)
    };
}

function applyEditorState(state) {
    if (!state) return;
    grid = cloneGrid(state.grid);
    freeformStamps = cloneFreeformArray(state.freeform);
}

function pushHistory() {
    history.push(captureEditorState());
    if (history.length > 100) history.shift();
    future = [];
}

function undo() {
    if (!history.length) return;
    future.push(captureEditorState());
    const prev = history.pop();
    applyEditorState(prev);
    renderGrid();
    updateExport();
    updateFreeformLayer();
}

function redo() {
    if (!future.length) return;
    history.push(captureEditorState());
    const next = future.pop();
    applyEditorState(next);
    renderGrid();
    updateExport();
    updateFreeformLayer();
}

function addToBrushHistory(brush) {
    if (!brush) return;
    const canonical = findPaletteMatch(brush) || { ...brush };
    // Don't add if it's the same as the last brush
    if (brushHistory.length > 0) {
        const last = brushHistory[brushHistory.length - 1];
        if (
            last &&
            last.char === canonical.char &&
            (last.src || "") === (canonical.src || "")
        ) {
            brushHistoryIndex = brushHistory.length - 1;
            return;
        }
    }
    brushHistory.push(canonical);
    if (brushHistory.length > 50) brushHistory.shift();
    brushHistoryIndex = brushHistory.length - 1;
}

function navigateBrushHistory(direction) {
    if (brushHistory.length === 0) return;
    const newIndex = brushHistoryIndex + direction;
    if (newIndex < 0 || newIndex >= brushHistory.length) return;
    brushHistoryIndex = newIndex;
    const brush = brushHistory[brushHistoryIndex];
    if (!brush) return;
    const match = findPaletteMatch(brush);
    activeBrush = match || { ...brush };
    renderPalette();
}

document.addEventListener("keydown", (e) => {
    // Skip if in input field
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;

    if (e.ctrlKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        undo();
    } else if (e.ctrlKey && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        redo();
    } else if (e.key === "ArrowLeft" && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        navigateBrushHistory(-1);
    } else if (e.key === "ArrowRight" && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        navigateBrushHistory(1);
    }
});

// --- GRID LOGIC ---
function generateGrid() {
    const newRows = parseInt(document.getElementById("rowsInput").value);
    const newCols = parseInt(document.getElementById("colsInput").value);
    if (!Number.isFinite(newRows) || !Number.isFinite(newCols) || newRows < 1 || newCols < 1) {
        return;
    }

    const bg = getBackgroundItem(); // this will resolve to :00: as background

    if (!grid || !grid.length) {
        rows = newRows;
        cols = newCols;
        grid = Array.from({ length: rows }, () => Array(cols).fill(bg));
        history = [];
        future = [];
    } else {
        pushHistory();
        const oldGrid = grid;
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
        rows = newRows;
        cols = newCols;
        grid = resized;
    }

    renderGrid();
    updateExport();
    
    // Ensure canvas transform is updated after grid size change
    clampPanOffsets();
}

function clearGrid() {
    pushHistory();
    const bg = getBackgroundItem();
    grid = grid.map(row => row.map(() => bg));
    renderGrid();
    updateExport();
    updateFreeformLayer();
}

function renderGrid() {
    const canvas = document.getElementById("canvas");
    canvas.style.gridTemplateColumns = `repeat(${cols}, 40px)`;
    canvas.innerHTML = "";

    canvas.onmousedown = () => {
        isMouseDown = true;
    };

    if (!mouseListenersAttached) {
        document.addEventListener("mouseup", () => {
            isMouseDown = false;
            isPainting = false;
            
            // Apply move/copy/delete action when mouse is released
            if (
                isSelectingDrag &&
                selection &&
                selection.length &&
                ["move", "copy", "delete"].includes(selectionMode) &&
                window.dragTargetR !== undefined &&
                window.dragTargetC !== undefined
            ) {
                handleSelectionActionAt(window.dragTargetR, window.dragTargetC);
            }
            
            isSelectingDrag = false;
            selectionStart = null;
            window.moveHistoryPushed = false; // Reset history flag for next drag
            window.dragTargetR = undefined;
            window.dragTargetC = undefined;
        });
        document.addEventListener("mousemove", (evt) => {
            if (!isSelectingDrag || currentTool !== "select" || !selectionStart) return;
            const canvasRect = canvas.getBoundingClientRect();
            const x = evt.clientX - canvasRect.left;
            const y = evt.clientY - canvasRect.top;
            const c = Math.floor(x / 42); // approx cell width incl gap
            const r = Math.floor(y / 42);

            // If we have a selection and are in move/copy/delete mode, show preview while dragging
            if (selection && selection.length && ["move", "copy", "delete"].includes(selectionMode)) {
                window.dragTargetR = r;
                window.dragTargetC = c;
                // Show preview without modifying actual grid
                renderGridWithPreview(r, c);
            } else {
                // Build selection rectangle
                const top = Math.max(0, Math.min(selectionStart.r, r));
                const bottom = Math.min(rows - 1, Math.max(selectionStart.r, r));
                const left = Math.max(0, Math.min(selectionStart.c, c));
                const right = Math.min(cols - 1, Math.max(selectionStart.c, c));

                const newRect = { top, left, bottom, right };
                if (selectionStart.ctrl) {
                    // additive selection
                    selection = mergeSelectionRects(selection, newRect);
                } else {
                    selection = [newRect];
                }
                renderGrid();
            }
        });
        mouseListenersAttached = true;
    }

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement("div");
            cell.className = "canvas-cell";

            const val = grid[r][c];
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
            if (selection && selection.length) {
                for (const rect of selection) {
                    if (r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right) {
                        cell.classList.add("selected");
                        break;
                    }
                }
            }

            const paintCell = (fromDrag = false) => {
                if (!activeBrush) return;
                // Only push a new history state on the initial click, not on every drag cell
                if (!fromDrag) {
                    pushHistory();
                }

                const canvasEl = document.getElementById("canvas");

                const applyBrushAt = (rr, cc) => {
                    if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) return;
                    grid[rr][cc] = activeBrush;
                    if (!canvasEl) return;
                    const idx = rr * cols + cc;
                    const cellEl = canvasEl.children[idx];
                    if (!cellEl) return;
                    if (activeBrush.type === "unicode") {
                        cellEl.textContent = activeBrush.char;
                        cellEl.style.backgroundImage = "";
                    } else {
                        cellEl.textContent = "";
                        cellEl.style.backgroundImage = `url(${activeBrush.src})`;
                        cellEl.style.backgroundSize = "cover";
                    }
                };

                // main cell
                applyBrushAt(r, c);

                // mirrored cell horizontally if enabled
                if (mirrorEnabled) {
                    const mirrorC = cols - 1 - c;
                    applyBrushAt(r, mirrorC);
                }

                updateExport();
            };

            cell.onmousedown = (e) => {
                e.preventDefault();
                if (currentTool === "brush") {
                    paintCell(false);
                    isPainting = true;
                } else if (currentTool === "bucket") {
                    pushHistory();
                    bucketFill(r, c);
                    renderGrid();
                    updateExport();
                } else if (currentTool === "select") {
                    if (!selectionStart) {
                        // start a drag selection
                        selectionStart = { r, c, ctrl: e.ctrlKey || e.metaKey };
                        isSelectingDrag = true;
                    }
                }
            };

            cell.onmouseenter = () => {
                if (isMouseDown && isPainting && currentTool === "brush") {
                    paintCell(true);
                }
            };

            canvas.appendChild(cell);
        }
    }
    
    // Update canvas transform after grid is rendered to ensure proper sizing
    setTimeout(() => updateCanvasTransform(), 10);
}

// --- EXPORT ---
function updateExport() {
    // Build text export: only output codes for painted cells
    let outRows = grid.map(row => row.map(item => item ? item.char : "").join(""));

    // If all rows are empty strings, make export truly empty
    let hasContent = outRows.some(r => r.length > 0);
    let out = hasContent ? outRows.join("\n") : "";

    if (exportLabel) {
        out = out ? (exportLabel + "\n" + out) : exportLabel;
    }

    const exportBox = document.getElementById("exportBox");
    if (exportBox) {
        lastExportText = out;

        // Build colored lines: label (if any) plus one line per grid row
        exportBox.innerHTML = "";

        const addLine = (text, color) => {
            const span = document.createElement("span");
            span.textContent = text;
            if (color) span.style.color = color;
            exportBox.appendChild(span);
            exportBox.appendChild(document.createTextNode("\n"));
        };

        if (exportLabel) {
            addLine(exportLabel, getBandColor(0));
        }

        grid.forEach((row, r) => {
            const line = row.map(item => item ? item.char : "").join("");
            const partIndex = Math.floor(r / rowsPerPart);
            const localIndex = r % rowsPerPart;
            const baseColor = getBandColor(partIndex);
            const halfRowsCount = Math.max(1, Math.floor(rowsPerPart / 2));
            const brightStart = Math.max(0, rowsPerPart - halfRowsCount);
            const color = localIndex >= brightStart ? brightenColor(baseColor) : baseColor;
            addLine(line, color);
        });
    }

    const discordPreview = document.getElementById("discordPreview");
    if (discordPreview) {
        // Keep bottom panel visually present but do not duplicate the export text.
        discordPreview.textContent = "";
    }

    // Build chunks by rows: groups of up to 8 grid rows, plus half-chunks (bottom N rows of each part)
    exportChunks = [];
    exportHalfChunks = [];
    if (out && out.length) {
        const totalRows = grid.length;
        for (let start = 0, part = 0; start < totalRows; start += rowsPerPart, part++) {
            const end = Math.min(start + rowsPerPart, totalRows);

            const rowsInPart = [];
            for (let r = start; r < end; r++) {
                rowsInPart.push(grid[r].map(item => (item ? item.char : "")).join(""));
            }

            // full part (Copy 1, Copy 2, ...). Part 1 includes label if present.
            const fullLines = [];
            if (part === 0 && exportLabel) fullLines.push(exportLabel);
            fullLines.push(...rowsInPart);
            exportChunks.push(fullLines.join("\n"));

            // half part (Copy 1.5, 2.5, ...): use bottom half rows of this part, no label
            if (rowsInPart.length > 1) {
                const usedRows = Math.max(1, Math.min(Math.floor(rowsPerPart / 2), rowsInPart.length));
                const halfStartIndex = rowsInPart.length - usedRows;
                const halfRows = rowsInPart.slice(halfStartIndex);
                exportHalfChunks.push(halfRows.join("\n"));
            } else {
                exportHalfChunks.push("");
            }
        }
    }

    const legend = document.getElementById("partLegend");
    if (legend) {
        legend.innerHTML = "";
        if (exportChunks.length) {
            const totalRows = grid.length;
            exportChunks.forEach((_, i) => {
                const wrapper = document.createElement("div");
                const rowsInPart = Math.min(rowsPerPart, totalRows - i * rowsPerPart);
                wrapper.style.height = (rowsInPart * 24) + "px";
                wrapper.style.display = "flex";
                wrapper.style.flexDirection = "column";
                wrapper.style.justifyContent = "space-between";

                const fullSpan = document.createElement("span");
                fullSpan.textContent = `Part ${i + 1}`;
                fullSpan.style.color = getBandColor(i);
                wrapper.appendChild(fullSpan);

                const half = exportHalfChunks[i];
                if (half && half.length) {
                    const halfSpan = document.createElement("span");
                    halfSpan.textContent = `${i + 1}.5`; // label for half-part
                    halfSpan.style.color = brightenColor(getBandColor(i));
                    wrapper.appendChild(halfSpan);
                }

                legend.appendChild(wrapper);
            });
        }
    }

    const splitButtons = document.getElementById("splitButtons");
    if (splitButtons) {
        splitButtons.innerHTML = "";
        if (exportChunks.length) {
            exportChunks.forEach((_, i) => {
                const fullBtn = document.createElement("button");
                fullBtn.textContent = `Copy ${i + 1}`;
                fullBtn.style.color = getBandColor(i);
                fullBtn.onclick = () => copyExportChunk(i);
                splitButtons.appendChild(fullBtn);

                const half = exportHalfChunks[i];
                if (half && half.length) {
                    const halfBtn = document.createElement("button");
                    halfBtn.textContent = `Copy ${i + 1}.5`;
                    halfBtn.style.color = brightenColor(getBandColor(i));
                    halfBtn.onclick = () => copyExportHalfChunk(i);
                    splitButtons.appendChild(halfBtn);
                }
            });
        }
    }

    const preview = document.getElementById("exportPreview");
    const bandsContainer = document.getElementById("previewBands");
    if (!preview || !bandsContainer) return;

    preview.innerHTML = "";
    bandsContainer.innerHTML = "";

    let currentPart = 0;

    for (let r = 0; r < rows; r++) {
        const rowDiv = document.createElement("div");
        rowDiv.className = "export-row";

        for (let c = 0; c < cols; c++) {
            const item = grid[r][c];
            const cell = document.createElement("span");
            cell.className = "export-cell";

            if (item) {
                if (item.type === "unicode") {
                    cell.textContent = item.char;
                } else {
                    cell.style.backgroundImage = `url(${item.src})`;
                    cell.style.backgroundSize = "cover";
                }
            } else {
                const bg = getBackgroundItem();
                if (bg.type === "unicode") {
                    cell.textContent = bg.char;
                } else {
                    cell.style.backgroundImage = `url(${bg.src})`;
                    cell.style.backgroundSize = "cover";
                }
            }

            rowDiv.appendChild(cell);
        }

        preview.appendChild(rowDiv);

        // band color for this row in the side bar
        const bandIndex = Math.floor(r / rowsPerPart);
        const localIndex = r % rowsPerPart;
        const baseColor = getBandColor(bandIndex);
        const halfRowsCount = Math.max(1, Math.floor(rowsPerPart / 2));
        const brightStart = Math.max(0, rowsPerPart - halfRowsCount);
        const color = localIndex >= brightStart ? brightenColor(baseColor) : baseColor;
        const bandRow = document.createElement("div");
        bandRow.className = "band-row";
        bandRow.style.backgroundColor = color;
        bandsContainer.appendChild(bandRow);
    }
}

function copyExport() {
    navigator.clipboard.writeText(lastExportText || "");
}

function copyExportChunk(index) {
    if (!exportChunks || !exportChunks.length) return;
    const chunk = exportChunks[index];
    if (!chunk) return;
    navigator.clipboard.writeText(chunk);
}

function copyExportHalfChunk(index) {
    if (!exportHalfChunks || !exportHalfChunks.length) return;
    const chunk = exportHalfChunks[index];
    if (!chunk) return;
    navigator.clipboard.writeText(chunk);
}

// --- VIEW CONTROLS ---
function applyZoom(options = {}) {
    const viewport = document.getElementById("canvasViewport");
    const stack = document.getElementById("canvasStack");
    if (!viewport || !stack) return;
    
    const factor = zoomLevels[zoomIndex] || 1;
    currentZoomFactor = factor;
    
    // Reset pan when zooming – start with top aligned to viewport
    if (!options.skipCenter) {
        canvasPanX = 0;
        canvasPanY = 0;
    }
    
    updateCanvasTransform();
    clampPanOffsets();
}

function updateZoomButtonLabel() {
    const btn = document.getElementById("zoomButton");
    if (btn) {
        const factor = zoomLevels[zoomIndex] || 1;
        btn.textContent = `Zoom ${factor.toFixed(2).replace(/\.00$/, "")}x`;
    }
}

function cycleZoom() {
    zoomIndex = (zoomIndex + 1) % zoomLevels.length;
    updateZoomButtonLabel();
    applyZoom();
}

function resetView() {
    // Reset pan to center
    canvasPanX = 0;
    canvasPanY = 0;
    // Auto-fit zoom based on canvas size
    autoFitZoom();
}

function autoFitZoom() {
    // For this app, "Fit" should behave like "back to default 1x"
    const oneIndex = zoomLevels.indexOf(1);
    zoomIndex = oneIndex >= 0 ? oneIndex : 0;
    updateZoomButtonLabel();
    applyZoom();
}

function ensureSpacePanHandlers() {
    if (spacePanHandlersAttached) return;
    window.addEventListener("keydown", handleSpacePanKeyDown, true);
    window.addEventListener("keyup", handleSpacePanKeyUp, true);
    window.addEventListener("blur", resetSpacePanState, true);
    attachSpacePanViewportHandlers();
    spacePanHandlersAttached = true;
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
    spacePanViewport = viewport;
}

function handleCanvasWheel(event) {
    event.preventDefault();
    
    // Ctrl+wheel = zoom
    if (event.ctrlKey) {
        if (event.deltaY > 0) {
            // Scroll down = zoom out
            if (zoomIndex < zoomLevels.length - 1) {
                zoomIndex++;
                updateZoomButtonLabel();
                applyZoom({ skipCenter: true });
            }
        } else if (event.deltaY < 0) {
            // Scroll up = zoom in
            if (zoomIndex > 0) {
                zoomIndex--;
                updateZoomButtonLabel();
                applyZoom({ skipCenter: true });
            }
        }
        return;
    }
    
    // Shift+wheel = horizontal pan
    if (event.shiftKey) {
        canvasPanX -= event.deltaY * 0.8;
        clampPanOffsets();
        return;
    }
    
    // Regular wheel = vertical pan
    if (event.deltaY !== 0) {
        canvasPanY -= event.deltaY * 0.8;
        clampPanOffsets();
    }
}

function shouldIgnoreSpacePanKey(target) {
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function handleSpacePanKeyDown(event) {
    if (event.code !== "Space" || event.repeat) return;
    if (shouldIgnoreSpacePanKey(event.target)) return;
    event.preventDefault();
    isSpacePanHeld = true;
    document.body?.classList.add("space-pan-mode");
    attachSpacePanViewportHandlers();
}

function handleSpacePanKeyUp(event) {
    if (event.code !== "Space") return;
    event.preventDefault();
    isSpacePanHeld = false;
    document.body?.classList.remove("space-pan-mode");
    stopSpacePanDragging();
}

function handleSpacePanPointerDown(event) {
    if (!isPanModeActive()) return;
    const viewport = spacePanViewport || event.currentTarget;
    if (!viewport) return;
    event.preventDefault();
    isSpacePanDragging = true;
    spacePanPointerId = event.pointerId;
    spacePanStart = {
        x: event.clientX,
        y: event.clientY,
        panX: canvasPanX,
        panY: canvasPanY
    };
    spacePanViewport = viewport;
    viewport.classList.add("space-pan-grabbing");
    viewport.setPointerCapture?.(event.pointerId);
}

function handleSpacePanPointerMove(event) {
    if (!isSpacePanDragging || event.pointerId !== spacePanPointerId) return;
    const viewport = spacePanViewport;
    if (!viewport || !spacePanStart) return;
    event.preventDefault();
    const dx = event.clientX - spacePanStart.x;
    const dy = event.clientY - spacePanStart.y;
    // Update pan offsets - dragging right moves canvas right (positive X)
    canvasPanX = spacePanStart.panX + dx;
    canvasPanY = spacePanStart.panY + dy;
    clampPanOffsets();
}

function handleSpacePanPointerUp(event) {
    if (!isSpacePanDragging || event.pointerId !== spacePanPointerId) return;
    stopSpacePanDragging();
}

function stopSpacePanDragging() {
    const viewport = spacePanViewport;
    if (viewport) {
        viewport.classList.remove("space-pan-grabbing");
        if (spacePanPointerId !== null && viewport.releasePointerCapture) {
            try {
                viewport.releasePointerCapture(spacePanPointerId);
            } catch (err) {
                // ignore release errors
            }
        }
    }
    isSpacePanDragging = false;
    spacePanPointerId = null;
    spacePanStart = null;
}

function resetSpacePanState() {
    if (isSpacePanHeld || isSpacePanDragging) {
        isSpacePanHeld = false;
        document.body?.classList.remove("space-pan-mode");
        stopSpacePanDragging();
    }
}

function toggleCanvasMode() {
    const next = canvasMode === "grid" ? "freeform" : "grid";
    setCanvasMode(next);
}

function setCanvasMode(mode) {
    if (mode !== "grid" && mode !== "freeform") return;
    if (canvasMode === mode) return;
    canvasMode = mode;
    updateCanvasModeUI();
}

function updateCanvasModeUI() {
    const body = document.body;
    if (body) {
        body.classList.toggle("freeform-mode", canvasMode === "freeform");
    }

    const btn = document.getElementById("modeToggleBtn");
    if (btn) {
        btn.textContent = `Mode: ${canvasMode === "freeform" ? "Freeform (Beta)" : "Grid"}`;
        btn.classList.toggle("active", canvasMode === "freeform");
    }

    ensureFreeformLayerListeners();
    updateFreeformLayer();
}

function ensureFreeformLayerListeners() {
    if (freeformLayerListenersAttached) return;
    const layer = document.getElementById("freeformLayer");
    if (!layer) return;

    layer.addEventListener("pointerdown", handleFreeformPointerDown);
    layer.addEventListener("pointermove", handleFreeformPointerMove);
    layer.addEventListener("pointerleave", handleFreeformPointerUp);
    window.addEventListener("pointerup", handleFreeformPointerUp);

    freeformLayerListenersAttached = true;
}

function handleFreeformPointerDown(evt) {
    if (canvasMode !== "freeform") return;
    const layer = document.getElementById("freeformLayer");
    if (!layer) return;

    // Handle bucket tool in freeform mode - fill canvas with stamps
    if (currentTool === "bucket") {
        evt.preventDefault();
        if (!activeBrush) return;
        pushHistory();
        freeformBucketFill();
        return;
    }

    if (currentTool !== "brush") return;

    evt.preventDefault();
    layer.setPointerCapture?.(evt.pointerId);

    if (!freeformHistoryPushed) {
        pushHistory();
        freeformHistoryPushed = true;
    }

    isFreeformPainting = true;
    lastFreeformPoint = null;
    placeFreeformStamp(evt, { force: true });
}

function freeformBucketFill() {
    if (!activeBrush) return;
    const width = cols * TILE_SIZE;
    const height = rows * TILE_SIZE;

    // Clear existing stamps and fill with grid of current brush
    freeformStamps = [];
    freeformStampId = 0;

    for (let y = 0; y < height; y += TILE_SIZE) {
        for (let x = 0; x < width; x += TILE_SIZE) {
            freeformStamps.push({
                id: ++freeformStampId,
                x: x,
                y: y,
                item: { ...activeBrush }
            });
        }
    }

    updateFreeformLayer();
}

function handleFreeformPointerMove(evt) {
    if (!isFreeformPainting || canvasMode !== "freeform") return;
    evt.preventDefault();
    placeFreeformStamp(evt);
}

function handleFreeformPointerUp(evt) {
    if (!isFreeformPainting) return;
    const layer = document.getElementById("freeformLayer");
    if (layer?.releasePointerCapture) {
        try {
            layer.releasePointerCapture(evt.pointerId);
        } catch (err) {
            // ignore release errors (pointer may not be captured)
        }
    }
    isFreeformPainting = false;
    lastFreeformPoint = null;
    freeformHistoryPushed = false;
}

function placeFreeformStamp(evt, options = {}) {
    if (!activeBrush) return;
    const layer = document.getElementById("freeformLayer");
    if (!layer) return;

    const rect = layer.getBoundingClientRect();
    const point = {
        x: (evt.clientX - rect.left) / currentZoomFactor,
        y: (evt.clientY - rect.top) / currentZoomFactor
    };

    if (!options.force && lastFreeformPoint) {
        const dx = point.x - lastFreeformPoint.x;
        const dy = point.y - lastFreeformPoint.y;
        if (Math.hypot(dx, dy) < FREEFORM_DISTANCE_THRESHOLD) {
            return;
        }
    }

    lastFreeformPoint = point;

    const width = cols * TILE_SIZE;
    const height = rows * TILE_SIZE;
    const half = TILE_SIZE / 2;
    const centerX = point.x - half;
    const centerY = point.y - half;

    // Get brush offsets for current brush size
    const offsets = getBrushOffsets(currentBrushSizeIndex);
    
    for (const offset of offsets) {
        const stampX = clamp(centerX + offset.x, -TILE_SIZE, width);
        const stampY = clamp(centerY + offset.y, -TILE_SIZE, height);

        const stamp = {
            id: ++freeformStampId,
            x: stampX,
            y: stampY,
            item: { ...activeBrush }
        };
        freeformStamps.push(stamp);

        // Mirror stamp if enabled
        if (mirrorEnabled) {
            const mirroredX = width - stampX - TILE_SIZE;
            if (Math.abs(mirroredX - stampX) > 1) {
                const mirrorStamp = {
                    id: ++freeformStampId,
                    x: mirroredX,
                    y: stampY,
                    item: { ...activeBrush }
                };
                freeformStamps.push(mirrorStamp);
            }
        }
    }

    updateFreeformLayer();
}

function updateFreeformLayer() {
    const layer = document.getElementById("freeformLayer");
    if (!layer) return;
    const width = cols * TILE_SIZE;
    const height = rows * TILE_SIZE;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.innerHTML = "";

    if (canvasMode !== "freeform") {
        return;
    }

    for (const stamp of freeformStamps) {
        const node = document.createElement("div");
        node.className = "freeform-stamp";
        node.style.left = `${stamp.x}px`;
        node.style.top = `${stamp.y}px`;

        if (stamp.item.type === "unicode") {
            node.textContent = stamp.item.char || "";
            node.style.backgroundImage = "";
            node.style.backgroundColor = stamp.item.color || "transparent";
        } else if (stamp.item.type === "img" && stamp.item.src) {
            node.textContent = "";
            node.style.backgroundImage = `url(${stamp.item.src})`;
        } else if (stamp.item.color) {
            node.textContent = "";
            node.style.backgroundImage = "";
            node.style.backgroundColor = stamp.item.color;
        }

        layer.appendChild(node);
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toggleSidePanel(which, hide) {
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

// --- SAVE PNG ---
async function savePng() {
    if (!rows || !cols) return;
    setSavingOverlay(true);
    updateSavingOverlayStatus("Preparing PNG…", "");

    const tileSize = 40;
    const off = document.createElement("canvas");
    off.width = cols * tileSize;
    off.height = rows * tileSize;
    const ctx = off.getContext("2d");
    if (!ctx) {
        setSavingOverlay(false);
        alert("Unable to create PNG context.");
        return;
    }

    try {
        const bg = getBackgroundItem();
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, off.width, off.height);

        const imageCache = new Map();
        const loadPromises = [];
        let pendingImages = 0;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const item = grid[r][c];
                if (!item || itemsEqual(item, bg)) continue;
                if (item.type === "img" && !imageCache.has(item.src)) {
                    pendingImages++;
                    const img = new Image();
                    applyCrossOriginIfNeeded(img, item.src);
                    imageCache.set(item.src, img);
                    loadPromises.push(new Promise((resolve) => {
                        img.onload = () => {
                            updateSavingOverlayStatus(
                                "Loading sprites…",
                                `${imageCache.size}/${pendingImages}`
                            );
                            resolve();
                        };
                        img.onerror = () => resolve();
                    }));
                    img.src = item.src;
                }
            }
        }

        if (loadPromises.length) {
            updateSavingOverlayStatus("Loading sprites…", `0/${pendingImages}`);
            await Promise.all(loadPromises);
        }

        updateSavingOverlayStatus("Drawing PNG…", "0%");
        const totalCells = rows * cols;
        const progressInterval = Math.max(1, Math.floor(totalCells / 20));
        let processed = 0;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const item = grid[r][c];
                processed++;
                if (!item || itemsEqual(item, bg)) continue;
                const x = c * tileSize;
                const y = r * tileSize;

                if (item.type === "img") {
                    const img = imageCache.get(item.src);
                    if (img) {
                        ctx.drawImage(img, x, y, tileSize, tileSize);
                    }
                } else {
                    ctx.fillStyle = item.color || "#00ff00";
                    ctx.fillRect(x, y, tileSize, tileSize);
                }
            }
            if (processed % progressInterval === 0) {
                const pct = Math.round((processed / totalCells) * 100);
                updateSavingOverlayStatus("Drawing PNG…", `${pct}%`);
                await waitForAnimationFrame();
            }
        }

        updateSavingOverlayStatus("Encoding PNG…", "");
        await waitForAnimationFrame();
        const dataUrl = off.toDataURL("image/png");
        updateSavingOverlayStatus("Saving PNG…", "");

        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = "binbag.png";
        link.click();
        updateSavingOverlayStatus("PNG saved!", "");
    } catch (err) {
        console.error("PNG export failed", err);
        alert("PNG export failed. Please try again.");
    } finally {
        setTimeout(() => setSavingOverlay(false), 500);
    }
}

function renderTips() {
    const box = document.getElementById("tipsBox");
    if (!box || !tips.length) return;
    box.innerHTML = "";
    tips.forEach((tip) => {
        const div = document.createElement("div");
        div.className = "tip-item";
        div.textContent = tip;
        box.appendChild(div);
    });
}

// --- ADDING / RENAMING IMAGE EMOJIS ---
function addImageEmoji() {
    const file = document.getElementById("fileInput").files[0];
    if (!file) return;

    const codeInput = document.getElementById("imageCodeInput");
    let code = codeInput ? codeInput.value.trim() : "";
    if (!code) code = ":custom:";
    if (!code.startsWith(":")) code = ":" + code;
    if (!code.endsWith(":")) code = code + ":";

    const reader = new FileReader();
    reader.onload = () => {
        customPalette.push({
            type: "img",
            src: reader.result,
            char: code,
            category: "custom"
        });
        renderPalette();
    };
    reader.readAsDataURL(file);
}

function renameSelectedEmoji() {
    if (!activeBrush) return;
    const input = document.getElementById("renameCodeInput");
    if (!input) return;
    let code = input.value.trim();
    if (!code) return;
    if (!code.startsWith(":")) code = ":" + code;
    if (!code.endsWith(":")) code = code + ":";
    activeBrush.char = code;
    input.value = "";
    updateExport();
}

// Initialize first grid
generateGrid();
setTool("brush");
setSelectionMode("select"); // Select is default subsection
// Set :01: as default brush and add to history
const defaultBrush = [...imageDefaults, ...customPalette].find(item => item.char === ":01:");
if (defaultBrush) {
    activeBrush = defaultBrush;
    addToBrushHistory(defaultBrush);
}

ensureSpacePanHandlers();

// Initial canvas centering
setTimeout(() => clampPanOffsets(), 100);

// --- THEME TOGGLE ---
function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById("themeToggle");
    const isLight = body.classList.toggle("light-mode");
    if (btn) {
        btn.textContent = isLight ? "☀️" : "🌙";
    }
}

// --- MIRROR TOGGLE ---
function toggleMirror() {
    mirrorEnabled = !mirrorEnabled;
    const btn = document.querySelector("#toolControls button:nth-child(4)");
    if (btn) {
        btn.textContent = mirrorEnabled ? "Mirror ON" : "Mirror";
    }
}

// --- TOOLS ---
function setTool(tool) {
    currentTool = tool;
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
        if (selectionMode !== "drag") {
            setSelectionMode("select");
        } else {
            refreshPanCursorState();
        }
    }

    // When leaving Select tool, clear any active selection so it only works in Select mode
    if (tool !== "select") {
        if (selectionMode === "drag") {
            setSelectionMode("select");
        }
        if (selection && selection.length) {
            selection = [];
            renderGrid();
        }
    }
}

function itemsEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.char !== b.char) return false;
    if (a.src !== b.src) return false;
    return true;
}

function bucketFill(startR, startC) {
    if (!activeBrush) return;
    const target = grid[startR]?.[startC];
    if (itemsEqual(target, activeBrush)) return;

    const replacement = activeBrush;
    const stack = [[startR, startC]];
    while (stack.length) {
        const [r, c] = stack.pop();
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        if (!itemsEqual(grid[r][c], target)) continue;
        grid[r][c] = replacement;
        stack.push([r + 1, c]);
        stack.push([r - 1, c]);
        stack.push([r, c + 1]);
        stack.push([r, c - 1]);
    }
}

function createSelection(r1, c1, r2, c2) {
    const top = Math.min(r1, r2);
    const left = Math.min(c1, c2);
    const bottom = Math.max(r1, r2);
    const right = Math.max(c1, c2);

    const data = [];
    for (let r = top; r <= bottom; r++) {
        const row = [];
        for (let c = left; c <= right; c++) {
            row.push(grid[r][c]);
        }
        data.push(row);
    }

    selection = { top, left, bottom, right, data };
}

function moveSelectionTo(destR, destC) {
    if (!selection) return;
    const height = selection.bottom - selection.top + 1;
    const width = selection.right - selection.left + 1;

    if (destR + height > rows || destC + width > cols) return;

    pushHistory();
    const bg = getBackgroundItem();

    // clear old area
    for (let r = selection.top; r <= selection.bottom; r++) {
        for (let c = selection.left; c <= selection.right; c++) {
            grid[r][c] = bg;
        }
    }

    // write to new area
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            grid[destR + i][destC + j] = selection.data[i][j];
        }
    }

    selection.top = destR;
    selection.left = destC;
    selection.bottom = destR + height - 1;
    selection.right = destC + width - 1;

    renderGrid();
    updateExport();
}

function setSelectionMode(mode) {
    selectionMode = mode;

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
    if (mode === "delete" && selection && selection.length) {
        pushHistory();
        const bg = getBackgroundItem();
        for (const rect of selection) {
            for (let rr = rect.top; rr <= rect.bottom; rr++) {
                for (let cc = rect.left; cc <= rect.right; cc++) {
                    grid[rr][cc] = bg;
                }
            }
        }
        selection = [];
        renderGrid();
        updateExport();
        // Reset to select mode after delete
        setSelectionMode("select");
    }
}
// --- RANDOM CAT / DOG ---
function randomCat() {
    if (!rows || !cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid[r][c] = bg;
        }
    }

    const choices = palette.slice();
    const body = choices[Math.floor(Math.random() * choices.length)];
    const ear = choices[Math.floor(Math.random() * choices.length)] || body;
    const eye = choices[Math.floor(Math.random() * choices.length)] || body;
    const nose = choices[Math.floor(Math.random() * choices.length)] || eye;

    const marginR = Math.max(1, Math.floor(rows * 0.15));
    const marginC = Math.max(1, Math.floor(cols * 0.15));
    const top = marginR;
    const bottom = rows - 1 - marginR;
    const left = marginC;
    const right = cols - 1 - marginC;

    for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
            grid[r][c] = body;
        }
    }

    const midRow = Math.floor((top + bottom) / 2);
    const eyeRow = midRow - 1;
    const midCol = Math.floor((left + right) / 2);
    const eyeOffset = Math.max(1, Math.floor((right - left) / 4));

    // ears: variant between pointy and blocky
    const earVariant = Math.floor(Math.random() * 2);
    if (earVariant === 0 && top - 1 >= 0) {
        // small pointy ears
        if (grid[top - 1]) {
            if (grid[top - 1][left] !== undefined) grid[top - 1][left] = ear;
            if (grid[top - 1][right] !== undefined) grid[top - 1][right] = ear;
        }
    } else {
        // block ears on corners of head
        if (grid[top]) {
            if (grid[top][left] !== undefined) grid[top][left] = ear;
            if (grid[top][right] !== undefined) grid[top][right] = ear;
        }
    }

    // eyes
    if (grid[eyeRow]) {
        const leftEyeCol = Math.max(left + 1, midCol - eyeOffset);
        const rightEyeCol = Math.min(right - 1, midCol + eyeOffset);
        if (grid[eyeRow][leftEyeCol] !== undefined) grid[eyeRow][leftEyeCol] = eye;
        if (grid[eyeRow][rightEyeCol] !== undefined) grid[eyeRow][rightEyeCol] = eye;
    }

    // nose / mouth
    const noseRow = Math.min(bottom - 1, midRow + 1);
    if (grid[noseRow]) {
        if (grid[noseRow][midCol] !== undefined) grid[noseRow][midCol] = nose;
        // optional whiskers
        if (Math.random() < 0.7) {
            if (grid[noseRow][midCol - 1] !== undefined) grid[noseRow][midCol - 1] = nose;
            if (grid[noseRow][midCol + 1] !== undefined) grid[noseRow][midCol + 1] = nose;
        }
    }

    renderGrid();
    updateExport();
}

function randomDog() {
    if (!rows || !cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            grid[r][c] = bg;
        }
    }

    const choices = palette.slice();
    const body = choices[Math.floor(Math.random() * choices.length)];
    const ear = choices[Math.floor(Math.random() * choices.length)] || body;
    const eye = choices[Math.floor(Math.random() * choices.length)] || body;
    const snout = choices[Math.floor(Math.random() * choices.length)] || body;

    const marginR = Math.max(1, Math.floor(rows * 0.15));
    const marginC = Math.max(1, Math.floor(cols * 0.15));
    const top = marginR;
    const bottom = rows - 1 - marginR;
    const left = marginC;
    const right = cols - 1 - marginC;

    for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
            grid[r][c] = body;
        }
    }

    const midRow = Math.floor((top + bottom) / 2);
    const eyeRow = midRow - 1;
    const midCol = Math.floor((left + right) / 2);
    const eyeOffset = Math.max(1, Math.floor((right - left) / 4));

    // floppy or upright ears
    const earVariant = Math.floor(Math.random() * 2);
    if (earVariant === 0 && top - 1 >= 0) {
        if (grid[top - 1]) {
            if (grid[top - 1][left] !== undefined) grid[top - 1][left] = ear;
            if (grid[top - 1][right] !== undefined) grid[top - 1][right] = ear;
        }
    } else {
        if (grid[top]) {
            if (grid[top][left] !== undefined) grid[top][left] = ear;
            if (grid[top][right] !== undefined) grid[top][right] = ear;
        }
    }

    // eyes
    if (grid[eyeRow]) {
        const leftEyeCol = Math.max(left + 1, midCol - eyeOffset);
        const rightEyeCol = Math.min(right - 1, midCol + eyeOffset);
        if (grid[eyeRow][leftEyeCol] !== undefined) grid[eyeRow][leftEyeCol] = eye;
        if (grid[eyeRow][rightEyeCol] !== undefined) grid[eyeRow][rightEyeCol] = eye;
    }

    // snout sticking out
    const snoutRow = Math.min(bottom - 1, midRow + 1);
    if (grid[snoutRow]) {
        if (grid[snoutRow][midCol] !== undefined) grid[snoutRow][midCol] = snout;
        if (Math.random() < 0.6 && grid[snoutRow][midCol + 1] !== undefined) {
            grid[snoutRow][midCol + 1] = snout;
        }
    }

    renderGrid();
    updateExport();
}

// --- ANIMATION SYSTEM ---
let animateMode = false;
let frames = []; // array of grid snapshots
let currentFrame = 0;
const MAX_FRAMES = Infinity; // Allow infinite frames
let isPlaying = false;
let playbackInterval = null;

function toggleAnimateMode() {
    animateMode = !animateMode;
    const btn = document.getElementById("animateToggle");
    const animControls = document.getElementById("animationControls");
    const saveGifBtn = document.getElementById("saveGifBtn");
    
    if (btn) {
        btn.textContent = animateMode ? "Animate: On" : "Animate: Off";
        if (animateMode) {
            btn.classList.add("tool-active");
        } else {
            btn.classList.remove("tool-active");
        }
    }
    
    if (animControls) {
        animControls.style.display = animateMode ? "flex" : "none";
    }
    
    if (saveGifBtn) {
        saveGifBtn.style.display = animateMode ? "inline-block" : "none";
    }
    
    if (animateMode) {
        // Initialize frames with current grid if empty
        if (frames.length === 0) {
            frames.push(cloneGrid(grid));
        }
        currentFrame = 0;
        updateFrameDisplay();
    }
}

function updateFrameDisplay() {
    const display = document.getElementById("frameDisplay");
    if (display) {
        display.textContent = `${currentFrame + 1} / ${frames.length}`;
    }
}

function saveCurrentFrame() {
    if (frames.length > currentFrame) {
        frames[currentFrame] = cloneGrid(grid);
    }
}

function loadFrame(index) {
    if (index < 0 || index >= frames.length) return;
    currentFrame = index;
    grid = cloneGrid(frames[currentFrame]);
    renderGrid();
    updateExport();
    updateFrameDisplay();
}

function prevFrame() {
    if (!animateMode) return;
    saveCurrentFrame();
    if (currentFrame > 0) {
        loadFrame(currentFrame - 1);
    }
}

function nextFrame() {
    if (!animateMode) return;
    saveCurrentFrame();
    if (currentFrame < frames.length - 1) {
        loadFrame(currentFrame + 1);
    }
}

function addFrame() {
    if (!animateMode) return;
    if (frames.length >= MAX_FRAMES) {
        alert(`Maximum ${MAX_FRAMES} frames allowed`);
        return;
    }
    saveCurrentFrame();
    // Add new blank frame after current
    const bg = getBackgroundItem();
    const newGrid = Array.from({ length: rows }, () => Array(cols).fill(bg));
    frames.splice(currentFrame + 1, 0, newGrid);
    loadFrame(currentFrame + 1);
}

function deleteFrame() {
    if (!animateMode) return;
    if (frames.length <= 1) {
        alert("Cannot delete the only frame");
        return;
    }
    frames.splice(currentFrame, 1);
    if (currentFrame >= frames.length) {
        currentFrame = frames.length - 1;
    }
    loadFrame(currentFrame);
}

function duplicateFrame() {
    if (!animateMode) return;
    if (frames.length >= MAX_FRAMES) {
        alert(`Maximum ${MAX_FRAMES} frames allowed`);
        return;
    }
    saveCurrentFrame();
    const copy = cloneGrid(frames[currentFrame]);
    frames.splice(currentFrame + 1, 0, copy);
    loadFrame(currentFrame + 1);
}

function togglePlayStop() {
    if (!animateMode || frames.length === 0) return;
    
    isPlaying = !isPlaying;
    const btn = document.getElementById("playStopBtn");
    
    if (btn) {
        btn.textContent = isPlaying ? "Stop" : "Play";
    }
    
    if (isPlaying) {
        // Save the current frame before starting playback
        saveCurrentFrame();
        // Start playback
        playbackInterval = setInterval(() => {
            currentFrame = (currentFrame + 1) % frames.length;
            loadFrame(currentFrame);
        }, 100); // 100ms per frame = 10 FPS
    } else {
        // Stop playback
        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }
        // Save the current frame when stopping to preserve any changes
        saveCurrentFrame();
    }
}

// --- GIF EXPORT ---
async function saveGif() {
    if (!animateMode || frames.length === 0) {
        alert("Enable Animate mode and create frames first");
        return;
    }
    
    // Save current frame to ensure it's included
    saveCurrentFrame();
    
    const tileSize = 40; // Match main canvas tile size
    const width = cols * tileSize;
    const height = rows * tileSize;
    
    setSavingOverlay(true);
    updateSavingOverlayStatus("Preparing GIF…", "");

    try {
        await ensureGifJs();
        updateSavingOverlayStatus("Gathering sprites…", "");

        const bg = getBackgroundItem();
        const imageCache = new Map();
        
        // Collect all image sources from all frames
        const allImages = new Set();
        for (const frame of frames) {
            for (const row of frame) {
                for (const item of row) {
                    if (!item || itemsEqual(item, bg)) continue;
                    if (item.src) {
                        allImages.add(item.src);
                    }
                }
            }
        }
        
        // Preload all images
        const totalImages = Math.max(1, allImages.size);
        let loadedImages = 0;
        await Promise.all([...allImages].map(src => {
            return new Promise(resolve => {
                if (imageCache.has(src)) {
                    loadedImages++;
                    updateSavingOverlayStatus("Loading sprites…", `${loadedImages}/${totalImages}`);
                    resolve();
                    return;
                }
                const img = new Image();
                applyCrossOriginIfNeeded(img, src);
                img.onload = () => {
                    imageCache.set(src, img);
                    loadedImages++;
                    updateSavingOverlayStatus("Loading sprites…", `${loadedImages}/${totalImages}`);
                    resolve();
                };
                img.onerror = () => {
                    loadedImages++;
                    updateSavingOverlayStatus("Loading sprites…", `${loadedImages}/${totalImages}`);
                    resolve();
                };
                img.src = src;
            });
        }));
        if (allImages.size === 0) {
            updateSavingOverlayStatus("Drawing frames…", "");
        }
        
        // Create canvases for each frame
        const frameCanvases = [];
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
            const frameData = frames[frameIndex];
            updateSavingOverlayStatus(`Painting frame ${frameIndex + 1}/${frames.length}`, "");
            await waitForAnimationFrame();
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, width, height);
            
            ctx.font = `${tileSize}px monospace`;
            ctx.textBaseline = "top";
            
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const item = frameData[r]?.[c];
                    if (!item || itemsEqual(item, bg)) continue;
                    
                    const x = c * tileSize;
                    const y = r * tileSize;

                    if (item.type === "img" && item.src && imageCache.has(item.src)) {
                        ctx.drawImage(imageCache.get(item.src), x, y, tileSize, tileSize);
                    } else {
                        // Draw all other tiles as colored squares
                        ctx.fillStyle = item.color || "#ffffff";
                        ctx.fillRect(x, y, tileSize, tileSize);
                    }
                }
            }
            frameCanvases.push(canvas);
        }
        
        if (!window.__gifWorkerURL) {
            throw new Error("GIF worker script unavailable");
        }

        // Use gif.js for encoding
        const gif = new GIF({
            workers: 2,
            quality: 10,
            width,
            height,
            workerScript: window.__gifWorkerURL
        });

        for (const canvas of frameCanvases) {
            gif.addFrame(canvas.getContext("2d"), { delay: 100 });
        }

        updateSavingOverlayStatus("Encoding GIF…", "0%");
        gif.on("progress", (value) => {
            const pct = Math.round((value || 0) * 100);
            updateSavingOverlayStatus("Encoding GIF…", `${pct}%`);
        });

        gif.on("finished", function(blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "binbag-animation.gif";
            link.click();
            URL.revokeObjectURL(url);
            setSavingOverlay(false);
            updateSavingOverlayStatus("Done!", "");
        });

        gif.on("abort", () => {
            console.error("gif.js render aborted");
            setSavingOverlay(false);
            alert("GIF export aborted. Please try again.");
        });

        gif.render();
        
    } catch (err) {
        console.error("GIF export failed:", err);
        setSavingOverlay(false);
        alert(`GIF export failed: ${err.message}\n\nExporting current frame as PNG instead.`);
        savePng();
    }
}

const GIF_JS_SOURCES = [
    "assets/gif.js",
    "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js",
    "https://unpkg.com/gif.js@0.2.0/dist/gif.js"
];
const GIF_WORKER_SOURCES = [
    "assets/gif.worker.js",
    "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js",
    "https://unpkg.com/gif.js@0.2.0/dist/gif.worker.js"
];
let gifJsPromise = null;

async function ensureGifJs() {
    if (typeof GIF !== "undefined" && window.__gifWorkerURL) {
        return;
    }
    if (!gifJsPromise) {
        gifJsPromise = loadGifJs();
    }
    await gifJsPromise;
    if (!window.__gifWorkerURL) {
        window.__gifWorkerURL = await loadGifWorkerBlob();
    }
}

function loadGifJs() {
    return new Promise((resolve, reject) => {
        const tryNext = (index) => {
            if (index >= GIF_JS_SOURCES.length) {
                reject(new Error("Failed to load gif.js from all sources"));
                return;
            }
            const script = document.createElement("script");
            script.src = GIF_JS_SOURCES[index];
            script.onload = () => resolve();
            script.onerror = () => {
                script.remove();
                tryNext(index + 1);
            };
            document.head.appendChild(script);
        };
        tryNext(0);
    });
}

async function loadGifWorkerBlob() {
    for (const src of GIF_WORKER_SOURCES) {
        try {
            const response = await fetch(src);
            if (!response.ok) continue;
            const code = await response.text();
            const blob = new Blob([code], { type: "application/javascript" });
            return URL.createObjectURL(blob);
        } catch (err) {
            console.warn("Failed to fetch gif.js worker script from", src, err);
        }
    }
    throw new Error("Unable to load gif.js worker script");
}

function setSavingOverlay(show) {
    const overlay = document.getElementById("savingOverlay");
    const statusText = document.getElementById("savingStatusText");
    const subtext = document.getElementById("savingSubtext");
    if (!overlay) return;
    if (show) {
        overlay.classList.add("active");
    } else {
        overlay.classList.remove("active");
    }
    if (statusText && show === true) {
        statusText.textContent = "Preparing…";
    }
    if (subtext && show === true) {
        subtext.textContent = "";
    }
}

function updateSavingOverlayStatus(primary, secondary = "") {
    const statusText = document.getElementById("savingStatusText");
    const subtext = document.getElementById("savingSubtext");
    if (statusText && primary) statusText.textContent = primary;
    if (subtext) subtext.textContent = secondary || "";
}

// Simple GIF Encoder (based on NeuQuant algorithm)
class SimpleGIFEncoder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.transparent = null;
        this.repeat = -1;
        this.delay = 0;
        this.started = false;
        this.out = new ByteArray();
        this.image = null;
        this.pixels = null;
        this.indexedPixels = null;
        this.colorDepth = null;
        this.colorTab = null;
        this.usedEntry = [];
        this.palSize = 7;
        this.dispose = -1;
        this.firstFrame = true;
        this.sample = 10;
    }
    
    setDelay(ms) { this.delay = Math.round(ms / 10); }
    setRepeat(iter) { this.repeat = iter; }
    setTransparent(c) { this.transparent = c; }
    
    start() {
        this.out = new ByteArray();
        this.out.writeUTFBytes("GIF89a");
        this.started = true;
    }
    
    addFrame(ctx) {
        if (!this.started) this.start();
        
        this.image = ctx.getImageData(0, 0, this.width, this.height).data;
        this.getImagePixels();
        this.analyzePixels();
        
        if (this.firstFrame) {
            this.writeLSD();
            this.writePalette();
            if (this.repeat >= 0) {
                this.writeNetscapeExt();
            }
        }
        
        this.writeGraphicCtrlExt();
        this.writeImageDesc();
        if (!this.firstFrame) this.writePalette();
        this.writePixels();
        this.firstFrame = false;
    }
    
    finish() {
        if (!this.started) return;
        this.started = false;
        this.out.writeByte(0x3b);
    }
    
    stream() { return this.out; }
    
    getImagePixels() {
        const w = this.width;
        const h = this.height;
        this.pixels = [];
        const data = this.image;
        let count = 0;
        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) {
                const b = i * w * 4 + j * 4;
                this.pixels[count++] = data[b];
                this.pixels[count++] = data[b + 1];
                this.pixels[count++] = data[b + 2];
            }
        }
    }
    
    analyzePixels() {
        const len = this.pixels.length;
        const nPix = len / 3;
        this.indexedPixels = [];
        
        // Build simple color table (256 colors max)
        const colorMap = new Map();
        const colors = [];
        
        for (let i = 0; i < nPix; i++) {
            const r = this.pixels[i * 3];
            const g = this.pixels[i * 3 + 1];
            const b = this.pixels[i * 3 + 2];
            const key = (r << 16) | (g << 8) | b;
            
            if (!colorMap.has(key) && colors.length < 256) {
                colorMap.set(key, colors.length);
                colors.push([r, g, b]);
            }
        }
        
        // Pad to power of 2
        while (colors.length < 256) {
            colors.push([0, 0, 0]);
        }
        
        this.colorTab = [];
        for (const [r, g, b] of colors) {
            this.colorTab.push(r, g, b);
        }
        
        // Map pixels to indices
        for (let i = 0; i < nPix; i++) {
            const r = this.pixels[i * 3];
            const g = this.pixels[i * 3 + 1];
            const b = this.pixels[i * 3 + 2];
            const key = (r << 16) | (g << 8) | b;
            this.indexedPixels[i] = colorMap.get(key) || 0;
        }
        
        this.colorDepth = 8;
        this.palSize = 7;
    }
    
    writeLSD() {
        this.out.writeShort(this.width);
        this.out.writeShort(this.height);
        this.out.writeByte(0x80 | this.palSize);
        this.out.writeByte(0);
        this.out.writeByte(0);
    }
    
    writePalette() {
        this.out.writeBytes(this.colorTab);
    }
    
    writeNetscapeExt() {
        this.out.writeByte(0x21);
        this.out.writeByte(0xff);
        this.out.writeByte(11);
        this.out.writeUTFBytes("NETSCAPE2.0");
        this.out.writeByte(3);
        this.out.writeByte(1);
        this.out.writeShort(this.repeat);
        this.out.writeByte(0);
    }
    
    writeGraphicCtrlExt() {
        this.out.writeByte(0x21);
        this.out.writeByte(0xf9);
        this.out.writeByte(4);
        this.out.writeByte(0);
        this.out.writeShort(this.delay);
        this.out.writeByte(0);
        this.out.writeByte(0);
    }
    
    writeImageDesc() {
        this.out.writeByte(0x2c);
        this.out.writeShort(0);
        this.out.writeShort(0);
        this.out.writeShort(this.width);
        this.out.writeShort(this.height);
        this.out.writeByte(this.firstFrame ? 0 : 0x80 | this.palSize);
    }
    
    writePixels() {
        const enc = new LZWEncoder(this.width, this.height, this.indexedPixels, this.colorDepth);
        enc.encode(this.out);
    }
}

class ByteArray {
    constructor() { this.data = []; }
    getData() { return new Uint8Array(this.data); }
    writeByte(val) { this.data.push(val & 0xff); }
    writeShort(val) { this.writeByte(val & 0xff); this.writeByte((val >> 8) & 0xff); }
    writeBytes(arr) { for (let i = 0; i < arr.length; i++) this.writeByte(arr[i]); }
    writeUTFBytes(str) { for (let i = 0; i < str.length; i++) this.writeByte(str.charCodeAt(i)); }
}

class LZWEncoder {
    constructor(width, height, pixels, colorDepth) {
        this.width = width;
        this.height = height;
        this.pixels = pixels;
        this.initCodeSize = Math.max(2, colorDepth);
    }
    
    encode(outs) {
        outs.writeByte(this.initCodeSize);
        
        const clearCode = 1 << this.initCodeSize;
        const eoiCode = clearCode + 1;
        let nextCode = eoiCode + 1;
        let codeSize = this.initCodeSize + 1;
        let maxCode = (1 << codeSize) - 1;
        
        const table = new Map();
        const buffer = [];
        
        const output = (code) => {
            buffer.push(code);
        };
        
        output(clearCode);
        
        let current = this.pixels[0];
        for (let i = 1; i < this.pixels.length; i++) {
            const next = this.pixels[i];
            const combined = (current << 12) | next;
            
            if (table.has(combined)) {
                current = table.get(combined);
            } else {
                output(current);
                if (nextCode < 4096) {
                    table.set(combined, nextCode++);
                    if (nextCode > maxCode && codeSize < 12) {
                        codeSize++;
                        maxCode = (1 << codeSize) - 1;
                    }
                }
                current = next;
            }
        }
        output(current);
        output(eoiCode);
        
        // Pack bits into bytes
        let bitBuffer = 0;
        let bitCount = 0;
        const bytes = [];
        
        for (const code of buffer) {
            bitBuffer |= code << bitCount;
            bitCount += codeSize;
            while (bitCount >= 8) {
                bytes.push(bitBuffer & 0xff);
                bitBuffer >>= 8;
                bitCount -= 8;
            }
        }
        if (bitCount > 0) bytes.push(bitBuffer & 0xff);
        
        // Write sub-blocks
        let pos = 0;
        while (pos < bytes.length) {
            const chunk = Math.min(255, bytes.length - pos);
            outs.writeByte(chunk);
            for (let i = 0; i < chunk; i++) {
                outs.writeByte(bytes[pos++]);
            }
        }
        outs.writeByte(0);
    }
}

// --- GIF IMPORT ---
async function importGifFile(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const gifFrames = await parseGifFrames(arrayBuffer);
        
        if (!gifFrames.length) {
            alert("Could not parse GIF frames");
            return;
        }
        
        const wasPlaying = isPlaying;
        if (isPlaying) {
            togglePlayStop();
        }

        // Ensure animate mode
        const activateAnimate = !animateMode;
        if (activateAnimate) {
            toggleAnimateMode();
        }
        
        // Replace frames with imported data
        frames = [];
        
        const paletteEntries = getAllPaletteEntries();
        await ensurePaletteColors(paletteEntries);
        const paletteColors = paletteEntries
            .map(entry => ({
                entry,
                color: paletteColorCache.get(getPaletteCacheKey(entry))
            }))
            .filter(item => item.color);
        
        const bgItem = getBackgroundItem();
        const targetRows = rows || 4;
        const targetCols = cols || 7;
        const resizeCanvas = document.createElement("canvas");
        resizeCanvas.width = targetCols;
        resizeCanvas.height = targetRows;
        const resizeCtx = resizeCanvas.getContext("2d");
        resizeCtx.imageSmoothingEnabled = true;
        resizeCtx.imageSmoothingQuality = "high";
        
        for (const frameCanvas of gifFrames) {
            resizeCtx.clearRect(0, 0, targetCols, targetRows);
            resizeCtx.drawImage(frameCanvas, 0, 0, targetCols, targetRows);
            const imageData = resizeCtx.getImageData(0, 0, targetCols, targetRows).data;
            const newGrid = gridFromImageData(imageData, targetRows, targetCols, paletteColors, bgItem);
            frames.push(newGrid);
            if (frames.length >= MAX_FRAMES) break;
        }
        
        currentFrame = 0;
        loadFrame(0);
        updateFrameDisplay();
        
        if (!activateAnimate && frames.length > 0) {
            updateFrameDisplay();
        }

        if (wasPlaying) {
            togglePlayStop();
        }

    } catch (err) {
        console.error("GIF import failed:", err);
        alert("Failed to import GIF. Try importing as a regular image instead.");
    }
}

async function parseGifFrames(arrayBuffer) {
    // Try ImageDecoder first (best fidelity)
    const decodedFrames = await decodeGifWithImageDecoder(arrayBuffer);
    if (decodedFrames && decodedFrames.length) {
        console.log(`ImageDecoder extracted ${decodedFrames.length} frames`);
        return decodedFrames;
    }

    // Fallback to omggif parser
    try {
        await ensureOmggif();
        if (typeof GifReader === "undefined") {
            console.warn("omggif not available, using fallback single-frame extraction");
            return await parseGifFramesFallback(arrayBuffer);
        }

        const bytes = new Uint8Array(arrayBuffer);
        let reader;
        try {
            reader = new GifReader(bytes);
        } catch (err) {
            console.error("Failed to parse GIF with omggif", err);
            return await parseGifFramesFallback(arrayBuffer);
        }

        const width = reader.width;
        const height = reader.height;
        const workingCanvas = document.createElement("canvas");
        workingCanvas.width = width;
        workingCanvas.height = height;
        const workingCtx = workingCanvas.getContext("2d");
        const captured = [];

        for (let index = 0; index < reader.numFrames(); index++) {
            const imageData = workingCtx.createImageData(width, height);
            reader.decodeAndBlitFrameRGBA(index, imageData.data);
            workingCtx.putImageData(imageData, 0, 0);

            const frameCanvas = document.createElement("canvas");
            frameCanvas.width = width;
            frameCanvas.height = height;
            frameCanvas.getContext("2d").drawImage(workingCanvas, 0, 0);
            captured.push(frameCanvas);
        }

        if (!captured.length) {
            console.error("No frames captured via omggif");
            return await parseGifFramesFallback(arrayBuffer);
        }

        console.log(`omggif extracted ${captured.length} frames`);
        return captured;
    } catch (err) {
        console.error("parseGifFrames failed:", err);
        return [];
    }
}

async function decodeGifWithImageDecoder(arrayBuffer) {
    if (typeof ImageDecoder === "undefined") {
        return null;
    }

    try {
        const decoder = new ImageDecoder({
            data: arrayBuffer,
            type: "image/gif"
        });

        const tracks = decoder.tracks;
        if (!tracks || tracks.length === 0) {
            decoder.close?.();
            return null;
        }

        const track = tracks[0];
        if (track.ready) {
            await track.ready;
        }

        const frameCount = track.frameCount || 0;
        if (!frameCount) {
            decoder.close?.();
            return null;
        }

        const frames = [];
        for (let i = 0; i < frameCount; i++) {
            const { image } = await decoder.decode({ frameIndex: i });
            const canvas = document.createElement("canvas");
            canvas.width = image.displayWidth || image.codedWidth;
            canvas.height = image.displayHeight || image.codedHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0);
            frames.push(canvas);
            if (typeof image.close === "function") {
                image.close();
            }
        }

        decoder.close?.();
        return frames;
    } catch (err) {
        console.warn("ImageDecoder GIF decode failed", err);
        return null;
    }
}

async function parseGifFramesFallback(arrayBuffer) {
    // Fallback: extract first frame as static image
    return new Promise((resolve) => {
        const blob = new Blob([arrayBuffer], { type: "image/gif" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            resolve([canvas]);
            URL.revokeObjectURL(url);
        };
        
        img.onerror = () => {
            console.error("Fallback image load failed");
            resolve([]);
            URL.revokeObjectURL(url);
        };
        
        img.src = url;
    });
}
