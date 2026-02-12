#!/usr/bin/env python3
"""
HDFC Bank PDF Statement Parser using pdfplumber
This script extracts transactions and account metadata from HDFC bank PDF statements.
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

def parse_date(date_str):
    """Parse date string to ISO format"""
    if not date_str:
        return None

    # Try different date formats
    formats = [
        '%d/%m/%y',  # 07/04/25
        '%d/%m/%Y',  # 07/04/2025
        '%d %b %Y',  # 01 Feb 2026
        '%d %B %Y',  # 01 February 2026
    ]

    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            # Handle 2-digit year
            if dt.year < 100:
                dt = dt.replace(year=dt.year + 2000)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            continue
    return None

def extract_account_metadata(pdf):
    """Extract account holder info and account details from the HDFC statement"""
    metadata = {
        'accountNumber': None,
        'accountType': None,
        'accountStatus': None,
        'accountHolderName': None,
        'address': None,
        'bankName': 'HDFC Bank',
        'branch': None,
        'ifscCode': None,
        'micrCode': None,
        'currency': 'INR',
        'customerId': None,
        'email': None,
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

    # Account Number - HDFC format: AccountNo : 50100156157526
    acc_match = re.search(r'AccountNo\s*:\s*(\d{10,})', text.replace(' ', ''))
    if acc_match:
        metadata['accountNumber'] = acc_match.group(1)
    else:
        # Try with spaces
        acc_match2 = re.search(r'Account\s*No\.?\s*[:\s]*(\d{10,})', text, re.I)
        if acc_match2:
            metadata['accountNumber'] = acc_match2.group(1)

    # Account Type - HDFC format: AccountType : SAVINGSA/C-SBMAX(193)
    type_match = re.search(r'AccountType\s*:\s*([A-Z0-9\-\/\(\)\s]+)', text)
    if type_match:
        acc_type = type_match.group(1).strip()
        if 'SAVING' in acc_type.upper():
            metadata['accountType'] = 'savings'
        elif 'CURRENT' in acc_type.upper():
            metadata['accountType'] = 'current'
        else:
            metadata['accountType'] = acc_type

    # Account Status - HDFC format: AccountStatus : Regular
    status_match = re.search(r'AccountStatus\s*:\s*(\w+)', text)
    if status_match:
        metadata['accountStatus'] = status_match.group(1)

    # Account Holder Name - HDFC format: MR. GAURAVCHANCHAL (with spaces removed)
    # Look for name after State line
    name_match = re.search(r'State\s*:\s*[A-Z]+\s*\n((?:MR\.?|MRS\.?|MS\.?)\s*[A-Z][A-Z]+)', text)
    if name_match:
        raw_name = name_match.group(1).strip()
        # Clean up the name - remove title prefixes
        raw_name = re.sub(r'^MR\.?\s*', '', raw_name, flags=re.I)
        raw_name = re.sub(r'^MRS\.?\s*', '', raw_name, flags=re.I)
        raw_name = re.sub(r'^MS\.?\s*', '', raw_name, flags=re.I)
        raw_name = raw_name.strip()
        # Split concatenated names (GAURAVCHANCHAL -> GAURAV CHANCHAL)
        # Use uppercase boundaries
        if ' ' not in raw_name and len(raw_name) > 5:
            # Split by looking at where lowercase vowel is followed by uppercase consonant
            # For GAURAVCHANCHAL, we want to split at V (GAURAV + CHANCHAL)
            split_name = re.sub(r'([A-Z][a-z]+)([A-Z])', r'\1 \2', raw_name)
            # If that didn't work, try splitting all-caps names
            if ' ' not in split_name:
                # For all-caps like GAURAVCHANCHAL, try common Indian name patterns
                # Look for common first name endings: AV, AJ, AN, AR, AT, etc.
                split_name = re.sub(r'(GAURAV|RAHUL|AMIT|ANIL|VIJAY|KUMAR|SHWETA|PRIYA|ARUN|ARJUN)(.*)', r'\1 \2', raw_name, flags=re.I)
                if ' ' not in split_name or split_name.endswith(' '):
                    # Generic split - find a good boundary
                    split_name = raw_name  # Keep original if no pattern matches
            raw_name = split_name
        metadata['accountHolderName'] = raw_name.title().strip()

    # Try alternate pattern for name
    if not metadata['accountHolderName']:
        # Look for MR./MRS. pattern
        name_match2 = re.search(r'(MR\.?|MRS\.?|MS\.?)\s*([A-Z][A-Z]+)(?:\s*\n|[A-Z])', text)
        if name_match2:
            raw_name = name_match2.group(2)
            # Apply same splitting logic
            if ' ' not in raw_name and len(raw_name) > 5:
                split_name = re.sub(r'(GAURAV|RAHUL|AMIT|ANIL|VIJAY|KUMAR|SHWETA|PRIYA|ARUN|ARJUN)(.*)', r'\1 \2', raw_name, flags=re.I)
                if ' ' in split_name and not split_name.endswith(' '):
                    raw_name = split_name
            metadata['accountHolderName'] = raw_name.title().strip()

    # IFSC Code - HDFC format: RTGS/NEFTIFSC: HDFC0000354
    ifsc_match = re.search(r'IFSC\s*:\s*([A-Z]{4}0[A-Z0-9]{6})', text, re.I)
    if ifsc_match:
        metadata['ifscCode'] = ifsc_match.group(1)

    # MICR Code - HDFC format: MICR:560240015
    micr_match = re.search(r'MICR\s*:\s*(\d{9})', text, re.I)
    if micr_match:
        metadata['micrCode'] = micr_match.group(1)

    # Branch - HDFC format: AccountBranch : SARJAPURROAD
    branch_match = re.search(r'AccountBranch\s*:\s*([A-Z]+)', text)
    if branch_match:
        branch = branch_match.group(1)
        # Add spaces to camelCase branch name
        branch = re.sub(r'([a-z])([A-Z])', r'\1 \2', branch)
        branch = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1 \2', branch)
        metadata['branch'] = branch.title()

    # Customer ID
    cust_match = re.search(r'CustID\s*:\s*(\d+)', text)
    if cust_match:
        metadata['customerId'] = cust_match.group(1)

    # Email
    email_match = re.search(r'Email\s*:\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})', text)
    if email_match:
        metadata['email'] = email_match.group(1).lower()

    # Address - Reconstruct from the fragmented text
    # HDFC shows address as: number,street,area + city + state
    address_parts = []

    # Look for address pattern in text
    addr_match = re.search(r'(\d+[A-Z0-9,/\s]+(?:AVENUE|ROAD|STREET|RESIDENCY|LAYOUT|PHASE|GATE)[A-Z0-9,/\s]*)', text, re.I)
    if addr_match:
        addr_line = addr_match.group(1).strip()
        # Add spaces around numbers and clean up
        addr_line = re.sub(r'([0-9]+)', r' \1 ', addr_line)
        addr_line = re.sub(r'\s+', ' ', addr_line)
        address_parts.append(addr_line.strip())

    # Get city from Address section
    city_match = re.search(r'City\s*:\s*([A-Z]+\d*)', text)
    if city_match:
        city = city_match.group(1)
        # Handle BENGALURU560102 -> Bengaluru 560102
        city_clean = re.sub(r'(\d+)$', r' \1', city)
        address_parts.append(city_clean.title())

    # Get state
    state_match = re.search(r'State\s*:\s*([A-Z]+)', text)
    if state_match:
        address_parts.append(state_match.group(1).title())

    if address_parts:
        metadata['address'] = ', '.join(address_parts)

    # Statement Period - HDFC format: From : 01/04/2025 To : 06/02/2026
    period_match = re.search(r'From\s*:\s*(\d{1,2}/\d{1,2}/\d{4})\s*To\s*:\s*(\d{1,2}/\d{1,2}/\d{4})', text)
    if period_match:
        metadata['statementPeriod']['from'] = parse_date(period_match.group(1))
        metadata['statementPeriod']['to'] = parse_date(period_match.group(2))

    return metadata

def extract_transactions(pdf):
    """Extract transactions from HDFC PDF statement"""
    transactions = []

    for page in pdf.pages:
        text = page.extract_text() or ''

        # Split text into lines
        lines = text.split('\n')

        # Look for transaction lines
        # HDFC format: DD/MM/YY NARRATION REFNO DD/MM/YY AMT AMT BALANCE
        for line in lines:
            # Skip header and footer lines
            if any(skip in line for skip in ['Narration', 'PageNo', 'HDFC Bank', 'Statement',
                                               'Closing balance', 'Contents of', 'Registered Office']):
                continue

            # Match transaction pattern: starts with date DD/MM/YY
            txn_match = re.match(r'^(\d{2}/\d{2}/\d{2})\s+(.+)', line)
            if not txn_match:
                continue

            date_str = txn_match.group(1)
            rest = txn_match.group(2)

            # Parse the rest of the line
            # Find the reference number (usually a long number)
            ref_match = re.search(r'\s+(\d{10,})\s+', rest)
            if not ref_match:
                continue

            reference = ref_match.group(1)
            ref_pos = ref_match.start()

            # Narration is everything before the reference
            narration = rest[:ref_pos].strip()

            # After reference, we have: ValueDate, [Withdrawal], [Deposit], Balance
            after_ref = rest[ref_match.end():].strip()

            # Extract numbers from after_ref
            # Pattern: DD/MM/YY [withdrawal] [deposit] balance
            amounts_match = re.match(r'(\d{2}/\d{2}/\d{2})\s+(.+)', after_ref)
            if not amounts_match:
                continue

            value_date = amounts_match.group(1)
            amounts_str = amounts_match.group(2)

            # Split amounts by spaces and parse
            parts = amounts_str.split()

            withdrawal = None
            deposit = None
            balance = None

            # Parse the amount parts
            # Could be: WITHDRAWAL BALANCE or DEPOSIT BALANCE or WITHDRAWAL DEPOSIT BALANCE
            numeric_values = []
            for part in parts:
                val = parse_indian_amount(part)
                if val is not None:
                    numeric_values.append(val)

            if len(numeric_values) >= 1:
                balance = numeric_values[-1]  # Balance is always last

            if len(numeric_values) == 2:
                # One amount + balance
                # Need to determine if it's withdrawal or deposit
                # Usually HDFC shows withdrawal in first column, deposit in second
                # If only one amount, check previous balance to determine type
                amount = numeric_values[0]
                # We'll determine type based on transaction keywords
                desc_lower = narration.lower()
                if any(kw in desc_lower for kw in ['neft cr', 'credit', 'received', 'interest paid', 'tpt-', 'neftcr']):
                    deposit = amount
                else:
                    withdrawal = amount

            elif len(numeric_values) == 3:
                # Withdrawal, Deposit, Balance
                withdrawal = numeric_values[0] if numeric_values[0] > 0 else None
                deposit = numeric_values[1] if numeric_values[1] > 0 else None

            # Skip if no valid amount
            if withdrawal is None and deposit is None:
                continue

            amount = withdrawal if withdrawal else deposit
            txn_type = 'debit' if withdrawal else 'credit'

            transactions.append({
                'date': parse_date(date_str),
                'valueDate': parse_date(value_date),
                'description': narration,
                'reference': reference,
                'amount': amount,
                'transactionType': txn_type,
                'balance': balance,
            })

    return transactions

def extract_transactions_from_tables(pdf):
    """Extract transactions using table extraction for better accuracy"""
    transactions = []

    for page_num, page in enumerate(pdf.pages):
        # Try to extract tables
        tables = page.extract_tables(table_settings={
            "vertical_strategy": "text",
            "horizontal_strategy": "text",
            "snap_tolerance": 5,
            "join_tolerance": 5,
        })

        for table in tables:
            if not table:
                continue

            for row in table:
                if not row or len(row) < 5:
                    continue

                # Skip header rows
                row_str = ' '.join(str(cell or '') for cell in row)
                if 'Narration' in row_str or 'Date' in row_str:
                    continue

                # Parse row - find date pattern
                date_val = None
                for i, cell in enumerate(row):
                    if cell and re.match(r'\d{2}/\d{2}/\d{2}', str(cell)):
                        date_val = str(cell)
                        break

                if not date_val:
                    continue

                # Extract fields based on position
                try:
                    # HDFC table: Date | Narration | Chq/Ref | ValueDt | Withdrawal | Deposit | Balance
                    narration = str(row[1] or '').strip() if len(row) > 1 else ''
                    reference = str(row[2] or '').strip() if len(row) > 2 else ''
                    value_date = str(row[3] or '').strip() if len(row) > 3 else date_val

                    # Get amounts from last 3 columns
                    withdrawal = parse_indian_amount(str(row[-3] or '')) if len(row) > 5 else None
                    deposit = parse_indian_amount(str(row[-2] or '')) if len(row) > 4 else None
                    balance = parse_indian_amount(str(row[-1] or '')) if len(row) > 3 else None

                    # Determine transaction type
                    if withdrawal and not deposit:
                        amount = withdrawal
                        txn_type = 'debit'
                    elif deposit and not withdrawal:
                        amount = deposit
                        txn_type = 'credit'
                    elif withdrawal and deposit:
                        # Both present - unusual, take the larger one
                        if withdrawal > deposit:
                            amount = withdrawal
                            txn_type = 'debit'
                        else:
                            amount = deposit
                            txn_type = 'credit'
                    else:
                        continue

                    transactions.append({
                        'date': parse_date(date_val),
                        'valueDate': parse_date(value_date),
                        'description': narration,
                        'reference': reference,
                        'amount': amount,
                        'transactionType': txn_type,
                        'balance': balance,
                    })

                except (IndexError, ValueError):
                    continue

    return transactions

def fix_embedded_dates(transactions):
    """Fix transactions where date is embedded in description"""
    for txn in transactions:
        if not txn.get('date') and txn.get('description'):
            # Check if description starts with a date pattern
            date_match = re.match(r'^(\d{2}/\d{2}/\d{2})\s+(.+)', txn['description'])
            if date_match:
                txn['date'] = parse_date(date_match.group(1))
                txn['description'] = date_match.group(2)
    return transactions

def validate_transaction_types(transactions):
    """Validate and fix transaction types using balance continuity.

    Note: We only fix the transaction TYPE based on balance change, not the amount.
    The parsed amount from the PDF should be trusted as the source of truth.
    """
    if not transactions:
        return transactions

    # First fix embedded dates
    transactions = fix_embedded_dates(transactions)

    # Filter out transactions with None dates
    valid_transactions = [t for t in transactions if t.get('date')]
    invalid_transactions = [t for t in transactions if not t.get('date')]

    # Sort by date to ensure proper order
    valid_transactions.sort(key=lambda x: x['date'])

    for i in range(1, len(valid_transactions)):
        prev = valid_transactions[i - 1]
        curr = valid_transactions[i]

        if prev.get('balance') is None or curr.get('balance') is None:
            continue

        # Calculate balance change
        balance_diff = curr['balance'] - prev['balance']

        # If balance decreased, it's a debit
        # If balance increased, it's a credit
        # Only fix the transaction type, NOT the amount
        if balance_diff < 0:
            # Balance decreased - should be debit
            if curr['transactionType'] != 'debit':
                curr['transactionType'] = 'debit'
        elif balance_diff > 0:
            # Balance increased - should be credit
            if curr['transactionType'] != 'credit':
                curr['transactionType'] = 'credit'

    return valid_transactions + invalid_transactions

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

            # Extract transactions - try text-based extraction first (more reliable)
            transactions = extract_transactions(pdf)

            # If text extraction didn't work well, try table-based as fallback
            if len(transactions) < 5:
                table_transactions = extract_transactions_from_tables(pdf)
                if len(table_transactions) > len(transactions):
                    transactions = table_transactions

            # Validate and fix transaction types using balance continuity
            transactions = validate_transaction_types(transactions)

            # Set closing balance from last transaction
            if transactions:
                metadata['closingBalance'] = transactions[-1].get('balance')
                # Set opening balance from first transaction's balance minus/plus amount
                first_txn = transactions[0]
                if first_txn.get('balance') and first_txn.get('amount'):
                    if first_txn['transactionType'] == 'debit':
                        metadata['openingBalance'] = first_txn['balance'] + first_txn['amount']
                    else:
                        metadata['openingBalance'] = first_txn['balance'] - first_txn['amount']

            print(json.dumps({
                'success': True,
                'metadata': metadata,
                'transactions': transactions,
                'count': len(transactions),
                'actualBalance': metadata.get('closingBalance', 0)
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
