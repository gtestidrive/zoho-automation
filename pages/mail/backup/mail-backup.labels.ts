export const mailBackupLabels = {
  main: 'Mail recovery',
  usersTab: 'Users',
  backupsTab: 'Backups',
  usersPanel: 'Users',
  backupsPanel: 'Backups',
  notifications: 'Notifications',
  backupNow: 'Backup now',
  searchUsers: 'Search Users',
  loading: 'Loading...',
} as const;

export const mailBackupPatterns = {
  allUsers: /All users/,
  backupInProgress: /backup.{0,60}in progress/i,
} as const;
