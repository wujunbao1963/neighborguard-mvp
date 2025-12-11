// ============================================================================
// Notification Service - Send push notifications to circle members
// ============================================================================

const prisma = require('../config/database');
const apnsService = require('./apnsService');

class NotificationService {
  
  // Send notification to all members of a circle (except excludeUserId)
  async notifyCircleMembers(circleId, payload, options = {}) {
    const { excludeUserId, severityFilter } = options;
    
    if (!apnsService.isConfigured()) {
      console.log('⏭️ APNs not configured, skipping notifications');
      return { sent: 0, failed: 0 };
    }
    
    try {
      // Get circle info
      const circle = await prisma.circle.findUnique({
        where: { id: circleId },
        select: { displayName: true }
      });
      
      if (!circle) {
        console.error(`Circle not found: ${circleId}`);
        return { sent: 0, failed: 0 };
      }
      
      // Build query for members who should receive notifications
      const memberWhere = {
        circleId,
        leftAt: null
      };
      
      // Filter by severity preference
      if (severityFilter === 'HIGH') {
        memberWhere.notifyOnHighSeverity = true;
      } else if (severityFilter === 'MEDIUM') {
        memberWhere.notifyOnMediumSeverity = true;
      } else if (severityFilter === 'LOW') {
        memberWhere.notifyOnLowSeverity = true;
      }
      
      // Get members with their device tokens
      const members = await prisma.circleMember.findMany({
        where: memberWhere,
        select: {
          userId: true,
          user: {
            select: {
              id: true,
              deviceTokens: {
                where: { isActive: true },
                select: { token: true, id: true }
              }
            }
          }
        }
      });
      
      let sent = 0;
      let failed = 0;
      
      for (const member of members) {
        // Skip excluded user (usually the event creator)
        if (excludeUserId && member.userId === excludeUserId) {
          continue;
        }
        
        // Send to all active devices of this member
        for (const device of member.user.deviceTokens) {
          const result = await apnsService.sendNotification(device.token, payload);
          
          if (result.success) {
            sent++;
          } else {
            failed++;
            
            // Remove invalid tokens
            if (result.shouldRemoveToken) {
              console.log(`🗑️ Removing invalid token: ${device.token.substring(0, 16)}...`);
              await prisma.deviceToken.delete({
                where: { id: device.id }
              }).catch(() => {});
            }
          }
        }
      }
      
      if (sent > 0 || failed > 0) {
        console.log(`📤 Notifications: ${sent} sent, ${failed} failed`);
      }
      return { sent, failed };
      
    } catch (error) {
      console.error('❌ Error sending notifications:', error);
      return { sent: 0, failed: 0, error: error.message };
    }
  }
  
  // Notify about a new event
  async notifyNewEvent(event, circle, excludeUserId) {
    const payload = apnsService.buildEventPayload(event, circle.displayName);
    
    return this.notifyCircleMembers(event.circleId, payload, {
      excludeUserId,
      severityFilter: event.severity
    });
  }
  
  // Notify about event update (resolved, new comment, etc.)
  async notifyEventUpdate(event, circle, updateType, excludeUserId) {
    const payload = apnsService.buildEventUpdatePayload(event, circle.displayName, updateType);
    
    return this.notifyCircleMembers(event.circleId, payload, {
      excludeUserId
    });
  }
}

module.exports = new NotificationService();
