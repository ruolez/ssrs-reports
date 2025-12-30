// Reports page functionality
let allReports = [];
let selectedFiles = [];
let deleteReportId = null;

async function loadReports() {
    try {
        showLoading();
        const data = await apiGet('/api/reports');
        allReports = data.reports || [];
        renderReports(allReports);
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
                <div class="empty-state-icon"><i data-lucide="file-text" style="width:48px;height:48px;"></i></div>
                <div class="empty-state-title">No reports found</div>
                <div class="empty-state-text">Upload RDL files to get started.</div>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
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
            const params = typeof report.parameters === 'string'
                ? JSON.parse(report.parameters || '[]')
                : (report.parameters || []);
            const paramCount = params.length;

            html += `
                <div class="report-card">
                    <div class="report-card-actions">
                        <button class="btn-icon" onclick="event.stopPropagation(); promptDelete(${report.id}, '${escapeHtml(report.display_name)}')" title="Delete">
                            <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
                        </button>
                    </div>
                    <div class="report-card-content" onclick="openReport(${report.id})">
                        <div class="report-card-title">${escapeHtml(report.display_name)}</div>
                        ${report.folder ? `<div class="report-card-folder"><i data-lucide="folder" style="width:14px;height:14px;"></i> ${escapeHtml(report.folder)}</div>` : ''}
                        ${paramCount > 0 ? `<div class="report-card-params"><i data-lucide="sliders-horizontal" style="width:14px;height:14px;"></i> ${paramCount} parameter${paramCount > 1 ? 's' : ''}</div>` : ''}
                    </div>
                </div>
            `;
        });
    }

    html += '</div>';
    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
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

// ============== File Upload ==============

function setupDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

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

    const folder = document.getElementById('uploadFolder').value.trim();

    try {
        showLoading();
        let successCount = 0;
        let errors = [];

        for (const file of selectedFiles) {
            const formData = new FormData();
            formData.append('file', file);
            if (folder) {
                formData.append('folder', folder);
            }

            try {
                const response = await fetch('/api/reports/upload', {
                    method: 'POST',
                    body: formData
                });

                // Check if response is OK
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
        document.getElementById('uploadFolder').value = '';
        document.getElementById('fileInput').value = '';

        closeModal('uploadModal');
        await loadReports();
    } catch (error) {
        showToast('Upload failed: ' + (error.message || 'Unknown error'), 'error');
    } finally {
        hideLoading();
    }
}

// ============== Delete Report ==============

function promptDelete(reportId, reportName) {
    deleteReportId = reportId;
    document.getElementById('deleteReportName').textContent = reportName;
    openModal('deleteModal');
}

async function confirmDelete() {
    if (!deleteReportId) return;

    try {
        showLoading();
        const response = await fetch(`/api/reports/${deleteReportId}`, {
            method: 'DELETE'
        });

        const data = await response.json();
        if (data.success) {
            showToast('Report deleted successfully');
            closeModal('deleteModal');
            await loadReports();
        } else {
            showToast('Failed to delete: ' + data.error, 'error');
        }
    } catch (error) {
        showToast('Failed to delete report: ' + error.message, 'error');
    } finally {
        hideLoading();
        deleteReportId = null;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadReports();
    setupDropZone();

    // Search
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', debounce((e) => {
        filterReports(e.target.value);
    }, 300));
});
