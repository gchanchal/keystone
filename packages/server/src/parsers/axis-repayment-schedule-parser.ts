import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import type { NewLoanSchedule } from '../db/schema/loans.js';

export interface AxisRepaymentScheduleData {
  loanDetails: {
    agreementNumber: string;
    borrowerName: string;
    customerId: string;
    loanSanctioned: number;
    loanDisbursed: number;
    currentInterestRate: number;
    loanType: string;
    tenureMonths: number;
    frequency: string;
  };
  schedule: NewLoanSchedule[];
  summary: {
    totalInstallments: number;
    totalPrincipal: number;
    totalInterest: number;
    totalAmount: number;
    maturityDate: string;
    currentEmiAmount: number;
  };
}

// Parse amount strings like "1,93,06,010.00" or "1,23,456.78"
function parseAmount(amountStr: string): number {
  if (!amountStr) return 0;
  const cleaned = amountStr.replace(/[,\s₹Rs\.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Parse date strings like "10/06/2025"
function parseDate(dateStr: string): string {
  if (!dateStr) return '';

  // Handle DD/MM/YYYY format
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }

  return dateStr;
}

// Extract loan details from the header section
function extractLoanDetails(text: string): AxisRepaymentScheduleData['loanDetails'] {
  const details: AxisRepaymentScheduleData['loanDetails'] = {
    agreementNumber: '',
    borrowerName: '',
    customerId: '',
    loanSanctioned: 0,
    loanDisbursed: 0,
    currentInterestRate: 0,
    loanType: 'Home Loan',
    tenureMonths: 0,
    frequency: 'Monthly',
  };

  // Agreement Number
  const agreementMatch = text.match(/Agreement\s*Number\s*:?\s*([A-Z0-9]+)/i);
  if (agreementMatch) {
    details.agreementNumber = agreementMatch[1].trim();
  }

  // Borrower Name (typically in caps after the header)
  const nameMatch = text.match(/([A-Z][A-Z\s]+)\s+Registered\s*Address/);
  if (nameMatch) {
    details.borrowerName = nameMatch[1].trim();
  }

  // Customer ID
  const customerMatch = text.match(/Customer\s*ID\s*:?\s*(\d+)/i);
  if (customerMatch) {
    details.customerId = customerMatch[1].trim();
  }

  // Loan Sanctioned
  const sanctionedMatch = text.match(/Loan\s*Sanctioned\s*:?\s*Rs\.?\s*([\d,]+)/i);
  if (sanctionedMatch) {
    details.loanSanctioned = parseAmount(sanctionedMatch[1]);
  }

  // Loan Amount Disbursed
  const disbursedMatch = text.match(/Loan\s*Amount\s*Disbursed\s*:?\s*Rs\.?\s*([\d,]+)/i);
  if (disbursedMatch) {
    details.loanDisbursed = parseAmount(disbursedMatch[1]);
  }

  // Current Interest Rate
  const rateMatch = text.match(/Current\s*Interest\s*\(%\)\s*:?\s*([\d.]+)/i);
  if (rateMatch) {
    details.currentInterestRate = parseFloat(rateMatch[1]);
  }

  // Loan Type
  const typeMatch = text.match(/Loan\s*Type\s*:?\s*([A-Za-z\s]+?)(?:\n|Tenure)/i);
  if (typeMatch) {
    details.loanType = typeMatch[1].trim();
  }

  // Tenure
  const tenureMatch = text.match(/Tenure\s*\(Months\)\s*:?\s*(\d+)/i);
  if (tenureMatch) {
    details.tenureMonths = parseInt(tenureMatch[1], 10);
  }

  // Frequency
  const freqMatch = text.match(/Frequency\s*:?\s*([A-Za-z]+)/i);
  if (freqMatch) {
    details.frequency = freqMatch[1].trim();
  }

  return details;
}

// Extract EMI schedule rows from the PDF text
function extractScheduleRows(text: string, loanId: string): NewLoanSchedule[] {
  const schedule: NewLoanSchedule[] = [];
  const now = new Date().toISOString();

  // Pattern for EMI schedule rows:
  // INSTL.NUM  DUE DATE  OPENING PRINCIPAL  INSTL. AMOUNT  PRINCIPAL AMOUNT  INTEREST AMOUNT  CLOSING PRINCIPAL  RATE(%)
  // 1          10/06/2025  1,93,03,073.00    1,86,235.00   52,621.00         1,33,614.00      1,92,50,452.00     8.15

  const lines = text.split('\n');

  for (const line of lines) {
    // Match lines that start with an installment number
    const rowMatch = line.match(
      /^\s*(\d+)\s+(\d{2}\/\d{2}\/\d{4})\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d.]+)\s*$/
    );

    if (rowMatch) {
      const [, instNum, dueDate, openingPrincipal, instAmount, principalAmt, interestAmt, closingPrincipal, rate] = rowMatch;

      schedule.push({
        id: uuidv4(),
        loanId,
        installmentNumber: parseInt(instNum, 10),
        dueDate: parseDate(dueDate),
        openingPrincipal: parseAmount(openingPrincipal),
        installmentAmount: parseAmount(instAmount),
        principalAmount: parseAmount(principalAmt),
        interestAmount: parseAmount(interestAmt),
        closingPrincipal: parseAmount(closingPrincipal),
        interestRate: parseFloat(rate),
        status: 'pending',
        actualPaymentDate: null,
        actualAmountPaid: null,
        createdAt: now,
      });
    }
  }

  // Sort by installment number
  schedule.sort((a, b) => a.installmentNumber - b.installmentNumber);

  return schedule;
}

// Calculate summary from schedule
function calculateSummary(schedule: NewLoanSchedule[]): AxisRepaymentScheduleData['summary'] {
  if (schedule.length === 0) {
    return {
      totalInstallments: 0,
      totalPrincipal: 0,
      totalInterest: 0,
      totalAmount: 0,
      maturityDate: '',
      currentEmiAmount: 0,
    };
  }

  const totalPrincipal = schedule.reduce((sum, s) => sum + s.principalAmount, 0);
  const totalInterest = schedule.reduce((sum, s) => sum + s.interestAmount, 0);
  const totalAmount = schedule.reduce((sum, s) => sum + s.installmentAmount, 0);
  const lastInstallment = schedule[schedule.length - 1];

  // Get the most common EMI amount (excluding the last one which might be different)
  const emiAmounts = schedule.slice(0, -1).map(s => s.installmentAmount);
  const currentEmiAmount = emiAmounts.length > 0
    ? emiAmounts[Math.floor(emiAmounts.length / 2)] // Use median
    : schedule[0]?.installmentAmount || 0;

  return {
    totalInstallments: schedule.length,
    totalPrincipal,
    totalInterest,
    totalAmount,
    maturityDate: lastInstallment.dueDate,
    currentEmiAmount,
  };
}

// Main parser function
export async function parseAxisRepaymentSchedule(
  buffer: Buffer,
  loanId: string
): Promise<AxisRepaymentScheduleData> {
  const data = await pdfParse(buffer);
  const text = data.text;

  // Extract loan details
  const loanDetails = extractLoanDetails(text);

  // Extract schedule rows
  const schedule = extractScheduleRows(text, loanId);

  // Calculate summary
  const summary = calculateSummary(schedule);

  return {
    loanDetails,
    schedule,
    summary,
  };
}

// Mark past EMIs as paid based on actual payment records
export function markPaidInstallments(
  schedule: NewLoanSchedule[],
  payments: { date: string; amount: number; transactionType: string }[]
): NewLoanSchedule[] {
  const today = new Date().toISOString().split('T')[0];
  const emiPayments = payments
    .filter(p => p.transactionType === 'emi')
    .sort((a, b) => a.date.localeCompare(b.date));

  let paymentIndex = 0;

  return schedule.map(installment => {
    // Check if this installment is in the past
    if (installment.dueDate <= today) {
      // Check if we have a matching payment
      if (paymentIndex < emiPayments.length) {
        const payment = emiPayments[paymentIndex];
        const dueDate = new Date(installment.dueDate);
        const paymentDate = new Date(payment.date);

        // Allow some flexibility in matching (within 15 days)
        const daysDiff = Math.abs((paymentDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 15 && Math.abs(payment.amount - installment.installmentAmount) < 100) {
          paymentIndex++;
          return {
            ...installment,
            status: 'paid',
            actualPaymentDate: payment.date,
            actualAmountPaid: payment.amount,
          };
        }
      }

      // Past due but no matching payment
      return {
        ...installment,
        status: 'overdue',
      };
    }

    return installment;
  });
}

// Get upcoming EMIs
export function getUpcomingEmis(schedule: NewLoanSchedule[], months: number = 6): NewLoanSchedule[] {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setMonth(futureDate.getMonth() + months);

  const todayStr = today.toISOString().split('T')[0];
  const futureDateStr = futureDate.toISOString().split('T')[0];

  return schedule.filter(
    s => s.dueDate >= todayStr && s.dueDate <= futureDateStr && s.status === 'pending'
  );
}

// Calculate loan progress
export function calculateLoanProgress(schedule: NewLoanSchedule[]): {
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  principalPaidScheduled: number;
  principalPendingScheduled: number;
  interestPaidScheduled: number;
  interestPendingScheduled: number;
  progressPercent: number;
} {
  const paid = schedule.filter(s => s.status === 'paid');
  const pending = schedule.filter(s => s.status === 'pending');
  const overdue = schedule.filter(s => s.status === 'overdue');

  const principalPaidScheduled = paid.reduce((sum, s) => sum + s.principalAmount, 0);
  const principalPendingScheduled = pending.reduce((sum, s) => sum + s.principalAmount, 0) +
                                    overdue.reduce((sum, s) => sum + s.principalAmount, 0);

  const interestPaidScheduled = paid.reduce((sum, s) => sum + s.interestAmount, 0);
  const interestPendingScheduled = pending.reduce((sum, s) => sum + s.interestAmount, 0) +
                                   overdue.reduce((sum, s) => sum + s.interestAmount, 0);

  const totalInstallments = schedule.length;
  const progressPercent = totalInstallments > 0 ? (paid.length / totalInstallments) * 100 : 0;

  return {
    paidCount: paid.length,
    pendingCount: pending.length,
    overdueCount: overdue.length,
    principalPaidScheduled,
    principalPendingScheduled,
    interestPaidScheduled,
    interestPendingScheduled,
    progressPercent,
  };
}
