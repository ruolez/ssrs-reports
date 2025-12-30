import re
from datetime import datetime
from typing import Dict, List, Any, Optional
from ..database import MSSQLManager
from .expression import parse_lookup_expression, is_lookup_expression


def convert_date_param(value: str) -> Any:
    """Convert date string to SQL Server compatible format.

    Returns date in 'YYYYMMDD' format which is language-independent
    and universally accepted by SQL Server regardless of locale settings.
    """
    if not value or not isinstance(value, str):
        return value

    # Try to parse and convert to SQL Server friendly format
    parsed_date = None

    # Try YYYY-MM-DD format (HTML date input)
    try:
        parsed_date = datetime.strptime(value, '%Y-%m-%d')
    except ValueError:
        pass

    # Try other common formats
    if not parsed_date:
        for fmt in ['%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d']:
            try:
                parsed_date = datetime.strptime(value, fmt)
                break
            except ValueError:
                continue

    # Return as YYYYMMDD string format - universally accepted by SQL Server
    if parsed_date:
        return parsed_date.strftime('%Y%m%d')

    return value


class ReportExecutor:
    def __init__(self, report_def: Dict, mappings: List[Dict], connections: List[Dict], db_manager):
        self.report_def = report_def
        self.mappings = {m['rdl_datasource_name']: m for m in mappings}
        self.connections = {c['id']: c for c in connections}
        self.db_manager = db_manager

    def execute(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute all datasets in the report and return the data.

        Returns:
            {
                'primary': [...],  # Main dataset rows
                'lookup_tables': {'DatasetName': {key: value, ...}, ...}
            }
        """
        datasets = self.report_def.get('datasets', [])
        tablixes = self.report_def.get('tablixes', [])

        # Determine primary dataset (used by first tablix)
        primary_dataset_name = tablixes[0]['dataset_name'] if tablixes else None

        # Find which datasets are used for Lookup
        lookup_datasets = self._find_lookup_datasets(tablixes)

        result = {
            'primary': [],
            'lookup_tables': {}
        }

        for dataset in datasets:
            dataset_name = dataset['name']
            data = self._execute_dataset(dataset, parameters)

            if dataset_name == primary_dataset_name:
                result['primary'] = data
            elif dataset_name in lookup_datasets:
                # Build lookup table
                lookup_info = lookup_datasets[dataset_name]
                result['lookup_tables'][dataset_name] = self._build_lookup_table(
                    data,
                    lookup_info['key_field'],
                    lookup_info['value_field']
                )

        return result

    def _execute_dataset(self, dataset: Dict, parameters: Dict[str, Any]) -> List[Dict]:
        """Execute a single dataset query."""
        datasource_name = dataset.get('datasource_name')

        # Get connection for this datasource
        mapping = self.mappings.get(datasource_name)
        if not mapping or not mapping.get('connection_id'):
            raise ValueError(f"No connection mapped for datasource: {datasource_name}")

        connection = self.connections.get(mapping['connection_id'])
        if not connection:
            raise ValueError(f"Connection not found for datasource: {datasource_name}")

        # Create MSSQL connection
        mssql = MSSQLManager(
            server=connection['server'],
            port=connection.get('port', 1433),
            database=connection['database_name'],
            username=connection['username'],
            password=self.db_manager.decrypt_password(connection['password_encrypted'])
        )

        # Prepare query with parameters
        query = dataset.get('query', '')
        query_params = dataset.get('query_parameters', [])

        # Build parameter dict for query
        sql_params = {}
        multi_value_params = {}

        for qp in query_params:
            param_name = qp['name'].lstrip('@')
            # Extract parameter name from expression like =Parameters!Date.Value
            param_expr = qp['value']
            match = re.search(r'Parameters!(\w+)\.Value', param_expr)
            if match:
                report_param_name = match.group(1)
                param_value = parameters.get(report_param_name, '')

                # Check if this is a multi-value parameter (array)
                if isinstance(param_value, list):
                    multi_value_params[param_name] = param_value
                else:
                    # Try to convert date strings to datetime objects
                    param_value = convert_date_param(param_value)
                    sql_params[param_name] = param_value

        # Handle multi-value parameters by expanding them inline
        # Replace IN (@ParamName) with IN (val1, val2, val3)
        for param_name, values in multi_value_params.items():
            if values:
                # Escape and quote values for SQL
                escaped_values = []
                for v in values:
                    if isinstance(v, (int, float)):
                        escaped_values.append(str(v))
                    elif v is not None:
                        # Try to convert string numbers to int for IN clause
                        try:
                            escaped_values.append(str(int(v)))
                        except (ValueError, TypeError):
                            # String value - escape single quotes
                            escaped = str(v).replace("'", "''")
                            escaped_values.append(f"'{escaped}'")

                values_str = ', '.join(escaped_values)

                # Replace IN (@ParamName) or IN(@ParamName) patterns
                query = re.sub(
                    r'IN\s*\(\s*@' + param_name + r'\s*\)',
                    f'IN ({values_str})',
                    query,
                    flags=re.IGNORECASE
                )

                # Also replace standalone @ParamName if not in IN clause
                # This handles other uses of multi-value params
                query = re.sub(
                    r'@' + param_name + r'\b',
                    f'({values_str})',
                    query,
                    flags=re.IGNORECASE
                )
            else:
                # No values selected - use impossible condition to return no rows
                query = re.sub(
                    r'IN\s*\(\s*@' + param_name + r'\s*\)',
                    'IN (NULL)',
                    query,
                    flags=re.IGNORECASE
                )
                query = re.sub(
                    r'@' + param_name + r'\b',
                    'NULL',
                    query,
                    flags=re.IGNORECASE
                )

        # Convert @ParamName to %(ParamName)s format for pymssql (single-value params only)
        if sql_params:
            for param_name in sql_params.keys():
                query = re.sub(
                    r'@' + param_name + r'\b',
                    '%(' + param_name + ')s',
                    query,
                    flags=re.IGNORECASE
                )

        # Execute query
        return mssql.execute_query(query, sql_params if sql_params else None)

    def _find_lookup_datasets(self, tablixes: List[Dict]) -> Dict[str, Dict]:
        """
        Find datasets used in Lookup functions.

        Returns:
            {dataset_name: {'key_field': 'field1', 'value_field': 'field2'}, ...}
        """
        lookup_datasets = {}

        for tablix in tablixes:
            for column in tablix.get('columns', []):
                expr = column.get('field_expression', '')
                if is_lookup_expression(expr):
                    lookup_info = parse_lookup_expression(expr)
                    if lookup_info:
                        dataset_name = lookup_info['dataset_name']
                        lookup_datasets[dataset_name] = {
                            'key_field': lookup_info['dest_field'],
                            'value_field': lookup_info['result_field']
                        }

                # Also check sort expression for Lookup
                sort_expr = column.get('sort_expression', '')
                if sort_expr and is_lookup_expression(sort_expr):
                    lookup_info = parse_lookup_expression(sort_expr)
                    if lookup_info:
                        dataset_name = lookup_info['dataset_name']
                        if dataset_name not in lookup_datasets:
                            lookup_datasets[dataset_name] = {
                                'key_field': lookup_info['dest_field'],
                                'value_field': lookup_info['result_field']
                            }

        return lookup_datasets

    def _build_lookup_table(self, data: List[Dict], key_field: str, value_field: str) -> Dict[str, Any]:
        """Build a lookup dictionary from dataset rows."""
        lookup = {}
        for row in data:
            key = row.get(key_field)
            value = row.get(value_field)
            if key is not None:
                lookup[str(key)] = value
        return lookup
