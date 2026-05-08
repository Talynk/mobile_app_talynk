/**
 * Legacy in-process video processing (FFmpeg/HLS).
 * Do NOT use for queue-driven jobs. All transcoding for posts and ads is done by
 * the external processing server (talynk-video-processor), which consumes from the
 * 'video-processing' BullMQ queue. This module is kept only for non-queue use cases
 * (e.g. one-off scripts or future non-queue flows). See src/queues/videoQueue.js.
 */
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { uploadFileToR2, isR2Configured, R2_PUBLIC_DOMAIN } = require('./r2Storage');
const { clearCacheByPattern } = require('../utils/cache');

// Set FFmpeg paths
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// HLS Configuration
const HLS_CONFIG = {
  // Quality levels for adaptive streaming (resolution: bitrate)
  // Reduced from 3 to 2 qualities for faster encoding (removed 360p)
  qualities: [
    // Mobile-optimized bitrate ladder (roughly matches 360p/720p tiers)
    { name: '480p', width: 854, height: 480, videoBitrate: '700k', audioBitrate: '96k' },
    { name: '720p', width: 1280, height: 720, videoBitrate: '1600k', audioBitrate: '128k' },
  ],
  // HLS segment duration in seconds
  segmentDuration: 4,
  // Thumbnail settings
  thumbnail: {
    width: 480,
    height: 854, // 9:16 aspect ratio for vertical videos
    timestamp: '00:00:01' // Take thumbnail at 1 second
  }
};

/**
 * Get video metadata using ffprobe
 * @param {string} inputPath - Path to video file
 * @returns {Promise<Object>} Video metadata
 */
async function getVideoMetadata(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        console.error('[VideoProcessing] Error getting metadata:', err);
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

      resolve({
        duration: metadata.format.duration,
        width: videoStream?.width,
        height: videoStream?.height,
        codec: videoStream?.codec_name,
        hasAudio: !!audioStream,
        bitrate: metadata.format.bit_rate,
        size: metadata.format.size
      });
    });
  });
}

/**
 * Generate thumbnail from video
 * @param {string} inputPath - Path to video file
 * @param {string} outputDir - Output directory
 * @returns {Promise<string>} Path to generated thumbnail
 */
async function generateThumbnail(inputPath, outputDir) {
  const thumbnailPath = path.join(outputDir, 'thumbnail.jpg');

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: [HLS_CONFIG.thumbnail.timestamp],
        filename: 'thumbnail.jpg',
        folder: outputDir,
        size: `${HLS_CONFIG.thumbnail.width}x?` // Auto-calculate height to maintain aspect ratio
      })
      .on('end', () => {
        console.log('[VideoProcessing] Thumbnail generated:', thumbnailPath);
        resolve(thumbnailPath);
      })
      .on('error', (err) => {
        console.error('[VideoProcessing] Thumbnail error:', err);
        reject(err);
      });
  });
}

/**
 * Transcode video to a specific quality level for HLS
 * @param {string} inputPath - Path to input video
 * @param {string} outputDir - Output directory for HLS files
 * @param {Object} quality - Quality configuration
 * @returns {Promise<string>} Path to the quality-specific playlist
 */
async function transcodeToQuality(inputPath, outputDir, quality) {
  const qualityDir = path.join(outputDir, quality.name);
  await fs.mkdir(qualityDir, { recursive: true });

  const playlistPath = path.join(qualityDir, 'playlist.m3u8');
  const segmentPattern = path.join(qualityDir, 'segment_%03d.ts');

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        // Video encoding
        '-c:v libx264',
        '-preset veryfast',
        '-profile:v main',
        '-level 4.0',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        `-b:v ${quality.videoBitrate}`,
        `-maxrate ${quality.videoBitrate}`,
        `-bufsize ${parseInt(quality.videoBitrate) * 2}k`,
        `-vf scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2`,
        '-g', '120',
        '-keyint_min', '120',
        '-sc_threshold', '0',
        // Audio encoding
        '-c:a aac',
        `-b:a ${quality.audioBitrate}`,
        '-ar 44100',
        // HLS settings
        '-f hls',
        `-hls_time ${HLS_CONFIG.segmentDuration}`,
        '-hls_list_size 0', // Include all segments in playlist
        '-hls_segment_filename', segmentPattern,
        '-hls_playlist_type vod',
        '-hls_flags', 'independent_segments'
      ])
      .output(playlistPath)
      .on('start', (cmd) => {
        console.log(`[VideoProcessing] Transcoding ${quality.name}...`);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`[VideoProcessing] ${quality.name}: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`[VideoProcessing] ${quality.name} complete`);
        resolve(playlistPath);
      })
      .on('error', (err) => {
        console.error(`[VideoProcessing] ${quality.name} error:`, err);
        reject(err);
      })
      .run();
  });
}

/**
 * Create master HLS playlist that references all quality levels
 * @param {string} outputDir - Output directory
 * @param {Array} qualities - Array of quality configurations that were successfully transcoded
 * @returns {Promise<string>} Path to master playlist
 */
async function createMasterPlaylist(outputDir, qualities) {
  const masterPath = path.join(outputDir, 'master.m3u8');

  let content = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

  for (const quality of qualities) {
    const bandwidth = parseInt(quality.videoBitrate) * 1000 + parseInt(quality.audioBitrate) * 1000;
    content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${quality.width}x${quality.height},NAME="${quality.name}"\n`;
    content += `${quality.name}/playlist.m3u8\n\n`;
  }

  await fs.writeFile(masterPath, content);
  console.log('[VideoProcessing] Master playlist created:', masterPath);
  return masterPath;
}

/**
 * Upload HLS files to R2
 * @param {string} hlsDir - Directory containing HLS files
 * @param {string} videoId - Unique video identifier
 * @returns {Promise<{masterUrl: string, qualities: Object}>}
 */
async function uploadHLSToR2(hlsDir, videoId) {
  if (!isR2Configured()) {
    throw new Error('R2 storage is not configured');
  }

  const r2Folder = `hls/${videoId}`;
  const uploadedUrls = {};

  // Helper function to upload a single file
  async function uploadFile(localPath, r2Key) {
    const fileBuffer = await fs.readFile(localPath);
    const fileName = path.basename(localPath);
    const mimetype = fileName.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T';

    const result = await uploadFileToR2(fileBuffer, fileName, mimetype, r2Key.replace(`/${fileName}`, ''));
    return result.url;
  }

  // Upload master playlist
  const masterPath = path.join(hlsDir, 'master.m3u8');
  uploadedUrls.master = await uploadFile(masterPath, `${r2Folder}/master.m3u8`);

  // Upload each quality level with parallel batch uploads
  const qualityDirs = await fs.readdir(hlsDir);
  const BATCH_SIZE = 5; // Upload 5 segments in parallel

  for (const dir of qualityDirs) {
    const qualityPath = path.join(hlsDir, dir);
    const stat = await fs.stat(qualityPath);

    if (stat.isDirectory()) {
      const files = await fs.readdir(qualityPath);

      // Upload files in parallel batches
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(file => {
          const filePath = path.join(qualityPath, file);
          const r2Key = `${r2Folder}/${dir}/${file}`;
          return uploadFile(filePath, r2Key);
        }));
      }

      uploadedUrls[dir] = `${R2_PUBLIC_DOMAIN}/${r2Folder}/${dir}/playlist.m3u8`;
    }
  }

  // Return the master playlist URL
  return {
    masterUrl: `${R2_PUBLIC_DOMAIN}/${r2Folder}/master.m3u8`,
    qualities: uploadedUrls
  };
}

/**
 * Upload thumbnail to R2
 * @param {string} thumbnailPath - Path to thumbnail file
 * @param {string} videoId - Unique video identifier
 * @returns {Promise<string>} Thumbnail URL
 */
async function uploadThumbnailToR2(thumbnailPath, videoId) {
  if (!isR2Configured()) {
    throw new Error('R2 storage is not configured');
  }

  const result = await uploadFileToR2(
    thumbnailPath,
    `${videoId}_thumbnail.jpg`,
    'image/jpeg',
    'thumbnails'
  );

  return result.url;
}

/**
 * Process video: generate HLS streams and thumbnail
 * @param {string} inputPath - Path to input video file
 * @param {Object} options - Processing options
 * @returns {Promise<{hlsUrl: string, thumbnailUrl: string, metadata: Object}>}
 */
async function processVideo(inputPath, options = {}) {
  const videoId = options.videoId || uuidv4();
  const tempDir = path.join(process.cwd(), 'tmp', 'hls', videoId);

  console.log('[VideoProcessing] Starting video processing:', videoId);
  console.log('[VideoProcessing] Input file:', inputPath);

  try {
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true });

    // Get video metadata
    const metadata = await getVideoMetadata(inputPath);
    console.log('[VideoProcessing] Video metadata:', metadata);

    // Determine which qualities to generate based on source resolution
    const applicableQualities = HLS_CONFIG.qualities.filter(q => {
      // Only generate qualities lower than or equal to source resolution
      return q.height <= (metadata.height || 1080);
    });

    if (applicableQualities.length === 0) {
      // If video is very low resolution, at least generate 360p
      applicableQualities.push(HLS_CONFIG.qualities[0]);
    }

    console.log('[VideoProcessing] Generating qualities:', applicableQualities.map(q => q.name).join(', '));

    // Generate thumbnail
    const thumbnailPath = await generateThumbnail(inputPath, tempDir);

    // Transcode to each quality level
    const transcodePromises = applicableQualities.map(quality =>
      transcodeToQuality(inputPath, tempDir, quality)
    );

    await Promise.all(transcodePromises);

    // Create master playlist
    await createMasterPlaylist(tempDir, applicableQualities);

    // Upload to R2
    let hlsUrl, thumbnailUrl;

    if (isR2Configured()) {
      console.log('[VideoProcessing] Uploading HLS files to R2...');
      const hlsResult = await uploadHLSToR2(tempDir, videoId);
      hlsUrl = hlsResult.masterUrl;

      console.log('[VideoProcessing] Uploading thumbnail to R2...');
      thumbnailUrl = await uploadThumbnailToR2(thumbnailPath, videoId);
    } else {
      // Local storage fallback
      const localHlsDir = path.join(process.cwd(), 'uploads', 'hls', videoId);
      await fs.mkdir(localHlsDir, { recursive: true });

      // Copy HLS files to uploads directory
      await copyDirectory(tempDir, localHlsDir);

      hlsUrl = `/uploads/hls/${videoId}/master.m3u8`;
      thumbnailUrl = `/uploads/hls/${videoId}/thumbnail.jpg`;
    }

    console.log('[VideoProcessing] Processing complete!');
    console.log('[VideoProcessing] HLS URL:', hlsUrl);
    console.log('[VideoProcessing] Thumbnail URL:', thumbnailUrl);

    return {
      hlsUrl,
      thumbnailUrl,
      metadata: {
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        qualities: applicableQualities.map(q => q.name)
      }
    };
  } finally {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log('[VideoProcessing] Cleaned up temp directory');
    } catch (err) {
      console.warn('[VideoProcessing] Failed to cleanup temp directory:', err.message);
    }
  }
}

/**
 * Copy directory recursively (for local storage fallback)
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 */
async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Generate thumbnail only (without HLS transcoding)
 * Useful for quick thumbnail generation
 * @param {string} inputPath - Path to input video file
 * @param {string} videoId - Unique video identifier
 * @returns {Promise<string>} Thumbnail URL
 */
async function generateAndUploadThumbnail(inputPath, videoId) {
  const tempDir = path.join(process.cwd(), 'tmp', 'thumbnails', videoId);

  try {
    await fs.mkdir(tempDir, { recursive: true });
    const thumbnailPath = await generateThumbnail(inputPath, tempDir);

    if (isR2Configured()) {
      const thumbnailUrl = await uploadThumbnailToR2(thumbnailPath, videoId);
      return thumbnailUrl;
    } else {
      // Local storage fallback
      const localThumbnailPath = path.join(process.cwd(), 'uploads', 'thumbnails', `${videoId}.jpg`);
      await fs.mkdir(path.dirname(localThumbnailPath), { recursive: true });
      await fs.copyFile(thumbnailPath, localThumbnailPath);
      return `/uploads/thumbnails/${videoId}.jpg`;
    }
  } finally {
    // Cleanup
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (err) {
      console.warn('[VideoProcessing] Failed to cleanup thumbnail temp directory:', err.message);
    }
  }
}

module.exports = {
  processVideo,
  generateThumbnail,
  generateAndUploadThumbnail,
  getVideoMetadata,
  HLS_CONFIG
};
