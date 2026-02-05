/**
 * Auto-detect file type and bank from uploaded files
 */

import * as XLSX from 'xlsx';

export interface DetectionResult {
  fileType: 'bank_statement' | 'vyapar_report' | 'credit_card' | 'credit_card_infinia' | 'etrade_portfolio' | 'cams_statement' | 'home_loan_statement' | 'unknown';
  bankName: string | null;
  confidence: 'high' | 'medium' | 'low';
  details: string;
  needsPassword?: boolean;
}

/**
 * Detect the type of file and bank from the content
 */
export async function detectFileType(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<DetectionResult> {
  const ext = filename.toLowerCase().split('.').pop();

  // Check for ETrade CSV first (specific format)
  if (ext === 'csv' || mimeType === 'text/csv') {
    const csvContent = buffer.toString('utf-8');
    if (csvContent.includes('Account:') && csvContent.includes('Symbol') && csvContent.includes('Last Price')) {
      return {
        fileType: 'etrade_portfolio',
        bankName: 'etrade',
        confidence: 'high',
        details: 'ETrade portfolio export detected',
      };
    }
  }

  // Check for PDF (bank statements, CAMS, home loans)
  if (ext === 'pdf' || mimeType === 'application/pdf') {
    // Check filename patterns first for CAMS statements (often password protected)
    if (detectCAMSFromFilename(filename)) {
      return {
        fileType: 'cams_statement',
        bankName: null,
        confidence: 'high',
        details: 'CAMS Mutual Fund statement detected (may require password)',
        needsPassword: true,
      };
    }
    return detectPDFType(buffer, filename);
  }

  // Check for Excel files
  if (ext === 'xls' || ext === 'xlsx' ||
      mimeType === 'application/vnd.ms-excel' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return detectExcelType(buffer, filename);
  }

  return {
    fileType: 'unknown',
    bankName: null,
    confidence: 'low',
    details: 'Could not determine file type',
  };
}

/**
 * Detect CAMS statement from filename patterns
 */
function detectCAMSFromFilename(filename: string): boolean {
  const patterns = [
    /^[A-Z]{2}[A-Z0-9]+_\d{8}-\d{8}_CP\d+/i, // CAMS pattern: AFXXXXXX8N_06112025-04022026_CP203994260_...
    /^[A-Z]{5}[0-9]{4}[A-Z]_.*CAS/i, // PAN-based CAS naming
    /CAMS.*statement/i,
    /CAS_\d+/i, // Consolidated Account Statement
    /consolidated.*account.*statement/i,
  ];
  return patterns.some(p => p.test(filename));
}

async function detectPDFType(buffer: Buffer, filename?: string): Promise<DetectionResult> {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    let data;
    let text = '';

    try {
      data = await pdfParse(buffer);
      text = data.text.toLowerCase();
    } catch (parseError: any) {
      // If parsing fails, it might be password protected
      // Check filename for hints
      if (filename && detectCAMSFromFilename(filename)) {
        return {
          fileType: 'cams_statement',
          bankName: null,
          confidence: 'high',
          details: 'CAMS Mutual Fund statement (password protected)',
          needsPassword: true,
        };
      }

      // Check if error message suggests password protection
      const errorMsg = parseError?.message || '';
      if (errorMsg.includes('encrypt') || errorMsg.includes('password')) {
        return {
          fileType: 'unknown',
          bankName: null,
          confidence: 'low',
          details: 'PDF appears to be password protected',
          needsPassword: true,
        };
      }

      throw parseError;
    }

    // Check for CAMS/Mutual Fund statement
    if (text.includes('cams') || text.includes('computer age management services') ||
        text.includes('consolidated account statement') ||
        (text.includes('mutual fund') && text.includes('folio')) ||
        text.includes('registrar: cams') || text.includes('registrar: kfintech') ||
        text.includes('mfcentral')) {
      return {
        fileType: 'cams_statement',
        bankName: null,
        confidence: 'high',
        details: 'CAMS/Mutual Fund consolidated statement detected',
      };
    }

    // Check for Home Loan statement (Axis Bank specific patterns)
    if ((text.includes('home loan') || text.includes('housing loan')) &&
        (text.includes('agreement number') || text.includes('loan account') ||
         text.includes('emi') || text.includes('disbursement'))) {
      let bankName = null;
      if (text.includes('axis bank') || text.includes('axis home finance')) {
        bankName = 'axis';
      } else if (text.includes('hdfc')) {
        bankName = 'hdfc';
      } else if (text.includes('sbi') || text.includes('state bank')) {
        bankName = 'sbi';
      } else if (text.includes('icici')) {
        bankName = 'icici';
      }

      return {
        fileType: 'home_loan_statement',
        bankName,
        confidence: 'high',
        details: bankName ? `${bankName.toUpperCase()} Home Loan statement detected` : 'Home Loan statement detected',
      };
    }

    // Use scoring system to avoid false positives from transaction descriptions
    // Higher score = more confident detection
    interface BankScore {
      bank: string;
      score: number;
      isCreditCard: boolean;
    }

    const scores: BankScore[] = [];

    // ICICI Bank - check specific header patterns (not just mentions in transactions)
    let iciciScore = 0;
    if (text.includes('icici bank limited')) iciciScore += 10;
    if (text.includes('team icici bank')) iciciScore += 10;
    if (text.includes('statement of transactions in saving account')) iciciScore += 8;
    if (text.includes('your base branch: icici')) iciciScore += 8;
    if (text.includes('www.icici')) iciciScore += 5;
    if (text.includes('icicibank.com')) iciciScore += 5;
    // Generic icici mention (lower score as it could be in transactions)
    if (text.includes('icici bank') && iciciScore === 0) iciciScore += 2;

    const iciciIsCreditCard = text.includes('credit card statement') ||
      (text.includes('credit card') && text.includes('minimum amount due'));

    if (iciciScore > 0) {
      scores.push({ bank: 'icici', score: iciciScore, isCreditCard: iciciIsCreditCard });
    }

    // Kotak Bank
    let kotakScore = 0;
    if (text.includes('kotak mahindra bank limited')) kotakScore += 10;
    if (text.includes('kotak mahindra bank')) kotakScore += 8;
    if (text.includes('kotak.com')) kotakScore += 5;
    if (text.includes('kkbk0')) kotakScore += 5;

    if (kotakScore > 0) {
      scores.push({ bank: 'kotak', score: kotakScore, isCreditCard: false });
    }

    // HDFC Bank - check for official header patterns
    let hdfcScore = 0;
    if (text.includes('hdfc bank limited')) hdfcScore += 10;
    if (text.includes('hdfcbank.com')) hdfcScore += 8;
    if (text.includes('hdfc bank ltd')) hdfcScore += 8;
    // Only count "hdfc bank" if it appears near the beginning (header area)
    const first500Chars = text.substring(0, 500);
    if (first500Chars.includes('hdfc bank')) hdfcScore += 5;
    // Generic hdfc mention in full text (could be transfer description)
    if (text.includes('hdfc bank') && hdfcScore === 0) hdfcScore += 1;

    const hdfcIsCreditCard = text.includes('credit card statement') ||
      text.includes('card statement') ||
      (text.includes('minimum amount due') && text.includes('hdfc'));

    // Check specifically for HDFC Infinia card
    const isInfinia = text.includes('infinia') ||
      text.includes('diners club') ||
      text.includes('reward points') && text.includes('hdfc');

    if (hdfcScore > 0 && hdfcIsCreditCard && isInfinia) {
      return {
        fileType: 'credit_card_infinia',
        bankName: 'hdfc_infinia',
        confidence: 'high',
        details: 'HDFC Infinia Credit Card statement detected',
      };
    }

    if (hdfcScore > 0) {
      scores.push({ bank: 'hdfc', score: hdfcScore, isCreditCard: hdfcIsCreditCard });
    }

    // SBI
    let sbiScore = 0;
    if (text.includes('state bank of india')) sbiScore += 10;
    if (text.includes('sbi.co.in')) sbiScore += 8;
    if (text.includes('onlinesbi')) sbiScore += 5;

    if (sbiScore > 0) {
      scores.push({ bank: 'sbi', score: sbiScore, isCreditCard: false });
    }

    // Axis Bank
    let axisScore = 0;
    if (text.includes('axis bank limited')) axisScore += 10;
    if (text.includes('axisbank.com')) axisScore += 8;
    if (first500Chars.includes('axis bank')) axisScore += 5;

    const axisIsCreditCard = text.includes('credit card') && text.includes('axis');

    if (axisScore > 0) {
      scores.push({ bank: 'axis', score: axisScore, isCreditCard: axisIsCreditCard });
    }

    // Pick the bank with highest score
    if (scores.length > 0) {
      scores.sort((a, b) => b.score - a.score);
      const winner = scores[0];

      // Only high confidence if score is significant
      const confidence = winner.score >= 8 ? 'high' : winner.score >= 4 ? 'medium' : 'low';

      const bankNames: Record<string, string> = {
        icici: 'ICICI',
        hdfc: 'HDFC',
        kotak: 'Kotak Mahindra',
        sbi: 'SBI',
        axis: 'Axis',
      };

      if (winner.isCreditCard) {
        return {
          fileType: 'credit_card',
          bankName: winner.bank,
          confidence,
          details: `${bankNames[winner.bank]} Credit Card statement detected`,
        };
      }

      return {
        fileType: 'bank_statement',
        bankName: winner.bank,
        confidence,
        details: `${bankNames[winner.bank]} Bank statement detected`,
      };
    }

    // Generic bank statement detection
    if (text.includes('account statement') || text.includes('transaction') ||
        text.includes('withdrawal') || text.includes('deposit') || text.includes('balance')) {
      return {
        fileType: 'bank_statement',
        bankName: null,
        confidence: 'medium',
        details: 'Bank statement detected, but bank not identified',
      };
    }

    // Credit card detection
    if (text.includes('credit card') || text.includes('minimum due') || text.includes('card number')) {
      return {
        fileType: 'credit_card',
        bankName: null,
        confidence: 'medium',
        details: 'Credit card statement detected, but issuer not identified',
      };
    }

  } catch (error) {
    console.error('Error parsing PDF for detection:', error);
  }

  return {
    fileType: 'unknown',
    bankName: null,
    confidence: 'low',
    details: 'Could not parse PDF content',
  };
}

function detectExcelType(buffer: Buffer, filename: string): DetectionResult {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames.map(s => s.toLowerCase());

    // Check for Vyapar report (has specific sheets or headers)
    if (sheetNames.some(s => s.includes('transaction') || s.includes('all transactions'))) {
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      // Look for Vyapar-specific headers
      for (const row of data.slice(0, 10)) {
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('party name') && rowStr.includes('type') &&
            (rowStr.includes('paid') || rowStr.includes('received'))) {
          return {
            fileType: 'vyapar_report',
            bankName: null,
            confidence: 'high',
            details: 'Vyapar transaction report detected',
          };
        }
      }
    }

    // Check for Item Details sheet (Vyapar)
    if (sheetNames.some(s => s.includes('item') && s.includes('detail'))) {
      return {
        fileType: 'vyapar_report',
        bankName: null,
        confidence: 'high',
        details: 'Vyapar report with Item Details detected',
      };
    }

    // Check sheet content for Vyapar patterns
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const data: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

    for (const row of data.slice(0, 15)) {
      const rowStr = row.join(' ').toLowerCase();

      // Vyapar report patterns
      if ((rowStr.includes('sale') || rowStr.includes('purchase') || rowStr.includes('payment-in')) &&
          rowStr.includes('party')) {
        return {
          fileType: 'vyapar_report',
          bankName: null,
          confidence: 'high',
          details: 'Vyapar transaction report detected',
        };
      }

      // HDFC Bank statement (XLS format)
      if (rowStr.includes('hdfc bank') || rowStr.includes('narration')) {
        return {
          fileType: 'bank_statement',
          bankName: 'hdfc',
          confidence: 'high',
          details: 'HDFC Bank statement (XLS) detected',
        };
      }
    }

    // Check filename for hints
    const lowerFilename = filename.toLowerCase();
    if (lowerFilename.includes('vyapar') || lowerFilename.includes('alltransaction')) {
      return {
        fileType: 'vyapar_report',
        bankName: null,
        confidence: 'medium',
        details: 'Vyapar report detected from filename',
      };
    }

    if (lowerFilename.includes('hdfc')) {
      return {
        fileType: 'bank_statement',
        bankName: 'hdfc',
        confidence: 'medium',
        details: 'HDFC detected from filename',
      };
    }

    if (lowerFilename.includes('kotak')) {
      return {
        fileType: 'bank_statement',
        bankName: 'kotak',
        confidence: 'medium',
        details: 'Kotak detected from filename',
      };
    }

  } catch (error) {
    console.error('Error reading Excel for detection:', error);
  }

  return {
    fileType: 'unknown',
    bankName: null,
    confidence: 'low',
    details: 'Could not determine Excel file type',
  };
}
