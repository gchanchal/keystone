#!/usr/bin/env python3
"""
PDF Template Extractor
Extracts table structure and patterns from PDFs for template learning
"""

import sys
import json
import re
from typing import List, Dict, Any, Optional


def detect_value_type(value: str) -> str:
    """Detect the type of a value"""
    if not value or not value.strip():
        return 'unknown'

    s = value.strip()

    # Date patterns
    date_patterns = [
        r'^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$',
        r'^\d{2,4}[-/]\d{1,2}[-/]\d{1,2}$',
        r'^\d{1,2}-[A-Za-z]{3}-\d{2,4}$',
        r'^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}$',
    ]
    for pattern in date_patterns:
        if re.match(pattern, s):
            return 'date'

    # Amount patterns (with currency symbols, commas)
    amount_patterns = [
        r'^[₹$€£]?\s*-?\d{1,3}(,\d{3})*(\.\d{1,2})?$',
        r'^-?\d{1,3}(,\d{3})*(\.\d{1,2})?\s*(cr|dr|CR|DR)?$',
        r'^\(?[₹$€£]?\s*\d{1,3}(,\d{3})*(\.\d{1,2})?\)?$',
    ]
    for pattern in amount_patterns:
        if re.match(pattern, s):
            return 'amount'

    # Plain numbers
    if re.match(r'^-?\d+(\.\d+)?$', s):
        return 'number'

    return 'text'


def extract_text_patterns(text: str) -> List[str]:
    """Extract bank/institution patterns from PDF text"""
    patterns = []
    text_lower = text.lower()

    # Common bank patterns
    bank_patterns = [
        'hdfc bank', 'icici bank', 'sbi', 'state bank of india',
        'axis bank', 'kotak mahindra', 'yes bank', 'idfc first',
        'federal bank', 'karnataka bank', 'canara bank', 'punjab national bank',
        'bank of baroda', 'union bank', 'indian bank',
    ]

    for bank in bank_patterns:
        if bank in text_lower:
            patterns.append(bank)

    # Credit card patterns
    if 'credit card' in text_lower:
        patterns.append('credit card')
    if 'statement' in text_lower:
        patterns.append('statement')

    return list(set(patterns))[:10]  # Limit to 10 patterns


def find_header_row(rows: List[List[str]]) -> int:
    """Find the row that contains table headers"""
    header_keywords = [
        'date', 'amount', 'balance', 'narration', 'description',
        'debit', 'credit', 'reference', 'particulars', 'withdrawal', 'deposit'
    ]

    for i, row in enumerate(rows[:15]):  # Check first 15 rows
        if not row:
            continue

        row_text = ' '.join(str(cell).lower() for cell in row if cell)

        # Count keyword matches
        matches = sum(1 for kw in header_keywords if kw in row_text)

        if matches >= 2:  # At least 2 header keywords
            return i

    return 0  # Default to first row


def extract_template(pdf_path: str, password: Optional[str] = None) -> Dict[str, Any]:
    """
    Extract template structure from PDF

    Returns:
        {
            "headers": [...],
            "column_types": [...],
            "sample_rows": [...],
            "row_count": int,
            "header_row_index": int,
            "text_patterns": [...],
        }
    """
    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber not installed. Run: pip install pdfplumber"}

    try:
        # Open PDF (with password if provided)
        pdf_options = {}
        if password:
            pdf_options['password'] = password

        with pdfplumber.open(pdf_path, **pdf_options) as pdf:
            all_text = ""
            all_tables = []

            # Extract text and tables from all pages
            for page in pdf.pages:
                text = page.extract_text() or ""
                all_text += text + "\n"

                tables = page.extract_tables()
                for table in tables:
                    if table and len(table) > 1:  # At least 2 rows
                        all_tables.append(table)

            if not all_tables:
                return {"error": "No tables found in PDF"}

            # Use the largest table (likely the transaction table)
            main_table = max(all_tables, key=lambda t: len(t))

            # Find header row
            header_row_index = find_header_row(main_table)
            headers = [str(cell).strip() if cell else f"Column_{i}"
                      for i, cell in enumerate(main_table[header_row_index])]

            # Get data rows (after header)
            data_rows = main_table[header_row_index + 1:]

            # Filter out empty rows
            data_rows = [row for row in data_rows
                        if any(cell and str(cell).strip() for cell in row)]

            if not data_rows:
                return {"error": "No data rows found in table"}

            # Detect column types
            column_types = []
            for col_idx in range(len(headers)):
                types = []
                for row in data_rows[:20]:  # Check first 20 rows
                    if col_idx < len(row) and row[col_idx]:
                        types.append(detect_value_type(str(row[col_idx])))

                # Get most common type
                if types:
                    type_counts = {}
                    for t in types:
                        type_counts[t] = type_counts.get(t, 0) + 1
                    column_types.append(max(type_counts.items(), key=lambda x: x[1])[0])
                else:
                    column_types.append('unknown')

            # Get sample rows (first 5)
            sample_rows = []
            for row in data_rows[:5]:
                sample_rows.append([str(cell).strip() if cell else "" for cell in row])

            # Extract text patterns for detection
            text_patterns = extract_text_patterns(all_text)

            return {
                "headers": headers,
                "column_types": column_types,
                "sample_rows": sample_rows,
                "row_count": len(data_rows),
                "header_row_index": header_row_index,
                "text_patterns": text_patterns,
            }

    except Exception as e:
        error_msg = str(e).lower()
        if 'password' in error_msg or 'encrypt' in error_msg:
            return {"error": "PDF is password protected. Please provide the correct password."}
        return {"error": str(e)}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: template_extractor.py <pdf_path> [password]"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    password = sys.argv[2] if len(sys.argv) > 2 else None

    result = extract_template(pdf_path, password)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
