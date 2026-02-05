#!/usr/bin/env python3
"""
Kotak Bank PDF Statement Parser using pdfplumber
This script extracts transactions from Kotak bank statements with proper column alignment.
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

def extract_transactions(pdf_path):
    """Extract transactions from Kotak PDF statement"""
    transactions = []

    with pdfplumber.open(pdf_path) as pdf:
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

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No PDF file path provided'}))
        sys.exit(1)

    pdf_path = sys.argv[1]

    try:
        transactions = extract_transactions(pdf_path)
        print(json.dumps({
            'success': True,
            'transactions': transactions,
            'count': len(transactions)
        }))
    except Exception as e:
        print(json.dumps({
            'error': str(e),
            'success': False
        }))
        sys.exit(1)

if __name__ == '__main__':
    main()
