import { state } from './state.js';

// Callbacks set by other modules to avoid circular imports
const callbacks = {
    renderGrid: null,
    updateExport: null,
    updateFreeformLayer: null,
    updateCanvasModeUI: null,
};

export function setHistoryCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

export function cloneGrid(src) {
    return src.map(row => row.slice());
}

export function cloneFreeformArray(arr) {
    return arr.map(stamp => ({
        id: stamp.id,
        x: stamp.x,
        y: stamp.y,
        item: stamp.item ? { ...stamp.item } : null
    }));
}

export function captureEditorState() {
    return {
        grid: cloneGrid(state.grid),
        freeform: cloneFreeformArray(state.freeformStamps),
        mode: state.canvasMode
    };
}

export function applyEditorState(s) {
    if (!s) return;
    state.grid = cloneGrid(s.grid);
    state.freeformStamps = cloneFreeformArray(s.freeform);
    if (s.mode) {
        state.canvasMode = s.mode;
        callbacks.updateCanvasModeUI?.();
    }
}

export function pushHistory() {
    state.history.push(captureEditorState());
    if (state.history.length > 100) state.history.shift();
    state.future = [];
}

export function undo() {
    if (!state.history.length) return;
    state.future.push(captureEditorState());
    const prev = state.history.pop();
    applyEditorState(prev);
    callbacks.renderGrid?.();
    callbacks.updateExport?.();
    callbacks.updateFreeformLayer?.();
}

export function redo() {
    if (!state.future.length) return;
    state.history.push(captureEditorState());
    const next = state.future.pop();
    applyEditorState(next);
    callbacks.renderGrid?.();
    callbacks.updateExport?.();
    callbacks.updateFreeformLayer?.();
}

export function initHistory() {
    // Undo/redo buttons
    document.getElementById('undoBtn')?.addEventListener('click', undo);
    document.getElementById('redoBtn')?.addEventListener('click', redo);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        const tag = e.target?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

        if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            undo();
        } else if (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            redo();
        }
    });
}
