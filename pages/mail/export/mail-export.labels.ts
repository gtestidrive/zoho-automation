export const mailExportLabels = {
  inbox: 'Inbox',
  export: 'Export',
  exports: 'Exports',
  loading: 'Loading...',
  next: 'Next page',
  previous: 'Previous page',
  format: 'ZIP Archive',
} as const;

export const mailExportPatterns = {
  pagination: /\d+\s*[–-]\s*\d+\s+of\s+\d+/,
  selected: /^selected items/i,
} as const;
