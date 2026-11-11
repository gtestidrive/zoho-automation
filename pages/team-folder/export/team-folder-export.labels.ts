export const teamFolderExportLabels = {
  product: 'Zoho C2C Team Folder',
  main: 'Team Folder recovery',
  loading: 'Loading...',
  nextPage: 'Next page',
  previousPage: 'Previous page',
} as const;

export const teamFolderExportPatterns = {
  pagination: /\d+\s*[–-]\s*\d+\s+of\s+\d+/,
} as const;
