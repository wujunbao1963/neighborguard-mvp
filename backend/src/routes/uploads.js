// ============================================================================
// Upload Routes
// Phase 4: File upload for event media
// ============================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { authenticate, requireCircleMember } = require('../middleware/auth');

// ============================================================================
// Configure Multer
// ============================================================================
const uploadDir = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const circleDir = path.join(uploadDir, req.params.circleId);
    if (!fs.existsSync(circleDir)) {
      fs.mkdirSync(circleDir, { recursive: true });
    }
    cb(null, circleDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
  const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/mpeg'];
  const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(`不支持的文件类型: ${file.mimetype}`, 400, 'INVALID_FILE_TYPE'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800, // 50MB default
    files: 10 // Max 10 files per request
  }
});

// ============================================================================
// POST /api/uploads/:circleId/:eventId - Upload media to event
// ============================================================================
router.post(
  '/:circleId/:eventId',
  authenticate,
  requireCircleMember(['OWNER', 'HOUSEHOLD', 'NEIGHBOR', 'RELATIVE']),
  upload.array('files', 10),
  async (req, res, next) => {
    try {
      const { circleId, eventId } = req.params;
      const { sourceType = 'USER_UPLOAD' } = req.body;

      // Verify event exists
      const event = await prisma.event.findFirst({
        where: { id: eventId, circleId, deletedAt: null }
      });

      if (!event) {
        // Clean up uploaded files
        if (req.files) {
          req.files.forEach(file => {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          });
        }
        throw new AppError('事件不存在', 404, 'EVENT_NOT_FOUND');
      }

      if (!req.files || req.files.length === 0) {
        throw new AppError('请选择要上传的文件', 400, 'NO_FILES');
      }

      const mediaRecords = [];

      for (const file of req.files) {
        const isVideo = file.mimetype.startsWith('video/');
        const fileUrl = `/uploads/${circleId}/${file.filename}`;

        // Calculate file hash for evidence integrity
        const fileBuffer = fs.readFileSync(file.path);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const media = await prisma.eventMedia.create({
          data: {
            eventId,
            uploaderId: req.circleMember.id,
            mediaType: isVideo ? 'VIDEO' : 'PHOTO',
            sourceType,
            fileName: file.originalname,
            fileUrl,
            mimeType: file.mimetype,
            fileSizeBytes: file.size,
            originalFileHash: fileHash
          }
        });

        mediaRecords.push({
          id: media.id,
          mediaType: media.mediaType,
          fileName: media.fileName,
          fileUrl: media.fileUrl,
          fileSizeBytes: media.fileSizeBytes,
          createdAt: media.createdAt
        });
      }

      // Get uploader display name for note
      const uploaderName = req.circleMember.displayName || req.user.displayName;
      
      // Create a note recording the upload action
      const photoCount = mediaRecords.filter(m => m.mediaType === 'PHOTO').length;
      const videoCount = mediaRecords.filter(m => m.mediaType === 'VIDEO').length;
      const parts = [];
      if (photoCount > 0) parts.push(`${photoCount} 张图片`);
      if (videoCount > 0) parts.push(`${videoCount} 个视频`);
      const noteBody = `上传了 ${parts.join(' 和 ')}`;

      await prisma.eventNote.create({
        data: {
          eventId,
          authorId: req.circleMember.id,
          noteType: 'SYSTEM',
          body: noteBody
        }
      });

      res.status(201).json({
        success: true,
        media: mediaRecords,
        message: `成功上传 ${mediaRecords.length} 个文件`
      });
    } catch (error) {
      // Clean up uploaded files on error
      if (req.files) {
        req.files.forEach(file => {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        });
      }
      next(error);
    }
  }
);

// ============================================================================
// GET /api/uploads/:circleId/:eventId - Get all media for event
// ============================================================================
router.get('/:circleId/:eventId', authenticate, requireCircleMember(), async (req, res, next) => {
  try {
    const { circleId, eventId } = req.params;

    // Verify event exists
    const event = await prisma.event.findFirst({
      where: { id: eventId, circleId, deletedAt: null }
    });

    if (!event) {
      throw new AppError('事件不存在', 404, 'EVENT_NOT_FOUND');
    }

    const media = await prisma.eventMedia.findMany({
      where: { eventId },
      include: {
        uploader: {
          include: {
            user: { select: { displayName: true } }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({
      success: true,
      media: media.map(m => ({
        id: m.id,
        mediaType: m.mediaType,
        sourceType: m.sourceType,
        fileName: m.fileName,
        fileUrl: m.fileUrl,
        thumbnailUrl: m.thumbnailUrl,
        mimeType: m.mimeType,
        fileSizeBytes: m.fileSizeBytes,
        createdAt: m.createdAt,
        uploader: {
          id: m.uploader.id,
          displayName: m.uploader.displayName || m.uploader.user.displayName
        }
      }))
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE /api/uploads/:circleId/:mediaId - Delete a media file
// ============================================================================
router.delete('/:circleId/:mediaId', authenticate, requireCircleMember(), async (req, res, next) => {
  try {
    const { circleId, mediaId } = req.params;

    const media = await prisma.eventMedia.findUnique({
      where: { id: mediaId },
      include: {
        event: true
      }
    });

    if (!media || media.event.circleId !== circleId) {
      throw new AppError('媒体文件不存在', 404, 'MEDIA_NOT_FOUND');
    }

    // Check permissions - Owner or uploader can delete
    const isOwner = req.circleMember.role === 'OWNER';
    const isUploader = media.uploaderId === req.circleMember.id;
    
    if (!isOwner && !isUploader) {
      throw new AppError('没有权限删除此文件', 403, 'NOT_AUTHORIZED');
    }

    // Delete file from disk
    const filePath = path.join(__dirname, '../../', media.fileUrl);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete thumbnail if exists
    if (media.thumbnailUrl) {
      const thumbPath = path.join(__dirname, '../../', media.thumbnailUrl);
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
    }

    // Delete database record
    await prisma.eventMedia.delete({
      where: { id: mediaId }
    });

    res.json({
      success: true,
      message: '文件已删除'
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/uploads/:circleId/download-all - Download all media as zip
// ============================================================================
const archiver = require('archiver');

router.get('/:circleId/download-all', authenticate, requireCircleMember(), async (req, res, next) => {
  try {
    const { circleId } = req.params;
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate);
    }

    // Get all events with media in this circle
    const events = await prisma.event.findMany({
      where: {
        circleId,
        deletedAt: null,
        ...(Object.keys(dateFilter).length > 0 ? { occurredAt: dateFilter } : {})
      },
      include: {
        media: true,
        zone: { select: { displayName: true } }
      },
      orderBy: { occurredAt: 'desc' }
    });

    // Collect all media files
    const mediaFiles = [];
    for (const event of events) {
      for (const media of event.media) {
        const filePath = path.join(__dirname, '../../', media.fileUrl);
        if (fs.existsSync(filePath)) {
          const dateStr = new Date(event.occurredAt).toISOString().split('T')[0];
          const zoneName = event.zone?.displayName || 'unknown';
          const ext = path.extname(media.fileName);
          const fileName = `${dateStr}_${zoneName}_${event.title.substring(0, 20)}_${media.id.substring(0, 8)}${ext}`;
          mediaFiles.push({
            filePath,
            fileName: fileName.replace(/[\/\\:*?"<>|]/g, '_') // Sanitize filename
          });
        }
      }
    }

    if (mediaFiles.length === 0) {
      return res.status(404).json({
        success: false,
        error: { message: '没有找到任何媒体文件', code: 'NO_MEDIA' }
      });
    }

    // Set headers for zip download
    const zipFileName = `neighborguard_media_${new Date().toISOString().split('T')[0]}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    // Create zip archive
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    // Add files to archive
    for (const { filePath, fileName } of mediaFiles) {
      archive.file(filePath, { name: fileName });
    }

    // Finalize archive
    await archive.finalize();

  } catch (error) {
    next(error);
  }
});

module.exports = router;
