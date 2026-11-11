# Biber mobile

The phone side of Biber: it signs in, shows what the agent is waiting on, and approves or rejects
it. The agent runs on the server and on agent computers, never on the phone.

- **Approvals**: the list of tool calls waiting for the user, with what each one will do. Approving
  asks for Face ID, Touch ID or the device passcode first. An answer given on another device wins,
  and the card says so.
- **Tasks**: the user's tasks grouped like the web board (needs you, in progress, not started,
  done). A task's page shows why it stopped, its subtasks and its history (runs and their
  outcome, agents' reports, comments), and starts it again with Run now.
- **Activity**: what agents did for the user, newest first: what they asked, what was approved
  or rejected and where, what was blocked, and whether each action succeeded. It shows who a
  call went to, never message content or credentials, which the server does not keep.
- **Account**: the current plan, when it renews or ends, who bills it, and how much of this
  month's credits is used. On iPhone it sells the paid plans through the App Store (see below),
  with restore and subscription management. Sign out is here too.
- **Push**: the server notifies the phone when something needs the user. Tapping the notification
  opens the approvals list.
- **Sign-in**: better-auth with the Expo client; the session cookie stays in the device keychain.

## Regions

One app per edition, so all three can sit on one phone:

| `APP_REGION` | Name      | Bundle id / package | Scheme      |
| ------------ | --------- | ------------------- | ----------- |
| `global`     | Biber     | `ai.biber.app`      | `biber`     |
| `cn`         | Biber     | `ai.biber.app.cn`   | `biber-cn`  |
| `dev`        | Biber Dev | `ai.biber.app.dev`  | `biber-dev` |

Each server trusts only the scheme of its own edition, so set the same `APP_REGION` on the server
and on the app build. A local build without `APP_REGION` is Global. A build on EAS stops unless it
names its region and an `https` server address.

## Configuration

| Variable              | Where        | Meaning                                                                           |
| --------------------- | ------------ | --------------------------------------------------------------------------------- |
| `APP_REGION`          | EAS profile  | Edition: `global`, `cn` or `dev`                                                  |
| `EXPO_PUBLIC_API_URL` | EAS env vars | The server, e.g. `https://app.example.com`; local default `http://localhost:3010` |
| `EAS_PROJECT_ID`      | EAS env vars | The EAS project; without it the app cannot get a push token                       |

## Develop

```bash
cd apps/mobile
npm ci
npx expo start # needs a development build: eas build --profile development
npm run typecheck
npm test
```

Expo Go is not enough: Face ID, the keychain and push need a development build. A phone cannot
reach `localhost`, so point `EXPO_PUBLIC_API_URL` at an address the phone can open.

If api.expo.dev is unreachable (a locked-down network or CI sandbox), prefix Expo CLI commands
with `EXPO_OFFLINE=1`, for example `EXPO_OFFLINE=1 npx expo export --platform android`.

## Build and release

`eas.json` has one profile per use: `development` (Biber Dev, internal), `preview-global`
(internal), `production-global` and `production-cn` (store builds, `autoIncrement` with remote
versions).

```bash
npx eas-cli@latest build --profile production-global --platform all
npx eas-cli@latest submit --profile production-global --platform all
```

The mainland edition (`production-cn`) builds today with the same features. Its own sign-in and
push providers come after the Global edition.

## Selling plans on the App Store

The iPhone app sells plans as auto-renewable subscriptions with StoreKit 2 (`expo-iap`, which
needs a development build, not Expo Go). The server checks every purchase and keeps it in sync.

1. In App Store Connect, create one subscription group with the products
   `ai.biber.{starter,premium,ultimate}.{monthly,yearly}` (ids are per app, so each edition's app
   uses the same ones).
2. Set the App Store Server Notifications (version 2) URL, for production and sandbox, to
   `<server>/api/webhooks/apple`.
3. Give the server Apple's root certificates in `APPLE_ROOT_CERTIFICATES` (see `.env.example`).

Each purchase carries a token that names the Biber account it was bought for, so a subscription
stays with that account. Buying is hidden while a plan is billed on the web, and on Android.
