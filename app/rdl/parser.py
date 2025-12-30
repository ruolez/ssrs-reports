import re
from lxml import etree
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any


NAMESPACES = {
    'r': 'http://schemas.microsoft.com/sqlserver/reporting/2010/01/reportdefinition',
    'rd': 'http://schemas.microsoft.com/SQLServer/reporting/reportdesigner'
}


@dataclass
class RdlField:
    name: str
    data_field: str
    type_name: str


@dataclass
class RdlQueryParameter:
    name: str
    value: str


@dataclass
class RdlDataSet:
    name: str
    datasource_name: str
    query: str
    query_parameters: List[RdlQueryParameter] = field(default_factory=list)
    fields: List[RdlField] = field(default_factory=list)


@dataclass
class RdlParameter:
    name: str
    data_type: str
    prompt: str
    default_value: Optional[str] = None


@dataclass
class RdlDataSource:
    name: str
    reference: str


@dataclass
class TablixColumn:
    width: str
    header_text: str
    header_style: Dict[str, Any] = field(default_factory=dict)
    field_expression: str = ''
    sortable: bool = False
    sort_expression: Optional[str] = None
    drillthrough: Optional[Dict] = None
    detail_style: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RdlTablix:
    name: str
    dataset_name: str
    columns: List[TablixColumn] = field(default_factory=list)


class RdlParser:
    def __init__(self, file_path: str):
        self.file_path = file_path
        self.tree = None
        self.root = None

    def parse(self) -> Dict[str, Any]:
        with open(self.file_path, 'rb') as f:
            content = f.read()
            # Remove BOM if present
            if content.startswith(b'\xef\xbb\xbf'):
                content = content[3:]
            self.tree = etree.fromstring(content)
            self.root = self.tree

        return {
            'datasources': self._parse_datasources(),
            'datasets': self._parse_datasets(),
            'parameters': self._parse_parameters(),
            'tablixes': self._parse_tablixes()
        }

    def _parse_datasources(self) -> List[Dict]:
        datasources = []
        for ds in self.root.findall('.//r:DataSource', NAMESPACES):
            name = ds.get('Name')
            ref_elem = ds.find('r:DataSourceReference', NAMESPACES)
            reference = ref_elem.text if ref_elem is not None else ''
            datasources.append({
                'name': name,
                'reference': reference
            })
        return datasources

    def _parse_datasets(self) -> List[Dict]:
        datasets = []
        for ds in self.root.findall('.//r:DataSet', NAMESPACES):
            name = ds.get('Name')

            query_elem = ds.find('r:Query', NAMESPACES)
            datasource_name = ''
            query_text = ''
            query_params = []

            if query_elem is not None:
                ds_name_elem = query_elem.find('r:DataSourceName', NAMESPACES)
                datasource_name = ds_name_elem.text if ds_name_elem is not None else ''

                cmd_elem = query_elem.find('r:CommandText', NAMESPACES)
                query_text = cmd_elem.text if cmd_elem is not None else ''

                # Parse query parameters
                for qp in query_elem.findall('.//r:QueryParameter', NAMESPACES):
                    param_name = qp.get('Name')
                    value_elem = qp.find('r:Value', NAMESPACES)
                    param_value = value_elem.text if value_elem is not None else ''
                    query_params.append({
                        'name': param_name,
                        'value': param_value
                    })

            # Parse fields
            fields = []
            for f in ds.findall('.//r:Field', NAMESPACES):
                field_name = f.get('Name')
                data_field_elem = f.find('r:DataField', NAMESPACES)
                type_name_elem = f.find('rd:TypeName', NAMESPACES)

                fields.append({
                    'name': field_name,
                    'data_field': data_field_elem.text if data_field_elem is not None else field_name,
                    'type_name': type_name_elem.text if type_name_elem is not None else 'System.String'
                })

            datasets.append({
                'name': name,
                'datasource_name': datasource_name,
                'query': query_text,
                'query_parameters': query_params,
                'fields': fields
            })

        return datasets

    def _parse_parameters(self) -> List[Dict]:
        parameters = []
        for param in self.root.findall('.//r:ReportParameter', NAMESPACES):
            name = param.get('Name')

            data_type_elem = param.find('r:DataType', NAMESPACES)
            data_type = data_type_elem.text if data_type_elem is not None else 'String'

            prompt_elem = param.find('r:Prompt', NAMESPACES)
            prompt = prompt_elem.text if prompt_elem is not None else name

            default_value = None
            default_elem = param.find('.//r:DefaultValue/r:Values/r:Value', NAMESPACES)
            if default_elem is not None:
                default_value = default_elem.text

            multi_value_elem = param.find('r:MultiValue', NAMESPACES)
            multi_value = multi_value_elem is not None and multi_value_elem.text == 'true'

            valid_values = None
            valid_values_elem = param.find('r:ValidValues', NAMESPACES)
            if valid_values_elem is not None:
                dataset_ref = valid_values_elem.find('r:DataSetReference', NAMESPACES)
                if dataset_ref is not None:
                    dataset_name_elem = dataset_ref.find('r:DataSetName', NAMESPACES)
                    value_field_elem = dataset_ref.find('r:ValueField', NAMESPACES)
                    label_field_elem = dataset_ref.find('r:LabelField', NAMESPACES)
                    valid_values = {
                        'type': 'dataset',
                        'dataset_name': dataset_name_elem.text if dataset_name_elem is not None else '',
                        'value_field': value_field_elem.text if value_field_elem is not None else '',
                        'label_field': label_field_elem.text if label_field_elem is not None else ''
                    }
                else:
                    static_values = valid_values_elem.find('r:ParameterValues', NAMESPACES)
                    if static_values is not None:
                        values_list = []
                        for pv in static_values.findall('r:ParameterValue', NAMESPACES):
                            value_elem = pv.find('r:Value', NAMESPACES)
                            label_elem = pv.find('r:Label', NAMESPACES)
                            values_list.append({
                                'value': value_elem.text if value_elem is not None else '',
                                'label': label_elem.text if label_elem is not None else (value_elem.text if value_elem is not None else '')
                            })
                        valid_values = {
                            'type': 'static',
                            'values': values_list
                        }

            parameters.append({
                'name': name,
                'data_type': data_type,
                'prompt': prompt,
                'default_value': default_value,
                'multi_value': multi_value,
                'valid_values': valid_values
            })

        return parameters

    def _parse_tablixes(self) -> List[Dict]:
        tablixes = []

        for tablix in self.root.findall('.//r:Tablix', NAMESPACES):
            name = tablix.get('Name')

            dataset_name_elem = tablix.find('r:DataSetName', NAMESPACES)
            dataset_name = dataset_name_elem.text if dataset_name_elem is not None else ''

            # Parse columns
            columns = []
            tablix_columns = tablix.findall('.//r:TablixBody/r:TablixColumns/r:TablixColumn', NAMESPACES)
            tablix_rows = tablix.findall('.//r:TablixBody/r:TablixRows/r:TablixRow', NAMESPACES)

            # Get header row and detail row
            header_row = tablix_rows[0] if len(tablix_rows) > 0 else None
            detail_row = tablix_rows[1] if len(tablix_rows) > 1 else None

            header_cells = header_row.findall('.//r:TablixCell', NAMESPACES) if header_row is not None else []
            detail_cells = detail_row.findall('.//r:TablixCell', NAMESPACES) if detail_row is not None else []

            for i, col in enumerate(tablix_columns):
                width_elem = col.find('r:Width', NAMESPACES)
                width = width_elem.text if width_elem is not None else '1in'

                # Get header cell info
                header_text = ''
                header_style = {}
                sortable = False
                sort_expression = None

                if i < len(header_cells):
                    header_cell = header_cells[i]
                    textbox = header_cell.find('.//r:Textbox', NAMESPACES)
                    if textbox is not None:
                        # Get header text
                        value_elem = textbox.find('.//r:TextRun/r:Value', NAMESPACES)
                        if value_elem is not None and value_elem.text:
                            header_text = value_elem.text

                        # Get sort expression
                        sort_elem = textbox.find('.//r:UserSort/r:SortExpression', NAMESPACES)
                        if sort_elem is not None:
                            sortable = True
                            sort_expression = sort_elem.text

                        # Get header style
                        header_style = self._parse_style(textbox)

                # Get detail cell info
                field_expression = ''
                detail_style = {}
                drillthrough = None

                if i < len(detail_cells):
                    detail_cell = detail_cells[i]
                    textbox = detail_cell.find('.//r:Textbox', NAMESPACES)
                    if textbox is not None:
                        # Get value expression
                        value_elem = textbox.find('.//r:TextRun/r:Value', NAMESPACES)
                        if value_elem is not None:
                            field_expression = value_elem.text or ''

                        # Get drillthrough
                        drill_elem = textbox.find('.//r:ActionInfo/r:Actions/r:Action/r:Drillthrough', NAMESPACES)
                        if drill_elem is not None:
                            report_name_elem = drill_elem.find('r:ReportName', NAMESPACES)
                            if report_name_elem is not None:
                                drillthrough = {
                                    'report_name': report_name_elem.text,
                                    'parameters': []
                                }
                                for dp in drill_elem.findall('.//r:Parameter', NAMESPACES):
                                    param_name = dp.get('Name')
                                    param_value_elem = dp.find('r:Value', NAMESPACES)
                                    param_value = param_value_elem.text if param_value_elem is not None else ''
                                    drillthrough['parameters'].append({
                                        'name': param_name,
                                        'value': param_value
                                    })

                        # Get detail style
                        detail_style = self._parse_style(textbox)

                columns.append({
                    'width': width,
                    'header_text': header_text,
                    'header_style': header_style,
                    'field_expression': field_expression,
                    'sortable': sortable,
                    'sort_expression': sort_expression,
                    'drillthrough': drillthrough,
                    'detail_style': detail_style
                })

            tablixes.append({
                'name': name,
                'dataset_name': dataset_name,
                'columns': columns
            })

        return tablixes

    def _parse_style(self, element) -> Dict[str, Any]:
        style = {}

        style_elem = element.find('r:Style', NAMESPACES)
        if style_elem is not None:
            # Background color
            bg_elem = style_elem.find('r:BackgroundColor', NAMESPACES)
            if bg_elem is not None:
                style['background_color'] = bg_elem.text

            # Vertical align
            va_elem = style_elem.find('r:VerticalAlign', NAMESPACES)
            if va_elem is not None:
                style['vertical_align'] = va_elem.text

        # Text run style
        text_run = element.find('.//r:TextRun', NAMESPACES)
        if text_run is not None:
            text_style = text_run.find('r:Style', NAMESPACES)
            if text_style is not None:
                # Font size
                fs_elem = text_style.find('r:FontSize', NAMESPACES)
                if fs_elem is not None:
                    style['font_size'] = fs_elem.text

                # Font weight
                fw_elem = text_style.find('r:FontWeight', NAMESPACES)
                if fw_elem is not None:
                    style['font_weight'] = fw_elem.text

                # Color
                color_elem = text_style.find('r:Color', NAMESPACES)
                if color_elem is not None:
                    style['color'] = color_elem.text

                # Format (for dates, numbers, etc.)
                format_elem = text_style.find('r:Format', NAMESPACES)
                if format_elem is not None:
                    style['format'] = format_elem.text

        # Text alignment
        para = element.find('.//r:Paragraph/r:Style', NAMESPACES)
        if para is not None:
            ta_elem = para.find('r:TextAlign', NAMESPACES)
            if ta_elem is not None:
                style['text_align'] = ta_elem.text

        return style
