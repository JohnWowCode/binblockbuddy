import { state } from './state.js';
import { getBackgroundItem, getRandomPaletteItem } from './utils.js';
import { pushHistory } from './history.js';

const callbacks = {
    renderGrid: null,
    updateExport: null,
};

export function setGeneratorCallbacks(cbs) {
    Object.assign(callbacks, cbs);
}

export function randomInfinite() {
    if (!state.rows || !state.cols) return;
    pushHistory();
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            state.grid[r][c] = getRandomPaletteItem();
        }
    }
    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function randomCar() {
    if (!state.rows || !state.cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            state.grid[r][c] = bg;
        }
    }

    const choices = state.palette.filter(p => p !== bg);
    const body = choices[Math.floor(Math.random() * choices.length)] || bg;
    const windowTile = choices[Math.floor(Math.random() * choices.length)] || body;
    const wheel = choices[Math.floor(Math.random() * choices.length)] || body;

    // vehicle type: 0 = car, 1 = truck, 2 = bus
    const type = Math.floor(Math.random() * 3);

    const bodyHeight = type === 2 ? Math.max(3, Math.floor(state.rows * 0.3)) : Math.max(2, Math.floor(state.rows * 0.25));
    const bodyWidth = (() => {
        if (type === 0) return Math.max(4, Math.floor(state.cols * 0.4));
        if (type === 1) return Math.max(5, Math.floor(state.cols * 0.6));
        return Math.max(6, Math.floor(state.cols * 0.7));
    })();

    const left = Math.max(1, Math.floor((state.cols - bodyWidth) / 2));
    const right = Math.min(state.cols - 2, left + bodyWidth - 1);
    const bottom = state.rows - 2;
    const top = Math.max(1, bottom - bodyHeight + 1);

    // body
    for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
            state.grid[r][c] = body;
        }
    }

    // windows row
    const windowRow = top + 1;
    if (state.grid[windowRow]) {
        const segments = type === 0 ? 2 : type === 1 ? 3 : 4;
        const segWidth = Math.max(1, Math.floor((right - left + 1) / (segments + 1)));
        for (let s = 1; s <= segments; s++) {
            const start = left + s * segWidth - 1;
            if (start < left || start > right) continue;
            if (state.grid[windowRow][start] !== undefined) state.grid[windowRow][start] = windowTile;
        }
    }

    // wheels
    const wheelRow = bottom + 1;
    if (state.grid[wheelRow]) {
        const wheelCount = type === 0 ? 2 : 3;
        for (let i = 0; i < wheelCount; i++) {
            const t = i / (wheelCount - 1 || 1);
            const col = left + Math.round(t * (right - left));
            if (state.grid[wheelRow][col] !== undefined) state.grid[wheelRow][col] = wheel;
        }
    }

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function randomFace() {
    if (!state.rows || !state.cols) return;
    pushHistory();
    const bg = getBackgroundItem();

    // fill with background first
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            state.grid[r][c] = bg;
        }
    }

    // choose random palette items for features
    const choices = state.palette.filter(p => p !== bg);
    const border = choices[Math.floor(Math.random() * choices.length)] || bg;
    const fill = choices[Math.floor(Math.random() * choices.length)] || bg;
    const eye = choices[Math.floor(Math.random() * choices.length)] || fill;
    const mouth = choices[Math.floor(Math.random() * choices.length)] || eye;

    // draw head area
    for (let r = 1; r < state.rows - 1; r++) {
        for (let c = 1; c < state.cols - 1; c++) {
            let val = fill;
            if (r === 1 || r === state.rows - 2 || c === 1 || c === state.cols - 2) {
                val = border;
            }
            state.grid[r][c] = val;
        }
    }

    const eyeRow = Math.max(2, Math.floor(state.rows / 3));
    const leftEyeCol = Math.max(2, Math.floor(state.cols / 3));
    const rightEyeCol = Math.min(state.cols - 3, Math.floor(2 * state.cols / 3));
    const mouthRow = Math.min(state.rows - 3, Math.floor(2 * state.rows / 3));

    if (state.grid[eyeRow]) {
        state.grid[eyeRow][leftEyeCol] = eye;
        state.grid[eyeRow][rightEyeCol] = eye;
    }

    // random mouth style
    if (state.grid[mouthRow]) {
        const style = Math.floor(Math.random() * 3); // 0: flat, 1: smile, 2: frown
        for (let c = leftEyeCol; c <= rightEyeCol; c++) {
            let mr = mouthRow;
            if (style === 1 && (c === leftEyeCol || c === rightEyeCol)) mr = mouthRow - 1;
            if (style === 2 && (c === leftEyeCol || c === rightEyeCol)) mr = mouthRow + 1;
            if (state.grid[mr]) state.grid[mr][c] = mouth;
        }
    }

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function randomFlower() {
    if (!state.rows || !state.cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    // fill with background
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            state.grid[r][c] = bg;
        }
    }

    const choices = state.palette.filter(p => p !== bg);
    const stem = choices[Math.floor(Math.random() * choices.length)] || bg;
    const petal = choices[Math.floor(Math.random() * choices.length)] || stem;
    const center = choices[Math.floor(Math.random() * choices.length)] || petal;

    const flowerCount = Math.random() < 0.4 && state.cols >= 6 ? 2 : 1;
    for (let f = 0; f < flowerCount; f++) {
        const centerRow = 1 + Math.floor(Math.random() * Math.max(1, Math.floor(state.rows / 3)));
        const centerCol = 1 + Math.floor(Math.random() * (state.cols - 2));

        if (!state.grid[centerRow]) continue;
        state.grid[centerRow][centerCol] = center;

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
            if (state.grid[rr] && state.grid[rr][cc] !== undefined) state.grid[rr][cc] = petal;
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
                if (state.grid[rr] && state.grid[rr][cc] !== undefined) state.grid[rr][cc] = petal;
            });
        }

        // stem downward
        const stemStart = centerRow + 1;
        for (let r = stemStart; r < state.rows; r++) {
            const width = 1 + Math.floor(Math.random() * 2); // 1 or 2 wide stem
            for (let w = 0; w < width; w++) {
                const cc = centerCol + (variant % 2 === 0 ? w : -w);
                if (state.grid[r] && state.grid[r][cc] !== undefined) state.grid[r][cc] = stem;
            }
            // occasional leaf
            if (Math.random() < 0.25) {
                const side = Math.random() < 0.5 ? -1 : 1;
                const lc = centerCol + side * 2;
                if (state.grid[r] && state.grid[r][lc] !== undefined) state.grid[r][lc] = stem;
            }
        }
    }

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function randomHouse() {
    if (!state.rows || !state.cols) return;
    pushHistory();
    const bg = getBackgroundItem();

    const choices = state.palette.filter(p => p !== bg);
    const wall = choices[Math.floor(Math.random() * choices.length)] || bg;
    const roof = choices[Math.floor(Math.random() * choices.length)] || wall;
    const door = choices[Math.floor(Math.random() * choices.length)] || roof;
    const windowTile = choices[Math.floor(Math.random() * choices.length)] || door;

    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            state.grid[r][c] = bg;
        }
    }

    const baseHeight = Math.max(3, Math.floor(state.rows * 0.4));
    const baseWidth = Math.max(3, Math.floor(state.cols * (0.4 + Math.random() * 0.4)));
    const baseLeft = Math.floor((state.cols - baseWidth) / 2);
    const baseRight = baseLeft + baseWidth - 1;
    const baseBottom = state.rows - 1;
    const baseTop = baseBottom - baseHeight + 1;

    for (let r = baseTop; r <= baseBottom; r++) {
        for (let c = baseLeft; c <= baseRight; c++) {
            state.grid[r][c] = wall;
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
            if (state.grid[row] && c >= 0 && c < state.cols) state.grid[row][c] = roof;
        }
    }

    // door position: left, center, or right
    const doorWidth = Math.max(1, Math.floor(baseWidth / 5));
    const doorModes = [baseLeft + 1, roofCenterCol - Math.floor(doorWidth / 2), baseRight - doorWidth];
    const doorLeft = doorModes[Math.floor(Math.random() * doorModes.length)];
    for (let r = baseBottom; r >= baseBottom - Math.floor(baseHeight / 2); r--) {
        for (let c = doorLeft; c < doorLeft + doorWidth; c++) {
            if (state.grid[r] && c >= 0 && c < state.cols) state.grid[r][c] = door;
        }
    }

    // windows: one or two rows
    const windowRows = [];
    if (baseHeight > 3) windowRows.push(baseTop + 1);
    if (baseHeight > 5 && Math.random() < 0.7) windowRows.push(baseTop + 2 + Math.floor(baseHeight / 4));
    windowRows.forEach(wr => {
        if (!state.grid[wr]) return;
        const leftWinCol = baseLeft + 1;
        const rightWinCol = baseRight - 1;
        if (leftWinCol >= 0 && leftWinCol < state.cols) state.grid[wr][leftWinCol] = windowTile;
        if (rightWinCol >= 0 && rightWinCol < state.cols) state.grid[wr][rightWinCol] = windowTile;
    });

    // optional chimney
    if (Math.random() < 0.6) {
        const chimCol = roofCenterCol + (Math.random() < 0.5 ? -Math.floor(baseWidth / 4) : Math.floor(baseWidth / 4));
        for (let r = baseTop - roofHeight - 1; r < baseTop; r++) {
            if (state.grid[r] && chimCol >= 0 && chimCol < state.cols) state.grid[r][chimCol] = roof;
        }
    }

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function randomAlien() {
    if (!state.rows || !state.cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            state.grid[r][c] = bg;
        }
    }

    const choices = state.palette.filter(p => p !== bg);
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

    const startRow = Math.max(1, Math.floor((state.rows - h) / 2));
    const startCol = Math.max(1, Math.floor((state.cols - w) / 2));

    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            if (tmpl[r][c] === "1") {
                const rr = startRow + r;
                const cc = startCol + c;
                if (!state.grid[rr] || state.grid[rr][cc] === undefined) continue;
                // eyes on second row
                if (r === 1 && (c === 1 || c === w - 2)) {
                    state.grid[rr][cc] = eye;
                } else if (r === 2 && c === Math.floor(w / 2)) {
                    state.grid[rr][cc] = accent;
                } else {
                    state.grid[rr][cc] = body;
                }
            }
        }
    }

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function randomCat() {
    if (!state.rows || !state.cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            state.grid[r][c] = bg;
        }
    }

    const choices = state.palette.slice();
    const body = choices[Math.floor(Math.random() * choices.length)];
    const ear = choices[Math.floor(Math.random() * choices.length)] || body;
    const eye = choices[Math.floor(Math.random() * choices.length)] || body;
    const nose = choices[Math.floor(Math.random() * choices.length)] || eye;

    const marginR = Math.max(1, Math.floor(state.rows * 0.15));
    const marginC = Math.max(1, Math.floor(state.cols * 0.15));
    const top = marginR;
    const bottom = state.rows - 1 - marginR;
    const left = marginC;
    const right = state.cols - 1 - marginC;

    for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
            state.grid[r][c] = body;
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
        if (state.grid[top - 1]) {
            if (state.grid[top - 1][left] !== undefined) state.grid[top - 1][left] = ear;
            if (state.grid[top - 1][right] !== undefined) state.grid[top - 1][right] = ear;
        }
    } else {
        // block ears on corners of head
        if (state.grid[top]) {
            if (state.grid[top][left] !== undefined) state.grid[top][left] = ear;
            if (state.grid[top][right] !== undefined) state.grid[top][right] = ear;
        }
    }

    // eyes
    if (state.grid[eyeRow]) {
        const leftEyeCol = Math.max(left + 1, midCol - eyeOffset);
        const rightEyeCol = Math.min(right - 1, midCol + eyeOffset);
        if (state.grid[eyeRow][leftEyeCol] !== undefined) state.grid[eyeRow][leftEyeCol] = eye;
        if (state.grid[eyeRow][rightEyeCol] !== undefined) state.grid[eyeRow][rightEyeCol] = eye;
    }

    // nose / mouth
    const noseRow = Math.min(bottom - 1, midRow + 1);
    if (state.grid[noseRow]) {
        if (state.grid[noseRow][midCol] !== undefined) state.grid[noseRow][midCol] = nose;
        // optional whiskers
        if (Math.random() < 0.7) {
            if (state.grid[noseRow][midCol - 1] !== undefined) state.grid[noseRow][midCol - 1] = nose;
            if (state.grid[noseRow][midCol + 1] !== undefined) state.grid[noseRow][midCol + 1] = nose;
        }
    }

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function randomDog() {
    if (!state.rows || !state.cols) return;
    pushHistory();
    const bg = getBackgroundItem();
    for (let r = 0; r < state.rows; r++) {
        for (let c = 0; c < state.cols; c++) {
            state.grid[r][c] = bg;
        }
    }

    const choices = state.palette.slice();
    const body = choices[Math.floor(Math.random() * choices.length)];
    const ear = choices[Math.floor(Math.random() * choices.length)] || body;
    const eye = choices[Math.floor(Math.random() * choices.length)] || body;
    const snout = choices[Math.floor(Math.random() * choices.length)] || body;

    const marginR = Math.max(1, Math.floor(state.rows * 0.15));
    const marginC = Math.max(1, Math.floor(state.cols * 0.15));
    const top = marginR;
    const bottom = state.rows - 1 - marginR;
    const left = marginC;
    const right = state.cols - 1 - marginC;

    for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
            state.grid[r][c] = body;
        }
    }

    const midRow = Math.floor((top + bottom) / 2);
    const eyeRow = midRow - 1;
    const midCol = Math.floor((left + right) / 2);
    const eyeOffset = Math.max(1, Math.floor((right - left) / 4));

    // floppy or upright ears
    const earVariant = Math.floor(Math.random() * 2);
    if (earVariant === 0 && top - 1 >= 0) {
        if (state.grid[top - 1]) {
            if (state.grid[top - 1][left] !== undefined) state.grid[top - 1][left] = ear;
            if (state.grid[top - 1][right] !== undefined) state.grid[top - 1][right] = ear;
        }
    } else {
        if (state.grid[top]) {
            if (state.grid[top][left] !== undefined) state.grid[top][left] = ear;
            if (state.grid[top][right] !== undefined) state.grid[top][right] = ear;
        }
    }

    // eyes
    if (state.grid[eyeRow]) {
        const leftEyeCol = Math.max(left + 1, midCol - eyeOffset);
        const rightEyeCol = Math.min(right - 1, midCol + eyeOffset);
        if (state.grid[eyeRow][leftEyeCol] !== undefined) state.grid[eyeRow][leftEyeCol] = eye;
        if (state.grid[eyeRow][rightEyeCol] !== undefined) state.grid[eyeRow][rightEyeCol] = eye;
    }

    // snout sticking out
    const snoutRow = Math.min(bottom - 1, midRow + 1);
    if (state.grid[snoutRow]) {
        if (state.grid[snoutRow][midCol] !== undefined) state.grid[snoutRow][midCol] = snout;
        if (Math.random() < 0.6 && state.grid[snoutRow][midCol + 1] !== undefined) {
            state.grid[snoutRow][midCol + 1] = snout;
        }
    }

    callbacks.renderGrid?.();
    callbacks.updateExport?.();
}

export function initGenerators() {
    document.getElementById('randomInfiniteBtn')?.addEventListener('click', randomInfinite);
    document.getElementById('randomFaceBtn')?.addEventListener('click', randomFace);
    document.getElementById('randomFlowerBtn')?.addEventListener('click', randomFlower);
    document.getElementById('randomHouseBtn')?.addEventListener('click', randomHouse);
}
