export const ComputerApiName = {
  /** Click a ref from the latest snapshot */
  click: 'click',

  /** Click a button that pays, orders, sends or deletes, after the user approves it */
  clickWithApproval: 'clickWithApproval',

  /** Open a URL and read the page */
  navigate: 'navigate',

  /** Press a key, on a ref or on the page */
  pressKey: 'pressKey',

  /** Press a key that would submit such a form or press such a button, after the user approves it */
  pressKeyWithApproval: 'pressKeyWithApproval',

  /** Read the page as it is now */
  read: 'read',

  /** Ask the person to take over the browser */
  requestHelp: 'requestHelp',

  /** Scroll the page */
  scroll: 'scroll',

  /** List the page's fields, buttons and links with refs */
  snapshot: 'snapshot',

  /** Put text into a field */
  type: 'type',
} as const;

export type ComputerApiNameType = (typeof ComputerApiName)[keyof typeof ComputerApiName];

export interface NavigateParams {
  url: string;
}

export interface ClickParams {
  ref: string;
  snapshotId: number;
}

export interface ClickWithApprovalParams extends ClickParams {
  /** The control's name, exactly as the snapshot gave it */
  element: string;
  /** The page's origin, exactly as the snapshot gave it */
  site: string;
}

export interface TypeParams {
  ref: string;
  snapshotId: number;
  submit?: boolean;
  text: string;
}

export interface PressKeyParams {
  key: string;
  ref?: string;
  snapshotId?: number;
}

export interface PressKeyWithApprovalParams {
  /** The button the key would press or the form's, exactly as the snapshot gave it */
  element: string;
  key: string;
  ref?: string;
  /** The page's origin, exactly as the snapshot gave it */
  site: string;
  snapshotId: number;
}

export interface ScrollParams {
  deltaY?: number;
}

export interface RequestHelpParams {
  reason: string;
}
