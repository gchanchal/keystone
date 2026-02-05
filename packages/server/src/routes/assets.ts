import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db, assets, policies, policyPayments, loans } from '../db/index.js';
import { eq, desc } from 'drizzle-orm';
import { extractPolicyFromPdf } from '../utils/policyPdfParser.js';

// Configure multer for PDF uploads
const upload = multer({
  dest: '/tmp/policy-uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

const router = Router();

// ==================== ASSETS ====================

const assetSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['house', 'apartment', 'land', 'vehicle', 'gold', 'other']),
  description: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  area: z.number().optional(),
  areaUnit: z.enum(['sqft', 'sqm', 'acres']).optional(),
  registrationNumber: z.string().optional(),
  purchaseDate: z.string().optional(),
  purchaseValue: z.number().min(0),
  currentValue: z.number().optional(),
  lastValuationDate: z.string().optional(),
  currency: z.enum(['INR', 'USD']).optional(),
  linkedLoanId: z.string().optional(),
  ownershipType: z.enum(['self', 'joint', 'family']).optional(),
  ownershipPercentage: z.number().min(0).max(100).optional(),
  coOwners: z.string().optional(), // JSON string
  status: z.enum(['owned', 'sold', 'under_construction']).optional(),
  notes: z.string().optional(),
  // Loan details (optional - for creating/updating linked loan)
  hasLoan: z.boolean().optional(),
  loanProvider: z.string().optional(),
  loanType: z.enum(['home', 'car', 'personal', 'business']).optional(),
  principalAmount: z.number().optional(),
  outstandingAmount: z.number().optional(),
  interestRate: z.number().optional(),
  emiAmount: z.number().optional(),
  loanStartDate: z.string().optional(),
  loanEndDate: z.string().optional(),
  totalInstallments: z.number().optional(),
  paidInstallments: z.number().optional(),
});

// Get all assets
router.get('/', async (_req, res) => {
  try {
    const allAssets = await db
      .select()
      .from(assets)
      .orderBy(desc(assets.currentValue));

    // Get linked loan details for each asset
    const assetsWithLoans = await Promise.all(
      allAssets.map(async (asset) => {
        if (asset.linkedLoanId) {
          const [linkedLoan] = await db
            .select()
            .from(loans)
            .where(eq(loans.id, asset.linkedLoanId))
            .limit(1);
          return { ...asset, linkedLoan };
        }
        return { ...asset, linkedLoan: null };
      })
    );

    res.json(assetsWithLoans);
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({ error: 'Failed to fetch assets' });
  }
});

// Get assets summary
router.get('/summary', async (_req, res) => {
  try {
    const allAssets = await db.select().from(assets);

    const totalPurchaseValue = allAssets.reduce((sum, a) => sum + a.purchaseValue, 0);
    const totalCurrentValue = allAssets.reduce((sum, a) => sum + (a.currentValue || a.purchaseValue), 0);
    const totalAppreciation = totalCurrentValue - totalPurchaseValue;

    // Get total linked loan outstanding
    const linkedLoanIds = allAssets
      .filter((a) => a.linkedLoanId)
      .map((a) => a.linkedLoanId);

    let totalLoanOutstanding = 0;
    if (linkedLoanIds.length > 0) {
      const linkedLoans = await db
        .select()
        .from(loans)
        .where(eq(loans.status, 'active'));
      totalLoanOutstanding = linkedLoans
        .filter((l) => linkedLoanIds.includes(l.id))
        .reduce((sum, l) => sum + l.outstandingAmount, 0);
    }

    res.json({
      count: allAssets.length,
      totalPurchaseValue,
      totalCurrentValue,
      totalAppreciation,
      appreciationPercent: totalPurchaseValue > 0 ? (totalAppreciation / totalPurchaseValue) * 100 : 0,
      totalLoanOutstanding,
      netEquity: totalCurrentValue - totalLoanOutstanding,
      byType: allAssets.reduce((acc, a) => {
        const type = a.type;
        if (!acc[type]) acc[type] = { count: 0, value: 0 };
        acc[type].count++;
        acc[type].value += a.currentValue || a.purchaseValue;
        return acc;
      }, {} as Record<string, { count: number; value: number }>),
    });
  } catch (error) {
    console.error('Error fetching assets summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// ==================== POLICIES ====================
// NOTE: Policy routes MUST be defined before /:id route to prevent Express from treating "policies" as an asset ID

const policySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['life', 'term', 'health', 'vehicle', 'home', 'travel', 'other']),
  provider: z.string().min(1),
  policyNumber: z.string().optional(),
  policyHolder: z.string().optional(),
  sumAssured: z.number().optional(),
  coverageAmount: z.number().optional(),
  coverageDetails: z.string().optional(), // JSON
  premiumAmount: z.number().optional(),
  premiumFrequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time']).optional(),
  nextPremiumDate: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  policyTerm: z.number().optional(),
  nominees: z.string().optional(), // JSON
  maturityBenefit: z.number().optional(),
  deathBenefit: z.number().optional(),
  bonusAccrued: z.number().optional(),
  familyMembers: z.string().optional(), // JSON
  waitingPeriod: z.string().optional(),
  linkedAssetId: z.string().optional(),
  status: z.enum(['active', 'lapsed', 'matured', 'surrendered', 'claimed']).optional(),
  notes: z.string().optional(),
});

// Get all policies
router.get('/policies', async (_req, res) => {
  try {
    const allPolicies = await db
      .select()
      .from(policies)
      .orderBy(desc(policies.createdAt));

    res.json(allPolicies);
  } catch (error) {
    console.error('Error fetching policies:', error);
    res.status(500).json({ error: 'Failed to fetch policies' });
  }
});

// Get policies summary
router.get('/policies/summary', async (_req, res) => {
  try {
    const allPolicies = await db.select().from(policies);
    const activePolicies = allPolicies.filter((p) => p.status === 'active');

    const totalCoverage = activePolicies.reduce(
      (sum, p) => sum + (p.sumAssured || 0) + (p.coverageAmount || 0),
      0
    );
    const totalPremiumPaid = allPolicies.reduce((sum, p) => sum + (p.totalPremiumPaid || 0), 0);
    const yearlyPremium = activePolicies.reduce((sum, p) => {
      const premium = p.premiumAmount || 0;
      const freq = p.premiumFrequency;
      if (freq === 'monthly') return sum + premium * 12;
      if (freq === 'quarterly') return sum + premium * 4;
      if (freq === 'half_yearly') return sum + premium * 2;
      return sum + premium;
    }, 0);

    res.json({
      totalPolicies: allPolicies.length,
      activePolicies: activePolicies.length,
      totalCoverage,
      totalPremiumPaid,
      yearlyPremium,
      byType: activePolicies.reduce((acc, p) => {
        const type = p.type;
        if (!acc[type]) acc[type] = { count: 0, coverage: 0 };
        acc[type].count++;
        acc[type].coverage += (p.sumAssured || 0) + (p.coverageAmount || 0);
        return acc;
      }, {} as Record<string, { count: number; coverage: number }>),
    });
  } catch (error) {
    console.error('Error fetching policies summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Extract policy data from uploaded PDF
router.post('/policies/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const password = req.body.password || undefined;
    const result = await extractPolicyFromPdf(req.file.path, password);

    // Clean up the uploaded file
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      // Ignore cleanup errors
    }

    if (!result.success) {
      return res.status(result.needsPassword ? 401 : 400).json({
        error: result.error,
        needsPassword: result.needsPassword,
      });
    }

    res.json(result.data);
  } catch (error: any) {
    console.error('Error extracting policy from PDF:', error);
    res.status(500).json({ error: 'Failed to extract policy data' });
  }
});

// Get single policy
router.get('/policies/:id', async (req, res) => {
  try {
    const [policy] = await db
      .select()
      .from(policies)
      .where(eq(policies.id, req.params.id))
      .limit(1);

    if (!policy) {
      return res.status(404).json({ error: 'Policy not found' });
    }

    // Get payments
    const payments = await db
      .select()
      .from(policyPayments)
      .where(eq(policyPayments.policyId, req.params.id))
      .orderBy(desc(policyPayments.paymentDate));

    res.json({ ...policy, payments });
  } catch (error) {
    console.error('Error fetching policy:', error);
    res.status(500).json({ error: 'Failed to fetch policy' });
  }
});

// Create policy
router.post('/policies', async (req, res) => {
  try {
    const data = policySchema.parse(req.body);
    const now = new Date().toISOString();

    const newPolicy = {
      id: uuidv4(),
      ...data,
      totalPremiumPaid: 0,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(policies).values(newPolicy);
    res.status(201).json(newPolicy);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating policy:', error);
    res.status(500).json({ error: 'Failed to create policy' });
  }
});

// Update policy
router.put('/policies/:id', async (req, res) => {
  try {
    const data = policySchema.partial().parse(req.body);
    const now = new Date().toISOString();

    await db
      .update(policies)
      .set({ ...data, updatedAt: now })
      .where(eq(policies.id, req.params.id));

    const [updated] = await db
      .select()
      .from(policies)
      .where(eq(policies.id, req.params.id))
      .limit(1);

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating policy:', error);
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

// Delete policy
router.delete('/policies/:id', async (req, res) => {
  try {
    // Delete payments first
    await db.delete(policyPayments).where(eq(policyPayments.policyId, req.params.id));
    // Delete policy
    await db.delete(policies).where(eq(policies.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting policy:', error);
    res.status(500).json({ error: 'Failed to delete policy' });
  }
});

// Add payment to policy
router.post('/policies/:id/payments', async (req, res) => {
  try {
    const { paymentDate, amount, paymentMode, referenceNumber, notes } = z
      .object({
        paymentDate: z.string(),
        amount: z.number().positive(),
        paymentMode: z.string().optional(),
        referenceNumber: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body);

    const now = new Date().toISOString();

    const newPayment = {
      id: uuidv4(),
      policyId: req.params.id,
      paymentDate,
      amount,
      paymentMode: paymentMode || null,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
      createdAt: now,
    };

    await db.insert(policyPayments).values(newPayment);

    // Update total premium paid
    const [policy] = await db
      .select()
      .from(policies)
      .where(eq(policies.id, req.params.id))
      .limit(1);

    if (policy) {
      await db
        .update(policies)
        .set({
          totalPremiumPaid: (policy.totalPremiumPaid || 0) + amount,
          updatedAt: now,
        })
        .where(eq(policies.id, req.params.id));
    }

    res.status(201).json(newPayment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error adding payment:', error);
    res.status(500).json({ error: 'Failed to add payment' });
  }
});

// Delete payment
router.delete('/policies/:policyId/payments/:paymentId', async (req, res) => {
  try {
    const { policyId, paymentId } = req.params;
    const now = new Date().toISOString();

    // Get payment
    const [payment] = await db
      .select()
      .from(policyPayments)
      .where(eq(policyPayments.id, paymentId))
      .limit(1);

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Delete payment
    await db.delete(policyPayments).where(eq(policyPayments.id, paymentId));

    // Update total premium paid
    const [policy] = await db
      .select()
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);

    if (policy) {
      await db
        .update(policies)
        .set({
          totalPremiumPaid: Math.max(0, (policy.totalPremiumPaid || 0) - payment.amount),
          updatedAt: now,
        })
        .where(eq(policies.id, policyId));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ error: 'Failed to delete payment' });
  }
});

// ==================== ASSETS (continued) ====================

// Get single asset
router.get('/:id', async (req, res) => {
  try {
    const [asset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.id))
      .limit(1);

    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Get linked loan if any
    let linkedLoan = null;
    if (asset.linkedLoanId) {
      const [loan] = await db
        .select()
        .from(loans)
        .where(eq(loans.id, asset.linkedLoanId))
        .limit(1);
      linkedLoan = loan;
    }

    res.json({ ...asset, linkedLoan });
  } catch (error) {
    console.error('Error fetching asset:', error);
    res.status(500).json({ error: 'Failed to fetch asset' });
  }
});

// Create asset
router.post('/', async (req, res) => {
  try {
    const data = assetSchema.parse(req.body);
    const now = new Date().toISOString();

    // Extract loan fields from data
    const {
      hasLoan,
      loanProvider,
      loanType,
      principalAmount,
      outstandingAmount,
      interestRate,
      emiAmount,
      loanStartDate,
      loanEndDate,
      totalInstallments,
      paidInstallments,
      ...assetData
    } = data;

    let linkedLoanId: string | undefined;

    // Create linked loan if hasLoan is true
    if (hasLoan && principalAmount && principalAmount > 0) {
      const loanId = uuidv4();
      const newLoan = {
        id: loanId,
        type: 'taken' as const,
        partyName: loanProvider || 'Unknown Bank',
        loanType: loanType || 'home',
        principalAmount: principalAmount || 0,
        outstandingAmount: outstandingAmount || principalAmount || 0,
        interestRate: interestRate || 0,
        emiAmount: emiAmount || 0,
        startDate: loanStartDate || now.split('T')[0],
        maturityDate: loanEndDate || null,
        totalInstallments: totalInstallments || 0,
        paidInstallments: paidInstallments || 0,
        status: 'active' as const,
        notes: `Linked to asset: ${assetData.name}`,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(loans).values(newLoan);
      linkedLoanId = loanId;
    }

    const newAsset = {
      id: uuidv4(),
      ...assetData,
      linkedLoanId,
      currentValue: assetData.currentValue || assetData.purchaseValue,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(assets).values(newAsset);

    // Fetch the linked loan to return with the asset
    let linkedLoan = null;
    if (linkedLoanId) {
      const [loan] = await db.select().from(loans).where(eq(loans.id, linkedLoanId)).limit(1);
      linkedLoan = loan;
    }

    res.status(201).json({ ...newAsset, linkedLoan });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error creating asset:', error);
    res.status(500).json({ error: 'Failed to create asset' });
  }
});

// Update asset
router.put('/:id', async (req, res) => {
  try {
    const data = assetSchema.partial().parse(req.body);
    const now = new Date().toISOString();

    // Extract loan fields from data
    const {
      hasLoan,
      loanProvider,
      loanType,
      principalAmount,
      outstandingAmount,
      interestRate,
      emiAmount,
      loanStartDate,
      loanEndDate,
      totalInstallments,
      paidInstallments,
      ...assetData
    } = data;

    // Get existing asset to check for existing linked loan
    const [existingAsset] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.id))
      .limit(1);

    if (!existingAsset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    let linkedLoanId = existingAsset.linkedLoanId;

    // Handle loan creation/update/removal
    if (hasLoan && principalAmount && principalAmount > 0) {
      const loanData = {
        partyName: loanProvider || 'Unknown Bank',
        loanType: loanType || 'home',
        principalAmount: principalAmount || 0,
        outstandingAmount: outstandingAmount || principalAmount || 0,
        interestRate: interestRate || 0,
        emiAmount: emiAmount || 0,
        startDate: loanStartDate || now.split('T')[0],
        maturityDate: loanEndDate || null,
        totalInstallments: totalInstallments || 0,
        paidInstallments: paidInstallments || 0,
        updatedAt: now,
      };

      if (existingAsset.linkedLoanId) {
        // Update existing loan
        await db
          .update(loans)
          .set(loanData)
          .where(eq(loans.id, existingAsset.linkedLoanId));
      } else {
        // Create new loan
        const loanId = uuidv4();
        await db.insert(loans).values({
          id: loanId,
          type: 'taken',
          ...loanData,
          status: 'active',
          notes: `Linked to asset: ${assetData.name || existingAsset.name}`,
          createdAt: now,
        });
        linkedLoanId = loanId;
      }
    } else if (!hasLoan && existingAsset.linkedLoanId) {
      // Remove loan link (but don't delete the loan - user might want to keep records)
      linkedLoanId = null;
    }

    // Update asset
    await db
      .update(assets)
      .set({ ...assetData, linkedLoanId, updatedAt: now })
      .where(eq(assets.id, req.params.id));

    const [updated] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.id))
      .limit(1);

    // Fetch the linked loan to return with the asset
    let linkedLoan = null;
    if (updated.linkedLoanId) {
      const [loan] = await db.select().from(loans).where(eq(loans.id, updated.linkedLoanId)).limit(1);
      linkedLoan = loan;
    }

    res.json({ ...updated, linkedLoan });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error updating asset:', error);
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

// Delete asset
router.delete('/:id', async (req, res) => {
  try {
    await db.delete(assets).where(eq(assets.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

// Link loan to asset
router.patch('/:id/link-loan', async (req, res) => {
  try {
    const { loanId } = z.object({ loanId: z.string().nullable() }).parse(req.body);
    const now = new Date().toISOString();

    await db
      .update(assets)
      .set({ linkedLoanId: loanId, updatedAt: now })
      .where(eq(assets.id, req.params.id));

    const [updated] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, req.params.id))
      .limit(1);

    res.json(updated);
  } catch (error) {
    console.error('Error linking loan:', error);
    res.status(500).json({ error: 'Failed to link loan' });
  }
});

export default router;
