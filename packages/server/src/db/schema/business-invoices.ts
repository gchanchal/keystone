import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';

export const businessInvoices = sqliteTable('business_invoices', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  transactionId: text('transaction_id'), // NULL for external invoices
  filename: text('filename'),
  originalName: text('original_name'),
  mimeType: text('mime_type'),
  size: integer('size'),
  invoiceDate: text('invoice_date'),
  invoiceNumber: text('invoice_number'),
  // Party details
  partyName: text('party_name'), // Vendor (for input) or Customer (for output)
  partyGstin: text('party_gstin'),
  // GST details
  gstType: text('gst_type'), // 'input' or 'output'
  taxableAmount: real('taxable_amount'),
  cgstAmount: real('cgst_amount'),
  sgstAmount: real('sgst_amount'),
  igstAmount: real('igst_amount'),
  gstAmount: real('gst_amount'), // Total GST = CGST + SGST + IGST
  totalAmount: real('total_amount'), // Grand total including GST
  // Legacy field - keep for backward compatibility
  vendorName: text('vendor_name'),
  notes: text('notes'),
  // Document type detection
  documentType: text('document_type'), // 'invoice', 'estimate', 'proforma', 'quotation'
  isEstimate: integer('is_estimate').default(0), // 1 if estimate/proforma/quotation
  updatedByEmail: text('updated_by_email'), // Email of user who last updated (for team tracking)
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

export type BusinessInvoice = typeof businessInvoices.$inferSelect;
export type NewBusinessInvoice = typeof businessInvoices.$inferInsert;
