import type { PendingApproval } from './types';

const MAX_VALUE_LENGTH = 160;
const MAX_FIELDS = 6;

export interface ToolCallSummary {
  /** The tool or connector the call goes to. */
  connector: string;
  /** The arguments that matter most, as label and value, shortened for a card. */
  fields: { label: string; value: string }[];
  /** `send_email` and `sendEmail` both read "Send email". */
  title: string;
}

const humanize = (name: string) => {
  const words = name
    .replaceAll(/([\da-z])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
};

const shorten = (value: string) =>
  value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value;

const toText = (value: unknown) =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));

/** What the approval card shows: exactly what the agent wants to do, readable at a glance. */
export const describeToolCall = (approval: PendingApproval): ToolCallSummary => {
  let fields: ToolCallSummary['fields'] = [];

  if (approval.arguments) {
    try {
      const parsed: unknown = JSON.parse(approval.arguments);
      fields =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.entries(parsed as Record<string, unknown>)
              .filter(([, value]) => value !== undefined && value !== null && value !== '')
              .slice(0, MAX_FIELDS)
              .map(([key, value]) => ({ label: humanize(key), value: shorten(toText(value)) }))
          : [{ label: 'Input', value: shorten(toText(parsed)) }];
    } catch {
      fields = [{ label: 'Input', value: shorten(approval.arguments) }];
    }
  }

  return {
    connector: approval.identifier ?? approval.type,
    fields,
    title: humanize(approval.apiName ?? 'Tool call'),
  };
};
