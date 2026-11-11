export const contactsBackupLabels = {
  usersTab: 'Users',
  backupsTab: 'Backups',
  restoresTab: 'Restores',
  backupNow: 'Backup now',
  notifications: 'Notifications',
  loading: 'Loading...',
  selectUser: 'Select User',
  search: 'Search',
  nextPage: 'Next page',
  snapshotDateSelector: '.rcv-stat-item--snapshot .ds-datepicker__value',
  restoreDialog: 'Restore',
  restoreTo: 'Restore to',
  activityLogs: 'Activity Logs',
  allEventLogs: 'All Event Logs',
  eventLogsTable: 'All event logs',
  details: 'Details',
  jobDetails: 'Job Details',
} as const;

export const contactsBackupPatterns = {
  pagination: /\d+\s*[–-]\s*\d+\s+of\s+\d+/,
  backupInProgress: /backup.{0,60}in progress/i,
  email: /[^\s@]+@[^\s@]+\.[^\s@]+/,
} as const;
