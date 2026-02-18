// ── PixiJS Viewport ─────────────────────────────────────────────────────────
// Scene graph wrapper around a PixiJS Application.
// Created by Task 1 as a skeleton; rendering is wired in Task 2+.

import { Application, Container, Graphics, Sprite, Texture, Assets } from 'pixi.js';
import { state, TILE_SIZE } from './state.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const CELL_SIZE    = TILE_SIZE;          // 40
export const CELL_GAP     = 2;
export const CELL_STRIDE  = CELL_SIZE + CELL_GAP; // 42
export const GRID_LINE_COLOR = 0x555555;
export const GRID_LINE_ALPHA = 0.4;
export const MIN_ZOOM     = 0.02;
export const MAX_ZOOM     = 3;
export const ZOOM_STEP    = 1.08;
export const ZOOM_LERP    = 0.15;

// ── Viewport class ──────────────────────────────────────────────────────────

export class Viewport {
    /**
     * @param {Application} app  – an already-initialised PixiJS Application
     */
    constructor(app) {
        this.app = app;

        // ── Scene graph ─────────────────────────────────────────────
        this.sceneContainer    = new Container();
        this.gridGraphics      = new Graphics();
        this.cellContainer     = new Container();
        this.selectionGraphics = new Graphics();
        this.freeformContainer = new Container();

        this.sceneContainer.addChild(this.gridGraphics);
        this.sceneContainer.addChild(this.cellContainer);
        this.sceneContainer.addChild(this.selectionGraphics);
        this.sceneContainer.addChild(this.freeformContainer);

        app.stage.addChild(this.sceneContainer);

        // ── Sprite / texture caches ─────────────────────────────────
        this.cellSprites  = new Map();   // "r,c" → Sprite
        this.textureCache = new Map();   // cacheKey → Texture

        // ── Camera state ────────────────────────────────────────────
        this.targetScale = 1;
        this.targetX     = 0;
        this.targetY     = 0;
        this.isAnimating = false;

        // ── Grid info (set by render pass) ──────────────────────────
        this.gridInfo = null;

        // ── Input state ─────────────────────────────────────────────
        this.isSpaceHeld    = false;
        this.isDragging     = false;
        this.lastPointerPos = null;

        // ── Callbacks (wired by later tasks) ────────────────────────
        this.onCellDown   = null;
        this.onCellEnter  = null;
        this.onPointerUp  = null;

        // ── Freeform callbacks ───────────────────────────────────────
        this.onFreeformDown = null;
        this.onFreeformMove = null;
        this.onFreeformUp   = null;
    }

    // ── Factory ─────────────────────────────────────────────────────────────

    /**
     * Create and initialise a Viewport inside the given DOM element.
     * @param {HTMLElement} container
     * @returns {Promise<Viewport>}
     */
    static async create(container) {
        const app = new Application();

        await app.init({
            resizeTo:  container,
            background: state.themeSettings.canvasBg || '#000000',
            antialias: true,
        });

        container.appendChild(app.canvas);

        const vp = new Viewport(app);
        vp.setupEvents(container);
        return vp;
    }

    // ── Event setup ───────────────────────────────────────────────────────

    setupEvents(container) {
        // PixiJS pointer events for painting (Task 4)
        this.app.stage.eventMode = 'static';
        this.app.stage.hitArea = this.app.screen;

        // Keyboard: space for pan mode
        this._onKeyDown = (e) => {
            if (e.code === 'Space' && !e.repeat && !this._isInputFocused(e.target)) {
                e.preventDefault();
                this.isSpaceHeld = true;
                this.app.canvas.style.cursor = 'grab';
            }
        };
        this._onKeyUp = (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.isSpaceHeld = false;
                this.isDragging = false;
                this.app.canvas.style.cursor = 'default';
            }
        };
        window.addEventListener('keydown', this._onKeyDown, true);
        window.addEventListener('keyup', this._onKeyUp, true);

        // Pointer events on stage
        this.app.stage.on('pointerdown', (e) => this._onPointerDown(e));
        this.app.stage.on('pointermove', (e) => this._onPointerMove(e));
        this.app.stage.on('pointerup', (e) => this._onPointerUp(e));
        this.app.stage.on('pointerupoutside', (e) => this._onPointerUp(e));

        // Wheel on the canvas element
        this.app.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });

        // Resize observer
        this._resizeObserver = new ResizeObserver(() => this.fitToView());
        this._resizeObserver.observe(container);
    }

    _isInputFocused(target) {
        const tag = target?.tagName?.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
    }

    // ── Pointer handlers (pan) ──────────────────────────────────────────────

    _onPointerDown(e) {
        if (this.isSpaceHeld) {
            this.isDragging = true;
            this.lastPointerPos = { x: e.global.x, y: e.global.y };
            this.app.canvas.style.cursor = 'grabbing';
            return;
        }
        // Tool interaction (Task 4) — stub for now
        this._handleToolDown(e);
    }

    _onPointerMove(e) {
        if (this.isDragging && this.lastPointerPos) {
            const dx = e.global.x - this.lastPointerPos.x;
            const dy = e.global.y - this.lastPointerPos.y;
            this.sceneContainer.x += dx;
            this.sceneContainer.y += dy;
            this.targetX = this.sceneContainer.x;
            this.targetY = this.sceneContainer.y;
            this.lastPointerPos = { x: e.global.x, y: e.global.y };
            return;
        }
        // Tool interaction (Task 4) — stub for now
        this._handleToolMove(e);
    }

    _onPointerUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            this.app.canvas.style.cursor = this.isSpaceHeld ? 'grab' : 'default';
            return;
        }
        // Tool interaction (Task 4) — stub for now
        this._handleToolUp(e);
    }

    // ── Coordinate conversion ───────────────────────────────────────────────

    screenToGrid(screenX, screenY) {
        if (!this.gridInfo) return null;

        const scale = this.sceneContainer.scale.x;
        const worldX = (screenX - this.sceneContainer.x) / scale;
        const worldY = (screenY - this.sceneContainer.y) / scale;

        const { offsetX, offsetY, cols, rows } = this.gridInfo;
        const c = Math.floor((worldX - offsetX) / CELL_STRIDE);
        const r = Math.floor((worldY - offsetY) / CELL_STRIDE);

        if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
        return { r, c };
    }

    // ── Coordinate conversion (world) ──────────────────────────────────────

    screenToWorld(screenX, screenY) {
        const scale = this.sceneContainer.scale.x;
        return {
            x: (screenX - this.sceneContainer.x) / scale - this.gridInfo.offsetX,
            y: (screenY - this.sceneContainer.y) / scale - this.gridInfo.offsetY,
        };
    }

    // ── Tool event handlers (Task 4) ────────────────────────────────────────

    _handleToolDown(e) {
        if (state.canvasMode === 'freeform' && this.onFreeformDown) {
            this.onFreeformDown(e);
            return;
        }
        const pos = this.screenToGrid(e.global.x, e.global.y);
        if (pos && this.onCellDown) {
            this.onCellDown(pos.r, pos.c, e.data?.originalEvent || e);
        }
    }

    _handleToolMove(e) {
        if (state.canvasMode === 'freeform' && this.onFreeformMove) {
            this.onFreeformMove(e);
            return;
        }
        const pos = this.screenToGrid(e.global.x, e.global.y);
        if (pos && this.onCellEnter) {
            this.onCellEnter(pos.r, pos.c);
        }
    }

    _handleToolUp(e) {
        if (state.canvasMode === 'freeform' && this.onFreeformUp) {
            this.onFreeformUp(e);
            return;
        }
        if (this.onPointerUp) {
            this.onPointerUp(e.data?.originalEvent || e);
        }
    }

    // ── Wheel / zoom ────────────────────────────────────────────────────────

    _onWheel(e) {
        e.preventDefault();

        // Ctrl+wheel or Space+wheel = zoom
        if (e.ctrlKey || this.isSpaceHeld) {
            const direction = e.deltaY > 0 ? -1 : 1;
            const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            const currentScale = this.sceneContainer.scale.x;
            const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentScale * factor));

            // Zoom toward pointer position
            const rect = this.app.canvas.getBoundingClientRect();
            const pointerX = e.clientX - rect.left;
            const pointerY = e.clientY - rect.top;

            const worldX = (pointerX - this.sceneContainer.x) / currentScale;
            const worldY = (pointerY - this.sceneContainer.y) / currentScale;

            this.targetScale = newScale;
            this.targetX = pointerX - worldX * newScale;
            this.targetY = pointerY - worldY * newScale;

            if (!this.isAnimating) {
                this.isAnimating = true;
                this.app.ticker.add(this._animateZoom, this);
            }
            return;
        }

        // Shift+wheel = horizontal pan
        if (e.shiftKey) {
            this.sceneContainer.x -= e.deltaY * 0.8;
            this.targetX = this.sceneContainer.x;
            return;
        }

        // Regular wheel = vertical pan
        this.sceneContainer.y -= e.deltaY * 0.8;
        this.targetY = this.sceneContainer.y;
    }

    _animateZoom() {
        const sc = this.sceneContainer;
        const currentScale = sc.scale.x;
        const newScale = currentScale + (this.targetScale - currentScale) * ZOOM_LERP;
        const newX = sc.x + (this.targetX - sc.x) * ZOOM_LERP;
        const newY = sc.y + (this.targetY - sc.y) * ZOOM_LERP;

        sc.scale.set(newScale);
        sc.x = newX;
        sc.y = newY;

        this.drawGridLines(); // adjust line width for new zoom

        if (Math.abs(this.targetScale - newScale) < 0.0001 &&
            Math.abs(this.targetX - newX) < 0.1 &&
            Math.abs(this.targetY - newY) < 0.1) {
            sc.scale.set(this.targetScale);
            sc.x = this.targetX;
            sc.y = this.targetY;
            this.app.ticker.remove(this._animateZoom, this);
            this.isAnimating = false;
        }
    }

    // ── Texture creation ────────────────────────────────────────────────────

    /**
     * Build a cache key for a grid item's texture.
     */
    _cacheKey(item) {
        if (!item) return null;
        if (item.type !== 'unicode' && item.src) return item.src;
        return `unicode:${item.char || ''}:${item.color || ''}`;
    }

    /**
     * Synchronous cache lookup — returns the cached texture or Texture.EMPTY.
     * Only call after textures have been pre-loaded via getTextureForItem().
     */
    getTextureForItemCached(item) {
        if (!item) return Texture.EMPTY;
        const key = this._cacheKey(item);
        return this.textureCache.get(key) || Texture.EMPTY;
    }

    /**
     * Return a PixiJS Texture for the given grid item.
     * Image items are loaded via Assets.load; unicode/emoji items are
     * rendered to an offscreen canvas.  Results are cached.
     */
    async getTextureForItem(item) {
        if (!item) return Texture.EMPTY;

        const key = this._cacheKey(item);
        if (this.textureCache.has(key)) return this.textureCache.get(key);

        if (item.type !== 'unicode' && item.src) {
            // Image tile
            try {
                const texture = await Assets.load(item.src);
                this.textureCache.set(key, texture);
                return texture;
            } catch (e) {
                console.warn('Failed to load texture:', item.src, e);
                return Texture.EMPTY;
            }
        }

        // Unicode/emoji — render to offscreen canvas
        const size = CELL_SIZE * 2; // render at 2x for crisp text
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Background color (items with color but no char produce a solid square)
        if (item.color) {
            ctx.fillStyle = item.color;
            ctx.fillRect(0, 0, size, size);
        }

        // Draw emoji/char centered
        if (item.char) {
            ctx.font = `${size * 0.7}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(item.char, size / 2, size / 2);
        }

        const texture = Texture.from(canvas);
        this.textureCache.set(key, texture);
        return texture;
    }

    // ── Grid rendering ──────────────────────────────────────────────────────

    /**
     * (Re-)draw the full grid from state.grid.
     * Pre-loads all unique textures, then creates sprites synchronously.
     */
    async drawGrid() {
        const { rows, cols } = state;
        const screenW = this.app.screen.width;
        const screenH = this.app.screen.height;

        // Grid pixel dimensions
        const gridW = cols * CELL_STRIDE - CELL_GAP;
        const gridH = rows * CELL_STRIDE - CELL_GAP;

        // Center the grid in world space
        const offsetX = (screenW - gridW) / 2;
        const offsetY = (screenH - gridH) / 2;
        this.gridInfo = { cols, rows, offsetX, offsetY, gridW, gridH };

        // Pre-load all unique textures
        const uniqueItems = new Map();
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const item = state.grid[r]?.[c];
                if (item) {
                    const key = this._cacheKey(item);
                    if (!uniqueItems.has(key)) uniqueItems.set(key, item);
                }
            }
        }
        await Promise.all([...uniqueItems.values()].map(item => this.getTextureForItem(item)));

        // Destroy old sprites to free GPU resources
        for (const sprite of this.cellSprites.values()) {
            sprite.destroy();
        }
        this.cellContainer.removeChildren();
        this.cellSprites.clear();

        // Create sprites synchronously (all textures already cached)
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const item = state.grid[r]?.[c];
                const texture = this.getTextureForItemCached(item);
                const sprite = new Sprite(texture);
                sprite.x = offsetX + c * CELL_STRIDE;
                sprite.y = offsetY + r * CELL_STRIDE;
                sprite.width = CELL_SIZE;
                sprite.height = CELL_SIZE;
                this.cellContainer.addChild(sprite);
                this.cellSprites.set(`${r},${c}`, sprite);
            }
        }

        // fitToView() calls drawGridLines() internally with the correct scale
        this.fitToView();

        // Draw selection overlay on top of the grid
        this.drawSelection();
    }

    // ── Theme integration ──────────────────────────────────────────────────

    updateBackground(color) {
        this.app.renderer.background.color = color;
    }

    getGridLineColor() {
        // Use theme's border-adjacent color; fall back to constant
        const hex = state.themeSettings.buttonText || '#555555';
        return parseInt(hex.replace('#', ''), 16);
    }

    // ── Selection overlay ──────────────────────────────────────────────────

    drawSelection() {
        this.selectionGraphics.clear();
        if (!state.selection?.length) return;

        const { offsetX, offsetY } = this.gridInfo;

        for (const rect of state.selection) {
            const x = offsetX + rect.left * CELL_STRIDE - 1;
            const y = offsetY + rect.top * CELL_STRIDE - 1;
            const w = (rect.right - rect.left + 1) * CELL_STRIDE - CELL_GAP + 2;
            const h = (rect.bottom - rect.top + 1) * CELL_STRIDE - CELL_GAP + 2;

            this.selectionGraphics.rect(x, y, w, h);
        }

        this.selectionGraphics.stroke({ width: 2, color: 0xffa500 });
        this.selectionGraphics.fill({ color: 0xffa500, alpha: 0.15 });
    }

    // ── Grid lines ──────────────────────────────────────────────────────────

    drawGridLines() {
        if (!this.gridInfo) return;
        const { cols, rows, offsetX, offsetY, gridW, gridH } = this.gridInfo;
        const scale = this.sceneContainer.scale.x || 1;
        const adjustedWidth = Math.min(2, Math.max(0.5, 1 / scale));

        this.gridGraphics.clear();

        // Vertical lines (at each cell boundary)
        for (let i = 0; i <= cols; i++) {
            const x = offsetX + i * CELL_STRIDE - CELL_GAP / 2;
            this.gridGraphics.moveTo(x, offsetY - CELL_GAP / 2);
            this.gridGraphics.lineTo(x, offsetY + gridH + CELL_GAP / 2);
        }

        // Horizontal lines
        for (let j = 0; j <= rows; j++) {
            const y = offsetY + j * CELL_STRIDE - CELL_GAP / 2;
            this.gridGraphics.moveTo(offsetX - CELL_GAP / 2, y);
            this.gridGraphics.lineTo(offsetX + gridW + CELL_GAP / 2, y);
        }

        this.gridGraphics.stroke({ width: adjustedWidth, color: this.getGridLineColor(), alpha: GRID_LINE_ALPHA });
    }

    // ── Camera fitting ──────────────────────────────────────────────────────

    /**
     * Scale and position the scene so the grid fits within the viewport
     * with some padding.
     */
    fitToView() {
        if (!this.gridInfo) return;
        const { gridW, gridH } = this.gridInfo;
        if (!gridW || !gridH) return;

        const screenW = this.app.screen.width;
        const screenH = this.app.screen.height;
        const padding = CELL_STRIDE * 2;

        const scale = Math.min(
            screenW / (gridW + padding),
            screenH / (gridH + padding)
        );

        this.sceneContainer.scale.set(scale);
        this.sceneContainer.x = (screenW - gridW * scale) / 2 - this.gridInfo.offsetX * scale;
        this.sceneContainer.y = (screenH - gridH * scale) / 2 - this.gridInfo.offsetY * scale;

        this.targetScale = scale;
        this.targetX = this.sceneContainer.x;
        this.targetY = this.sceneContainer.y;

        this.drawGridLines();
    }

    // ── Incremental cell update ─────────────────────────────────────────────

    /**
     * Update a single cell sprite's texture without redrawing the whole grid.
     */
    async updateCell(r, c) {
        const key = `${r},${c}`;
        const item = state.grid[r]?.[c];
        const texture = await this.getTextureForItem(item);
        const sprite = this.cellSprites.get(key);
        if (sprite) {
            sprite.texture = texture;
        }
    }

    // ── Freeform rendering ─────────────────────────────────────────────────

    async updateFreeformLayer() {
        this.freeformContainer.removeChildren();

        if (state.canvasMode !== 'freeform') return;

        for (const stamp of state.freeformStamps) {
            const texture = await this.getTextureForItem(stamp.item);
            const sprite = new Sprite(texture);
            sprite.x = this.gridInfo.offsetX + stamp.x;
            sprite.y = this.gridInfo.offsetY + stamp.y;
            sprite.width = CELL_SIZE;
            sprite.height = CELL_SIZE;
            this.freeformContainer.addChild(sprite);
        }
    }

    setFreeformMode(enabled) {
        this.cellContainer.alpha = enabled ? 0.3 : 1;
        this.gridGraphics.alpha = enabled ? 0.15 : 1;
        this.selectionGraphics.visible = !enabled;
        this.freeformContainer.visible = enabled;
    }

    // ── Teardown ────────────────────────────────────────────────────────────

    destroy() {
        // Remove event listeners
        window.removeEventListener('keydown', this._onKeyDown, true);
        window.removeEventListener('keyup', this._onKeyUp, true);
        this._resizeObserver?.disconnect();

        for (const tex of this.textureCache.values()) {
            tex.destroy?.(true);
        }
        this.textureCache.clear();
        this.cellSprites.clear();
        this.app.destroy(true, { children: true });
    }
}
