# Biber mobile

The phone side of Biber: it signs in, shows what the agent is waiting on, and approves or rejects
it. The agent runs on the server and on agent computers, never on the phone.

- **Approvals**: the list of tool calls waiting for the user, with what each one will do. Approving
  asks for Face ID, Touch ID or the device passcode first. An answer given on another device wins,
  and the card says so.
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
