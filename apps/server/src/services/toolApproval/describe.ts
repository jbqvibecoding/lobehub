import { parseToolArguments, REDACTED, redactForAudit } from '@lobechat/agent-policy';

const MAX_DETAILS = 4;
const MAX_VALUE_LENGTH = 120;

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

/**
 * A tool call as a person reads it in a notification or a chat: the action, the tool, and the
 * arguments that say who or what it targets. Message content and credentials are left out, since
 * these surfaces leave the app (push services, chat platforms).
 */
export const describeApprovalCall = ({
  apiName,
  arguments: args,
  identifier,
}: {
  apiName: string;
  arguments?: string;
  identifier?: string;
}) => {
  const kept = redactForAudit(parseToolArguments(args)) as Record<string, unknown>;
  const details = Object.entries(kept)
    .filter(
      ([, value]) => value !== REDACTED && value !== '' && value !== null && value !== undefined,
    )
    .slice(0, MAX_DETAILS)
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return `${humanize(key)}: ${shorten(text)}`;
    });

  return {
    details,
    title: identifier ? `${humanize(apiName)} · ${identifier}` : humanize(apiName),
  };
};
