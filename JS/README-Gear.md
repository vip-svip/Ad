# Gear 浏览器 Pro 解锁模块（Gear-7.5.1）

Shadowrocket / Loon / Surge 通用。目标：`com.gear.app` 7.5.1（RevenueCat 订阅付费墙）。

## 使用

1. 添加模块：Shadowrocket → 配置 → + → 输入本 raw 地址
   `https://raw.githubusercontent.com/vip-svip/Ad/main/JS/Gear-Pro.module`
2. 设置 → 证书 → 安装并信任 CA（MITM 需要）
3. 重启 Gear 浏览器 → Pro 功能（扩展/智能/深色/游戏/开发者工具）直接解锁

## 原理

MITM 拦截 `https://api.revenuecat.com/v1/subscribers/*`（含 receipts / customers/subscribers）
响应，注入 entitlements：`com.gear.app.semiannually` + 10 个常见别名，expires_date 2099，
双写 snake_case / camelCase 兼容 RC 4.x 解析。Gear 未启用 RC enforced 签名校验，改体直接生效。

## 文件

| 文件 | 说明 |
|---|---|
| Gear-Pro.module | 模块头（pattern + MITM hostname） |
| GearCrack.js | 响应改写脚本 |

## 回滚

Shadowrocket 里移除模块即可；App 数据不动。
