import re
from typing import Any, Dict, Optional


# Regex patterns for RDL expressions
FIELD_PATTERN = re.compile(r'Fields!(\w+)\.Value')
ROWNUMBER_PATTERN = re.compile(r'RowNumber\("(\w+)"\)')
LOOKUP_PATTERN = re.compile(
    r'Lookup\s*\(\s*Fields!(\w+)\.Value\s*,\s*Fields!(\w+)\.Value\s*,\s*Fields!(\w+)\.Value\s*,\s*"(\w+)"\s*\)'
)


class ExpressionContext:
    def __init__(self, row: Dict[str, Any], row_number: int = 1, lookup_tables: Dict[str, Dict] = None):
        self.row = row
        self.row_number = row_number
        self.lookup_tables = lookup_tables or {}


def evaluate_expression(expression: str, context: ExpressionContext) -> Any:
    """
    Evaluate an RDL expression.

    Supported expressions:
    - =Fields!FieldName.Value
    - =RowNumber("DatasetName")
    - =Lookup(Fields!Key.Value, Fields!Key.Value, Fields!Value.Value, "DatasetName")
    - =Fields!A.Value - Fields!B.Value (arithmetic)
    - Static text (no = prefix)
    """
    if not expression:
        return ''

    # Static text (no = prefix)
    if not expression.startswith('='):
        return expression

    # Remove the = prefix
    expr = expression[1:]

    # Check for RowNumber
    rn_match = ROWNUMBER_PATTERN.search(expr)
    if rn_match and expr.strip() == rn_match.group(0):
        return context.row_number

    # Check for Lookup
    lookup_match = LOOKUP_PATTERN.search(expr)
    if lookup_match:
        source_field = lookup_match.group(1)  # e.g., ProductUPC
        # dest_field = lookup_match.group(2)    # e.g., ProductUPC (key in lookup table)
        # result_field = lookup_match.group(3)  # e.g., Bin
        dataset_name = lookup_match.group(4)  # e.g., Bins

        source_value = context.row.get(source_field)
        lookup_table = context.lookup_tables.get(dataset_name, {})

        return lookup_table.get(str(source_value), '') if source_value else ''

    # Check for simple field reference
    field_match = FIELD_PATTERN.search(expr)
    if field_match and expr.strip() == field_match.group(0):
        field_name = field_match.group(1)
        return context.row.get(field_name, '')

    # Check for arithmetic expression with fields
    # e.g., Fields!NewQty.Value-Fields!OldQty.Value
    if FIELD_PATTERN.search(expr) and any(op in expr for op in ['+', '-', '*', '/']):
        return _evaluate_arithmetic(expr, context)

    # Fallback: try to extract first field
    field_match = FIELD_PATTERN.search(expr)
    if field_match:
        field_name = field_match.group(1)
        return context.row.get(field_name, '')

    return expression


def _evaluate_arithmetic(expr: str, context: ExpressionContext) -> Any:
    """
    Evaluate arithmetic expressions with field references.
    e.g., Fields!NewQty.Value-Fields!OldQty.Value
    """
    try:
        # Replace field references with actual values
        def replace_field(match):
            field_name = match.group(1)
            value = context.row.get(field_name, 0)
            # Convert to number if possible
            if value is None:
                return '0'
            try:
                return str(float(value))
            except (ValueError, TypeError):
                return '0'

        numeric_expr = FIELD_PATTERN.sub(replace_field, expr)

        # Safely evaluate the arithmetic expression
        # Only allow basic arithmetic operations
        allowed_chars = set('0123456789.+-*/()')
        if all(c in allowed_chars or c.isspace() for c in numeric_expr):
            result = eval(numeric_expr)
            # Return as int if it's a whole number
            if isinstance(result, float) and result.is_integer():
                return int(result)
            return result
    except Exception:
        pass

    return 0


def extract_field_from_expression(expression: str) -> Optional[str]:
    """Extract the first field name from an expression."""
    if not expression:
        return None

    match = FIELD_PATTERN.search(expression)
    if match:
        return match.group(1)

    return None


def parse_lookup_expression(expression: str) -> Optional[Dict]:
    """
    Parse a Lookup expression and return its components.
    Returns: {source_field, dest_field, result_field, dataset_name}
    """
    if not expression:
        return None

    match = LOOKUP_PATTERN.search(expression)
    if match:
        return {
            'source_field': match.group(1),
            'dest_field': match.group(2),
            'result_field': match.group(3),
            'dataset_name': match.group(4)
        }

    return None


def is_lookup_expression(expression: str) -> bool:
    """Check if an expression contains a Lookup function."""
    if not expression:
        return False
    return bool(LOOKUP_PATTERN.search(expression))


def get_sort_field(sort_expression: str) -> Optional[str]:
    """Extract the field name from a sort expression."""
    return extract_field_from_expression(sort_expression)
