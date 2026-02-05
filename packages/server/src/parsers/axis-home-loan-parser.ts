import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import type { NewLoan, NewLoanPayment, NewLoanDisbursement } from '../db/schema/loans.js';

export interface AxisHomeLoanData {
  loan: Partial<NewLoan>;
  payments: NewLoanPayment[];
  disbursements: NewLoanDisbursement[];
  summary: {
    totalPrincipalPaid: number;
    totalInterestPaid: number;
    totalChargesPaid: number;
    totalDisbursed: number;
    outstanding: number;
  };
}

// Parse amount strings like "1,93,06,010.00" or "1,23,456.78"
function parseAmount(amountStr: string): number {
  if (!amountStr) return 0;
  // Remove INR, Rs, commas and extra dots
  const cleaned = amountStr.replace(/[INR₹Rs,\s]/gi, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Parse date strings like "05-02-2024" (DD-MM-YYYY)
function parseDate(dateStr: string): string {
  if (!dateStr) return '';

  // Handle DD-MM-YYYY format
  const match = dateStr.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }

  return dateStr;
}

// Extract value after a label pattern
function extractValue(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

// Extract loan master details from PDF text
function extractLoanDetails(text: string): Partial<NewLoan> {
  const details: Partial<NewLoan> = {};

  // Agreement Number - matches "Agreement Number:\n\nPHR022710486858" format
  const agreementMatch = text.match(/Agreement\s*Number[:\s]*\n*([A-Z0-9]+)/i);
  if (agreementMatch) {
    details.agreementNumber = agreementMatch[1].trim();
  }

  // Application Number
  const appMatch = text.match(/Application\s*No\.?[:\s]*(\d+)/i);
  if (appMatch) {
    details.applicationNumber = appMatch[1].trim();
  }

  // Borrower Name - from Customer ID line
  const borrowerMatch = text.match(/([A-Z][A-Z\s]+)\s*\n\s*Customer\s*ID/i);
  if (borrowerMatch) {
    details.borrowerName = borrowerMatch[1].trim();
  }

  // Co-Applicant Name
  const coAppMatch = text.match(/Co\s*Applicant\s*Name[:\s]*\n*([A-Z][A-Za-z\s]+?)(?:\n|\.{3})/i);
  if (coAppMatch) {
    details.coBorrowerName = coAppMatch[1].trim().replace(/\s+/g, ' ');
  }

  // Sanctioned Amount (Loan Sanctioned)
  const sanctionedMatch = text.match(/Loan\s*Sanctioned[:\s]*(?:INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (sanctionedMatch) {
    details.sanctionedAmount = parseAmount(sanctionedMatch[1]);
  }

  // Amount Financed
  const financedMatch = text.match(/Amount\s*Financed[:\s]*(?:INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (financedMatch) {
    details.sanctionedAmount = parseAmount(financedMatch[1]);
  }

  // Amount Disbursed
  const disbursedMatch = text.match(/Amount\s*Disbursed[:\s]*(?:INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (disbursedMatch) {
    details.disbursedAmount = parseAmount(disbursedMatch[1]);
  }

  // Interest Rate
  const rateMatch = text.match(/Rate\s*of\s*Interest\s*\(%\)[:\s]*(\d+\.?\d*)/i);
  if (rateMatch) {
    details.interestRate = parseFloat(rateMatch[1]);
  }

  // EMI Amount
  const emiMatch = text.match(/EMI\*?[:\s]*(?:INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (emiMatch) {
    details.emiAmount = parseAmount(emiMatch[1]);
  }

  // Total Installments (Loan Term Original)
  const termMatch = text.match(/Loan\s*Term\s*Original[:\s]*(\d+)\s*\(?months?\)?/i);
  if (termMatch) {
    details.totalInstallments = parseInt(termMatch[1], 10);
  }

  // Pending Installments
  const pendingMatch = text.match(/Pending\s*Future[:\s]*(\d+)\s*Installments/i);
  if (pendingMatch) {
    details.pendingInstallments = parseInt(pendingMatch[1], 10);
  }

  // Outstanding Balance
  const outstandingMatch = text.match(/Outstanding\s*Balance[:\s]*(?:\(Outstanding\s*Principal\))?[:\s]*(?:INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (outstandingMatch) {
    details.outstandingAmount = parseAmount(outstandingMatch[1]);
  }

  // Principal Paid
  const principalPaidMatch = text.match(/Principal\s*Paid[:\s]*(?:INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (principalPaidMatch) {
    details.totalPrincipalPaid = parseAmount(principalPaidMatch[1]);
  }

  // Interest Paid
  const interestPaidMatch = text.match(/Interest\s*Paid[:\s]*(?:INR)?\s*([\d,]+(?:\.\d{2})?)/i);
  if (interestPaidMatch) {
    details.totalInterestPaid = parseAmount(interestPaidMatch[1]);
  }

  // Property Address
  const propertyMatch = text.match(/Property\s*Address[:\s]*\n*(.+?)(?:\n\.{3}|Rate\s*of)/is);
  if (propertyMatch) {
    details.propertyAddress = propertyMatch[1].trim()
      .replace(/\n+/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/\.{3,}/g, '')
      .trim();
  }

  // Disbursal Date
  const disbursalMatch = text.match(/Disbursal\s*Date[:\s]*(\d{2}-\d{2}-\d{4})/i);
  if (disbursalMatch) {
    details.disbursalDate = parseDate(disbursalMatch[1]);
  }

  // Repayment Mode
  if (text.match(/Standing\s*Instructions/i)) {
    details.repaymentMode = 'SI';
  } else if (text.match(/NACH|Auto\s*Debit/i)) {
    details.repaymentMode = 'NACH';
  }

  // Repayment Bank
  const repaymentBankMatch = text.match(/Repayment\s*Bank[:\s]*([A-Z][A-Za-z\s]+?)(?:\n|\.{3})/i);
  if (repaymentBankMatch) {
    details.repaymentBank = repaymentBankMatch[1].trim();
  }

  return details;
}

// Extract transactions from the statement
// Format: DATE | VALUE DATE | PARTICULARS | INCREASED BY (INR) | DECREASED BY (INR)
function extractTransactions(text: string, loanId: string): { payments: NewLoanPayment[], disbursements: NewLoanDisbursement[] } {
  const payments: NewLoanPayment[] = [];
  const disbursements: NewLoanDisbursement[] = [];
  const now = new Date().toISOString();

  // Find the transaction section
  const transactionSection = text.match(/Loan\s*Statement\s*for\s*the\s*period[\s\S]*?(?:Call\s*us\s*on|$)/i);
  if (!transactionSection) {
    console.log('No transaction section found in PDF');
    return { payments, disbursements };
  }

  const searchText = transactionSection[0];

  // PDF text format: dates might be concatenated like "10-02-202510-02-2025"
  // And amounts might be at end of line like "43,336.000.00"
  // Pattern: DATE1 DATE2 PARTICULARS AMOUNT1 AMOUNT2
  const lineRegex = /(\d{2}-\d{2}-\d{4})[\s]*(\d{2}-\d{2}-\d{4})[\s]*(.+?)([\d,]+\.\d{2})([\d,]+\.\d{2})/g;

  let match;
  let installmentNumber = 0;
  let runningDisbursement = 0;

  console.log('Searching for transactions in text...');

  while ((match = lineRegex.exec(searchText)) !== null) {
    const date = parseDate(match[1]);
    const valueDate = parseDate(match[2]);
    const particulars = match[3].trim();
    const increasedBy = parseAmount(match[4]); // Due/Charges (left amount)
    const decreasedBy = parseAmount(match[5]); // Payments received (right amount)

    // Skip header rows
    if (particulars.includes('PARTICULARS') || particulars.includes('DATE') || particulars.includes('INCREASED')) {
      continue;
    }

    const upperParticulars = particulars.toUpperCase();

    // Determine transaction type
    let transactionType = 'payment';

    if (upperParticulars.includes('DUE FOR INSTALMENT') || upperParticulars.includes('DUE FOR INSTALLMENT')) {
      // This is a due entry, not a payment - skip or track differently
      transactionType = 'emi_due';
      const instMatch = particulars.match(/Instalment\s*(\d+)/i);
      if (instMatch) {
        installmentNumber = parseInt(instMatch[1], 10);
      }
    } else if (upperParticulars.includes('PMNT RCVD') || upperParticulars.includes('PAYMENT RECEIVED') || upperParticulars.includes('AMOUNT PAID')) {
      transactionType = 'emi';
    } else if (upperParticulars.includes('AMT FINANCED') || upperParticulars.includes('DISBURS')) {
      transactionType = 'disbursement';
    } else if (upperParticulars.includes('INTEREST ON ADVANCE') || upperParticulars.includes('PRE-EMI') || upperParticulars.includes('PEMI')) {
      transactionType = 'pre_emi_interest';
    } else if (upperParticulars.includes('STAMP DUTY') || upperParticulars.includes('CHARGE') || upperParticulars.includes('FEE')) {
      transactionType = 'charge';
    } else if (upperParticulars.includes('PREPAY') || upperParticulars.includes('PART PREPAYMENT')) {
      transactionType = 'prepayment';
    } else if (upperParticulars.includes('ADJUSTED')) {
      transactionType = 'adjustment';
    }

    // Skip due entries (we only track actual payments)
    if (transactionType === 'emi_due') {
      continue;
    }

    // For disbursements
    if (transactionType === 'disbursement' && increasedBy > 0) {
      // Skip if it's just a payable entry
      if (upperParticulars.includes('PAYABLE')) {
        continue;
      }

      runningDisbursement += increasedBy;
      disbursements.push({
        id: uuidv4(),
        loanId,
        date,
        amount: increasedBy,
        purpose: upperParticulars.includes('FINAL') ? 'final_disbursement' : 'disbursement',
        referenceNumber: extractRefNumber(particulars),
        runningTotal: runningDisbursement,
        createdAt: now,
      });
    } else if (decreasedBy > 0 && transactionType !== 'adjustment') {
      // This is a payment
      const amount = decreasedBy;

      payments.push({
        id: uuidv4(),
        loanId,
        date,
        valueDate,
        transactionType,
        particulars: particulars.substring(0, 200),
        installmentNumber: transactionType === 'emi' ? installmentNumber : null,
        amount,
        principalPaid: null, // Will be calculated if we have schedule data
        interestPaid: null,
        chargesPaid: transactionType === 'charge' ? amount : null,
        disbursementAmount: null,
        referenceNumber: extractRefNumber(particulars),
        paymentMode: extractPaymentMode(particulars),
        notes: null,
        createdAt: now,
      });
    }
  }

  console.log(`Parsed ${payments.length} payments and ${disbursements.length} disbursements`);
  return { payments, disbursements };
}

// Extract reference number from text
function extractRefNumber(text: string): string | null {
  // Match patterns like "SI FEB 25", "S21371306/5", etc.
  const refMatch = text.match(/(?:Cheque\s*No\.?|PDC\s*No\.?)[:\s]*([A-Z0-9/\s]+?)(?:\s*Receipt|$)/i);
  if (refMatch) {
    return refMatch[1].trim();
  }
  return null;
}

// Extract payment mode from text
function extractPaymentMode(text: string): string | null {
  if (text.match(/PDC/i)) return 'PDC';
  if (text.match(/SI\s|Standing/i)) return 'SI';
  if (text.match(/Cheque/i)) return 'cheque';
  if (text.match(/Transfer|TR\s/i)) return 'transfer';
  return null;
}

// Main parser function
export async function parseAxisHomeLoanStatement(
  buffer: Buffer,
  existingLoanId?: string
): Promise<AxisHomeLoanData> {
  const data = await pdfParse(buffer);
  const text = data.text;
  const now = new Date().toISOString();

  console.log('Parsing Axis Home Loan statement...');

  // Generate or use existing loan ID
  const loanId = existingLoanId || uuidv4();

  // Extract loan details
  const loanDetails = extractLoanDetails(text);
  console.log('Extracted loan details:', JSON.stringify(loanDetails, null, 2));

  // Extract transactions
  const { payments, disbursements } = extractTransactions(text, loanId);

  // Calculate summary from extracted details (prefer PDF values over calculated)
  const summary = {
    totalPrincipalPaid: loanDetails.totalPrincipalPaid || 0,
    totalInterestPaid: loanDetails.totalInterestPaid || 0,
    totalChargesPaid: payments.filter(p => p.transactionType === 'charge').reduce((sum, p) => sum + p.amount, 0),
    totalDisbursed: loanDetails.disbursedAmount || 0,
    outstanding: loanDetails.outstandingAmount || 0,
  };

  // Calculate paid installments
  const paidInstallments = loanDetails.totalInstallments && loanDetails.pendingInstallments
    ? loanDetails.totalInstallments - loanDetails.pendingInstallments
    : payments.filter(p => p.transactionType === 'emi').length;

  // Build loan record
  const loan: Partial<NewLoan> = {
    id: loanId,
    type: 'taken',
    loanType: 'home',
    partyName: 'Axis Bank',
    borrowerName: loanDetails.borrowerName || null,
    coBorrowerName: loanDetails.coBorrowerName || null,
    agreementNumber: loanDetails.agreementNumber || null,
    applicationNumber: loanDetails.applicationNumber || null,
    sanctionedAmount: loanDetails.sanctionedAmount || null,
    disbursedAmount: loanDetails.disbursedAmount || null,
    principalAmount: loanDetails.sanctionedAmount || loanDetails.disbursedAmount || 0,
    outstandingAmount: loanDetails.outstandingAmount || 0,
    interestRate: loanDetails.interestRate || 0,
    interestType: 'floating', // Axis home loans are typically floating
    emiAmount: loanDetails.emiAmount || null,
    emiStartDate: null,
    totalInstallments: loanDetails.totalInstallments || null,
    paidInstallments,
    pendingInstallments: loanDetails.pendingInstallments || null,
    totalPrincipalPaid: summary.totalPrincipalPaid,
    totalInterestPaid: summary.totalInterestPaid,
    totalChargesPaid: summary.totalChargesPaid,
    startDate: loanDetails.disbursalDate || now.split('T')[0],
    disbursalDate: loanDetails.disbursalDate || null,
    dueDate: null,
    maturityDate: null,
    propertyAddress: loanDetails.propertyAddress || null,
    propertyType: null,
    repaymentBank: loanDetails.repaymentBank || null,
    repaymentMode: loanDetails.repaymentMode || null,
    status: 'active',
    notes: null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    loan,
    payments,
    disbursements,
    summary,
  };
}

// Helper to merge data from multiple statement periods
export function mergeStatementData(
  existingData: AxisHomeLoanData,
  newData: AxisHomeLoanData
): AxisHomeLoanData {
  // Merge payments (deduplicate by date + amount + type)
  const existingPaymentKeys = new Set(
    existingData.payments.map(p => `${p.date}-${p.amount}-${p.transactionType}`)
  );
  const newPayments = newData.payments.filter(
    p => !existingPaymentKeys.has(`${p.date}-${p.amount}-${p.transactionType}`)
  );

  // Merge disbursements (deduplicate by date + amount)
  const existingDisbursementKeys = new Set(
    existingData.disbursements.map(d => `${d.date}-${d.amount}`)
  );
  const newDisbursements = newData.disbursements.filter(
    d => !existingDisbursementKeys.has(`${d.date}-${d.amount}`)
  );

  const allPayments = [...existingData.payments, ...newPayments].sort(
    (a, b) => a.date.localeCompare(b.date)
  );
  const allDisbursements = [...existingData.disbursements, ...newDisbursements].sort(
    (a, b) => a.date.localeCompare(b.date)
  );

  // Use the latest loan details (from newData), preserving ID
  const loan = {
    ...existingData.loan,
    ...newData.loan,
    id: existingData.loan.id,
    updatedAt: new Date().toISOString(),
  };

  // Use latest summary from PDF
  const summary = newData.summary;

  return {
    loan,
    payments: allPayments,
    disbursements: allDisbursements,
    summary,
  };
}
