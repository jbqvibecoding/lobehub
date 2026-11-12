# Biber

Biber 是在 LobeHub 之上做的个人 AI 助理：用户在聊天软件里交代事情，助理在云端完成，需要用户决定时
在手机或聊天里请求批准。本目录是 Biber 自己的工程文档；LobeHub 原有文档在 `docs/` 的其他目录。

- [决策记录](./decisions.md)：和最初设计不同的地方，以及原因。
- [运维手册](./operations.md)：两个版本各需要配置什么、回调地址填什么、哪些集成还没有实测。

## 两个版本

同一套代码按区域构建和部署成两个版本，账户、数据和密钥互不相通。

| `APP_REGION` | 版本                    | 手机包名           | 桌面应用标识           |
| ------------ | ----------------------- | ------------------ | ---------------------- |
| `global`     | 国际版                  | `ai.biber.app`     | `ai.biber.desktop`     |
| `cn`         | 中国大陆版              | `ai.biber.app.cn`  | `ai.biber.desktop.cn`  |
| `dev`        | 内部开发版，行为同 `cn` | `ai.biber.app.dev` | `ai.biber.desktop.dev` |

区域是构建期和部署期的设置，不是用户选项。发布构建和生产部署缺少 `APP_REGION` 时直接失败。
规则在 `packages/region`。

## Biber 的代码在哪

| 能力                                                         | 位置                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 区域规则、各版本可用的渠道和支付方式、启动预检               | `packages/region`                                                                   |
| 策略引擎：信任档位、工具分级、绑定到确切调用的审批、审计脱敏 | `packages/agent-policy`                                                             |
| 审批与审计记录                                               | `apps/server/src/services/toolApproval`、`agentActionAudit`、`approvalNotification` |
| 套餐目录与权益规则                                           | `packages/billing`                                                                  |
| 计费：Stripe、苹果内购、微信支付、支付宝、额度计量           | `apps/server/src/services/billing`                                                  |
| 共享机器人（每个平台一个官方账号服务所有用户）               | `apps/server/src/services/messenger/platforms/{telegram,imessage,lark,wechat}`      |
| 推送：Expo 与五家安卓厂商通道                                | `apps/server/src/services/push`                                                     |
| 短信登录                                                     | `apps/server/src/services/sms`、`src/libs/better-auth`                              |
| 云电脑（每个用户一台带浏览器的容器）                         | `apps/computer`、`apps/server/src/services/sandbox/providers/openbot.ts`            |
| 手机应用（遥控器和审批器）                                   | `apps/mobile`                                                                       |
| 支付和应用商店的回调入口                                     | `src/app/(backend)/api/webhooks/{stripe,apple,wechatpay,alipay}`                    |

## 各版本提供什么

|                            | 国际版                                               | 中国大陆版                                      |
| -------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| 登录                       | 邮箱、Apple、Google                                  | 手机号短信                                      |
| 共享机器人（配置了才出现） | Telegram、iMessage、Lark、飞书、微信、Slack、Discord | 微信、飞书                                      |
| 付款                       | Stripe、苹果内购                                     | 微信支付、支付宝、苹果内购                      |
| 手机推送                   | Expo                                                 | iOS 走 Expo；安卓走华为、荣耀、小米、OPPO、vivo |
