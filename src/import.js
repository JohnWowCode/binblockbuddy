import { state } from './state.js';
import { readFileAsDataURL, loadImageSource, waitForAnimationFrame, getBackgroundItem } from './utils.js';
import { pushHistory } from './history.js';
import { getAllPaletteEntries, ensurePaletteColors, getPaletteCacheKey, findClosestPaletteEntry } from './palette.js';
import { setSavingOverlay, updateSavingOverlayStatus } from './export.js';

// ── Callback mechanism to avoid circular deps ────────────────────────────────
const callbacks = {
    renderGrid: null,
    updateExport: null,
    updateFreeformLayer: null,
};

export function setImportCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

// ── Import dialog ────────────────────────────────────────────────────────────

function openImportDialog() {
    const input = document.getElementById("importImageInput");
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

// ── omggif loader ────────────────────────────────────────────────────────────

export function ensureOmggif() {
    if (typeof GifReader !== "undefined") return Promise.resolve();
    if (!state.omggifLoadingPromise) {
        state.omggifLoadingPromise = new Promise((resolve) => {
            const script = document.createElement("script");
            // Use unpkg as primary source with jsdelivr as fallback
            script.src = "https://unpkg.com/omggif@1.0.10/omggif.js";
            script.onload = () => {
                console.log("omggif loaded successfully");
                resolve();
            };
            script.onerror = (err) => {
                console.error("Failed to load omggif from primary CDN, trying fallback", err);
                // Try fallback CDN
                const fallbackScript = document.createElement("script");
                fallbackScript.src = "https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.js";
                fallbackScript.onload = () => {
                    console.log("omggif loaded from fallback CDN");
                    resolve();
                };
                fallbackScript.onerror = () => {
                    console.error("Failed to load omggif from both CDNs");
                    resolve();
                };
                document.head.appendChild(fallbackScript);
            };
            document.head.appendChild(script);
        });
    }
    return state.omggifLoadingPromise;
}

// ── Image element cache ──────────────────────────────────────────────────────

export async function getImageElement(src) {
    if (state.imageElementCache.has(src)) {
        return state.imageElementCache.get(src);
    }
    const img = await loadImageSource(src);
    state.imageElementCache.set(src, img);
    return img;
}

// ── Image import ─────────────────────────────────────────────────────────────

export async function importImageFile(file) {
    // Show loading overlay for large images
    setSavingOverlay(true);
    updateSavingOverlayStatus("Processing image...", "");

    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImageSource(dataUrl);

    try {
        await applyImageToGrid(img);

        // For I-Mode, keep overlay visible a bit longer to mask render lag
        if (state.rows >= 50 || state.cols >= 50) {
            updateSavingOverlayStatus("Finishing up...", "");
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    } finally {
        // Always hide overlay when done
        setSavingOverlay(false);
    }
}

async function applyImageToGrid(img) {
    const paletteEntries = getAllPaletteEntries();
    if (!paletteEntries.length) return;

    await ensurePaletteColors(paletteEntries);
    const paletteColors = paletteEntries
        .map(entry => ({
            entry,
            color: state.paletteColorCache.get(getPaletteCacheKey(entry))
        }))
        .filter(item => item.color);

    // Use current grid size instead of scaling to max
    const targetRows = state.rows || 4;
    const targetCols = state.cols || 7;

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

    // Use a chunked converter for imports so large I-Mode images don't freeze the UI
    const newGrid = await gridFromImageDataForImport(imageData, targetRows, targetCols, paletteColors, bgItem);

    if (state.grid && state.grid.length) {
        pushHistory();
    }

    state.grid = newGrid;

    // Defer heavy render work to prevent mouse lag, especially in I-Mode
    updateSavingOverlayStatus("Rendering grid...", "");
    await waitForAnimationFrame();

    if (callbacks.renderGrid) callbacks.renderGrid();

    await waitForAnimationFrame();
    updateSavingOverlayStatus("Updating export...", "");
    await waitForAnimationFrame();

    if (callbacks.updateExport) callbacks.updateExport();
    if (callbacks.updateFreeformLayer) callbacks.updateFreeformLayer();
}

// Chunked version used only for image imports to keep the browser responsive on large grids
async function gridFromImageDataForImport(imageData, targetRows, targetCols, paletteColors, bgItem) {
    const newGrid = Array.from({ length: targetRows }, () => Array(targetCols).fill(bgItem));
    // Only bother chunking for larger grids (like I-Mode / G-Mode)
    const rowsPerChunk = targetRows >= 40 || targetCols >= 40 ? 1 : targetRows;

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

        if (rowsPerChunk && r % rowsPerChunk === rowsPerChunk - 1) {
            // Yield so mouse / scrolling stay responsive during big imports
            await waitForAnimationFrame();
        }
    }
    return newGrid;
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initImport() {
    document.getElementById('importBtn')?.addEventListener('click', openImportDialog);
    document.getElementById('importImageInput')?.addEventListener('change', handleImportImageChange);
}
