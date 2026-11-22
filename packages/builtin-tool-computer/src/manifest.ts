import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ComputerApiName } from './types';

export const ComputerIdentifier = 'lobe-computer';

const REF = { description: 'A ref from the latest snapshot, such as e3', type: 'string' } as const;
const SNAPSHOT_ID = {
  description: 'The snapshotId of the snapshot the ref came from',
  type: 'integer',
} as const;
const ELEMENT = {
  description: "The control's name, exactly as the snapshot gave it",
  type: 'string',
} as const;
const SITE = {
  description: "The page's site, exactly as the snapshot gave it (e.g. https://shop.example)",
  type: 'string',
} as const;
const KEY = {
  description: 'A key name such as Enter, Tab, Escape or ArrowDown',
  type: 'string',
} as const;

export const ComputerManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'Open a web page in your browser and read it: returns its address, title and readable text.',
      name: ComputerApiName.navigate,
      parameters: {
        additionalProperties: false,
        properties: { url: { description: 'The address to open, http or https', type: 'string' } },
        required: ['url'],
        type: 'object',
      },
    },
    {
      description:
        "List the page's fields, buttons and links, each with a ref, its name and its current value (passwords are hidden), plus the page's site and a snapshotId. Take one before acting on a page.",
      name: ComputerApiName.snapshot,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description: 'Read the page as it is now: its address, title and readable text.',
      name: ComputerApiName.read,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description: 'Scroll the page down (or up with a negative amount), to see more of it.',
      name: ComputerApiName.scroll,
      parameters: {
        additionalProperties: false,
        properties: {
          deltaY: { description: 'Pixels to scroll; 600 if not given', type: 'integer' },
        },
        type: 'object',
      },
    },
    {
      description:
        'Click a field, button or link by its ref. A button that pays, buys, orders, sends or deletes is refused here: use clickWithApproval for it.',
      name: ComputerApiName.click,
      parameters: {
        additionalProperties: false,
        properties: { ref: REF, snapshotId: SNAPSHOT_ID },
        required: ['ref', 'snapshotId'],
        type: 'object',
      },
    },
    {
      description:
        'Put text into a field by its ref, replacing what is there; submit presses Enter after it. Never type a password, a code or a card number.',
      name: ComputerApiName.type,
      parameters: {
        additionalProperties: false,
        properties: {
          ref: REF,
          snapshotId: SNAPSHOT_ID,
          submit: { description: 'Press Enter after typing', type: 'boolean' },
          text: { description: 'The text to put in the field', type: 'string' },
        },
        required: ['ref', 'snapshotId', 'text'],
        type: 'object',
      },
    },
    {
      description:
        'Press a key, on a ref or on the page. Enter or Space in a form that pays, orders, sends or deletes is refused here: use pressKeyWithApproval for it.',
      name: ComputerApiName.pressKey,
      parameters: {
        additionalProperties: false,
        properties: { key: KEY, ref: REF, snapshotId: SNAPSHOT_ID },
        required: ['key'],
        type: 'object',
      },
    },
    {
      description:
        'Click a button or link that pays, buys, orders, sends, deletes, transfers or subscribes. The user approves it first, seeing the button and the site.',
      humanIntervention: 'required',
      name: ComputerApiName.clickWithApproval,
      parameters: {
        additionalProperties: false,
        properties: { element: ELEMENT, ref: REF, site: SITE, snapshotId: SNAPSHOT_ID },
        required: ['ref', 'snapshotId', 'element', 'site'],
        type: 'object',
      },
    },
    {
      description:
        'Press Enter or Space where it would submit a form that pays, orders, sends or deletes. The user approves it first, seeing the button and the site.',
      humanIntervention: 'required',
      name: ComputerApiName.pressKeyWithApproval,
      parameters: {
        additionalProperties: false,
        properties: {
          element: {
            ...ELEMENT,
            description:
              'The paying, ordering, sending or deleting button on the page, exactly as the snapshot gave it',
          },
          key: KEY,
          ref: REF,
          site: SITE,
          snapshotId: SNAPSHOT_ID,
        },
        required: ['key', 'snapshotId', 'element', 'site'],
        type: 'object',
      },
    },
    {
      description:
        "List the website logins the user saved for you: each one's loginId, site, account (partly hidden) and name. Passwords are never shown, to you or anyone.",
      name: ComputerApiName.listLogins,
      parameters: { additionalProperties: false, properties: {}, type: 'object' },
    },
    {
      description:
        "Sign in with a saved login. Open the site's sign-in page first; the cloud computer types the user name and password itself and submits, only if the page is on the login's site. The user approves it first, seeing the site and the account. Tells you whether it was submitted and whether the site now asks for a code.",
      humanIntervention: 'required',
      name: ComputerApiName.signIn,
      parameters: {
        additionalProperties: false,
        properties: {
          account: { description: 'The account, exactly as listLogins gave it', type: 'string' },
          loginId: { description: 'The loginId from listLogins', type: 'string' },
          site: { description: "The login's site, exactly as listLogins gave it", type: 'string' },
        },
        required: ['loginId', 'site', 'account'],
        type: 'object',
      },
    },
    {
      description:
        'Ask the user for one value the page needs, such as a code texted to them: they type it on their phone into a masked box and it goes straight into the field, without you seeing it. Snapshot first and give the field. Waits for them for a few minutes.',
      name: ComputerApiName.requestSecret,
      parameters: {
        additionalProperties: false,
        properties: {
          label: {
            description: 'What they are asked for, e.g. "the 6-digit code texted to you"',
            type: 'string',
          },
          ref: { ...REF, description: 'The field the value goes in, from the latest snapshot' },
          snapshotId: SNAPSHOT_ID,
        },
        required: ['ref', 'snapshotId', 'label'],
        type: 'object',
      },
    },
    {
      description:
        'Ask the user to take over the browser for something only they can do: a password, a code, a CAPTCHA, a choice. Say exactly what is needed. They are notified on their phone.',
      name: ComputerApiName.requestHelp,
      parameters: {
        additionalProperties: false,
        properties: {
          reason: { description: 'What the user needs to do, in one sentence', type: 'string' },
        },
        required: ['reason'],
        type: 'object',
      },
    },
  ],
  identifier: ComputerIdentifier,
  meta: {
    avatar: '🖥️',
    description: "Browse and act on web pages in the browser on Biber's cloud computer",
    title: 'Cloud computer browser',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
