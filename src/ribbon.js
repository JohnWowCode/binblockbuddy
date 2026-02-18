// ── Ribbon tab switching ─────────────────────────────────────────────────────

export function initRibbon() {
    const tabs = document.querySelectorAll('.ribbon-tab');
    const panes = document.querySelectorAll('.ribbon-pane');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.ribbon;

            // Update tab active state
            tabs.forEach(t => t.classList.remove('ribbon-tab-active'));
            tab.classList.add('ribbon-tab-active');

            // Show the matching pane
            panes.forEach(p => {
                if (p.dataset.ribbon === target) {
                    p.classList.add('ribbon-pane-active');
                } else {
                    p.classList.remove('ribbon-pane-active');
                }
            });
        });
    });
}
