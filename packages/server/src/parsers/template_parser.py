#!/usr/bin/env python3
"""
PDF Template Parser
Parses PDFs using learned template mappings
"""

import sys
import json
import re
from datetime import datetime
from typing import List, Dict, Any, Optional


def parse_date(value: str, date_format: Optional[str] = None) -> Optional[str]:
    """Parse date string to YYYY-MM-DD format"""
    if not value or not value.strip():
        return None

    s = value.strip()

    # Format mapping
    format_map = {
        'DD/MM/YYYY': '%d/%m/%Y',
        'DD-MM-YYYY': '%d-%m-%Y',
        'DD/MM/YY': '%d/%m/%y',
        'DD-MM-YY': '%d-%m-%y',
        'YYYY-MM-DD': '%Y-%m-%d',
        'MM/DD/YYYY': '%m/%d/%Y',
        'DD-MMM-YYYY': '%d-%b-%Y',
        'DD-MMM-YY': '%d-%b-%y',
    }

    # Try specified format first
    if date_format and date_format in format_map:
        try:
            dt = datetime.strptime(s, format_map[date_format])
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            pass

    # Try common formats
    formats = [
        '%d/%m/%Y', '%d-%m-%Y', '%d/%m/%y', '%d-%m-%y',
        '%Y-%m-%d', '%m/%d/%Y', '%d-%b-%Y', '%d-%b-%y',
        '%d/%m/%Y', '%d %b %Y', '%d %B %Y',
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(s, fmt)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue

    return None


def parse_amount(value: str) -> Optional[float]:
    """Parse amount string to float"""
    if value is None or value == '':
        return None

    s = str(value).strip()
    if not s:
        return None

    # Check for DR/CR suffix
    is_debit = bool(re.search(r'\s*(dr|DR|Dr)\s*$', s))
    is_credit = bool(re.search(r'\s*(cr|CR|Cr)\s*$', s))
    s = re.sub(r'\s*(dr|DR|Dr|cr|CR|Cr)\s*$', '', s)

    # Check for negative in parentheses
    is_negative = s.startswith('(') and s.endswith(')')
    if is_negative:
        s = s[1:-1]

    # Remove currency symbols and spaces
    s = re.sub(r'[₹$€£\s]', '', s)

    # Remove commas
    s = s.replace(',', '')

    # Handle minus sign
    has_minus = s.startswith('-')
    if has_minus:
        s = s[1:]

    try:
        num = float(s)
    except ValueError:
        return None

    # Apply sign
    if is_negative or has_minus or is_debit:
        return -abs(num)
    elif is_credit:
        return abs(num)

    return num


def get_column_value(row: List[Any], source: str) -> Any:
    """Get column value from row by source"""
    match = re.match(r'^col_(\d+)$', source)
    if match:
        index = int(match.group(1))
        if index < len(row):
            return row[index]
    return None


def parse_pdf_with_template(pdf_path: str, mappings: Dict[str, Any], password: Optional[str] = None) -> Dict[str, Any]:
    """
    Parse PDF using template mappings

    Args:
        pdf_path: Path to PDF file
        mappings: Field mappings from template
        password: Optional password for encrypted PDF

    Returns:
        {
            "transactions": [...],
            "errors": [...],
            "rows_processed": int,
            "rows_skipped": int,
        }
    """
    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber not installed. Run: pip install pdfplumber"}

    try:
        pdf_options = {}
        if password:
            pdf_options['password'] = password

        with pdfplumber.open(pdf_path, **pdf_options) as pdf:
            all_tables = []

            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    if table and len(table) > 1:
                        all_tables.extend(table)

            if not all_tables:
                return {"error": "No tables found in PDF"}

            # Skip header row (assumed to be first row with common header keywords)
            header_keywords = ['date', 'amount', 'balance', 'narration', 'description', 'debit', 'credit']
            start_row = 0
            for i, row in enumerate(all_tables[:5]):
                if row:
                    row_text = ' '.join(str(cell).lower() for cell in row if cell)
                    if any(kw in row_text for kw in header_keywords):
                        start_row = i + 1
                        break

            transactions = []
            errors = []
            rows_skipped = 0

            for row_idx, row in enumerate(all_tables[start_row:], start=start_row + 1):
                # Skip empty rows
                if not row or not any(cell and str(cell).strip() for cell in row):
                    rows_skipped += 1
                    continue

                try:
                    txn = {'raw_data': {}}

                    for field, mapping in mappings.items():
                        source = mapping.get('source', '')
                        fmt = mapping.get('format')
                        value = get_column_value(row, source)

                        # Store raw value
                        txn['raw_data'][field] = str(value) if value else None

                        if field == 'date':
                            parsed = parse_date(str(value) if value else '', fmt)
                            if parsed:
                                txn['date'] = parsed

                        elif field == 'valueDate':
                            parsed = parse_date(str(value) if value else '', fmt)
                            if parsed:
                                txn['valueDate'] = parsed

                        elif field == 'narration':
                            txn['narration'] = str(value).strip() if value else ''

                        elif field == 'reference':
                            if value:
                                txn['reference'] = str(value).strip()

                        elif field == 'withdrawal':
                            amount = parse_amount(str(value) if value else '')
                            if amount is not None and amount != 0:
                                txn['withdrawal'] = abs(amount)

                        elif field == 'deposit':
                            amount = parse_amount(str(value) if value else '')
                            if amount is not None and amount != 0:
                                txn['deposit'] = abs(amount)

                        elif field == 'amount':
                            amount = parse_amount(str(value) if value else '')
                            if amount is not None:
                                txn['amount'] = amount

                        elif field == 'balance':
                            amount = parse_amount(str(value) if value else '')
                            if amount is not None:
                                txn['balance'] = amount

                        elif field == 'transactionType':
                            if value:
                                txn['transactionType'] = str(value).strip()

                        elif field == 'category':
                            if value:
                                txn['category'] = str(value).strip()

                        elif field == 'merchant':
                            if value:
                                txn['merchant'] = str(value).strip()

                        elif field == 'cardNumber':
                            if value:
                                txn['cardNumber'] = str(value).strip()

                    # Validate required fields
                    if not txn.get('date'):
                        errors.append(f"Row {row_idx}: Missing or invalid date")
                        rows_skipped += 1
                        continue

                    if not txn.get('narration') and not txn.get('merchant'):
                        errors.append(f"Row {row_idx}: Missing narration/description")
                        rows_skipped += 1
                        continue

                    if (txn.get('withdrawal') is None and
                        txn.get('deposit') is None and
                        txn.get('amount') is None):
                        errors.append(f"Row {row_idx}: Missing amount")
                        rows_skipped += 1
                        continue

                    transactions.append(txn)

                except Exception as e:
                    errors.append(f"Row {row_idx}: {str(e)}")
                    rows_skipped += 1

            return {
                "transactions": transactions,
                "errors": errors[:50],  # Limit errors
                "rows_processed": len(all_tables) - start_row,
                "rows_skipped": rows_skipped,
            }

    except Exception as e:
        error_msg = str(e).lower()
        if 'password' in error_msg or 'encrypt' in error_msg:
            return {"error": "PDF is password protected. Please provide the correct password."}
        return {"error": str(e)}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: template_parser.py <pdf_path> <mappings_json> [password]"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    mappings = json.loads(sys.argv[2])
    password = sys.argv[3] if len(sys.argv) > 3 else None

    result = parse_pdf_with_template(pdf_path, mappings, password)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
