export const calendarBackupLabels = {
  usersTab: 'Users',
  backupsTab: 'Backups',
  usersPanel: 'Users',
  backupsPanel: 'Backups',
  notifications: 'Notifications',
  allUsers: /All users/,
  searchUsers: 'Search Users',
  backupNow: /Backup now/i,
  loading: 'Loading...',
} as const;

export const calendarBackupPatterns = {
  backupInProgress: /backup.{0,60}in progress/i,
} as const;
