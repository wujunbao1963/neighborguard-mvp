// ============================================================================
// Config Routes - Zone Types and Event Types
// Phase 1: Public configuration endpoints
// ============================================================================

const express = require('express');
const router = express.Router();
const prisma = require('../config/database');

// ============================================================================
// GET /api/config/zones - Get all zone type configurations
// ============================================================================
router.get('/zones', async (req, res, next) => {
  try {
    const { houseType } = req.query;

    let zoneTypes = await prisma.zoneTypeConfig.findMany({
      orderBy: { displayOrder: 'asc' }
    });

    // Filter by house type if provided
    if (houseType) {
      zoneTypes = zoneTypes.filter(z => 
        z.supportedHouseTypes.includes(houseType.toUpperCase())
      );
    }

    // Group by zone group
    const grouped = zoneTypes.reduce((acc, zone) => {
      if (!acc[zone.zoneGroup]) {
        acc[zone.zoneGroup] = [];
      }
      acc[zone.zoneGroup].push(zone);
      return acc;
    }, {});

    res.json({
      success: true,
      zoneTypes,
      grouped,
      groups: {
        front: { label: '前区', icon: '🏡', description: '房屋正面区域' },
        side: { label: '侧区', icon: '↔️', description: '房屋侧面区域' },
        back: { label: '后区', icon: '🌲', description: '房屋背面区域' },
        garage: { label: '车库区', icon: '🚗', description: '车库及车道' },
        special: { label: '特殊区域', icon: '⭐', description: '公寓/特殊位置' }
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/config/event-types - Get all event type configurations
// ============================================================================
router.get('/event-types', async (req, res, next) => {
  try {
    const eventTypes = await prisma.eventTypeConfig.findMany({
      orderBy: { displayOrder: 'asc' }
    });

    res.json({
      success: true,
      eventTypes: eventTypes.map(et => ({
        value: et.value,
        label: et.label,
        labelEn: et.labelEn,
        icon: et.icon,
        severity: et.severity,
        description: et.description,
        descriptionEn: et.descriptionEn,
        allowedZones: et.allowedZones
      }))
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/config/event-zone-whitelist - Get event type to zone whitelist
// ============================================================================
router.get('/event-zone-whitelist', async (req, res, next) => {
  try {
    const eventTypes = await prisma.eventTypeConfig.findMany();

    const whitelist = eventTypes.reduce((acc, et) => {
      acc[et.value] = et.allowedZones;
      return acc;
    }, {});

    res.json({
      success: true,
      whitelist
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/config/house-types - Get house type options
// ============================================================================
router.get('/house-types', async (req, res, next) => {
  try {
    res.json({
      success: true,
      houseTypes: [
        { value: 'DETACHED', label: '独立屋', labelEn: 'Detached House' },
        { value: 'SEMI', label: '半独立屋', labelEn: 'Semi-detached' },
        { value: 'ROW', label: '联排屋', labelEn: 'Townhouse' },
        { value: 'APARTMENT', label: '公寓', labelEn: 'Apartment' }
      ]
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/config/severities - Get severity options
// ============================================================================
router.get('/severities', async (req, res, next) => {
  try {
    res.json({
      success: true,
      severities: [
        { value: 'HIGH', label: '高风险', labelEn: 'High', color: '#ef4444', icon: '🚨' },
        { value: 'MEDIUM', label: '中风险', labelEn: 'Medium', color: '#f59e0b', icon: '⚠️' },
        { value: 'LOW', label: '低风险', labelEn: 'Low', color: '#22c55e', icon: '📋' }
      ]
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/config/statuses - Get event status options
// ============================================================================
router.get('/statuses', async (req, res, next) => {
  try {
    res.json({
      success: true,
      statuses: [
        { value: 'OPEN', label: '待处理', labelEn: 'Open', icon: '🔵' },
        { value: 'ACKED', label: '已确认', labelEn: 'Acknowledged', icon: '✓' },
        { value: 'WATCHING', label: '观察中', labelEn: 'Watching', icon: '👁️' },
        { value: 'RESOLVED_OK', label: '已安全解决', labelEn: 'Resolved', icon: '✅' },
        { value: 'RESOLVED_WARNING', label: '有损失', labelEn: 'Warning', icon: '⚠️' },
        { value: 'ESCALATED', label: '已报警', labelEn: 'Escalated', icon: '🚨' },
        { value: 'FALSE_ALARM', label: '误报', labelEn: 'False Alarm', icon: 'ℹ️' }
      ]
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// GET /api/config/roles - Get member role options
// ============================================================================
router.get('/roles', async (req, res, next) => {
  try {
    res.json({
      success: true,
      roles: [
        { value: 'OWNER', label: '屋主', labelEn: 'Owner', description: '房屋拥有者，可管理所有设置和成员' },
        { value: 'HOUSEHOLD', label: '同住人', labelEn: 'Household', description: '与屋主同住的家人' },
        { value: 'NEIGHBOR', label: '邻居', labelEn: 'Neighbor', description: '住在附近的邻居' },
        { value: 'RELATIVE', label: '亲属', labelEn: 'Relative', description: '不住一起的亲属' },
        { value: 'OBSERVER', label: '观察者', labelEn: 'Observer', description: '围观但不负责的人' }
      ]
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
