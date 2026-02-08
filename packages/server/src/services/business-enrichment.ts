/**
 * Business Enrichment Service
 * Auto-enriches bank transactions with business type, vendor name, and GST info
 * for ASG Technologies (GearUp Mods business)
 */

export type BizType = 'SALARY' | 'PETROL' | 'PORTER' | 'HELPER' | 'VENDOR' | 'SALES_INCOME' | 'OTHER';

export interface EnrichmentResult {
  bizType: BizType;
  vendorName: string | null;
  bizDescription: string | null;
  needsInvoice: boolean;
  gstType: 'input' | 'output' | null;
}

// Detection patterns for each business type
const PATTERNS: Record<BizType, { patterns: RegExp[]; needsInvoice: boolean; gstType: 'input' | 'output' | null }> = {
  SALARY: {
    patterns: [
      /salary/i,
      /sal\s*(for|of)/i,
      /\bsal\b.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
    ],
    needsInvoice: false,
    gstType: null,
  },
  PETROL: {
    patterns: [
      /petrol/i,
      /\bBP\s+/i, // BP petrol pump
      /\bHP\s+/i, // HP petrol pump
      /\bIOCL?\b/i, // Indian Oil
      /fuel/i,
      /\bdiesel\b/i,
      /petrol\s*pump/i,
      /filling\s*station/i,
    ],
    needsInvoice: false,
    gstType: 'input',
  },
  PORTER: {
    patterns: [
      /porter/i,
      /\bdelivery\b/i,
      /courier/i,
    ],
    needsInvoice: false,
    gstType: null,
  },
  HELPER: {
    patterns: [
      /helper/i,
      /\bhelp\b/i,
    ],
    needsInvoice: false,
    gstType: null,
  },
  VENDOR: {
    patterns: [
      /NEFT/i, // NEFT payments are typically vendor payments
      /RTGS/i, // RTGS payments are typically vendor payments
    ],
    needsInvoice: true,
    gstType: 'input',
  },
  SALES_INCOME: {
    patterns: [
      /CASHFREE/i,
      /RAZORPAY/i,
      /PAYTM\s*GATEWAY/i,
      /PHONEPE\s*MERCHANT/i,
    ],
    needsInvoice: false,
    gstType: 'output',
  },
  OTHER: {
    patterns: [],
    needsInvoice: false,
    gstType: null,
  },
};

// Large UPI threshold (vendor payments are usually larger amounts)
const LARGE_UPI_THRESHOLD = 5000;

/**
 * Extract vendor name from narration
 */
export function extractVendorName(narration: string): string | null {
  // UPI format: UPI/VENDOR_NAME/...
  const upiMatch = narration.match(/UPI\/([^\/]+)\//);
  if (upiMatch) {
    return cleanVendorName(upiMatch[1]);
  }

  // NEFT format: NEFT/ VENDOR_NAME/ BANK
  const neftMatch = narration.match(/NEFT\/\s*([^\/]+)\//);
  if (neftMatch) {
    return cleanVendorName(neftMatch[1]);
  }

  // RTGS format: RTGS/ VENDOR_NAME/ BANK
  const rtgsMatch = narration.match(/RTGS\/\s*([^\/]+)\//);
  if (rtgsMatch) {
    return cleanVendorName(rtgsMatch[1]);
  }

  // IMPS format: IMPS/.../ VENDOR_NAME
  const impsMatch = narration.match(/IMPS\/[^\/]+\/([^\/]+)/);
  if (impsMatch) {
    return cleanVendorName(impsMatch[1]);
  }

  // MB: Sent NEFT format
  const mbNeftMatch = narration.match(/MB:\s*Sent\s*NEFT\/\s*([^\/]+)/i);
  if (mbNeftMatch) {
    return cleanVendorName(mbNeftMatch[1]);
  }

  return null;
}

/**
 * Clean and normalize vendor name
 */
function cleanVendorName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ') // Normalize spaces
    .replace(/\d+$/, '') // Remove trailing numbers (account numbers)
    .trim()
    .toUpperCase();
}

/**
 * Detect business type from narration
 */
export function detectBizType(narration: string, transactionType: 'credit' | 'debit', amount: number): BizType {
  const upperNarration = narration.toUpperCase();

  // Check for SALES_INCOME first (credits from payment gateways)
  if (transactionType === 'credit') {
    for (const pattern of PATTERNS.SALES_INCOME.patterns) {
      if (pattern.test(narration)) {
        return 'SALES_INCOME';
      }
    }
  }

  // For debits, check other patterns
  if (transactionType === 'debit') {
    // Check SALARY
    for (const pattern of PATTERNS.SALARY.patterns) {
      if (pattern.test(narration)) {
        return 'SALARY';
      }
    }

    // Check PETROL
    for (const pattern of PATTERNS.PETROL.patterns) {
      if (pattern.test(narration)) {
        return 'PETROL';
      }
    }

    // Check PORTER
    for (const pattern of PATTERNS.PORTER.patterns) {
      if (pattern.test(narration)) {
        return 'PORTER';
      }
    }

    // Check HELPER
    for (const pattern of PATTERNS.HELPER.patterns) {
      if (pattern.test(narration)) {
        return 'HELPER';
      }
    }

    // Check VENDOR (NEFT/RTGS payments)
    for (const pattern of PATTERNS.VENDOR.patterns) {
      if (pattern.test(narration)) {
        return 'VENDOR';
      }
    }

    // Large UPI payments are likely vendor payments
    if (amount >= LARGE_UPI_THRESHOLD && upperNarration.includes('UPI')) {
      return 'VENDOR';
    }
  }

  return 'OTHER';
}

/**
 * Generate business description based on type and vendor
 */
export function generateBizDescription(bizType: BizType, vendorName: string | null, narration: string): string {
  const monthMatch = narration.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{0,4}/i);
  const monthStr = monthMatch ? monthMatch[0] : '';

  switch (bizType) {
    case 'SALARY':
      return vendorName
        ? `Salary payment to ${vendorName}${monthStr ? ` - ${monthStr}` : ''}`
        : `Salary payment${monthStr ? ` - ${monthStr}` : ''}`;
    case 'PETROL':
      return vendorName
        ? `Fuel expense at ${vendorName}`
        : 'Fuel expense';
    case 'PORTER':
      return vendorName
        ? `Delivery/Porter - ${vendorName}`
        : 'Delivery/Porter expense';
    case 'HELPER':
      return vendorName
        ? `Helper payment - ${vendorName}`
        : 'Helper payment';
    case 'VENDOR':
      return vendorName
        ? `Vendor payment - ${vendorName}`
        : 'Vendor payment';
    case 'SALES_INCOME':
      return vendorName
        ? `Sales income via ${vendorName}`
        : 'Sales income';
    default:
      return '';
  }
}

/**
 * Enrich a single transaction
 */
export function enrichTransaction(
  narration: string,
  transactionType: 'credit' | 'debit',
  amount: number
): EnrichmentResult {
  const bizType = detectBizType(narration, transactionType, amount);
  const vendorName = extractVendorName(narration);
  const bizDescription = generateBizDescription(bizType, vendorName, narration);
  const { needsInvoice, gstType } = PATTERNS[bizType];

  return {
    bizType,
    vendorName,
    bizDescription: bizDescription || null,
    needsInvoice,
    gstType,
  };
}

/**
 * Get all business types with labels
 */
export function getBizTypeLabels(): Record<BizType, string> {
  return {
    SALARY: 'Salary',
    PETROL: 'Petrol/Fuel',
    PORTER: 'Porter/Delivery',
    HELPER: 'Helper',
    VENDOR: 'Vendor Payment',
    SALES_INCOME: 'Sales Income',
    OTHER: 'Other',
  };
}
