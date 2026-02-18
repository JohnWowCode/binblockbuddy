// ── Topbar menu behavior ─────────────────────────────────────────────────────

let openMenu = null;

function closeAllMenus() {
    document.querySelectorAll('.topbar-dropdown.open').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.topbar-menu-label.menu-open').forEach(l => l.classList.remove('menu-open'));
    openMenu = null;
}

function toggleMenu(label, dropdown) {
    const wasOpen = dropdown.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) {
        dropdown.classList.add('open');
        label.classList.add('menu-open');
        openMenu = dropdown;
    }
}

// ── Initialization ───────────────────────────────────────────────────────────

export function initTopbar() {
    // Wire up menu labels
    document.querySelectorAll('.topbar-menu-label').forEach(label => {
        const menuId = label.dataset.menu;
        const dropdown = document.getElementById(menuId);
        if (!dropdown) return;

        label.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMenu(label, dropdown);
        });

        // Hover-to-switch: if a menu is already open, hovering another label opens it
        label.addEventListener('mouseenter', () => {
            if (openMenu && openMenu !== dropdown) {
                toggleMenu(label, dropdown);
            }
        });
    });

    // Close menu when a menu item is clicked
    document.querySelectorAll('.topbar-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            closeAllMenus();
        });
    });

    // Close menus on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.topbar-menu')) {
            closeAllMenus();
        }
    });

    // Close menus on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && openMenu) {
            closeAllMenus();
        }
    });
}
