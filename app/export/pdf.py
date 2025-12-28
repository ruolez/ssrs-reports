import os
import tempfile
from datetime import datetime
from weasyprint import HTML, CSS


def export_to_pdf(html_content: str, report_name: str) -> str:
    """
    Export report HTML to PDF file.

    Returns: Path to the generated PDF file
    """
    # Build full HTML document with styles
    full_html = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>{report_name}</title>
        <style>
            @page {{
                size: landscape;
                margin: 0.5in;
            }}

            body {{
                font-family: Arial, sans-serif;
                font-size: 10pt;
                color: #202124;
            }}

            .report-header {{
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 2px solid #207176;
            }}

            .report-title {{
                font-size: 18pt;
                font-weight: bold;
                color: #207176;
                margin: 0;
            }}

            .report-date {{
                font-size: 9pt;
                color: #5f6368;
                margin-top: 5px;
            }}

            .report-table-container {{
                overflow: visible;
            }}

            .report-table {{
                width: 100%;
                border-collapse: collapse;
                font-size: 9pt;
            }}

            .report-table th {{
                background-color: #207176;
                color: white;
                padding: 8px 4px;
                text-align: center;
                font-weight: bold;
                border: 1px solid #dadce0;
            }}

            .report-table td {{
                padding: 6px 4px;
                text-align: center;
                border: 1px solid #dadce0;
                vertical-align: middle;
            }}

            .report-table tbody tr:nth-child(even) {{
                background-color: #f8f9fa;
            }}

            .drillthrough-link {{
                color: #1a73e8;
                text-decoration: none;
            }}

            .report-footer {{
                margin-top: 20px;
                padding-top: 10px;
                border-top: 1px solid #dadce0;
                font-size: 8pt;
                color: #5f6368;
                text-align: center;
            }}
        </style>
    </head>
    <body>
        <div class="report-header">
            <h1 class="report-title">{report_name}</h1>
            <div class="report-date">Generated: {datetime.now().strftime('%m/%d/%Y %I:%M %p')}</div>
        </div>

        {html_content}

        <div class="report-footer">
            RDL Report Viewer
        </div>
    </body>
    </html>
    '''

    # Generate PDF
    temp_path = os.path.join(tempfile.gettempdir(), f"{report_name}.pdf")

    html_doc = HTML(string=full_html)
    html_doc.write_pdf(temp_path)

    return temp_path
