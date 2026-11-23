import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) => (value === '' ? undefined : value);

/**
 * The GitHub App the coding expert reaches the user's repositories through. Users install it on
 * the repositories they choose; the server alone holds its key, so nothing in the coding computer
 * can read or write a repository except through the server, and every push waits for the user's
 * approval on the phone.
 */
export const getGithubAppConfig = () => {
  return createEnv({
    runtimeEnv: {
      GITHUB_API_URL: process.env.GITHUB_API_URL,
      GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
      GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
      GITHUB_WEB_URL: process.env.GITHUB_WEB_URL,
    },
    server: {
      /** GitHub's REST API; another address only for GitHub Enterprise or a test double. */
      GITHUB_API_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
      /** The App's OAuth client, to check who installed it */
      GITHUB_APP_CLIENT_ID: z.preprocess(emptyStringToUndefined, z.string().optional()),
      GITHUB_APP_CLIENT_SECRET: z.preprocess(emptyStringToUndefined, z.string().optional()),
      GITHUB_APP_ID: z.preprocess(emptyStringToUndefined, z.string().optional()),
      /** The App's private key (PEM); `\n` may stand for line breaks */
      GITHUB_APP_PRIVATE_KEY: z.preprocess(emptyStringToUndefined, z.string().optional()),
      /** The App's URL name, as in github.com/apps/<slug> */
      GITHUB_APP_SLUG: z.preprocess(emptyStringToUndefined, z.string().optional()),
      /** GitHub's web address, for the install page; another only for Enterprise or a test double. */
      GITHUB_WEB_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
    },
  });
};

export const githubAppEnv = getGithubAppConfig();
