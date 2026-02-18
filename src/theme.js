import { state, themeDefaults, themePresets, THEME_STORAGE_KEY } from './state.js';

// ── Theme persistence ────────────────────────────────────────────────────────

function loadThemeSettings() {
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        state.themeSettings = { ...themeDefaults, ...parsed };
    } catch (e) {
        state.themeSettings = { ...themeDefaults };
    }
}

function persistThemeSettings() {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state.themeSettings));
    } catch (e) {
        // ignore storage errors
    }
}

// ── Theme application ────────────────────────────────────────────────────────

function applyThemeSettings() {
    const root = document.documentElement;
    root.style.setProperty('--color-main-bg', state.themeSettings.mainBg);
    root.style.setProperty('--color-panel-bg', state.themeSettings.panelBg);
    root.style.setProperty('--color-canvas-bg', state.themeSettings.canvasBg);
    root.style.setProperty('--color-grid-bg', state.themeSettings.gridBg);
    root.style.setProperty('--color-btn-bg', state.themeSettings.buttonBg);
    root.style.setProperty('--color-btn-text', state.themeSettings.buttonText);
}

// ── Overlay panels ───────────────────────────────────────────────────────────

function openSettingsPanel() {
    const overlay = document.getElementById("settingsOverlay");
    if (!overlay) return;
    // ensure latest settings are reflected in inputs
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

    overlay.style.display = "flex";
}

function closeSettingsPanel() {
    const overlay = document.getElementById("settingsOverlay");
    if (overlay) overlay.style.display = "none";
}

function openHelpPanel() {
    const overlay = document.getElementById("helpOverlay");
    if (overlay) overlay.style.display = "flex";
}

function closeHelpPanel() {
    const overlay = document.getElementById("helpOverlay");
    if (overlay) overlay.style.display = "none";
}

function openChangelog() {
    const overlay = document.getElementById("changelogOverlay");
    if (overlay) overlay.style.display = "flex";
}

function closeChangelog() {
    const overlay = document.getElementById("changelogOverlay");
    if (overlay) overlay.style.display = "none";
}

function openExperimentalWarning() {
    alert("\u26A0\uFE0F Experimental Features Warning\n\nGimport and large animations are experimental, as is Freeform mode.\n\nG-Mode and I-Mode are mainly designed for importing and exporting and can cause some slight issues to occur.");
}

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

    persistThemeSettings();
    applyThemeSettings();
}

function resetThemeToDefaults() {
    state.themeSettings = { ...themeDefaults };
    persistThemeSettings();
    applyThemeSettings();
    // refresh UI inputs if panel is open
    openSettingsPanel();
}

function applyThemePreset(key) {
    const preset = themePresets[key];
    if (!preset) return;
    state.themeSettings = { ...themeDefaults, ...preset };
    persistThemeSettings();
    applyThemeSettings();
    openSettingsPanel();
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
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { loadThemeSettings, persistThemeSettings, applyThemeSettings, toggleTheme };
