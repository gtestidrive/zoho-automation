export const recoveryTabs = ['Mail', 'Contacts', 'Drive', 'Calendar', 'Team folder'] as const;
export type RecoveryTab = (typeof recoveryTabs)[number];

export const recoveryPages: Record<RecoveryTab, { path: string; heading: string }> = {
  Mail: { path: '/zoho/recovery/mail', heading: 'Mail' },
  Contacts: { path: '/zoho/recovery/contacts', heading: 'Contacts' },
  Drive: { path: '/zoho/recovery/drive', heading: 'Drive' },
  Calendar: { path: '/zoho/recovery/calendars', heading: 'Calendar' },
  'Team folder': { path: '/zoho/recovery/team-folder', heading: 'Team Folder' },
};
