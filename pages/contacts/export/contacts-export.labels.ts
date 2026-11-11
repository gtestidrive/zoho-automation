export const contactsExportLabels = {
  export: 'Export',
  exports: 'Exports',
  loading: 'Loading...',
  next: 'Next page',
  previous: 'Previous page',
  format: 'VCF (vCard)',
} as const;

export const contactsExportPatterns = {
  pagination: /\d+\s*[–-]\s*\d+\s+of\s+\d+/,
  selected: /^selected items/i,
  download: /download/i,
} as const;
