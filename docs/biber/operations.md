# 运维手册

每个版本是一套独立部署：自己的数据库、Redis、密钥和域名。下文的 `<APP_URL>` 是该部署对外的地址。

## 1. 每套部署都要有的

| 设置                        | 说明                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `APP_REGION`                | `global` 或 `cn`。生产环境必须设置，否则服务拒绝启动                                                                                             |
| `APP_URL`                   | 对外地址。回调地址和绑定链接都由它生成                                                                                                           |
| `DATABASE_URL`、`REDIS_URL` | PostgreSQL 和 Redis。绑定令牌、访问令牌缓存依赖 Redis                                                                                            |
| `KEY_VAULTS_SECRET`         | 加密存进数据库的凭据（共享机器人的密钥）用它加密                                                                                                 |
| `AUTH_SECRET`               | 登录会话签名                                                                                                                                     |
| `CRON_SECRET`               | 定时调用内部地址时带的密钥，见第 13 节。`/api/workflows/*`（例行任务的调度、主动检查等）认它或 QStash 签名；两样都没配，生产环境拒绝调用这些地址 |

国内版启动时会拒绝这些配置：Stripe 密钥、`SANDBOX_PROVIDER=market`、境外模型厂商的密钥（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等），
把境外厂商设为默认的 `DEFAULT_AGENT_CONFIG`，以及会把请求发到境外的设置，详见第 11 节。
规则在 `packages/region/src/preflight.ts` 和 `packages/region/src/endpoints.ts`。

国内版只提供境内厂商的模型（DeepSeek、通义千问、智谱、Kimi、豆包等，清单是 `@lobechat/region` 的
`MAINLAND_MODEL_PROVIDERS`），平台密钥用这些厂商的，例如 `DEEPSEEK_API_KEY`。默认模型已经是 DeepSeek。
系统助手（起标题、任务简报、Biber 主动发的消息、记忆提取等）和文件向量化用到的模型也要配成境内厂商，否则这些功能会因为模型不可用而失败。
系统助手用 `SYSTEM_AGENT` 设置，例如 `SYSTEM_AGENT=default=deepseek/deepseek-chat`。国内版没有 `default` 或用了境外厂商时拒绝启动；
用户在设置里自己选过的模型优先。

国内版还要接内容安全（阿里云内容安全的 "文本审核增强版"）：配 `ALIYUN_GREEN_ACCESS_KEY_ID`、`ALIYUN_GREEN_ACCESS_KEY_SECRET`，
`ALIYUN_GREEN_ENDPOINT` 默认是上海的 `https://green-cip.cn-shanghai.aliyuncs.com`。AccessKey 建议用只授权
`yundun-greenweb:TextModerationPlus` 的 RAM 用户，并在控制台开通 `llm_query_moderation` 和 `llm_response_moderation`
两个服务。审核服务出错时默认拒绝请求，`CONTENT_SAFETY_ON_ERROR=allow` 改为放行。见决策记录第 11 条。

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

**App Store 沙盒购买**（TestFlight、Xcode 里的购买）不花钱，所以默认不给套餐，只有两种情况例外：

- `APPLE_IAP_SANDBOX_ACCOUNTS` 里列出的账号（逗号分隔的邮箱）。提交审核前，把给苹果审核用的演示账号加进去，因为审核是在沙盒里购买的。
- 测试环境设了 `APPLE_IAP_ALLOW_SANDBOX=1`。

另外，苹果订阅过了到期时间一小时还没收到续订通知，就不再给套餐；处于苹果账单宽限期的最多保留 16 天。
这样即使漏收苹果的通知，权益也不会永久有效。

**App Store 价格**在 App Store Connect 里手动设置，选最接近的价格档：

- 月付：$9.99 / $29.99 / $69.99；
- 年付：$99.99 / $299.99 / $699.99。

商品 ID 不变。

**微信支付、支付宝退款**只做全额退款，用命令发起（订单号是付款人在微信或支付宝里看到的商户订单号）：

```sh
bunx tsx scripts/biber/ops.ts refund "用户申请退款" < 订单号 > --reason
```

- 退款单号固定为订单号加 `R`，重复执行不会退两次。
- 退款后，这笔订单买的时间从正在生效的套餐里扣掉：同一套餐买了两个月退一个月，就少一个月；扣完就立刻结束，回到免费版。
  这笔订单买的套餐已经不在生效（比如之后升级了更高的套餐），套餐不变。
- 在微信支付商户平台或支付宝后台直接退的款也一样：微信支付的退款通知（发到同一个回调地址）、支付宝退款后的异步通知
  报告全额退款时，同样扣掉。部分退款只记日志，套餐不变。
- 微信支付的退款结果是异步的。退款通知报告失败（`ABNORMAL`、`CLOSED`）时服务端日志会报错，要去商户平台处理；
  套餐在命令执行时已经扣掉，不会自动恢复。

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
  用户 48 小时没给服务号发消息，审批提示和其他回复都发不出去，这时只能靠手机推送。
- **飞书、Lark：** 是商店应用，由各企业管理员安装；应用后台的事件订阅要选加密并填 `encryptKey`。
  审批卡片的按钮要在应用后台的回调配置里订阅卡片回传交互 `card.action.trigger`，请求地址与事件订阅相同；
  不订阅时按钮点了没有反应，用户只能回复 1 或 2。
- **iMessage：** 只回一对一的 iMessage 聊天。群聊消息、以短信（SMS）或 RCS 发来的消息都会被忽略：用户按号码识别，而短信的发送号码可以伪造，iMessage 的发送方由苹果认证。

## 4. 登录

| 方式          | 版本 | 设置                                                                  |
| ------------- | ---- | --------------------------------------------------------------------- |
| 手机号短信    | 国内 | `ALIYUN_SMS_*`。短信模板用 `${code}` 接收验证码。只接受中国大陆手机号 |
| Apple、Google | 国际 | 沿用 LobeHub 的 SSO 设置                                              |

## 5. 手机推送

| 通道                                     | 服务端设置                                                            | 手机构建时的设置           |
| ---------------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| Expo（iOS、有 Google 服务的安卓）        | 无                                                                    | `EAS_PROJECT_ID`           |
| 华为、荣耀、小米、OPPO、vivo（国内安卓） | `.env.example` 里的 `*_PUSH_*`                                        | 见 `apps/mobile/README.md` |
| APNs 直连（国内版 iPhone）               | `APNS_KEY_ID`、`APNS_TEAM_ID`、`APNS_PRIVATE_KEY`、`APNS_ENVIRONMENT` | 无（国内版构建自动登记）   |

向各厂商申请 "需要用户处理的通知" 对应的消息分类，否则会被限量或延迟。

国内版 iPhone 不走 Expo（它的服务器在境外），直接登记 APNs 的设备令牌，由服务端用团队的 `.p8` 密钥签名后发给苹果。
`APNS_ENVIRONMENT` 要和构建对应：App Store 和 TestFlight 用 `production`（默认），开发构建用 `sandbox`；
弄反了苹果会把所有令牌判为无效，服务端随之删掉，手机下次打开应用时会重新登记。

运行只在等一个调用时，Expo 和 APNs 推送带通知分类 `approval`（"批准 / 拒绝" 按钮），`data.toolMessageId` 是要回答的调用；
手机应用启动时注册这个分类。安卓厂商通道没有按钮。

### 后台运行的审批过期

任务、定时任务、API 启动的运行，用户登记了手机时，会暂停并请手机审批（[决策记录](./decisions.md) 第 5 条）。
请求 24 小时内没人回答，就按拒绝处理，运行继续。这个清理靠定时调用 `GET /api/agent/approvals/expire`，
每套部署都要配，建议每小时一次，见第 13 节：

- 需要服务端设置 `CRON_SECRET`。没设置时，这个地址拒绝所有请求。
- 每次最多处理最早的 100 个请求，返回 `{"expired":…,"failed":…,"found":…}`。
- 不配这个 cron：等审批的任务会一直停在 "运行中"，按计划的触发都会跳过它。

## 6. 云电脑

`SANDBOX_PROVIDER=openbot`，并设置 `OPENBOT_SUPERVISOR_URL`、`OPENBOT_SUPERVISOR_TOKEN` 和 `OPENBOT_COMPUTER_TOKEN`。
服务本身在 `apps/computer`，用其中的 `compose.yml` 启动。

`OPENBOT_COMPUTER_TOKEN`（supervisor 那边叫 `COMPUTER_TOKEN`）是派生用的密钥，不会下发给任何一台电脑：
每台电脑只拿到用它和自己 id 算出的令牌，并且只接受发给自己的请求。所以用户在自己的云电脑上能看到的，
只有自己这台的令牌，进不了别人的电脑。旧容器里还是旧令牌，supervisor 下次用到时会自动重建。

云电脑在收到网络策略前不允许任何出站连接，服务端每次找到电脑地址时下发。`OPENBOT_COMPUTER_EGRESS`：
`public`（默认）只放行公网地址，`all` 全部放行（电脑能访问内网，自建部署要访问内网服务时才用），`none` 断网。

用户在网页、桌面的 `/computer` 和手机的 "账户 → 云电脑" 查看和接管自己的云电脑，见 [决策记录](./decisions.md) 第 12 条。

## 7. 体检

`bunx tsx scripts/biber/ops.ts doctor` 在部署的环境变量下运行。它检查：

- 本区的配置规则；
- 定时调用的鉴权：生产环境至少配了 `CRON_SECRET` 或 QStash 签名密钥之一（见第 13 节）；
- 数据库（已执行的迁移数）和 Redis；
- 每个已配置的外部服务，各做一次不改变对方任何东西的调用来验证密钥：Telegram 读机器人信息，
  微信服务号取访问令牌，Stripe 核对 6 个价格都在且金额与目录一致，微信支付和支付宝查一笔不存在的订单。

短信不发测试短信。有失败项时退出码为 1。

## 8. 还没有实测过的集成

以下代码有单元测试，但还没有对接过真实的对方服务。首次接入时按这个清单逐项验证。

| 集成                | 状态                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 微信支付、支付宝    | 付款和退款的签名、验签、解密用自生成的密钥测过；没有连过真实商户                                                   |
| 微信服务号          | 加密模式的收发用本地替身走通过（`wechat-bot.ts`）；没有连过真实服务号                                              |
| 飞书、Lark 商店应用 | 加密回调、安装、按租户令牌收发用本地替身走通过（`lark-bot.ts`）；没有走过真实的安装                                |
| iMessage（Linq）    | 签名回调和收发用本地替身走通过（`imessage-bot.ts`）；没有连过真实线路                                              |
| 苹果内购            | 验签用自签证书链测过；没有用过真实的 App Store 交易                                                                |
| 阿里云短信          | 请求签名测过；没有真实发送过                                                                                       |
| 阿里云内容安全      | 签名、拦截提问、隐藏回复用本地替身走通过（`wechat-bot.ts`）；没有连过真实服务，两个服务名需在控制台确认            |
| 厂商推送服务端      | 请求格式参考的是公开的第三方 SDK；荣耀的接口地址和格式没有对照官方文档确认                                         |
| 厂商推送手机端      | Kotlin 原生代码没有编译过                                                                                          |
| APNs 直连           | 签名、按钮和数据、失效令牌清理用本地 HTTP/2 替身走通过（`apns.ts`）；没有连过真实的 APNs，也没有在真机上收过       |
| 云电脑              | 本机真 agent-computer（真 Chromium）走通过查看、接管、点击输入、交还和网络策略；没有在 Docker 部署的完整链路里跑过 |
| Telegram            | 收发、绑定、按钮审批用本地替身走通过（`telegram-bot.ts`）；没有连过真实机器人                                      |
| 飞书、Lark 审批卡片 | 发卡片、收点击、在回调里换卡片用本地替身走通过；卡片格式没有在真实客户端里看过                                     |
| 通知上的审批按钮    | 点击后的处理有单测；没有在真机上点过（iOS 锁屏解锁、应用被划掉后的冷启动）                                         |
| Composio 邮件和日历 | 遮验证码、批准规则、连接后交给 Biber 有单测；没有用真实的 Composio 账号连过 Gmail、Google 日历、Outlook            |
| 飞书日历            | 授权、令牌、日历接口用本地替身走通过（`mail-calendar.ts`）；没有用真实的飞书应用和账号授权过，权限名需在后台确认   |
| 国内邮箱服务商      | 收信、发信、回复用本地 GreenMail 走通过（`mail-calendar.ts`）；没有连过真实的 QQ、网易、企业邮箱                   |
| 用保存的登录登录    | 用本机真云电脑和本地测试网站走通过（`saved-logins.ts`）；没有在真实网站上登录过，有的网站会拦自动化或要求跨域登录  |

**国内版还没做的，以及原因：**

- 手机端微信登录：要接微信开放平台的原生 SDK，并有已认证的开放平台账号和移动应用；容器里编译不了原生代码，也没法在真机上验证。
  国内手机用户现在用手机号验证码登录。
- 国内安卓的应用内支付（微信支付、支付宝 App 支付）：同样要原生 SDK 和商户的移动应用配置。安卓用户现在到网页上用扫码付款，
  付完后手机上的套餐自动更新。
- 电子发票：要接第三方开票服务商（或税务数字账户），需要企业资质和服务商账号。需要发票的用户目前由人工开具。

## 9. 本地冒烟测试

`scripts/biber/smoke` 里的脚本对着一个运行中的服务端走完主流程。模型、Expo 推送、阿里云短信、各聊天平台的接口
由脚本自己起的本地替身代替，回调按各平台的方式签名或加密，所以不需要任何真实账号。

| 脚本                     | 版本       | 走的流程                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `golden-path.ts`         | 国际版     | 注册 → 登记手机推送 → 让 Agent 在云电脑上运行代码 → 运行暂停，手机收到带 "批准 / 拒绝" 按钮的 "需要你" → 手机批准 → 活动记录里有这条决定 → 运行恢复并回复                                                                                                                                                                                                                                                                                                                                  |
| `mainland.ts`            | 中国大陆版 | 手机号收验证码登录 → 支付宝下单 → 支付宝签名回调 → 套餐生效一个月 → 重复回调不重复计时 → 篡改过的回调被拒 → 支付宝后台全额退款的通知让套餐结束                                                                                                                                                                                                                                                                                                                                             |
| `wechat-bot.ts`          | 中国大陆版 | 微信校验服务器地址 → 伪造的推送被拒 → 新关注者收到绑定链接 → 网页上确认后显示 6 位数字 → 别的微信发同样的数字绑不上 → 从这个微信发数字后绑定成功 → 发消息收到 Agent 回复（安全模式加密）→ 运行代码时收到 "回复 1 批准" → 回 1 后运行恢复并回复 → 回别的话按拒绝处理并转告助理 → 被内容安全拦下的提问不发给模型 → 被拦下的回复换成提示                                                                                                                                                      |
| `telegram-bot.ts`        | 国际版     | 不带密钥的更新被拒 → `/start` 收到绑定链接 → 绑定后收到确认 → 手机上显示已绑定 → 发消息收到回复 → 运行代码时出现批准按钮 → 不带密钥的点击被拒 → 点批准后运行恢复并回复 → 在手机上解除绑定后再发消息，重新收到绑定链接                                                                                                                                                                                                                                                                      |
| `imessage-bot.ts`        | 国际版     | 签名错误的回调被拒 → 群聊和短信被忽略 → 新号码收到绑定链接 → 绑定后收到确认 → 发消息收到回复（Standard Webhooks 签名）→ 运行代码时收到 "Reply 1" → 回 1 后运行恢复并回复 → 回别的话按拒绝处理并转告助理                                                                                                                                                                                                                                                                                    |
| `lark-bot.ts`            | 国际版     | 回应地址校验 → 校验令牌错误的事件被拒 → 企业安装应用 → 员工收到绑定链接 → 绑定后收到确认 → 发消息收到回复，全程用该企业的租户令牌 → 运行代码时收到带按钮的卡片 → 令牌错误的点击被拒 → 点批准后卡片换成结果，运行恢复并回复。`SMOKE_LARK_PLATFORM=feishu` 时走飞书                                                                                                                                                                                                                          |
| `background-approval.ts` | 国际版     | 任务运行到运行代码时暂停，手机收到推送 → 等待期间任务保持运行中 → 手机批准后运行恢复，任务结算 → 不说明审批方式的 API 调用同样暂停 → 不带 cron 密钥调过期接口被拒 → 等了一天的请求被拒绝，运行继续                                                                                                                                                                                                                                                                                         |
| `phone-chat.ts`          | 国际版     | 手机上和 Biber 新开对话收到回复 → 对话出现在列表里 → 和会运行代码的 Agent 对话时停下等回答 → 在对话里批准后运行恢复并回复 → 别人读不到这段对话                                                                                                                                                                                                                                                                                                                                             |
| `computer.ts`            | 国际版     | 新账号的云电脑是关着的，查看不会开机 → 开机后看到画面 → 没接管时点击被拒 → Bot 求助的原因显示出来 → 接管就是接下这个请求 → 点击、文字、按键到达浏览器 → 交还给 Biber → 没求助时接管，以本人名义发请求 → 别的账号只看得到自己的电脑                                                                                                                                                                                                                                                         |
| `apns.ts`                | 中国大陆版 | iPhone 登记 APNs 设备令牌 → 运行暂停等审批 → 手机经 APNs 收到推送，带团队密钥签的 ES256 令牌和国内版的 bundle id → 推送带 "批准 / 拒绝" 按钮、要回答的调用、中文标题 → 苹果说已失效的令牌被删掉，下一条推送不再发给它                                                                                                                                                                                                                                                                      |
| `routines.ts`            | 国际版     | 新账号看到三个例行任务都没开 → 打开晨报后给 Biber 建了按手机时区运行的计划任务 → 手动运行一次并结算 → 关掉后不再按计划运行，任务保留                                                                                                                                                                                                                                                                                                                                                       |
| `memories.ts`            | 国际版     | Agent 记下的偏好出现在手机上 → 别的账号忘不掉它 → 在手机上忘掉后 Agent 也检索不到 → 全部忘掉后列表清空 → Agent 不能把密码存成记忆 → 身份和高优先级偏好每次运行都原样交给模型 → 在手机上撤销一次整理后，记下的消失，那段对话打上不再整理的标记，别的账号撤销不了                                                                                                                                                                                                                            |
| `proactive.ts`           | 两个版本   | 明天开始的活动变成 "来自 Biber" 对话里的一条提醒，推送带 "这次不用" 按钮，账本记为已发出 → 手机点开后记为已打开 → 两小时内再检查不发 → 免打扰时段不发 → 例行任务的结果推送到手机，点开是那个任务 → 不带密钥调工作流地址被拒。国内版还确认这条消息过了内容安全                                                                                                                                                                                                                              |
| `reminders.ts`           | 两个版本   | 手机对话里说 "Remind me to call mom"，Biber 记下并在手机列表里标为 "你让我提醒" → 到点发出，Biber 关闭、正处免打扰也照发 → 说 "my interview is on Friday"，Biber 自己记一条跟进，没到时间不说 → 到时间后由主动检查说出来 → 手机上删掉的，Agent（和网页对话的接口）也查不到 → 别的账号看不到也删不掉。国内版还确认提醒过了内容安全                                                                                                                                                          |
| `experts.ts`             | 两个版本   | 添加研究员和写手，重复添加不多出一个 → 建群，Biber 是主持，没有另建主持 → 发 "@研究员 …" 只有研究员回答，模型只给了他网页搜索和阅读 → 不 @ 地说 "Ask the researcher …"，Biber 用 `speak` 请研究员在群里回答 → 别的账号看不到、发不进、也不能拿别人的专家建群 → 删掉群，Biber 和专家都还在 → 移除写手，和他的单聊一起删除。国内版用中文名（`@研究员`）                                                                                                                                      |
| `mail-calendar.ts`       | 中国大陆版 | 手机连邮箱：授权码错了被拒，对了能连上，授权码加密存储 → 来一封带验证码和重置链接的信，说 "看看最新的邮件"，Biber 读到了信，模型和对话记录里都没有验证码和链接 → 说 "回复这封邮件"，停下等批准，批准后对方收到同一会话里的回信 → 连飞书日历：编造的 state 被拒，真的 state 只能用一次 → "明天下午有空吗" 列出已有会议前后的空闲 → "明天下午三点建个会" 停下等批准，批准后飞书收到 15:00（北京时间）的日程 → 别的账号看不到这些账户，也读不到邮件 → 断开邮箱后保存的登录被删除              |
| `saved-logins.ts`        | 中国大陆版 | 本机起真的云电脑（Chromium）和一个测试网站。手机保存一条登录，列表里没有密码 → 说 "登录测试网站"，停下等批准，卡片写明网站和账户，批准后网站收到正确的用户名和密码 → 换到别的网站、伪造网站参数都被拒 → 点 "Next page" 不用批准，点 "Place order" 和在下单表单里按回车都要批准，批准后网站收到订单 → 要验证码的登录：手机收到推送，用密码框填入，网站收到验证码 → 别的账号看不到、用不了这条登录 → 密码和验证码不在任何模型请求、数据库导出和服务端、云电脑日志里 → 删除后数据库里没有这行 |

准备：

1. 起一个 ParadeDB（带 `pg_search` 和 `vector` 的 Postgres）和 Redis，执行 `bun run db:migrate`。
   Docker Hub 限流时可以用 `mirror.gcr.io/paradedb/paradedb:latest-pg17`；在境内用自己仓库里的副本，见第 12 节。
2. 服务端的环境变量：
   - 国际版：`OPENAI_API_KEY` 设任意值，`OPENAI_PROXY_URL=http://127.0.0.1:4010/v1`，
     `EXPO_BASE_URL=http://127.0.0.1:4020`。
   - 中国大陆版：`DEEPSEEK_API_KEY` 设任意值，`DEEPSEEK_PROXY_URL=http://127.0.0.1:4010/v1`（国内版不提供 OpenAI）；
     第 11 节的必填设置：`TELEMETRY_DISABLED=1`、`FEATURE_FLAGS=-market`、`SEARCH_PROVIDERS=bocha`、`CRAWLER_IMPLS=naive`、
     `SYSTEM_AGENT=default=deepseek/deepseek-chat`；
     `ALIYUN_GREEN_ACCESS_KEY_ID`、`ALIYUN_GREEN_ACCESS_KEY_SECRET` 设任意值，`ALIYUN_GREEN_ENDPOINT=http://127.0.0.1:4090`；
     `ALIYUN_SMS_*` 设任意值，并设 `ALIYUN_SMS_ENDPOINT=http://127.0.0.1:4030`；
     `ALIPAY_PUBLIC_KEY` 设成一把本地 RSA 密钥的公钥。
3. 运行：
   - `bunx tsx scripts/biber/smoke/golden-path.ts`，用 `SMOKE_BASE_URL` 指向服务端。
   - `SMOKE_APNS_KEY=<一把 P-256 私钥的 PEM 文件> bunx tsx scripts/biber/smoke/apns.ts`：国内版服务端设
     `APNS_KEY_ID=SMOKEKEY01`、`APNS_TEAM_ID=SMOKETEAM1`、`APNS_PRIVATE_KEY` 为同一把私钥、`APNS_ENDPOINT=http://127.0.0.1:4110`。
   - `computer.ts` 要求服务端设 `SANDBOX_PROVIDER=openbot`、`OPENBOT_SUPERVISOR_URL=http://127.0.0.1:4300`、
     `OPENBOT_SUPERVISOR_TOKEN=smoke-supervisor` 和 `OPENBOT_COMPUTER_TOKEN=smoke-computer`，脚本自己起 supervisor 和电脑的替身。
   - `background-approval.ts` 还要求服务端设 `CRON_SECRET`，并在运行时带上同样的 `SMOKE_CRON_SECRET`。
     它会把请求的时间改早一天，所以要用 `SMOKE_DATABASE_URL` 指向服务端的数据库。
   - `memories.ts` 也要用 `SMOKE_DATABASE_URL` 指向服务端的数据库：整理记忆靠 Upstash 工作流，本地不运行，
     所以脚本直接写入一条整理留下的撤销记录。
   - `proactive.ts` 要求服务端设 `CRON_SECRET` 和 `EXPO_BASE_URL=http://127.0.0.1:4020`，运行时带上 `SMOKE_CRON_SECRET`
     和指向服务端数据库的 `SMOKE_DATABASE_URL`：记忆整理在本地不运行，脚本直接往数据库写一条活动，并把上次检查的时间改早。
     国内版运行时再带 `APP_REGION=cn`、`SMOKE_MODEL_PROVIDER=deepseek`、`SMOKE_MODEL=deepseek-chat`。
   - `reminders.ts` 的设置同 `proactive.ts`。国内版用 `SMOKE_MODEL=deepseek-v4-flash`：模型库里只有别的厂商列着
     `deepseek-chat`，查出来的是 32k 的上下文窗口，第一条消息就会触发对话压缩。
   - `experts.ts` 只要模型替身和指向服务端数据库的 `SMOKE_DATABASE_URL`（把这个账号的 Agent 都改成用替身的模型）。
     国内版运行时带 `APP_REGION=cn`、`SMOKE_MODEL_PROVIDER=deepseek`、`SMOKE_MODEL=deepseek-v4-flash`，专家按中文添加。
   - `mail-calendar.ts` 用 Docker 起 GreenMail（测试用的邮件服务器，镜像 `mirror.gcr.io/greenmail/standalone:2.1.3`，
     命令在脚本开头），用 `bot set feishu` 存一个飞书应用，国内版服务端再加 `MAIL_ALLOW_PRIVATE_HOSTS=1`，并加载
     `redirect-hosts.mjs` 把 `open.feishu.cn` 指到脚本的飞书替身（`SMOKE_REDIRECT_HOSTS=open.feishu.cn=http://127.0.0.1:4080`）。
     运行时带 `APP_REGION=cn`、`SMOKE_DATABASE_URL`、`SMOKE_MODEL_PROVIDER=deepseek`、`SMOKE_MODEL=deepseek-v4-flash`。
   - `saved-logins.ts` 自己用 Bun 起 `apps/computer/agent-computer`（无界面 Chromium），并起一个指向它的 supervisor 替身。
     国内版服务端设 `SANDBOX_PROVIDER=openbot`、`OPENBOT_SUPERVISOR_URL=http://127.0.0.1:4300`、
     `OPENBOT_SUPERVISOR_TOKEN=smoke-supervisor`、`OPENBOT_COMPUTER_TOKEN=smoke-computer`、`OPENBOT_COMPUTER_EGRESS=all`
     和 `SAVED_LOGINS_ALLOW_HTTP=1`。运行时带 `APP_REGION=cn`、`SMOKE_DATABASE_URL`、`SMOKE_MODEL_PROVIDER=deepseek`、
     `SMOKE_MODEL=deepseek-v4-flash`，再带 `SMOKE_DB_CONTAINER`（数据库容器名，用来导出整个库查密码）和 `SMOKE_SERVER_LOG`。
     云电脑的 Playwright 要的浏览器版本和本机装的不同时，用 `PLAYWRIGHT_BROWSERS_PATH` 指向一个把那个版本名链接到本机浏览器的目录。
   - `SMOKE_ALIPAY_SIGNING_KEY=<那把私钥的 PEM 文件> bunx tsx scripts/biber/smoke/mainland.ts`。
   - `wechat-bot.ts` 先按脚本开头的说明用 `bot set wechat` 存一个指向本地替身的服务号，
     再带上同样的 `SMOKE_WECHAT_TOKEN`、`SMOKE_WECHAT_AES_KEY` 运行。
   - `telegram-bot.ts`、`imessage-bot.ts`、`lark-bot.ts` 也是先按脚本开头的说明用 `bot set` 存好凭据。
     这三家的接口地址是写死的，所以服务端启动时要加载 `scripts/biber/smoke/redirect-hosts.mjs`，
     把它们的请求改发到本地替身：
     `SMOKE_REDIRECT_HOSTS=api.telegram.org=http://127.0.0.1:4050,api.linqapp.com=http://127.0.0.1:4060,open.larksuite.com=http://127.0.0.1:4070`
     加上 `NODE_OPTIONS="--import ./scripts/biber/smoke/redirect-hosts.mjs"`。不设 `SMOKE_REDIRECT_HOSTS` 时它什么也不做，
     生产环境也不会加载它。

冒烟脚本像网页端一样按手动审批启动运行。后台运行怎么请手机审批，见 [决策记录](./decisions.md) 第 5 条。

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

## 11. 国内版的外部地址

国内版不能把用户的请求和数据发到境外。下面列出服务端和网页端会访问的外部服务，以及国内版怎么处理。
清单写在 `packages/region/src/endpoints.ts`，服务启动时逐项检查，配置不对就拒绝启动，并说明该怎么改。

**已经按版本切换的：** 模型厂商（只提供境内厂商）、支付（微信支付、支付宝）、聊天平台（微信、飞书）、
云电脑（OpenBot）、内容安全和短信（阿里云）、手机推送（APNs 直连和厂商通道）。这些不用额外设置。

**国内版必须设置的：**

| 外部服务                                 | 境外默认地址                                                | 国内版的要求                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 智能体队列和工作流                       | `qstash.upstash.io`                                         | 设了 `QSTASH_TOKEN` 或 `AGENT_RUNTIME_MODE=queue` 时，必须设境内的 `QSTASH_URL`                                   |
| 遥测和工具调用上报                       | `market.lobehub.com`                                        | `TELEMETRY_DISABLED=1`                                                                                            |
| 社区助手、插件、技能                     | `market.lobehub.com`                                        | `FEATURE_FLAGS` 含 `-market`，或 `MARKET_BASE_URL` 指向境内的市场服务                                             |
| 网页搜索                                 | `api.search1api.com`                                        | `SEARCH_PROVIDERS` 只用 `bocha`、`anspire`、`searxng`；用 `jina` 时设 `JINA_USE_CN_DOMAINS=true`                  |
| 读取网页                                 | `r.jina.ai`、`api.search1api.com`                           | `CRAWLER_IMPLS` 用 `naive`；`jina` 同上；`browserless`、`firecrawl` 要设境内的 `BROWSERLESS_URL`、`FIRECRAWL_URL` |
| Google 统计、X 广告、Clarity、React Scan | 各自的境外地址                                              | 不能用                                                                                                            |
| PostHog、Plausible、Umami                | 各自的云服务                                                | 只能用自建的，设 `POSTHOG_HOST`、`PLAUSIBLE_SCRIPT_BASE_URL`、`UMAMI_SCRIPT_URL`                                  |
| 模型调用追踪（Langfuse）                 | `cloud.langfuse.com`                                        | 开启时必须设自建的 `LANGFUSE_HOST`                                                                                |
| 邮件                                     | Resend                                                      | 用 `nodemailer` 和境内的 SMTP                                                                                     |
| 单点登录                                 | Google、GitHub、Microsoft、Auth0、Okta、Cognito、Cloudflare | 不能用。苹果、飞书、微信和自建的 OIDC（Casdoor、Keycloak、Logto 等）可以用                                        |
| Composio、Vercel Edge Config             | 各自的境外服务                                              | 不能用                                                                                                            |

**两个版本都关掉的：** 更新日志和版本检查（显示的是 LobeHub 的更新日志和版本），默认就是关的。

**网页端按版本关掉的：** 服务端把版本（`cn` 或 `global`）放进网页端拿到的配置里，网页端只在国际版使用下面几项，
拿不到版本时按国内版处理。不需要额外设置。

| 地址                       | 国际版                                                              | 国内版                                                                                 |
| -------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `view.officeapps.live.com` | 微软的服务器下载用户的文件，生成预览                                | 不在线预览，显示下载按钮                                                               |
| `proxy.corsfix.com`        | 导出截图时，外链图片经它转发后画进截图                              | 不转发。同源图片和允许跨域读取的图片照常显示，不允许的外链图片显示为灰块               |
| `icons.duckduckgo.com`     | 链接、搜索结果和引用旁的网站图标，DuckDuckGo 由此得知这些网站的域名 | 不显示网站图标：链接旁显示地球图标，引用角标直接链到来源，消息下的来源列表改用普通样式 |

**还没处理的地址：** 大多只用来下载图标、脚本、字体或程序，在国内可能打不开。
除了 PDF 字体是服务端下载的，其余都由浏览器或桌面版直接访问。影响如下：

| 地址                               | 用在哪里                                                                             | 打不开时                   |
| ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| `icons.duckduckgo.com`             | 网页搜索工具里各个搜索引擎的图标，只有 Google、Bing 这类固定的引擎域名，不带对话内容 | 引擎图标不显示             |
| `hub-apac-1.lobeobjects.space`     | 设置页底部的视频、Composio 和技能图标                                                | 图片和视频不显示           |
| `esm.sh`                           | 部分 Mermaid 图表的备用加载                                                          | 这类图表不显示             |
| `cdn.tailwindcss.com`、CodeSandbox | Artifacts 里 React 组件的预览                                                        | 预览加载不出来             |
| `cdn.jsdelivr.net`、`pypi.org`     | 浏览器里运行 Python（Pyodide）                                                       | Python 运行不了            |
| `cdn.jsdelivr.net`（服务端）       | 把对话导出成 PDF 时下载中文字体                                                      | PDF 导出失败               |
| GitHub releases（桌面版）          | 首次运行时下载 agent-browser                                                         | 桌面版的浏览器自动化不可用 |

## 12. 构建国内版

在境内构建时，基础镜像和依赖都要能从境内下载。各 Dockerfile 默认用 Docker Hub、GHCR 和各家的官方源，
国内版构建时用下面的参数换掉。

| 构建               | 命令                                                                                                                                      | `USE_CN_MIRROR=true` 时换成                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 主镜像             | 仓库根目录 `docker build --build-arg USE_CN_MIRROR=true --build-arg NODE_IMAGE=… --build-arg BUSYBOX_IMAGE=… .`                           | apt 用中科大镜像，npm 用 npmmirror，ffmpeg 从 npmmirror 下载           |
| 云电脑、supervisor | `apps/computer` 下 `USE_CN_MIRROR=true NODE_IMAGE=… BUN_IMAGE=… UBUNTU_IMAGE=… SPIRE_IMAGE=… SUPERVISOR_BUN_IMAGE=… docker compose build` | apt 用阿里云镜像，bun 用 npmmirror，Playwright 浏览器从 npmmirror 下载 |

**基础镜像：** Docker Hub 和 GHCR 在境内不稳定。先在能访问的机器上拉下这些镜像，推到自己的阿里云容器镜像服务（ACR），
构建时用上表的参数指过去，标签和 digest 保持不变：

| 用在       | 镜像                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 主镜像     | `node:24-slim`、`busybox:latest`                                                              |
| 云电脑     | `node:24.18.1-bookworm-slim`、`oven/bun:1.4.3`（用 Dockerfile 里写的 digest）、`ubuntu:24.04` |
| supervisor | `ghcr.io/spiffe/spire-server:1.15.1`、`oven/bun:1.4.3-alpine`                                 |
| 部署       | `paradedb/paradedb:latest-pg17`、`redis:7-alpine`                                             |

**手机端：** 在 EAS 的云端构建，不受影响。

**桌面版：** 正式包（设了 `UPDATE_CHANNEL`）必须设 `UPDATE_SERVER_URL`，否则打包直接失败。国内版指向境内的对象存储。
本地打的包没有更新源，不会自动更新，也不会去上游 LobeHub 的 GitHub 检查更新。
Electron 本身已由 `apps/desktop/.npmrc` 和 `electron-builder.mjs` 从 npmmirror 下载。

**没有验证过的：** 上面的国内镜像地址按 npmmirror 公开的镜像配置和阿里云的说明填写。开发环境连不上这些镜像，
没有实际下载过；第一次在境内构建时，请留意下载是否成功。浏览器里运行 Python 用的 Pyodide 没有找到可靠的境内完整镜像，
仍从 jsDelivr 加载（见第 11 节）。

## 13. 定时调用

服务端自己不计时。例行任务、Biber 主动发的消息和几项清理，都要由外部按时调用下面的地址。

| 地址                                           | 方法 | 建议频率   | 作用                                                                            | 不配的后果                                                                      |
| ---------------------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/api/workflows/task/schedule-dispatch`        | POST | 每 5 分钟  | 找出到点的计划任务（含晨报等例行任务）并运行                                    | 例行任务和用户建的定时任务都不会运行                                            |
| `/api/workflows/proactive/tick`                | POST | 每 5 分钟  | 主动检查：先发到点的 "你让我提醒的"，再替用户决定这会儿要不要说一句，见第 14 节 | 用户让 Biber 提醒的事不会发，Biber 不会主动发消息，没反应的消息也不会记为被忽略 |
| `/api/agent/approvals/expire`                  | GET  | 每小时     | 24 小时没人回答的后台审批按拒绝处理，见第 5 节                                  | 等审批的任务一直停在 "运行中"                                                   |
| `/api/workflows/task/watchdog`                 | POST | 每 10 分钟 | 超过心跳时限仍在运行中的任务标为失败，并给用户留一条简报                        | 卡住的任务一直显示 "运行中"                                                     |
| `/api/workflows/task/scheduled-topic-dispatch` | POST | 每 10 分钟 | 因模型限流推迟的对话，到时间后接着运行                                          | 被限流打断的对话不会自动继续                                                    |

**鉴权：** 调用带 `Authorization: Bearer <CRON_SECRET>`。`/api/workflows/*` 也接受 QStash 的签名
（配了 `QSTASH_CURRENT_SIGNING_KEY` 和 `QSTASH_NEXT_SIGNING_KEY` 时）；两样都没配，生产环境返回 503，开发环境不检查。
`/api/agent/approvals/expire` 只认 `CRON_SECRET`。`ops.ts doctor` 会检查生产环境至少配了其中一样。

**国际版：** 用 QStash 时，在 Upstash 控制台给这些地址建 Schedule，频率同上；也可以和国内版一样用 cron。

**国内版：** 一般不接 QStash（要接只能用境内的 `QSTASH_URL`，见第 11 节）。用系统 cron 或云上的定时触发
（如函数计算的定时触发器）调用。不接 QStash 时，`AGENT_RUNTIME_MODE` 不设或设为 `local`：队列模式要靠 QStash
把到点的任务分发出去，本地模式在本进程里直接运行。crontab 的写法，`APP_URL` 和 `CRON_SECRET` 换成实际值：

```sh
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer CRON_SECRET" "APP_URL/api/workflows/task/schedule-dispatch"
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer CRON_SECRET" "APP_URL/api/workflows/proactive/tick"
0 * * * * curl -fsS -H "Authorization: Bearer CRON_SECRET" "APP_URL/api/agent/approvals/expire"
*/10 * * * * curl -fsS -X POST -H "Authorization: Bearer CRON_SECRET" "APP_URL/api/workflows/task/watchdog"
*/10 * * * * curl -fsS -X POST -H "Authorization: Bearer CRON_SECRET" "APP_URL/api/workflows/task/scheduled-topic-dispatch"
```

部署多台服务端时只配一处，不要每台都调。

## 14. 主动消息

Biber 在用户没问的时候发的消息有三种：用户打开的例行任务的结果，用户在对话里让 Biber 提醒的事，
以及 Biber 自己想说的提醒和跟进。为什么这样定见 [决策记录](./decisions.md) 第 18、19 条。

**送到哪：** 消息写进每个用户一个的 "来自 Biber" 对话，同时推送到手机。推送的通知类别是 `proactive`，
带 "这次不用" 按钮；国内安卓厂商通道没有按钮，只能点开。例行任务的结果点开是那个任务，其余的点开是 "来自 Biber" 对话。

**说什么：** "Biber 记着要说的事" 有两个来源。

- **对话里记下的：** Biber 有一个提醒工具（`lobe-reminders`，只给 Biber，其他助理没有）。
  - 用户说 "提醒我下午 3 点给妈妈打电话"，它记一条 "你让我提醒的"，到点发出 "提醒：给妈妈打电话"。
    这一条不看档位、额度、两小时间隔和免打扰；检查晚了 6 小时还没发出就作废。
  - 用户提到之后的安排时，它也可以自己记一条提醒或跟进，并定好什么时候说；到时间后才有资格说，照常受下面的节制。
  - 每人未完成的最多 50 条。时间由模型给出带时区偏移的绝对时间，服务端按用户的时区把它写回给模型核对。
- **记忆里的活动**（`user_memories_activities` 的开始和结束时间）：3 天内要开始的事提前提醒，过了开始时间作废；
  2 天内刚结束的事问一句结果如何。这些活动由 Agent 用记忆工具记下，或由后台从过去的对话里整理出来；
  后台整理靠 Upstash 工作流，没接 QStash 的部署只有前一种来源。

用户在手机 "账户 → 主动消息" 的 "Biber 记着要说的事" 里能看到这些，可以删；在对话里也可以让 Biber 列出或取消。

没有要说的事就不调用模型，不会找话闲聊。有事时调用一次系统助手的 `topic` 模型（`SYSTEM_AGENT` 的 `topic=` 或 `default=`）
写这条消息，平台付费的调用照常计入额度。"你让我提醒的" 文案固定，不调用模型。
国内版发出前过内容安全，审核不通过或审核服务出错都不发。

**多久说一次：** 用户在手机 "账户 → 主动消息" 里设置，默认 "适中"。

| 档位         | 说什么     | 每天最多 |
| ------------ | ---------- | -------- |
| 关闭         | 不主动说   | 0        |
| 少           | 只说提醒   | 1 条     |
| 适中（默认） | 提醒和跟进 | 3 条     |

不论档位：

- 两条之间至少隔 2 小时；用户 10 分钟内发过消息时不插话；
- 免打扰时段默认 22:00–08:00，按用户的时区，用户可以改，也可以 "安静 7 天"；
- 连续 3 条没反应后，每天最多 1 条，直到用户点开、回复或点 "这次不用"；
- 某一种消息 30 天里有结果的至少 4 条、其中超过一半点了 "这次不用"，就不再发这一种。

例行任务和 "你让我提醒的" 是用户自己定的时间，不占这里的额度，也不受免打扰影响；它们被忽略也不会让 Biber 降频。

**时区：** 手机登记推送时一并上报；没有就用网页设置里的时区；再没有，国内版按 Asia/Shanghai，国际版按 UTC。
和 Biber 对话时（手机、聊天软件、任务），网页设置里没有时区就按这个顺序找；网页对话里记提醒时用浏览器的时区。

**统计：** `bunx tsx scripts/biber/ops.ts proactive stats [--days 7]` 按种类和例行任务列出发出数，
以及打开、回复、"这次不用" 和被忽略的比例；"你让我提醒的" 单独一行（`asked`）。发出后 24 小时内没反应的算 "等待中"，不计入比率；超过 24 小时记为被忽略。
点了 "这次不用" 或回复的也算打开过。

**容量：** 主动检查每次先发最多 500 条到点的 "你让我提醒的"，再检查最多 200 个用户：有到期的事要说，
或记忆里有快开始、刚结束的活动的，按上次检查时间从早到晚排。每 5 分钟一次时每小时 2400 个；这样的用户更多时，缩短调用间隔。
"你让我提醒的" 最多晚一个调用间隔。

## 15. 专家与群聊

用户可以把专家加进自己的团队，单独和某位专家对话，或者建一个由 Biber 主持的群聊。为什么这样定见
[决策记录](./decisions.md) 第 20 条。

**专家：** 目录在 `apps/server/src/services/experts/catalog.ts`，现在有 5 位：研究员、写手、SEO 顾问、电商选品、商品文案。
名字和简介有中英两份，添加时按手机的语言取。

- 用户在手机 "账户 → 专家" 里添加或移除。添加的专家是用户自己的一个普通 Agent（`market_identifier` 为
  `biber-expert:<id>`），网页上也能看到、单独对话；重复添加不会多出一个。模型跟随用户的默认模型。
- 工具只有网页搜索和读网页：`chatConfig.toolMode` 为 `custom`，插件只有 `lobe-web-browsing`，所以普通 Agent
  默认有的云电脑、记忆、技能和 Agent 管理都没有。服务端和网页端都按这个设置给工具。要办的事（发消息、发邮件、付款等）
  仍由 Biber 来做，照常请用户审批。
- 移除就是删除这个 Agent：和他的单聊，以及他在群聊里的回答，都一起删除（消息随 Agent 级联删除）。手机上删除前会说明。
- 改了目录里的提示词，已添加的专家不会跟着变；用户移除再添加才会用新的。

**群聊：** 用户在手机 "对话 → 新对话" 里勾选 1 到 8 位专家发起群聊，Biber 自动是主持
（`chat_groups_agents.role = 'supervisor'`），不另建虚拟主持。一个人可以有多个群。群聊右上角 "群成员" 里可以加减专家；
Biber 不能移出，至少留一位专家。从群里移出的专家，之前的回答留在群里。删掉群不会删掉 Biber 和专家。

**谁来回答：**

1. 用户只 @ 了一位专家：由他直接回答，Biber 不插话。
2. @ 了几位：交给 Biber，并告诉它是哪几位，由它请这几位回答。
3. 没有 @：Biber 回答。简单的自己答；有合适的专家就用 `speak` 请他回答，需要几位时用 `broadcast`；
   记忆、日程、提醒、账号凭据和要审批的事不交给专家。这些规则在 `apps/server/src/services/experts/host.ts`。
4. 模型回复里写出的 @ 不会让任何人回答。手机把用户选的 @ 存成成员 id 发给服务端，不从文字里解析。

手机上群里每条回答的上方显示是谁说的，同一人连着说只显示一次。手机发起的运行照常在手机上审批。

**网页端：** 手机建的群在网页的群组里能打开、接着聊，由网页自己的群聊流程运行，专家同样只有网页搜索和阅读。
网页上 Biber 的消息署群名、标 "Orchestrator"，成员列表里也不列出 Biber，这是 LobeHub 群组原来的显示方式。
在网页上新建的群仍按 LobeHub 原来的做法另建一个虚拟主持，不由 Biber 主持。

**还没有的：** 聊天软件（Telegram、微信等）里没有群聊，仍是和 Biber 一对一；没有专家市场；不能引用某条消息回复。

## 16. 邮件和日历

Biber 能读用户的邮件、代发邮件，能看日程、找空闲、建改删日程。发邮件和改日程都先请用户批准。
为什么这样定见 [决策记录](./decisions.md) 第 21 条。用户在手机 "账户 → 邮件和日历" 里连接，网页上没有连接界面，
但连上后网页对话里 Biber 同样能用。连上的账户就成了 Biber 的工具（写进 Biber 这条 Agent 的插件），断开后移除。

**国际版：Gmail、Google 日历、Outlook，经 Composio。**

- 服务端设 `COMPOSIO_API_KEY`；不设时手机上显示 "这项服务还没有开通邮件和日历"。
- 手机点 "连接" 后，在应用内浏览器打开 Composio 的授权页；授权完回调到 `${APP_URL}/api/composio/oauth/callback`。
  用户关掉浏览器回到手机，列表刷新时服务端向 Composio 确认连接已生效，再把这个工具包交给 Biber。
- 读写走 Composio 已通过谷歌、微软审核的应用，我们不用自己申请 Gmail 的受限权限。

**国内版：邮箱（IMAP / SMTP）和飞书日历。**

- 邮箱：用户选服务商（QQ 邮箱、网易 163 / 126、腾讯企业邮、阿里企业邮、网易企业邮，QQ / 163 / 126 地址可以不选），
  填地址和授权码；其他邮箱选 "其他"，自己填 IMAP、SMTP 服务器和端口。服务端先真的登录 IMAP、验证 SMTP，成功才保存。
  - 授权码不是邮箱登录密码，要在邮箱网页版的设置里开启 IMAP/SMTP 服务后生成（有的邮箱叫 "客户端专用密码"）；
    企业邮箱一般填邮箱密码，管理员开了安全登录时填客户端专用密码。授权码用 `KEY_VAULTS_SECRET` 加密存储，断开即删。
  - 自填的服务器只连 IMAP 143 / 993、SMTP 25 / 465 / 587，解析出内网或本机地址的一律拒绝，防止被拿来访问部署所在的网络。
    993 和 465 用 SSL，其余端口必须 STARTTLS。`MAIL_ALLOW_PRIVATE_HOSTS=1` 会放开这些限制，只给本地冒烟用，生产不要设。
  - 登录后发 IMAP `ID` 命令（网易邮箱要求），读信不标已读，发出的信存一份到 "已发送"；一封最多 20 个收件人。
- 飞书日历：用第 3 节共享机器人的飞书商店应用（`bot set feishu` 存的那个），不另建应用。在飞书开放平台里：
  - 权限管理里开通用户身份的 `calendar:calendar`、`calendar:calendar:readonly` 和 `offline_access`；
  - 安全设置的重定向 URL 加上 `${APP_URL}/api/feishu/calendar/callback`。
  - 手机点 "连接飞书日历" 后在应用内浏览器打开飞书授权页，授权完回调页显示 "已连接飞书日历"，回到手机即可。
    授权链接里的 state 10 分钟内有效、只能用一次。用户令牌到期前 5 分钟自动刷新；刷新失败或飞书说令牌失效时，
    手机上这一项显示 "已失效，请重新连接"。没有存飞书应用时，手机上显示 "这项服务还没有开通飞书日历"。
  - 时间按用户的时区（手机上报的，没有就用网页设置的，再没有就是 Asia/Shanghai）解释和显示。

**护栏（两个版本相同）：**

- 邮件里的验证码、一次性登录链接、重置密码和确认邮箱的链接，交给模型前换成 `[hidden]`，Composio 返回的 Gmail、
  Outlook 内容也一样。Biber 被告知这些看不到，请用户自己去邮件里看。
- 邮件和邀请的内容对 Biber 是资料，不是指令：信里让它发、付、点、转发或修改什么，都先告诉用户。
- 发邮件、建改删日程都先请用户批准，除非用户在审批设置里开了自动运行，或把这个工具设为总是允许。
  外发检查（决策记录第 14 条）也查 Biber 自己发的邮件和日程。

**还没有的：** 网页端的连接界面；一个人连多个邮箱；国际版的 IMAP 邮箱和 Lark 日历；CalDAV；日程变化时主动提醒；
读附件的内容（只列名字和大小）。

## 17. 保存的登录和云电脑上的浏览器

Biber 可以操作它云电脑上的浏览器：打开网页、看页面、点按钮、填表；也可以用用户在手机上保存的登录替用户登录网站。
密码只由云电脑填进页面，不会出现在任何发给模型的请求里。为什么这样定见 [决策记录](./decisions.md) 第 22 条。

**只在跑云电脑的部署里有。** 服务端 `SANDBOX_PROVIDER=openbot`（国内版默认就是），且设了 `OPENBOT_SUPERVISOR_URL`、
`OPENBOT_SUPERVISOR_TOKEN`、`OPENBOT_COMPUTER_TOKEN`（见第 6 节）。没有时 Biber 拿不到浏览器工具，网页对话也一样
（服务端经 `enableCloudComputer` 告诉网页）。国际版默认的 Market 沙箱没有这些接口。

**Biber 能做的（`lobe-computer` 工具）：**

- 打开网页、看页面（列出输入框、按钮、链接）、读页面、滚动、点击、输入、按键。
- 点付款、购买、下单、发送、删除、转账、订阅这类按钮或链接要用户批准；在有这类按钮的页面按回车或空格也要批准。
  按钮名由服务端从它自己取的页面快照里读，不信模型说的；批准卡片写明按钮名和网站，执行前再核对一次。
  认哪些名字在 `packages/agent-policy/src/browser.ts`。
- 求助：Biber 请用户接管时，手机收到 "Biber 需要你" 的推送，点开是云电脑页。推送文字是固定的，不带页面内容。
- 写进网页的文字和打开的网址也过外发检查（决策记录第 14 条）。

**保存的登录：**

- 用户在手机 "账户 → 保存的登录" 里添加：网址、用户名、密码、名称（可不填）。网址只收 https，填 `qq.com` 存成
  `https://qq.com`，带路径的只取网站本身。用户名和密码用 `KEY_VAULTS_SECRET` 加密存在 `saved_logins` 表里，
  谁都看不到原文，只能删掉重存。一个人最多 50 条。
- Biber 只能看到每条登录的编号、网站、遮住的账户（如 `a•••@qq.com`）和名称。
- 每次登录都要用户批准，卡片写明网站和账户。批准后服务端核对这条登录确实是卡片上写的网站和账户，再由云电脑
  自己找到用户名和密码框填入并提交；页面不在这个网站上时，云电脑拒绝。Biber 只得到 "提交了没有、要不要验证码"。
- 网站要验证码时，Biber 请用户填：手机收到推送，云电脑页出现一个密码式输入框，填好后直接进网页的那个框，Biber 看不到。
  Biber 最多等约 100 秒，等不到就告诉用户还在等。
- 云电脑里的 Chromium 每次启动前都关掉密码管理器和自动填充，填过的密码不会存进浏览器资料，Biber 的命令行读不到。
- `SAVED_LOGINS_ALLOW_HTTP=1` 允许保存 http 网站，只给本地冒烟用，生产不要设。

**还没有的：** 网页端的 "保存的登录" 管理界面；银行卡、地址自动填；从 1Password、Bitwarden 导入；跨网站的两步登录
（比如先到另一个域名的身份认证页）由用户接管完成。
