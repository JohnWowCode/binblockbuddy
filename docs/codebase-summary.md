# BinBlockBuddy - Codebase Summary

## What It Is

BinBlockBuddy is a web-based pixel/tile art editor for creating "binblock" art for Discord. Users compose grid-based emoji art using custom emoji tiles, then export colon-delimited codes (`:01::45::22:`) that render as tiled images when pasted into Discord messages.

## Current State

**Three files, ~5,800 lines, zero build system, zero dependencies at install time.**

| File | Lines | Role |
|------|-------|------|
| `index.html` | 402 | Single-page layout with inline event handlers |
| `main.js` | 4,389 | Monolithic script, all global scope, no modules |
| `style.css` | 1,001 | Hand-written, dark terminal aesthetic, no custom properties |

Two asset packs live under `assets/`: Legacy (95 tiles) and USA (1,025 tiles). No `package.json`, no `.gitignore`, no README, no config files of any kind. Five git commits total.

## Architecture

Everything is procedural and global. State lives in top-level `let`/`const` variables (`grid`, `rows`, `cols`, `activeBrush`, `frames`, `history`, `future`). DOM is manipulated directly with `createElement`/`innerHTML`. Event handling is a mix of inline `onclick` attributes in HTML and `addEventListener` calls in JS. External libraries (omggif, gif.js) are loaded lazily from CDNs only when needed.

There is no module system -- `main.js` is a single `<script>` tag. Code is organized by comment-delimited sections but there are no classes, no exports, no separation of concerns beyond visual grouping.

## UI Layout

Three-column flexbox layout:

- **Left (20%)**: Tile palette grid, favorites filter, asset pack selector, custom emoji upload
- **Center (50%)**: Canvas with toolbar, grid controls, tool buttons, animation controls, save/export buttons
- **Right (30%)**: Export text output, copy buttons, row chunking slider, visual preview

Modal overlays for Settings, Help, Changelog, and a saving/progress spinner.

## Feature Inventory

### Core (what most users need)
- Grid-based tile painting (click/drag)
- Brush and bucket fill tools
- Undo/redo (full state snapshots, 100-deep)
- Size presets (Discord 4x7, various art sizes up to 100x100)
- Export as emoji text with copy-to-clipboard
- Export as PNG
- Save/load `.binblock` project files
- Palette with favorites

### Advanced (useful but secondary)
- Image import (converts any image to tile art via nearest-color matching)
- Selection tool with move/duplicate/delete sub-modes
- Mirror mode (horizontal symmetry)
- Zoom (8 levels) and pan (space+drag, scroll)
- GIF import (extract frames to animation)
- GIF export (encode all frames)
- Multi-frame animation (up to 200 frames, 10 FPS playback)
- Asset pack switching (Legacy vs USA, 1,025 tiles)
- Theme system (6 presets + full color customization via 6 color pickers)

### Avant-Garde / Experimental
- **Freeform Mode (Beta)**: free-placement stamp painting off the grid, 5 brush sizes, 5 shapes (square, circle, cross, triangle, arrow) -- entirely different interaction model
- **Random generators**: Random Infinite, Random Face, Random Flower, Random House (plus abandoned Cat, Dog, Car, Alien)
- **Inline GIF encoder**: full LZW compression implementation as fallback (~250 lines)
- **Custom emoji upload with rename**: lets users add their own tile images

## What Makes It Complex

1. **The toolbar is overloaded.** Grid controls, tool buttons, brush sizes, animation controls, random generators, and save buttons all compete for space in the center column. Every feature is visible at once.

2. **Freeform mode is a parallel universe.** It has its own rendering layer, its own state (`freeformStamps`), its own brush system, its own selection logic. It hides the export panel and takes over the UI. It's essentially a second app embedded in the first.

3. **The export panel is always visible.** Even when the user is just painting and not ready to export, 30% of the screen is dedicated to export output.

4. **Random generators are prominent toolbar buttons.** They're fun but niche -- they occupy prime toolbar real estate alongside core tools.

5. **Animation controls are always shown.** Frame navigation, add/delete/duplicate -- visible even when the user has a single frame.

6. **The settings overlay controls everything about theming** but nothing about behavior. Actual behavioral settings (like grid size) are scattered across the toolbar.

## Technical Debt

- **Single 4,389-line file** with all logic in global scope
- **No module system** -- cannot tree-shake, lazy-load features, or test in isolation
- **Mixed event binding** -- some `onclick=""` in HTML, some `addEventListener` in JS
- **No CSS custom properties** -- theme system manually sets `style.backgroundColor` on individual elements via JS instead of using `var(--color)`
- **Undo captures full grid snapshots** -- works but scales poorly with large grids
- **No error boundaries** -- CDN failures for gif libs silently cascade through multiple fallback attempts
- **No mobile/responsive design** -- desktop-only layout
- **Asset preloading is eager** -- all tiles loaded upfront regardless of pack selection

## Recommendations for Modernization

### Keep: No Build System
The project's simplicity is a feature. Modern browsers support everything needed natively.

### Adopt: ES Modules + Import Maps
Split `main.js` into focused modules loaded via `<script type="module">` and `<script type="importmap">`:

```
src/
  core/          -- grid state, history, serialization
  tools/         -- brush, bucket, selection, mirror
  palette/       -- palette rendering, favorites, color matching
  export/        -- text export, PNG export, copy
  canvas/        -- rendering, zoom, pan, viewport
  theme/         -- CSS custom properties + presets
  addons/
    animation/   -- multi-frame, GIF import/export
    freeform/    -- freeform stamp mode
    generators/  -- random face/flower/house/etc
    custom-emoji/ -- upload + rename custom tiles
```

### Adopt: CSS Custom Properties for Theming
Replace the JS-driven theme system with `var(--bg-main)`, `var(--bg-panel)`, etc. Theme presets become simple class swaps or `data-theme` attribute changes.

### Simplify: Progressive UI Disclosure
- **Default view**: palette + canvas + minimal toolbar (brush, bucket, undo/redo, size, clear, export)
- **Export panel**: collapsed by default, expands on demand or on first export action
- **Animation controls**: hidden until user explicitly enables animation mode
- **Freeform mode**: accessible via menu/settings, not a prominent toggle
- **Random generators**: moved to a "Generate" dropdown or addon panel
- **Advanced tools** (selection, mirror, zoom controls): available in an expanded toolbar or command palette
- **Brush size/shape controls**: only shown when freeform mode is active (already partially true)

### Simplify: Addon Architecture
Features like animation, freeform mode, random generators, and GIF import/export can be self-registering ES modules. The core app exposes hooks (tool registry, panel slots, menu items) and addons opt in:

```js
// addons/animation/index.js
import { registerAddon } from '../../core/addons.js';
registerAddon({
  name: 'animation',
  toolbar: () => createAnimationControls(),
  state: () => ({ frames: [], currentFrame: 0 }),
  // ...
});
```

This keeps the core ~1,000 lines focused on grid painting and export, with everything else loaded on demand.
