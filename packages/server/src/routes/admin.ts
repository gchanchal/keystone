import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// Get database path from environment or default
const getDbPath = () => {
  return process.env.DATABASE_PATH || path.join(__dirname, '../../../data/keystone.db');
};

// Configure multer for database upload
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.dirname(getDbPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (_req, _file, cb) => {
    // Save as temp file first
    cb(null, 'keystone_upload_temp.db');
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.db') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Only .db files are allowed'));
    }
  },
});

// GET /api/admin/db-info - Get current database info
router.get('/db-info', async (_req, res) => {
  try {
    const dbPath = getDbPath();
    const exists = fs.existsSync(dbPath);
    let size = 0;
    let modified = null;

    if (exists) {
      const stats = fs.statSync(dbPath);
      size = stats.size;
      modified = stats.mtime.toISOString();
    }

    res.json({
      path: dbPath,
      exists,
      size,
      sizeFormatted: `${(size / 1024 / 1024).toFixed(2)} MB`,
      modified,
      env: process.env.DATABASE_PATH ? 'DATABASE_PATH set' : 'using default path',
    });
  } catch (error) {
    console.error('Error getting db info:', error);
    res.status(500).json({ error: 'Failed to get database info' });
  }
});

// POST /api/admin/restore-db - Restore database from uploaded file
router.post('/restore-db', upload.single('database'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No database file uploaded' });
    }

    const dbPath = getDbPath();
    const tempPath = req.file.path;
    const backupPath = dbPath + '.backup';
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';

    // Backup existing database if it exists
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
    }

    // Remove WAL mode files that might interfere
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath);
    }

    // Remove existing database
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    // Copy uploaded file to database location (use copy instead of rename for cross-device)
    fs.copyFileSync(tempPath, dbPath);
    fs.unlinkSync(tempPath);

    res.json({
      success: true,
      message: 'Database restored successfully. Please restart the server for changes to take effect.',
      path: dbPath,
      size: req.file.size,
      backupCreated: fs.existsSync(backupPath),
    });
  } catch (error) {
    console.error('Error restoring database:', error);
    res.status(500).json({ error: 'Failed to restore database: ' + (error as Error).message });
  }
});

// GET /api/admin/list-files - List files in data directory
router.get('/list-files', async (_req, res) => {
  try {
    const dbPath = getDbPath();
    const dir = path.dirname(dbPath);

    if (!fs.existsSync(dir)) {
      return res.json({ dir, exists: false, files: [] });
    }

    const files = fs.readdirSync(dir).map(name => {
      const filePath = path.join(dir, name);
      const stats = fs.statSync(filePath);
      return {
        name,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      };
    });

    res.json({ dir, exists: true, files });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// GET /api/admin/download-db - Download current database
router.get('/download-db', async (_req, res) => {
  try {
    const dbPath = getDbPath();

    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }

    res.download(dbPath, 'keystone.db');
  } catch (error) {
    console.error('Error downloading database:', error);
    res.status(500).json({ error: 'Failed to download database' });
  }
});

export default router;
