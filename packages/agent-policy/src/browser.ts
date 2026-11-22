/**
 * Whether acting on a control of a web page commits something the user should approve first:
 * paying, buying, ordering, sending, deleting, transferring, subscribing, donating.
 *
 * The name is the control's accessible name as the page itself reports it, read by the server from
 * its own snapshot of the page, never from what the model says it is clicking. Only buttons, links
 * and menu items count: a heading or a text that mentions payment acts on nothing.
 *
 * Deliberately narrow, so that browsing stays unasked: an English name must start with the verb
 * ("Pay now", "Delete account"; not "Payment methods" or "Order history"), and a Chinese one must
 * hold the verb without a noun that turns it into a page about it ("支付方式", "删除线", "支付宝").
 */

const ACTING_ROLES = new Set(['button', 'link', 'menuitem']);

const ENGLISH =
  /^(?:pay|buy|purchase|check\s?out|proceed\s+to\s+(?:check\s?out|payment)|(?:place|submit|complete|confirm)\s+(?:(?:my|your|the)\s+)?(?:order|purchase|payment)|confirm\s+and\s+pay|order\s+now|send|delete|remove|transfer|subscribe|donate)\b/i;

const CHINESE =
  /(?:付款|支付|购买|下单|提交订单|结算|发送|删除|移除|转账|订阅|捐款|捐赠)(?!方式|记录|历史|设置|[宝线中]|说明|成功|失败)/;

/** Leading icons, bullets and punctuation a control's name often starts with ("🛒 Buy", "+ Delete"). */
const leading = /^[^\p{L}\p{N}]+/u;

export const isConsequentialControl = (control: { name?: string; role?: string }) => {
  if (!control.role || !ACTING_ROLES.has(control.role.toLowerCase())) return false;
  const name = (control.name ?? '').replace(leading, '').trim();
  if (!name) return false;
  return ENGLISH.test(name) || CHINESE.test(name);
};

/** Keys that act on what has focus: they submit a form or press the focused button or link. */
const ACTIVATING_KEYS = new Set(['enter', 'numpadenter', ' ', 'space', 'spacebar']);

export const isActivatingKey = (key: string) =>
  ACTIVATING_KEYS.has(key === ' ' ? key : key.trim().toLowerCase());
