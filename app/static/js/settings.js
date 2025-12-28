// Settings page functionality

async function loadSettings() {
    try {
        // Load theme from localStorage
        const theme = localStorage.getItem('theme') || 'dark';
        document.getElementById('settingTheme').value = theme;
    } catch (error) {
        showToast('Failed to load settings: ' + error.message, 'error');
    }
}

function saveTheme(theme) {
    localStorage.setItem('theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    showToast('Theme updated');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();

    // Theme change
    document.getElementById('settingTheme').addEventListener('change', (e) => {
        saveTheme(e.target.value);
    });
});
