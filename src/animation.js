import { state, TILE_SIZE, MAX_FRAMES, GIF_JS_SOURCES, GIF_WORKER_SOURCES } from './state.js';
import { getBackgroundItem, itemsEqual, applyCrossOriginIfNeeded, waitForAnimationFrame } from './utils.js';
import { cloneGrid, cloneFreeformArray } from './history.js';
import { getAllPaletteEntries, ensurePaletteColors, getPaletteCacheKey, findClosestPaletteEntry } from './palette.js';
import { setSavingOverlay, updateSavingOverlayStatus, savePng } from './export.js';
import { ensureOmggif, importImageFile } from './import.js';

// ── Callback mechanism to avoid circular deps ────────────────────────────────

const callbacks = {
    renderGrid: null,
    updateExport: null,
    updateFreeformLayer: null,
};

export function setAnimationCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

// ── Animation state management ───────────────────────────────────────────────

export function toggleAnimateMode() {
    state.animateMode = !state.animateMode;
    const btn = document.getElementById("animateToggle");
    const animControls = document.getElementById("animationControls");
    const saveGifBtn = document.getElementById("saveGifBtn");

    if (btn) {
        btn.textContent = state.animateMode ? "Animate: On" : "Animate: Off";
        if (state.animateMode) {
            btn.classList.add("tool-active");
        } else {
            btn.classList.remove("tool-active");
        }
    }

    if (animControls) {
        animControls.style.display = state.animateMode ? "flex" : "none";
    }

    if (saveGifBtn) {
        saveGifBtn.style.display = state.animateMode ? "inline-block" : "none";
    }

    if (state.animateMode) {
        // Initialize frames with current grid or freeform stamps as frame 0
        if (state.frames.length === 0) {
            if (state.canvasMode === "freeform") {
                state.frames.push(cloneFreeformArray(state.freeformStamps));
            } else {
                state.frames.push(cloneGrid(state.grid));
            }
        }
        state.currentFrame = 0;
        updateFrameDisplay();
    }
}

export function updateFrameDisplay() {
    const display = document.getElementById("frameDisplay");
    if (display) {
        display.textContent = `${state.currentFrame + 1} / ${state.frames.length}`;
    }
}

export function saveCurrentFrame() {
    if (state.frames.length > state.currentFrame) {
        state.frames[state.currentFrame] = cloneGrid(state.grid);
    }
}

export function loadFrame(index) {
    if (index < 0 || index >= state.frames.length) return;
    state.currentFrame = index;
    state.grid = cloneGrid(state.frames[state.currentFrame]);
    if (callbacks.renderGrid) callbacks.renderGrid();
    if (callbacks.updateExport) callbacks.updateExport();
    updateFrameDisplay();
}

function loadFreeformFrame(index) {
    if (index < 0 || index >= state.frames.length) return;
    state.currentFrame = index;
    state.freeformStamps = cloneFreeformArray(state.frames[state.currentFrame]);
    if (callbacks.updateFreeformLayer) callbacks.updateFreeformLayer();
    if (callbacks.updateExport) callbacks.updateExport();
    updateFrameDisplay();
}

function prevFrame() {
    if (!state.animateMode) return;
    saveCurrentFrame();
    if (state.currentFrame > 0) {
        loadFrame(state.currentFrame - 1);
    }
}

function nextFrame() {
    if (!state.animateMode) return;
    saveCurrentFrame();
    if (state.currentFrame < state.frames.length - 1) {
        loadFrame(state.currentFrame + 1);
    }
}

function addFrame() {
    if (!state.animateMode) return;
    if (state.frames.length >= MAX_FRAMES) {
        alert(`Maximum ${MAX_FRAMES} frames allowed`);
        return;
    }
    saveCurrentFrame();
    // Add new blank frame after current
    const bg = getBackgroundItem();
    const newGrid = Array.from({ length: state.rows }, () => Array(state.cols).fill(bg));
    state.frames.splice(state.currentFrame + 1, 0, newGrid);
    loadFrame(state.currentFrame + 1);
}

function deleteFrame() {
    if (!state.animateMode) return;
    if (state.frames.length <= 1) {
        alert("Cannot delete the only frame");
        return;
    }
    state.frames.splice(state.currentFrame, 1);
    if (state.currentFrame >= state.frames.length) {
        state.currentFrame = state.frames.length - 1;
    }
    loadFrame(state.currentFrame);
}

function duplicateFrame() {
    if (!state.animateMode) return;
    if (state.frames.length >= MAX_FRAMES) {
        alert(`Maximum ${MAX_FRAMES} frames allowed`);
        return;
    }
    saveCurrentFrame();
    const copy = cloneGrid(state.frames[state.currentFrame]);
    state.frames.splice(state.currentFrame + 1, 0, copy);
    loadFrame(state.currentFrame + 1);
}

function togglePlayStop() {
    if (!state.animateMode || state.frames.length === 0) return;

    state.isPlaying = !state.isPlaying;
    const btn = document.getElementById("playStopBtn");

    if (btn) {
        btn.textContent = state.isPlaying ? "Stop" : "Play";
    }

    if (state.isPlaying) {
        // Save the current frame before starting playback
        saveCurrentFrame();
        // Start playback
        state.playbackInterval = setInterval(() => {
            state.currentFrame = (state.currentFrame + 1) % state.frames.length;
            loadFrame(state.currentFrame);
        }, 100); // 100ms per frame = 10 FPS
    } else {
        // Stop playback
        if (state.playbackInterval) {
            clearInterval(state.playbackInterval);
            state.playbackInterval = null;
        }
        // Save the current frame when stopping to preserve any changes
        saveCurrentFrame();
    }
}

// ── GIF export ───────────────────────────────────────────────────────────────

async function saveGif() {
    if (!state.animateMode || state.frames.length === 0) {
        alert("Enable Animate mode and create frames first");
        return;
    }

    // Save current frame to ensure it's included
    saveCurrentFrame();

    const tileSize = 40; // Match main canvas tile size
    const width = state.cols * tileSize;
    const height = state.rows * tileSize;

    setSavingOverlay(true);
    updateSavingOverlayStatus("Preparing GIF…", "");

    try {
        await ensureGifJs();
        updateSavingOverlayStatus("Gathering sprites…", "");

        const bg = getBackgroundItem();
        const imageCache = new Map();

        // Collect all image sources from all frames
        const allImages = new Set();
        for (const frame of state.frames) {
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
        for (let frameIndex = 0; frameIndex < state.frames.length; frameIndex++) {
            const frameData = state.frames[frameIndex];
            updateSavingOverlayStatus(`Painting frame ${frameIndex + 1}/${state.frames.length}`, "");
            await waitForAnimationFrame();
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, width, height);

            ctx.font = `${tileSize}px monospace`;
            ctx.textBaseline = "top";

            for (let r = 0; r < state.rows; r++) {
                for (let c = 0; c < state.cols; c++) {
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

async function ensureGifJs() {
    if (typeof GIF !== "undefined" && window.__gifWorkerURL) {
        return;
    }
    if (!state.gifJsPromise) {
        state.gifJsPromise = loadGifJs();
    }
    await state.gifJsPromise;
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

// ── GIF import ───────────────────────────────────────────────────────────────

function openGimportDialog() {
    const input = document.getElementById("gimportInput");
    if (input) input.click();
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

async function importGifFile(file) {
    try {
        // Show loading overlay
        setSavingOverlay(true);
        updateSavingOverlayStatus("Loading GIF...", "");

        const arrayBuffer = await file.arrayBuffer();
        updateSavingOverlayStatus("Decoding GIF frames...", "");

        const gifFrames = await parseGifFrames(arrayBuffer);

        if (!gifFrames || !gifFrames.length) {
            console.warn("GIF had no decodable frames, falling back to static image import");
            setSavingOverlay(false);
            await importImageFile(file);
            return;
        }

        updateSavingOverlayStatus("Processing GIF frames...", "0%");

        const wasPlaying = state.isPlaying;
        if (state.isPlaying) {
            togglePlayStop();
        }

        // Ensure animate mode
        const activateAnimate = !state.animateMode;
        if (activateAnimate) {
            toggleAnimateMode();
        }

        // Replace frames with imported data
        state.frames = [];

        const paletteEntries = getAllPaletteEntries();
        await ensurePaletteColors(paletteEntries);
        const paletteColors = paletteEntries
            .map(entry => ({
                entry,
                color: state.paletteColorCache.get(getPaletteCacheKey(entry))
            }))
            .filter(item => item.color);

        const bgItem = getBackgroundItem();
        const targetRows = state.rows || 4;
        const targetCols = state.cols || 7;
        const resizeCanvas = document.createElement("canvas");
        resizeCanvas.width = targetCols;
        resizeCanvas.height = targetRows;
        const resizeCtx = resizeCanvas.getContext("2d");
        resizeCtx.imageSmoothingEnabled = true;
        resizeCtx.imageSmoothingQuality = "high";

        // Process frames with progress updates
        const totalFrames = Math.min(gifFrames.length, MAX_FRAMES);
        for (let i = 0; i < totalFrames; i++) {
            const frameCanvas = gifFrames[i];

            // Update progress every few frames
            if (i % 5 === 0 || i === totalFrames - 1) {
                const percent = Math.round((i / totalFrames) * 100);
                updateSavingOverlayStatus("Processing GIF frames...", `${percent}%`);
                await waitForAnimationFrame(); // Let UI update
            }

            resizeCtx.clearRect(0, 0, targetCols, targetRows);
            resizeCtx.drawImage(frameCanvas, 0, 0, targetCols, targetRows);
            const imageData = resizeCtx.getImageData(0, 0, targetCols, targetRows).data;
            const newGrid = gridFromImageData(imageData, targetRows, targetCols, paletteColors, bgItem);
            state.frames.push(newGrid);
        }

        updateSavingOverlayStatus("Finalizing...", "");

        state.currentFrame = 0;
        loadFrame(0);
        updateFrameDisplay();

        if (!activateAnimate && state.frames.length > 0) {
            updateFrameDisplay();
        }

        if (wasPlaying) {
            togglePlayStop();
        }

        // Hide loading overlay
        setSavingOverlay(false);

    } catch (err) {
        console.error("GIF import failed:", err);

        // If we managed to decode some frames, try to show them instead of failing hard
        if (state.frames && state.frames.length) {
            try {
                state.currentFrame = 0;
                loadFrame(0);
                updateFrameDisplay();
            } catch (innerErr) {
                console.error("Failed to display decoded GIF frames:", innerErr);
                alert("Failed to import GIF. Try importing as a regular image instead.");
            }
        } else {
            alert("Failed to import GIF. Try importing as a regular image instead.");
        }

        setSavingOverlay(false);
    }
}

async function parseGifFrames(arrayBuffer) {
    // Skip ImageDecoder for now - it's causing issues
    // Go straight to omggif which is more reliable
    console.log("Using omggif parser for GIF frames");

    // Use omggif parser
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
        let numFrames = 0;

        // Safely get frame count
        try {
            numFrames = reader.numFrames();
        } catch (err) {
            console.error("Failed to get numFrames, trying manual detection", err);
            numFrames = 0;
        }

        // Cap at MAX_FRAMES
        const maxFramesToDecode = Math.min(numFrames || 999, MAX_FRAMES);
        console.log(`omggif: decoding up to ${maxFramesToDecode} frames (reported: ${numFrames})`);

        const workingCanvas = document.createElement("canvas");
        workingCanvas.width = width;
        workingCanvas.height = height;
        const workingCtx = workingCanvas.getContext("2d");
        const captured = [];

        // Decode frames until we hit an error or reach the limit
        for (let index = 0; index < maxFramesToDecode; index++) {
            try {
                // Show progress
                if (index % 5 === 0 || index === maxFramesToDecode - 1) {
                    updateSavingOverlayStatus("Decoding GIF frames...", `${index + 1}/${numFrames || '?'}`);
                    await waitForAnimationFrame();
                }

                const imageData = workingCtx.createImageData(width, height);
                reader.decodeAndBlitFrameRGBA(index, imageData.data);
                workingCtx.putImageData(imageData, 0, 0);

                const frameCanvas = document.createElement("canvas");
                frameCanvas.width = width;
                frameCanvas.height = height;
                frameCanvas.getContext("2d").drawImage(workingCanvas, 0, 0);
                captured.push(frameCanvas);
            } catch (err) {
                // Reached end of frames or decode error
                console.log(`Stopped decoding at frame ${index}: ${err.message}`);
                break;
            }
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
        console.log("ImageDecoder not available, skipping");
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

        // Wait for track to be ready with 5 second timeout
        if (track.ready) {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Track ready timeout")), 5000)
            );
            try {
                await Promise.race([track.ready, timeoutPromise]);
            } catch (err) {
                console.warn("ImageDecoder track.ready timed out, falling back");
                decoder.close?.();
                return null;
            }
        }

        const frameCount = track.frameCount || 0;
        if (!frameCount) {
            decoder.close?.();
            return null;
        }

        console.log(`ImageDecoder: decoding ${frameCount} frames`);
        const decodedFrames = [];
        for (let i = 0; i < frameCount; i++) {
            // Show progress with frame count
            if (i % 5 === 0 || i === frameCount - 1) {
                updateSavingOverlayStatus("Decoding GIF frames...", `${i + 1}/${frameCount}`);
                await waitForAnimationFrame();
            }

            // Decode with timeout per frame
            const decodePromise = decoder.decode({ frameIndex: i });
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Frame decode timeout")), 3000)
            );

            try {
                const { image } = await Promise.race([decodePromise, timeoutPromise]);
                const canvas = document.createElement("canvas");
                canvas.width = image.displayWidth || image.codedWidth;
                canvas.height = image.displayHeight || image.codedHeight;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(image, 0, 0);
                decodedFrames.push(canvas);
                if (typeof image.close === "function") {
                    image.close();
                }
            } catch (err) {
                console.warn(`Frame ${i} decode failed or timed out, stopping ImageDecoder`);
                decoder.close?.();
                // Return what we have so far, or null if nothing
                return decodedFrames.length > 0 ? decodedFrames : null;
            }
        }

        decoder.close?.();
        console.log(`ImageDecoder successfully decoded ${decodedFrames.length} frames`);
        return decodedFrames;
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

// ── Grid from image data (non-chunked version for GIF frames) ────────────────

export function gridFromImageData(imageData, targetRows, targetCols, paletteColors, bgItem) {
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

// ── Init ─────────────────────────────────────────────────────────────────────

export function initAnimation() {
    // Animate toggle
    document.getElementById('animateToggle')?.addEventListener('click', toggleAnimateMode);

    // Frame navigation buttons (by id)
    document.getElementById('prevFrameBtn')?.addEventListener('click', prevFrame);
    document.getElementById('nextFrameBtn')?.addEventListener('click', nextFrame);
    document.getElementById('playStopBtn')?.addEventListener('click', togglePlayStop);
    document.getElementById('addFrameBtn')?.addEventListener('click', addFrame);
    document.getElementById('deleteFrameBtn')?.addEventListener('click', deleteFrame);
    document.getElementById('duplicateFrameBtn')?.addEventListener('click', duplicateFrame);

    // Fallback: try positional buttons within animationControls
    const animControls = document.getElementById('animationControls');
    if (animControls) {
        const buttons = animControls.querySelectorAll('button');
        // Order: prev(0), next(1), play/stop(2), add(3), delete(4), duplicate(5)
        if (buttons[0] && !buttons[0].id) buttons[0].addEventListener('click', prevFrame);
        if (buttons[1] && !buttons[1].id) buttons[1].addEventListener('click', nextFrame);
    }

    // Save GIF button
    document.getElementById('saveGifBtn')?.addEventListener('click', saveGif);

    // Gimport
    document.getElementById('gimportBtn')?.addEventListener('click', openGimportDialog);
    document.getElementById('gimportInput')?.addEventListener('change', handleGimportChange);
}
