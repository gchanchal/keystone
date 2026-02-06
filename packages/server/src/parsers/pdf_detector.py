#!/usr/bin/env python3
"""
PDF Bank Detector using pdfplumber
Detects bank from password-protected PDFs
"""

import sys
import json
import pdfplumber


def detect_bank(pdf_path: str, password: str = None) -> dict:
    """
    Detect bank from PDF text content
    Returns: {"bank": "kotak"|"hdfc"|"icici"|"sbi"|"axis"|null, "confidence": "high"|"medium"|"low", "details": str}
    """
    try:
        open_kwargs = {'password': password} if password else {}

        with pdfplumber.open(pdf_path, **open_kwargs) as pdf:
            # Extract text from first few pages (usually enough for header detection)
            text = ""
            for i, page in enumerate(pdf.pages[:3]):
                page_text = page.extract_text() or ""
                text += page_text.lower() + "\n"

            # Scoring system for bank detection
            scores = {}

            # HDFC Bank patterns
            hdfc_score = 0
            if 'hdfc bank limited' in text:
                hdfc_score += 10
            if 'hdfcbank.com' in text:
                hdfc_score += 8
            if 'hdfc bank ltd' in text:
                hdfc_score += 8
            first_500 = text[:500]
            if 'hdfc bank' in first_500:
                hdfc_score += 5
            if hdfc_score == 0 and 'hdfc bank' in text:
                hdfc_score += 1
            if hdfc_score > 0:
                scores['hdfc'] = hdfc_score

            # Kotak Mahindra Bank patterns
            kotak_score = 0
            if 'kotak mahindra bank limited' in text:
                kotak_score += 10
            if 'kotak mahindra bank' in text:
                kotak_score += 8
            if 'kotak.com' in text:
                kotak_score += 5
            if 'kkbk0' in text:
                kotak_score += 5
            if kotak_score > 0:
                scores['kotak'] = kotak_score

            # ICICI Bank patterns
            icici_score = 0
            if 'icici bank limited' in text:
                icici_score += 10
            if 'team icici bank' in text:
                icici_score += 10
            if 'statement of transactions in saving account' in text:
                icici_score += 8
            if 'your base branch: icici' in text:
                icici_score += 8
            if 'www.icici' in text or 'icicibank.com' in text:
                icici_score += 5
            if icici_score == 0 and 'icici bank' in text:
                icici_score += 2
            if icici_score > 0:
                scores['icici'] = icici_score

            # SBI patterns
            sbi_score = 0
            if 'state bank of india' in text:
                sbi_score += 10
            if 'sbi.co.in' in text:
                sbi_score += 8
            if 'onlinesbi' in text:
                sbi_score += 5
            if sbi_score > 0:
                scores['sbi'] = sbi_score

            # Axis Bank patterns
            axis_score = 0
            if 'axis bank limited' in text:
                axis_score += 10
            if 'axisbank.com' in text:
                axis_score += 8
            if 'axis bank' in first_500:
                axis_score += 5
            if axis_score > 0:
                scores['axis'] = axis_score

            # Find winner
            if scores:
                winner = max(scores.items(), key=lambda x: x[1])
                bank = winner[0]
                score = winner[1]

                confidence = 'high' if score >= 8 else ('medium' if score >= 4 else 'low')

                bank_names = {
                    'hdfc': 'HDFC Bank',
                    'kotak': 'Kotak Mahindra Bank',
                    'icici': 'ICICI Bank',
                    'sbi': 'State Bank of India',
                    'axis': 'Axis Bank'
                }

                return {
                    "bank": bank,
                    "confidence": confidence,
                    "details": f"{bank_names.get(bank, bank)} detected from PDF",
                    "fileType": "bank_statement"
                }

            # Check for generic bank statement markers
            if any(marker in text for marker in ['account statement', 'transaction', 'withdrawal', 'deposit', 'balance']):
                return {
                    "bank": None,
                    "confidence": "low",
                    "details": "Bank statement detected but bank not identified",
                    "fileType": "bank_statement"
                }

            return {
                "bank": None,
                "confidence": "low",
                "details": "Could not detect bank from PDF",
                "fileType": "unknown"
            }

    except Exception as e:
        error_msg = str(e).lower()
        if 'password' in error_msg or 'encrypt' in error_msg:
            return {
                "bank": None,
                "confidence": "low",
                "details": "Incorrect password or still encrypted",
                "fileType": "unknown",
                "error": "password_error"
            }
        return {
            "bank": None,
            "confidence": "low",
            "details": f"Error reading PDF: {str(e)}",
            "fileType": "unknown",
            "error": str(e)
        }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: pdf_detector.py <pdf_path> [password]"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    password = sys.argv[2] if len(sys.argv) > 2 else None

    result = detect_bank(pdf_path, password)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
