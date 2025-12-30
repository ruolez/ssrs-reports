import os
import io
import csv
import json
import time
from flask import Flask, render_template, request, jsonify, send_file, make_response, Response
from .database import PostgreSQLManager, MSSQLManager
from .rdl.parser import RdlParser
from .rdl.executor import ReportExecutor
from .rdl.renderer import ReportRenderer
from .export.excel import export_to_excel
from .export.pdf import export_to_pdf

app = Flask(__name__)
app.config['JSON_SORT_KEYS'] = False
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Initialize database manager
db = PostgreSQLManager()

# Reports directory
REPORTS_DIR = os.environ.get('REPORTS_DIR', '/app/data/reports')


def no_cache(content):
    response = make_response(content)
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


# ============== Pages ==============

@app.route('/')
def reports_page():
    return no_cache(render_template('reports.html'))


@app.route('/viewer/<int:report_id>')
def viewer_page(report_id):
    return no_cache(render_template('viewer.html', report_id=report_id))


@app.route('/datasources')
def datasources_page():
    return no_cache(render_template('datasources.html'))


@app.route('/settings')
def settings_page():
    return no_cache(render_template('settings.html'))


# ============== Reports API ==============

@app.route('/api/reports', methods=['GET'])
def list_reports():
    try:
        reports = db.get_all_reports()
        return jsonify({'success': True, 'reports': reports})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/<int:report_id>', methods=['GET'])
def get_report(report_id):
    try:
        report = db.get_report_by_id(report_id)
        if not report:
            return jsonify({'success': False, 'error': 'Report not found'}), 404

        # Parse datasources from report
        datasources = report.get('datasources', [])
        if isinstance(datasources, str):
            datasources = json.loads(datasources) if datasources else []

        # Get all mappings and connections
        all_mappings = db.get_all_mappings()
        all_connections = db.get_all_connections()

        # Build mapping lookup: rdl_datasource_name -> mapping info
        mapping_lookup = {m['rdl_datasource_name']: m for m in all_mappings}
        connection_lookup = {c['id']: c for c in all_connections}

        # Build datasource status for each datasource in the report
        datasource_status = []
        for ds in datasources:
            ds_name = ds.get('name')
            mapping = mapping_lookup.get(ds_name)

            status = {
                'name': ds_name,
                'reference': ds.get('reference', ''),
                'is_mapped': False,
                'connection_id': None,
                'connection_name': None
            }

            if mapping and mapping.get('connection_id'):
                conn = connection_lookup.get(mapping['connection_id'])
                if conn:
                    status['is_mapped'] = True
                    status['connection_id'] = conn['id']
                    status['connection_name'] = conn['name']

            datasource_status.append(status)

        # Clean connections for response (remove passwords)
        connections = [{
            'id': c['id'],
            'name': c['name'],
            'server': c['server'],
            'database_name': c['database_name']
        } for c in all_connections]

        return jsonify({
            'success': True,
            'report': report,
            'datasource_status': datasource_status,
            'connections': connections
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/scan', methods=['POST'])
def scan_reports():
    try:
        count = 0
        for root, dirs, files in os.walk(REPORTS_DIR):
            for file in files:
                if file.lower().endswith('.rdl'):
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, REPORTS_DIR)
                    folder = os.path.dirname(rel_path) or None

                    # Parse RDL to extract metadata
                    parser = RdlParser(file_path)
                    report_info = parser.parse()

                    # Save to database
                    db.upsert_report({
                        'file_path': rel_path,
                        'display_name': os.path.splitext(file)[0],
                        'folder': folder,
                        'parameters': json.dumps(report_info.get('parameters', [])),
                        'datasources': json.dumps(report_info.get('datasources', []))
                    })
                    count += 1

        return jsonify({'success': True, 'count': count, 'message': f'Scanned {count} reports'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/upload', methods=['POST'])
def upload_report():
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400

        if not file.filename.lower().endswith('.rdl'):
            return jsonify({'success': False, 'error': 'Only .rdl files are allowed'}), 400

        # Get optional folder_id from form data (new system)
        folder_id = request.form.get('folder_id', '').strip()
        folder_id = int(folder_id) if folder_id else None

        # Sanitize filename
        filename = os.path.basename(file.filename)

        # Save file directly to reports directory
        save_path = os.path.join(REPORTS_DIR, filename)
        rel_path = filename

        # Save file
        file.save(save_path)

        # Parse RDL to extract metadata
        parser = RdlParser(save_path)
        report_info = parser.parse()

        # Save to database
        db.upsert_report({
            'file_path': rel_path,
            'display_name': os.path.splitext(filename)[0],
            'folder': None,
            'folder_id': folder_id,
            'parameters': json.dumps(report_info.get('parameters', [])),
            'datasources': json.dumps(report_info.get('datasources', []))
        })

        return jsonify({
            'success': True,
            'message': f'Uploaded {filename}',
            'filename': filename
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/<int:report_id>', methods=['DELETE'])
def delete_report(report_id):
    try:
        report = db.get_report_by_id(report_id)
        if not report:
            return jsonify({'success': False, 'error': 'Report not found'}), 404

        # Delete the file
        file_path = os.path.join(REPORTS_DIR, report['file_path'])
        if os.path.exists(file_path):
            os.remove(file_path)

        # Delete from database
        db.delete_report(report_id)

        return jsonify({'success': True, 'message': 'Report deleted'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/<int:report_id>/execute', methods=['POST'])
def execute_report(report_id):
    try:
        start_time = time.time()

        report = db.get_report_by_id(report_id)
        if not report:
            return jsonify({'success': False, 'error': 'Report not found'}), 404

        # Get parameters from request
        params = request.json.get('parameters', {})
        sort_column = request.json.get('sort_column')
        sort_direction = request.json.get('sort_direction', 'asc')

        # Parse RDL
        file_path = os.path.join(REPORTS_DIR, report['file_path'])
        parser = RdlParser(file_path)
        report_def = parser.parse()

        # Get data source mappings
        mappings = db.get_all_mappings()
        connections = db.get_all_connections()

        # Execute report
        executor = ReportExecutor(report_def, mappings, connections, db)
        data = executor.execute(params)

        # Render to HTML
        renderer = ReportRenderer(report_def)
        html = renderer.render(data, sort_column, sort_direction)

        # Calculate execution time in milliseconds
        exec_time_ms = (time.time() - start_time) * 1000

        return jsonify({
            'success': True,
            'html': html,
            'row_count': len(data.get('primary', [])),
            'exec_time_ms': round(exec_time_ms, 2),
            'parameters': report_def.get('parameters', [])
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/<int:report_id>/export/excel', methods=['POST'])
def export_excel(report_id):
    try:
        report = db.get_report_by_id(report_id)
        if not report:
            return jsonify({'success': False, 'error': 'Report not found'}), 404

        params = request.json.get('parameters', {})

        # Parse and execute
        file_path = os.path.join(REPORTS_DIR, report['file_path'])
        parser = RdlParser(file_path)
        report_def = parser.parse()

        mappings = db.get_all_mappings()
        connections = db.get_all_connections()

        executor = ReportExecutor(report_def, mappings, connections, db)
        data = executor.execute(params)

        # Export to Excel
        excel_path = export_to_excel(report_def, data, report['display_name'])

        return send_file(
            excel_path,
            as_attachment=True,
            download_name=f"{report['display_name']}.xlsx",
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/<int:report_id>/export/pdf', methods=['POST'])
def export_pdf(report_id):
    try:
        report = db.get_report_by_id(report_id)
        if not report:
            return jsonify({'success': False, 'error': 'Report not found'}), 404

        params = request.json.get('parameters', {})

        # Parse and execute
        file_path = os.path.join(REPORTS_DIR, report['file_path'])
        parser = RdlParser(file_path)
        report_def = parser.parse()

        mappings = db.get_all_mappings()
        connections = db.get_all_connections()

        executor = ReportExecutor(report_def, mappings, connections, db)
        data = executor.execute(params)

        # Render and export to PDF
        renderer = ReportRenderer(report_def)
        html = renderer.render(data)
        pdf_path = export_to_pdf(html, report['display_name'])

        return send_file(
            pdf_path,
            as_attachment=True,
            download_name=f"{report['display_name']}.pdf",
            mimetype='application/pdf'
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Folders API ==============

@app.route('/api/folders', methods=['GET'])
def list_folders():
    try:
        folders = db.get_all_folders()
        uncategorized_count = db.get_uncategorized_count()
        return jsonify({
            'success': True,
            'folders': folders,
            'uncategorized_count': uncategorized_count
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders', methods=['POST'])
def create_folder():
    try:
        data = request.json
        if not data.get('name'):
            return jsonify({'success': False, 'error': 'Folder name is required'}), 400

        folder = db.create_folder(data)
        return jsonify({'success': True, 'folder': folder})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders/<int:folder_id>', methods=['GET'])
def get_folder(folder_id):
    try:
        folder = db.get_folder_by_id(folder_id)
        if not folder:
            return jsonify({'success': False, 'error': 'Folder not found'}), 404

        path = db.get_folder_path(folder_id)
        return jsonify({'success': True, 'folder': folder, 'path': path})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders/<int:folder_id>', methods=['PUT'])
def update_folder(folder_id):
    try:
        folder = db.get_folder_by_id(folder_id)
        if not folder:
            return jsonify({'success': False, 'error': 'Folder not found'}), 404

        data = request.json
        db.update_folder(folder_id, data)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders/<int:folder_id>', methods=['DELETE'])
def delete_folder(folder_id):
    try:
        folder = db.get_folder_by_id(folder_id)
        if not folder:
            return jsonify({'success': False, 'error': 'Folder not found'}), 404

        db.delete_folder(folder_id)
        return jsonify({'success': True, 'message': 'Folder deleted'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders/<int:folder_id>/move', methods=['POST'])
def move_folder(folder_id):
    try:
        folder = db.get_folder_by_id(folder_id)
        if not folder:
            return jsonify({'success': False, 'error': 'Folder not found'}), 404

        data = request.json
        new_parent_id = data.get('parent_id')

        db.move_folder(folder_id, new_parent_id)
        return jsonify({'success': True})
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders/<int:folder_id>/path', methods=['GET'])
def get_folder_path(folder_id):
    try:
        path = db.get_folder_path(folder_id)
        return jsonify({'success': True, 'path': path})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders/<int:folder_id>/reports', methods=['GET'])
def get_folder_reports(folder_id):
    try:
        include_subfolders = request.args.get('include_subfolders', 'false').lower() == 'true'
        reports = db.get_reports_by_folder(folder_id, include_subfolders)
        return jsonify({'success': True, 'reports': reports})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders/reorder', methods=['POST'])
def reorder_folders():
    try:
        data = request.json
        orders = data.get('orders', [])  # [(folder_id, sort_order), ...]
        db.reorder_folders(orders)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/folders/migrate', methods=['POST'])
def migrate_folders():
    """Migrate text-based folders to new folder system"""
    try:
        count = db.migrate_text_folders()
        return jsonify({'success': True, 'migrated_count': count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/move', methods=['POST'])
def move_reports():
    """Move multiple reports to a folder"""
    try:
        data = request.json
        report_ids = data.get('report_ids', [])
        folder_id = data.get('folder_id')  # None = uncategorized

        if not report_ids:
            return jsonify({'success': False, 'error': 'No reports specified'}), 400

        count = db.move_reports_to_folder(report_ids, folder_id)
        return jsonify({'success': True, 'moved_count': count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/bulk-delete', methods=['POST'])
def bulk_delete_reports():
    """Delete multiple reports"""
    try:
        data = request.json
        report_ids = data.get('report_ids', [])

        if not report_ids:
            return jsonify({'success': False, 'error': 'No reports specified'}), 400

        deleted = 0
        for report_id in report_ids:
            report = db.get_report_by_id(report_id)
            if report:
                file_path = os.path.join(REPORTS_DIR, report['file_path'])
                if os.path.exists(file_path):
                    os.remove(file_path)
                db.delete_report(report_id)
                deleted += 1

        return jsonify({'success': True, 'deleted_count': deleted})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/reports/<int:report_id>/export/csv', methods=['POST'])
def export_csv(report_id):
    try:
        report = db.get_report_by_id(report_id)
        if not report:
            return jsonify({'success': False, 'error': 'Report not found'}), 404

        params = request.json.get('parameters', {})

        # Parse and execute
        file_path = os.path.join(REPORTS_DIR, report['file_path'])
        parser = RdlParser(file_path)
        report_def = parser.parse()

        mappings = db.get_all_mappings()
        connections = db.get_all_connections()

        executor = ReportExecutor(report_def, mappings, connections, db)
        data = executor.execute(params)

        # Get columns and rows
        tablixes = report_def.get('tablixes', [])
        if not tablixes:
            return jsonify({'success': False, 'error': 'No data found'}), 400

        tablix = tablixes[0]
        columns = tablix.get('columns', [])
        rows = data.get('primary', [])

        # Create CSV in memory
        output = io.StringIO()
        writer = csv.writer(output)

        # Write header row
        headers = [col.get('header_text', f'Column {i}') for i, col in enumerate(columns)]
        writer.writerow(headers)

        # Write data rows
        from .rdl.expression import evaluate_expression, ExpressionContext
        lookup_tables = data.get('lookup_tables', {})

        for row_idx, row in enumerate(rows):
            context = ExpressionContext(row, row_idx + 1, lookup_tables)
            row_data = []
            for col in columns:
                expression = col.get('field_expression', '')
                value = evaluate_expression(expression, context)
                # Format value for CSV
                if value is None:
                    row_data.append('')
                elif isinstance(value, bool):
                    row_data.append('Yes' if value else 'No')
                else:
                    row_data.append(str(value))
            writer.writerow(row_data)

        # Create response
        output.seek(0)
        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={
                'Content-Disposition': f'attachment; filename="{report["display_name"]}.csv"'
            }
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Data Sources API ==============

@app.route('/api/datasources/connections', methods=['GET'])
def list_connections():
    try:
        connections = db.get_all_connections()
        # Remove passwords from response
        for conn in connections:
            conn.pop('password_encrypted', None)
        return jsonify({'success': True, 'connections': connections})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/datasources/connections', methods=['POST'])
def create_connection():
    try:
        data = request.json
        required = ['name', 'server', 'database_name', 'username', 'password']
        for field in required:
            if not data.get(field):
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400

        conn_id = db.create_connection(data)
        return jsonify({'success': True, 'id': conn_id})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/datasources/connections/<int:conn_id>', methods=['PUT'])
def update_connection(conn_id):
    try:
        data = request.json
        db.update_connection(conn_id, data)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/datasources/connections/<int:conn_id>', methods=['DELETE'])
def delete_connection(conn_id):
    try:
        db.delete_connection(conn_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/datasources/connections/<int:conn_id>/test', methods=['POST'])
def test_connection(conn_id):
    try:
        conn = db.get_connection_by_id(conn_id)
        if not conn:
            return jsonify({'success': False, 'error': 'Connection not found'}), 404

        mssql = MSSQLManager(
            server=conn['server'],
            port=conn.get('port', 1433),
            database=conn['database_name'],
            username=conn['username'],
            password=db.decrypt_password(conn['password_encrypted'])
        )

        success, error = mssql.test_connection()
        if success:
            return jsonify({'success': True, 'message': 'Connection successful'})
        else:
            return jsonify({'success': False, 'message': f'Connection failed: {error}'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/datasources/mappings', methods=['GET'])
def list_mappings():
    try:
        mappings = db.get_all_mappings()
        return jsonify({'success': True, 'mappings': mappings})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/datasources/mappings', methods=['POST'])
def save_mapping():
    try:
        data = request.json
        rdl_name = data.get('rdl_datasource_name')
        conn_id = data.get('connection_id')

        if not rdl_name:
            return jsonify({'success': False, 'error': 'Missing rdl_datasource_name'}), 400

        db.upsert_mapping(rdl_name, conn_id)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Settings API ==============

@app.route('/api/settings', methods=['GET'])
def get_settings():
    try:
        settings = db.get_all_settings()
        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/settings', methods=['POST'])
def save_settings():
    try:
        data = request.json
        for key, value in data.items():
            db.save_setting(key, value)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============== Health Check ==============

@app.route('/health')
def health():
    return jsonify({'status': 'healthy'})


# ============== Main ==============

if __name__ == '__main__':
    # Initialize database tables
    db.init_tables()

    # Run Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)
