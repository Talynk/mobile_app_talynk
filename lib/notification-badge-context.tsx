import React, { createContext, useContext, useCallback } from 'react';
import { useUnreadNotifications } from './hooks/use-unread-notifications';

interface NotificationBadgeContextType {
  unreadCount: number;
  refreshCount: () => void;
}

const NotificationBadgeContext = createContext<NotificationBadgeContextType | undefined>(undefined);

export const useNotificationBadge = () => {
  const context = useContext(NotificationBadgeContext);
  if (!context) {
    return {
      unreadCount: 0,
      refreshCount: () => {},
    };
  }
  return context;
};

interface NotificationBadgeProviderProps {
  children: React.ReactNode;
}

export const NotificationBadgeProvider: React.FC<NotificationBadgeProviderProps> = ({ children }) => {
  const { unreadCount, refreshCount } = useUnreadNotifications();

  return (
    <NotificationBadgeContext.Provider value={{ unreadCount, refreshCount }}>
      {children}
    </NotificationBadgeContext.Provider>
  );
};


