import { state, TILE_SIZE, FREEFORM_DISTANCE_THRESHOLD, brushSizeRadii } from './state.js';
import { clamp, cloneBrushItem, getCanvasDimensions } from './utils.js';
import { pushHistory } from './history.js';

// ── Canvas Mode ──────────────────────────────────────────────────────────────

function toggleCanvasMode() {
    const next = state.canvasMode === 'grid' ? 'freeform' : 'grid';
    setCanvasMode(next);
}

export function setCanvasMode(mode) {
    if (mode !== 'grid' && mode !== 'freeform') return;
    if (state.canvasMode === mode) return;
    state.canvasMode = mode;
    updateCanvasModeUI();
}

export function updateCanvasModeUI() {
    const body = document.body;
    if (body) {
        body.classList.toggle('freeform-mode', state.canvasMode === 'freeform');
    }

    const btn = document.getElementById('modeToggleBtn');
    if (btn) {
        btn.textContent = `Mode: ${state.canvasMode === 'freeform' ? 'Freeform (Beta)' : 'Grid'}`;
        btn.classList.toggle('active', state.canvasMode === 'freeform');
    }

    ensureFreeformLayerListeners();
    updateFreeformLayer();
}

// ── Freeform Layer Listeners ─────────────────────────────────────────────────

export function ensureFreeformLayerListeners() {
    if (state.freeformLayerListenersAttached) return;
    const layer = document.getElementById('freeformLayer');
    if (!layer) return;

    layer.addEventListener('pointerdown', handleFreeformPointerDown);
    layer.addEventListener('pointermove', handleFreeformPointerMove);
    layer.addEventListener('pointerleave', handleFreeformPointerUp);
    window.addEventListener('pointerup', handleFreeformPointerUp);

    state.freeformLayerListenersAttached = true;
}

// ── Pointer Handlers ─────────────────────────────────────────────────────────

function handleFreeformPointerDown(evt) {
    if (state.canvasMode !== 'freeform') return;
    const layer = document.getElementById('freeformLayer');
    if (!layer) return;

    // Handle bucket tool in freeform mode - fill canvas with stamps
    if (state.currentTool === 'bucket') {
        evt.preventDefault();
        if (!state.activeBrush) return;
        pushHistory();
        freeformBucketFill();
        return;
    }

    if (state.currentTool !== 'brush') return;

    evt.preventDefault();
    layer.setPointerCapture?.(evt.pointerId);

    if (!state.freeformHistoryPushed) {
        pushHistory();
        state.freeformHistoryPushed = true;
    }

    state.isFreeformPainting = true;
    state.lastFreeformPoint = null;
    placeFreeformStamp(evt, { force: true });
}

function freeformBucketFill() {
    if (!state.activeBrush) return;
    const width = state.cols * TILE_SIZE;
    const height = state.rows * TILE_SIZE;

    // Fill only empty space with current brush
    const existingStamps = new Set(
        state.freeformStamps.map(
            stamp => `${Math.floor(stamp.x / TILE_SIZE)},${Math.floor(stamp.y / TILE_SIZE)}`
        )
    );
    for (let y = 0; y < height; y += TILE_SIZE) {
        for (let x = 0; x < width; x += TILE_SIZE) {
            if (!existingStamps.has(`${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`)) {
                state.freeformStamps.push({
                    id: ++state.freeformStampId,
                    x: x,
                    y: y,
                    item: { ...state.activeBrush }
                });
            }
        }
    }

    updateFreeformLayer();
}

function handleFreeformPointerMove(evt) {
    if (!state.isFreeformPainting || state.canvasMode !== 'freeform') return;
    evt.preventDefault();
    placeFreeformStamp(evt);
}

function handleFreeformPointerUp(evt) {
    if (!state.isFreeformPainting) return;
    const layer = document.getElementById('freeformLayer');
    if (layer?.releasePointerCapture) {
        try {
            layer.releasePointerCapture(evt.pointerId);
        } catch (err) {
            // ignore release errors (pointer may not be captured)
        }
    }
    state.isFreeformPainting = false;
    state.lastFreeformPoint = null;
    state.freeformHistoryPushed = false;
}

// ── Stamp Placement ──────────────────────────────────────────────────────────

function placeFreeformStamp(evt, options = {}) {
    if (!state.activeBrush) return;
    const layer = document.getElementById('freeformLayer');
    if (!layer) return;

    const rect = layer.getBoundingClientRect();
    const point = {
        x: (evt.clientX - rect.left) / state.currentZoomFactor,
        y: (evt.clientY - rect.top) / state.currentZoomFactor
    };

    if (!options.force && state.lastFreeformPoint) {
        const dx = point.x - state.lastFreeformPoint.x;
        const dy = point.y - state.lastFreeformPoint.y;
        if (Math.hypot(dx, dy) < FREEFORM_DISTANCE_THRESHOLD) {
            return;
        }
    }

    state.lastFreeformPoint = point;

    const width = state.cols * TILE_SIZE;
    const height = state.rows * TILE_SIZE;
    const half = TILE_SIZE / 2;
    const centerX = point.x - half;
    const centerY = point.y - half;

    // Get brush offsets for current brush size
    const offsets = getBrushOffsets(state.currentBrushSizeIndex);
    const brushShapeEl = document.getElementById('brushShape');
    const shape = brushShapeEl ? brushShapeEl.value : 'square';

    for (const offset of offsets) {
        if (shape !== 'square' && !isShapePoint(centerX + offset.x, centerY + offset.y, centerX + half, centerY + half, shape, half)) {
            continue;
        }
        const stampX = clamp(centerX + offset.x, -TILE_SIZE, width);
        const stampY = clamp(centerY + offset.y, -TILE_SIZE, height);

        const stamp = {
            id: ++state.freeformStampId,
            x: stampX,
            y: stampY,
            item: { ...state.activeBrush }
        };
        state.freeformStamps.push(stamp);

        // Mirror stamp if enabled
        if (state.mirrorEnabled) {
            const mirroredX = width - stampX - TILE_SIZE;
            if (Math.abs(mirroredX - stampX) > 1) {
                const mirrorStamp = {
                    id: ++state.freeformStampId,
                    x: mirroredX,
                    y: stampY,
                    item: { ...state.activeBrush }
                };
                state.freeformStamps.push(mirrorStamp);
            }
        }
    }

    updateFreeformLayer();
}

export function addFreeformStampAtPosition(x, y, item) {
    const { width, height } = getCanvasDimensions();
    const clampedX = clamp(x, -TILE_SIZE, width);
    const clampedY = clamp(y, -TILE_SIZE, height);
    const stamp = {
        id: ++state.freeformStampId,
        x: clampedX,
        y: clampedY,
        item: cloneBrushItem(item)
    };
    state.freeformStamps.push(stamp);
    return stamp;
}

export function addStampWithMirror(x, y, item) {
    const { width } = getCanvasDimensions();
    const mainStamp = addFreeformStampAtPosition(x, y, item);
    if (!state.mirrorEnabled) {
        return;
    }
    const mirroredX = width - (mainStamp.x + TILE_SIZE);
    if (Math.abs(mirroredX - mainStamp.x) <= 0.5) {
        return;
    }
    addFreeformStampAtPosition(mirroredX, mainStamp.y, item);
}

// ── Canvas Point Helpers ─────────────────────────────────────────────────────

export function getCanvasPointFromEvent(evt) {
    const layer = document.getElementById('freeformLayer');
    if (!layer) {
        return { x: 0, y: 0 };
    }
    const rect = layer.getBoundingClientRect();
    return {
        x: (evt.clientX - rect.left) / state.currentZoomFactor,
        y: (evt.clientY - rect.top) / state.currentZoomFactor
    };
}

export function pointToCell(point) {
    return {
        r: clamp(Math.floor(point.y / TILE_SIZE), 0, state.rows - 1),
        c: clamp(Math.floor(point.x / TILE_SIZE), 0, state.cols - 1)
    };
}

// ── Brush Offsets & Shape ────────────────────────────────────────────────────

export function getBrushOffsets(index) {
    if (state.brushOffsetsCache.has(index)) {
        return state.brushOffsetsCache.get(index);
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
    state.brushOffsetsCache.set(index, offsets);
    return offsets;
}

export function isShapePoint(x, y, cx, cy, shape, radius) {
    const dx = Math.abs(x - cx);
    const dy = Math.abs(y - cy);
    switch (shape) {
        case 'circle':
            return Math.sqrt(dx * dx + dy * dy) <= radius;
        case 'cross':
            return dx <= radius / 2 || dy <= radius / 2;
        case 'triangle':
            return (dx + dy) <= radius * 1.5;
        case 'arrow':
            return dy <= radius && (dx <= radius / 2 || y > cy);
        default:
            return true;
    }
}

// ── Freeform Layer Rendering ─────────────────────────────────────────────────

export function updateFreeformLayer() {
    const layer = document.getElementById('freeformLayer');
    if (!layer) return;
    // Use tile-sized canvas dimensions so the clickable area matches stamp positions
    const width = state.cols * TILE_SIZE;
    const height = state.rows * TILE_SIZE;
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    layer.innerHTML = '';

    if (state.canvasMode !== 'freeform') {
        return;
    }

    for (const stamp of state.freeformStamps) {
        const node = document.createElement('div');
        node.className = 'freeform-stamp';
        node.style.left = `${stamp.x}px`;
        node.style.top = `${stamp.y}px`;

        if (stamp.item.type === 'unicode') {
            node.textContent = stamp.item.char || '';
            node.style.backgroundImage = '';
            node.style.backgroundColor = stamp.item.color || 'transparent';
        } else if (stamp.item.type === 'img' && stamp.item.src) {
            node.textContent = '';
            node.style.backgroundImage = `url(${stamp.item.src})`;
        } else if (stamp.item.color) {
            node.textContent = '';
            node.style.backgroundImage = '';
            node.style.backgroundColor = stamp.item.color;
        }

        layer.appendChild(node);
    }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initFreeform() {
    document.getElementById('modeToggleBtn')?.addEventListener('click', toggleCanvasMode);
}
