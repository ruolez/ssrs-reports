// Reports page functionality with folder management integration
let allReports = [];
let selectedFiles = [];
let deleteReportId = null;

// Multi-select state
window.selectedReports = new Set();

// Current folder filter
window.currentFolderId = null;

async function loadReports() {
    try {
        showLoading();

        // Build URL with folder filter
        let url = '/api/reports';
        if (window.currentFolderId !== null) {
            url = `/api/folders/${window.currentFolderId}/reports`;
        }

        const data = await apiGet(url);
        allReports = data.reports || [];
        renderReports(allReports);

        // Setup drag-drop for reports
        if (typeof setupReportDragDrop === 'function') {
            setupReportDragDrop();
        }
    } catch (error) {
        const errorMsg = error.message || 'Unknown error';
        showToast('Failed to load reports: ' + errorMsg, 'error');
        console.error('Load reports error:', error);
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
        // Also reload folder tree to update counts
        if (typeof loadFolderTree === 'function') {
            await loadFolderTree();
        }
    } catch (error) {
        showToast('Failed to scan reports: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderReports(reports) {
    const container = document.getElementById('reportsContainer');

    if (reports.length === 0) {
        const folderName = window.currentFolderId !== null ? 'this folder' : 'your collection';
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="file-text" style="width:48px;height:48px;"></i></div>
                <div class="empty-state-title">No reports found</div>
                <div class="empty-state-text">Upload RDL files or drag reports to ${folderName}.</div>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    let html = '<div class="reports-grid">';

    reports.forEach(report => {
        const params = typeof report.parameters === 'string'
            ? JSON.parse(report.parameters || '[]')
            : (report.parameters || []);
        const paramCount = params.length;
        const isSelected = window.selectedReports.has(report.id);

        html += `
            <div class="report-card ${isSelected ? 'selected' : ''}"
                 data-report-id="${report.id}"
                 draggable="true"
                 oncontextmenu="showReportContextMenu(event, ${report.id}, '${escapeHtml(report.display_name).replace(/'/g, "\\'")}')">
                <div class="report-card-checkbox" onclick="event.stopPropagation(); toggleReportSelection(${report.id})">
                    <div class="checkbox ${isSelected ? 'checked' : ''}">
                        ${isSelected ? '<i data-lucide="check" style="width:12px;height:12px;"></i>' : ''}
                    </div>
                </div>
                <div class="report-card-actions">
                    <button class="btn-icon" onclick="event.stopPropagation(); promptDelete(${report.id}, '${escapeHtml(report.display_name).replace(/'/g, "\\'")}')" title="Delete">
                        <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
                    </button>
                </div>
                <div class="report-card-content" onclick="openReport(${report.id})">
                    <div class="report-card-icon">
                        <i data-lucide="file-text" style="width:24px;height:24px;"></i>
                    </div>
                    <div class="report-card-title">${escapeHtml(report.display_name)}</div>
                    ${report.folder_name ? `<div class="report-card-folder"><i data-lucide="folder" style="width:14px;height:14px;"></i> ${escapeHtml(report.folder_name)}</div>` : ''}
                    ${paramCount > 0 ? `<div class="report-card-params"><i data-lucide="sliders-horizontal" style="width:14px;height:14px;"></i> ${paramCount} parameter${paramCount > 1 ? 's' : ''}</div>` : ''}
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Update bulk actions bar
    updateBulkActionsBar();
}

function openReport(reportId) {
    window.location.href = `/viewer/${reportId}`;
}

function filterReports(searchTerm) {
    const term = searchTerm.toLowerCase();
    const filtered = allReports.filter(report => {
        return report.display_name.toLowerCase().includes(term) ||
               (report.folder_name && report.folder_name.toLowerCase().includes(term));
    });
    renderReports(filtered);
}

// ============== Multi-Select ==============

function toggleReportSelection(reportId) {
    if (window.selectedReports.has(reportId)) {
        window.selectedReports.delete(reportId);
    } else {
        window.selectedReports.add(reportId);
    }

    // Update card visual
    const card = document.querySelector(`.report-card[data-report-id="${reportId}"]`);
    if (card) {
        card.classList.toggle('selected', window.selectedReports.has(reportId));
        const checkbox = card.querySelector('.checkbox');
        if (checkbox) {
            checkbox.classList.toggle('checked', window.selectedReports.has(reportId));
            checkbox.innerHTML = window.selectedReports.has(reportId)
                ? '<i data-lucide="check" style="width:12px;height:12px;"></i>'
                : '';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulkActionsBar');
    const countSpan = document.getElementById('selectedCount');

    if (!bar) return;

    const count = window.selectedReports.size;

    if (count > 0) {
        bar.style.display = 'flex';
        countSpan.textContent = `${count} selected`;
    } else {
        bar.style.display = 'none';
    }
}

function clearSelection() {
    window.selectedReports.clear();

    // Update all cards
    document.querySelectorAll('.report-card.selected').forEach(card => {
        card.classList.remove('selected');
        const checkbox = card.querySelector('.checkbox');
        if (checkbox) {
            checkbox.classList.remove('checked');
            checkbox.innerHTML = '';
        }
    });

    updateBulkActionsBar();
}

// ============== Bulk Actions ==============

function openMoveModal() {
    if (window.selectedReports.size === 0) {
        showToast('No reports selected', 'error');
        return;
    }

    window.moveTargetReports = Array.from(window.selectedReports);

    const description = document.getElementById('moveDescription');
    if (description) {
        const count = window.moveTargetReports.length;
        description.textContent = `Move ${count} report${count > 1 ? 's' : ''} to:`;
    }

    populateFolderSelectList();
    openModal('moveModal');
}

async function bulkDelete() {
    if (window.selectedReports.size === 0) {
        showToast('No reports selected', 'error');
        return;
    }

    document.getElementById('bulkDeleteCount').textContent = window.selectedReports.size;
    openModal('bulkDeleteModal');
}

async function confirmBulkDelete() {
    const reportIds = Array.from(window.selectedReports);

    if (reportIds.length === 0) return;

    try {
        showLoading();
        const response = await fetch('/api/reports/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_ids: reportIds })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete reports');
        }

        closeModal('bulkDeleteModal');
        showToast(`${reportIds.length} report(s) deleted successfully`, 'success');

        clearSelection();
        await loadReports();

        // Reload folder tree to update counts
        if (typeof loadFolderTree === 'function') {
            await loadFolderTree();
        }
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ============== File Upload ==============

function setupDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    if (!dropZone || !fileInput) return;

    // Click to browse
    dropZone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

function handleFiles(files) {
    const rdlFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.rdl'));

    if (rdlFiles.length === 0) {
        showToast('Please select .rdl files only', 'error');
        return;
    }

    selectedFiles = rdlFiles;
    renderFileList();
    document.getElementById('uploadBtn').disabled = false;
}

function renderFileList() {
    const fileList = document.getElementById('fileList');

    if (selectedFiles.length === 0) {
        fileList.innerHTML = '';
        return;
    }

    fileList.innerHTML = selectedFiles.map((file, index) => `
        <div class="file-list-item">
            <span class="file-list-name"><i data-lucide="file" style="width:14px;height:14px;"></i> ${escapeHtml(file.name)}</span>
            <span class="file-list-size">${formatFileSize(file.size)}</span>
            <button class="btn-icon" onclick="removeFile(${index})"><i data-lucide="x" style="width:14px;height:14px;"></i></button>
        </div>
    `).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
    document.getElementById('uploadBtn').disabled = selectedFiles.length === 0;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function uploadFiles() {
    if (selectedFiles.length === 0) return;

    const folderId = document.getElementById('uploadFolderId')?.value || null;

    try {
        showLoading();
        let successCount = 0;
        let errors = [];

        for (const file of selectedFiles) {
            const formData = new FormData();
            formData.append('file', file);
            if (folderId) {
                formData.append('folder_id', folderId);
            }

            try {
                const response = await fetch('/api/reports/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const text = await response.text();
                    try {
                        const errorData = JSON.parse(text);
                        errors.push(`${file.name}: ${errorData.error || 'Upload failed'}`);
                    } catch {
                        errors.push(`${file.name}: HTTP ${response.status}`);
                    }
                    continue;
                }

                const data = await response.json();
                if (data.success) {
                    successCount++;
                } else {
                    errors.push(`${file.name}: ${data.error || 'Unknown error'}`);
                }
            } catch (e) {
                errors.push(`${file.name}: ${e.message || 'Network error'}`);
            }
        }

        if (successCount > 0) {
            showToast(`Uploaded ${successCount} report${successCount > 1 ? 's' : ''} successfully`);
        }

        if (errors.length > 0) {
            errors.forEach(err => showToast(err, 'error'));
        }

        // Reset form
        selectedFiles = [];
        renderFileList();
        document.getElementById('uploadBtn').disabled = true;
        const folderSelect = document.getElementById('uploadFolderId');
        if (folderSelect) folderSelect.value = '';
        document.getElementById('fileInput').value = '';

        closeModal('uploadModal');
        await loadReports();

        // Reload folder tree to update counts
        if (typeof loadFolderTree === 'function') {
            await loadFolderTree();
        }
    } catch (error) {
        showToast('Upload failed: ' + (error.message || 'Unknown error'), 'error');
    } finally {
        hideLoading();
    }
}

// Populate upload folder dropdown
async function populateUploadFolderSelect() {
    const select = document.getElementById('uploadFolderId');
    if (!select) return;

    // Keep existing options (first option is "No folder")
    select.innerHTML = '<option value="">No folder (root)</option>';

    if (window.foldersData) {
        addFolderOptions(select, window.foldersData, null, 0);
    }
}

function addFolderOptions(select, folders, parentId, level) {
    const children = folders.filter(f => f.parent_id === parentId);

    children.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = '  '.repeat(level) + folder.name;
        select.appendChild(option);

        addFolderOptions(select, folders, folder.id, level + 1);
    });
}

// ============== Delete Report ==============

function promptDelete(reportId, reportName) {
    deleteReportId = reportId;
    document.getElementById('deleteReportName').textContent = reportName;
    openModal('deleteModal');
}

async function confirmDelete() {
    const reportId = window.deleteTargetReportId || deleteReportId;
    if (!reportId) return;

    try {
        showLoading();
        const response = await fetch(`/api/reports/${reportId}`, {
            method: 'DELETE'
        });

        const data = await response.json();
        if (data.success) {
            showToast('Report deleted successfully');
            closeModal('deleteModal');

            // Remove from selection if selected
            window.selectedReports.delete(reportId);

            await loadReports();

            // Reload folder tree to update counts
            if (typeof loadFolderTree === 'function') {
                await loadFolderTree();
            }
        } else {
            showToast('Failed to delete: ' + data.error, 'error');
        }
    } catch (error) {
        showToast('Failed to delete report: ' + error.message, 'error');
    } finally {
        hideLoading();
        deleteReportId = null;
        window.deleteTargetReportId = null;
    }
}

// ============== Keyboard Shortcuts ==============

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Escape to clear selection
        if (e.key === 'Escape' && window.selectedReports.size > 0) {
            clearSelection();
        }

        // Ctrl+A to select all visible reports
        if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            selectAllReports();
        }
    });
}

function selectAllReports() {
    const cards = document.querySelectorAll('.report-card[data-report-id]');
    cards.forEach(card => {
        const reportId = parseInt(card.dataset.reportId);
        window.selectedReports.add(reportId);
        card.classList.add('selected');
        const checkbox = card.querySelector('.checkbox');
        if (checkbox) {
            checkbox.classList.add('checked');
            checkbox.innerHTML = '<i data-lucide="check" style="width:12px;height:12px;"></i>';
        }
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
    updateBulkActionsBar();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadReports();
    setupDropZone();
    setupKeyboardShortcuts();

    // Load folder tree first
    if (typeof loadFolderTree === 'function') {
        loadFolderTree();
    }

    // Search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            filterReports(e.target.value);
        }, 300));
    }
});
