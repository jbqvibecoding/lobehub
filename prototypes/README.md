# Prototypes

Interactive, single-file design prototypes built with the **real** design system
(`@lobehub/ui` + `antd` + `antd-style` tokens). No build step, no dev server —
open the HTML in a browser.

See the [design-prototype skill](../.agents/skills/design-prototype/SKILL.md) for
the full convention.

## `lobehub-ui-replica.html`

A replica of the whole app UI: the shell (`NavPanel` + `NavHeader` + content) plus
nine surfaces — Home, Chat, Community, Resource, Memory, Pages, Tasks, Settings,
and a live Design-tokens sheet.

Every structural value is mirrored from the source rather than eyeballed:

| Surface     | Source                                                    |
| ----------- | --------------------------------------------------------- |
| shell       | `src/routes/(main)/_layout/index.tsx`                      |
| nav panel   | `src/features/NavPanel/{index,SideBarLayout}.tsx`          |
| nav row     | `src/features/NavPanel/components/NavItem.tsx`             |
| nav header  | `src/features/NavHeader/index.tsx`                         |
| panel size  | `src/store/global/selectors/systemStatus.ts` (240–400)     |
| nav items   | `src/hooks/useNavLayout.ts`, `packages/app-config/.../routes` |
| home        | `src/routes/(main)/home/features/index.tsx`                |
| chat        | `src/routes/(main)/agent/(chat)/_layout` + `features/Conversation` |
| settings    | `src/routes/(main)/settings/{_layout/Body,hooks/useCategory}` |
| community   | `src/routes/(main)/community/(list)/_layout`               |
| tokens      | `DESIGN.md` + `DESIGN.dark.md`                             |

### Run it

The HTML needs two sibling files that are **not committed** (≈21 MB of bundled
`node_modules`). Build them once:

```bash
bash .agents/skills/design-prototype/scripts/build-runtime.sh prototypes
open prototypes/lobehub-ui-replica.html
```

That script bundles the design system out of the repo's own `node_modules`, so
run `pnpm install` first. If you only want the prototype and would rather not
install the monorepo, install just what the runtime bundles into `prototypes/`
and bundle from there:

```bash
cd prototypes
npm install @lobehub/ui antd@6.3.5 antd-style@4.1.0 lucide-react motion \
  react@19.2.7 react-dom@19.2.7 esbuild @babel/standalone@7.26.4
cp ../.agents/skills/design-prototype/assets/entry.mjs .
./node_modules/.bin/esbuild entry.mjs --bundle --format=iife \
  --global-name=__PROTO_DEPS_NS__ --platform=browser --minify \
  --define:process.env.NODE_ENV='"production"' \
  --loader:.css=empty --loader:.woff=dataurl --loader:.woff2=dataurl \
  --loader:.svg=dataurl --loader:.png=dataurl \
  --outfile=lobe-prototype-runtime.js
cp node_modules/@babel/standalone/babel.min.js .
```

Note: this prototype's runtime also needs `motion/react-m` on the namespace map
(lobe-ui's `ConfigProvider` requires an injected motion component, the same way
`src/layout/GlobalProvider/AppTheme.tsx` passes `motion={m}`), and re-exports
`@lobehub/ui` as a whole namespace instead of the skill's curated list.

### What it demonstrates

- **Light + dark** — follows the OS appearance via `ThemeProvider themeMode="auto"`.
- **All four data states** — the `prototype` bar at the top (chrome, not app UI)
  switches every screen between data / loading / empty / error.
- **Live interaction** — nav routing, panel drag-resize and collapse, composer
  send, message regenerate, community search + detail modal, settings controls,
  row menus, upload / new-page actions, error recovery.

### Known cuts

Annotated in the file header. In short: no i18n (copy is inline English), no
stores or network (local `useState` stands in), `createStyles` instead of
`createStaticStyles` (static extraction needs a build step), and the mobile,
popup and desktop-titlebar route trees are out of scope.
