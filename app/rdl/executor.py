import re
from typing import Dict, List, Any, Optional
from ..database import MSSQLManager
from .expression import parse_lookup_expression, is_lookup_expression


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
        for qp in query_params:
            param_name = qp['name'].lstrip('@')
            # Extract parameter name from expression like =Parameters!Date.Value
            param_expr = qp['value']
            match = re.search(r'Parameters!(\w+)\.Value', param_expr)
            if match:
                report_param_name = match.group(1)
                sql_params[param_name] = parameters.get(report_param_name, '')

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
