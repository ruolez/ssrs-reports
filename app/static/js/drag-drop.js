// Drag & Drop Management
// Handles drag-drop for folders and reports

let draggedItem = null;
let draggedType = null; // 'folder' or 'report'
let draggedIds = []; // For multi-select report drag

// Initialize drag-drop handlers
document.addEventListener('DOMContentLoaded', function() {
    initializeDragDrop();
});

// Initialize drag-drop event listeners
function initializeDragDrop() {
    // Event delegation for dynamic content
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
}

// Handle drag start
function handleDragStart(e) {
    const folderItem = e.target.closest('.folder-item[draggable="true"]');
    const reportCard = e.target.closest('.report-card[draggable="true"]');

    if (folderItem) {
        draggedType = 'folder';
        draggedItem = folderItem;
        draggedIds = [parseInt(folderItem.dataset.folderId)];

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'folder',
            id: draggedIds[0]
        }));

        // Add dragging class after a small delay
        setTimeout(() => {
            folderItem.classList.add('dragging');
        }, 0);

    } else if (reportCard) {
        draggedType = 'report';
        draggedItem = reportCard;

        const reportId = parseInt(reportCard.dataset.reportId);

        // Check if this report is part of a multi-selection
        if (window.selectedReports && window.selectedReports.has(reportId) && window.selectedReports.size > 1) {
            draggedIds = Array.from(window.selectedReports);
        } else {
            draggedIds = [reportId];
        }

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({
            type: 'report',
            ids: draggedIds
        }));

        // Add dragging class
        setTimeout(() => {
            reportCard.classList.add('dragging');

            // If multi-select, add visual indicator to all selected items
            if (draggedIds.length > 1) {
                draggedIds.forEach(id => {
                    const card = document.querySelector(`.report-card[data-report-id="${id}"]`);
                    if (card) card.classList.add('dragging');
                });
            }
        }, 0);
    }
}

// Handle drag end
function handleDragEnd(e) {
    // Remove dragging class from all items
    document.querySelectorAll('.dragging').forEach(el => {
        el.classList.remove('dragging');
    });

    // Remove drop targets
    document.querySelectorAll('.drop-target, .drop-target-invalid').forEach(el => {
        el.classList.remove('drop-target', 'drop-target-invalid');
    });

    draggedItem = null;
    draggedType = null;
    draggedIds = [];
}

// Handle drag over
function handleDragOver(e) {
    const dropTarget = getDropTarget(e.target);

    if (dropTarget) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }
}

// Handle drag enter
function handleDragEnter(e) {
    const dropTarget = getDropTarget(e.target);

    if (dropTarget) {
        e.preventDefault();

        // Remove existing targets
        document.querySelectorAll('.drop-target').forEach(el => {
            if (el !== dropTarget) {
                el.classList.remove('drop-target');
            }
        });

        // Check if this is a valid drop target
        if (isValidDropTarget(dropTarget)) {
            dropTarget.classList.add('drop-target');
            dropTarget.classList.remove('drop-target-invalid');
        } else {
            dropTarget.classList.add('drop-target-invalid');
            dropTarget.classList.remove('drop-target');
        }
    }
}

// Handle drag leave
function handleDragLeave(e) {
    const dropTarget = getDropTarget(e.target);

    if (dropTarget) {
        // Only remove if we're actually leaving the element
        const rect = dropTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;

        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            dropTarget.classList.remove('drop-target', 'drop-target-invalid');
        }
    }
}

// Handle drop
async function handleDrop(e) {
    e.preventDefault();

    const dropTarget = getDropTarget(e.target);

    if (!dropTarget || !isValidDropTarget(dropTarget)) {
        handleDragEnd(e);
        return;
    }

    try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        const targetFolderId = dropTarget.dataset.folderId ?
            parseInt(dropTarget.dataset.folderId) : null;

        if (data.type === 'folder') {
            await handleFolderDrop(data.id, targetFolderId);
        } else if (data.type === 'report') {
            await handleReportDrop(data.ids, targetFolderId);
        }

    } catch (error) {
        showToast('Drop operation failed: ' + error.message, 'error');
    }

    handleDragEnd(e);
}

// Get drop target element
function getDropTarget(element) {
    // Check if we're dropping on a folder item
    const folderItem = element.closest('.folder-item');
    if (folderItem) return folderItem;

    // Check if we're dropping on the folder tree container (root)
    const treeContainer = element.closest('.folder-tree');
    if (treeContainer && !element.closest('.folder-item')) {
        // Create/return a virtual root drop target
        return document.querySelector('.folder-item[data-folder-id="all"]') || treeContainer;
    }

    // Check for "All Reports" item
    const allReportsItem = element.closest('[data-folder-id="all"]');
    if (allReportsItem) return allReportsItem;

    return null;
}

// Check if drop target is valid
function isValidDropTarget(dropTarget) {
    if (!draggedType || !draggedIds.length) return false;

    const targetFolderId = dropTarget.dataset.folderId;

    if (draggedType === 'folder') {
        const draggedFolderId = draggedIds[0];

        // Can't drop folder on itself
        if (targetFolderId === draggedFolderId.toString()) {
            return false;
        }

        // Can't drop folder on its descendants (would create cycle)
        if (targetFolderId && isDescendant(parseInt(targetFolderId), draggedFolderId)) {
            return false;
        }

        return true;
    }

    if (draggedType === 'report') {
        // Reports can be dropped on any folder or root
        return true;
    }

    return false;
}

// Check if potentialDescendant is a descendant of ancestorId
function isDescendant(potentialDescendantId, ancestorId) {
    if (!window.foldersData) return false;

    const folder = window.foldersData.find(f => f.id === potentialDescendantId);
    if (!folder) return false;

    let current = folder;
    while (current.parent_id !== null) {
        if (current.parent_id === ancestorId) {
            return true;
        }
        current = window.foldersData.find(f => f.id === current.parent_id);
        if (!current) break;
    }

    return false;
}

// Handle folder drop
async function handleFolderDrop(folderId, targetFolderId) {
    // If dropping on "all" or tree container, set parent to null (root)
    const newParentId = targetFolderId === 'all' || !targetFolderId ? null : targetFolderId;

    // Check if folder is already in this parent
    const folder = window.foldersData.find(f => f.id === folderId);
    if (folder && folder.parent_id === newParentId) {
        return; // Already in target folder
    }

    try {
        const response = await fetch(`/api/folders/${folderId}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: newParentId })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to move folder');
        }

        showToast('Folder moved successfully', 'success');
        await loadFolderTree();

    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Handle report drop
async function handleReportDrop(reportIds, targetFolderId) {
    // If dropping on "all" or tree container, set folder to null (root)
    const newFolderId = targetFolderId === 'all' || !targetFolderId ? null : parseInt(targetFolderId);

    try {
        const response = await fetch('/api/reports/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                report_ids: reportIds,
                folder_id: newFolderId
            })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to move reports');
        }

        const count = reportIds.length;
        showToast(`${count} report${count > 1 ? 's' : ''} moved successfully`, 'success');

        // Clear multi-selection if used
        if (window.selectedReports && window.selectedReports.size > 0) {
            clearSelection();
        }

        // Reload folder tree (counts) and reports
        await loadFolderTree();
        await loadReports();

    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Make folder items draggable
function makeFolderDraggable(element) {
    element.setAttribute('draggable', 'true');
}

// Make report cards draggable
function makeReportDraggable(element) {
    element.setAttribute('draggable', 'true');
}

// Setup drag-drop for newly rendered folder items
function setupFolderDragDrop() {
    document.querySelectorAll('.folder-item[data-folder-id]').forEach(item => {
        if (item.dataset.folderId && item.dataset.folderId !== 'all') {
            makeFolderDraggable(item);
        }
    });
}

// Setup drag-drop for newly rendered report cards
function setupReportDragDrop() {
    document.querySelectorAll('.report-card[data-report-id]').forEach(card => {
        makeReportDraggable(card);
    });
}
