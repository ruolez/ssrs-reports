// Reports page functionality
let allReports = [];

async function loadReports() {
    try {
        showLoading();
        const data = await apiGet('/api/reports');
        allReports = data.reports || [];
        renderReports(allReports);
    } catch (error) {
        showToast('Failed to load reports: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function scanReports() {
    try {
        showLoading();
        const data = await apiPost('/api/reports/scan');
        showToast(data.message || 'Reports scanned successfully');
        await loadReports();
    } catch (error) {
        showToast('Failed to scan reports: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderReports(reports) {
    const container = document.getElementById('reportsContainer');

    if (reports.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <div class="empty-state-title">No reports found</div>
                <div class="empty-state-text">Click "Scan Reports" to discover RDL files in the reports directory.</div>
            </div>
        `;
        return;
    }

    // Group by folder
    const grouped = {};
    reports.forEach(report => {
        const folder = report.folder || 'Uncategorized';
        if (!grouped[folder]) {
            grouped[folder] = [];
        }
        grouped[folder].push(report);
    });

    let html = '<div class="reports-grid">';

    // Sort folders, put Uncategorized last
    const folders = Object.keys(grouped).sort((a, b) => {
        if (a === 'Uncategorized') return 1;
        if (b === 'Uncategorized') return -1;
        return a.localeCompare(b);
    });

    for (const folder of folders) {
        grouped[folder].forEach(report => {
            const params = JSON.parse(report.parameters || '[]');
            const paramCount = params.length;

            html += `
                <div class="report-card" onclick="openReport(${report.id})">
                    <div class="report-card-title">${escapeHtml(report.display_name)}</div>
                    ${report.folder ? `<div class="report-card-folder">📁 ${escapeHtml(report.folder)}</div>` : ''}
                    ${paramCount > 0 ? `<div class="report-card-params">📝 ${paramCount} parameter${paramCount > 1 ? 's' : ''}</div>` : ''}
                </div>
            `;
        });
    }

    html += '</div>';
    container.innerHTML = html;
}

function openReport(reportId) {
    window.location.href = `/viewer/${reportId}`;
}

function filterReports(searchTerm) {
    const term = searchTerm.toLowerCase();
    const filtered = allReports.filter(report => {
        return report.display_name.toLowerCase().includes(term) ||
               (report.folder && report.folder.toLowerCase().includes(term));
    });
    renderReports(filtered);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadReports();

    // Scan button
    document.getElementById('scanBtn').addEventListener('click', scanReports);

    // Search
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', debounce((e) => {
        filterReports(e.target.value);
    }, 300));
});
