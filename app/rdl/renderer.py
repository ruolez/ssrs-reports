import html
from typing import Dict, List, Any, Optional
from datetime import datetime, date
from decimal import Decimal
from .expression import evaluate_expression, ExpressionContext, get_sort_field, is_lookup_expression


class ReportRenderer:
    def __init__(self, report_def: Dict):
        self.report_def = report_def

    def render(self, data: Dict[str, Any], sort_column: Optional[str] = None,
               sort_direction: str = 'asc') -> str:
        """
        Render the report as HTML.

        Args:
            data: {'primary': [...], 'lookup_tables': {...}}
            sort_column: Column index to sort by
            sort_direction: 'asc' or 'desc'
        """
        tablixes = self.report_def.get('tablixes', [])
        if not tablixes:
            return '<p>No tablix found in report.</p>'

        tablix = tablixes[0]
        columns = tablix.get('columns', [])
        rows = data.get('primary', [])
        lookup_tables = data.get('lookup_tables', {})

        # Apply sorting if specified
        if sort_column is not None:
            rows = self._sort_data(rows, columns, int(sort_column), sort_direction, lookup_tables)

        row_count = len(rows)

        html_parts = []
        # Wrapper with row count data attribute
        html_parts.append(f'<div class="report-table-wrapper" data-row-count="{row_count}">')
        html_parts.append('<div class="report-table-container">')
        html_parts.append('<table class="report-table" role="grid">')

        # Render header
        html_parts.append('<thead>')
        html_parts.append('<tr role="row">')
        for i, col in enumerate(columns):
            header_text = col.get('header_text', '')
            header_style = self._build_style_string(col.get('header_style', {}))
            sortable = col.get('sortable', False)

            # Add sort indicator
            sort_indicator = ''
            if sortable:
                if sort_column is not None and int(sort_column) == i:
                    sort_indicator = ' <span class="sort-indicator">' + ('▲' if sort_direction == 'asc' else '▼') + '</span>'

            # Build class list
            classes = ['resizable']
            if sortable:
                classes.append('sortable')

            # ARIA sort attribute
            aria_sort = ''
            if sortable and sort_column is not None and int(sort_column) == i:
                aria_sort = f' aria-sort="{"ascending" if sort_direction == "asc" else "descending"}"'

            html_parts.append(
                f'<th style="{header_style}" class="{" ".join(classes)}" '
                f'data-column="{i}" data-column-index="{i}" role="columnheader"{aria_sort}>'
                f'{html.escape(header_text)}{sort_indicator}</th>'
            )

        html_parts.append('</tr>')
        html_parts.append('</thead>')

        # Render body
        html_parts.append('<tbody>')
        for row_idx, row in enumerate(rows):
            html_parts.append(f'<tr role="row" data-row-index="{row_idx}">')

            context = ExpressionContext(row, row_idx + 1, lookup_tables)

            for col_idx, col in enumerate(columns):
                expression = col.get('field_expression', '')
                detail_style = self._build_style_string(col.get('detail_style', {}))
                drillthrough = col.get('drillthrough')

                value = evaluate_expression(expression, context)
                display_value = self._format_value(value)
                data_type = self._get_data_type(value)

                # Cell attributes
                cell_attrs = f'style="{detail_style}" data-type="{data_type}" data-column="{col_idx}"'

                # Drillthrough link
                if drillthrough:
                    drill_url = self._build_drillthrough_url(drillthrough, context)
                    html_parts.append(
                        f'<td {cell_attrs}>'
                        f'<a href="{drill_url}" class="drillthrough-link">{html.escape(str(display_value))}</a>'
                        f'</td>'
                    )
                else:
                    html_parts.append(f'<td {cell_attrs}>{html.escape(str(display_value))}</td>')

            html_parts.append('</tr>')

        html_parts.append('</tbody>')
        html_parts.append('</table>')
        html_parts.append('</div>')
        html_parts.append('</div>')

        return '\n'.join(html_parts)

    def _get_data_type(self, value: Any) -> str:
        """Determine the data type of a value for HTML attribute."""
        if value is None:
            return 'text'
        if isinstance(value, bool):
            return 'boolean'
        if isinstance(value, (int, float, Decimal)):
            return 'number'
        if isinstance(value, (datetime, date)):
            return 'date'
        # Check if string looks like a date
        if isinstance(value, str):
            try:
                # Common date patterns
                for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y', '%Y-%m-%d %H:%M:%S'):
                    try:
                        datetime.strptime(value[:10], fmt[:10] if len(fmt) > 10 else fmt)
                        return 'date'
                    except ValueError:
                        continue
            except Exception:
                pass
        return 'text'

    def _build_style_string(self, style: Dict[str, Any]) -> str:
        """Convert style dict to CSS string."""
        css_parts = []

        if 'background_color' in style:
            css_parts.append(f"background-color: {style['background_color']}")

        if 'color' in style:
            css_parts.append(f"color: {style['color']}")

        if 'font_size' in style:
            css_parts.append(f"font-size: {style['font_size']}")

        if 'font_weight' in style:
            css_parts.append(f"font-weight: {style['font_weight']}")

        if 'text_align' in style:
            align = style['text_align'].lower()
            css_parts.append(f"text-align: {align}")

        if 'vertical_align' in style:
            valign = style['vertical_align'].lower()
            css_parts.append(f"vertical-align: {valign}")

        return '; '.join(css_parts)

    def _format_value(self, value: Any) -> str:
        """Format a value for display."""
        if value is None:
            return ''
        if isinstance(value, bool):
            return 'Yes' if value else 'No'
        if isinstance(value, (int, float, Decimal)):
            # Format numbers with commas for thousands
            if isinstance(value, float) and value.is_integer():
                return f"{int(value):,}"
            elif isinstance(value, int):
                return f"{value:,}"
            elif isinstance(value, Decimal):
                if value == value.to_integral_value():
                    return f"{int(value):,}"
                return f"{float(value):,.2f}"
            return f"{value:,.2f}"
        return str(value)

    def _sort_data(self, rows: List[Dict], columns: List[Dict], sort_idx: int,
                   direction: str, lookup_tables: Dict) -> List[Dict]:
        """Sort data by a column."""
        if sort_idx < 0 or sort_idx >= len(columns):
            return rows

        column = columns[sort_idx]
        expression = column.get('field_expression', '')
        sort_expr = column.get('sort_expression', '')

        # Use sort expression if available, otherwise use field expression
        eval_expr = sort_expr if sort_expr else expression

        def get_sort_key(row):
            context = ExpressionContext(row, 1, lookup_tables)
            value = evaluate_expression(eval_expr, context)

            # Handle None values - sort last
            if value is None:
                return (2, 0, '')

            # Try to convert to number for numeric sorting
            try:
                num_val = float(value)
                return (0, num_val, '')  # Numbers first, sorted numerically
            except (ValueError, TypeError):
                return (1, 0, str(value).lower())  # Strings second, sorted alphabetically

        reverse = direction.lower() == 'desc'
        return sorted(rows, key=get_sort_key, reverse=reverse)

    def _build_drillthrough_url(self, drillthrough: Dict, context: ExpressionContext) -> str:
        """Build a URL for drillthrough navigation."""
        report_name = drillthrough.get('report_name', '')
        parameters = drillthrough.get('parameters', [])

        # Extract report file name from path like /Inventory/Last Two Updates
        report_file = report_name.split('/')[-1] if report_name else ''

        # Build parameter query string
        param_parts = []
        for param in parameters:
            param_name = param.get('name', '')
            param_expr = param.get('value', '')
            param_value = evaluate_expression(param_expr, context)
            param_parts.append(f"{param_name}={param_value}")

        param_str = '&'.join(param_parts)
        return f"/viewer/drillthrough?report={report_file}&{param_str}"
