import { db } from '../db/index.js';
import { bankTransactions, vyaparTransactions, reconciliationMatches } from '../db/index.js';
import { eq, and, between, sql, inArray } from 'drizzle-orm';
import { addDays, subDays, parseISO } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

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

// Check if amounts match (with small tolerance for rounding)
function amountsMatch(amount1: number, amount2: number, tolerance = 0.01): boolean {
  return Math.abs(amount1 - amount2) <= tolerance;
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
  accountIds?: string[]
): Promise<ReconciliationMatch[]> {
  const matches: ReconciliationMatch[] = [];

  // Get unreconciled bank transactions
  let bankQuery = db
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.isReconciled, false),
        between(bankTransactions.date, startDate, endDate)
      )
    );

  const bankTxns = await bankQuery;

  // Get unreconciled vyapar transactions
  // Exclude:
  // - Payment Type "Gaurav" (internal transfers)
  // - Transaction Type "Sale Order" (pending payment - not reconcilable until payment received)
  // - Transaction Type "Payment-In" (doesn't need bank reconciliation)
  // Only include: Sale, Purchase, Payment-Out, Expense
  const vyaparTxns = await db
    .select()
    .from(vyaparTransactions)
    .where(
      and(
        eq(vyaparTransactions.isReconciled, false),
        between(vyaparTransactions.date, startDate, endDate),
        sql`(${vyaparTransactions.paymentType} != 'Gaurav' OR ${vyaparTransactions.paymentType} IS NULL)`,
        sql`${vyaparTransactions.transactionType} NOT IN ('Sale Order', 'Payment-In')`
      )
    );

  // Filter bank transactions by account if specified
  const filteredBankTxns = accountIds?.length
    ? bankTxns.filter(t => accountIds.includes(t.accountId))
    : bankTxns;

  // Create sets to track matched transactions
  const matchedBankIds = new Set<string>();
  const matchedVyaparIds = new Set<string>();

  // Priority 1: Exact amount + same date
  for (const bankTxn of filteredBankTxns) {
    if (matchedBankIds.has(bankTxn.id)) continue;

    for (const vyaparTxn of vyaparTxns) {
      if (matchedVyaparIds.has(vyaparTxn.id)) continue;

      if (
        amountsMatch(bankTxn.amount, vyaparTxn.amount) &&
        bankTxn.date === vyaparTxn.date
      ) {
        matches.push({
          bankTransactionId: bankTxn.id,
          vyaparTransactionId: vyaparTxn.id,
          confidence: 100,
          matchType: 'exact',
          bankAmount: bankTxn.amount,
          vyaparAmount: vyaparTxn.amount,
          bankDate: bankTxn.date,
          vyaparDate: vyaparTxn.date,
        });
        matchedBankIds.add(bankTxn.id);
        matchedVyaparIds.add(vyaparTxn.id);
        break;
      }
    }
  }

  // Priority 2: Exact amount + date within ±2 days
  for (const bankTxn of filteredBankTxns) {
    if (matchedBankIds.has(bankTxn.id)) continue;

    for (const vyaparTxn of vyaparTxns) {
      if (matchedVyaparIds.has(vyaparTxn.id)) continue;

      if (
        amountsMatch(bankTxn.amount, vyaparTxn.amount) &&
        datesWithinRange(bankTxn.date, vyaparTxn.date, 2)
      ) {
        const dayDiff = Math.abs(
          (parseISO(bankTxn.date).getTime() - parseISO(vyaparTxn.date).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        // Confidence: 95% for 1 day diff, 85% for 2 day diff
        const confidence = Math.max(80, 95 - dayDiff * 5);

        matches.push({
          bankTransactionId: bankTxn.id,
          vyaparTransactionId: vyaparTxn.id,
          confidence,
          matchType: 'date_fuzzy',
          bankAmount: bankTxn.amount,
          vyaparAmount: vyaparTxn.amount,
          bankDate: bankTxn.date,
          vyaparDate: vyaparTxn.date,
        });
        matchedBankIds.add(bankTxn.id);
        matchedVyaparIds.add(vyaparTxn.id);
        break;
      }
    }
  }

  // Priority 3: Amount match + party name fuzzy match > 80%
  for (const bankTxn of filteredBankTxns) {
    if (matchedBankIds.has(bankTxn.id)) continue;

    const bankParty = extractPartyName(bankTxn.narration);

    for (const vyaparTxn of vyaparTxns) {
      if (matchedVyaparIds.has(vyaparTxn.id)) continue;

      if (!vyaparTxn.partyName) continue;

      if (amountsMatch(bankTxn.amount, vyaparTxn.amount)) {
        const partySimilarity = similarity(bankParty, vyaparTxn.partyName);

        if (partySimilarity > 0.8) {
          matches.push({
            bankTransactionId: bankTxn.id,
            vyaparTransactionId: vyaparTxn.id,
            confidence: Math.round(partySimilarity * 60 + 20),
            matchType: 'party_fuzzy',
            bankAmount: bankTxn.amount,
            vyaparAmount: vyaparTxn.amount,
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

  return matches;
}

export async function applyMatches(matches: ReconciliationMatch[]): Promise<number> {
  let appliedCount = 0;
  const now = new Date().toISOString();

  for (const match of matches) {
    // Update bank transaction
    await db
      .update(bankTransactions)
      .set({
        isReconciled: true,
        reconciledWithId: match.vyaparTransactionId,
        reconciledWithType: 'vyapar',
        updatedAt: now,
      })
      .where(eq(bankTransactions.id, match.bankTransactionId));

    // Update vyapar transaction
    await db
      .update(vyaparTransactions)
      .set({
        isReconciled: true,
        reconciledWithId: match.bankTransactionId,
        updatedAt: now,
      })
      .where(eq(vyaparTransactions.id, match.vyaparTransactionId));

    appliedCount++;
  }

  return appliedCount;
}

export async function manualMatch(
  bankTransactionId: string,
  vyaparTransactionId: string
): Promise<boolean> {
  const now = new Date().toISOString();

  await db
    .update(bankTransactions)
    .set({
      isReconciled: true,
      reconciledWithId: vyaparTransactionId,
      reconciledWithType: 'vyapar',
      updatedAt: now,
    })
    .where(eq(bankTransactions.id, bankTransactionId));

  await db
    .update(vyaparTransactions)
    .set({
      isReconciled: true,
      reconciledWithId: bankTransactionId,
      updatedAt: now,
    })
    .where(eq(vyaparTransactions.id, vyaparTransactionId));

  return true;
}

export async function unmatch(bankTransactionId: string): Promise<boolean> {
  const now = new Date().toISOString();

  const bankTxn = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.id, bankTransactionId))
    .limit(1);

  if (!bankTxn[0]) return false;

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

  // Legacy single match
  if (!bankTxn[0].reconciledWithId) return false;

  const vyaparId = bankTxn[0].reconciledWithId;

  await db
    .update(bankTransactions)
    .set({
      isReconciled: false,
      reconciledWithId: null,
      reconciledWithType: null,
      updatedAt: now,
    })
    .where(eq(bankTransactions.id, bankTransactionId));

  await db
    .update(vyaparTransactions)
    .set({
      isReconciled: false,
      reconciledWithId: null,
      updatedAt: now,
    })
    .where(eq(vyaparTransactions.id, vyaparId));

  return true;
}

// Many-to-many matching: Multiple bank transactions to multiple vyapar transactions
export async function multiMatch(
  bankTransactionIds: string[],
  vyaparTransactionIds: string[]
): Promise<{ success: boolean; matchGroupId: string }> {
  const now = new Date().toISOString();
  const matchGroupId = uuidv4();

  // Create match records for all transactions in this group
  for (const bankId of bankTransactionIds) {
    await db.insert(reconciliationMatches).values({
      id: uuidv4(),
      matchGroupId,
      bankTransactionId: bankId,
      vyaparTransactionId: null,
      createdAt: now,
    });

    // Mark bank transaction as reconciled
    await db
      .update(bankTransactions)
      .set({
        isReconciled: true,
        reconciledWithId: matchGroupId, // Store group ID for reference
        reconciledWithType: 'multi_vyapar',
        updatedAt: now,
      })
      .where(eq(bankTransactions.id, bankId));
  }

  for (const vyaparId of vyaparTransactionIds) {
    await db.insert(reconciliationMatches).values({
      id: uuidv4(),
      matchGroupId,
      bankTransactionId: null,
      vyaparTransactionId: vyaparId,
      createdAt: now,
    });

    // Mark vyapar transaction as reconciled
    await db
      .update(vyaparTransactions)
      .set({
        isReconciled: true,
        reconciledWithId: matchGroupId, // Store group ID for reference
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

  // Update bank transactions
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
