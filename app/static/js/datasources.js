// Data Sources page functionality
let connections = [];
let mappings = [];

async function loadData() {
    try {
        showLoading();
        const [connData, mapData] = await Promise.all([
            apiGet('/api/datasources/connections'),
            apiGet('/api/datasources/mappings')
        ]);

        connections = connData.connections || [];
        mappings = mapData.mappings || [];

        renderConnections();
        renderMappings();
        updateConnectionDropdown();
    } catch (error) {
        showToast('Failed to load data: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

function renderConnections() {
    const tbody = document.getElementById('connectionsTable');

    if (connections.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-secondary">
                    No connections configured. Click "Add Connection" to create one.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = connections.map(conn => `
        <tr>
            <td><strong>${escapeHtml(conn.name)}</strong></td>
            <td>${escapeHtml(conn.server)}:${conn.port || 1433}</td>
            <td>${escapeHtml(conn.database_name)}</td>
            <td>${escapeHtml(conn.username)}</td>
            <td>
                <span class="badge badge-warning" id="status-${conn.id}">Unknown</span>
            </td>
            <td>
                <button class="btn btn-sm btn-secondary mr-2" onclick="testConnectionById(${conn.id})">
                    🔌 Test
                </button>
                <button class="btn btn-sm btn-secondary mr-2" onclick="editConnection(${conn.id})">
                    ✏️ Edit
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteConnection(${conn.id})">
                    🗑️
                </button>
            </td>
        </tr>
    `).join('');
}

function renderMappings() {
    const tbody = document.getElementById('mappingsTable');

    if (mappings.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="text-center text-secondary">
                    No mappings configured. Scan reports first to discover required data sources.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = mappings.map(map => `
        <tr>
            <td><code>${escapeHtml(map.rdl_datasource_name)}</code></td>
            <td>
                <select class="form-select" onchange="updateMapping('${map.rdl_datasource_name}', this.value)">
                    <option value="">Not mapped</option>
                    ${connections.map(c => `
                        <option value="${c.id}" ${map.connection_id === c.id ? 'selected' : ''}>
                            ${escapeHtml(c.name)}
                        </option>
                    `).join('')}
                </select>
            </td>
            <td>
                ${map.connection_id
                    ? `<span class="badge badge-success">Mapped</span>`
                    : `<span class="badge badge-warning">Not Mapped</span>`
                }
            </td>
        </tr>
    `).join('');
}

function updateConnectionDropdown() {
    const select = document.getElementById('mappingConnection');
    select.innerHTML = `
        <option value="">Select a connection...</option>
        ${connections.map(c => `
            <option value="${c.id}">${escapeHtml(c.name)}</option>
        `).join('')}
    `;
}

function editConnection(id) {
    const conn = connections.find(c => c.id === id);
    if (!conn) return;

    document.getElementById('connId').value = conn.id;
    document.getElementById('connName').value = conn.name;
    document.getElementById('connServer').value = conn.server;
    document.getElementById('connPort').value = conn.port || 1433;
    document.getElementById('connDatabase').value = conn.database_name;
    document.getElementById('connUsername').value = conn.username;
    document.getElementById('connPassword').value = '';

    document.getElementById('connectionModalTitle').textContent = 'Edit Connection';
    openModal('connectionModal');
}

async function saveConnection() {
    const id = document.getElementById('connId').value;
    const data = {
        name: document.getElementById('connName').value,
        server: document.getElementById('connServer').value,
        port: parseInt(document.getElementById('connPort').value) || 1433,
        database_name: document.getElementById('connDatabase').value,
        username: document.getElementById('connUsername').value,
        password: document.getElementById('connPassword').value
    };

    if (!data.name || !data.server || !data.database_name || !data.username) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        showLoading();

        if (id) {
            await apiPut(`/api/datasources/connections/${id}`, data);
            showToast('Connection updated');
        } else {
            if (!data.password) {
                showToast('Password is required for new connections', 'error');
                hideLoading();
                return;
            }
            await apiPost('/api/datasources/connections', data);
            showToast('Connection created');
        }

        closeModal('connectionModal');
        clearConnectionForm();
        await loadData();
    } catch (error) {
        showToast('Failed to save connection: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteConnection(id) {
    if (!confirm('Are you sure you want to delete this connection?')) return;

    try {
        showLoading();
        await apiDelete(`/api/datasources/connections/${id}`);
        showToast('Connection deleted');
        await loadData();
    } catch (error) {
        showToast('Failed to delete connection: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function testConnection() {
    const id = document.getElementById('connId').value;

    if (!id) {
        // New connection - need to save first
        showToast('Please save the connection first, then test it', 'warning');
        return;
    }

    await testConnectionById(id);
}

async function testConnectionById(id) {
    try {
        showLoading();
        const statusElem = document.getElementById(`status-${id}`);

        const data = await apiPost(`/api/datasources/connections/${id}/test`);

        if (statusElem) {
            if (data.success) {
                statusElem.className = 'badge badge-success';
                statusElem.textContent = 'Connected';
            } else {
                statusElem.className = 'badge badge-error';
                statusElem.textContent = 'Failed';
            }
        }

        showToast(data.message || (data.success ? 'Connection successful' : 'Connection failed'),
                  data.success ? 'success' : 'error');
    } catch (error) {
        showToast('Test failed: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function saveMapping() {
    const rdlName = document.getElementById('rdlName').value;
    const connectionId = document.getElementById('mappingConnection').value;

    if (!rdlName) {
        showToast('Please enter the RDL data source name', 'error');
        return;
    }

    try {
        showLoading();
        await apiPost('/api/datasources/mappings', {
            rdl_datasource_name: rdlName,
            connection_id: connectionId || null
        });
        showToast('Mapping saved');
        closeModal('mappingModal');
        document.getElementById('rdlName').value = '';
        await loadData();
    } catch (error) {
        showToast('Failed to save mapping: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function updateMapping(rdlName, connectionId) {
    try {
        await apiPost('/api/datasources/mappings', {
            rdl_datasource_name: rdlName,
            connection_id: connectionId || null
        });
        showToast('Mapping updated');
        await loadData();
    } catch (error) {
        showToast('Failed to update mapping: ' + error.message, 'error');
    }
}

function clearConnectionForm() {
    document.getElementById('connId').value = '';
    document.getElementById('connName').value = '';
    document.getElementById('connServer').value = '';
    document.getElementById('connPort').value = '1433';
    document.getElementById('connDatabase').value = '';
    document.getElementById('connUsername').value = '';
    document.getElementById('connPassword').value = '';
    document.getElementById('connectionModalTitle').textContent = 'Add Connection';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // Clear form when opening new connection modal
    document.getElementById('connectionModal').addEventListener('click', (e) => {
        if (e.target.id === 'connectionModal') {
            clearConnectionForm();
        }
    });
});
