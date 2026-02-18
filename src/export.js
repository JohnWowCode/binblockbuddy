import { state, TILE_SIZE, tips } from './state.js';
import { getBackgroundItem, getBandColor, brightenColor, itemsEqual, applyCrossOriginIfNeeded, waitForAnimationFrame } from './utils.js';

// ── Export text / chunks / preview ──────────────────────────────────────────

export function updateExport() {
    // Build text export: only output codes for painted cells
    let outRows = state.grid.map(row => row.map(item => item ? item.char : "").join(""));

    // If all rows are empty strings, make export truly empty
    let hasContent = outRows.some(r => r.length > 0);
    let out = hasContent ? outRows.join("\n") : "";

    if (state.exportLabel) {
        out = out ? (state.exportLabel + "\n" + out) : state.exportLabel;
    }

    const exportBox = document.getElementById("exportBox");
    if (exportBox) {
        state.lastExportText = out;

        // Build colored lines: label (if any) plus one line per grid row
        exportBox.innerHTML = "";

        const addLine = (text, color) => {
            const span = document.createElement("span");
            span.textContent = text;
            if (color) span.style.color = color;
            exportBox.appendChild(span);
            exportBox.appendChild(document.createTextNode("\n"));
        };

        if (state.exportLabel) {
            addLine(state.exportLabel, getBandColor(0));
        }

        state.grid.forEach((row, r) => {
            const line = row.map(item => item ? item.char : "").join("");
            const partIndex = Math.floor(r / state.rowsPerPart);
            const localIndex = r % state.rowsPerPart;
            const baseColor = getBandColor(partIndex);
            const halfRowsCount = Math.max(1, Math.floor(state.rowsPerPart / 2));
            const brightStart = Math.max(0, state.rowsPerPart - halfRowsCount);
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
    state.exportChunks = [];
    state.exportHalfChunks = [];
    if (out && out.length) {
        const totalRows = state.grid.length;
        for (let start = 0, part = 0; start < totalRows; start += state.rowsPerPart, part++) {
            const end = Math.min(start + state.rowsPerPart, totalRows);

            const rowsInPart = [];
            for (let r = start; r < end; r++) {
                rowsInPart.push(state.grid[r].map(item => (item ? item.char : "")).join(""));
            }

            // full part (Copy 1, Copy 2, ...). Part 1 includes label if present.
            const fullLines = [];
            if (part === 0 && state.exportLabel) fullLines.push(state.exportLabel);
            fullLines.push(...rowsInPart);
            state.exportChunks.push(fullLines.join("\n"));

            // half part (Copy 1.5, 2.5, ...): use bottom half rows of this part, no label
            if (rowsInPart.length > 1) {
                const usedRows = Math.max(1, Math.min(Math.floor(state.rowsPerPart / 2), rowsInPart.length));
                const halfStartIndex = rowsInPart.length - usedRows;
                const halfRows = rowsInPart.slice(halfStartIndex);
                state.exportHalfChunks.push(halfRows.join("\n"));
            } else {
                state.exportHalfChunks.push("");
            }
        }
    }

    const legend = document.getElementById("partLegend");
    if (legend) {
        legend.innerHTML = "";
        if (state.exportChunks.length) {
            const totalRows = state.grid.length;
            state.exportChunks.forEach((_, i) => {
                const wrapper = document.createElement("div");
                const rowsInPart = Math.min(state.rowsPerPart, totalRows - i * state.rowsPerPart);
                wrapper.style.height = (rowsInPart * 24) + "px";
                wrapper.style.display = "flex";
                wrapper.style.flexDirection = "column";
                wrapper.style.justifyContent = "space-between";

                const fullSpan = document.createElement("span");
                fullSpan.textContent = `Part ${i + 1}`;
                fullSpan.style.color = getBandColor(i);
                wrapper.appendChild(fullSpan);

                const half = state.exportHalfChunks[i];
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
        if (state.exportChunks.length) {
            state.exportChunks.forEach((_, i) => {
                const fullBtn = document.createElement("button");
                fullBtn.textContent = `Copy ${i + 1}`;
                fullBtn.style.color = getBandColor(i);
                fullBtn.onclick = () => copyExportChunk(i);
                splitButtons.appendChild(fullBtn);

                const half = state.exportHalfChunks[i];
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

    // For very large grids (like I-Mode 100x100), building a full
    // per-cell preview is extremely expensive and mostly redundant
    // with the main canvas. Skip it to keep the app smooth.
    const totalCells = state.rows * state.cols;
    const MAX_PREVIEW_CELLS = 2500; // e.g. up to 50x50
    if (totalCells > MAX_PREVIEW_CELLS) {
        const msg = document.createElement("div");
        msg.className = "export-preview-disabled";
        msg.textContent = "Preview disabled for large grids to keep things fast.";
        preview.appendChild(msg);
        return;
    }

    let currentPart = 0;

    for (let r = 0; r < state.rows; r++) {
        const rowDiv = document.createElement("div");
        rowDiv.className = "export-row";

        for (let c = 0; c < state.cols; c++) {
            const item = state.grid[r][c];
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
        const bandIndex = Math.floor(r / state.rowsPerPart);
        const localIndex = r % state.rowsPerPart;
        const baseColor = getBandColor(bandIndex);
        const halfRowsCount = Math.max(1, Math.floor(state.rowsPerPart / 2));
        const brightStart = Math.max(0, state.rowsPerPart - halfRowsCount);
        const color = localIndex >= brightStart ? brightenColor(baseColor) : baseColor;
        const bandRow = document.createElement("div");
        bandRow.className = "band-row";
        bandRow.style.backgroundColor = color;
        bandsContainer.appendChild(bandRow);
    }
}

// ── Half-rows slider ────────────────────────────────────────────────────────

function updateHalfRowsFromUI(value) {
    const num = parseInt(value, 10);
    if (!Number.isFinite(num)) return;
    const clamped = Math.max(1, Math.min(16, num));
    state.rowsPerPart = clamped === 1 ? 2 : clamped;
    const label = document.getElementById('halfRowsLabel');
    if (label) label.textContent = String(state.rowsPerPart);
    updateExport();
}

// ── Copy helpers ────────────────────────────────────────────────────────────

export function copyExport() {
    navigator.clipboard.writeText(state.lastExportText || '');
}

function copyExportChunk(index) {
    if (!state.exportChunks || !state.exportChunks.length) return;
    const chunk = state.exportChunks[index];
    if (!chunk) return;
    navigator.clipboard.writeText(chunk);
}

function copyExportHalfChunk(index) {
    if (!state.exportHalfChunks || !state.exportHalfChunks.length) return;
    const chunk = state.exportHalfChunks[index];
    if (!chunk) return;
    navigator.clipboard.writeText(chunk);
}

// ── Saving overlay ──────────────────────────────────────────────────────────

export function setSavingOverlay(show) {
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

export function updateSavingOverlayStatus(primary, secondary = "") {
    const statusText = document.getElementById("savingStatusText");
    const subtext = document.getElementById("savingSubtext");
    if (statusText && primary) statusText.textContent = primary;
    if (subtext) subtext.textContent = secondary || "";
}

// ── PNG export ──────────────────────────────────────────────────────────────

export async function savePng() {
    if (!state.rows || !state.cols) return;
    setSavingOverlay(true);
    updateSavingOverlayStatus("Preparing PNG…", "");

    const tileSize = 40;
    const off = document.createElement("canvas");
    off.width = state.cols * tileSize;
    off.height = state.rows * tileSize;
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

        for (let r = 0; r < state.rows; r++) {
            for (let c = 0; c < state.cols; c++) {
                const item = state.grid[r][c];
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
        const totalCells = state.rows * state.cols;
        const progressInterval = Math.max(1, Math.floor(totalCells / 20));
        let processed = 0;

        for (let r = 0; r < state.rows; r++) {
            for (let c = 0; c < state.cols; c++) {
                const item = state.grid[r][c];
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

        let dataUrl;
        try {
            dataUrl = off.toDataURL("image/png");
        } catch (err) {
            console.error("PNG toDataURL failed", err);
            if (err && (err.name === "SecurityError" || String(err.message).toLowerCase().includes("tainted"))) {
                alert("PNG export failed because the canvas was tainted by a cross-origin image.\n\nImages loaded from external sites sometimes block saving. Try removing remote images or using only local / uploaded emojis, then save again.");
            } else {
                alert("PNG export failed. Please try again.");
            }
            return;
        }

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

// ── Tips ─────────────────────────────────────────────────────────────────────

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

// ── Preview dialog ──────────────────────────────────────────────────────────

export function openPreviewModal() {
    const dialog = document.getElementById("previewDialog");
    const content = document.getElementById("previewModalContent");
    const preview = document.getElementById("exportPreview");
    if (!dialog || !content || !preview) return;
    content.innerHTML = preview.innerHTML;
    if (!dialog.open) dialog.showModal();
}

export function closePreviewModal() {
    const dialog = document.getElementById("previewDialog");
    if (dialog && dialog.open) dialog.close();
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initExport() {
    // Copy All button
    document.getElementById('copyAllBtn')?.addEventListener('click', copyExport);

    // Rows-per-part slider
    document.getElementById('halfRowsSlider')?.addEventListener('input', function() {
        updateHalfRowsFromUI(this.value);
    });

    // Preview click -> open modal
    document.getElementById('previewContainer')?.addEventListener('click', openPreviewModal);

    // Close preview modal
    document.getElementById('closePreviewBtn')?.addEventListener('click', closePreviewModal);

    // Save PNG button
    document.getElementById('savePngBtn')?.addEventListener('click', savePng);

    // Render tips
    renderTips();
}
