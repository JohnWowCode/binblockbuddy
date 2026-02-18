import { state, themeDefaults, themePresets, THEME_STORAGE_KEY } from './state.js';

// ── Theme persistence ────────────────────────────────────────────────────────

function loadThemeSettings() {
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        state.themeSettings = { ...themeDefaults, ...parsed };
        if ('activePreset' in parsed) {
            state.activeThemePreset = parsed.activePreset;
        }
    } catch (e) {
        state.themeSettings = { ...themeDefaults };
    }
}

function persistThemeSettings() {
    try {
        const data = { ...state.themeSettings, activePreset: state.activeThemePreset };
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        // ignore storage errors
    }
}

// ── Theme application ────────────────────────────────────────────────────────

function hexLuminance(hex) {
    // Parse hex color and return relative luminance (0 = black, 1 = white)
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function applyThemeSettings() {
    const root = document.documentElement;
    root.style.setProperty('--color-main-bg', state.themeSettings.mainBg);
    root.style.setProperty('--color-panel-bg', state.themeSettings.panelBg);
    root.style.setProperty('--color-canvas-bg', state.themeSettings.canvasBg);
    root.style.setProperty('--color-grid-bg', state.themeSettings.gridBg);
    root.style.setProperty('--color-btn-bg', state.themeSettings.buttonBg);
    root.style.setProperty('--color-btn-text', state.themeSettings.buttonText);

    // Derive light/dark secondary variables from the background luminance
    const isLight = hexLuminance(state.themeSettings.mainBg) > 0.45;
    const accent = state.themeSettings.buttonText;
    root.style.setProperty('--color-text', isLight ? '#111' : '#eee');
    root.style.setProperty('--color-border', isLight ? '#888' : '#555');
    root.style.setProperty('--color-border-panel', isLight ? '#ccc' : '#333');
    root.style.setProperty('--color-hover-bg', isLight ? '#f0f0f0' : '#262626');
    root.style.setProperty('--color-hover-border', accent);
    root.style.setProperty('--color-accent', accent);
    root.style.setProperty('--color-surface', isLight ? '#ffffff' : '#111');
    root.style.setProperty('--color-surface-alt', isLight ? '#ffffff' : '#222');
}

// ── Dialog helpers ───────────────────────────────────────────────────────────

function openDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && dialog.open) dialog.close();
}

function updatePresetHighlight() {
    document.querySelectorAll('.theme-preset-btn').forEach(btn => {
        const isActive = btn.dataset.preset === state.activeThemePreset;
        btn.classList.toggle('preset-active', isActive);
    });
}

function openSettingsPanel() {
    // ensure latest settings are reflected in inputs before opening
    const mainInput = document.getElementById("themeMainBg");
    const panelInput = document.getElementById("themePanelBg");
    const canvasInput = document.getElementById("themeCanvasBg");
    const gridInput = document.getElementById("themeGridBg");
    const buttonBgInput = document.getElementById("themeButtonBg");
    const buttonTextInput = document.getElementById("themeButtonText");

    if (mainInput) mainInput.value = state.themeSettings.mainBg;
    if (panelInput) panelInput.value = state.themeSettings.panelBg;
    if (canvasInput) canvasInput.value = state.themeSettings.canvasBg;
    if (gridInput) gridInput.value = state.themeSettings.gridBg;
    if (buttonBgInput) buttonBgInput.value = state.themeSettings.buttonBg;
    if (buttonTextInput) buttonTextInput.value = state.themeSettings.buttonText;

    updatePresetHighlight();
    openDialog("settingsDialog");
}

function closeSettingsPanel() { closeDialog("settingsDialog"); }
function openHelpPanel() { openDialog("helpDialog"); }
function closeHelpPanel() { closeDialog("helpDialog"); }
function openChangelog() { openDialog("changelogDialog"); }
function closeChangelog() { closeDialog("changelogDialog"); }
function openExperimentalWarning() { openDialog("warningDialog"); }

// ── Theme UI actions ─────────────────────────────────────────────────────────

function saveThemeSettingsFromUI() {
    const mainInput = document.getElementById("themeMainBg");
    const panelInput = document.getElementById("themePanelBg");
    const canvasInput = document.getElementById("themeCanvasBg");
    const gridInput = document.getElementById("themeGridBg");
    const buttonBgInput = document.getElementById("themeButtonBg");
    const buttonTextInput = document.getElementById("themeButtonText");

    if (mainInput && mainInput.value) state.themeSettings.mainBg = mainInput.value;
    if (panelInput && panelInput.value) state.themeSettings.panelBg = panelInput.value;
    if (canvasInput && canvasInput.value) state.themeSettings.canvasBg = canvasInput.value;
    if (gridInput && gridInput.value) state.themeSettings.gridBg = gridInput.value;
    if (buttonBgInput && buttonBgInput.value) state.themeSettings.buttonBg = buttonBgInput.value;
    if (buttonTextInput && buttonTextInput.value) state.themeSettings.buttonText = buttonTextInput.value;

    // Custom color change clears the active preset
    state.activeThemePreset = null;
    updatePresetHighlight();

    persistThemeSettings();
    applyThemeSettings();
}

function resetThemeToDefaults() {
    state.themeSettings = { ...themeDefaults };
    state.activeThemePreset = "defaultDark";
    persistThemeSettings();
    applyThemeSettings();
    // refresh UI inputs if panel is open
    openSettingsPanel();
}

function applyThemePreset(key) {
    const preset = themePresets[key];
    if (!preset) return;
    state.themeSettings = { ...themeDefaults, ...preset };
    state.activeThemePreset = key;
    persistThemeSettings();
    applyThemeSettings();
    updatePresetHighlight();
    // refresh color inputs if panel is open
    const mainInput = document.getElementById("themeMainBg");
    if (mainInput) mainInput.value = state.themeSettings.mainBg;
    const panelInput = document.getElementById("themePanelBg");
    if (panelInput) panelInput.value = state.themeSettings.panelBg;
    const canvasInput = document.getElementById("themeCanvasBg");
    if (canvasInput) canvasInput.value = state.themeSettings.canvasBg;
    const gridInput = document.getElementById("themeGridBg");
    if (gridInput) gridInput.value = state.themeSettings.gridBg;
    const buttonBgInput = document.getElementById("themeButtonBg");
    if (buttonBgInput) buttonBgInput.value = state.themeSettings.buttonBg;
    const buttonTextInput = document.getElementById("themeButtonText");
    if (buttonTextInput) buttonTextInput.value = state.themeSettings.buttonText;
}

// ── Theme toggle ─────────────────────────────────────────────────────────────

function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById("themeToggle");
    const isLight = body.classList.toggle("light-mode");
    if (btn) {
        btn.textContent = isLight ? "\u2600\uFE0F" : "\uD83C\uDF19";
    }
}

// ── Initialization ───────────────────────────────────────────────────────────

export function initTheme() {
    loadThemeSettings();
    applyThemeSettings();

    // Settings button
    document.getElementById('settingsButton')?.addEventListener('click', openSettingsPanel);
    document.getElementById('helpButton')?.addEventListener('click', openHelpPanel);
    document.getElementById('changelogButton')?.addEventListener('click', openChangelog);
    document.getElementById('warningButton')?.addEventListener('click', openExperimentalWarning);

    // Preset buttons
    document.getElementById('presetDefaultDark')?.addEventListener('click', () => applyThemePreset('defaultDark'));
    document.getElementById('presetDefaultLight')?.addEventListener('click', () => applyThemePreset('defaultLight'));
    document.getElementById('presetOzy')?.addEventListener('click', () => applyThemePreset('ozy'));
    document.getElementById('presetJack')?.addEventListener('click', () => applyThemePreset('jack'));
    document.getElementById('presetSlime')?.addEventListener('click', () => applyThemePreset('slime'));
    document.getElementById('presetLava')?.addEventListener('click', () => applyThemePreset('lava'));

    // Color inputs
    ['themeMainBg', 'themePanelBg', 'themeCanvasBg', 'themeGridBg', 'themeButtonBg', 'themeButtonText'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', saveThemeSettingsFromUI);
    });

    // Reset and close
    document.getElementById('resetThemeBtn')?.addEventListener('click', resetThemeToDefaults);
    document.getElementById('closeSettingsBtn')?.addEventListener('click', closeSettingsPanel);
    document.getElementById('closeHelpBtn')?.addEventListener('click', closeHelpPanel);
    document.getElementById('closeChangelogBtn')?.addEventListener('click', closeChangelog);
    document.getElementById('closeWarningBtn')?.addEventListener('click', () => closeDialog("warningDialog"));

    // Click-outside-to-close for all app dialogs
    document.querySelectorAll('.app-dialog').forEach(dialog => {
        dialog.addEventListener('click', (e) => {
            // The backdrop click lands on the <dialog> element itself
            if (e.target === dialog) {
                dialog.close();
            }
        });
    });
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { loadThemeSettings, persistThemeSettings, applyThemeSettings, toggleTheme };
