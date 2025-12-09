import { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { useCircle } from './context/CircleContext';
import LoginPage from './components/LoginPage';
import HomePage from './pages/HomePage';
import TimelinePage from './pages/TimelinePage';
import SettingsPage from './pages/SettingsPage';
import CreateEventModal from './components/CreateEventModal';
import EventDetailModal from './components/EventDetailModal';
import LoadingSpinner from './components/LoadingSpinner';

function App() {
  const { user, circles, loading: authLoading, isAuthenticated, logout } = useAuth();
  const { currentCircle, currentCircleId, selectCircle, loading: circleLoading, resetCircle } = useCircle();
  
  const [currentView, setCurrentView] = useState('home');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Handle logout
  const handleLogout = async () => {
    resetCircle();
    await logout();
  };

  // Auto-select circle - prioritize circles where user is OWNER
  useEffect(() => {
    if (!isAuthenticated || circles.length === 0) return;
    
    // Find circle where user is OWNER
    const ownerCircle = circles.find(c => c.role === 'OWNER');
    const defaultCircle = ownerCircle || circles[0];
    
    // If no circle selected, or current selection is invalid, select default
    if (!currentCircleId) {
      selectCircle(defaultCircle.id);
    } else if (!currentCircle && !circleLoading) {
      const validCircle = circles.find(c => c.id === currentCircleId);
      if (!validCircle) {
        // Current circle invalid, select default (prefer OWNER)
        selectCircle(defaultCircle.id);
      } else {
        selectCircle(currentCircleId);
      }
    }
  }, [isAuthenticated, circles, currentCircleId, currentCircle, circleLoading, selectCircle]);

  if (authLoading) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const getRoleLabel = (role) => {
    const labels = {
      OWNER: '屋主',
      HOUSEHOLD: '同住人',
      NEIGHBOR: '邻居',
      RELATIVE: '远程亲属',
      OBSERVER: '观察者'
    };
    return labels[role] || role;
  };

  const handleViewEvent = (event) => {
    setSelectedEvent(event);
  };

  const handleCircleChange = (circleId) => {
    selectCircle(circleId);
  };

  // Get current user's role in current circle
  const currentMembership = circles.find(c => c.id === currentCircleId);
  const currentRole = currentMembership?.role || 'NEIGHBOR';

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>🛡️ NeighborGuard</h1>
            <div className="header-subtitle">
              当前用户: {user?.displayName} ({getRoleLabel(currentRole)}) - {currentCircle?.displayName || '加载中...'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Circle Selector */}
            {circles.length > 1 && (
              <select
                className="header-select"
                value={currentCircleId || ''}
                onChange={(e) => handleCircleChange(e.target.value)}
              >
                {circles.map(circle => (
                  <option key={circle.id} value={circle.id}>
                    {circle.displayName} - {getRoleLabel(circle.role)}
                  </option>
                ))}
              </select>
            )}
            {/* Logout Button */}
            <button 
              onClick={handleLogout}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px'
              }}
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="nav-tabs">
        {[
          { id: 'home', label: '守望首页', icon: '🏠' },
          { id: 'timeline', label: '时间线', icon: '📅' },
          { id: 'settings', label: '设置', icon: '⚙️' }
        ].map(tab => (
          <button
            key={tab.id}
            className={`nav-tab ${currentView === tab.id ? 'active' : ''}`}
            onClick={() => setCurrentView(tab.id)}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="content">
        {circleLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <LoadingSpinner size="lg" />
          </div>
        ) : !currentCircle ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏠</div>
            <div>还没有加入任何圈子</div>
          </div>
        ) : (
          <>
            {currentView === 'home' && (
              <HomePage
                onCreateEvent={() => setShowCreateModal(true)}
                onViewEvent={handleViewEvent}
              />
            )}
            {currentView === 'timeline' && (
              <TimelinePage onViewEvent={handleViewEvent} />
            )}
            {currentView === 'settings' && (
              <SettingsPage />
            )}
          </>
        )}
      </div>

      {/* Create Event Modal */}
      {showCreateModal && (
        <CreateEventModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={(event) => {
            setShowCreateModal(false);
            setSelectedEvent(event);
          }}
        />
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <EventDetailModal
          eventId={selectedEvent.id}
          circleId={selectedEvent.circleId || currentCircleId}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

export default App;
