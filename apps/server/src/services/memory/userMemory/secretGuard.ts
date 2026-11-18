import { findSecrets } from '@lobechat/agent-policy';
import type { MemoryRuntimeService } from '@lobechat/builtin-tool-memory/executionRuntime';

/**
 * What the agent reads when it tries to save a secret as a memory. Memories are given to the model
 * on every run and shown in the apps, so a password kept there is a password sent everywhere.
 */
export const MEMORY_SECRET_REFUSAL =
  'Not saved: this memory contains what looks like a password, key, card number or identity ' +
  'number. Secrets are never kept in memory. Tell the user so, and suggest a password manager.';

/** The memory tool's writes: what the agent asks to remember. */
const WRITES = new Set<keyof MemoryRuntimeService>([
  'addActivityMemory',
  'addContextMemory',
  'addExperienceMemory',
  'addIdentityMemory',
  'addPreferenceMemory',
  'updateIdentityMemory',
]);

/** Whether a memory the agent asked to save carries a secret; then it is refused, not masked. */
export const holdsSecret = (input: unknown) => findSecrets(input).length > 0;

/** The memory tool's service with every write that carries a secret refused. */
export const refuseSecretMemories = <T extends MemoryRuntimeService>(service: T): T =>
  new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || !WRITES.has(property as keyof MemoryRuntimeService)) {
        return value;
      }
      return (input: unknown) =>
        holdsSecret(input)
          ? Promise.resolve({ message: MEMORY_SECRET_REFUSAL, success: false })
          : value.call(target, input);
    },
  });
