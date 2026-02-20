import { db } from '../db/index.js';
import { bankTransactions, vyaparTransactions, reconciliationMatches, reconciliationRules, creditCardTransactions } from '../db/index.js';
import { eq, and, between, sql, inArray, desc } from 'drizzle-orm';
import { addDays, subDays, parseISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

// Helper: Check if a transaction ID belongs to credit_card_transactions table
async function findCCTransaction(id: string) {
  const [ccTxn] = await db
    .select()
    .from(creditCardTransactions)
    .where(eq(creditCardTransactions.id, id))
    .limit(1);
  return ccTxn || null;
}

// Helper: Mark a bank or CC transaction as reconciled
async function markReconciled(
  txnId: string,
  reconciledWithId: string,
  reconciledWithType: string,
  now: string
) {
  // Try bank first
  const [bankTxn] = await db
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(eq(bankTransactions.id, txnId))
    .limit(1);

  if (bankTxn) {
    await db
      .update(bankTransactions)
      .set({
        isReconciled: true,
        reconciledWithId,
        reconciledWithType,
        purpose: 'business',
        updatedAt: now,
      })
      .where(eq(bankTransactions.id, txnId));
    return 'bank';
  }

  // Try credit card
  await db
    .update(creditCardTransactions)
    .set({
      isReconciled: true,
      reconciledWithId,
      updatedAt: now,
    })
    .where(eq(creditCardTransactions.id, txnId));
  return 'credit_card';
}

// Helper: Clear reconciliation on a bank or CC transaction
async function clearReconciled(txnId: string, now: string) {
  const [bankTxn] = await db
    .select({ id: bankTransactions.id })
    .from(bankTransactions)
    .where(eq(bankTransactions.id, txnId))
    .limit(1);

  if (bankTxn) {
    await db
      .update(bankTransactions)
      .set({
        isReconciled: false,
        reconciledWithId: null,
        reconciledWithType: null,
        updatedAt: now,
      })
      .where(eq(bankTransactions.id, txnId));
    return;
  }

  await db
    .update(creditCardTransactions)
    .set({
      isReconciled: false,
      reconciledWithId: null,
      updatedAt: now,
    })
    .where(eq(creditCardTransactions.id, txnId));
}

// Normalize a credit card transaction to bank-like shape for reconciliation
export function normalizeCCTransaction(cc: any): any {
  return {
    ...cc,
    narration: cc.description,
    reference: null,
    balance: null,
    valueDate: null,
    purpose: null,
    bizType: null,
    bizDescription: null,
    vendorName: null,
    needsInvoice: false,
    invoiceFileId: null,
    gstAmount: null,
    cgstAmount: null,
    sgstAmount: null,
    igstAmount: null,
    gstType: null,
    updatedByEmail: null,
    source: 'credit_card',
  };
}

export interface ReconciliationMatch {
  bankTransactionId: string;
  vyaparTransactionId: string;
  confidence: number;
  matchType: 'exact' | 'date_fuzzy' | 'party_fuzzy';
  bankAmount: number;
  vyaparAmount: number;
  bankDate: string;
  vyaparDate: string;
}

// Calculate string similarity (Levenshtein-based)
function similarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(s1: string, s2: string): number {
  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

// Extract party name from narration
function extractPartyName(narration: string): string {
  // Common patterns in bank narrations
  const patterns = [
    /UPI[-\/]([^\/]+)\//, // UPI-PartyName/
    /NEFT[-\/][^\/]+\/([^\/]+)/, // NEFT-RefNo/PartyName
    /RTGS[-\/][^\/]+\/([^\/]+)/, // RTGS-RefNo/PartyName
    /IMPS[-\/][^\/]+\/([^\/]+)/, // IMPS-RefNo/PartyName
    /(?:TO|FROM)\s+([A-Z][A-Za-z\s]+)/, // TO/FROM PartyName
    /(?:BY|ATM)\s+([A-Z][A-Za-z\s]+)/, // BY PartyName
  ];

  for (const pattern of patterns) {
    const match = narration.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return narration;
}

// Extract bank pattern with type for rule storage
function extractBankPattern(narration: string): { type: string; value: string } | null {
  if (!narration) return null;
  const upper = narration.toUpperCase();

  // UPI pattern
  const upiMatch = upper.match(/UPI[-\/]([^\/]+)\//);
  if (upiMatch) {
    return { type: 'upi_name', value: upiMatch[1].trim() };
  }

  // NEFT pattern
  const neftMatch = upper.match(/NEFT[-\/][^\/]+\/([^\/]+)/);
  if (neftMatch) {
    return { type: 'neft_name', value: neftMatch[1].trim() };
  }

  // RTGS pattern
  const rtgsMatch = upper.match(/RTGS[-\/][^\/]+\/([^\/]+)/);
  if (rtgsMatch) {
    return { type: 'rtgs_name', value: rtgsMatch[1].trim() };
  }

  // IMPS pattern
  const impsMatch = upper.match(/IMPS[-\/][^\/]+\/([^\/]+)/);
  if (impsMatch) {
    return { type: 'imps_name', value: impsMatch[1].trim() };
  }

  return null;
}

// Check if amounts match (with small tolerance for rounding)
// Uses absolute values to handle both positive and negative amount storage
function amountsMatch(amount1: number, amount2: number, tolerance = 0.01): boolean {
  return Math.abs(Math.abs(amount1) - Math.abs(amount2)) <= tolerance;
}

// Check if bank transaction type and vyapar transaction type are directionally compatible
// Bank credit (money in) should match with Vyapar Sale (money in)
// Bank debit (money out) should match with Vyapar Expense/Purchase/Payment-Out (money out)
function areDirectionsCompatible(bankTxnType: string, vyaparTxnType: string): boolean {
  const bankIsCredit = bankTxnType === 'credit'; // Money coming in
  const vyaparIsIncoming = vyaparTxnType === 'Sale'; // Sale = money coming in
  const vyaparIsOutgoing = ['Expense', 'Purchase', 'Payment-Out'].includes(vyaparTxnType); // Money going out

  // Credit (money in) should match with Sale (money in)
  if (bankIsCredit && vyaparIsIncoming) return true;
  // Debit (money out) should match with Expense/Purchase/Payment-Out (money out)
  if (!bankIsCredit && vyaparIsOutgoing) return true;

  return false;
}

// Check if dates are within range
function datesWithinRange(date1: string, date2: string, days: number): boolean {
  const d1 = parseISO(date1);
  const d2 = parseISO(date2);
  const start = subDays(d1, days);
  const end = addDays(d1, days);
  return d2 >= start && d2 <= end;
}

export async function autoReconcile(
  startDate: string,
  endDate: string,
  accountIds?: string[],
  userId?: string
): Promise<ReconciliationMatch[]> {
  const matches: ReconciliationMatch[] = [];

  // Get unreconciled bank transactions (isReconciled = false, 0, or null)
  const bankConditions = [
    sql`(${bankTransactions.isReconciled} = 0 OR ${bankTransactions.isReconciled} IS NULL OR ${bankTransactions.isReconciled} = false)`,
    between(bankTransactions.date, startDate, endDate),
    sql`(${bankTransactions.purpose} IS NULL OR ${bankTransactions.purpose} != 'personal')`, // Exclude personal
  ];
  if (userId) {
    bankConditions.push(eq(bankTransactions.userId, userId));
  }

  const bankTxns: any[] = await db
    .select()
    .from(bankTransactions)
    .where(and(...bankConditions));

  // Also fetch unreconciled credit card transactions and merge (exclude Gmail-synced)
  const ccConditions = [
    sql`(${creditCardTransactions.isReconciled} = 0 OR ${creditCardTransactions.isReconciled} IS NULL OR ${creditCardTransactions.isReconciled} = false)`,
    between(creditCardTransactions.date, startDate, endDate),
    sql`(${creditCardTransactions.source} IS NULL OR ${creditCardTransactions.source} != 'gmail')`,
  ];
  if (userId) {
    ccConditions.push(eq(creditCardTransactions.userId, userId));
  }

  const ccTxns = await db
    .select()
    .from(creditCardTransactions)
    .where(and(...ccConditions));

  // Normalize CC transactions and merge into bank array
  for (const cc of ccTxns) {
    bankTxns.push(normalizeCCTransaction(cc));
  }

  // Get unreconciled vyapar transactions (isReconciled = false, 0, or null)
  // Exclude:
  // - Payment Type "Gaurav" (internal transfers)
  // - Transaction Type "Sale Order" (pending payment - not reconcilable until payment received)
  // - Transaction Type "Payment-In" (doesn't need bank reconciliation)
  // Only include: Sale, Purchase, Payment-Out, Expense
  const vyaparConditions = [
    sql`(${vyaparTransactions.isReconciled} = 0 OR ${vyaparTransactions.isReconciled} IS NULL OR ${vyaparTransactions.isReconciled} = false)`,
    between(vyaparTransactions.date, startDate, endDate),
    sql`${vyaparTransactions.transactionType} NOT IN ('Sale Order', 'Payment-In')`,
  ];
  if (userId) {
    vyaparConditions.push(eq(vyaparTransactions.userId, userId));
  }

  const vyaparTxns = await db
    .select()
    .from(vyaparTransactions)
    .where(and(...vyaparConditions));

  // Filter bank transactions by account if specified
  const filteredBankTxns = accountIds?.length
    ? bankTxns.filter(t => accountIds.includes(t.accountId))
    : bankTxns;

  // Load learned reconciliation rules
  const learnedRules = userId
    ? await db
        .select()
        .from(reconciliationRules)
        .where(and(eq(reconciliationRules.userId, userId), eq(reconciliationRules.isActive, 1)))
        .orderBy(desc(reconciliationRules.priority), desc(reconciliationRules.matchCount))
    : [];

  // Build lookup map: bankPattern -> vyaparPartyName
  const ruleMap = new Map<string, { partyName: string; ruleId: string }>();
  for (const rule of learnedRules) {
    const key = `${rule.bankPatternType}:${rule.bankPatternValue}`;
    if (!ruleMap.has(key)) {
      ruleMap.set(key, { partyName: rule.vyaparPartyName, ruleId: rule.id });
    }
  }

  console.log(`[AutoReconcile] Loaded ${learnedRules.length} learned rules`);
  console.log(`[AutoReconcile] Processing ${filteredBankTxns.length} bank txns, ${vyaparTxns.length} vyapar txns`);
  console.log(`[AutoReconcile] Date range: ${startDate} to ${endDate}`);

  // Debug: Log a few sample transactions
  if (filteredBankTxns.length > 0) {
    console.log(`[AutoReconcile] Sample bank txn: ${filteredBankTxns[0].date}, ${filteredBankTxns[0].amount}, ${filteredBankTxns[0].transactionType}`);
  }
  if (vyaparTxns.length > 0) {
    console.log(`[AutoReconcile] Sample vyapar txn: ${vyaparTxns[0].date}, ${vyaparTxns[0].amount}, ${vyaparTxns[0].transactionType}`);
  }

  // Create sets to track matched transactions
  const matchedBankIds = new Set<string>();
  const matchedVyaparIds = new Set<string>();
  const usedRuleIds = new Set<string>();

  // Priority 0: Learned rules - match bank pattern to vyapar party name + direction compatible
  if (ruleMap.size > 0) {
    for (const bankTxn of filteredBankTxns) {
      if (matchedBankIds.has(bankTxn.id)) continue;

      const pattern = extractBankPattern(bankTxn.narration);
      if (!pattern) continue;

      const key = `${pattern.type}:${pattern.value}`;
      const rule = ruleMap.get(key);
      if (!rule) continue;

      // Find vyapar transaction with matching party name and amount
      for (const vyaparTxn of vyaparTxns) {
        if (matchedVyaparIds.has(vyaparTxn.id)) continue;
        if (!vyaparTxn.partyName) continue;

        // Check if party name matches, amount matches, and directions are compatible
        if (
          vyaparTxn.partyName.toUpperCase() === rule.partyName.toUpperCase() &&
          amountsMatch(bankTxn.amount, vyaparTxn.amount) &&
          datesWithinRange(bankTxn.date, vyaparTxn.date, 7) && // Within 7 days
          areDirectionsCompatible(bankTxn.transactionType, vyaparTxn.transactionType)
        ) {
          matches.push({
            bankTransactionId: bankTxn.id,
            vyaparTransactionId: vyaparTxn.id,
            confidence: 98, // High confidence for learned rules
            matchType: 'exact',
            bankAmount: Math.abs(bankTxn.amount),
            vyaparAmount: Math.abs(vyaparTxn.amount),
            bankDate: bankTxn.date,
            vyaparDate: vyaparTxn.date,
          });
          matchedBankIds.add(bankTxn.id);
          matchedVyaparIds.add(vyaparTxn.id);
          usedRuleIds.add(rule.ruleId);
          break;
        }
      }
    }
    console.log(`[AutoReconcile] Matched ${usedRuleIds.size} using learned rules`);
  }

  // Priority 1: Exact amount + same date + direction compatible
  for (const bankTxn of filteredBankTxns) {
    if (matchedBankIds.has(bankTxn.id)) continue;

    for (const vyaparTxn of vyaparTxns) {
      if (matchedVyaparIds.has(vyaparTxn.id)) continue;

      if (
        amountsMatch(bankTxn.amount, vyaparTxn.amount) &&
        bankTxn.date === vyaparTxn.date &&
        areDirectionsCompatible(bankTxn.transactionType, vyaparTxn.transactionType)
      ) {
        matches.push({
          bankTransactionId: bankTxn.id,
          vyaparTransactionId: vyaparTxn.id,
          confidence: 100,
          matchType: 'exact',
          bankAmount: Math.abs(bankTxn.amount),
          vyaparAmount: Math.abs(vyaparTxn.amount),
          bankDate: bankTxn.date,
          vyaparDate: vyaparTxn.date,
        });
        matchedBankIds.add(bankTxn.id);
        matchedVyaparIds.add(vyaparTxn.id);
        break;
      }
    }
  }

  // Priority 2: Exact amount + date within ±7 days + direction compatible
  for (const bankTxn of filteredBankTxns) {
    if (matchedBankIds.has(bankTxn.id)) continue;

    for (const vyaparTxn of vyaparTxns) {
      if (matchedVyaparIds.has(vyaparTxn.id)) continue;

      if (
        amountsMatch(bankTxn.amount, vyaparTxn.amount) &&
        datesWithinRange(bankTxn.date, vyaparTxn.date, 7) &&
        areDirectionsCompatible(bankTxn.transactionType, vyaparTxn.transactionType)
      ) {
        const dayDiff = Math.abs(
          (parseISO(bankTxn.date).getTime() - parseISO(vyaparTxn.date).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        // Confidence: 95% for 1 day diff, down to 75% for 7 days
        const confidence = Math.max(75, 95 - dayDiff * 3);

        matches.push({
          bankTransactionId: bankTxn.id,
          vyaparTransactionId: vyaparTxn.id,
          confidence,
          matchType: 'date_fuzzy',
          bankAmount: Math.abs(bankTxn.amount),
          vyaparAmount: Math.abs(vyaparTxn.amount),
          bankDate: bankTxn.date,
          vyaparDate: vyaparTxn.date,
        });
        matchedBankIds.add(bankTxn.id);
        matchedVyaparIds.add(vyaparTxn.id);
        break;
      }
    }
  }

  // Priority 3: Amount match + party name fuzzy match > 80% + direction compatible
  for (const bankTxn of filteredBankTxns) {
    if (matchedBankIds.has(bankTxn.id)) continue;

    const bankParty = extractPartyName(bankTxn.narration);

    for (const vyaparTxn of vyaparTxns) {
      if (matchedVyaparIds.has(vyaparTxn.id)) continue;

      if (!vyaparTxn.partyName) continue;

      if (
        amountsMatch(bankTxn.amount, vyaparTxn.amount) &&
        areDirectionsCompatible(bankTxn.transactionType, vyaparTxn.transactionType)
      ) {
        const partySimilarity = similarity(bankParty, vyaparTxn.partyName);

        if (partySimilarity > 0.8) {
          matches.push({
            bankTransactionId: bankTxn.id,
            vyaparTransactionId: vyaparTxn.id,
            confidence: Math.round(partySimilarity * 60 + 20),
            matchType: 'party_fuzzy',
            bankAmount: Math.abs(bankTxn.amount),
            vyaparAmount: Math.abs(vyaparTxn.amount),
            bankDate: bankTxn.date,
            vyaparDate: vyaparTxn.date,
          });
          matchedBankIds.add(bankTxn.id);
          matchedVyaparIds.add(vyaparTxn.id);
          break;
        }
      }
    }
  }

  console.log(`[AutoReconcile] Total matches found: ${matches.length}`);
  return matches;
}

export async function applyMatches(matches: ReconciliationMatch[]): Promise<number> {
  let appliedCount = 0;
  const now = new Date().toISOString();

  for (const match of matches) {
    // Fetch bank transaction (or CC transaction) to get fingerprint data
    let bankTxn = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, match.bankTransactionId))
      .limit(1);

    let isCCTxn = false;
    let txnData: any = bankTxn[0];

    if (!txnData) {
      // Check if it's a credit card transaction
      const ccTxn = await findCCTransaction(match.bankTransactionId);
      if (!ccTxn) continue;
      txnData = ccTxn;
      isCCTxn = true;
    }

    // Update bank or CC transaction as reconciled
    await markReconciled(match.bankTransactionId, match.vyaparTransactionId, 'vyapar', now);

    // Update vyapar transaction with fingerprint for auto-restore
    const narration = isCCTxn ? txnData.description : txnData.narration;
    await db
      .update(vyaparTransactions)
      .set({
        isReconciled: true,
        reconciledWithId: match.bankTransactionId,
        matchedBankDate: txnData.date,
        matchedBankAmount: txnData.amount,
        matchedBankNarration: narration?.substring(0, 100),
        matchedBankAccountId: txnData.accountId,
        updatedAt: now,
      })
      .where(eq(vyaparTransactions.id, match.vyaparTransactionId));

    appliedCount++;
  }

  return appliedCount;
}

export async function manualMatch(
  bankTransactionId: string,
  vyaparTransactionId: string,
  userId?: string
): Promise<boolean> {
  const now = new Date().toISOString();

  // Fetch bank transaction (or CC transaction) to get fingerprint data
  let txnData: any = null;
  let isCCTxn = false;

  const bankTxn = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, bankTransactionId))
    .limit(1);

  if (bankTxn[0]) {
    txnData = bankTxn[0];
  } else {
    const ccTxn = await findCCTransaction(bankTransactionId);
    if (!ccTxn) return false;
    txnData = ccTxn;
    isCCTxn = true;
  }

  // Fetch vyapar transaction to get party name
  const vyaparTxn = await db
    .select()
    .from(vyaparTransactions)
    .where(eq(vyaparTransactions.id, vyaparTransactionId))
    .limit(1);

  // Update bank or CC transaction as reconciled
  await markReconciled(bankTransactionId, vyaparTransactionId, 'vyapar', now);

  const narration = isCCTxn ? txnData.description : txnData.narration;
  await db
    .update(vyaparTransactions)
    .set({
      isReconciled: true,
      reconciledWithId: bankTransactionId,
      matchedBankDate: txnData.date,
      matchedBankAmount: txnData.amount,
      matchedBankNarration: narration?.substring(0, 100),
      matchedBankAccountId: txnData.accountId,
      updatedAt: now,
    })
    .where(eq(vyaparTransactions.id, vyaparTransactionId));

  // Save reconciliation rule for future auto-matching (bank transactions only, not CC)
  const effectiveUserId = userId || txnData.userId;
  if (!isCCTxn && effectiveUserId && vyaparTxn[0]?.partyName) {
    const pattern = extractBankPattern(txnData.narration);
    if (pattern) {
      // Check if rule already exists
      const [existingRule] = await db
        .select()
        .from(reconciliationRules)
        .where(
          and(
            eq(reconciliationRules.userId, effectiveUserId),
            eq(reconciliationRules.bankPatternType, pattern.type),
            eq(reconciliationRules.bankPatternValue, pattern.value)
          )
        )
        .limit(1);

      if (existingRule) {
        // Update existing rule
        await db
          .update(reconciliationRules)
          .set({
            vyaparPartyName: vyaparTxn[0].partyName,
            matchCount: (existingRule.matchCount || 0) + 1,
            updatedAt: now,
          })
          .where(eq(reconciliationRules.id, existingRule.id));
      } else {
        // Create new rule
        await db.insert(reconciliationRules).values({
          id: uuidv4(),
          userId: effectiveUserId,
          bankPatternType: pattern.type,
          bankPatternValue: pattern.value,
          vyaparPartyName: vyaparTxn[0].partyName,
          matchCount: 1,
          priority: 10, // Manual matches have higher priority
          isActive: 1,
          createdAt: now,
        });
      }
    }
  }

  return true;
}

export async function unmatch(bankTransactionId: string): Promise<boolean> {
  const now = new Date().toISOString();

  // Check bank transactions first, then credit card transactions
  let txnData: any = null;
  const bankTxn = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, bankTransactionId))
    .limit(1);

  if (bankTxn[0]) {
    txnData = bankTxn[0];
  } else {
    const ccTxn = await findCCTransaction(bankTransactionId);
    if (!ccTxn) return false;
    txnData = ccTxn;
  }

  // Check if it's part of a match group
  const matchRecord = await db
    .select()
    .from(reconciliationMatches)
    .where(eq(reconciliationMatches.bankTransactionId, bankTransactionId))
    .limit(1);

  if (matchRecord[0]) {
    // Unmatch entire group
    return unmatchGroup(matchRecord[0].matchGroupId);
  }

  // Not in match group - could be legacy single match or multi-match without match record
  const reconciledWithId = txnData.reconciledWithId;

  // Clear reconciliation on the bank/CC transaction
  await clearReconciled(bankTransactionId, now);

  // Try multiple strategies to find and update the matched vyapar transaction(s)

  // Strategy 1: Direct ID match (legacy 1:1 match where reconciledWithId is vyapar ID)
  if (reconciledWithId) {
    await db
      .update(vyaparTransactions)
      .set({
        isReconciled: false,
        reconciledWithId: null,
        updatedAt: now,
      })
      .where(eq(vyaparTransactions.id, reconciledWithId));
  }

  // Strategy 2: Find vyapar transactions that reference this bank transaction ID
  await db
    .update(vyaparTransactions)
    .set({
      isReconciled: false,
      reconciledWithId: null,
      updatedAt: now,
    })
    .where(eq(vyaparTransactions.reconciledWithId, bankTransactionId));

  // Strategy 3: If reconciledWithId was a matchGroupId, find vyapar transactions with that group ID
  if (reconciledWithId && txnData.reconciledWithType === 'multi_vyapar') {
    await db
      .update(vyaparTransactions)
      .set({
        isReconciled: false,
        reconciledWithId: null,
        updatedAt: now,
      })
      .where(eq(vyaparTransactions.reconciledWithId, reconciledWithId));

    // Also clean up any orphaned match records for this group
    await db
      .delete(reconciliationMatches)
      .where(eq(reconciliationMatches.matchGroupId, reconciledWithId));
  }

  return true;
}

// Many-to-many matching: Multiple bank transactions to multiple vyapar transactions
export async function multiMatch(
  bankTransactionIds: string[],
  vyaparTransactionIds: string[]
): Promise<{ success: boolean; matchGroupId: string }> {
  const now = new Date().toISOString();
  const matchGroupId = uuidv4();

  // Fetch all bank transactions for fingerprinting (check both tables)
  const bankTxns: any[] = await db
    .select()
    .from(bankTransactions)
    .where(inArray(bankTransactions.id, bankTransactionIds));

  // Also check credit card transactions for any IDs not found in bank
  const foundBankIds = new Set(bankTxns.map(t => t.id));
  const missingIds = bankTransactionIds.filter(id => !foundBankIds.has(id));
  if (missingIds.length > 0) {
    const ccTxns = await db
      .select()
      .from(creditCardTransactions)
      .where(inArray(creditCardTransactions.id, missingIds));
    for (const cc of ccTxns) {
      bankTxns.push(normalizeCCTransaction(cc));
    }
  }

  // Use first transaction for fingerprint (representative of the group)
  const primaryBankTxn = bankTxns[0];

  // Create match records for all transactions in this group
  for (const bankId of bankTransactionIds) {
    await db.insert(reconciliationMatches).values({
      id: uuidv4(),
      matchGroupId,
      bankTransactionId: bankId,
      vyaparTransactionId: null,
      createdAt: now,
    });

    // Mark bank or CC transaction as reconciled
    await markReconciled(bankId, matchGroupId, 'multi_vyapar', now);
  }

  const narration = primaryBankTxn?.narration || primaryBankTxn?.description;
  for (const vyaparId of vyaparTransactionIds) {
    await db.insert(reconciliationMatches).values({
      id: uuidv4(),
      matchGroupId,
      bankTransactionId: null,
      vyaparTransactionId: vyaparId,
      createdAt: now,
    });

    // Mark vyapar transaction as reconciled with fingerprint for auto-restore
    await db
      .update(vyaparTransactions)
      .set({
        isReconciled: true,
        reconciledWithId: matchGroupId,
        matchedBankDate: primaryBankTxn?.date,
        matchedBankAmount: primaryBankTxn?.amount,
        matchedBankNarration: narration?.substring(0, 100),
        matchedBankAccountId: primaryBankTxn?.accountId,
        updatedAt: now,
      })
      .where(eq(vyaparTransactions.id, vyaparId));
  }

  return { success: true, matchGroupId };
}

// Unmatch an entire group
export async function unmatchGroup(matchGroupId: string): Promise<boolean> {
  const now = new Date().toISOString();

  // Get all match records in this group
  const matchRecords = await db
    .select()
    .from(reconciliationMatches)
    .where(eq(reconciliationMatches.matchGroupId, matchGroupId));

  if (matchRecords.length === 0) return false;

  // Collect all bank and vyapar IDs
  const bankIds = matchRecords
    .filter(r => r.bankTransactionId)
    .map(r => r.bankTransactionId!);
  const vyaparIds = matchRecords
    .filter(r => r.vyaparTransactionId)
    .map(r => r.vyaparTransactionId!);

  // Update bank transactions (and any CC transactions in the group)
  if (bankIds.length > 0) {
    await db
      .update(bankTransactions)
      .set({
        isReconciled: false,
        reconciledWithId: null,
        reconciledWithType: null,
        updatedAt: now,
      })
      .where(inArray(bankTransactions.id, bankIds));

    // Also clear any credit card transactions in this group
    await db
      .update(creditCardTransactions)
      .set({
        isReconciled: false,
        reconciledWithId: null,
        updatedAt: now,
      })
      .where(inArray(creditCardTransactions.id, bankIds));
  }

  // Update vyapar transactions
  if (vyaparIds.length > 0) {
    await db
      .update(vyaparTransactions)
      .set({
        isReconciled: false,
        reconciledWithId: null,
        updatedAt: now,
      })
      .where(inArray(vyaparTransactions.id, vyaparIds));
  }

  // Delete match records
  await db
    .delete(reconciliationMatches)
    .where(eq(reconciliationMatches.matchGroupId, matchGroupId));

  return true;
}

// Get match group details
export async function getMatchGroup(matchGroupId: string): Promise<{
  bankTransactions: string[];
  vyaparTransactions: string[];
} | null> {
  const matchRecords = await db
    .select()
    .from(reconciliationMatches)
    .where(eq(reconciliationMatches.matchGroupId, matchGroupId));

  if (matchRecords.length === 0) return null;

  return {
    bankTransactions: matchRecords
      .filter(r => r.bankTransactionId)
      .map(r => r.bankTransactionId!),
    vyaparTransactions: matchRecords
      .filter(r => r.vyaparTransactionId)
      .map(r => r.vyaparTransactionId!),
  };
}
