const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const os = require('os');
const { uploadFileToR2, isR2Configured } = require('../services/r2Storage');

// Check if R2 is enabled
const USE_R2 = process.env.USE_R2 === 'true' || process.env.USE_R2 === '1';
const R2_ENABLED = USE_R2 && isR2Configured();

// Ensure uploads directory exists (for fallback/local storage)
const uploadsDir = path.join(process.cwd(), 'uploads');
(async () => {
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
    if (!R2_ENABLED) {
      console.log('[UPLOAD] Uploads directory ready (local storage):', uploadsDir);
    } else {
      console.log('[UPLOAD] Uploads directory ready (fallback):', uploadsDir);
    }
  } catch (error) {
    console.error('[UPLOAD] Failed to create uploads directory:', error);
  }
})();

// Configure multer storage based on R2 availability
let storage;
if (R2_ENABLED) {
  // Use memory storage for R2 (more efficient, no disk I/O)
  storage = multer.memoryStorage();
  console.log('[UPLOAD] Using R2 storage with memory buffer');
} else {
  // Use disk storage for local storage
  storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await fs.mkdir(uploadsDir, { recursive: true });
        cb(null, uploadsDir);
      } catch (error) {
        cb(error, null);
      }
    },
    filename: (req, file, cb) => {
      const fileExt = path.extname(file.originalname);
      const fileName = `${Date.now()}-${uuidv4()}${fileExt}`;
      cb(null, fileName);
    }
  });
  console.log('[UPLOAD] Using local disk storage');
}

// Filter function for file types
const fileFilter = (req, file, cb) => {
  // Accept images and videos
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image and video files are allowed!'), false);
  }
};

// Create multer instance
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: fileFilter
});

// Middleware to handle file upload (R2 or local)
const handleFileUpload = async (req, res, next) => {
  try {
    // Skip if no file uploaded
    if (!req.file) {
      console.log('[UPLOAD] No file uploaded, skipping processing');
      return next();
    }

    console.log(`[UPLOAD] Processing file: ${req.file.originalname}`);
    console.log(`[UPLOAD] File size: ${req.file.size} bytes`);
    console.log(`[UPLOAD] File mimetype: ${req.file.mimetype}`);

    let fileUrl;
    let fileName;
    let filePath;
    const isVideo = req.file.mimetype.startsWith('video/');

    if (R2_ENABLED) {
      // Upload to R2
      try {
        // Determine folder based on file type or route
        const folder = req.route?.path?.includes('profile') ? 'profiles' : 'media';

        // Get file buffer from memory storage
        const fileBuffer = req.file.buffer;

        // Upload to R2
        // Note: Video processor will download from R2 URL for HLS encoding
        const result = await uploadFileToR2(
          fileBuffer,
          req.file.originalname,
          req.file.mimetype,
          folder
        );

        fileUrl = result.url;
        fileName = path.basename(result.key);
        filePath = result.key;

        console.log('[UPLOAD] File uploaded successfully to R2:', fileUrl);

        // Add file info to request
        req.file.filename = fileName;
        req.file.path = filePath;
        req.file.r2Url = fileUrl;
        req.file.localUrl = fileUrl; // For backward compatibility
        req.file.supabaseUrl = fileUrl; // For backward compatibility
        req.file.key = result.key; // R2 key for future deletion if needed

        // Note: Thumbnails are now generated on the frontend during upload
        // Video processing (HLS encoding) happens on remote VPS via queue
      } catch (r2Error) {
        console.error('[UPLOAD] R2 upload failed, falling back to local storage:', r2Error);
        // Fallback to local storage if R2 fails
        const fileExt = path.extname(req.file.originalname);
        fileName = `${Date.now()}-${uuidv4()}${fileExt}`;
        filePath = path.join(uploadsDir, fileName);

        // Save to disk
        await fs.writeFile(filePath, req.file.buffer);

        fileUrl = `/uploads/${fileName}`;
        req.file.filename = fileName;
        req.file.path = `uploads/${fileName}`;
        req.file.localUrl = fileUrl;
        req.file.supabaseUrl = fileUrl;

        console.log('[UPLOAD] File saved to local storage (fallback):', fileUrl);
      }
    } else {
      // Use local storage
      fileName = req.file.filename;
      filePath = req.file.path;
      fileUrl = `/uploads/${fileName}`;

      console.log('[UPLOAD] File saved to local storage:', fileUrl);

      // Add file info to request
      req.file.filename = fileName;
      req.file.path = filePath;
      req.file.localUrl = fileUrl;
      req.file.supabaseUrl = fileUrl; // Keep for backward compatibility
    }

    console.log('[UPLOAD] File processing completed successfully');
    next();
  } catch (error) {
    console.error('[UPLOAD] File upload error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'File upload failed',
      details: error.message
    });
  }
};

// Middleware that combines multer and file upload handler
const uploadMiddleware = {
  single: (fieldName) => [upload.single(fieldName), handleFileUpload],
  array: (fieldName, maxCount) => [upload.array(fieldName, maxCount), handleFileUpload],
  fields: (fields) => [upload.fields(fields), handleFileUpload]
};

module.exports = uploadMiddleware; 