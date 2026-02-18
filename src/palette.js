import { state, ASSET_PACK_STORAGE_KEY, brushSizeRadii } from './state.js';
import { applyCrossOriginIfNeeded, cloneBrushItem, colorDistance } from './utils.js';

// ── Callback mechanism to avoid circular deps ────────────────────────────────
const callbacks = {
    updateExport: null,
};

export function setPaletteCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

// ── Asset pack helpers ───────────────────────────────────────────────────────

function normalizeAssetPack(value) {
    return value === "usa" ? "usa" : "legacy";
}

function loadAssetPackSetting() {
    try {
        const stored = localStorage.getItem(ASSET_PACK_STORAGE_KEY);
        state.currentAssetPack = normalizeAssetPack(stored);
    } catch (err) {
        state.currentAssetPack = "legacy";
    }
}

function persistAssetPackSetting() {
    try {
        localStorage.setItem(ASSET_PACK_STORAGE_KEY, state.currentAssetPack);
    } catch (err) {
        // ignore
    }
}

export function setAssetPack(value) {
    const next = normalizeAssetPack(value);
    if (next === state.currentAssetPack) return;
    state.currentAssetPack = next;
    persistAssetPackSetting();
    rebuildImageDefaults();
    renderPalette();
}

function updateAssetPackUI() {
    const legacy = document.getElementById("assetPackLegacy");
    const usa = document.getElementById("assetPackUsa");
    if (legacy) legacy.checked = state.currentAssetPack === "legacy";
    if (usa) usa.checked = state.currentAssetPack === "usa";
}

export function rebuildImageDefaults() {
    state.imageDefaults.length = 0;

    if (state.currentAssetPack === "usa") {
        // USA pack tiles: assets/usa/tile0000.png ... tile1024.png
        // Export codes use :0000: style.
        for (let i = 0; i <= 1024; i++) {
            const num = i.toString().padStart(4, "0");
            state.imageDefaults.push({
                type: "img",
                src: `assets/usa/tile${num}.png`,
                char: `:${num}:`,
                category: "default"
            });
        }
        return;
    }

    // Legacy pack: assets/00.png..95.png (skip 63 which doesn't exist)
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

        state.imageDefaults.push({
            type: "img",
            src: `assets/${fileName}`,
            char: `:${num}:`,
            category: "default"
        });
    }
}

// ── Palette entries & color matching ─────────────────────────────────────────

export function getAllPaletteEntries() {
    return [...state.basePalette, ...state.imageDefaults, ...state.customPalette];
}

export function getPaletteCacheKey(entry) {
    if (!entry) return "";
    if (entry.type === "img" && entry.src) return entry.src;
    return entry.char || JSON.stringify(entry);
}

export function computeAverageColorFromImage(src) {
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

export async function ensurePaletteColor(entry) {
    const key = getPaletteCacheKey(entry);
    if (!key) return null;
    if (state.paletteColorCache.has(key)) {
        return state.paletteColorCache.get(key);
    }
    if (state.paletteColorPromises.has(key)) {
        return state.paletteColorPromises.get(key);
    }

    const promise = (async () => {
        if (entry.type === "img" && entry.src) {
            const color = await computeAverageColorFromImage(entry.src);
            state.paletteColorCache.set(key, color);
            return color;
        }
        // default fallback for unicode entries
        const fallback = { r: 128, g: 128, b: 128 };
        state.paletteColorCache.set(key, fallback);
        return fallback;
    })();

    state.paletteColorPromises.set(key, promise);
    try {
        const color = await promise;
        return color;
    } finally {
        state.paletteColorPromises.delete(key);
    }
}

export async function ensurePaletteColors(entries) {
    await Promise.all(entries.map((entry) => ensurePaletteColor(entry)));
}

export function findPaletteMatch(item) {
    if (!item) return null;
    return state.palette.find(
        (p) =>
            p?.char === item.char &&
            (p?.src ? p.src === item.src : true)
    ) || null;
}

export function findClosestPaletteEntry(color, paletteColors, backgroundItem) {
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

// ── Palette rebuild & render ─────────────────────────────────────────────────

function rebuildPaletteFromFlags() {
    const favOnly = document.getElementById("showFavoritesOnly")?.checked;

    state.palette = [...state.basePalette, ...state.imageDefaults, ...state.customPalette];

    if (favOnly) {
        state.palette = state.palette.filter(p => p.favorite);
    }

    if (!state.palette.length) {
        state.palette = [...state.imageDefaults];
    }

    if (!state.palette.includes(state.activeBrush)) {
        // Prefer :00: as default brush if present, otherwise first palette item
        const zero = state.palette.find(p => p.char === ":00:");
        state.activeBrush = zero || state.palette[0];
    }
}

export function renderPalette() {
    rebuildPaletteFromFlags();

    const container = document.getElementById("emojiPalette");
    container.innerHTML = "";

    state.palette.forEach((p) => {
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

        if (p === state.activeBrush) {
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
            state.activeBrush = p;
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

// ── Brush history ────────────────────────────────────────────────────────────

export function addToBrushHistory(brush) {
    if (!brush) return;
    const canonical = findPaletteMatch(brush) || { ...brush };
    // Don't add if it's the same as the last brush
    if (state.brushHistory.length > 0) {
        const last = state.brushHistory[state.brushHistory.length - 1];
        if (
            last &&
            last.char === canonical.char &&
            (last.src || "") === (canonical.src || "")
        ) {
            state.brushHistoryIndex = state.brushHistory.length - 1;
            return;
        }
    }
    state.brushHistory.push(canonical);
    if (state.brushHistory.length > 50) state.brushHistory.shift();
    state.brushHistoryIndex = state.brushHistory.length - 1;
}

export function navigateBrushHistory(direction) {
    if (state.brushHistory.length === 0) return;
    const newIndex = state.brushHistoryIndex + direction;
    if (newIndex < 0 || newIndex >= state.brushHistory.length) return;
    state.brushHistoryIndex = newIndex;
    const brush = state.brushHistory[state.brushHistoryIndex];
    if (!brush) return;
    const match = findPaletteMatch(brush);
    state.activeBrush = match || { ...brush };
    renderPalette();
}

// ── Custom emoji management ──────────────────────────────────────────────────

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
        state.customPalette.push({
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
    if (!state.activeBrush) return;
    const input = document.getElementById("renameCodeInput");
    if (!input) return;
    let code = input.value.trim();
    if (!code) return;
    if (!code.startsWith(":")) code = ":" + code;
    if (!code.endsWith(":")) code = code + ":";
    state.activeBrush.char = code;
    input.value = "";
    callbacks.updateExport?.();
}

// ── Initialization ───────────────────────────────────────────────────────────

export function initPalette() {
    // Load asset pack setting and build defaults
    loadAssetPackSetting();
    rebuildImageDefaults();

    // Favorites checkbox
    const favCb = document.getElementById('showFavoritesOnly');
    if (favCb) {
        favCb.checked = false;
        favCb.addEventListener('change', renderPalette);
    }

    // Asset pack radios
    const legacy = document.getElementById('assetPackLegacy');
    const usa = document.getElementById('assetPackUsa');
    updateAssetPackUI();
    if (legacy) {
        legacy.addEventListener('change', () => { if (legacy.checked) setAssetPack('legacy'); });
    }
    if (usa) {
        usa.addEventListener('change', () => { if (usa.checked) setAssetPack('usa'); });
    }

    // Upload emoji button
    document.getElementById('uploadEmojiBtn')?.addEventListener('click', addImageEmoji);
    // Rename emoji button
    document.getElementById('renameEmojiBtn')?.addEventListener('click', renameSelectedEmoji);

    // Brush history keyboard shortcuts (Ctrl+Arrow Left/Right)
    document.addEventListener('keydown', (e) => {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

        if (e.key === 'ArrowLeft' && e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            navigateBrushHistory(-1);
        } else if (e.key === 'ArrowRight' && e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            navigateBrushHistory(1);
        }
    });

    // Brush size buttons
    const brushSizeBtns = document.querySelectorAll('.brush-size-btn');
    brushSizeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.sizeIndex, 10);
            if (!Number.isFinite(idx) || idx < 0 || idx >= brushSizeRadii.length) return;
            state.currentBrushSizeIndex = idx;
            brushSizeBtns.forEach(b => b.classList.remove('brush-size-active'));
            btn.classList.add('brush-size-active');
        });
    });

    // Initial palette render
    renderPalette();
}
