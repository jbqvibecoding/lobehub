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

| 方式     | 版本 | 回调地址                                                  | 在对方后台要做的事                                                                   |
| -------- | ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Stripe   | 国际 | `<APP_URL>/api/webhooks/stripe`                           | 建 6 个价格，查找键为 `biber_{starter,premium,ultimate}_{monthly,yearly}`            |
| 苹果内购 | 两个 | `<APP_URL>/api/webhooks/apple`（App Store 服务器通知 V2） | 建一个订阅组，6 个商品，ID 为 `ai.biber.{starter,premium,ultimate}.{monthly,yearly}` |
| 微信支付 | 国内 | `<APP_URL>/api/webhooks/wechatpay`                        | 开通 Native 支付；商户号绑定 AppID                                                   |
| 支付宝   | 国内 | `<APP_URL>/api/webhooks/alipay`                           | 应用开通 "电脑网站支付"                                                              |

人民币价格写在 `packages/billing/src/plans.ts`，单位是分。

## 3. 共享机器人

凭据不在环境变量里，而是加密存在 `system_bot_providers` 表，每个平台一行：`platform`、
`application_id`（公开的应用标识）、`credentials`（加密的 JSON）、`enabled`。

| 平台             | `application_id`  | `credentials`                                  | 回调地址                                          |
| ---------------- | ----------------- | ---------------------------------------------- | ------------------------------------------------- |
| `telegram`       | 留空              | `botToken`、`botUsername`、`webhookSecret`     | `<APP_URL>/api/agent/messenger/webhooks/telegram` |
| `imessage`       | 线路号码（E.164） | `apiKey`、`signingSecret`（Linq）              | `…/webhooks/imessage`                             |
| `lark`、`feishu` | App ID            | `appSecret`、`verificationToken`、`encryptKey` | `…/webhooks/lark`、`…/webhooks/feishu`            |
| `wechat`         | 服务号 AppID      | `appSecret`、`token`、`encodingAESKey`         | `…/webhooks/wechat`                               |

各平台的注意事项：

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

## 7. 还没有实测过的集成

以下代码有单元测试，但还没有对接过真实的对方服务。首次接入时按这个清单逐项验证。

| 集成                | 状态                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| 微信支付、支付宝    | 签名、验签、解密用自生成的密钥测过；没有连过真实商户                       |
| 微信服务号          | 加密模式的收发用自造的消息测过；没有连过真实服务号                         |
| 飞书、Lark 商店应用 | 没有走过真实的安装和事件回调                                               |
| iMessage（Linq）    | 没有连过真实线路                                                           |
| 苹果内购            | 验签用自签证书链测过；没有用过真实的 App Store 交易                        |
| 阿里云短信          | 请求签名测过；没有真实发送过                                               |
| 厂商推送服务端      | 请求格式参考的是公开的第三方 SDK；荣耀的接口地址和格式没有对照官方文档确认 |
| 厂商推送手机端      | Kotlin 原生代码没有编译过                                                  |
| 云电脑              | 没有在真实部署里运行过                                                     |

## 8. 本地冒烟测试

`scripts/biber/smoke` 里的两个脚本对着一个运行中的服务端走完主流程。模型、Expo 推送、阿里云短信由脚本
自己起的本地假服务代替，支付宝的回调用本地生成的密钥签名，所以不需要任何真实账号。

| 脚本             | 版本       | 走的流程                                                                                                                           |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `golden-path.ts` | 国际版     | 注册 → 登记手机推送 → 让 Agent 在云电脑上运行代码 → 运行暂停，手机收到 "需要你" → 手机批准 → 活动记录里有这条决定 → 运行恢复并回复 |
| `mainland.ts`    | 中国大陆版 | 手机号收验证码登录 → 支付宝下单 → 支付宝签名回调 → 套餐生效一个月 → 重复回调不重复计时 → 篡改过的回调被拒                          |

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

服务端用 API 启动运行时默认是 "无人值守"，需要审批的工具会直接执行。冒烟脚本像网页端一样按手动审批启动运行；
后台任务怎么请手机审批，见 [决策记录](./decisions.md) 第 5 条。
