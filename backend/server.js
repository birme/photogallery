const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Minio = require('minio');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// MinIO client configuration
const minioClient = new Minio.Client({
  endPoint: 'birme-mcpstorage.minio-minio.auto.prod.osaas.io',
  port: 443,
  useSSL: true,
  accessKey: process.env.MINIO_ACCESS_KEY || 'root',
  secretKey: process.env.MINIO_SECRET_KEY || 'f50a7b77ce6fcc284e165166ed319b44'
});

const BUCKET_NAME = 'photogallery-storage';

// Middleware
app.use(cors());
app.use(express.json());

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.'));
    }
  }
});

// Ensure bucket exists
async function ensureBucket() {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME);
      console.log(`Bucket ${BUCKET_NAME} created`);
    }
  } catch (err) {
    console.error('Error checking/creating bucket:', err);
  }
}

// Get all photos
app.get('/api/photos', async (req, res) => {
  try {
    const photos = [];
    const stream = minioClient.listObjects(BUCKET_NAME, '', true);

    stream.on('data', (obj) => {
      if (obj.name && !obj.name.endsWith('/')) {
        const ext = path.extname(obj.name).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
          photos.push({
            name: obj.name,
            size: obj.size,
            lastModified: obj.lastModified,
            url: `/api/photos/${encodeURIComponent(obj.name)}`
          });
        }
      }
    });

    stream.on('error', (err) => {
      console.error('Error listing objects:', err);
      res.status(500).json({ error: 'Failed to list photos' });
    });

    stream.on('end', () => {
      // Sort by last modified, newest first
      photos.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
      res.json(photos);
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// Get a single photo
app.get('/api/photos/:name', async (req, res) => {
  try {
    const photoName = decodeURIComponent(req.params.name);
    const stat = await minioClient.statObject(BUCKET_NAME, photoName);

    res.setHeader('Content-Type', stat.metaData?.['content-type'] || 'image/jpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    const stream = await minioClient.getObject(BUCKET_NAME, photoName);
    stream.pipe(res);
  } catch (err) {
    console.error('Error fetching photo:', err);
    res.status(404).json({ error: 'Photo not found' });
  }
});

// Upload a photo
app.post('/api/photos', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const metaData = {
      'Content-Type': req.file.mimetype
    };

    await minioClient.putObject(
      BUCKET_NAME,
      fileName,
      req.file.buffer,
      req.file.size,
      metaData
    );

    res.json({
      message: 'Photo uploaded successfully',
      name: fileName,
      url: `/api/photos/${encodeURIComponent(fileName)}`
    });
  } catch (err) {
    console.error('Error uploading photo:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// Delete a photo
app.delete('/api/photos/:name', async (req, res) => {
  try {
    const photoName = decodeURIComponent(req.params.name);
    await minioClient.removeObject(BUCKET_NAME, photoName);
    res.json({ message: 'Photo deleted successfully' });
  } catch (err) {
    console.error('Error deleting photo:', err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve static frontend files in production
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));

// Handle client-side routing - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start server
ensureBucket().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
