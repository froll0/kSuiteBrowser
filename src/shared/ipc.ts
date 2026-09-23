/** IPC channel names shared by main, preload and renderer. */
export const IPC = {
  // renderer -> main (invoke)
  tabsCreate: 'tabs:create',
  tabsClose: 'tabs:close',
  tabsActivate: 'tabs:activate',
  tabsNavigate: 'tabs:navigate',
  tabsBack: 'tabs:back',
  tabsForward: 'tabs:forward',
  tabsReload: 'tabs:reload',
  tabsStop: 'tabs:stop',
  tabsList: 'tabs:list',
  openApp: 'ksuite:open-app',
  setContentBounds: 'layout:content-bounds',
  showAppMenu: 'ui:app-menu',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  tokenStatus: 'token:status',
  tokenSet: 'token:set',
  tokenClear: 'token:clear',

  apiProfile: 'api:profile',
  apiDrives: 'api:drives',
  apiDriveList: 'api:drive-list',
  apiDriveSearch: 'api:drive-search',
  apiDriveDownload: 'api:drive-download',
  apiDriveUpload: 'api:drive-upload',
  apiDriveOpenWeb: 'api:drive-open-web',
  apiSavePageToDrive: 'api:save-page-to-drive',
  apiMailOverview: 'api:mail-overview',
  apiMailSend: 'api:mail-send',
  apiCalendarUpcoming: 'api:calendar-upcoming',
  apiCalendarCreate: 'api:calendar-create',

  downloadsList: 'downloads:list',
  downloadsOpen: 'downloads:open',

  // main -> renderer (events)
  evTabs: 'ev:tabs',
  evDownloads: 'ev:downloads',
  evFocusAddress: 'ev:focus-address',
  evTogglePanel: 'ev:toggle-panel',
  evComposeMail: 'ev:compose-mail',
  evToast: 'ev:toast',
  evOpenSettings: 'ev:open-settings',
} as const;
