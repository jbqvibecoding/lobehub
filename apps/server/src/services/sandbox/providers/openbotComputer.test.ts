import { BlockList, isIP } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

const sandbox = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock('@/envs/sandbox', () => ({ sandboxEnv: sandbox.env }));

const { egressPolicyFor, OpenBotComputer } = await import('./openbotComputer');

/** Whether the pushed policy lets a computer connect to this address (as agent-computer judges it). */
const allows = (address: string) => {
  const { rules } = egressPolicyFor('public');
  return rules.some(({ value }) => {
    const [network, prefix] = value.split('/');
    const family = isIP(network) === 6 ? 'ipv6' : 'ipv4';
    if ((isIP(address) === 6 ? 'ipv6' : 'ipv4') !== family) return false;
    const list = new BlockList();
    list.addSubnet(network, Number(prefix), family);
    return list.check(address, family);
  });
};

describe('egressPolicyFor', () => {
  it('lets a computer reach the public internet', () => {
    for (const address of [
      '1.1.1.1',
      '8.8.8.8',
      '93.184.216.34',
      '100.128.0.1',
      '172.32.0.1',
      '192.169.0.1',
      '223.5.5.5',
      '2606:4700::1111',
    ]) {
      expect(allows(address), address).toBe(true);
    }
  });

  it('keeps it off private networks, the host and loopback', () => {
    for (const address of [
      '10.0.0.5',
      '172.17.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '127.0.0.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      'fd00::1',
      '::1',
      '2002:a00:1::1',
    ]) {
      expect(allows(address), address).toBe(false);
    }
  });

  it('opens or closes everything when the deployment says so', () => {
    expect(egressPolicyFor('all')).toEqual({ mode: 'allow_all', rules: [] });
    expect(egressPolicyFor('none')).toEqual({ mode: 'deny_all', rules: [] });
  });
});

describe('OpenBotComputer ids', () => {
  it('gives the coding computer an id of its own, in either scope', () => {
    const owner = { topicId: 'tpc-1', userId: 'user-1' };

    const biber = new OpenBotComputer(owner).id;
    const coding = new OpenBotComputer({ ...owner, purpose: 'coding' }).id;
    expect(biber).toMatch(/^u-[\da-f]{40}$/);
    expect(coding).toMatch(/^c-[\da-f]{40}$/);
    expect(coding.slice(2)).toBe(biber.slice(2));

    sandbox.env.OPENBOT_COMPUTER_SCOPE = 'topic';
    try {
      expect(new OpenBotComputer(owner).id).toMatch(/^t-/);
      expect(new OpenBotComputer({ ...owner, purpose: 'coding' }).id).toMatch(/^ct-/);
    } finally {
      delete sandbox.env.OPENBOT_COMPUTER_SCOPE;
    }
  });
});
