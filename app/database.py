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
                cur.execute('''
                    CREATE TABLE IF NOT EXISTS data_source_connections (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(100) UNIQUE NOT NULL,
                        server VARCHAR(255) NOT NULL,
                        port INTEGER DEFAULT 1433,
                        database_name VARCHAR(255) NOT NULL,
                        username VARCHAR(100) NOT NULL,
                        password_encrypted TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                cur.execute('''
                    CREATE TABLE IF NOT EXISTS data_source_mappings (
                        id SERIAL PRIMARY KEY,
                        rdl_datasource_name VARCHAR(100) UNIQUE NOT NULL,
                        connection_id INTEGER REFERENCES data_source_connections(id) ON DELETE SET NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                cur.execute('''
                    CREATE TABLE IF NOT EXISTS reports (
                        id SERIAL PRIMARY KEY,
                        file_path VARCHAR(500) UNIQUE NOT NULL,
                        display_name VARCHAR(255) NOT NULL,
                        folder VARCHAR(255),
                        parameters JSONB,
                        datasources JSONB,
                        last_scanned TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                cur.execute('''
                    CREATE TABLE IF NOT EXISTS app_settings (
                        key VARCHAR(100) PRIMARY KEY,
                        value TEXT,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')

                conn.commit()
        finally:
            conn.close()

    # ============== Connections ==============

    def get_all_connections(self):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM data_source_connections ORDER BY name')
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def get_connection_by_id(self, conn_id):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM data_source_connections WHERE id = %s', (conn_id,))
                row = cur.fetchone()
                return dict(row) if row else None
        finally:
            conn.close()

    def create_connection(self, data):
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
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
                # Build update query dynamically
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
                if 'database_name' in data:
                    fields.append('database_name = %s')
                    values.append(data['database_name'])
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
                cur.execute('SELECT * FROM reports ORDER BY folder, display_name')
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
                    INSERT INTO reports (file_path, display_name, folder, parameters, datasources, last_scanned)
                    VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                    ON CONFLICT (file_path)
                    DO UPDATE SET
                        display_name = EXCLUDED.display_name,
                        folder = EXCLUDED.folder,
                        parameters = EXCLUDED.parameters,
                        datasources = EXCLUDED.datasources,
                        last_scanned = CURRENT_TIMESTAMP
                ''', (
                    data['file_path'],
                    data['display_name'],
                    data.get('folder'),
                    data.get('parameters', '[]'),
                    data.get('datasources', '[]')
                ))
                conn.commit()
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
