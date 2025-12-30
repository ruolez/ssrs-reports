# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SSRS Reports Viewer - A web application that parses Microsoft SSRS RDL (Report Definition Language) files and renders reports in a browser. Replaces the need for SQL Server Reporting Services by executing queries directly against SQL Server.

## Development Commands

```bash
# Start development environment (Flask + PostgreSQL)
docker compose up -d --build

# View logs
docker compose logs -f web

# Restart after Python changes
docker compose restart web

# Access application
# Development: http://localhost:5557
# Production: http://localhost:80 (set by install.sh)

# Health check
curl http://localhost:5557/health
```

## Architecture

### Data Flow
1. **RDL Upload/Scan** → Parser extracts metadata → Stored in PostgreSQL
2. **Report Execution** → Parser reads RDL → Executor runs SQL against mapped SQL Server → Renderer outputs HTML
3. **Export** → Same execution path → Excel (openpyxl) or PDF (WeasyPrint)

### Core Components

**`app/rdl/parser.py`** - Parses RDL XML files (SSRS 2010 format with namespace `http://schemas.microsoft.com/sqlserver/reporting/2010/01/reportdefinition`). Extracts:
- DataSources (connection references)
- DataSets (SQL queries with parameters)
- Parameters (user inputs)
- Tablixes (table definitions with columns, styles, sorting, drillthrough)

**`app/rdl/executor.py`** - Executes datasets against SQL Server:
- Maps RDL datasource names to actual SQL Server connections via `data_source_mappings` table
- Converts `@ParamName` SQL parameters to pymssql's `%(ParamName)s` format
- Builds lookup tables for `Lookup()` function support

**`app/rdl/expression.py`** - Evaluates RDL expressions:
- `=Fields!FieldName.Value` - Field references
- `=RowNumber("DatasetName")` - Row numbering
- `=Lookup(source, key, value, "Dataset")` - Cross-dataset lookups
- Arithmetic: `=Fields!A.Value - Fields!B.Value`

**`app/rdl/renderer.py`** - Renders executed data to HTML tables with:
- Sortable columns (UserSort from RDL)
- Drillthrough links to other reports
- Style preservation from RDL

### Database Schema (PostgreSQL)

- `data_source_connections` - SQL Server connection credentials (password encrypted with Fernet)
- `data_source_mappings` - Maps RDL datasource names to connections
- `reports` - Report metadata cache (JSONB fields: parameters, datasources)
- `app_settings` - Application settings

### Key Technical Details

**pymssql Parameter Handling**: SQL Server `@param` syntax must be converted to `%(param)s` format before execution. See `executor.py` line 92-100.

**JSONB Fields**: PostgreSQL JSONB is auto-deserialized by psycopg2. JavaScript must check `typeof field === 'string'` before calling `JSON.parse()`.

**FreeTDS**: Required for pymssql to connect to SQL Server. Installed via Dockerfile.

## Production Deployment

The `install.sh` script handles Ubuntu 24 Server deployment:
- Installs Docker if needed
- Clones from GitHub to `/opt/ssrs-reports`
- Sets port to 80 (overrides docker-compose.yml's 5557)
- Options: Clean Install, Update (preserves data), Remove, Status, Logs

## File Structure

```
app/
├── main.py           # Flask routes and API endpoints
├── database.py       # PostgreSQLManager + MSSQLManager
├── rdl/
│   ├── parser.py     # RDL XML parsing
│   ├── executor.py   # SQL execution with parameter mapping
│   ├── expression.py # Expression evaluation (Fields, Lookup, RowNumber)
│   └── renderer.py   # HTML table generation
├── export/
│   ├── excel.py      # XLSX export via openpyxl
│   └── pdf.py        # PDF export via WeasyPrint
├── static/
│   ├── css/style.css # Dark/light theme styles
│   └── js/           # Page-specific JavaScript
└── templates/        # Jinja2 HTML templates
```
