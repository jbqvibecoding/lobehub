# 运维手册

每个版本是一套独立部署：自己的数据库、Redis、密钥和域名。下文的 `<APP_URL>` 是该部署对外的地址。

## 1. 每套部署都要有的

| 设置                        | 说明                                                  |
| --------------------------- | ----------------------------------------------------- |
| `APP_REGION`                | `global` 或 `cn`。生产环境必须设置，否则服务拒绝启动  |
| `APP_URL`                   | 对外地址。回调地址和绑定链接都由它生成                |
| `DATABASE_URL`、`REDIS_URL` | PostgreSQL 和 Redis。绑定令牌、访问令牌缓存依赖 Redis |
| `KEY_VAULTS_SECRET`         | 加密存进数据库的凭据（共享机器人的密钥）用它加密      |
| `AUTH_SECRET`               | 登录会话签名                                          |

国内版启动时会拒绝这些配置：Stripe 密钥、`SANDBOX_PROVIDER=market`、
`AGENT_RUNTIME_MODE=queue` 但没有境内的 `QSTASH_URL`。规则在 `packages/region/src/preflight.ts`。

## 2. 付款

环境变量见仓库根目录 `.env.example` 开头的说明。

| 方式     | 版本 | 回调地址                                                  | 在对方后台要做的事                                                                             |
| -------- | ---- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Stripe   | 国际 | `<APP_URL>/api/webhooks/stripe`                           | 价格用下面的命令建，不在后台手建                                                               |
| 苹果内购 | 两个 | `<APP_URL>/api/webhooks/apple`（App Store 服务器通知 V2） | 建一个订阅组，6 个商品，ID 为 `ai.biber.{starter,premium,ultimate}.{monthly,yearly}`；价格见下 |
| 微信支付 | 国内 | `<APP_URL>/api/webhooks/wechatpay`                        | 开通 Native 支付；商户号绑定 AppID                                                             |
| 支付宝   | 国内 | `<APP_URL>/api/webhooks/alipay`                           | 应用开通 "电脑网站支付"                                                                        |

价格都写在 `packages/billing/src/plans.ts`：

| 套餐     | 美元（月 / 年） | 人民币（月 / 年） |
| -------- | --------------- | ----------------- |
| Starter  | $9.90 / $99     | ¥68 / ¥680        |
| Premium  | $29 / $290      | ¥198 / ¥1980      |
| Ultimate | $69 / $690      | ¥468 / ¥4680      |

**Stripe 价格**按目录创建。先在部署的环境变量下演练，确认后再加 `--apply`：

```sh
bunx tsx scripts/biber/ops.ts stripe prices         # 只打印要做的改动
bunx tsx scripts/biber/ops.ts stripe prices --apply # 执行
```

- 每个套餐一个产品，每种周期一个美元价格，用查找键 `biber_{starter,premium,ultimate}_{monthly,yearly}` 找到。
- 改了目录里的价格后再跑一次：
  - 新价格接过查找键，旧价格停用；
  - 已订阅的用户保持原价，直到他们换套餐。
- 测试模式和正式模式各跑一次，命令会先打印当前是哪种模式。

**App Store 价格**在 App Store Connect 里手动设置，选最接近的价格档：

- 月付：$9.99 / $29.99 / $69.99；
- 年付：$99.99 / $299.99 / $699.99。

商品 ID 不变。

## 3. 共享机器人

凭据不在环境变量里，而是加密存在 `system_bot_providers` 表，每个平台一行：`platform`、
`application_id`（公开的应用标识）、`credentials`（加密的 JSON）、`settings`、`enabled`。
用运维命令行写入，凭据从标准输入读，不进命令历史：

```bash
echo '{"appSecret":"…","token":"…","encodingAESKey":"…"}' \
  | bunx tsx scripts/biber/ops.ts bot set wechat --application-id wx1234567890abcdef
bunx tsx scripts/biber/ops.ts bot list
```

写入后命令行会按服务端的读取方式读一遍；服务端用不了（缺字段、被停用）时直接报出来。

| 平台             | `application_id`  | `credentials`                                  | 回调地址                                          |
| ---------------- | ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| `telegram`       | 留空              | `botToken`、`botUsername`、`webhookSecret`     | `<APP_URL>/api/agent/messenger/webhooks/telegram` |
| `imessage`       | 线路号码（E.164） | `apiKey`、`signingSecret`（Linq）              | `…/webhooks/imessage`                             |
| `lark`、`feishu` | App ID            | `appSecret`、`verificationToken`、`encryptKey` | `…/webhooks/lark`、`…/webhooks/feishu`            |
| `wechat`         | 服务号 AppID      | `appSecret`、`token`、`encodingAESKey`         | `…/webhooks/wechat`                               |

各平台的注意事项：

- **Telegram：** `bot set telegram` 保存后，会把回调地址 `<APP_URL>/api/agent/messenger/webhooks/telegram`
  连同 `webhookSecret` 注册到 Telegram（`APP_URL` 必须是 https）。没有注册回调时，聊天适配器会退回到
  每台服务器各自轮询 Telegram。`doctor` 会检查注册的地址对不对，并报告 Telegram 记录的最近一次投递错误。
- **微信服务号：** 必须是认证服务号。服务器配置里选 "安全模式"；把服务器出口 IP 加进接口 IP 白名单。
- **飞书、Lark：** 是商店应用，由各企业管理员安装；应用后台的事件订阅要选加密并填 `encryptKey`。
- **iMessage：** 只回一对一聊天，群聊消息会被忽略。

## 4. 登录

| 方式          | 版本 | 设置                                                                  |
| ------------- | ---- | --------------------------------------------------------------------- |
| 手机号短信    | 国内 | `ALIYUN_SMS_*`。短信模板用 `${code}` 接收验证码。只接受中国大陆手机号 |
| Apple、Google | 国际 | 沿用 LobeHub 的 SSO 设置                                              |

## 5. 手机推送

| 通道                                     | 服务端设置                     | 手机构建时的设置           |
| ---------------------------------------- | ------------------------------ | -------------------------- |
| Expo（iOS、有 Google 服务的安卓）        | 无                             | `EAS_PROJECT_ID`           |
| 华为、荣耀、小米、OPPO、vivo（国内安卓） | `.env.example` 里的 `*_PUSH_*` | 见 `apps/mobile/README.md` |

向各厂商申请 "需要用户处理的通知" 对应的消息分类，否则会被限量或延迟。

## 6. 云电脑

`SANDBOX_PROVIDER=openbot`，并设置 `OPENBOT_SUPERVISOR_URL` 和 `OPENBOT_SUPERVISOR_TOKEN`。
服务本身在 `apps/computer`，用其中的 `compose.yml` 启动。

## 7. 体检

`bunx tsx scripts/biber/ops.ts doctor` 在部署的环境变量下运行。它检查：

- 本区的配置规则；
- 数据库（已执行的迁移数）和 Redis；
- 每个已配置的外部服务，各做一次不改变对方任何东西的调用来验证密钥：Telegram 读机器人信息，
  微信服务号取访问令牌，Stripe 核对 6 个价格都在且金额与目录一致，微信支付和支付宝查一笔不存在的订单。

短信不发测试短信。有失败项时退出码为 1。

## 8. 还没有实测过的集成

以下代码有单元测试，但还没有对接过真实的对方服务。首次接入时按这个清单逐项验证。

| 集成                | 状态                                                                                |
| ------------------- | ----------------------------------------------------------------------------------- |
| 微信支付、支付宝    | 签名、验签、解密用自生成的密钥测过；没有连过真实商户                                |
| 微信服务号          | 加密模式的收发用本地替身走通过（`wechat-bot.ts`）；没有连过真实服务号               |
| 飞书、Lark 商店应用 | 加密回调、安装、按租户令牌收发用本地替身走通过（`lark-bot.ts`）；没有走过真实的安装 |
| iMessage（Linq）    | 签名回调和收发用本地替身走通过（`imessage-bot.ts`）；没有连过真实线路               |
| 苹果内购            | 验签用自签证书链测过；没有用过真实的 App Store 交易                                 |
| 阿里云短信          | 请求签名测过；没有真实发送过                                                        |
| 厂商推送服务端      | 请求格式参考的是公开的第三方 SDK；荣耀的接口地址和格式没有对照官方文档确认          |
| 厂商推送手机端      | Kotlin 原生代码没有编译过                                                           |
| 云电脑              | 没有在真实部署里运行过                                                              |
| Telegram            | 收发、绑定、按钮审批用本地替身走通过（`telegram-bot.ts`）；没有连过真实机器人       |

## 9. 本地冒烟测试

`scripts/biber/smoke` 里的脚本对着一个运行中的服务端走完主流程。模型、Expo 推送、阿里云短信、各聊天平台的接口
由脚本自己起的本地替身代替，回调按各平台的方式签名或加密，所以不需要任何真实账号。

| 脚本              | 版本       | 走的流程                                                                                                                                            |
| ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `golden-path.ts`  | 国际版     | 注册 → 登记手机推送 → 让 Agent 在云电脑上运行代码 → 运行暂停，手机收到 "需要你" → 手机批准 → 活动记录里有这条决定 → 运行恢复并回复                  |
| `mainland.ts`     | 中国大陆版 | 手机号收验证码登录 → 支付宝下单 → 支付宝签名回调 → 套餐生效一个月 → 重复回调不重复计时 → 篡改过的回调被拒                                           |
| `wechat-bot.ts`   | 中国大陆版 | 微信校验服务器地址 → 伪造的推送被拒 → 新关注者收到绑定链接 → 绑定后收到确认 → 发消息收到 Agent 回复（安全模式加密）                                 |
| `telegram-bot.ts` | 国际版     | 不带密钥的更新被拒 → `/start` 收到绑定链接 → 绑定后收到确认 → 发消息收到回复 → 运行代码时出现批准按钮 → 不带密钥的点击被拒 → 点批准后运行恢复并回复 |
| `imessage-bot.ts` | 国际版     | 签名错误的回调被拒 → 群聊被忽略 → 新号码收到绑定链接 → 绑定后收到确认 → 发消息收到回复（Standard Webhooks 签名）                                    |
| `lark-bot.ts`     | 国际版     | 回应地址校验 → 校验令牌错误的事件被拒 → 企业安装应用 → 员工收到绑定链接 → 绑定后收到确认 → 发消息收到回复，全程用该企业的租户令牌                   |

准备：

1. 起一个 ParadeDB（带 `pg_search` 和 `vector` 的 Postgres）和 Redis，执行 `bun run db:migrate`。
   Docker Hub 限流时可以用 `mirror.gcr.io/paradedb/paradedb:latest-pg17`。
2. 服务端的环境变量：
   - 国际版：`OPENAI_API_KEY` 设任意值，`OPENAI_PROXY_URL=http://127.0.0.1:4010/v1`，
     `EXPO_BASE_URL=http://127.0.0.1:4020`。
   - 中国大陆版：`ALIYUN_SMS_*` 设任意值，并设 `ALIYUN_SMS_ENDPOINT=http://127.0.0.1:4030`；
     `ALIPAY_PUBLIC_KEY` 设成一把本地 RSA 密钥的公钥。
3. 运行：
   - `bunx tsx scripts/biber/smoke/golden-path.ts`，用 `SMOKE_BASE_URL` 指向服务端。
   - `SMOKE_ALIPAY_SIGNING_KEY=<那把私钥的 PEM 文件> bunx tsx scripts/biber/smoke/mainland.ts`。
   - `wechat-bot.ts` 先按脚本开头的说明用 `bot set wechat` 存一个指向本地替身的服务号，
     再带上同样的 `SMOKE_WECHAT_TOKEN`、`SMOKE_WECHAT_AES_KEY` 运行。
   - `telegram-bot.ts`、`imessage-bot.ts`、`lark-bot.ts` 也是先按脚本开头的说明用 `bot set` 存好凭据。
     这三家的接口地址是写死的，所以服务端启动时要加载 `scripts/biber/smoke/redirect-hosts.mjs`，
     把它们的请求改发到本地替身：
     `SMOKE_REDIRECT_HOSTS=api.telegram.org=http://127.0.0.1:4050,api.linqapp.com=http://127.0.0.1:4060,open.larksuite.com=http://127.0.0.1:4070`
     加上 `NODE_OPTIONS="--import ./scripts/biber/smoke/redirect-hosts.mjs"`。不设 `SMOKE_REDIRECT_HOSTS` 时它什么也不做，
     生产环境也不会加载它。

服务端用 API 启动运行时默认是 "无人值守"，需要审批的工具会直接执行。冒烟脚本像网页端一样按手动审批启动运行；
后台任务怎么请手机审批，见 [决策记录](./decisions.md) 第 5 条。

## 10. 持续集成

上游的 `Test CI`（`.github/workflows/test.yml`）不跑 Biber 加的这些：根目录的 vitest 排除了 `packages/**`、
`apps/mobile`，也没有 bun 测试。`Biber CI`（`.github/workflows/biber.yml`）补上：

| 任务              | 内容                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| Biber packages    | `@lobechat/region`、`@lobechat/billing`、`@lobechat/agent-policy` 的测试    |
| Migration journal | `scripts/biber/check-migrations.ts`：迁移编号连续不重复、文件齐全、时间递增 |
| Phone app         | `apps/mobile` 的类型检查和 jest 测试                                        |
| Agent computers   | `apps/computer` 两个 Bun 项目的类型检查和 `bun test`                        |

每次合并上游后先跑 `bunx tsx scripts/biber/check-migrations.ts` 和 `node scripts/brand/rename-assistant.mjs`。

**上游自带的失败（2026-11-13，基线 `ae2c2710`）。** 仓库设置了 `lockfile: false`，每次安装都取依赖的最新版本，
以下失败与 Biber 的改动无关，在上游的同一份代码上也会出现。合并上游后重新核对：

- 类型检查 12 个错误（`src/services/message/__tests__/metadata-race-condition.test.ts` 等）；
- `bun run lint` 的 ESLint 有约 2000 处 `no-restricted-imports`（旧的 `@lobehub/ui` / `antd` 引用），
  所以 `Test Database` 任务的 lint 步骤失败；
- `@lobechat/model-runtime`：`newapi` 的一个 baseURL 测试；
- 服务端：`search/impls/jina` 的两个测试；
- 应用：`ContentBlock` 三个、`WorkflowCollapse` 一个、`oidc-provider/http-adapter` 一个测试。

另外 `lint:style` 带 `--fix`，本地跑会直接改文件。
