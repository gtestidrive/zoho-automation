export const contactsRestoreLabels = {
  restoresTab: 'Restores',
  restoreDialog: 'Restore',
  restoreTo: 'Restore to',
  snapshot: 'Snapshot',
  loading: 'Loading...',
} as const;

export const contactsRestorePatterns = {
  newFolder: /New folder/,
  confirmation: /confirm.*restore|are you sure/i,
  confirm: /^(confirm restore|confirm|restore)$/i,
  pagination: /\d+\s*[\u2013-]\s*\d+\s+of\s+\d+/,
} as const;
