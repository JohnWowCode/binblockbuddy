import { state, TILE_SIZE, bandColors } from './state.js';

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function waitForAnimationFrame() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(resolve);
        } else {
            setTimeout(resolve, 16);
        }
    });
}

export function shouldUseCrossOrigin(src) {
    if (!src) return false;
    if (src.startsWith("data:") || src.startsWith("blob:")) return false;
    return /^https?:\/\//i.test(src);
}

export function applyCrossOriginIfNeeded(img, src) {
    if (shouldUseCrossOrigin(src)) {
        img.crossOrigin = "anonymous";
        img.referrerPolicy = "no-referrer";
    }
}

export function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Unable to read file"));
        reader.readAsText(file);
    });
}

export function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Unable to read file"));
        reader.readAsDataURL(file);
    });
}

export function loadImageSource(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        applyCrossOriginIfNeeded(img, src);
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Unable to load image"));
        img.src = src;
    });
}

export function colorDistance(c1, c2) {
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    return dr * dr + dg * dg + db * db;
}

export function brightenColor(hex) {
    if (!hex || hex[0] !== "#" || (hex.length !== 7)) return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const factor = 0.7;
    const nr = Math.min(255, Math.round(r + (255 - r) * factor));
    const ng = Math.min(255, Math.round(g + (255 - g) * factor));
    const nb = Math.min(255, Math.round(b + (255 - b) * factor));
    return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}

export function cloneBrushItem(item) {
    if (!item) return null;
    return { ...item };
}

export function itemsEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.type !== b.type) return false;
    if (a.char !== b.char) return false;
    if (a.src !== b.src) return false;
    return true;
}

export function getCanvasDimensions() {
    if (state.canvasMode === "freeform") {
        return { width: state.cols, height: state.rows };
    }
    return {
        width: state.cols * TILE_SIZE,
        height: state.rows * TILE_SIZE
    };
}

export function getBandColor(index) {
    return bandColors[index % bandColors.length];
}

export function getDefaultBrushCodeForPack() {
    return state.currentAssetPack === "usa" ? ":0001:" : ":01:";
}

export function getDefaultBackgroundCodeForPack() {
    return state.currentAssetPack === "usa" ? ":0000:" : ":00:";
}

export function getBackgroundItem() {
    const code = getDefaultBackgroundCodeForPack();
    const zero = state.palette.find(p => p.char === code);
    return zero || state.palette[0];
}

export function getRandomPaletteItem() {
    return state.palette[Math.floor(Math.random() * state.palette.length)];
}
