import os
import psycopg2
from psycopg2.extras import RealDictCursor
import pymssql
from cryptography.fernet import Fernet
import base64
import hashlib


class PostgreSQLManager:
    def __init__(self):
        self.database_url = os.environ.get('DATABASE_URL', 'postgresql://rdl:rdl@localhost:5432/rdl_viewer')
        self._encryption_key = self._get_or_create_key()

    def _get_connection(self):
        return psycopg2.connect(self.database_url, cursor_factory=RealDictCursor)

    def _get_or_create_key(self):
        # Generate a consistent key from environment or use default
        secret = os.environ.get('ENCRYPTION_SECRET', 'rdl-report-viewer-secret-key')
        key = hashlib.sha256(secret.encode()).digest()
        return base64.urlsafe_b64encode(key)

    def encrypt_password(self, password):
        f = Fernet(self._encryption_key)
        return f.encrypt(password.encode()).decode()

    def decrypt_password(self, encrypted):
        f = Fernet(self._encryption_key)
        return f.decrypt(encrypted.encode()).decode()

    def init_tables(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                # SQL Servers table (parent table for connections)
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS sql_servers (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(100) UNIQUE NOT NULL,
                        server VARCHAR(255) NOT NULL,
                        port INTEGER DEFAULT 1433,
                        username VARCHAR(100) NOT NULL,
                        password_encrypted TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                cur.execute('''
                    CREATE TABLE IF NOT EXISTS data_source_connections (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(100) UNIQUE NOT NULL,
                        server VARCHAR(255),
                        port INTEGER DEFAULT 1433,
                        database_name VARCHAR(255) NOT NULL,
                        username VARCHAR(100),
                        password_encrypted TEXT,
                        sql_server_id INTEGER REFERENCES sql_servers(id) ON DELETE SET NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Add sql_server_id column if it doesn't exist (for existing databases)
                cur.execute('''
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'data_source_connections' AND column_name = 'sql_server_id'
                        ) THEN
                            ALTER TABLE data_source_connections
                            ADD COLUMN sql_server_id INTEGER REFERENCES sql_servers(id) ON DELETE SET NULL;
                        END IF;
                    END $$;
                ''')

                cur.execute('''
                    CREATE TABLE IF NOT EXISTS data_source_mappings (
                        id SERIAL PRIMARY KEY,
                        rdl_datasource_name VARCHAR(100) UNIQUE NOT NULL,
                        connection_id INTEGER REFERENCES data_source_connections(id) ON DELETE SET NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Folders table for hierarchical organization
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS folders (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(100) NOT NULL,
                        slug VARCHAR(100) NOT NULL,
                        parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
                        description TEXT,
                        color VARCHAR(7) DEFAULT '#207176',
                        icon VARCHAR(50) DEFAULT 'folder',
                        sort_order INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Add unique constraint for slug within parent
                cur.execute('''
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'folders_parent_slug_unique'
                        ) THEN
                            ALTER TABLE folders ADD CONSTRAINT folders_parent_slug_unique UNIQUE (parent_id, slug);
                        END IF;
                    END $$;
                ''')

                cur.execute('''
                    CREATE TABLE IF NOT EXISTS reports (
                        id SERIAL PRIMARY KEY,
                        file_path VARCHAR(500) UNIQUE NOT NULL,
                        display_name VARCHAR(255) NOT NULL,
                        folder VARCHAR(255),
                        folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
                        parameters JSONB,
                        datasources JSONB,
                        last_scanned TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                # Add folder_id column if it doesn't exist (for existing databases)
                cur.execute('''
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'reports' AND column_name = 'folder_id'
                        ) THEN
                            ALTER TABLE reports ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
                        END IF;
                    END $$;
                ''')

                cur.execute('''
                    CREATE TABLE IF NOT EXISTS app_settings (
                        key VARCHAR(100) PRIMARY KEY,
                        value TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                conn.commit()

                # Migrate existing connections to use sql_servers
                self._migrate_connections_to_sql_servers()
        finally:
            conn.close()

    def _migrate_connections_to_sql_servers(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                # Find connections that have server/username but no sql_server_id
                cur.execute('''
                    SELECT DISTINCT server, port, username, password_encrypted
                    FROM data_source_connections
                    WHERE server IS NOT NULL
                    AND username IS NOT NULL
                    AND password_encrypted IS NOT NULL
                    AND sql_server_id IS NULL
                ''')
                unique_servers = cur.fetchall()

                for server_row in unique_servers:
                    # Create sql_server entry
                    server_name = f"{server_row['server']}:{server_row['port'] or 1433}"

                    # Check if this server already exists
                    cur.execute('''
                        SELECT id FROM sql_servers
                        WHERE server = %s AND port = %s AND username = %s
                    ''', (server_row['server'], server_row['port'] or 1433, server_row['username']))
                    existing = cur.fetchone()

                    if existing:
                        server_id = existing['id']
                    else:
                        # Create new sql_server entry
                        cur.execute('''
                            INSERT INTO sql_servers (name, server, port, username, password_encrypted)
                            VALUES (%s, %s, %s, %s, %s)
                            ON CONFLICT (name) DO UPDATE SET name = sql_servers.name
                            RETURNING id
                        ''', (
                            server_name,
                            server_row['server'],
                            server_row['port'] or 1433,
                            server_row['username'],
                            server_row['password_encrypted']
                        ))
                        result = cur.fetchone()
                        if result:
                            server_id = result['id']
                        else:
                            cur.execute('SELECT id FROM sql_servers WHERE name = %s', (server_name,))
                            server_id = cur.fetchone()['id']

                    # Update connections to use this sql_server
                    cur.execute('''
                        UPDATE data_source_connections
                        SET sql_server_id = %s
                        WHERE server = %s AND port = %s AND username = %s
                        AND sql_server_id IS NULL
                    ''', (server_id, server_row['server'], server_row['port'] or 1433, server_row['username']))

                conn.commit()
        finally:
            conn.close()

    # ============== SQL Servers ==============

    def get_all_sql_servers(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM sql_servers ORDER BY name')
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def get_sql_server_by_id(self, server_id):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM sql_servers WHERE id = %s', (server_id,))
                row = cur.fetchone()
                return dict(row) if row else None
        finally:
            conn.close()

    def create_sql_server(self, data):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    INSERT INTO sql_servers
                    (name, server, port, username, password_encrypted)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                ''', (
                    data['name'],
                    data['server'],
                    data.get('port', 1433),
                    data['username'],
                    self.encrypt_password(data['password'])
                ))
                conn.commit()
                return cur.fetchone()['id']
        finally:
            conn.close()

    def update_sql_server(self, server_id, data):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                fields = []
                values = []

                if 'name' in data:
                    fields.append('name = %s')
                    values.append(data['name'])
                if 'server' in data:
                    fields.append('server = %s')
                    values.append(data['server'])
                if 'port' in data:
                    fields.append('port = %s')
                    values.append(data['port'])
                if 'username' in data:
                    fields.append('username = %s')
                    values.append(data['username'])
                if 'password' in data and data['password']:
                    fields.append('password_encrypted = %s')
                    values.append(self.encrypt_password(data['password']))

                fields.append('updated_at = CURRENT_TIMESTAMP')
                values.append(server_id)

                cur.execute(f'''
                    UPDATE sql_servers
                    SET {', '.join(fields)}
                    WHERE id = %s
                ''', values)
                conn.commit()
        finally:
            conn.close()

    def delete_sql_server(self, server_id):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM sql_servers WHERE id = %s', (server_id,))
                conn.commit()
        finally:
            conn.close()

    def get_databases_for_server(self, server_id):
        server = self.get_sql_server_by_id(server_id)
        if not server:
            return []

        try:
            mssql = MSSQLManager(
                server=server['server'],
                port=server.get('port', 1433),
                database='master',
                username=server['username'],
                password=self.decrypt_password(server['password_encrypted'])
            )
            results = mssql.execute_query('''
                SELECT name FROM sys.databases
                WHERE state_desc = 'ONLINE'
                AND name NOT IN ('master', 'tempdb', 'model', 'msdb')
                ORDER BY name
            ''')
            return [row['name'] for row in results]
        except Exception:
            return []

    # ============== Connections ==============

    def get_all_connections(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    SELECT c.*, s.name as server_name, s.server as server_address,
                           s.port as server_port, s.username as server_username
                    FROM data_source_connections c
                    LEFT JOIN sql_servers s ON c.sql_server_id = s.id
                    ORDER BY c.name
                ''')
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def get_connection_by_id(self, conn_id):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    SELECT c.*, s.name as server_name, s.server as server_address,
                           s.port as server_port, s.username as server_username,
                           s.password_encrypted as server_password_encrypted
                    FROM data_source_connections c
                    LEFT JOIN sql_servers s ON c.sql_server_id = s.id
                    WHERE c.id = %s
                ''', (conn_id,))
                row = cur.fetchone()
                return dict(row) if row else None
        finally:
            conn.close()

    def create_connection(self, data):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                # Support both new format (sql_server_id) and legacy format (all fields)
                if 'sql_server_id' in data:
                    cur.execute('''
                        INSERT INTO data_source_connections
                        (name, database_name, sql_server_id)
                        VALUES (%s, %s, %s)
                        RETURNING id
                    ''', (
                        data['name'],
                        data['database_name'],
                        data['sql_server_id']
                    ))
                else:
                    cur.execute('''
                        INSERT INTO data_source_connections
                        (name, server, port, database_name, username, password_encrypted)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        RETURNING id
                    ''', (
                        data['name'],
                        data['server'],
                        data.get('port', 1433),
                        data['database_name'],
                        data['username'],
                        self.encrypt_password(data['password'])
                    ))
                conn.commit()
                return cur.fetchone()['id']
        finally:
            conn.close()

    def update_connection(self, conn_id, data):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                fields = []
                values = []

                if 'name' in data:
                    fields.append('name = %s')
                    values.append(data['name'])
                if 'database_name' in data:
                    fields.append('database_name = %s')
                    values.append(data['database_name'])
                if 'sql_server_id' in data:
                    fields.append('sql_server_id = %s')
                    values.append(data['sql_server_id'])
                # Legacy field support
                if 'server' in data:
                    fields.append('server = %s')
                    values.append(data['server'])
                if 'port' in data:
                    fields.append('port = %s')
                    values.append(data['port'])
                if 'username' in data:
                    fields.append('username = %s')
                    values.append(data['username'])
                if 'password' in data and data['password']:
                    fields.append('password_encrypted = %s')
                    values.append(self.encrypt_password(data['password']))

                fields.append('updated_at = CURRENT_TIMESTAMP')
                values.append(conn_id)

                cur.execute(f'''
                    UPDATE data_source_connections
                    SET {', '.join(fields)}
                    WHERE id = %s
                ''', values)
                conn.commit()
        finally:
            conn.close()

    def delete_connection(self, conn_id):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM data_source_connections WHERE id = %s', (conn_id,))
                conn.commit()
        finally:
            conn.close()

    # ============== Mappings ==============

    def get_all_mappings(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    SELECT m.*, c.name as connection_name
                    FROM data_source_mappings m
                    LEFT JOIN data_source_connections c ON m.connection_id = c.id
                    ORDER BY m.rdl_datasource_name
                ''')
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def upsert_mapping(self, rdl_name, connection_id):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    INSERT INTO data_source_mappings (rdl_datasource_name, connection_id)
                    VALUES (%s, %s)
                    ON CONFLICT (rdl_datasource_name)
                    DO UPDATE SET connection_id = EXCLUDED.connection_id
                ''', (rdl_name, connection_id))
                conn.commit()
        finally:
            conn.close()

    # ============== Reports ==============

    def get_all_reports(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    SELECT r.*, f.name AS folder_name, f.color AS folder_color
                    FROM reports r
                    LEFT JOIN folders f ON r.folder_id = f.id
                    ORDER BY f.name NULLS LAST, r.display_name
                ''')
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def get_report_by_id(self, report_id):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM reports WHERE id = %s', (report_id,))
                row = cur.fetchone()
                return dict(row) if row else None
        finally:
            conn.close()

    def upsert_report(self, data):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    INSERT INTO reports (file_path, display_name, folder, folder_id, parameters, datasources, last_scanned)
                    VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                    ON CONFLICT (file_path)
                    DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        folder = EXCLUDED.folder,
                        folder_id = EXCLUDED.folder_id,
                        parameters = EXCLUDED.parameters,
                        datasources = EXCLUDED.datasources,
                        last_scanned = CURRENT_TIMESTAMP
                ''', (
                    data['file_path'],
                    data['display_name'],
                    data.get('folder'),
                    data.get('folder_id'),
                    data.get('parameters', '[]'),
                    data.get('datasources', '[]')
                ))
                conn.commit()
        finally:
            conn.close()

    def delete_report(self, report_id):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM reports WHERE id = %s', (report_id,))
                conn.commit()
        finally:
            conn.close()

    def move_reports_to_folder(self, report_ids, folder_id):
        """Move multiple reports to a folder"""
        if not report_ids:
            return 0
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    UPDATE reports SET folder_id = %s
                    WHERE id = ANY(%s)
                ''', (folder_id, report_ids))
                conn.commit()
                return cur.rowcount
        finally:
            conn.close()

    def get_reports_by_folder(self, folder_id, include_subfolders=False):
        """Get reports in a folder, optionally including subfolders"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                if folder_id is None:
                    # Root level - uncategorized reports
                    cur.execute('''
                        SELECT r.*, NULL AS folder_name, NULL AS folder_color
                        FROM reports r WHERE folder_id IS NULL ORDER BY display_name
                    ''')
                elif include_subfolders:
                    # Include all descendants
                    cur.execute('''
                        WITH RECURSIVE folder_tree AS (
                            SELECT id FROM folders WHERE id = %s
                            UNION ALL
                            SELECT f.id FROM folders f
                            JOIN folder_tree ft ON f.parent_id = ft.id
                        )
                        SELECT r.*, fld.name AS folder_name, fld.color AS folder_color
                        FROM reports r
                        LEFT JOIN folders fld ON r.folder_id = fld.id
                        WHERE r.folder_id IN (SELECT id FROM folder_tree)
                        ORDER BY r.display_name
                    ''', (folder_id,))
                else:
                    cur.execute('''
                        SELECT r.*, f.name AS folder_name, f.color AS folder_color
                        FROM reports r
                        LEFT JOIN folders f ON r.folder_id = f.id
                        WHERE r.folder_id = %s ORDER BY r.display_name
                    ''', (folder_id,))
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    # ============== Folders ==============

    def _generate_slug(self, name):
        """Generate URL-friendly slug from name"""
        import re
        slug = name.lower().strip()
        slug = re.sub(r'[^\w\s-]', '', slug)
        slug = re.sub(r'[-\s]+', '-', slug)
        return slug[:100]

    def get_all_folders(self):
        """Get all folders with hierarchy info and report counts"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    WITH RECURSIVE folder_tree AS (
                        SELECT id, name, slug, parent_id, description, color, icon,
                               sort_order, created_at, updated_at, 0 as depth,
                               ARRAY[sort_order, id] as path
                        FROM folders WHERE parent_id IS NULL
                        UNION ALL
                        SELECT f.id, f.name, f.slug, f.parent_id, f.description,
                               f.color, f.icon, f.sort_order, f.created_at, f.updated_at,
                               ft.depth + 1, ft.path || ARRAY[f.sort_order, f.id]
                        FROM folders f
                        JOIN folder_tree ft ON f.parent_id = ft.id
                    )
                    SELECT ft.*,
                           COALESCE((SELECT COUNT(*) FROM reports r WHERE r.folder_id = ft.id), 0) as report_count,
                           COALESCE((SELECT COUNT(*) FROM folders f WHERE f.parent_id = ft.id), 0) as child_count
                    FROM folder_tree ft
                    ORDER BY path
                ''')
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def get_folder_by_id(self, folder_id):
        """Get single folder with report count"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    SELECT f.*,
                           COALESCE((SELECT COUNT(*) FROM reports r WHERE r.folder_id = f.id), 0) as report_count,
                           COALESCE((SELECT COUNT(*) FROM folders c WHERE c.parent_id = f.id), 0) as child_count
                    FROM folders f
                    WHERE f.id = %s
                ''', (folder_id,))
                row = cur.fetchone()
                return dict(row) if row else None
        finally:
            conn.close()

    def create_folder(self, data):
        """Create a new folder"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                name = data['name'].strip()
                slug = self._generate_slug(name)
                parent_id = data.get('parent_id')

                # Ensure unique slug within parent
                base_slug = slug
                counter = 1
                while True:
                    cur.execute('''
                        SELECT 1 FROM folders
                        WHERE slug = %s AND (parent_id = %s OR (parent_id IS NULL AND %s IS NULL))
                    ''', (slug, parent_id, parent_id))
                    if not cur.fetchone():
                        break
                    slug = f"{base_slug}-{counter}"
                    counter += 1

                # Get next sort_order
                cur.execute('''
                    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
                    FROM folders WHERE parent_id = %s OR (parent_id IS NULL AND %s IS NULL)
                ''', (parent_id, parent_id))
                sort_order = cur.fetchone()['next_order']

                cur.execute('''
                    INSERT INTO folders (name, slug, parent_id, description, color, icon, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, name, slug, parent_id, description, color, icon, sort_order, created_at, updated_at
                ''', (
                    name,
                    slug,
                    parent_id if parent_id else None,
                    data.get('description', ''),
                    data.get('color', '#207176'),
                    data.get('icon', 'folder'),
                    sort_order
                ))
                conn.commit()
                row = cur.fetchone()
                return dict(row)
        finally:
            conn.close()

    def update_folder(self, folder_id, data):
        """Update folder properties"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                fields = []
                values = []

                if 'name' in data:
                    name = data['name'].strip()
                    fields.append('name = %s')
                    values.append(name)
                    # Update slug too
                    slug = self._generate_slug(name)
                    # Check uniqueness
                    cur.execute('SELECT parent_id FROM folders WHERE id = %s', (folder_id,))
                    parent_id = cur.fetchone()['parent_id']
                    cur.execute('''
                        SELECT 1 FROM folders
                        WHERE slug = %s AND id != %s AND (parent_id = %s OR (parent_id IS NULL AND %s IS NULL))
                    ''', (slug, folder_id, parent_id, parent_id))
                    if not cur.fetchone():
                        fields.append('slug = %s')
                        values.append(slug)

                if 'description' in data:
                    fields.append('description = %s')
                    values.append(data['description'])
                if 'color' in data:
                    fields.append('color = %s')
                    values.append(data['color'])
                if 'icon' in data:
                    fields.append('icon = %s')
                    values.append(data['icon'])

                if not fields:
                    return

                fields.append('updated_at = CURRENT_TIMESTAMP')
                values.append(folder_id)

                cur.execute(f'''
                    UPDATE folders SET {', '.join(fields)}
                    WHERE id = %s
                ''', values)
                conn.commit()
        finally:
            conn.close()

    def delete_folder(self, folder_id):
        """Delete folder - moves orphaned reports to root (null folder_id)"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                # Get all descendant folder IDs
                cur.execute('''
                    WITH RECURSIVE folder_tree AS (
                        SELECT id FROM folders WHERE id = %s
                        UNION ALL
                        SELECT f.id FROM folders f
                        JOIN folder_tree ft ON f.parent_id = ft.id
                    )
                    SELECT id FROM folder_tree
                ''', (folder_id,))
                folder_ids = [row['id'] for row in cur.fetchall()]

                # Move all reports in these folders to root
                if folder_ids:
                    cur.execute('''
                        UPDATE reports SET folder_id = NULL
                        WHERE folder_id = ANY(%s)
                    ''', (folder_ids,))

                # Delete folder (cascade will delete children)
                cur.execute('DELETE FROM folders WHERE id = %s', (folder_id,))
                conn.commit()
        finally:
            conn.close()

    def move_folder(self, folder_id, new_parent_id):
        """Move folder to new parent with cycle detection"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                # Prevent moving to self
                if folder_id == new_parent_id:
                    raise ValueError("Cannot move folder to itself")

                # Check for cycle - ensure new_parent is not a descendant
                if new_parent_id:
                    cur.execute('''
                        WITH RECURSIVE folder_tree AS (
                            SELECT id FROM folders WHERE id = %s
                            UNION ALL
                            SELECT f.id FROM folders f
                            JOIN folder_tree ft ON f.parent_id = ft.id
                        )
                        SELECT 1 FROM folder_tree WHERE id = %s
                    ''', (folder_id, new_parent_id))
                    if cur.fetchone():
                        raise ValueError("Cannot move folder to its own descendant")

                # Get current folder info for slug uniqueness check
                cur.execute('SELECT slug FROM folders WHERE id = %s', (folder_id,))
                slug = cur.fetchone()['slug']

                # Check slug uniqueness in new parent
                cur.execute('''
                    SELECT 1 FROM folders
                    WHERE slug = %s AND id != %s AND (parent_id = %s OR (parent_id IS NULL AND %s IS NULL))
                ''', (slug, folder_id, new_parent_id, new_parent_id))
                if cur.fetchone():
                    # Append number to make unique
                    base_slug = slug
                    counter = 1
                    while True:
                        new_slug = f"{base_slug}-{counter}"
                        cur.execute('''
                            SELECT 1 FROM folders
                            WHERE slug = %s AND (parent_id = %s OR (parent_id IS NULL AND %s IS NULL))
                        ''', (new_slug, new_parent_id, new_parent_id))
                        if not cur.fetchone():
                            slug = new_slug
                            break
                        counter += 1

                # Update parent
                cur.execute('''
                    UPDATE folders SET parent_id = %s, slug = %s, updated_at = CURRENT_TIMESTAMP
                    WHERE id = %s
                ''', (new_parent_id if new_parent_id else None, slug, folder_id))
                conn.commit()
        finally:
            conn.close()

    def get_folder_path(self, folder_id):
        """Get path from root to folder (for breadcrumbs)"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    WITH RECURSIVE folder_path AS (
                        SELECT id, name, parent_id, 1 as level
                        FROM folders WHERE id = %s
                        UNION ALL
                        SELECT f.id, f.name, f.parent_id, fp.level + 1
                        FROM folders f
                        JOIN folder_path fp ON f.id = fp.parent_id
                    )
                    SELECT id, name FROM folder_path ORDER BY level DESC
                ''', (folder_id,))
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def reorder_folders(self, folder_orders):
        """Update sort_order for multiple folders: [(id, order), ...]"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                for folder_id, order in folder_orders:
                    cur.execute('''
                        UPDATE folders SET sort_order = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                    ''', (order, folder_id))
                conn.commit()
        finally:
            conn.close()

    def get_uncategorized_count(self):
        """Get count of reports with no folder"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT COUNT(*) as count FROM reports WHERE folder_id IS NULL')
                return cur.fetchone()['count']
        finally:
            conn.close()

    def migrate_text_folders(self):
        """Migrate existing text-based folder column to folder_id references"""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                # Get distinct folder names that haven't been migrated
                cur.execute('''
                    SELECT DISTINCT folder FROM reports
                    WHERE folder IS NOT NULL AND folder != '' AND folder_id IS NULL
                ''')
                folders = [row['folder'] for row in cur.fetchall()]

                for folder_name in folders:
                    # Create folder if doesn't exist
                    slug = self._generate_slug(folder_name)
                    cur.execute('''
                        INSERT INTO folders (name, slug, parent_id)
                        VALUES (%s, %s, NULL)
                        ON CONFLICT (parent_id, slug) DO NOTHING
                        RETURNING id
                    ''', (folder_name, slug))
                    result = cur.fetchone()

                    if result:
                        folder_id = result['id']
                    else:
                        # Already exists, get the id
                        cur.execute('''
                            SELECT id FROM folders WHERE slug = %s AND parent_id IS NULL
                        ''', (slug,))
                        folder_id = cur.fetchone()['id']

                    # Update reports with this folder name
                    cur.execute('''
                        UPDATE reports SET folder_id = %s
                        WHERE folder = %s AND folder_id IS NULL
                    ''', (folder_id, folder_name))

                conn.commit()
                return len(folders)
        finally:
            conn.close()

    # ============== Settings ==============

    def get_all_settings(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT key, value FROM app_settings')
                return {row['key']: row['value'] for row in cur.fetchall()}
        finally:
            conn.close()

    def save_setting(self, key, value):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('''
                    INSERT INTO app_settings (key, value, updated_at)
                    VALUES (%s, %s, CURRENT_TIMESTAMP)
                    ON CONFLICT (key)
                    DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
                ''', (key, value))
                conn.commit()
        finally:
            conn.close()


class MSSQLManager:
    def __init__(self, server, port, database, username, password):
        self.server = server
        self.port = port
        self.database = database
        self.username = username
        self.password = password

    def _get_connection(self):
        return pymssql.connect(
            server=self.server,
            port=self.port,
            database=self.database,
            user=self.username,
            password=self.password
        )

    def test_connection(self):
        try:
            conn = self._get_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT 1')
            cursor.close()
            conn.close()
            return True, None
        except Exception as e:
            return False, str(e)

    def execute_query(self, query, params=None):
        conn = self._get_connection()
        try:
            cursor = conn.cursor(as_dict=True)
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            results = cursor.fetchall()
            cursor.close()
            return results
        finally:
            conn.close()
