// Folder Tree Component
let folderTree = [];
let flatFolders = [];
let selectedFolderId = null;
let uncategorizedCount = 0;
let expandedFolders = new Set(JSON.parse(localStorage.getItem('expandedFolders') || '[]'));
let editingFolderId = null;
let sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

// Initialize sidebar state
document.addEventListener('DOMContentLoaded', () => {
    if (sidebarCollapsed) {
        document.getElementById('layoutContainer')?.classList.add('sidebar-collapsed');
    }
});

// Toggle sidebar
function toggleSidebar() {
    const layout = document.getElementById('layoutContainer');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');

    // Check if mobile
    const isMobile = window.innerWidth <= 1024;

    if (isMobile) {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('active');
    } else {
        layout.classList.toggle('sidebar-collapsed');
        sidebarCollapsed = layout.classList.contains('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', sidebarCollapsed);
    }
}

// Load folder tree from API
async function loadFolderTree() {
    try {
        const data = await apiGet('/api/folders');
        flatFolders = data.folders || [];
        uncategorizedCount = data.uncategorized_count || 0;
        folderTree = buildTreeStructure(flatFolders);
        renderFolderTree();
        populateFolderSelects();
    } catch (error) {
        console.error('Failed to load folders:', error);
        showToast('Failed to load folders: ' + error.message, 'error');
    }
}

// Build hierarchical tree from flat list
function buildTreeStructure(folders) {
    const map = new Map();
    const roots = [];

    // First pass: create map
    folders.forEach(f => map.set(f.id, { ...f, children: [] }));

    // Second pass: build tree
    folders.forEach(f => {
        if (f.parent_id === null) {
            roots.push(map.get(f.id));
        } else if (map.has(f.parent_id)) {
            map.get(f.parent_id).children.push(map.get(f.id));
        }
    });

    return roots;
}

// Count total reports recursively
function countReportsRecursive(folder) {
    let count = folder.report_count || 0;
    if (folder.children) {
        folder.children.forEach(child => {
            count += countReportsRecursive(child);
        });
    }
    return count;
}

// Render folder tree
function renderFolderTree() {
    const container = document.getElementById('folderTreeContainer');
    const totalReports = flatFolders.reduce((sum, f) => sum + (f.report_count || 0), 0) + uncategorizedCount;

    let html = `
        <ul class="folder-tree">
            <li class="folder-item" data-folder-id="all">
                <div class="folder-item-content ${selectedFolderId === null ? 'active' : ''}"
                     onclick="selectFolder(null)">
                    <span class="folder-toggle no-children"></span>
                    <i data-lucide="home" class="folder-icon" style="color: var(--primary)"></i>
                    <span class="folder-name">All Reports</span>
                    <span class="folder-count">${totalReports}</span>
                </div>
            </li>
            ${renderFolderItems(folderTree)}
            <li class="folder-tree-divider"></li>
            <li class="folder-item" data-folder-id="uncategorized">
                <div class="folder-item-content ${selectedFolderId === 'uncategorized' ? 'active' : ''}"
                     onclick="selectUncategorized()">
                    <span class="folder-toggle no-children"></span>
                    <i data-lucide="inbox" class="folder-icon" style="color: var(--on-surface-secondary)"></i>
                    <span class="folder-name">Uncategorized</span>
                    <span class="folder-count">${uncategorizedCount}</span>
                </div>
            </li>
        </ul>
    `;

    container.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Render folder items recursively
function renderFolderItems(folders, depth = 0) {
    return folders.map(folder => {
        const isExpanded = expandedFolders.has(folder.id);
        const hasChildren = folder.children && folder.children.length > 0;
        const totalCount = countReportsRecursive(folder);

        return `
            <li class="folder-item" data-folder-id="${folder.id}" draggable="true">
                <div class="folder-item-content ${selectedFolderId === folder.id ? 'active' : ''}"
                     onclick="selectFolder(${folder.id})"
                     oncontextmenu="showFolderContextMenu(event, ${folder.id})"
                     ondblclick="startInlineRename(${folder.id})">
                    <span class="folder-toggle ${hasChildren ? (isExpanded ? 'expanded' : '') : 'no-children'}"
                          onclick="event.stopPropagation(); toggleFolder(${folder.id})">
                        <i data-lucide="chevron-right"></i>
                    </span>
                    <i data-lucide="${folder.icon || 'folder'}"
                       class="folder-icon"
                       style="color: ${folder.color || 'var(--primary)'}"></i>
                    <span class="folder-name" id="folderName-${folder.id}">${escapeHtml(folder.name)}</span>
                    <span class="folder-count">${totalCount}</span>
                </div>
                ${hasChildren ? `
                    <ul class="folder-children ${isExpanded ? '' : 'collapsed'}">
                        ${renderFolderItems(folder.children, depth + 1)}
                    </ul>
                ` : ''}
            </li>
        `;
    }).join('');
}

// Select a folder
function selectFolder(folderId) {
    selectedFolderId = folderId;
    window.currentFolderId = folderId;
    renderFolderTree();

    // Load reports for this folder (function from reports.js)
    if (typeof loadReports === 'function') {
        loadReports();
    }

    updateBreadcrumb(folderId);
    updatePageTitle(folderId);
}

// Select uncategorized folder (special case)
function selectUncategorized() {
    selectedFolderId = 'uncategorized';
    window.currentFolderId = 'uncategorized';
    renderFolderTree();

    // Load uncategorized reports (function from reports.js)
    if (typeof loadReports === 'function') {
        loadReports();
    }

    updateBreadcrumb('uncategorized');
    updatePageTitle('uncategorized');
}

// Toggle folder expand/collapse
function toggleFolder(folderId) {
    if (expandedFolders.has(folderId)) {
        expandedFolders.delete(folderId);
    } else {
        expandedFolders.add(folderId);
    }
    localStorage.setItem('expandedFolders', JSON.stringify([...expandedFolders]));
    renderFolderTree();
}

// Update breadcrumb navigation
async function updateBreadcrumb(folderId) {
    const breadcrumb = document.getElementById('breadcrumb');

    if (folderId === null) {
        breadcrumb.innerHTML = '<span class="breadcrumb-item current">All Reports</span>';
        return;
    }

    if (folderId === 'uncategorized') {
        breadcrumb.innerHTML = `
            <span class="breadcrumb-item">
                <a href="#" onclick="selectFolder(null); return false;">All Reports</a>
            </span>
            <span class="breadcrumb-separator">/</span>
            <span class="breadcrumb-item current">Uncategorized</span>
        `;
        return;
    }

    try {
        const data = await apiGet(`/api/folders/${folderId}/path`);
        const path = data.path || [];

        let html = `
            <span class="breadcrumb-item">
                <a href="#" onclick="selectFolder(null); return false;">All Reports</a>
            </span>
        `;

        path.forEach((item, index) => {
            html += '<span class="breadcrumb-separator">/</span>';
            if (index === path.length - 1) {
                html += `<span class="breadcrumb-item current">${escapeHtml(item.name)}</span>`;
            } else {
                html += `<span class="breadcrumb-item"><a href="#" onclick="selectFolder(${item.id}); return false;">${escapeHtml(item.name)}</a></span>`;
            }
        });

        breadcrumb.innerHTML = html;
    } catch (error) {
        console.error('Failed to load folder path:', error);
    }
}

// Update page title
function updatePageTitle(folderId) {
    const title = document.getElementById('pageTitle');

    if (folderId === null) {
        title.textContent = 'All Reports';
    } else if (folderId === 'uncategorized') {
        title.textContent = 'Uncategorized';
    } else {
        const folder = flatFolders.find(f => f.id === folderId);
        title.textContent = folder ? folder.name : 'Reports';
    }
}

// Populate folder select dropdowns
function populateFolderSelects() {
    const folderParent = document.getElementById('folderParent');
    const uploadFolder = document.getElementById('uploadFolderId');

    const buildOptions = (folders, depth = 0) => {
        let html = '';
        folders.forEach(folder => {
            const indent = '&nbsp;'.repeat(depth * 4);
            html += `<option value="${folder.id}">${indent}${escapeHtml(folder.name)}</option>`;
            if (folder.children && folder.children.length > 0) {
                html += buildOptions(folder.children, depth + 1);
            }
        });
        return html;
    };

    const options = buildOptions(folderTree);

    if (folderParent) {
        folderParent.innerHTML = '<option value="">Root (No Parent)</option>' + options;
    }

    if (uploadFolder) {
        uploadFolder.innerHTML = '<option value="">No folder (root)</option>' + options;
    }
}

// Open folder modal (create or edit)
function openFolderModal(folderId = null, parentId = null) {
    editingFolderId = folderId;

    const modal = document.getElementById('folderModal');
    const title = document.getElementById('folderModalTitle');
    const nameInput = document.getElementById('folderName');
    const parentSelect = document.getElementById('folderParent');
    const descInput = document.getElementById('folderDescription');
    const colorInput = document.getElementById('folderColor');
    const colorValue = document.getElementById('folderColorValue');

    // Reset form
    nameInput.value = '';
    descInput.value = '';
    colorInput.value = '#207176';
    colorValue.textContent = '#207176';
    selectIcon('folder');

    // Populate parent select, excluding current folder and its children
    const buildOptions = (folders, depth = 0, excludeId = null) => {
        let html = '';
        folders.forEach(folder => {
            if (folder.id === excludeId) return;
            const indent = '&nbsp;'.repeat(depth * 4);
            html += `<option value="${folder.id}">${indent}${escapeHtml(folder.name)}</option>`;
            if (folder.children && folder.children.length > 0) {
                html += buildOptions(folder.children, depth + 1, excludeId);
            }
        });
        return html;
    };

    parentSelect.innerHTML = '<option value="">Root (No Parent)</option>' + buildOptions(folderTree, 0, folderId);

    if (folderId) {
        // Edit mode
        title.textContent = 'Edit Folder';
        const folder = flatFolders.find(f => f.id === folderId);
        if (folder) {
            nameInput.value = folder.name;
            descInput.value = folder.description || '';
            colorInput.value = folder.color || '#207176';
            colorValue.textContent = folder.color || '#207176';
            parentSelect.value = folder.parent_id || '';
            selectIcon(folder.icon || 'folder');
        }
    } else {
        // Create mode
        title.textContent = 'New Folder';
        if (parentId) {
            parentSelect.value = parentId;
        }
    }

    openModal('folderModal');
    nameInput.focus();
}

// Select icon in modal
function selectIcon(iconName) {
    document.querySelectorAll('#iconSelector .icon-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.icon === iconName);
    });
}

// Get selected icon
function getSelectedIcon() {
    const selected = document.querySelector('#iconSelector .icon-option.selected');
    return selected ? selected.dataset.icon : 'folder';
}

// Save folder (create or update)
async function saveFolder() {
    const nameInput = document.getElementById('folderName');
    const parentSelect = document.getElementById('folderParent');
    const descInput = document.getElementById('folderDescription');
    const colorInput = document.getElementById('folderColor');

    const name = nameInput.value.trim();
    if (!name) {
        showToast('Folder name is required', 'error');
        nameInput.focus();
        return;
    }

    const data = {
        name: name,
        parent_id: parentSelect.value ? parseInt(parentSelect.value) : null,
        description: descInput.value.trim(),
        color: colorInput.value,
        icon: getSelectedIcon()
    };

    try {
        showLoading();

        if (editingFolderId) {
            await apiPut(`/api/folders/${editingFolderId}`, data);
            showToast('Folder updated successfully');
        } else {
            await apiPost('/api/folders', data);
            showToast('Folder created successfully');
        }

        closeModal('folderModal');
        await loadFolderTree();

        // Refresh reports if viewing affected folder
        if (selectedFolderId === editingFolderId || selectedFolderId === data.parent_id) {
            if (typeof loadReports === 'function') {
                loadReports();
            }
        }
    } catch (error) {
        showToast('Failed to save folder: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Start inline rename
function startInlineRename(folderId) {
    const nameSpan = document.getElementById(`folderName-${folderId}`);
    if (!nameSpan) return;

    const folder = flatFolders.find(f => f.id === folderId);
    if (!folder) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-name-input';
    input.value = folder.name;

    input.onblur = () => finishInlineRename(folderId, input.value);
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishInlineRename(folderId, input.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            renderFolderTree();
        }
    };

    nameSpan.replaceWith(input);
    input.focus();
    input.select();
}

// Finish inline rename
async function finishInlineRename(folderId, newName) {
    newName = newName.trim();
    const folder = flatFolders.find(f => f.id === folderId);

    if (!newName || newName === folder?.name) {
        renderFolderTree();
        return;
    }

    try {
        await apiPut(`/api/folders/${folderId}`, { name: newName });
        showToast('Folder renamed');
        await loadFolderTree();
    } catch (error) {
        showToast('Failed to rename folder: ' + error.message, 'error');
        renderFolderTree();
    }
}

// Delete folder
let deleteFolderId = null;

function promptDeleteFolder(folderId) {
    deleteFolderId = folderId;
    const folder = flatFolders.find(f => f.id === folderId);
    document.getElementById('deleteFolderName').textContent = folder ? folder.name : 'this folder';
    openModal('deleteFolderModal');
}

async function confirmDeleteFolder() {
    if (!deleteFolderId) return;

    try {
        showLoading();
        await apiDelete(`/api/folders/${deleteFolderId}`);
        showToast('Folder deleted');
        closeModal('deleteFolderModal');
        await loadFolderTree();

        if (selectedFolderId === deleteFolderId) {
            selectFolder(null);
        } else {
            if (typeof loadReports === 'function') {
                loadReports();
            }
        }
    } catch (error) {
        showToast('Failed to delete folder: ' + error.message, 'error');
    } finally {
        hideLoading();
        deleteFolderId = null;
    }
}

// Move folder
async function moveFolderTo(folderId, newParentId) {
    if (folderId === newParentId) return;

    try {
        showLoading();
        await apiPost(`/api/folders/${folderId}/move`, { parent_id: newParentId });
        showToast('Folder moved');
        await loadFolderTree();
    } catch (error) {
        showToast('Failed to move folder: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// Filter folders in sidebar
function filterFolderTree(searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    const container = document.getElementById('folderTreeContainer');

    if (!term) {
        renderFolderTree();
        return;
    }

    // Show matching folders and their parents
    const matchingIds = new Set();
    const addParents = (folderId) => {
        const folder = flatFolders.find(f => f.id === folderId);
        if (folder && folder.parent_id) {
            matchingIds.add(folder.parent_id);
            addParents(folder.parent_id);
        }
    };

    flatFolders.forEach(folder => {
        if (folder.name.toLowerCase().includes(term)) {
            matchingIds.add(folder.id);
            addParents(folder.id);
        }
    });

    // Re-render with filtered view
    const items = container.querySelectorAll('.folder-item[data-folder-id]');
    items.forEach(item => {
        const id = parseInt(item.dataset.folderId);
        if (!isNaN(id)) {
            item.style.display = matchingIds.has(id) ? '' : 'none';
        }
    });
}

// Initialize icon selector and color picker events
document.addEventListener('DOMContentLoaded', () => {
    // Icon selector
    document.getElementById('iconSelector')?.addEventListener('click', (e) => {
        const option = e.target.closest('.icon-option');
        if (option) {
            selectIcon(option.dataset.icon);
        }
    });

    // Color picker
    document.getElementById('folderColor')?.addEventListener('input', (e) => {
        document.getElementById('folderColorValue').textContent = e.target.value;
    });

    // Folder search
    document.getElementById('folderSearchInput')?.addEventListener('input', debounce((e) => {
        filterFolderTree(e.target.value);
    }, 300));
});
