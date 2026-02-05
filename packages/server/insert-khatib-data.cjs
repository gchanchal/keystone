const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../../data/finsync.db'));
const now = new Date().toISOString();

// 1. Create Khatib - Personal loan
const personalLoanId = uuidv4();
db.prepare(`
  INSERT INTO loans (id, type, party_name, principal_amount, outstanding_amount, start_date, status, notes, created_at, updated_at)
  VALUES (?, 'given', 'Khatib - Personal', 2922000, 1642000, '2022-01-01', 'active', 'Personal transactions with Khatib. Net = To Get (29,22,000) - To Give (12,80,000) = 16,42,000', ?, ?)
`).run(personalLoanId, now, now);

// Personal transactions from the Excel data
const personalTransactions = [
  { desc: 'Khatib - Starting amount (originally 6.5L, 5L written off)', amount: 350000, type: 'disbursement', date: '2022-01-01', notes: 'was originally 7 lakh. Wrote off 5 lakh. Khatib transfered 50k while I was in US.' },
  { desc: 'Khatib - Car (i20)', amount: 180000, type: 'disbursement', date: '2022-01-01', notes: 'i20 Car amount - 230000 - 50k paid in advance' },
  { desc: 'Khatib deposit with me', amount: 80000, type: 'repayment', date: '2022-01-01', notes: 'Sent 1 lakh to me, 20k were pending with him from Imran payment' },
  { desc: 'Imran payment for 15th Oct', amount: 700000, type: 'disbursement', date: '2022-10-15', notes: '50lakh - 3 month + 40 lakh 1 month. 10 lakh came, split into 7:3' },
  { desc: 'Paid for Plot at Neelmangla', amount: 400000, type: 'disbursement', date: '2022-12-01', notes: '' },
  { desc: 'Money to be paid for Plot', amount: 1000000, type: 'repayment', date: '2023-01-01', notes: 'Rupees Ten Lakh Only' },
  { desc: 'Khatib Paid on 22nd Dec 2023', amount: 200000, type: 'repayment', date: '2023-12-22', notes: 'Khatib transfered 9 lakh (out of 10 lakh) from Dec payment from Imran. My share was 7 lakh' },
  { desc: 'Paid 1 lakh to khatib (50 + 50)', amount: 100000, type: 'disbursement', date: '2024-01-09', notes: '31st Dec and 9th Jan' },
  { desc: 'Paid 25k again', amount: 25000, type: 'disbursement', date: '2024-01-25', notes: '25th Jan' },
  { desc: 'Paid 20k', amount: 20000, type: 'disbursement', date: '2024-03-18', notes: '18th march' },
  { desc: 'Paid 50k', amount: 50000, type: 'disbursement', date: '2024-06-26', notes: '' },
  { desc: 'Paid 10k', amount: 10000, type: 'disbursement', date: '2024-07-20', notes: '' },
  { desc: 'Recieved 50k', amount: 50000, type: 'repayment', date: '2024-07-07', notes: 'verified' },
  { desc: 'Paid 2.5 lac for house deposit', amount: 250000, type: 'disbursement', date: '2024-08-01', notes: '1st Aug - for house deposit. verified' },
  { desc: 'Paid 50k', amount: 50000, type: 'disbursement', date: '2024-08-23', notes: '23rd Aug. verified' },
  { desc: 'Paid 50k', amount: 50000, type: 'disbursement', date: '2024-09-19', notes: '19th Sept' },
  { desc: 'Recieved 50k', amount: 50000, type: 'repayment', date: '2024-09-28', notes: 'verified' },
  { desc: 'Paid 50k', amount: 50000, type: 'disbursement', date: '2024-10-02', notes: 'verified' },
  { desc: 'Paid 50k - Prasad Kulkarni', amount: 50000, type: 'disbursement', date: '2024-10-21', notes: 'verified' },
  { desc: 'Recieved 50k', amount: 50000, type: 'repayment', date: '2024-10-21', notes: 'verified' },
  { desc: 'Paid 50k', amount: 50000, type: 'disbursement', date: '2024-10-30', notes: 'verified. All cleared uptil now - 15 dec. Amount pending 965000' },
  { desc: 'Paid 60k for Dubai', amount: 60000, type: 'disbursement', date: '2024-12-12', notes: '' },
  { desc: 'Transfered 1 lakh - For Umar', amount: 100000, type: 'disbursement', date: '2025-05-03', notes: 'For Umar' },
  { desc: 'Transfered 1.5 lakh - For MoU', amount: 150000, type: 'disbursement', date: '2025-05-30', notes: 'For MoU' },
  { desc: 'Transfered 50k - for Sudharshan', amount: 50000, type: 'disbursement', date: '2025-09-24', notes: 'for Sudharshan' },
  { desc: 'Transfered 50k - For current account opening', amount: 50000, type: 'disbursement', date: '2025-11-21', notes: 'For current account opening' },
  { desc: 'Transfered 22k - For current account opening', amount: 22000, type: 'disbursement', date: '2025-11-26', notes: 'For current account opening' },
  { desc: 'Transfered 45k - For Home loan', amount: 45000, type: 'disbursement', date: '2025-11-30', notes: 'For Home loan' },
  { desc: 'Transfered 2 lakh - For PWD License', amount: 200000, type: 'disbursement', date: '2025-12-26', notes: 'For PWD License' },
  { desc: 'Transfered 5k - Temp', amount: 5000, type: 'disbursement', date: '2025-12-27', notes: 'Temp' },
  { desc: 'Hospital - on Credit Card', amount: 50000, type: 'disbursement', date: '2026-01-05', notes: 'on Credit Card' },
  { desc: 'GST for A5 builder - on Credit Card', amount: 5000, type: 'disbursement', date: '2026-01-22', notes: 'on Credit Card' },
];

const insertPayment = db.prepare(`
  INSERT INTO loan_payments (id, loan_id, date, transaction_type, particulars, amount, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

personalTransactions.forEach(t => {
  insertPayment.run(uuidv4(), personalLoanId, t.date, t.type, t.desc, t.amount, t.notes, now);
});

console.log('Created Khatib - Personal:', personalLoanId);

// 2. Create Khatib - Asgar loan
const asgarLoanId = uuidv4();
db.prepare(`
  INSERT INTO loans (id, type, party_name, principal_amount, outstanding_amount, interest_rate, start_date, status, notes, created_at, updated_at)
  VALUES (?, 'given', 'Khatib - Asgar', 11500000, 17900000, 12, '2024-02-01', 'active', 'Asgar related transactions - 90L + 25L principal with 12% interest. Khatib Share: 25.2L', ?, ?)
`).run(asgarLoanId, now, now);

// Asgar transactions
const asgarTransactions = [
  { desc: 'Principal - 90 Lakh', amount: 9000000, type: 'disbursement', date: '2024-02-01', notes: 'Initial principal' },
  { desc: 'Principal - 25 Lakh', amount: 2500000, type: 'disbursement', date: '2024-03-21', notes: 'Additional principal' },
  { desc: 'Received 20 Lakh', amount: 2000000, type: 'repayment', date: '2024-05-20', notes: 'Partial repayment' },
];

asgarTransactions.forEach(t => {
  insertPayment.run(uuidv4(), asgarLoanId, t.date, t.type, t.desc, t.amount, t.notes, now);
});

console.log('Created Khatib - Asgar:', asgarLoanId);

// 3. Create Khatib - College loan
const collegeLoanId = uuidv4();
db.prepare(`
  INSERT INTO loans (id, type, party_name, principal_amount, outstanding_amount, start_date, status, notes, created_at, updated_at)
  VALUES (?, 'given', 'Khatib - College', 5800000, 2000000, '2025-01-15', 'active', 'College related transactions. Total: 58L, Paid: 38L, Pending: 20L', ?, ?)
`).run(collegeLoanId, now, now);

// College transactions
const collegeTransactions = [
  { desc: 'College 1', amount: 2500000, type: 'disbursement', date: '2025-01-15', notes: 'Rupees Twenty Five Lakh Only' },
  { desc: 'College 2', amount: 550000, type: 'disbursement', date: '2025-01-16', notes: 'Rupees Five Lakh,fifty Thousand Only' },
  { desc: 'College 3', amount: 1350000, type: 'disbursement', date: '2025-02-22', notes: '9 + 3.5 cash' },
  { desc: 'Additional', amount: 150000, type: 'disbursement', date: '2025-02-26', notes: '' },
  { desc: 'Additional money', amount: 1250000, type: 'disbursement', date: '2025-03-01', notes: 'Rupees Twelve Lakh,fifty Thousand Only' },
  { desc: 'Paid Already', amount: 2700000, type: 'repayment', date: '2025-04-01', notes: 'Apr 1st, 2025' },
  { desc: 'Paid 11 lakh', amount: 1100000, type: 'repayment', date: '2025-07-16', notes: 'Paid on 16th July 8 lakh and 3 lakh on 17th July -> 5 lakh out of this is paid to Neelmangla property' },
];

collegeTransactions.forEach(t => {
  insertPayment.run(uuidv4(), collegeLoanId, t.date, t.type, t.desc, t.amount, t.notes, now);
});

console.log('Created Khatib - College:', collegeLoanId);

console.log('\nDone! All 3 loans created with transactions.');
console.log('Summary:');
console.log('- Khatib - Personal: Outstanding ₹16,42,000');
console.log('- Khatib - Asgar: Outstanding ₹1,79,00,000');
console.log('- Khatib - College: Outstanding ₹20,00,000');
