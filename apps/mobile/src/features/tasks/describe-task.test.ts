/**
 * @jest-environment node
 */
import { canRunNow, describeActivity, describeStatus, taskTitle } from './describe-task';

describe('describe-task', () => {
  it('names a task by its name, or the first line of its instruction', () => {
    expect(taskTitle({ instruction: 'Ignored', name: 'Weekly report' })).toBe('Weekly report');
    expect(taskTitle({ instruction: 'Book the flights\nOnly direct ones', name: ' ' })).toBe(
      'Book the flights',
    );
    expect(taskTitle({ instruction: 'x'.repeat(200) })).toHaveLength(80);
  });

  it('only offers to start a task that is not already running or scheduled', () => {
    expect(['backlog', 'paused', 'failed', 'completed'].every((s) => canRunNow(s as any))).toBe(
      true,
    );
    expect(canRunNow('running')).toBe(false);
    expect(canRunNow('scheduled')).toBe(false);
  });

  it('describes runs with their outcome and keeps unknown statuses readable', () => {
    expect(
      describeActivity({
        status: 'timeout',
        summary: 'Collected 3 quotes',
        time: '2026-11-06T09:00:00Z',
        type: 'topic',
      }),
    ).toEqual({
      label: 'Run',
      status: { label: 'Timed out', tone: 'problem' },
      text: 'Collected 3 quotes',
      when: new Date('2026-11-06T09:00:00Z'),
    });
    expect(describeActivity({ content: 'Looks good', type: 'comment' }).status).toBeUndefined();
    expect(describeStatus('archived')).toEqual({ label: 'archived', tone: 'idle' });
  });
});
