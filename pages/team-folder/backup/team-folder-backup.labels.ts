export const teamFolderBackupLabels = {
  main: 'Team Folder recovery',
  teamFoldersTab: 'Team Folders',
  backupsTab: 'Backups',
  teamFoldersPanel: 'Team Folders',
  backupsPanel: 'Backups',
  notifications: 'Notifications',
  searchTeamFolders: 'Search Team Folders',
  searchFoldersAndFiles: 'Search Folders/Files',
  loading: 'Loading...',
  nextPage: 'Next page',
} as const;

export const teamFolderBackupPatterns = {
  pagination: /\d+\s*[–-]\s*\d+\s+of\s+\d+/,
  backupInProgress: /backup.{0,60}in progress/i,
} as const;
