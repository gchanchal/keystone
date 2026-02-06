#!/usr/bin/env python3
"""
Kotak Bank PDF Statement Parser using pdfplumber
This script extracts transactions and account metadata from Kotak bank statements.
Handles SWEEP TRANSFER specially - adjusts balances to reflect actual available funds.
"""

import sys
import json
import pdfplumber
from datetime import datetime
import re

def parse_indian_amount(amount_str):
    """Parse Indian formatted amount string to float"""
    if not amount_str or amount_str.strip() in ['-', '']:
        return None
    # Remove commas and parse
    cleaned = amount_str.replace(',', '').strip()
    try:
        return float(cleaned)
    except ValueError:
        return None

def reverse_name_order(name):
    """
    Reverse name from 'Last First' to 'First Last' format.
    Kotak statements show name as 'Chanchal Gaurav' but we want 'Gaurav Chanchal'.
    Only applies to personal names, not company names.
    """
    if not name:
        return name

    # Don't reverse if it looks like a company name
    company_keywords = ['TECHNOLOGIES', 'CONSULTANT', 'PRIVATE', 'LIMITED', 'LTD', 'PVT',
                       'SOLUTIONS', 'SERVICES', 'ENTERPRISES', 'CORPORATION', 'CORP',
                       'INDUSTRIES', 'TRADING', 'EXPORTS', 'IMPORTS', 'LLC', 'INC']
    name_upper = name.upper()
    if any(keyword in name_upper for keyword in company_keywords):
        return name  # Don't reverse company names

    parts = name.split()
    if len(parts) == 2:
        # Simple case: "Last First" -> "First Last"
        return f"{parts[1]} {parts[0]}"
    elif len(parts) == 3:
        # Three parts: "Last Middle First" -> "First Middle Last"
        return f"{parts[2]} {parts[1]} {parts[0]}"
    return name

def parse_date(date_str):
    """Parse date string to ISO format"""
    if not date_str:
        return None

    # Try different date formats
    formats = [
        '%d %b %Y',  # 01 Feb 2026
        '%d %B %Y',  # 01 February 2026
        '%d/%m/%Y',  # 01/02/2026
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None

def extract_account_metadata(pdf):
    """Extract account holder info and account details from the statement"""
    metadata = {
        'accountNumber': None,
        'accountType': None,
        'accountStatus': None,  # Individual, Joint, etc.
        'accountHolderName': None,
        'address': None,
        'bankName': 'Kotak Mahindra Bank',
        'branch': None,
        'ifscCode': None,
        'micrCode': None,
        'currency': 'INR',
        'statementPeriod': {
            'from': None,
            'to': None
        },
        'openingBalance': None,
        'closingBalance': None,
    }

    # Get text from first page
    first_page = pdf.pages[0]
    text = first_page.extract_text() or ''

    # Account Number
    acc_match = re.search(r'Account\s*No\.?\s*[:\s]*(\d{10,})', text, re.I)
    if acc_match:
        metadata['accountNumber'] = acc_match.group(1)

    # Account Type
    type_match = re.search(r'Account\s*Type\s*[:\s]*(Savings|Current|Salary)', text, re.I)
    if type_match:
        metadata['accountType'] = type_match.group(1).lower()

    # Account Status (Individual, Joint, etc.)
    status_match = re.search(r'Account\s*Status\s*[:\s]*(Individual|Joint|Corporate|Proprietary|Partnership)', text, re.I)
    if status_match:
        metadata['accountStatus'] = status_match.group(1).title()
    else:
        # Try alternate pattern
        status_match2 = re.search(r'Status\s*[:\s]*(Individual|Joint|Active|Dormant)', text, re.I)
        if status_match2:
            metadata['accountStatus'] = status_match2.group(1).title()

    # Account Holder Name (usually at the top after bank header)
    # Pattern: Look for name before CRN or Account No
    # NOTE: Kotak shows name as "Last First" - we need to reverse to "First Last"
    # Skip common prefix words like "Account", "Mr", "Mrs", etc.
    name_match = re.search(r'Account Statement\s*[\d\s\w-]+\n+(?:Account\s+)?([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)', text)
    if name_match:
        raw_name = name_match.group(1).strip()
        # Remove any "Account" prefix if it slipped through
        raw_name = re.sub(r'^Account\s+', '', raw_name, flags=re.I)
        metadata['accountHolderName'] = reverse_name_order(raw_name)
    else:
        # Try another pattern - name after period line
        name_match2 = re.search(r'\d{4}\s*\n+(?:Account\s+)?([A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+)', text)
        if name_match2:
            raw_name = name_match2.group(1).strip()
            # Remove any "Account" prefix if it slipped through
            raw_name = re.sub(r'^Account\s+', '', raw_name, flags=re.I)
            metadata['accountHolderName'] = reverse_name_order(raw_name)

    # IFSC Code
    ifsc_match = re.search(r'IFSC\s*Code\s*[:\s]*([A-Z]{4}0[A-Z0-9]{6})', text, re.I)
    if ifsc_match:
        metadata['ifscCode'] = ifsc_match.group(1)

    # MICR Code
    micr_match = re.search(r'MICR\s*[:\s]*(\d{9})', text, re.I)
    if micr_match:
        metadata['micrCode'] = micr_match.group(1)

    # Branch
    branch_match = re.search(r'Branch\s*[:\s]*([A-Za-z\s]+?)(?:\n|Branch)', text, re.I)
    if branch_match:
        metadata['branch'] = branch_match.group(1).strip()

    # Address - Look for address block ending with pincode pattern and India
    # The address typically has: street, area, city - pincode, state - India
    # Pattern: Find lines ending with "State - India" preceded by "City - 6digits"
    address_match = re.search(
        r'([A-Za-z0-9][A-Za-z0-9\s,./\-]+\n(?:[A-Za-z0-9][A-Za-z0-9\s,./\-]+\n)*[A-Za-z\s]+[-–]\s*\d{6}\s*\n[A-Za-z\s]+[-–]\s*India)',
        text, re.M | re.I
    )

    if address_match:
        raw_address = address_match.group(1).strip()
        # Filter out lines that look like account metadata
        lines = raw_address.split('\n')
        address_lines = []
        skip_keywords = ['Account No', 'Account Type', 'CRN', 'Branch', 'Phone',
                        'Nominee', 'Status', 'IFSC', 'MICR', 'Statement']
        for line in lines:
            line = line.strip()
            if line and not any(kw.lower() in line.lower() for kw in skip_keywords):
                # Skip date ranges like "07 May 2025 - 07 Feb 2026"
                if not re.match(r'^\d{1,2}\s+\w+\s+\d{4}\s*[-–]', line):
                    address_lines.append(line)
        if address_lines:
            # Join and clean up stray punctuation
            address = ', '.join(address_lines)
            # Remove standalone dots or commas
            address = re.sub(r',\s*\.,', ',', address)
            address = re.sub(r',\s*\.$', '', address)
            address = re.sub(r'\.,\s*', ', ', address)
            address = re.sub(r',\s*,', ',', address)
            metadata['address'] = address.strip(', .')

    # Statement Period (from filename or header)
    period_match = re.search(r'(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*[-–]\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})', text)
    if period_match:
        metadata['statementPeriod']['from'] = parse_date(period_match.group(1))
        metadata['statementPeriod']['to'] = parse_date(period_match.group(2))

    return metadata

def extract_transactions(pdf_path, password=None):
    """Extract transactions from Kotak PDF statement"""
    transactions = []

    open_kwargs = {'password': password} if password else {}
    with pdfplumber.open(pdf_path, **open_kwargs) as pdf:
        for page in pdf.pages:
            # Extract table with explicit settings for better column detection
            table = page.extract_table(table_settings={
                "vertical_strategy": "lines",
                "horizontal_strategy": "lines",
                "snap_tolerance": 3,
                "join_tolerance": 3,
            })

            if not table:
                # Fallback: try text-based extraction
                table = page.extract_table(table_settings={
                    "vertical_strategy": "text",
                    "horizontal_strategy": "text",
                })

            if not table:
                continue

            # Find header row to identify columns
            header_idx = None
            for i, row in enumerate(table):
                if row and any(cell and 'Date' in str(cell) for cell in row):
                    header_idx = i
                    break

            if header_idx is None:
                continue

            # Process transaction rows
            for row in table[header_idx + 1:]:
                if not row or len(row) < 5:
                    continue

                # Skip non-data rows
                row_str = ' '.join(str(cell or '') for cell in row)
                if 'Opening Balance' in row_str or 'End of Statement' in row_str:
                    continue

                # Kotak format: #, Date, Description, Chq/Ref, Withdrawal, Deposit, Balance
                # Try to identify columns by position
                try:
                    # Find date column (contains month abbreviation)
                    date_val = None
                    date_idx = None
                    for i, cell in enumerate(row):
                        if cell and re.search(r'\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}', str(cell), re.I):
                            date_val = str(cell).strip()
                            date_idx = i
                            break

                    if not date_val:
                        continue

                    # Description is usually after date
                    description = str(row[date_idx + 1] or '').strip() if date_idx + 1 < len(row) else ''

                    # Reference/Chq number
                    reference = str(row[date_idx + 2] or '').strip() if date_idx + 2 < len(row) else ''

                    # Withdrawal (debit) and Deposit (credit) columns
                    # Usually the last 3 columns are: Withdrawal, Deposit, Balance
                    withdrawal = None
                    deposit = None
                    balance = None

                    # Work backwards from the end
                    numeric_cols = []
                    for i in range(len(row) - 1, date_idx + 2, -1):
                        val = parse_indian_amount(str(row[i] or ''))
                        if val is not None:
                            numeric_cols.insert(0, (i, val))

                    # Assign based on position (Balance, Deposit, Withdrawal from right to left)
                    if len(numeric_cols) >= 1:
                        balance = numeric_cols[-1][1]
                    if len(numeric_cols) >= 2:
                        # Second from right could be deposit or withdrawal
                        deposit_or_withdrawal = numeric_cols[-2][1]
                    if len(numeric_cols) >= 3:
                        # If we have 3 numeric values, middle is deposit, first is withdrawal
                        withdrawal = numeric_cols[-3][1] if numeric_cols[-3][1] else None
                        deposit = numeric_cols[-2][1] if numeric_cols[-2][1] else None
                    elif len(numeric_cols) == 2:
                        # Only 2 values: amount and balance
                        # Determine type from description or later validation
                        deposit_or_withdrawal = numeric_cols[-2][1]
                        # For now, assume it's withdrawal unless description suggests credit
                        desc_lower = description.lower()
                        if 'neft cr' in desc_lower or 'received' in desc_lower or 'credit' in desc_lower:
                            deposit = deposit_or_withdrawal
                        else:
                            withdrawal = deposit_or_withdrawal

                    # Skip if no valid amount
                    if withdrawal is None and deposit is None:
                        continue

                    amount = withdrawal if withdrawal else deposit
                    txn_type = 'debit' if withdrawal else 'credit'

                    transactions.append({
                        'date': parse_date(date_val),
                        'description': description,
                        'reference': reference if reference and reference != '-' else None,
                        'amount': amount,
                        'transactionType': txn_type,
                        'balance': balance,
                        'raw': {
                            'withdrawal': withdrawal,
                            'deposit': deposit,
                        }
                    })

                except (IndexError, ValueError) as e:
                    continue

    # Validate and fix using balance continuity
    transactions = validate_with_balance(transactions)

    # Flag suspicious amounts
    transactions = flag_suspicious_amounts(transactions)

    return transactions

def validate_with_balance(transactions):
    """Validate and fix amounts using balance continuity"""
    for i in range(1, len(transactions)):
        prev = transactions[i - 1]
        curr = transactions[i]

        if prev['balance'] is None or curr['balance'] is None:
            continue

        # Calculate expected balance change
        expected_amount = abs(prev['balance'] - curr['balance'])
        reported_amount = curr['amount']

        # Check if amounts match (with small tolerance)
        if abs(expected_amount - reported_amount) > 1:
            # Try to fix
            ratio = reported_amount / expected_amount if expected_amount > 0 else 0

            # Case 1: Amount is 10x inflated (digit wrongly prepended)
            if 9.5 <= ratio <= 10.5:
                print(f"Fixing amount (10x): {reported_amount} -> {expected_amount}", file=sys.stderr)
                curr['amount'] = expected_amount
                curr['amountCorrected'] = True
                curr['originalAmount'] = reported_amount

            # Case 2: Amount is 100x inflated
            elif 95 <= ratio <= 105:
                print(f"Fixing amount (100x): {reported_amount} -> {expected_amount}", file=sys.stderr)
                curr['amount'] = expected_amount
                curr['amountCorrected'] = True
                curr['originalAmount'] = reported_amount

            # Case 3: Use balance difference directly if reasonable
            elif 0 < expected_amount < 10000000:
                print(f"Fixing amount (balance-based): {reported_amount} -> {expected_amount}", file=sys.stderr)
                curr['amount'] = expected_amount
                curr['amountCorrected'] = True
                curr['originalAmount'] = reported_amount

        # Fix transaction type based on balance direction
        balance_decreased = prev['balance'] > curr['balance']
        if balance_decreased and curr['transactionType'] == 'credit':
            curr['transactionType'] = 'debit'
        elif not balance_decreased and curr['transactionType'] == 'debit':
            curr['transactionType'] = 'credit'

    return transactions

def flag_suspicious_amounts(transactions):
    """Flag amounts that look suspicious (like repeated leading digits)"""
    for txn in transactions:
        amount_str = str(int(txn['amount']))

        # Flag if first two digits are the same (like 33400, 55000)
        if len(amount_str) >= 4 and amount_str[0] == amount_str[1]:
            txn['suspicious'] = True
            txn['suspiciousReason'] = f"First two digits are same ({amount_str[:2]})"

        # Flag very large amounts
        if txn['amount'] > 1000000:  # > 10 lakh
            txn['suspicious'] = True
            txn['suspiciousReason'] = "Large amount - please verify"

    return transactions

def handle_sweep_transfers(transactions):
    """
    Handle SWEEP TRANSFER transactions:
    - SWEEP TRANSFER TO [account]: Money moved to linked FD (not a real withdrawal)
    - SWEEP TRANSFER FROM [account]: Money retrieved from linked FD

    Returns:
    - Regular transactions (excluding sweep)
    - Sweep transactions separately
    - Cumulative sweep balance
    - Adjusted balances for transactions after sweep
    """
    regular_transactions = []
    sweep_transactions = []
    cumulative_sweep = 0

    for txn in transactions:
        desc = txn.get('description', '') or ''

        # Check for SWEEP TRANSFER TO (money going to FD)
        sweep_to_match = re.search(r'SWEEP\s+TRANSFER\s+TO\s*\[(\d+)\]', desc, re.I)
        if sweep_to_match:
            txn['isSweep'] = True
            txn['sweepType'] = 'to_fd'
            txn['sweepAccountNumber'] = sweep_to_match.group(1)
            cumulative_sweep += txn['amount']
            sweep_transactions.append(txn)
            continue

        # Check for SWEEP TRANSFER FROM (money coming back from FD)
        sweep_from_match = re.search(r'SWEEP\s+TRANSFER\s+FROM\s*\[(\d+)\]', desc, re.I)
        if sweep_from_match:
            txn['isSweep'] = True
            txn['sweepType'] = 'from_fd'
            txn['sweepAccountNumber'] = sweep_from_match.group(1)
            cumulative_sweep -= txn['amount']
            sweep_transactions.append(txn)
            continue

        # Regular transaction - adjust balance if we have cumulative sweep
        if cumulative_sweep > 0 and txn.get('balance') is not None:
            txn['shownBalance'] = txn['balance']
            txn['balance'] = txn['balance'] + cumulative_sweep
            txn['sweepAdjustment'] = cumulative_sweep

        regular_transactions.append(txn)

    return regular_transactions, sweep_transactions, cumulative_sweep

def extract_opening_balance(pdf):
    """Extract opening balance from the statement"""
    for page in pdf.pages:
        text = page.extract_text() or ''

        # Look for Opening Balance row
        opening_match = re.search(r'Opening\s+Balance.*?([\d,]+\.\d{2})\s*$', text, re.M | re.I)
        if opening_match:
            return parse_indian_amount(opening_match.group(1))

    return None

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No PDF file path provided'}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    password = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        # Open with password if provided
        open_kwargs = {'password': password} if password else {}
        with pdfplumber.open(pdf_path, **open_kwargs) as pdf:
            # Extract metadata
            metadata = extract_account_metadata(pdf)

            # Extract opening balance
            metadata['openingBalance'] = extract_opening_balance(pdf)

        # Extract transactions (this reopens the PDF, but that's fine)
        all_transactions = extract_transactions(pdf_path, password)

        # Handle sweep transfers
        transactions, sweep_transactions, cumulative_sweep = handle_sweep_transfers(all_transactions)

        # Set closing balance from last transaction
        if transactions:
            metadata['closingBalance'] = transactions[-1].get('balance')

        # Calculate actual balance (including sweep)
        actual_balance = metadata['closingBalance'] or 0

        print(json.dumps({
            'success': True,
            'metadata': metadata,
            'transactions': transactions,
            'sweepTransactions': sweep_transactions,
            'sweepBalance': cumulative_sweep,
            'actualBalance': actual_balance,
            'count': len(transactions),
            'sweepCount': len(sweep_transactions)
        }))
    except Exception as e:
        import traceback
        print(json.dumps({
            'error': str(e),
            'traceback': traceback.format_exc(),
            'success': False
        }))
        sys.exit(1)

if __name__ == '__main__':
    main()
