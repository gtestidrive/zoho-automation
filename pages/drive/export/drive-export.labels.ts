export const exportLabels = {
  main: 'Drive recovery',
  loading: 'Loading...',
} as const;

export const exportPatterns = {
  exportButton: /^export$/i,
  exportDialog: /^export$/i,
  selectedItemsRadio: /^selected items/i,
  exportsTab: /^exports?$/i,
  download: /download/i,
  active: /^active$/i,
  failed: /^failed\b/i,
  status: /\b(?:active|failed)\b/i,
  zipFile: /\.zip$/i,
  keepDownload: /^keep(?: anyway)?$/i,
} as const;
