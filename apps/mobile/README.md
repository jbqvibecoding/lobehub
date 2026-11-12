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
  opens the approvals list. In the mainland edition, Android phones get notifications through
  their maker's own push service (see below), since they have no Google services.
- **Sign-in**: better-auth with the Expo client; the session cookie stays in the device keychain.
  The mainland edition signs in with a code texted to a mainland China mobile number.

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

The mainland Android build also takes the phone makers' client keys, all optional (a maker without
keys falls back to Expo, which those phones cannot receive):

| Variable                                    | Maker  | From                                         |
| ------------------------------------------- | ------ | -------------------------------------------- |
| `HUAWEI_PUSH_APP_ID`                        | Huawei | AppGallery Connect, the app's App ID         |
| `HONOR_PUSH_APP_ID`                         | Honor  | Honor Developer Services, the app's App ID   |
| `XIAOMI_PUSH_APP_ID`, `XIAOMI_PUSH_APP_KEY` | Xiaomi | Xiaomi Open Platform, Push                   |
| `OPPO_PUSH_APP_KEY`, `OPPO_PUSH_APP_SECRET` | OPPO   | OPPO Open Platform, Push (AppKey, AppSecret) |
| `VIVO_PUSH_APP_ID`, `VIVO_PUSH_API_KEY`     | vivo   | vivo Developer Platform, Push                |

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

The mainland edition (`production-cn`) signs in with a phone number and, on Android, registers
with the phone maker's push service.

## Notifications on mainland Android phones

Android phones sold in mainland China have no Google services, so Expo's Android notifications
(which travel through Google) do not reach them. The local module `modules/vendor-push` registers
the phone with its maker's push service instead: Huawei, Honor, Xiaomi (also Redmi, POCO), OPPO
(also OnePlus, realme) and vivo (also iQOO). The server sends through the same maker; tapping the
notification opens the app.

1. Create the app in each maker's developer console with the package `ai.biber.app.cn`, and turn
   on Push. Apply for the message category each maker uses for notifications the user must act on
   (Huawei self-classification, the Xiaomi and OPPO private-message channels, vivo system
   messages); without it the makers cap or hold back the messages.
2. Huawei and Honor need nothing more: their SDKs come from their Maven repositories. Download the
   Xiaomi, OPPO and vivo SDKs into `modules/vendor-push/android/libs/` (see the README there).
3. Set the client keys above on the `production-cn` build, and the server keys (`*_PUSH_*` in the
   repository's `.env.example`) on the mainland server.

The native code has not been compiled in this repository's CI; the first EAS build of the
mainland edition is where it is checked.

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
