import { Router } from 'express';
import { db, learnedTemplates, templateLearningSessions } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { extractTemplateFromExcel, extractTemplateFromCSV } from '../parsers/template-extractor.js';
import { extractTemplateFromPDF } from '../parsers/template-extractor-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const router = Router();

// Configure multer for file uploads
// Use /data/learn-uploads on Railway (persistent volume), otherwise use local data folder
const learnUploadDir = process.env.NODE_ENV === 'production'
  ? '/data/learn-uploads'
  : path.join(__dirname, '../../../data/learn-uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(learnUploadDir)) {
      fs.mkdirSync(learnUploadDir, { recursive: true });
    }
    cb(null, learnUploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ];
    const allowedExtensions = ['.pdf', '.xls', '.xlsx', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, Excel, and CSV files are allowed'));
    }
  },
});

// Schemas
const saveMappingsSchema = z.object({
  mappings: z.record(z.object({
    source: z.string(),
    format: z.string().optional(),
    transform: z.string().optional(),
  })),
});

const completeSessionSchema = z.object({
  name: z.string().min(1),
  institution: z.string().min(1),
  statementType: z.enum(['bank_statement', 'credit_card', 'loan', 'investment', 'other']),
  detectionPatterns: z.object({
    textPatterns: z.array(z.string()),
    filenamePatterns: z.array(z.string()).optional(),
  }),
});

// POST /api/learn/start - Upload file and start learning session
router.post('/start', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const password = req.body.password;
    const now = new Date().toISOString();
    const sessionId = uuidv4();

    // Determine file type
    const ext = path.extname(req.file.originalname).toLowerCase();
    let fileType = 'unknown';
    if (ext === '.pdf') fileType = 'pdf';
    else if (ext === '.xls' || ext === '.xlsx') fileType = 'xlsx';
    else if (ext === '.csv') fileType = 'csv';

    // Create learning session
    await db.insert(templateLearningSessions).values({
      id: sessionId,
      userId: req.userId!,
      status: 'extracting',
      filename: req.file.originalname,
      filePath: req.file.path,
      fileType,
      createdAt: now,
      updatedAt: now,
    });

    // Start extraction asynchronously
    (async () => {
      try {
        let extractionResult;

        if (fileType === 'pdf') {
          extractionResult = await extractTemplateFromPDF(req.file!.path, password);
        } else if (fileType === 'xlsx' || fileType === 'xls') {
          const buffer = fs.readFileSync(req.file!.path);
          extractionResult = await extractTemplateFromExcel(buffer);
        } else if (fileType === 'csv') {
          const buffer = fs.readFileSync(req.file!.path);
          extractionResult = await extractTemplateFromCSV(buffer);
        } else {
          throw new Error('Unsupported file type');
        }

        // Update session with extracted data
        await db
          .update(templateLearningSessions)
          .set({
            status: 'mapping',
            extractedFields: JSON.stringify(extractionResult.fields),
            suggestedMappings: JSON.stringify(extractionResult.suggestedMappings),
            detectedPatterns: JSON.stringify(extractionResult.detectionPatterns),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(templateLearningSessions.id, sessionId));

        console.log(`[Learn] Extraction complete for session ${sessionId}`);
      } catch (error: any) {
        console.error(`[Learn] Extraction failed for session ${sessionId}:`, error);

        await db
          .update(templateLearningSessions)
          .set({
            status: 'failed',
            errorMessage: error.message || 'Extraction failed',
            updatedAt: new Date().toISOString(),
          })
          .where(eq(templateLearningSessions.id, sessionId));
      }
    })();

    res.json({
      sessionId,
      status: 'extracting',
      filename: req.file.originalname,
      fileType,
    });
  } catch (error: any) {
    console.error('Error starting learning session:', error);
    res.status(500).json({ error: error.message || 'Failed to start learning session' });
  }
});

// GET /api/learn/:sessionId - Get learning session status and data
router.get('/:sessionId', async (req, res) => {
  try {
    const [session] = await db
      .select()
      .from(templateLearningSessions)
      .where(and(
        eq(templateLearningSessions.id, req.params.sessionId),
        eq(templateLearningSessions.userId, req.userId!)
      ));

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      ...session,
      extractedFields: session.extractedFields ? JSON.parse(session.extractedFields) : null,
      suggestedMappings: session.suggestedMappings ? JSON.parse(session.suggestedMappings) : null,
      finalMappings: session.finalMappings ? JSON.parse(session.finalMappings) : null,
      detectedPatterns: session.detectedPatterns ? JSON.parse(session.detectedPatterns) : null,
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// GET /api/learn/:sessionId/extract - Get AI-extracted fields (poll until ready)
router.get('/:sessionId/extract', async (req, res) => {
  try {
    const [session] = await db
      .select()
      .from(templateLearningSessions)
      .where(and(
        eq(templateLearningSessions.id, req.params.sessionId),
        eq(templateLearningSessions.userId, req.userId!)
      ));

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status === 'extracting') {
      return res.json({
        status: 'extracting',
        message: 'Still analyzing the file...',
      });
    }

    if (session.status === 'failed') {
      return res.json({
        status: 'failed',
        error: session.errorMessage || 'Extraction failed',
      });
    }

    res.json({
      status: session.status,
      extractedFields: session.extractedFields ? JSON.parse(session.extractedFields) : null,
      suggestedMappings: session.suggestedMappings ? JSON.parse(session.suggestedMappings) : null,
      detectedPatterns: session.detectedPatterns ? JSON.parse(session.detectedPatterns) : null,
    });
  } catch (error) {
    console.error('Error getting extraction:', error);
    res.status(500).json({ error: 'Failed to get extraction' });
  }
});

// PUT /api/learn/:sessionId/mappings - Save user-confirmed mappings
router.put('/:sessionId/mappings', async (req, res) => {
  try {
    const data = saveMappingsSchema.parse(req.body);

    const [session] = await db
      .select()
      .from(templateLearningSessions)
      .where(and(
        eq(templateLearningSessions.id, req.params.sessionId),
        eq(templateLearningSessions.userId, req.userId!)
      ));

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await db
      .update(templateLearningSessions)
      .set({
        finalMappings: JSON.stringify(data.mappings),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(templateLearningSessions.id, req.params.sessionId));

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error saving mappings:', error);
    res.status(500).json({ error: 'Failed to save mappings' });
  }
});

// POST /api/learn/:sessionId/complete - Finalize and save template
router.post('/:sessionId/complete', async (req, res) => {
  try {
    const data = completeSessionSchema.parse(req.body);

    const [session] = await db
      .select()
      .from(templateLearningSessions)
      .where(and(
        eq(templateLearningSessions.id, req.params.sessionId),
        eq(templateLearningSessions.userId, req.userId!)
      ));

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.finalMappings) {
      return res.status(400).json({ error: 'Mappings must be saved before completing' });
    }

    const now = new Date().toISOString();
    const templateId = uuidv4();

    // Get extracted fields for sample data
    const extractedFields = session.extractedFields ? JSON.parse(session.extractedFields) : {};

    // Create the template
    await db.insert(learnedTemplates).values({
      id: templateId,
      userId: req.userId!,
      name: data.name,
      institution: data.institution.toLowerCase(),
      statementType: data.statementType,
      fileType: session.fileType || 'unknown',
      detectionPatterns: JSON.stringify(data.detectionPatterns),
      fieldMappings: session.finalMappings,
      sampleHeaders: JSON.stringify(extractedFields.headers || []),
      sampleRows: JSON.stringify(extractedFields.sampleRows || []),
      isActive: 1,
      confidenceScore: 0.8,
      timesUsed: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Update session
    await db
      .update(templateLearningSessions)
      .set({
        status: 'completed',
        templateId,
        updatedAt: now,
      })
      .where(eq(templateLearningSessions.id, req.params.sessionId));

    // Fetch and return the created template
    const [template] = await db
      .select()
      .from(learnedTemplates)
      .where(eq(learnedTemplates.id, templateId));

    res.json({
      success: true,
      template: {
        ...template,
        detectionPatterns: JSON.parse(template.detectionPatterns || '{}'),
        fieldMappings: JSON.parse(template.fieldMappings || '{}'),
        sampleHeaders: template.sampleHeaders ? JSON.parse(template.sampleHeaders) : null,
        sampleRows: template.sampleRows ? JSON.parse(template.sampleRows) : null,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Error completing session:', error);
    res.status(500).json({ error: 'Failed to complete session' });
  }
});

// DELETE /api/learn/:sessionId - Cancel learning session
router.delete('/:sessionId', async (req, res) => {
  try {
    const [session] = await db
      .select()
      .from(templateLearningSessions)
      .where(and(
        eq(templateLearningSessions.id, req.params.sessionId),
        eq(templateLearningSessions.userId, req.userId!)
      ));

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Delete uploaded file
    if (session.filePath && fs.existsSync(session.filePath)) {
      fs.unlinkSync(session.filePath);
    }

    // Delete session
    await db
      .delete(templateLearningSessions)
      .where(eq(templateLearningSessions.id, req.params.sessionId));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// GET /api/learn/sessions - List all learning sessions
router.get('/', async (req, res) => {
  try {
    const sessions = await db
      .select()
      .from(templateLearningSessions)
      .where(eq(templateLearningSessions.userId, req.userId!));

    res.json(sessions.map(s => ({
      ...s,
      extractedFields: s.extractedFields ? JSON.parse(s.extractedFields) : null,
      suggestedMappings: s.suggestedMappings ? JSON.parse(s.suggestedMappings) : null,
      finalMappings: s.finalMappings ? JSON.parse(s.finalMappings) : null,
      detectedPatterns: s.detectedPatterns ? JSON.parse(s.detectedPatterns) : null,
    })));
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

export default router;
