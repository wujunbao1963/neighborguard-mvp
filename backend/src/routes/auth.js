// ============================================================================
// Authentication Routes
// Phase 2: Email verification code login
// ============================================================================

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const JWT_ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const CODE_EXPIRES_MINUTES = parseInt(process.env.AUTH_CODE_EXPIRES_MINUTES) || 10;
const CODE_MAX_ATTEMPTS = parseInt(process.env.AUTH_CODE_MAX_ATTEMPTS) || 5;

// Fixed test code for development/testing (set in .env or here)
const TEST_MODE = process.env.AUTH_TEST_MODE === 'true';
const TEST_CODE = process.env.AUTH_TEST_CODE || '587585';

// ============================================================================
// POST /api/auth/request-code - Request verification code
// ============================================================================
router.post('/request-code', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('请提供邮箱地址', 400, 'EMAIL_REQUIRED');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check whitelist
    const whitelist = await prisma.emailWhitelist.findUnique({
      where: { email: normalizedEmail }
    });

    if (!whitelist || !whitelist.isActive) {
      throw new AppError('该邮箱不在邀请名单中', 403, 'NOT_WHITELISTED');
    }

    // Use fixed test code or generate random code
    const code = TEST_MODE ? TEST_CODE : Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + CODE_EXPIRES_MINUTES * 60 * 1000);

    // Invalidate previous codes
    await prisma.authCode.updateMany({
      where: {
        email: normalizedEmail,
        usedAt: null,
        expiresAt: { gt: new Date() }
      },
      data: { expiresAt: new Date() }
    });

    // Create new code
    await prisma.authCode.create({
      data: {
        email: normalizedEmail,
        codeHash,
        expiresAt
      }
    });

    // Log code info
    if (TEST_MODE) {
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  📧 验证码 (测试模式 - 固定验证码)                               ║
║                                                               ║
║  邮箱: ${normalizedEmail.padEnd(50)}║
║  验证码: ${TEST_CODE}                                        ║
║  有效期: ${CODE_EXPIRES_MINUTES} 分钟                                            ║
╚═══════════════════════════════════════════════════════════════╝
      `);
    } else if (process.env.DEV_SKIP_EMAIL === 'true') {
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  📧 验证码 (开发模式)                                           ║
║                                                               ║
║  邮箱: ${normalizedEmail.padEnd(50)}║
║  验证码: ${code}                                               ║
║  有效期: ${CODE_EXPIRES_MINUTES} 分钟                                            ║
╚═══════════════════════════════════════════════════════════════╝
      `);
    } else {
      // TODO: Send actual email in production
      console.log(`Would send email to ${normalizedEmail} with code ${code}`);
    }

    res.json({
      success: true,
      message: '验证码已发送',
      expiresIn: CODE_EXPIRES_MINUTES * 60
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/auth/login - Verify code and login
// ============================================================================
router.post('/login', async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      throw new AppError('请提供邮箱和验证码', 400, 'MISSING_CREDENTIALS');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find valid code
    const authCode = await prisma.authCode.findFirst({
      where: {
        email: normalizedEmail,
        usedAt: null,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!authCode) {
      throw new AppError('验证码无效或已过期', 401, 'CODE_INVALID');
    }

    // Check attempts
    if (authCode.attempts >= CODE_MAX_ATTEMPTS) {
      throw new AppError('验证码尝试次数过多，请重新获取', 401, 'TOO_MANY_ATTEMPTS');
    }

    // Verify code
    const isValid = await bcrypt.compare(code, authCode.codeHash);
    
    if (!isValid) {
      // Increment attempts
      await prisma.authCode.update({
        where: { id: authCode.id },
        data: { attempts: { increment: 1 } }
      });
      throw new AppError('验证码错误', 401, 'CODE_WRONG');
    }

    // Mark code as used
    await prisma.authCode.update({
      where: { id: authCode.id },
      data: { usedAt: new Date() }
    });

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user) {
      // Get display name from whitelist notes or email
      const whitelist = await prisma.emailWhitelist.findUnique({
        where: { email: normalizedEmail }
      });
      
      const displayName = whitelist?.notes?.replace('Test user: ', '') || 
                          normalizedEmail.split('@')[0];

      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          displayName,
          emailVerified: true,
          isActive: true
        }
      });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_ACCESS_EXPIRES }
    );

    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    
    // Parse refresh expiry
    const refreshDays = parseInt(JWT_REFRESH_EXPIRES) || 7;
    const refreshExpiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    // Save refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: refreshExpiresAt,
        deviceInfo: req.headers['user-agent'] || 'unknown'
      }
    });

    // Get user's circles
    const memberships = await prisma.circleMember.findMany({
      where: {
        userId: user.id,
        leftAt: null
      },
      include: {
        circle: {
          include: {
            home: true
          }
        }
      }
    });

    const circles = memberships.map(m => ({
      id: m.circle.id,
      displayName: m.circle.displayName,
      role: m.role,
      home: m.circle.home ? {
        displayName: m.circle.home.displayName,
        houseType: m.circle.home.houseType
      } : null
    }));

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        phone: user.phone
      },
      circles,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: JWT_ACCESS_EXPIRES
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/auth/refresh - Refresh access token
// ============================================================================
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('请提供刷新令牌', 400, 'REFRESH_TOKEN_REQUIRED');
    }

    // Find valid refresh tokens for comparison
    const tokens = await prisma.refreshToken.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      include: { user: true }
    });

    // Find matching token
    let validToken = null;
    for (const token of tokens) {
      const isMatch = await bcrypt.compare(refreshToken, token.tokenHash);
      if (isMatch) {
        validToken = token;
        break;
      }
    }

    if (!validToken) {
      throw new AppError('刷新令牌无效或已过期', 401, 'REFRESH_TOKEN_INVALID');
    }

    if (!validToken.user.isActive || validToken.user.deletedAt) {
      throw new AppError('用户已被禁用', 401, 'USER_DISABLED');
    }

    // Generate new access token
    const accessToken = jwt.sign(
      { userId: validToken.user.id, email: validToken.user.email },
      JWT_SECRET,
      { expiresIn: JWT_ACCESS_EXPIRES }
    );

    res.json({
      success: true,
      accessToken,
      expiresIn: JWT_ACCESS_EXPIRES
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /api/auth/logout - Revoke refresh token
// ============================================================================
router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Find and revoke the token
      const tokens = await prisma.refreshToken.findMany({
        where: {
          revokedAt: null
        }
      });

      for (const token of tokens) {
        const isMatch = await bcrypt.compare(refreshToken, token.tokenHash);
        if (isMatch) {
          await prisma.refreshToken.update({
            where: { id: token.id },
            data: { revokedAt: new Date() }
          });
          break;
        }
      }
    }

    res.json({
      success: true,
      message: '已退出登录'
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/auth/me - Get current user
// ============================================================================
router.get('/me', authenticate, async (req, res, next) => {
  try {
    // Get user's circles
    const memberships = await prisma.circleMember.findMany({
      where: {
        userId: req.user.id,
        leftAt: null
      },
      include: {
        circle: {
          include: {
            home: true,
            _count: {
              select: {
                members: { where: { leftAt: null } },
                events: { where: { deletedAt: null } }
              }
            }
          }
        }
      }
    });

    const circles = memberships.map(m => ({
      id: m.circle.id,
      displayName: m.circle.displayName,
      role: m.role,
      memberDisplayName: m.displayName,
      home: m.circle.home ? {
        id: m.circle.home.id,
        displayName: m.circle.home.displayName,
        houseType: m.circle.home.houseType,
        city: m.circle.home.city
      } : null,
      memberCount: m.circle._count.members,
      eventCount: m.circle._count.events
    }));

    res.json({
      success: true,
      user: req.user,
      circles
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PUT /api/auth/me - Update current user profile
// ============================================================================
router.put('/me', authenticate, async (req, res, next) => {
  try {
    const { displayName, phone, avatarUrl } = req.body;

    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (phone !== undefined) updateData.phone = phone;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        phone: true
      }
    });

    res.json({
      success: true,
      user
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
