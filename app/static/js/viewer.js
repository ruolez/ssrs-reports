// Report Viewer - Professional Edition
// Comprehensive viewer with zoom, font controls, search, filters, and more

// ============== State Management ==============
let reportData = null;
let currentParams = {};
let currentSortColumn = null;
let currentSortDirection = 'asc';
let totalRowCount = 0;
let execTimeMs = 0;
let datasourceStatus = [];
let availableConnections = [];

// Viewer preferences (localStorage)
const STORAGE_PREFIX = 'rdl_viewer_';

// ============== Preference Management ==============
function savePreference(key, value) {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
}

function loadPreference(key, defaultValue) {
    const stored = localStorage.getItem(STORAGE_PREFIX + key);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            return defaultValue;
        }
    }
    return defaultValue;
}

// ============== Zoom Controls ==============
let currentZoom = loadPreference('zoom', 100);

function setZoom(level) {
    level = Math.max(50, Math.min(200, level));
    currentZoom = level;
    document.documentElement.style.setProperty('--viewer-zoom', level / 100);
    document.getElementById('zoomSelect').value = level;
    savePreference('zoom', level);
}

function zoomIn() {
    const levels = [50, 75, 100, 125, 150, 200];
    const currentIdx = levels.indexOf(currentZoom);
    if (currentIdx < levels.length - 1) {
        setZoom(levels[currentIdx + 1]);
    } else if (currentZoom < 200) {
        setZoom(Math.min(200, currentZoom + 25));
    }
}

function zoomOut() {
    const levels = [50, 75, 100, 125, 150, 200];
    const currentIdx = levels.indexOf(currentZoom);
    if (currentIdx > 0) {
        setZoom(levels[currentIdx - 1]);
    } else if (currentZoom > 50) {
        setZoom(Math.max(50, currentZoom - 25));
    }
}

function fitToWidth() {
    const container = document.getElementById('zoomContainer');
    const wrapper = document.querySelector('.report-table-wrapper');
    if (container && wrapper) {
        const containerWidth = container.clientWidth;
        const tableWidth = wrapper.scrollWidth / (currentZoom / 100);
        const newZoom = Math.floor((containerWidth / tableWidth) * 100);
        setZoom(Math.max(50, Math.min(200, newZoom)));
    }
}

function actualSize() {
    setZoom(100);
}

// ============== Font Size Controls ==============
const FONT_SIZES = {
    tiny: '9px',
    xsmall: '10px',
    small: '11px',
    medium: '13px',
    large: '15px',
    xlarge: '17px'
};
const FONT_SIZE_ORDER = ['tiny', 'xsmall', 'small', 'medium', 'large', 'xlarge'];
let currentFontSize = loadPreference('fontSize', 'medium');

function setFontSize(size) {
    if (FONT_SIZES[size]) {
        currentFontSize = size;
        document.documentElement.style.setProperty('--viewer-font-size', FONT_SIZES[size]);
        document.getElementById('fontSizeSelect').value = size;
        savePreference('fontSize', size);
    }
}

function increaseFontSize() {
    const idx = FONT_SIZE_ORDER.indexOf(currentFontSize);
    if (idx < FONT_SIZE_ORDER.length - 1) {
        setFontSize(FONT_SIZE_ORDER[idx + 1]);
    }
}

function decreaseFontSize() {
    const idx = FONT_SIZE_ORDER.indexOf(currentFontSize);
    if (idx > 0) {
        setFontSize(FONT_SIZE_ORDER[idx - 1]);
    }
}

// ============== Fullscreen ==============
let isFullscreen = false;

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            showToast('Fullscreen not available', 'error');
        });
    } else {
        document.exitFullscreen();
    }
}

document.addEventListener('fullscreenchange', () => {
    isFullscreen = !!document.fullscreenElement;
    const btn = document.getElementById('fullscreenBtn');
    const icon = btn.querySelector('i');
    if (isFullscreen) {
        icon.setAttribute('data-lucide', 'minimize');
    } else {
        icon.setAttribute('data-lucide', 'maximize');
    }
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});

// ============== Search Functionality ==============
class ReportSearch {
    constructor() {
        this.matches = [];
        this.currentIndex = -1;
        this.lastTerm = '';
    }

    search(term) {
        this.clearHighlights();
        this.matches = [];
        this.currentIndex = -1;

        if (!term || term.length < 2) {
            this.updateCounter();
            return;
        }

        this.lastTerm = term;
        const table = document.querySelector('.report-table tbody');
        if (!table) return;

        const cells = table.querySelectorAll('td');
        const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');

        cells.forEach(cell => {
            if (cell.textContent.toLowerCase().includes(term.toLowerCase())) {
                const originalHTML = cell.innerHTML;
                // Only highlight text nodes, not links
                if (!cell.querySelector('a')) {
                    cell.innerHTML = cell.innerHTML.replace(regex, '<span class="search-highlight">$1</span>');
                    const highlights = cell.querySelectorAll('.search-highlight');
                    highlights.forEach(h => this.matches.push(h));
                } else {
                    // Handle cells with links
                    const textNodes = this.getTextNodes(cell);
                    textNodes.forEach(node => {
                        if (node.textContent.toLowerCase().includes(term.toLowerCase())) {
                            const span = document.createElement('span');
                            span.innerHTML = node.textContent.replace(regex, '<span class="search-highlight">$1</span>');
                            node.parentNode.replaceChild(span, node);
                            const highlights = span.querySelectorAll('.search-highlight');
                            highlights.forEach(h => this.matches.push(h));
                        }
                    });
                }
            }
        });

        if (this.matches.length > 0) {
            this.currentIndex = 0;
            this.highlightCurrent();
        }

        this.updateCounter();
        this.updateButtons();
    }

    getTextNodes(element) {
        const nodes = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.trim()) {
                nodes.push(node);
            }
        }
        return nodes;
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    clearHighlights() {
        document.querySelectorAll('.search-highlight').forEach(el => {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
        });
        this.matches = [];
        this.currentIndex = -1;
    }

    highlightCurrent() {
        this.matches.forEach((m, i) => {
            m.classList.toggle('current', i === this.currentIndex);
        });
        if (this.matches[this.currentIndex]) {
            this.matches[this.currentIndex].scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }

    next() {
        if (this.matches.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.matches.length;
        this.highlightCurrent();
        this.updateCounter();
    }

    prev() {
        if (this.matches.length === 0) return;
        this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
        this.highlightCurrent();
        this.updateCounter();
    }

    updateCounter() {
        const counter = document.getElementById('searchResultsCount');
        if (this.matches.length === 0) {
            counter.textContent = '0 of 0';
        } else {
            counter.textContent = `${this.currentIndex + 1} of ${this.matches.length}`;
        }
    }

    updateButtons() {
        const hasMatches = this.matches.length > 0;
        document.getElementById('searchPrevBtn').disabled = !hasMatches;
        document.getElementById('searchNextBtn').disabled = !hasMatches;
    }

    close() {
        this.clearHighlights();
        this.updateCounter();
        this.updateButtons();
        document.getElementById('searchInput').value = '';
    }
}

const reportSearch = new ReportSearch();

// ============== Column Filters ==============
class ColumnFilters {
    constructor() {
        this.filters = {};
        this.filterRow = null;
    }

    init() {
        const thead = document.querySelector('.report-table thead');
        if (!thead) return;

        // Check if filter row already exists
        if (document.querySelector('.filter-row')) return;

        const headerRow = thead.querySelector('tr');
        const columns = headerRow.querySelectorAll('th');

        // Create filter row
        this.filterRow = document.createElement('tr');
        this.filterRow.className = 'filter-row hidden';

        columns.forEach((col, idx) => {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'filter-input';
            input.placeholder = 'Filter...';
            input.dataset.column = idx;
            input.addEventListener('input', (e) => this.onFilterChange(idx, e.target.value));
            td.appendChild(input);
            this.filterRow.appendChild(td);
        });

        // Insert after header row
        headerRow.after(this.filterRow);
    }

    onFilterChange(columnIndex, value) {
        if (value.trim()) {
            this.filters[columnIndex] = value.toLowerCase();
        } else {
            delete this.filters[columnIndex];
        }
        this.applyFilters();
        this.updateBadge();
        this.updateStatusBar();
    }

    applyFilters() {
        const tbody = document.querySelector('.report-table tbody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr:not(.filter-row)');
        let visibleCount = 0;
        const totalCount = rows.length;

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            let visible = true;

            for (const [colIdx, filterValue] of Object.entries(this.filters)) {
                const cell = cells[parseInt(colIdx)];
                if (cell) {
                    const cellText = cell.textContent.toLowerCase();
                    if (!cellText.includes(filterValue)) {
                        visible = false;
                        break;
                    }
                }
            }

            row.classList.toggle('filtered-out', !visible);
            if (visible) visibleCount++;
        });

        // Update status bar with filtering info
        const statusRowInfo = document.getElementById('statusRowInfo');
        if (visibleCount < totalCount) {
            statusRowInfo.innerHTML = `Showing <strong>${visibleCount.toLocaleString()}</strong> of <strong>${totalCount.toLocaleString()}</strong> rows`;
        } else {
            statusRowInfo.innerHTML = `Showing <strong>${totalCount.toLocaleString()}</strong> rows`;
        }
    }

    updateBadge() {
        const badge = document.getElementById('filterBadge');
        const count = Object.keys(this.filters).length;
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    }

    updateStatusBar() {
        const info = document.getElementById('statusFilterInfo');
        const count = Object.keys(this.filters).length;
        if (count === 0) {
            info.textContent = 'No filters applied';
        } else {
            info.textContent = `${count} filter${count > 1 ? 's' : ''} active`;
        }
    }

    show() {
        if (this.filterRow) {
            this.filterRow.classList.remove('hidden');
        }
    }

    hide() {
        if (this.filterRow) {
            this.filterRow.classList.add('hidden');
        }
    }

    toggle() {
        if (this.filterRow) {
            this.filterRow.classList.toggle('hidden');
            return !this.filterRow.classList.contains('hidden');
        }
        return false;
    }

    clear() {
        this.filters = {};
        document.querySelectorAll('.filter-input').forEach(input => {
            input.value = '';
        });
        this.applyFilters();
        this.updateBadge();
        this.updateStatusBar();
    }
}

const columnFilters = new ColumnFilters();

// ============== Client-Side Sorting ==============
function sortTableClientSide(columnIndex, direction) {
    const table = document.querySelector('.report-table');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr:not(.filter-row)'));
    if (rows.length === 0) return;

    // Sort rows
    rows.sort((a, b) => {
        const cellA = a.querySelectorAll('td')[columnIndex];
        const cellB = b.querySelectorAll('td')[columnIndex];
        if (!cellA || !cellB) return 0;

        let valA = cellA.textContent.trim();
        let valB = cellB.textContent.trim();
        const typeA = cellA.dataset.type || 'text';

        // Handle empty values - sort last
        if (valA === '' && valB === '') return 0;
        if (valA === '') return 1;
        if (valB === '') return -1;

        let comparison = 0;

        if (typeA === 'number') {
            // Remove commas and parse as number
            const numA = parseFloat(valA.replace(/,/g, '')) || 0;
            const numB = parseFloat(valB.replace(/,/g, '')) || 0;
            comparison = numA - numB;
        } else if (typeA === 'date') {
            // Parse dates
            const dateA = new Date(valA);
            const dateB = new Date(valB);
            comparison = dateA - dateB;
        } else {
            // String comparison (case-insensitive)
            comparison = valA.toLowerCase().localeCompare(valB.toLowerCase());
        }

        return direction === 'desc' ? -comparison : comparison;
    });

    // Reorder rows in DOM
    rows.forEach(row => tbody.appendChild(row));

    // Update sort indicators in headers
    updateSortIndicators(columnIndex, direction);

    // Re-apply filters if any
    columnFilters.applyFilters();
}

function updateSortIndicators(columnIndex, direction) {
    const headers = document.querySelectorAll('.report-table th');
    headers.forEach((th, idx) => {
        // Remove existing sort indicator
        const existingIndicator = th.querySelector('.sort-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }

        // Remove aria-sort
        th.removeAttribute('aria-sort');

        // Add indicator to sorted column
        if (idx === columnIndex && th.classList.contains('sortable')) {
            const indicator = document.createElement('span');
            indicator.className = 'sort-indicator';
            indicator.textContent = direction === 'asc' ? ' ▲' : ' ▼';
            th.appendChild(indicator);
            th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
        }
    });
}

// ============== Column Resize ==============
class ColumnResizer {
    constructor() {
        this.isResizing = false;
        this.currentColumn = null;
        this.startX = 0;
        this.startWidth = 0;
        this.reportId = REPORT_ID;
    }

    init() {
        const headers = document.querySelectorAll('.report-table th');
        headers.forEach((th, idx) => {
            th.classList.add('resizable');
            th.dataset.columnIndex = idx;

            th.addEventListener('mousedown', (e) => {
                // Only start resize if clicking on the right edge
                const rect = th.getBoundingClientRect();
                if (e.clientX > rect.right - 10) {
                    this.startResize(e, th);
                }
            });
        });

        document.addEventListener('mousemove', (e) => this.onMouseMove(e));
        document.addEventListener('mouseup', () => this.stopResize());

        // Load saved widths
        this.loadWidths();
    }

    startResize(e, column) {
        this.isResizing = true;
        this.currentColumn = column;
        this.startX = e.clientX;
        this.startWidth = column.offsetWidth;
        column.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    }

    onMouseMove(e) {
        if (!this.isResizing) return;

        const diff = e.clientX - this.startX;
        const newWidth = Math.max(50, Math.min(500, this.startWidth + diff));
        this.currentColumn.style.width = newWidth + 'px';
        this.currentColumn.style.minWidth = newWidth + 'px';
    }

    stopResize() {
        if (!this.isResizing) return;

        this.isResizing = false;
        if (this.currentColumn) {
            this.currentColumn.classList.remove('resizing');
        }
        document.body.style.cursor = '';
        this.saveWidths();
    }

    saveWidths() {
        const widths = {};
        document.querySelectorAll('.report-table th').forEach((th, idx) => {
            if (th.style.width) {
                widths[idx] = th.style.width;
            }
        });
        savePreference(`columnWidths_${this.reportId}`, widths);
    }

    loadWidths() {
        const widths = loadPreference(`columnWidths_${this.reportId}`, {});
        document.querySelectorAll('.report-table th').forEach((th, idx) => {
            if (widths[idx]) {
                th.style.width = widths[idx];
                th.style.minWidth = widths[idx];
            }
        });
    }
}

let columnResizer = null;

// ============== Keyboard Shortcuts ==============
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+F: Open search
        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            toggleSearch(true);
            document.getElementById('searchInput').focus();
        }

        // Ctrl+P: Print
        if (e.ctrlKey && e.key === 'p') {
            e.preventDefault();
            window.print();
        }

        // Ctrl++: Zoom in
        if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
            e.preventDefault();
            zoomIn();
        }

        // Ctrl+-: Zoom out
        if (e.ctrlKey && e.key === '-') {
            e.preventDefault();
            zoomOut();
        }

        // Ctrl+0: Actual size
        if (e.ctrlKey && e.key === '0') {
            e.preventDefault();
            actualSize();
        }

        // F11: Fullscreen
        if (e.key === 'F11') {
            e.preventDefault();
            toggleFullscreen();
        }

        // Escape: Close search/filters
        if (e.key === 'Escape') {
            const searchBar = document.getElementById('searchBar');
            if (!searchBar.classList.contains('hidden')) {
                toggleSearch(false);
                reportSearch.close();
            }
        }

        // Enter in search: Next match
        if (e.key === 'Enter' && document.activeElement.id === 'searchInput') {
            e.preventDefault();
            if (e.shiftKey) {
                reportSearch.prev();
            } else {
                reportSearch.next();
            }
        }
    });
}

// ============== Toggle Functions ==============
function toggleSearch(show) {
    const searchBar = document.getElementById('searchBar');
    const btn = document.getElementById('toggleSearchBtn');

    if (show === undefined) {
        show = searchBar.classList.contains('hidden');
    }

    searchBar.classList.toggle('hidden', !show);
    btn.classList.toggle('active', show);

    if (show) {
        document.getElementById('searchInput').focus();
        // Reinitialize icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } else {
        reportSearch.close();
    }
}

function toggleFilters() {
    const btn = document.getElementById('toggleFiltersBtn');
    const isVisible = columnFilters.toggle();
    btn.classList.toggle('active', isVisible);
}

function toggleParameters() {
    const form = document.getElementById('parameterForm');
    const btn = document.getElementById('toggleParamsBtn');
    form.classList.toggle('hidden');
    btn.classList.toggle('active', !form.classList.contains('hidden'));
}

// ============== Data Source Panel ==============
function renderDatasourcePanel() {
    const panel = document.getElementById('datasourcePanel');
    const content = document.getElementById('datasourcePanelContent');
    const statusSpan = document.getElementById('datasourcePanelStatus');

    if (!panel || datasourceStatus.length === 0) {
        if (panel) panel.classList.add('hidden');
        return;
    }

    panel.classList.remove('hidden');

    const unmappedCount = datasourceStatus.filter(ds => !ds.is_mapped).length;
    const allMapped = unmappedCount === 0;

    // Update status indicator
    if (allMapped) {
        statusSpan.innerHTML = '<span class="badge-success">All Mapped</span>';
    } else {
        statusSpan.innerHTML = `<span class="badge-warning">${unmappedCount} Unmapped</span>`;
    }

    // Build content HTML
    let html = '';
    datasourceStatus.forEach((ds, idx) => {
        if (ds.is_mapped) {
            html += `
                <div class="datasource-item">
                    <span class="datasource-name">${escapeHtml(ds.name)}</span>
                    <span class="datasource-status datasource-mapped">
                        <i data-lucide="check-circle" style="width:16px;height:16px;"></i>
                        Mapped
                    </span>
                    <span class="datasource-connection">→ ${escapeHtml(ds.connection_name)}</span>
                </div>
            `;
        } else {
            html += `
                <div class="datasource-item">
                    <span class="datasource-name">${escapeHtml(ds.name)}</span>
                    <span class="datasource-status datasource-unmapped">
                        <i data-lucide="alert-circle" style="width:16px;height:16px;"></i>
                        Not Mapped
                    </span>
                    <select class="datasource-select" id="dsSelect_${idx}" onchange="onDatasourceSelectChange(${idx})">
                        <option value="">-- Select Connection --</option>
                        ${availableConnections.map(c =>
                            `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.server)}/${escapeHtml(c.database_name)})</option>`
                        ).join('')}
                    </select>
                    <button class="datasource-save-btn" id="dsSaveBtn_${idx}" onclick="saveDatasourceMapping(${idx})" disabled>
                        Save
                    </button>
                </div>
            `;
        }
    });

    if (!allMapped) {
        html += `
            <div class="datasource-warning">
                <i data-lucide="alert-triangle" style="width:16px;height:16px;"></i>
                ${unmappedCount} data source${unmappedCount > 1 ? 's need' : ' needs'} mapping before the report can run
            </div>
        `;
    }

    content.innerHTML = html;

    // Update run button state
    updateRunButtonState();

    // Refresh icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function toggleDatasourcePanel() {
    const panel = document.getElementById('datasourcePanel');
    panel.classList.toggle('collapsed');
}

function onDatasourceSelectChange(idx) {
    const select = document.getElementById(`dsSelect_${idx}`);
    const btn = document.getElementById(`dsSaveBtn_${idx}`);
    btn.disabled = !select.value;
}

async function saveDatasourceMapping(idx) {
    const ds = datasourceStatus[idx];
    const select = document.getElementById(`dsSelect_${idx}`);
    const btn = document.getElementById(`dsSaveBtn_${idx}`);

    if (!select.value) return;

    try {
        btn.disabled = true;
        btn.textContent = 'Saving...';

        await apiPost('/api/datasources/mappings', {
            rdl_datasource_name: ds.name,
            connection_id: parseInt(select.value)
        });

        showToast('Mapping saved successfully');

        // Reload report to refresh status
        await loadReport();
    } catch (error) {
        showToast('Failed to save mapping: ' + error.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Save';
    }
}

function updateRunButtonState() {
    const unmappedCount = datasourceStatus.filter(ds => !ds.is_mapped).length;
    const runBtn = document.querySelector('.btn-primary[onclick="runReport()"]');
    const refreshBtn = document.getElementById('refreshBtn');

    if (unmappedCount > 0) {
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.title = `${unmappedCount} data source${unmappedCount > 1 ? 's need' : ' needs'} mapping`;
        }
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.title = 'Configure data sources first';
        }
    } else {
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.title = '';
        }
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.title = 'Refresh Report';
        }
    }
}

// ============== Report Loading ==============
async function loadReport() {
    try {
        showLoading();
        const data = await apiGet(`/api/reports/${REPORT_ID}`);
        reportData = data.report;
        datasourceStatus = data.datasource_status || [];
        availableConnections = data.connections || [];

        // Update page title
        document.title = `${reportData.display_name} - RDL Report Viewer`;

        // Render data source panel
        renderDatasourcePanel();

        // Render parameter form
        const parameters = typeof reportData.parameters === 'string'
            ? JSON.parse(reportData.parameters || '[]')
            : (reportData.parameters || []);
        await renderParameterForm(parameters);

        // Update parameters button state based on whether there are parameters
        const paramsBtn = document.getElementById('toggleParamsBtn');
        if (parameters.length === 0) {
            paramsBtn.disabled = true;
            paramsBtn.style.opacity = '0.5';
        }

        // Check if all datasources are mapped before auto-running
        const unmappedCount = datasourceStatus.filter(ds => !ds.is_mapped).length;

        // Auto-run if all datasources are mapped AND all parameters have values
        // (either from URL params/drillthrough or from default values)
        const allParamsHaveValues = parameters.length === 0 ||
            parameters.every(p => currentParams[p.name] !== undefined && currentParams[p.name] !== '');

        if (unmappedCount === 0 && allParamsHaveValues) {
            await runReport();
        }
    } catch (error) {
        showToast('Failed to load report: ' + error.message, 'error');
        document.getElementById('reportContent').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="alert-circle" style="width:48px;height:48px;color:var(--error);"></i></div>
                <div class="empty-state-title">Error loading report</div>
                <div class="empty-state-text">${escapeHtml(error.message)}</div>
            </div>
        `;
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } finally {
        hideLoading();
    }
}

async function renderParameterForm(parameters) {
    const container = document.getElementById('parameterForm');

    if (parameters.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    let html = '';

    // Check if we have date parameters for quick presets
    const dateParams = parameters.filter(p => p.data_type === 'DateTime');
    const hasDateRange = dateParams.some(p => p.name.toLowerCase().includes('from') || p.name.toLowerCase().includes('start')) &&
                         dateParams.some(p => p.name.toLowerCase().includes('to') || p.name.toLowerCase().includes('end'));

    if (hasDateRange) {
        html += `
            <div class="param-group param-group-presets">
                <label class="param-label">Quick Select</label>
                <select class="param-input param-select" id="datePresetSelect">
                    <option value="">-- Date Range --</option>
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="last7">Last 7 Days</option>
                    <option value="last14">Last 14 Days</option>
                    <option value="last30">Last 30 Days</option>
                    <option value="mtd">Month to Date</option>
                    <option value="lastMonth">Last Month</option>
                    <option value="last3Months">Last 3 Months</option>
                    <option value="ytd">Year to Date</option>
                </select>
            </div>
        `;
    }

    for (const param of parameters) {
        const inputType = param.data_type === 'DateTime' ? 'date' : 'text';
        const value = currentParams[param.name] !== undefined
            ? currentParams[param.name]
            : (param.default_value || '');

        if (param.valid_values && param.valid_values.type === 'dataset') {
            // Fetch options from dataset
            const options = await fetchParameterOptions(param);

            if (param.multi_value) {
                // Multi-select dropdown with checkboxes
                currentParams[param.name] = Array.isArray(value) ? value : [];
                const selectedCount = currentParams[param.name].length;
                const displayText = selectedCount === 0 ? 'Select...' : `${selectedCount} selected`;
                html += `
                    <div class="param-group param-group-multiselect">
                        <label class="param-label">${escapeHtml(param.prompt || param.name)}</label>
                        <div class="param-multiselect-wrapper" data-param="${param.name}">
                            <div class="param-multiselect-trigger" tabindex="0">
                                <span class="param-multiselect-text">${displayText}</span>
                                <i data-lucide="chevron-down"></i>
                            </div>
                            <div class="param-multiselect-dropdown">
                                <div class="param-multiselect-actions">
                                    <button type="button" class="param-select-all">Select All</button>
                                    <button type="button" class="param-unselect-all">Unselect All</button>
                                </div>
                                ${options.map(opt => `
                                    <label class="param-checkbox-label">
                                        <input type="checkbox"
                                               class="param-checkbox"
                                               name="${param.name}"
                                               value="${escapeHtml(String(opt.value))}"
                                               ${currentParams[param.name].includes(opt.value) || currentParams[param.name].includes(String(opt.value)) ? 'checked' : ''}>
                                        <span>${escapeHtml(opt.label)}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // Single-select dropdown
                currentParams[param.name] = value;
                html += `
                    <div class="param-group">
                        <label class="param-label">${escapeHtml(param.prompt || param.name)}</label>
                        <select class="param-input param-select" name="${param.name}">
                            <option value="">-- Select --</option>
                            ${options.map(opt => `
                                <option value="${escapeHtml(String(opt.value))}" ${String(value) === String(opt.value) ? 'selected' : ''}>
                                    ${escapeHtml(opt.label)}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                `;
            }
        } else if (param.valid_values && param.valid_values.type === 'static') {
            // Static values
            const options = param.valid_values.values || [];

            if (param.multi_value) {
                currentParams[param.name] = Array.isArray(value) ? value : [];
                const selectedCount = currentParams[param.name].length;
                const displayText = selectedCount === 0 ? 'Select...' : `${selectedCount} selected`;
                html += `
                    <div class="param-group param-group-multiselect">
                        <label class="param-label">${escapeHtml(param.prompt || param.name)}</label>
                        <div class="param-multiselect-wrapper" data-param="${param.name}">
                            <div class="param-multiselect-trigger" tabindex="0">
                                <span class="param-multiselect-text">${displayText}</span>
                                <i data-lucide="chevron-down"></i>
                            </div>
                            <div class="param-multiselect-dropdown">
                                <div class="param-multiselect-actions">
                                    <button type="button" class="param-select-all">Select All</button>
                                    <button type="button" class="param-unselect-all">Unselect All</button>
                                </div>
                                ${options.map(opt => `
                                    <label class="param-checkbox-label">
                                        <input type="checkbox"
                                               class="param-checkbox"
                                               name="${param.name}"
                                               value="${escapeHtml(opt.value)}"
                                               ${currentParams[param.name].includes(opt.value) ? 'checked' : ''}>
                                        <span>${escapeHtml(opt.label)}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                currentParams[param.name] = value;
                html += `
                    <div class="param-group">
                        <label class="param-label">${escapeHtml(param.prompt || param.name)}</label>
                        <select class="param-input param-select" name="${param.name}">
                            <option value="">-- Select --</option>
                            ${options.map(opt => `
                                <option value="${escapeHtml(opt.value)}" ${value === opt.value ? 'selected' : ''}>
                                    ${escapeHtml(opt.label)}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                `;
            }
        } else {
            // Regular text/date input
            currentParams[param.name] = value;
            html += `
                <div class="param-group">
                    <label class="param-label">${escapeHtml(param.prompt || param.name)}</label>
                    <input type="${inputType}"
                           class="param-input"
                           name="${param.name}"
                           value="${escapeHtml(value)}"
                           placeholder="${escapeHtml(param.prompt || param.name)}">
                </div>
            `;
        }
    }

    html += `
        <div class="param-group">
            <label class="param-label">&nbsp;</label>
            <button class="btn btn-primary" onclick="runReport()">
                <i data-lucide="play" style="width:14px;height:14px;"></i> Run Report
            </button>
        </div>
    `;

    container.innerHTML = html;

    // Add input listeners for text/select inputs
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

    // Date preset handler
    const datePresetSelect = document.getElementById('datePresetSelect');
    if (datePresetSelect) {
        datePresetSelect.addEventListener('change', (e) => {
            const preset = e.target.value;
            if (!preset) return;

            const today = new Date();
            let fromDate, toDate;

            switch (preset) {
                case 'today':
                    fromDate = toDate = today;
                    break;
                case 'yesterday':
                    fromDate = toDate = new Date(today.getTime() - 86400000);
                    break;
                case 'last7':
                    fromDate = new Date(today.getTime() - 7 * 86400000);
                    toDate = today;
                    break;
                case 'last14':
                    fromDate = new Date(today.getTime() - 14 * 86400000);
                    toDate = today;
                    break;
                case 'last30':
                    fromDate = new Date(today.getTime() - 30 * 86400000);
                    toDate = today;
                    break;
                case 'mtd':
                    fromDate = new Date(today.getFullYear(), today.getMonth(), 1);
                    toDate = today;
                    break;
                case 'lastMonth':
                    fromDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                    toDate = new Date(today.getFullYear(), today.getMonth(), 0);
                    break;
                case 'last3Months':
                    fromDate = new Date(today.getFullYear(), today.getMonth() - 3, 1);
                    toDate = today;
                    break;
                case 'ytd':
                    fromDate = new Date(today.getFullYear(), 0, 1);
                    toDate = today;
                    break;
            }

            // Format dates as YYYY-MM-DD for input fields
            const formatDate = (d) => d.toISOString().split('T')[0];

            // Find and update date inputs
            const dateInputs = container.querySelectorAll('input[type="date"]');
            dateInputs.forEach(input => {
                const name = input.name.toLowerCase();
                if (name.includes('from') || name.includes('start')) {
                    input.value = formatDate(fromDate);
                    currentParams[input.name] = input.value;
                } else if (name.includes('to') || name.includes('end')) {
                    input.value = formatDate(toDate);
                    currentParams[input.name] = input.value;
                }
            });
        });
    }

    // Add listeners for multi-select dropdowns
    container.querySelectorAll('.param-multiselect-wrapper').forEach(wrapper => {
        const paramName = wrapper.dataset.param;
        const trigger = wrapper.querySelector('.param-multiselect-trigger');
        const dropdown = wrapper.querySelector('.param-multiselect-dropdown');
        const displayText = trigger.querySelector('.param-multiselect-text');
        const checkboxes = wrapper.querySelectorAll('.param-checkbox');

        // Helper to update display and state
        const updateSelection = () => {
            const checked = wrapper.querySelectorAll('.param-checkbox:checked');
            currentParams[paramName] = Array.from(checked).map(cb => cb.value);
            const count = currentParams[paramName].length;
            displayText.textContent = count === 0 ? 'Select...' : `${count} selected`;
        };

        // Toggle dropdown on click
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other dropdowns
            container.querySelectorAll('.param-multiselect-trigger.open').forEach(t => {
                if (t !== trigger) {
                    t.classList.remove('open');
                    t.nextElementSibling.classList.remove('open');
                }
            });
            trigger.classList.toggle('open');
            dropdown.classList.toggle('open');
        });

        // Select All button
        const selectAllBtn = wrapper.querySelector('.param-select-all');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                checkboxes.forEach(cb => cb.checked = true);
                updateSelection();
            });
        }

        // Unselect All button
        const unselectAllBtn = wrapper.querySelector('.param-unselect-all');
        if (unselectAllBtn) {
            unselectAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                checkboxes.forEach(cb => cb.checked = false);
                updateSelection();
            });
        }

        // Handle checkbox changes
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', updateSelection);
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.param-multiselect-wrapper')) {
            container.querySelectorAll('.param-multiselect-trigger.open').forEach(trigger => {
                trigger.classList.remove('open');
                trigger.nextElementSibling.classList.remove('open');
            });
        }
    });

    // Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

async function fetchParameterOptions(param) {
    if (!param.valid_values || param.valid_values.type !== 'dataset') {
        return [];
    }

    try {
        const data = await apiPost(`/api/reports/${REPORT_ID}/parameter-options`, {
            dataset_name: param.valid_values.dataset_name,
            value_field: param.valid_values.value_field,
            label_field: param.valid_values.label_field
        });
        return data.options || [];
    } catch (error) {
        console.error('Failed to fetch parameter options:', error);
        return [];
    }
}

async function runReport() {
    try {
        showLoading();

        // Reset sort state when fetching new data
        currentSortColumn = null;
        currentSortDirection = 'asc';

        // Collect current parameter values
        document.querySelectorAll('.param-input').forEach(input => {
            currentParams[input.name] = input.value;
        });

        const startTime = performance.now();

        const data = await apiPost(`/api/reports/${REPORT_ID}/execute`, {
            parameters: currentParams
        });

        execTimeMs = data.exec_time_ms || (performance.now() - startTime);
        totalRowCount = data.row_count || 0;

        document.getElementById('reportContent').innerHTML = data.html;
        document.getElementById('exportBtn').disabled = false;

        // Update metadata badges
        updateMetadata(totalRowCount, execTimeMs);

        // Initialize interactive features
        initializeTableFeatures();

        if (data.row_count === 0) {
            document.getElementById('reportContent').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i data-lucide="inbox" style="width:48px;height:48px;"></i></div>
                    <div class="empty-state-title">No data</div>
                    <div class="empty-state-text">The report returned no results. Try adjusting your parameters.</div>
                </div>
            `;
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    } catch (error) {
        showToast('Failed to run report: ' + error.message, 'error');
        document.getElementById('reportContent').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="alert-circle" style="width:48px;height:48px;color:var(--error);"></i></div>
                <div class="empty-state-title">Error running report</div>
                <div class="empty-state-text">${escapeHtml(error.message)}</div>
                <a href="/datasources" class="btn btn-primary mt-4">Configure Data Sources</a>
            </div>
        `;
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    } finally {
        hideLoading();
    }
}

function initializeTableFeatures() {
    // Add sort handlers (client-side sorting)
    document.querySelectorAll('.report-table th.sortable').forEach(th => {
        th.addEventListener('click', (e) => {
            // Don't sort if clicking resize area
            const rect = th.getBoundingClientRect();
            if (e.clientX > rect.right - 10) return;

            const column = th.dataset.column;
            if (currentSortColumn === column) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = column;
                currentSortDirection = 'asc';
            }
            sortTableClientSide(parseInt(column), currentSortDirection);
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

    // Initialize column filters
    columnFilters.init();

    // Initialize column resizer
    columnResizer = new ColumnResizer();
    columnResizer.init();

    // Re-apply any active search
    if (reportSearch.lastTerm) {
        setTimeout(() => {
            reportSearch.search(reportSearch.lastTerm);
        }, 100);
    }

    // Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function updateMetadata(rowCount, execTime) {
    // Update status bar
    const statusRowInfo = document.getElementById('statusRowInfo');
    statusRowInfo.innerHTML = `Showing <strong>${rowCount.toLocaleString()}</strong> rows`;
}

// ============== Drillthrough ==============
function handleDrillthrough(href) {
    const url = new URL(href, window.location.origin);
    const reportName = url.searchParams.get('report');
    const params = {};

    url.searchParams.forEach((value, key) => {
        if (key !== 'report') {
            params[key] = value;
        }
    });

    findAndOpenReport(reportName, params);
}

async function findAndOpenReport(reportName, params) {
    try {
        showLoading();
        const data = await apiGet('/api/reports');
        const reports = data.reports || [];

        const report = reports.find(r =>
            r.display_name.toLowerCase() === reportName.toLowerCase()
        );

        if (report) {
            const paramStr = Object.entries(params)
                .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                .join('&');
            // Open drillthrough report in new window
            window.open(`/viewer/${report.id}?${paramStr}`, '_blank');
        } else {
            showToast(`Report "${reportName}" not found`, 'error');
        }
    } catch (error) {
        showToast('Failed to find report: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ============== Export Functions ==============
async function exportReport(format) {
    try {
        showLoading();
        closeExportMenu();

        if (format === 'clipboard') {
            await copyToClipboard();
            return;
        }

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

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const extensions = { excel: 'xlsx', pdf: 'pdf', csv: 'csv' };
        a.download = `${reportData.display_name}.${extensions[format] || format}`;

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

async function copyToClipboard() {
    try {
        const table = document.querySelector('.report-table');
        if (!table) {
            showToast('No data to copy', 'error');
            return;
        }

        const rows = table.querySelectorAll('tr:not(.filter-row):not(.filtered-out)');
        let tsv = '';

        rows.forEach(row => {
            const cells = row.querySelectorAll('th, td');
            const rowData = Array.from(cells).map(cell => cell.textContent.trim());
            tsv += rowData.join('\t') + '\n';
        });

        await navigator.clipboard.writeText(tsv);
        showToast('Copied to clipboard');
    } catch (error) {
        showToast('Copy failed: ' + error.message, 'error');
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

// ============== Scroll to Top ==============
function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============== Initialize ==============
document.addEventListener('DOMContentLoaded', () => {
    // Load saved preferences
    setZoom(currentZoom);
    setFontSize(currentFontSize);

    // Extract URL parameters FIRST (from drillthrough links)
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.forEach((value, key) => {
        currentParams[key] = value;
    });

    // Load report (will use currentParams for drillthrough)
    loadReport();

    // Initialize keyboard shortcuts
    initKeyboardShortcuts();

    // Zoom controls
    document.getElementById('zoomOutBtn').addEventListener('click', zoomOut);
    document.getElementById('zoomInBtn').addEventListener('click', zoomIn);
    document.getElementById('zoomSelect').addEventListener('change', (e) => setZoom(parseInt(e.target.value)));
    document.getElementById('fitWidthBtn').addEventListener('click', fitToWidth);
    document.getElementById('actualSizeBtn').addEventListener('click', actualSize);

    // Font controls
    document.getElementById('fontDecreaseBtn').addEventListener('click', decreaseFontSize);
    document.getElementById('fontIncreaseBtn').addEventListener('click', increaseFontSize);
    document.getElementById('fontSizeSelect').addEventListener('change', (e) => setFontSize(e.target.value));

    // Action buttons
    document.getElementById('refreshBtn').addEventListener('click', runReport);
    document.getElementById('printBtn').addEventListener('click', () => window.print());
    document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);

    // Toggle buttons
    document.getElementById('toggleParamsBtn').addEventListener('click', toggleParameters);
    document.getElementById('toggleFiltersBtn').addEventListener('click', toggleFilters);
    document.getElementById('toggleSearchBtn').addEventListener('click', () => toggleSearch());

    // Search
    document.getElementById('searchInput').addEventListener('input', (e) => {
        reportSearch.search(e.target.value);
    });
    document.getElementById('searchPrevBtn').addEventListener('click', () => reportSearch.prev());
    document.getElementById('searchNextBtn').addEventListener('click', () => reportSearch.next());
    document.getElementById('searchCloseBtn').addEventListener('click', () => {
        toggleSearch(false);
        reportSearch.close();
    });

    // Export dropdown
    document.getElementById('exportBtn').addEventListener('click', toggleExportMenu);
    document.querySelectorAll('.dropdown-item[data-format]').forEach(item => {
        item.addEventListener('click', () => {
            exportReport(item.dataset.format);
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            closeExportMenu();
        }
    });

    // Scroll to top button
    document.getElementById('scrollTopBtn').addEventListener('click', scrollToTop);

    // Initialize icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});
