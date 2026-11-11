export const backupLabels = {
  main: 'Drive recovery',
  usersTable: 'Users',
  usersTab: 'Users',
  backupsTab: 'Backups',
  backupNowButton: 'Backup now',
  notificationsRegion: 'Notifications',
  selectUserButton: 'Select User',
  searchButton: 'Search',
  loading: 'Loading...',
  myFolderBreadcrumb: 'My Folder',
  nextPageButton: 'Next page',
  previousPageButton: 'Previous page',
  folderType: 'Folder',
  fileType: 'File',
  emptyFolderMessage: 'No folders found',
} as const;

export const backupPatterns = {
  email: /[^\s@]+@[^\s@]+\.[^\s@]+/,
  pagination: /\d+\s*[–-]\s*\d+\s+of\s+\d+/,
  backupInProgress: /backup.{0,60}in progress/i,
  backupTimestamp: /\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}\s+(AM|PM)/i,
} as const;
