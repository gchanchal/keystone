/**
 * Invoice Parser Service
 * Extracts GST information from uploaded invoice PDFs and images
 * Uses Claude Vision API for accurate image OCR
 */

import pdf from 'pdf-parse';
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';

export interface InvoiceGSTInfo {
  gstAmount: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  igstAmount: number | null;
  gstType: 'input' | 'output' | null;
  gstinVendor: string | null;
  partyName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalAmount: number | null;
  taxableAmount: number | null;
  documentType: 'invoice' | 'estimate' | 'proforma' | 'quotation' | null;
  isEstimate: boolean;
}

// Common GST patterns in Indian invoices
const PATTERNS = {
  // GSTIN: 22AAAAA0000A1Z5 format
  gstin: /\b(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1})\b/gi,

  // GST amounts - various formats
  // Pattern 1: "CGST2.5 (2.5%)16.67" - amount after percentage in parentheses
  // Pattern 2: "CGST @ 9%: 1500.00" - amount after colon
  // Pattern 3: "CGST: ₹1500.00" - amount after label
  cgstWithPct: /(?:CGST|C\.G\.S\.T|Central\s*GST)\s*\d*\.?\d*\s*\(\d+(?:\.\d+)?%\)\s*[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
  sgstWithPct: /(?:SGST|S\.G\.S\.T|State\s*GST)\s*\d*\.?\d*\s*\(\d+(?:\.\d+)?%\)\s*[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
  igstWithPct: /(?:IGST|I\.G\.S\.T|Integrated\s*GST)\s*\d*\.?\d*\s*\(\d+(?:\.\d+)?%\)\s*[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,

  // Fallback patterns without percentage format
  cgst: /(?:CGST|C\.G\.S\.T|Central\s*GST)[\s:@]*(?:\d+(?:\.\d+)?%?)?\s*[₹Rs.INR\s:]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
  sgst: /(?:SGST|S\.G\.S\.T|State\s*GST)[\s:@]*(?:\d+(?:\.\d+)?%?)?\s*[₹Rs.INR\s:]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
  igst: /(?:IGST|I\.G\.S\.T|Integrated\s*GST)[\s:@]*(?:\d+(?:\.\d+)?%?)?\s*[₹Rs.INR\s:]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,
  // Use word boundary to avoid matching GSTIN
  gst: /(?<![A-Z])(?:GST|G\.S\.T)(?![IN])[\s:@]*(?:\d+(?:\.\d+)?%?)?\s*[₹Rs.INR\s:]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,

  // HSN table pattern: looks for "Total Tax Amount" header followed by totals row
  hsnTaxTable: /Total\s*Tax\s*Amount[\s\S]*?Total[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/i,

  // Tax amount patterns - also look for "Total Tax Amount" row
  taxAmount: /(?:Tax\s*Amount|Total\s*Tax|GST\s*Amount|Total\s*Tax\s*Amount)[\s:]*[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,

  // IGST table format: look for IGST column header followed by amounts
  igstTable: /IGST[\s\S]*?Total[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,

  // Total amount - match "Grand Total" first (more specific), then fallback to "Total"
  // Also handle formats like "Grand Total ₹ 39884" or "Grand Total: Rs. 39,884.00"
  grandTotal: /Grand\s*Total\s*(?:\([^)]*\))?\s*[₹Rs.INR:]*\s*(\d+(?:,?\d+)*(?:\.\d{1,2})?)/gi,
  totalAmount: /(?:Total\s*Amount|Net\s*Amount|Invoice\s*Total|Amount\s*Payable|Total\s*Payable|Total)\s*[₹Rs.INR():]*\s*(\d+(?:,?\d+)*(?:\.\d{1,2})?)/gi,
  // Rupee symbol followed by large number (likely a total)
  rupeeAmount: /[₹Rs.]\s*(\d{4,}(?:,?\d+)*(?:\.\d{1,2})?)/gi,

  // Taxable amount - also look for "Taxable amount" in table
  taxableAmount: /(?:Taxable\s*(?:Value|Amount)|Sub\s*Total|Subtotal|Base\s*Amount)[\s:]*[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/gi,

  // Invoice number - also match Estimate No, Proforma No, Quotation No (with colon support)
  invoiceNumber: /(?:Invoice\s*(?:No\.?|Number|#):?|Estimate\s*(?:No\.?|Number):?|Proforma\s*(?:No\.?|Number):?|Quotation\s*(?:No\.?|Number):?|Bill\s*No\.?:?|Inv\.?\s*No\.?:?)\s*([A-Z0-9\-\/]+)/gi,

  // Bill To / Ship To - extract customer name (stop at newline or common keywords)
  billTo: /(?:BILL\s*TO|BILLED\s*TO|INVOICE\s*TO|CUSTOMER|CLIENT)[\s:]*\n*([A-Z][A-Z0-9\s&.,]+?(?:PRIVATE\s+LIMITED|PVT\.?\s*LTD\.?|LIMITED|LTD\.?|LLP|INC\.?)?)(?=\n|Invoice|Address|GSTIN|$)/i,

  // Invoice/Estimate date
  invoiceDate: /(?:Invoice\s*Date|Estimate\s*Date|Bill\s*Date|Date)[\s:]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/gi,

  // Document type detection
  documentType: /^(Estimate|Invoice|Tax Invoice|Proforma Invoice|Proforma|Quotation|Quote)/im,

  // Party/Company name - typically appears after document title, before address
  partyName: /^(Estimate|Invoice|Tax Invoice|Proforma Invoice|Proforma|Quotation|Quote)\s*\n+([A-Z][A-Z\s&.,]+)(?:\n|$)/im,
};

/**
 * Parse a number from Indian format (1,00,000.00)
 */
function parseIndianNumber(str: string): number {
  if (!str) return 0;
  // Remove commas and parse
  return parseFloat(str.replace(/,/g, '')) || 0;
}

/**
 * Extract all matches for a pattern
 */
function extractAll(text: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  let match;
  const regex = new RegExp(pattern.source, pattern.flags);
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      matches.push(match[1]);
    }
  }
  return matches;
}

/**
 * Extract the first match for a pattern
 */
function extractFirst(text: string, pattern: RegExp): string | null {
  const matches = extractAll(text, pattern);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Extract GST information from text (shared by PDF and image parsing)
 */
function extractGSTFromText(text: string): InvoiceGSTInfo {
  const result: InvoiceGSTInfo = {
    gstAmount: null,
    cgstAmount: null,
    sgstAmount: null,
    igstAmount: null,
    gstType: 'input', // Uploaded invoices are typically purchase invoices (input GST)
    gstinVendor: null,
    partyName: null,
    invoiceNumber: null,
    invoiceDate: null,
    totalAmount: null,
    taxableAmount: null,
    documentType: null,
    isEstimate: false,
  };

  // Detect document type (Estimate, Invoice, Proforma, etc.)
  const docTypeMatch = text.match(PATTERNS.documentType);
  if (docTypeMatch) {
    const docType = docTypeMatch[1].toLowerCase();
    if (docType.includes('estimate')) {
      result.documentType = 'estimate';
      result.isEstimate = true;
    } else if (docType.includes('proforma')) {
      result.documentType = 'proforma';
      result.isEstimate = true;
    } else if (docType.includes('quotation') || docType.includes('quote')) {
      result.documentType = 'quotation';
      result.isEstimate = true;
    } else {
      result.documentType = 'invoice';
      result.isEstimate = false;
    }
  }

  // Extract GSTIN (vendor's GST number) - do this first as it helps identify vendor
  const gstins = extractAll(text, PATTERNS.gstin);
  if (gstins.length > 0) {
    // Usually the first GSTIN is the vendor's
    result.gstinVendor = gstins[0];
  }

  // Extract vendor/seller name (for input invoices, this is the company issuing the invoice)
  // Strategy: Look for company name near the top, before "To" or "Bill To" section

  // Try 1: Look for name right after "TAX INVOICE" or "INVOICE" header
  const afterInvoiceMatch = text.match(/(?:TAX\s*)?INVOICE[\s\n]+([A-Z][A-Z\s&]+?)(?:\n|No\.|GSTIN|Address)/i);
  if (afterInvoiceMatch && afterInvoiceMatch[1] && afterInvoiceMatch[1].trim().length > 2) {
    result.partyName = afterInvoiceMatch[1].trim();
  }

  // Try 2: Look for prominent company name before first GSTIN
  if (!result.partyName && result.gstinVendor) {
    const beforeGstinMatch = text.match(/([A-Z][A-Z\s&]+?)\s*(?:\n|GSTIN|GST\s*(?:IN|No))/i);
    if (beforeGstinMatch && beforeGstinMatch[1] && beforeGstinMatch[1].trim().length > 2) {
      const name = beforeGstinMatch[1].trim();
      // Filter out common header text
      if (!name.match(/^(TAX|INVOICE|ESTIMATE|QUOTATION|BILL|PROFORMA)/i)) {
        result.partyName = name;
      }
    }
  }

  // Try 3: Look for company name on line containing/near GSTIN
  if (!result.partyName && result.gstinVendor) {
    // Find the line with GSTIN and look for company name nearby
    const gstinLineMatch = text.match(/([A-Z][A-Z\s&]+?)\s*[\n\r].*GSTIN\s*:?\s*\d{2}[A-Z]{5}/i);
    if (gstinLineMatch && gstinLineMatch[1]) {
      result.partyName = gstinLineMatch[1].trim();
    }
  }

  // Try 4: M/s pattern (common in Indian invoices) - this finds the BUYER, not seller
  // Only use this as last resort and note it might be the buyer
  if (!result.partyName) {
    const msMatch = text.match(/M\/s\.?\s+([A-Z][A-Z0-9\s&.,]+?)(?:\n|,|\d)/i);
    if (msMatch && msMatch[1]) {
      // This is likely the buyer, but use it if we have nothing else
      result.partyName = msMatch[1].trim();
    }
  }

  // Try 5: Look for "BILL TO" pattern - this finds the BUYER
  if (!result.partyName) {
    const billToMatch = text.match(PATTERNS.billTo);
    if (billToMatch && billToMatch[1]) {
      result.partyName = billToMatch[1].trim();
    }
  }

  // Extract CGST amount - try percentage format first (e.g., "CGST2.5 (2.5%)16.67")
  let cgstMatches = extractAll(text, PATTERNS.cgstWithPct);
  if (cgstMatches.length === 0) {
    cgstMatches = extractAll(text, PATTERNS.cgst);
  }
  if (cgstMatches.length > 0) {
    // Take the largest CGST amount (likely the total)
    const amounts = cgstMatches.map(parseIndianNumber).filter(n => n > 0);
    if (amounts.length > 0) {
      result.cgstAmount = Math.max(...amounts);
    }
  }

  // Extract SGST amount - try percentage format first
  let sgstMatches = extractAll(text, PATTERNS.sgstWithPct);
  if (sgstMatches.length === 0) {
    sgstMatches = extractAll(text, PATTERNS.sgst);
  }
  if (sgstMatches.length > 0) {
    const amounts = sgstMatches.map(parseIndianNumber).filter(n => n > 0);
    if (amounts.length > 0) {
      result.sgstAmount = Math.max(...amounts);
    }
  }

  // Extract IGST amount - try percentage format first, then table format
  let igstMatches = extractAll(text, PATTERNS.igstWithPct);
  if (igstMatches.length === 0) {
    igstMatches = extractAll(text, PATTERNS.igst);
  }
  if (igstMatches.length > 0) {
    const amounts = igstMatches.map(parseIndianNumber).filter(n => n > 0);
    if (amounts.length > 0) {
      result.igstAmount = Math.max(...amounts);
    }
  }

  // If no IGST found, try looking for HSN tax table which often has the breakdown
  if (!result.igstAmount && !result.cgstAmount && !result.sgstAmount) {
    // Check if this document has IGST (interstate) based on place of supply being different from seller state
    const hasIGST = text.match(/\bIGST\b/i) !== null;
    const hasCGSTSGST = text.match(/\bCGST\b/i) !== null || text.match(/\bSGST\b/i) !== null;

    // Try HSN table pattern first: "Total Tax Amount" header followed by totals row
    const hsnTableMatch = text.match(PATTERNS.hsnTaxTable);
    if (hsnTableMatch) {
      const taxableVal = parseIndianNumber(hsnTableMatch[1]);
      const taxVal = parseIndianNumber(hsnTableMatch[2]);
      // const totalTaxVal = parseIndianNumber(hsnTableMatch[3]); // Usually same as taxVal

      if (taxableVal > 0 && taxVal > 0 && taxableVal > taxVal) {
        result.taxableAmount = taxableVal;
        // Determine if IGST or CGST+SGST based on presence in document
        if (hasIGST && !hasCGSTSGST) {
          result.igstAmount = taxVal;
        } else if (hasCGSTSGST && !hasIGST) {
          result.cgstAmount = Math.round(taxVal / 2 * 100) / 100;
          result.sgstAmount = Math.round(taxVal / 2 * 100) / 100;
        } else {
          // Default to IGST if "IGST" column header exists
          result.igstAmount = taxVal;
        }
      }
    }

    // Fallback: Look for any Total row with three amounts
    if (!result.igstAmount && !result.cgstAmount) {
      const totalTaxMatch = text.match(/Total[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)[₹Rs.INR\s]*(\d+(?:,\d+)*(?:\.\d{1,2})?)/i);
      if (totalTaxMatch) {
        const val1 = parseIndianNumber(totalTaxMatch[1]);
        const val2 = parseIndianNumber(totalTaxMatch[2]);
        const val3 = parseIndianNumber(totalTaxMatch[3]);

        // If val2 and val3 are equal and both less than val1, it's likely taxable + tax + tax
        if (val2 === val3 && val1 > val2 && val2 > 0) {
          result.taxableAmount = val1;
          const taxVal = val2;
          if (hasIGST && !hasCGSTSGST) {
            result.igstAmount = taxVal;
          } else if (hasCGSTSGST && !hasIGST) {
            result.cgstAmount = Math.round(taxVal / 2 * 100) / 100;
            result.sgstAmount = Math.round(taxVal / 2 * 100) / 100;
          } else {
            result.igstAmount = taxVal;
          }
        }
      }
    }
  }

  // Calculate total GST
  if (result.cgstAmount || result.sgstAmount || result.igstAmount) {
    result.gstAmount = (result.cgstAmount || 0) + (result.sgstAmount || 0) + (result.igstAmount || 0);
  } else {
    // Try generic GST pattern
    const gstMatches = extractAll(text, PATTERNS.gst);
    if (gstMatches.length > 0) {
      const amounts = gstMatches.map(parseIndianNumber).filter(n => n > 0);
      if (amounts.length > 0) {
        result.gstAmount = Math.max(...amounts);
      }
    }

    // Try tax amount pattern
    if (!result.gstAmount) {
      const taxMatches = extractAll(text, PATTERNS.taxAmount);
      if (taxMatches.length > 0) {
        const amounts = taxMatches.map(parseIndianNumber).filter(n => n > 0);
        if (amounts.length > 0) {
          result.gstAmount = Math.max(...amounts);
        }
      }
    }
  }

  // Extract invoice/estimate number - also try "Inv. No" pattern
  result.invoiceNumber = extractFirst(text, PATTERNS.invoiceNumber);
  if (!result.invoiceNumber) {
    const invNoMatch = text.match(/Inv\.?\s*No\.?\s*:?\s*([A-Z0-9\-\/]+)/i);
    if (invNoMatch) {
      result.invoiceNumber = invNoMatch[1];
    }
  }

  // Extract invoice date
  const dateStr = extractFirst(text, PATTERNS.invoiceDate);
  if (dateStr) {
    result.invoiceDate = normalizeDate(dateStr);
  }

  // Extract total amount - try Grand Total first (more specific)
  const grandTotalMatches = extractAll(text, PATTERNS.grandTotal);
  if (grandTotalMatches.length > 0) {
    const amounts = grandTotalMatches.map(parseIndianNumber).filter(n => n > 0);
    if (amounts.length > 0) {
      result.totalAmount = Math.max(...amounts);
    }
  }
  // Fallback to generic total patterns
  if (!result.totalAmount) {
    const totalMatches = extractAll(text, PATTERNS.totalAmount);
    if (totalMatches.length > 0) {
      const amounts = totalMatches.map(parseIndianNumber).filter(n => n > 0);
      if (amounts.length > 0) {
        result.totalAmount = Math.max(...amounts);
      }
    }
  }

  // Extract taxable amount if not already set
  if (!result.taxableAmount) {
    const taxableMatches = extractAll(text, PATTERNS.taxableAmount);
    if (taxableMatches.length > 0) {
      const amounts = taxableMatches.map(parseIndianNumber).filter(n => n > 0);
      if (amounts.length > 0) {
        result.taxableAmount = Math.max(...amounts);
      }
    }
  }

  // Calculate taxable amount if we have total and GST but no taxable
  if (!result.taxableAmount && result.totalAmount && result.gstAmount) {
    result.taxableAmount = result.totalAmount - result.gstAmount;
  }

  // Fallback: If no amounts found, try to find large numbers that might be totals
  if (!result.totalAmount && !result.gstAmount) {
    // Look for rupee amounts
    const rupeeMatches = extractAll(text, PATTERNS.rupeeAmount);
    if (rupeeMatches.length > 0) {
      const amounts = rupeeMatches.map(parseIndianNumber).filter(n => n > 100);
      if (amounts.length > 0) {
        amounts.sort((a, b) => b - a); // Sort descending
        result.totalAmount = amounts[0]; // Largest is likely grand total
        // If we have at least 3 amounts, try to infer GST
        if (amounts.length >= 3) {
          // Check if two smaller amounts are equal (likely CGST = SGST)
          for (let i = 1; i < amounts.length - 1; i++) {
            if (Math.abs(amounts[i] - amounts[i + 1]) < 1) {
              result.cgstAmount = amounts[i];
              result.sgstAmount = amounts[i + 1];
              result.gstAmount = amounts[i] + amounts[i + 1];
              break;
            }
          }
        }
      }
    }

    // Try finding any 5-digit numbers which might be totals (common in Indian invoices)
    if (!result.totalAmount) {
      const largeNumbers = text.match(/\b(\d{5,})\b/g);
      if (largeNumbers && largeNumbers.length > 0) {
        const amounts = largeNumbers.map(n => parseInt(n, 10)).filter(n => n > 1000);
        if (amounts.length > 0) {
          amounts.sort((a, b) => b - a);
          result.totalAmount = amounts[0];
          console.log('[InvoiceParser] Found large numbers (fallback):', amounts.slice(0, 5));
        }
      }
    }
  }

  // Log all numbers found for debugging
  const allNumbers = text.match(/\d+(?:,\d+)*(?:\.\d+)?/g);
  if (allNumbers) {
    const parsed = allNumbers.map(parseIndianNumber).filter(n => n > 100).sort((a, b) => b - a);
    console.log('[InvoiceParser] Top numbers found:', parsed.slice(0, 10));
  }

  console.log('[InvoiceParser] Extracted GST info:', result);
  return result;
}

/**
 * Extract GST information from PDF buffer
 */
export async function extractGSTFromPDF(filePath: string): Promise<InvoiceGSTInfo> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    const text = data.text;

    console.log('[InvoiceParser] PDF text length:', text.length);
    return extractGSTFromText(text);
  } catch (error) {
    console.error('[InvoiceParser] Error extracting GST from PDF:', error);
    return {
      gstAmount: null,
      cgstAmount: null,
      sgstAmount: null,
      igstAmount: null,
      gstType: 'input',
      gstinVendor: null,
      partyName: null,
      invoiceNumber: null,
      invoiceDate: null,
      totalAmount: null,
      taxableAmount: null,
      documentType: null,
      isEstimate: false,
    };
  }
}

/**
 * Normalize date string to YYYY-MM-DD format
 */
function normalizeDate(dateStr: string): string | null {
  try {
    // Try DD/MM/YYYY or DD-MM-YYYY
    const slashMatch = dateStr.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0');
      const month = slashMatch[2].padStart(2, '0');
      let year = slashMatch[3];
      if (year.length === 2) {
        year = '20' + year;
      }
      return `${year}-${month}-${day}`;
    }

    // Try DD Mon YYYY
    const monthNames: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const textMatch = dateStr.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})/);
    if (textMatch) {
      const day = textMatch[1].padStart(2, '0');
      const monthKey = textMatch[2].toLowerCase().substring(0, 3);
      const month = monthNames[monthKey];
      let year = textMatch[3];
      if (year.length === 2) {
        year = '20' + year;
      }
      if (month) {
        return `${year}-${month}-${day}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract GST info from image using Claude Vision API
 */
export async function extractGSTFromImage(filePath: string): Promise<InvoiceGSTInfo> {
  const emptyResult: InvoiceGSTInfo = {
    gstAmount: null,
    cgstAmount: null,
    sgstAmount: null,
    igstAmount: null,
    gstType: 'input',
    gstinVendor: null,
    partyName: null,
    invoiceNumber: null,
    invoiceDate: null,
    totalAmount: null,
    taxableAmount: null,
    documentType: null,
    isEstimate: false,
  };

  try {
    console.log('[InvoiceParser] Using Claude Vision API for image:', filePath);

    // Check if API key is available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('[InvoiceParser] ANTHROPIC_API_KEY not set, falling back to empty result');
      return emptyResult;
    }

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(filePath);
    const base64Image = imageBuffer.toString('base64');

    // Determine media type from file extension
    const ext = filePath.toLowerCase().split('.').pop();
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
    if (ext === 'png') mediaType = 'image/png';
    else if (ext === 'gif') mediaType = 'image/gif';
    else if (ext === 'webp') mediaType = 'image/webp';

    // Initialize Anthropic client
    const anthropic = new Anthropic({ apiKey });

    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `Extract the following information from this invoice image and return ONLY a JSON object (no markdown, no explanation):

{
  "vendorName": "The seller/vendor company name (who issued the invoice)",
  "gstinVendor": "Vendor's GSTIN number (format: 22AAAAA0000A1Z5)",
  "invoiceNumber": "Invoice number",
  "invoiceDate": "Invoice date in YYYY-MM-DD format",
  "totalAmount": numeric grand total amount,
  "taxableAmount": numeric taxable/subtotal amount before GST,
  "cgstAmount": numeric CGST amount (or null if not applicable),
  "sgstAmount": numeric SGST amount (or null if not applicable),
  "igstAmount": numeric IGST amount (or null if not applicable),
  "documentType": "invoice" or "estimate" or "proforma" or "quotation"
}

Return null for any field you cannot find. Numbers should be plain numbers without currency symbols or commas.`,
            },
          ],
        },
      ],
    });

    // Parse the response
    const content = response.content[0];
    if (content.type !== 'text') {
      console.error('[InvoiceParser] Unexpected response type from Claude');
      return emptyResult;
    }

    console.log('[InvoiceParser] Claude response:', content.text);

    // Extract JSON from response (handle potential markdown formatting)
    let jsonStr = content.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    console.log('[InvoiceParser] Parsed invoice data:', parsed);

    // Map to our result format
    const result: InvoiceGSTInfo = {
      gstAmount: null,
      cgstAmount: parsed.cgstAmount || null,
      sgstAmount: parsed.sgstAmount || null,
      igstAmount: parsed.igstAmount || null,
      gstType: 'input',
      gstinVendor: parsed.gstinVendor || null,
      partyName: parsed.vendorName || null,
      invoiceNumber: parsed.invoiceNumber || null,
      invoiceDate: parsed.invoiceDate || null,
      totalAmount: parsed.totalAmount || null,
      taxableAmount: parsed.taxableAmount || null,
      documentType: parsed.documentType || 'invoice',
      isEstimate: ['estimate', 'proforma', 'quotation'].includes(parsed.documentType?.toLowerCase()),
    };

    // Calculate total GST
    if (result.cgstAmount || result.sgstAmount || result.igstAmount) {
      result.gstAmount = (result.cgstAmount || 0) + (result.sgstAmount || 0) + (result.igstAmount || 0);
    }

    console.log('[InvoiceParser] Final extracted info:', result);
    return result;
  } catch (error) {
    console.error('[InvoiceParser] Error using Claude Vision API:', error);
    return emptyResult;
  }
}

/**
 * Extract GST info based on file type
 */
export async function extractGSTInfo(filePath: string, mimeType: string): Promise<InvoiceGSTInfo> {
  if (mimeType === 'application/pdf') {
    return extractGSTFromPDF(filePath);
  } else if (mimeType.startsWith('image/')) {
    return extractGSTFromImage(filePath);
  }

  return {
    gstAmount: null,
    cgstAmount: null,
    sgstAmount: null,
    igstAmount: null,
    gstType: 'input',
    gstinVendor: null,
    partyName: null,
    invoiceNumber: null,
    invoiceDate: null,
    totalAmount: null,
    taxableAmount: null,
    documentType: null,
    isEstimate: false,
  };
}
