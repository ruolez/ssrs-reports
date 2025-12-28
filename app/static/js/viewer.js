// Report Viewer functionality
let reportData = null;
let currentParams = {};
let currentSortColumn = null;
let currentSortDirection = 'asc';

async function loadReport() {
    try {
        showLoading();
        const data = await apiGet(`/api/reports/${REPORT_ID}`);
        reportData = data.report;

        // Update title
        document.getElementById('reportTitle').textContent = reportData.display_name;
        document.title = `${reportData.display_name} - RDL Report Viewer`;

        // Render parameter form
        const parameters = JSON.parse(reportData.parameters || '[]');
        renderParameterForm(parameters);

        // Auto-run if no required parameters
        if (parameters.length === 0 || parameters.every(p => p.default_value)) {
            await runReport();
        }
    } catch (error) {
        showToast('Failed to load report: ' + error.message, 'error');
        document.getElementById('reportContent').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <div class="empty-state-title">Error loading report</div>
                <div class="empty-state-text">${escapeHtml(error.message)}</div>
            </div>
        `;
    } finally {
        hideLoading();
    }
}

function renderParameterForm(parameters) {
    const container = document.getElementById('parameterForm');

    if (parameters.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    let html = '';
    parameters.forEach(param => {
        const inputType = param.data_type === 'DateTime' ? 'date' : 'text';
        const defaultValue = param.default_value || '';
        currentParams[param.name] = defaultValue;

        html += `
            <div class="param-group">
                <label class="param-label">${escapeHtml(param.prompt || param.name)}</label>
                <input type="${inputType}"
                       class="param-input"
                       name="${param.name}"
                       value="${escapeHtml(defaultValue)}"
                       placeholder="${escapeHtml(param.prompt || param.name)}">
            </div>
        `;
    });

    html += `
        <div class="param-group">
            <label class="param-label">&nbsp;</label>
            <button class="btn btn-primary" onclick="runReport()">▶ Run Report</button>
        </div>
    `;

    container.innerHTML = html;

    // Add input listeners
    container.querySelectorAll('.param-input').forEach(input => {
        input.addEventListener('change', (e) => {
            currentParams[e.target.name] = e.target.value;
        });
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                runReport();
            }
        });
    });
}

async function runReport() {
    try {
        showLoading();

        // Collect current parameter values
        document.querySelectorAll('.param-input').forEach(input => {
            currentParams[input.name] = input.value;
        });

        const data = await apiPost(`/api/reports/${REPORT_ID}/execute`, {
            parameters: currentParams,
            sort_column: currentSortColumn,
            sort_direction: currentSortDirection
        });

        document.getElementById('reportContent').innerHTML = data.html;
        document.getElementById('exportBtn').disabled = false;

        // Add sort handlers
        document.querySelectorAll('.report-table th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.column;
                if (currentSortColumn === column) {
                    currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSortColumn = column;
                    currentSortDirection = 'asc';
                }
                runReport();
            });
        });

        // Handle drillthrough links
        document.querySelectorAll('.drillthrough-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const href = link.getAttribute('href');
                handleDrillthrough(href);
            });
        });

        if (data.row_count === 0) {
            document.getElementById('reportContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <div class="empty-state-title">No data</div>
                    <div class="empty-state-text">The report returned no results. Try adjusting your parameters.</div>
                </div>
            `;
        }
    } catch (error) {
        showToast('Failed to run report: ' + error.message, 'error');
        document.getElementById('reportContent').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <div class="empty-state-title">Error running report</div>
                <div class="empty-state-text">${escapeHtml(error.message)}</div>
                <a href="/datasources" class="btn btn-primary mt-4">Configure Data Sources</a>
            </div>
        `;
    } finally {
        hideLoading();
    }
}

function handleDrillthrough(href) {
    // Parse drillthrough URL: /viewer/drillthrough?report=ReportName&Param=Value
    const url = new URL(href, window.location.origin);
    const reportName = url.searchParams.get('report');
    const params = {};

    url.searchParams.forEach((value, key) => {
        if (key !== 'report') {
            params[key] = value;
        }
    });

    // Navigate to report by name
    // First find the report ID
    findAndOpenReport(reportName, params);
}

async function findAndOpenReport(reportName, params) {
    try {
        showLoading();
        const data = await apiGet('/api/reports');
        const reports = data.reports || [];

        // Find report by name (case-insensitive)
        const report = reports.find(r =>
            r.display_name.toLowerCase() === reportName.toLowerCase()
        );

        if (report) {
            // Build URL with parameters
            const paramStr = Object.entries(params)
                .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                .join('&');
            window.location.href = `/viewer/${report.id}?${paramStr}`;
        } else {
            showToast(`Report "${reportName}" not found`, 'error');
        }
    } catch (error) {
        showToast('Failed to find report: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function exportReport(format) {
    try {
        showLoading();
        closeExportMenu();

        const response = await fetch(`/api/reports/${REPORT_ID}/export/${format}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ parameters: currentParams })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Export failed');
        }

        // Download file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${reportData.display_name}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        showToast('Export completed');
    } catch (error) {
        showToast('Export failed: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function toggleExportMenu() {
    const menu = document.getElementById('exportMenu');
    menu.classList.toggle('show');
}

function closeExportMenu() {
    document.getElementById('exportMenu').classList.remove('show');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadReport();

    // Export button dropdown
    document.getElementById('exportBtn').addEventListener('click', toggleExportMenu);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            closeExportMenu();
        }
    });

    // Check for URL parameters (from drillthrough)
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.forEach((value, key) => {
        currentParams[key] = value;
    });
});
