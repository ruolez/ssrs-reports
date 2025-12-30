// Data Sources page functionality
let sqlServers = [];
let connections = [];
let mappings = [];
let databases = [];
let databaseInputMode = 'select'; // 'select' or 'custom'

async function loadData() {
    try {
        showLoading();
        const [serverData, connData, mapData] = await Promise.all([
            apiGet('/api/datasources/servers'),
            apiGet('/api/datasources/connections'),
            apiGet('/api/datasources/mappings')
        ]);

        sqlServers = serverData.servers || [];
        connections = connData.connections || [];
        mappings = mapData.mappings || [];

        renderServers();
        renderConnections();
        renderMappings();
        updateServerDropdown();
        updateConnectionDropdown();
    } catch (error) {
        showToast('Failed to load data: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ============== SQL Servers ==============

function renderServers() {
    const tbody = document.getElementById('serversTable');

    if (sqlServers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-secondary">
                    No SQL servers configured. Click "Add SQL Server" to create one.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = sqlServers.map(server => `
        <tr>
            <td><strong>${escapeHtml(server.name)}</strong></td>
            <td>${escapeHtml(server.server)}</td>
            <td>${server.port || 1433}</td>
            <td>${escapeHtml(server.username)}</td>
            <td>
                <span class="badge badge-warning" id="server-status-${server.id}">Unknown</span>
            </td>
            <td>
                <button class="btn btn-sm btn-secondary mr-2" onclick="testServerById(${server.id})">
                    🔌 Test
                </button>
                <button class="btn btn-sm btn-secondary mr-2" onclick="editServer(${server.id})">
                    ✏️ Edit
                </button>
                <button class="btn btn-sm btn-danger" onclick="deleteServer(${server.id})">
                    🗑️
                </button>
            </td>
        </tr>
    `).join('');
}

function editServer(id) {
    const server = sqlServers.find(s => s.id === id);
    if (!server) return;

    document.getElementById('serverId').value = server.id;
    document.getElementById('serverName').value = server.name;
    document.getElementById('serverAddress').value = server.server;
    document.getElementById('serverPort').value = server.port || 1433;
    document.getElementById('serverUsername').value = server.username;
    document.getElementById('serverPassword').value = '';

    document.getElementById('serverModalTitle').textContent = 'Edit SQL Server';
    openModal('serverModal');
}

async function saveServer() {
    const id = document.getElementById('serverId').value;
    const data = {
        name: document.getElementById('serverName').value,
        server: document.getElementById('serverAddress').value,
        port: parseInt(document.getElementById('serverPort').value) || 1433,
        username: document.getElementById('serverUsername').value,
        password: document.getElementById('serverPassword').value
    };

    if (!data.name || !data.server || !data.username) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        showLoading();

        if (id) {
            await apiPut(`/api/datasources/servers/${id}`, data);
            showToast('SQL Server updated');
        } else {
            if (!data.password) {
                showToast('Password is required for new SQL servers', 'error');
                hideLoading();
                return;
            }
            await apiPost('/api/datasources/servers', data);
            showToast('SQL Server created');
        }

        closeModal('serverModal');
        clearServerForm();
        await loadData();
    } catch (error) {
        showToast('Failed to save SQL Server: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function deleteServer(id) {
    // Check if any connections use this server
    const usedBy = connections.filter(c => c.sql_server_id === id);
    if (usedBy.length > 0) {
        showToast(`Cannot delete: ${usedBy.length} connection(s) use this server`, 'error');
        return;
    }

    if (!confirm('Are you sure you want to delete this SQL Server?')) return;

    try {
        showLoading();
        await apiDelete(`/api/datasources/servers/${id}`);
        showToast('SQL Server deleted');
        await loadData();
    } catch (error) {
        showToast('Failed to delete SQL Server: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function testServerById(id) {
    try {
        showLoading();
        const statusElem = document.getElementById(`server-status-${id}`);

        const data = await apiPost(`/api/datasources/servers/${id}/test`);

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

async function testServerFromModal() {
    const id = document.getElementById('serverId').value;
    if (!id) {
        showToast('Please save the SQL Server first, then test it', 'warning');
        return;
    }
    await testServerById(id);
}

function clearServerForm() {
    document.getElementById('serverId').value = '';
    document.getElementById('serverName').value = '';
    document.getElementById('serverAddress').value = '';
    document.getElementById('serverPort').value = '1433';
    document.getElementById('serverUsername').value = '';
    document.getElementById('serverPassword').value = '';
    document.getElementById('serverModalTitle').textContent = 'Add SQL Server';
}

function updateServerDropdown() {
    const select = document.getElementById('connServer');
    select.innerHTML = `
        <option value="">Select a SQL Server...</option>
        ${sqlServers.map(s => `
            <option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.server)})</option>
        `).join('')}
    `;
}

// ============== Connections ==============

function renderConnections() {
    const tbody = document.getElementById('connectionsTable');

    if (connections.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center text-secondary">
                    No connections configured. Click "Add Connection" to create one.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = connections.map(conn => {
        // Display server info: from sql_server link or legacy fields
        let serverDisplay = 'N/A';
        if (conn.sql_server_id && conn.server_name) {
            serverDisplay = escapeHtml(conn.server_name);
        } else if (conn.server) {
            serverDisplay = `${escapeHtml(conn.server)}:${conn.port || 1433}`;
        }

        return `
            <tr>
                <td><strong>${escapeHtml(conn.name)}</strong></td>
                <td>${serverDisplay}</td>
                <td>${escapeHtml(conn.database_name)}</td>
                <td>
                    <span class="badge badge-warning" id="conn-status-${conn.id}">Unknown</span>
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
        `;
    }).join('');
}

function editConnection(id) {
    const conn = connections.find(c => c.id === id);
    if (!conn) return;

    document.getElementById('connId').value = conn.id;
    document.getElementById('connName').value = conn.name;

    // Set server and load databases
    if (conn.sql_server_id) {
        document.getElementById('connServer').value = conn.sql_server_id;
        loadDatabasesForServer().then(() => {
            // Set database after loading
            const dbSelect = document.getElementById('connDatabaseSelect');
            const option = Array.from(dbSelect.options).find(opt => opt.value === conn.database_name);
            if (option) {
                dbSelect.value = conn.database_name;
            } else {
                // Database not in list, switch to custom mode
                setDatabaseInputMode('custom');
                document.getElementById('connDatabaseCustom').value = conn.database_name;
            }
        });
    } else {
        // Legacy connection without sql_server_id
        document.getElementById('connServer').value = '';
        setDatabaseInputMode('custom');
        document.getElementById('connDatabaseCustom').value = conn.database_name;
    }

    document.getElementById('connectionModalTitle').textContent = 'Edit Connection';
    openModal('connectionModal');
}

async function saveConnection() {
    const id = document.getElementById('connId').value;
    const serverId = document.getElementById('connServer').value;
    const databaseName = databaseInputMode === 'select'
        ? document.getElementById('connDatabaseSelect').value
        : document.getElementById('connDatabaseCustom').value;

    const data = {
        name: document.getElementById('connName').value,
        database_name: databaseName,
        sql_server_id: serverId ? parseInt(serverId) : null
    };

    if (!data.name || !data.database_name) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    if (!data.sql_server_id) {
        showToast('Please select a SQL Server', 'error');
        return;
    }

    try {
        showLoading();

        if (id) {
            await apiPut(`/api/datasources/connections/${id}`, data);
            showToast('Connection updated');
        } else {
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
    // Check if any mappings use this connection
    const usedBy = mappings.filter(m => m.connection_id === id);
    if (usedBy.length > 0) {
        if (!confirm(`This connection is used by ${usedBy.length} mapping(s). Delete anyway?`)) {
            return;
        }
    } else {
        if (!confirm('Are you sure you want to delete this connection?')) return;
    }

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

async function testConnectionById(id) {
    try {
        showLoading();
        const statusElem = document.getElementById(`conn-status-${id}`);

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

async function testConnectionFromModal() {
    const id = document.getElementById('connId').value;
    if (!id) {
        showToast('Please save the connection first, then test it', 'warning');
        return;
    }
    await testConnectionById(id);
}

function clearConnectionForm() {
    document.getElementById('connId').value = '';
    document.getElementById('connName').value = '';
    document.getElementById('connServer').value = '';
    document.getElementById('connDatabaseSelect').innerHTML = '<option value="">Select a server first...</option>';
    document.getElementById('connDatabaseCustom').value = '';
    setDatabaseInputMode('select');
    document.getElementById('connectionModalTitle').textContent = 'Add Connection';
}

// ============== Database Loading ==============

async function loadDatabasesForServer() {
    const serverId = document.getElementById('connServer').value;
    const dbSelect = document.getElementById('connDatabaseSelect');

    if (!serverId) {
        dbSelect.innerHTML = '<option value="">Select a server first...</option>';
        databases = [];
        return;
    }

    dbSelect.innerHTML = '<option value="">Loading databases...</option>';

    try {
        const data = await apiGet(`/api/datasources/servers/${serverId}/databases`);
        databases = data.databases || [];

        if (databases.length === 0) {
            dbSelect.innerHTML = '<option value="">No databases found</option>';
        } else {
            dbSelect.innerHTML = `
                <option value="">Select a database...</option>
                ${databases.map(db => `<option value="${escapeHtml(db)}">${escapeHtml(db)}</option>`).join('')}
            `;
        }
    } catch (error) {
        dbSelect.innerHTML = '<option value="">Failed to load databases</option>';
        showToast('Failed to load databases: ' + error.message, 'error');
    }
}

function toggleDatabaseInputMode() {
    if (databaseInputMode === 'select') {
        setDatabaseInputMode('custom');
    } else {
        setDatabaseInputMode('select');
    }
}

function setDatabaseInputMode(mode) {
    databaseInputMode = mode;
    const dbSelect = document.getElementById('connDatabaseSelect');
    const dbCustom = document.getElementById('connDatabaseCustom');
    const toggleBtn = document.getElementById('toggleDatabaseInput');

    if (mode === 'select') {
        dbSelect.style.display = 'block';
        dbCustom.style.display = 'none';
        toggleBtn.textContent = '✏️';
        toggleBtn.title = 'Enter database name manually';
    } else {
        dbSelect.style.display = 'none';
        dbCustom.style.display = 'block';
        toggleBtn.textContent = '📋';
        toggleBtn.title = 'Select from list';
    }
}

function updateDatabaseInput() {
    // This could auto-fill the custom input when selecting from dropdown
}

function updateConnectionDropdown() {
    const select = document.getElementById('mappingConnection');
    select.innerHTML = `
        <option value="">Select a connection...</option>
        ${connections.map(c => {
            const serverInfo = c.server_name || c.server || 'Unknown';
            return `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(serverInfo)}/${escapeHtml(c.database_name)})</option>`;
        }).join('')}
    `;
}

// ============== Mappings ==============

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
                <select class="form-select" onchange="updateMapping('${escapeHtml(map.rdl_datasource_name)}', this.value)">
                    <option value="">Not mapped</option>
                    ${connections.map(c => {
                        const serverInfo = c.server_name || c.server || 'Unknown';
                        return `
                            <option value="${c.id}" ${map.connection_id === c.id ? 'selected' : ''}>
                                ${escapeHtml(c.name)} (${escapeHtml(serverInfo)}/${escapeHtml(c.database_name)})
                            </option>
                        `;
                    }).join('')}
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

// ============== Initialize ==============

document.addEventListener('DOMContentLoaded', () => {
    loadData();
});
