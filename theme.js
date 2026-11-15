(() => {
    const storageKey = 'shared_calendar_theme';
    const root = document.documentElement;

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        const background = isDark ? '#0b0d13' : '#f5f7f6';
        root.dataset.theme = theme;
        // Set the page canvas before the styles and external SDKs finish loading.
        root.style.colorScheme = theme;
        root.style.backgroundColor = background;
        document.querySelector('meta[name="theme-color"]').setAttribute('content', background);

        const button = document.getElementById('btn-toggle-theme');
        if (button) {
            const label = isDark ? '라이트 모드' : '다크 모드';
            button.setAttribute('aria-label', `${label}로 전환`);
            button.title = `${label}로 전환`;
            document.getElementById('theme-toggle-icon').textContent = isDark ? 'light_mode' : 'dark_mode';
            document.getElementById('theme-toggle-label').textContent = label;
        }
    }

    let theme = 'dark';
    try {
        if (localStorage.getItem(storageKey) === 'light') theme = 'light';
    } catch {
        // Storage can be unavailable; the switch must still work for this visit.
    }
    applyTheme(theme);

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(root.dataset.theme);
        document.getElementById('btn-toggle-theme').addEventListener('click', () => {
            const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
            applyTheme(nextTheme);
            try {
                localStorage.setItem(storageKey, nextTheme);
            } catch {
                // Applying the theme does not depend on saving the preference.
            }
        });
    });
})();
