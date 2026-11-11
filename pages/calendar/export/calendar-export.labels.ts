export const calendarExportLabels = {
  export: 'Export',
  exports: 'Exports',
  format: 'ZIP Archive',
  loading: 'Loading...',
  next: 'Next page',
  previous: 'Previous page',
} as const;

export const calendarExportPatterns = {
  pagination: /(\d+)\s*[\u2013-]\s*(\d+)\s+of\s+(\d+)/,
  selected: /Selected Items \(\d+\)/i,
  download: /download/i,
} as const;
