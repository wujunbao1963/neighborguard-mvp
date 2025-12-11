// ============================================================================
// Device Routes - Push notification token management
// ============================================================================

const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { authenticate } = require('../middleware/auth');

// ============================================================================
// POST /api/devices/register - Register device token
// ============================================================================
router.post('/register', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { token, platform = 'IOS', deviceName, appVersion } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'Device token is required' }
      });
    }
    
    // Upsert the device token
    const deviceToken = await prisma.deviceToken.upsert({
      where: { token },
      update: {
        userId,
        platform,
        deviceName,
        appVersion,
        isActive: true,
        lastUsedAt: new Date()
      },
      create: {
        userId,
        token,
        platform,
        deviceName,
        appVersion,
        isActive: true
      }
    });
    
    console.log(`✅ Device registered for user ${userId}: ${token.substring(0, 16)}...`);
    
    res.json({
      success: true,
      message: 'Device token registered',
      deviceId: deviceToken.id
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/devices/unregister - Unregister device token
// ============================================================================
router.post('/unregister', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TOKEN', message: 'Device token is required' }
      });
    }
    
    // Mark token as inactive
    const result = await prisma.deviceToken.updateMany({
      where: {
        token,
        userId
      },
      data: {
        isActive: false
      }
    });
    
    if (result.count > 0) {
      console.log(`✅ Device unregistered for user ${userId}`);
    }
    
    res.json({
      success: true,
      message: 'Device token unregistered'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
