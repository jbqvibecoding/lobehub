// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { userMemoriesRouter } from '.';
import { queryRouter } from './query';
import { reEmbedRouter } from './reEmbed';
import { searchRouter } from './search';
import { toolWriteRouter } from './toolWrite';

/**
 * Pins the router's public surface: every procedure path, its kind, and its
 * middleware chain length (which encodes the procedure builder and its input
 * parsers). Splitting the router across files must keep all three.
 */
describe('userMemoriesRouter procedures', () => {
  const procedures = (userMemoriesRouter as any)._def.procedures as Record<string, any>;

  it('exposes exactly the expected procedure paths', () => {
    expect(Object.keys(procedures).sort()).toEqual(expected().map(([name]) => name));
  });

  it.each([
    ['queryRouter', queryRouter],
    ['reEmbedRouter', reEmbedRouter],
    ['searchRouter', searchRouter],
    ['toolWriteRouter', toolWriteRouter],
  ])('%s declares its procedures in alphabetical order', (_name, subRouter) => {
    const names = Object.keys((subRouter as any)._def.procedures);
    expect(names).toEqual([...names].sort());
  });

  it.each(expected())('%s is a %s with %i middlewares', (name, type, middlewares) => {
    expect(procedures[name]._def.type).toBe(type);
    expect(procedures[name]._def.middlewares).toHaveLength(middlewares);
  });
});

function expected(): Array<
  [name: string, type: 'mutation' | 'query' | 'subscription', middlewares: number]
> {
  return [
    ['getMemoryDetail', 'query', 11],
    ['queryActivities', 'query', 12],
    ['queryExperiences', 'query', 12],
    ['queryIdentities', 'query', 12],
    ['queryIdentitiesForInjection', 'query', 11],
    ['queryIdentityRoles', 'query', 11],
    ['queryMemories', 'query', 12],
    ['queryTags', 'query', 11],
    ['queryTaxonomyOptions', 'query', 11],
    ['reEmbedMemories', 'mutation', 12],
    ['retrieveMemoryForTopic', 'query', 12],
    ['searchMemory', 'query', 12],
    // The tool writes refuse secrets (Biber), one middleware more than the other writes
    ['toolAddActivityMemory', 'mutation', 13],
    ['toolAddContextMemory', 'mutation', 13],
    ['toolAddExperienceMemory', 'mutation', 13],
    ['toolAddIdentityMemory', 'mutation', 13],
    ['toolAddPreferenceMemory', 'mutation', 13],
    ['toolRemoveIdentityMemory', 'mutation', 12],
    ['toolSearchMemory', 'query', 12],
    ['toolUpdateIdentityMemory', 'mutation', 13],
  ];
}
