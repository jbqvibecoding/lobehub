'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Input, Spin, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import {
  type CloudComputerAction,
  cloudComputerService,
  type CloudComputerView,
} from '@/services/cloudComputer';

import Screen from './Screen';

const VIEW_KEY = 'cloud-computer:view';

/** About one picture a second while it runs; a stopped computer is checked now and then. */
const refreshIntervalFor = (view?: CloudComputerView) =>
  view?.status === 'running' ? 1000 : view?.status === 'off' ? 10_000 : 0;

type Busy = 'handBack' | 'start' | 'takeOver';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    width: min(100%, 1120px);
    margin-block: 0;
    margin-inline: auto;
    padding-block: 32px 96px;
    padding-inline: 24px;

    @media (width <= 760px) {
      padding-block-start: 16px;
      padding-inline: 16px;
    }
  `,
  muted: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  page: css`
    overflow-y: auto;
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  title: css`
    margin: 0;
    font-size: 30px;
    line-height: 1.2;
  `,
}));

/**
 * The cloud computer page: the browser the assistant uses, watched about once a second, which the
 * person can take over (to sign in, or to get the assistant past a page it is stuck on) and hand
 * back. The assistant cannot act while the person holds it.
 */
const CloudComputer = memo(() => {
  const { t } = useTranslation('common');
  const { data, error, mutate } = useSWR(VIEW_KEY, cloudComputerService.view, {
    refreshInterval: refreshIntervalFor,
  });
  const [busy, setBusy] = useState<Busy>();
  const [actionError, setActionError] = useState<string>();
  const [text, setText] = useState('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const run = async (kind: Busy, call: () => Promise<unknown>) => {
    setBusy(kind);
    setActionError(undefined);
    try {
      await call();
      await mutate();
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  /** Inputs go one after another, so typed characters arrive in order. */
  const send = (action: CloudComputerAction) => {
    queue.current = queue.current
      .then(() => cloudComputerService.input(action))
      .then(() => mutate())
      .catch((failure) => setActionError((failure as Error).message));
  };

  const sendText = () => {
    if (!text) return;
    send({ kind: 'type', text });
    setText('');
  };

  const body = () => {
    if (!data) {
      return error ? (
        <Alert
          title={t('cloudComputer.loadError')}
          type={'error'}
          action={
            <Button size={'small'} onClick={() => mutate()}>
              {t('retry')}
            </Button>
          }
        />
      ) : (
        <Flexbox horizontal align={'center'} gap={12} padding={24}>
          <Spin />
          <Text type={'secondary'}>{t('cloudComputer.loading')}</Text>
        </Flexbox>
      );
    }

    if (data.status === 'unavailable') {
      return <Alert title={t('cloudComputer.unavailable')} type={'info'} />;
    }

    if (data.status === 'off') {
      return (
        <Flexbox align={'flex-start'} gap={12}>
          <Text>{t('cloudComputer.off')}</Text>
          <Button
            loading={busy === 'start'}
            type={'primary'}
            onClick={() => run('start', cloudComputerService.start)}
          >
            {t('cloudComputer.start')}
          </Button>
        </Flexbox>
      );
    }

    const control = data.control;
    const driving = control?.holder === 'human';

    return (
      <Flexbox gap={12}>
        {control?.helpRequested ? (
          <Alert
            title={t('cloudComputer.status.help', { reason: control.reason ?? '' })}
            type={'warning'}
          />
        ) : (
          <Text weight={600}>
            {t(driving ? 'cloudComputer.status.human' : 'cloudComputer.status.bot')}
          </Text>
        )}
        {control?.secretWanted && (
          <Alert
            title={t('cloudComputer.secretWanted', { label: control.secretWanted })}
            type={'info'}
          />
        )}

        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          {driving ? (
            <Button
              loading={busy === 'handBack'}
              type={'primary'}
              onClick={() => run('handBack', cloudComputerService.handBack)}
            >
              {t('cloudComputer.handBack')}
            </Button>
          ) : (
            <Button
              loading={busy === 'takeOver'}
              type={'primary'}
              onClick={() => run('takeOver', cloudComputerService.takeOver)}
            >
              {t('cloudComputer.takeOver')}
            </Button>
          )}
          {data.screen?.url && (
            <span className={styles.muted}>
              {t('cloudComputer.currentPage')}: {data.screen.url}
            </span>
          )}
        </Flexbox>

        {data.screen ? (
          <Screen
            canDrive={driving}
            label={t('cloudComputer.screenLabel')}
            screen={data.screen}
            onAction={send}
          />
        ) : (
          <Text type={'secondary'}>{t('cloudComputer.noPicture')}</Text>
        )}

        {driving && (
          <Flexbox horizontal gap={8}>
            <Input
              aria-label={t('cloudComputer.typePlaceholder')}
              autoComplete={'off'}
              placeholder={t('cloudComputer.typePlaceholder')}
              style={{ flex: 1 }}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') sendText();
              }}
            />
            <Button disabled={!text} onClick={sendText}>
              {t('cloudComputer.send')}
            </Button>
          </Flexbox>
        )}
        <span className={styles.muted}>
          {t(driving ? 'cloudComputer.hint.human' : 'cloudComputer.hint.bot')}{' '}
          {t('cloudComputer.masked')}
        </span>
      </Flexbox>
    );
  };

  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <Flexbox gap={16}>
          <Flexbox gap={6}>
            <Text as={'h1'} className={styles.title} weight={700}>
              {t('cloudComputer.title')}
            </Text>
            <span className={styles.muted}>{t('cloudComputer.description')}</span>
          </Flexbox>
          {actionError && (
            <Alert
              title={t('cloudComputer.actionError', { message: actionError })}
              type={'error'}
            />
          )}
          {body()}
        </Flexbox>
      </main>
    </div>
  );
});

CloudComputer.displayName = 'CloudComputer';

export default CloudComputer;
