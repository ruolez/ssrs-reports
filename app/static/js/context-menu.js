// Context Menu Management
// Handles right-click context menus for folders and reports

let contextMenuFolderId = null;
let contextMenuReportId = null;
let contextMenuReportName = null;

// Initialize context menus
document.addEventListener('DOMContentLoaded', function() {
    // Close context menus on click outside
    document.addEventListener('click', function(e) {
        closeAllContextMenus();
    });

    // Close context menus on scroll
    document.addEventListener('scroll', function() {
        closeAllContextMenus();
    }, true);

    // Close context menus on escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAllContextMenus();
        }
    });
});

// Close all context menus
function closeAllContextMenus() {
    const menus = document.querySelectorAll('.context-menu');
    menus.forEach(menu => {
        menu.classList.remove('visible');
    });
    contextMenuFolderId = null;
    contextMenuReportId = null;
    contextMenuReportName = null;
}

// Show folder context menu
function showFolderContextMenu(e, folderId) {
    e.preventDefault();
    e.stopPropagation();

    closeAllContextMenus();

    contextMenuFolderId = folderId;

    const menu = document.getElementById('folderContextMenu');
    if (!menu) return;

    // Position the menu
    positionContextMenu(menu, e.clientX, e.clientY);

    // Show the menu
    menu.classList.add('visible');
}

// Show report context menu
function showReportContextMenu(e, reportId, reportName) {
    e.preventDefault();
    e.stopPropagation();

    closeAllContextMenus();

    contextMenuReportId = reportId;
    contextMenuReportName = reportName;

    const menu = document.getElementById('reportContextMenu');
    if (!menu) return;

    // Position the menu
    positionContextMenu(menu, e.clientX, e.clientY);

    // Show the menu
    menu.classList.add('visible');
}

// Position context menu to avoid overflow
function positionContextMenu(menu, x, y) {
    // Reset position first to measure accurately
    menu.style.left = '0';
    menu.style.top = '0';

    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust X position if menu would overflow right edge
    if (x + menuRect.width > viewportWidth - 10) {
        x = viewportWidth - menuRect.width - 10;
    }

    // Adjust Y position if menu would overflow bottom edge
    if (y + menuRect.height > viewportHeight - 10) {
        y = viewportHeight - menuRect.height - 10;
    }

    // Ensure menu doesn't go off left or top edge
    x = Math.max(10, x);
    y = Math.max(10, y);

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

// Handle folder context menu actions
function handleContextMenuAction(action) {
    const folderId = contextMenuFolderId;
    closeAllContextMenus();

    if (!folderId) return;

    switch (action) {
        case 'open':
            selectFolder(folderId);
            break;

        case 'rename':
            startInlineRename(folderId);
            break;

        case 'edit':
            openFolderModal(folderId);
            break;

        case 'new-subfolder':
            openNewSubfolderModal(folderId);
            break;

        case 'delete':
            confirmDeleteFolder(folderId);
            break;
    }
}

// Handle report context menu actions
function handleReportContextAction(action) {
    const reportId = contextMenuReportId;
    const reportName = contextMenuReportName;
    closeAllContextMenus();

    if (!reportId) return;

    switch (action) {
        case 'open':
            window.location.href = `/view/${reportId}`;
            break;

        case 'move':
            openMoveModalForReport(reportId, reportName);
            break;

        case 'delete':
            confirmDeleteReport(reportId, reportName);
            break;
    }
}

// Start inline rename for a folder
function startInlineRename(folderId) {
    const folderItem = document.querySelector(`.folder-item[data-folder-id="${folderId}"]`);
    if (!folderItem) return;

    const nameSpan = folderItem.querySelector('.folder-name');
    if (!nameSpan) return;

    const currentName = nameSpan.textContent;

    // Create input element
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'folder-rename-input';
    input.value = currentName;

    // Replace span with input
    nameSpan.style.display = 'none';
    nameSpan.parentNode.insertBefore(input, nameSpan.nextSibling);

    // Focus and select text
    input.focus();
    input.select();

    // Handle save on enter
    input.addEventListener('keydown', async function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            await saveRename(folderId, input.value, nameSpan, input);
        } else if (e.key === 'Escape') {
            cancelRename(nameSpan, input);
        }
    });

    // Handle save on blur
    input.addEventListener('blur', async function() {
        // Small delay to allow Enter key to process first
        setTimeout(async () => {
            if (input.parentNode) {
                await saveRename(folderId, input.value, nameSpan, input);
            }
        }, 100);
    });
}

// Save folder rename
async function saveRename(folderId, newName, nameSpan, input) {
    newName = newName.trim();

    if (!newName) {
        showToast('Folder name cannot be empty', 'error');
        cancelRename(nameSpan, input);
        return;
    }

    try {
        const response = await fetch(`/api/folders/${folderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to rename folder');
        }

        nameSpan.textContent = newName;
        showToast('Folder renamed successfully', 'success');

        // Reload folder tree to update everywhere
        await loadFolderTree();

    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        cancelRename(nameSpan, input);
    }
}

// Cancel folder rename
function cancelRename(nameSpan, input) {
    if (input && input.parentNode) {
        input.remove();
    }
    if (nameSpan) {
        nameSpan.style.display = '';
    }
}

// Open move modal for a single report
function openMoveModalForReport(reportId, reportName) {
    // Store for move operation
    window.moveTargetReports = [reportId];

    const description = document.getElementById('moveDescription');
    if (description) {
        description.textContent = `Move "${reportName}" to:`;
    }

    populateFolderSelectList();
    openModal('moveModal');
}

// Confirm delete for a single report (from context menu)
function confirmDeleteReport(reportId, reportName) {
    window.deleteTargetReportId = reportId;

    const nameSpan = document.getElementById('deleteReportName');
    if (nameSpan) {
        nameSpan.textContent = reportName;
    }

    openModal('deleteModal');
}

// Confirm delete folder
function confirmDeleteFolder(folderId) {
    const folder = findFolderById(folderId);
    if (!folder) return;

    window.deleteTargetFolderId = folderId;

    const nameSpan = document.getElementById('deleteFolderName');
    if (nameSpan) {
        nameSpan.textContent = folder.name;
    }

    openModal('deleteFolderModal');
}

// Find folder by ID in the tree
function findFolderById(folderId) {
    if (!window.foldersData) return null;

    for (const folder of window.foldersData) {
        if (folder.id === folderId) {
            return folder;
        }
    }
    return null;
}

// Open new subfolder modal
function openNewSubfolderModal(parentId) {
    // Reset form
    const form = document.getElementById('folderForm');
    if (form) form.reset();

    // Set title
    const title = document.getElementById('folderModalTitle');
    if (title) title.textContent = 'New Subfolder';

    // Clear editing state
    window.editingFolderId = null;

    // Set default color
    const colorInput = document.getElementById('folderColor');
    const colorValue = document.getElementById('folderColorValue');
    if (colorInput) {
        colorInput.value = '#207176';
        if (colorValue) colorValue.textContent = '#207176';
    }

    // Reset icon selection
    const iconOptions = document.querySelectorAll('.icon-option');
    iconOptions.forEach(opt => opt.classList.remove('selected'));
    const defaultIcon = document.querySelector('.icon-option[data-icon="folder"]');
    if (defaultIcon) defaultIcon.classList.add('selected');

    // Set parent folder
    const parentSelect = document.getElementById('folderParent');
    if (parentSelect) {
        parentSelect.value = parentId.toString();
    }

    // Reinitialize Lucide icons
    if (window.lucide) lucide.createIcons();

    openModal('folderModal');
}

// Confirm delete folder action
async function confirmDeleteFolderAction() {
    const folderId = window.deleteTargetFolderId;
    if (!folderId) return;

    try {
        const response = await fetch(`/api/folders/${folderId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete folder');
        }

        closeModal('deleteFolderModal');
        showToast('Folder deleted successfully', 'success');

        // Clear current folder if it was deleted
        if (window.currentFolderId === folderId) {
            window.currentFolderId = null;
            updateBreadcrumb(null);
            document.getElementById('pageTitle').textContent = 'All Reports';
        }

        // Reload folder tree and reports
        await loadFolderTree();
        await loadReports();

    } catch (error) {
        showToast(error.message, 'error');
    }

    window.deleteTargetFolderId = null;
}

// Populate folder select list for move modal
function populateFolderSelectList() {
    const container = document.getElementById('folderSelectList');
    if (!container) return;

    let html = `
        <div class="folder-select-item ${!window.moveTargetFolder ? 'selected' : ''}"
             data-folder-id="" onclick="selectMoveFolder(this, null)">
            <i data-lucide="inbox" style="width:16px;height:16px;"></i>
            <span>Uncategorized (Root)</span>
        </div>
    `;

    if (window.foldersData) {
        html += buildFolderSelectTree(window.foldersData, null, 0);
    }

    container.innerHTML = html;
    window.moveTargetFolder = null;

    if (window.lucide) lucide.createIcons();
}

// Build folder select tree recursively
function buildFolderSelectTree(folders, parentId, level) {
    let html = '';
    const children = folders.filter(f => f.parent_id === parentId);

    children.forEach(folder => {
        const indent = level * 16;
        html += `
            <div class="folder-select-item" data-folder-id="${folder.id}"
                 onclick="selectMoveFolder(this, ${folder.id})"
                 style="padding-left: ${16 + indent}px;">
                <i data-lucide="${folder.icon || 'folder'}"
                   style="width:16px;height:16px;color:${folder.color || '#207176'};"></i>
                <span>${escapeHtml(folder.name)}</span>
            </div>
        `;
        html += buildFolderSelectTree(folders, folder.id, level + 1);
    });

    return html;
}

// Select folder for move operation
function selectMoveFolder(element, folderId) {
    // Remove selection from all items
    document.querySelectorAll('.folder-select-item').forEach(item => {
        item.classList.remove('selected');
    });

    // Add selection to clicked item
    element.classList.add('selected');

    // Store selected folder
    window.moveTargetFolder = folderId;
}

// Confirm move operation
async function confirmMove() {
    const reportIds = window.moveTargetReports;
    const folderId = window.moveTargetFolder;

    if (!reportIds || reportIds.length === 0) {
        showToast('No reports selected to move', 'error');
        return;
    }

    try {
        const response = await fetch('/api/reports/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                report_ids: reportIds,
                folder_id: folderId
            })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to move reports');
        }

        closeModal('moveModal');
        showToast(`${reportIds.length} report(s) moved successfully`, 'success');

        // Clear selection
        clearSelection();

        // Reload folder tree (for counts) and reports
        await loadFolderTree();
        await loadReports();

    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Escape HTML for safe display
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
