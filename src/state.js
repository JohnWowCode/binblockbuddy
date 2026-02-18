// ── Constants ────────────────────────────────────────────────────────────────

export const TILE_SIZE = 40;
export const BINBLOCK_VERSION = 1;
export const FREEFORM_DISTANCE_THRESHOLD = TILE_SIZE / 2;
export const ASSET_PACK_STORAGE_KEY = "binblockbuddy.assetPack";
export const LAYOUT_STORAGE_KEY = "binblockbuddy.layout";
export const MAX_FRAMES = 200;
export const MAX_IMPORT_SIZE = 100;
export const DEFAULT_ROWS = 4;
export const DEFAULT_COLS = 7;

export const brushSizeRadii = [0, 1, 1.5, 2.2, 3.2];

export const bandColors = [
    "#00ff00",
    "#ff77ff",
    "#ffa500",
    "#ff0000",
    "#00aaff",
    "#aa00ff",
    "#8b4513",
    "#ffff00"
];

export const tips = [
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

export const THEME_STORAGE_KEY = "binbag-theme";

export const themeDefaults = {
    mainBg: "#080808",
    panelBg: "#1a1a1a",
    canvasBg: "#000000",
    gridBg: "#1a1a1a",
    buttonBg: "#151515",
    buttonText: "#00ff00"
};

export const themePresets = {
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

export const GIF_JS_SOURCES = [
    "assets/gif.js",
    "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js",
    "https://unpkg.com/gif.js@0.2.0/dist/gif.js"
];

export const GIF_WORKER_SOURCES = [
    "assets/gif.worker.js",
    "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js",
    "https://unpkg.com/gif.js@0.2.0/dist/gif.worker.js"
];

// ── Mutable state ────────────────────────────────────────────────────────────

export const state = {
    grid: [],
    rows: 4,
    cols: 7,

    activeBrush: null,
    isMouseDown: false,
    isPainting: false,

    basePalette: [],
    imageDefaults: [],
    customPalette: [],
    palette: [],

    paletteColorCache: new Map(),
    paletteColorPromises: new Map(),

    currentTool: "brush",
    mirrorEnabled: false,

    selection: [],
    selectionMode: "move",
    selectionStart: null,
    isSelectingDrag: false,

    clipboardSelection: null,

    canvasMode: "grid",

    history: [],
    future: [],

    brushHistory: [],
    brushHistoryIndex: -1,

    animateMode: false,
    frames: [],
    currentFrame: 0,

    isPlaying: false,
    playbackInterval: null,

    freeformStamps: [],
    freeformStampId: 0,

    isFreeformPainting: false,
    lastFreeformPoint: null,

    freeformHistoryPushed: false,

    currentBrushSizeIndex: 2,
    brushOffsetsCache: new Map(),

    freeformSelectionIds: new Set(),
    isFreeformSelecting: false,
    freeformSelectionStart: null,

    isFreeformDraggingSelection: false,
    freeformDragStartPoint: null,

    freeformSelectionSnapshot: null,
    freeformSelectionRect: null,

    currentAssetPack: "legacy",

    themeSettings: { ...themeDefaults },
    activeThemePreset: "defaultDark",

    exportChunks: [],
    exportHalfChunks: [],
    exportTopChunks: [],

    exportLabel: "",
    lastExportText: "",
    rowsPerPart: 8,

    moveHistoryPushed: false,
    dragTargetR: undefined,
    dragTargetC: undefined,

    omggifLoadingPromise: null,
    gifJsPromise: null,

    imageElementCache: new Map(),

    viewport: null
};
