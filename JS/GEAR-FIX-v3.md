# Gear 破解模块 v2 → v3 根因报告

日期：2026-11-27
样本：Gear 7.5.1 (com.gear.app, build 7501) + 手机端 7.5.2 实测

## 结论先行

**"原本都不生效"是真的，根因不在手机配置，在脚本输出。**
v2 生成的响应 JSON 有 3 处违反 RevenueCat iOS SDK 的 Codable 解码契约，
RC 解码时直接抛错 → 走错误分支 → 回退本地旧缓存（无 pro）→ 界面永远显示未订阅。
脚本日志照样打 "patched ok"，所以从外面看像"脚本跑了但没用"。

## 三处硬伤（v2 输出 → RC SDK 解码行为）

| # | 位置 | v2 写法 | RC 期望 | 后果 |
|---|------|---------|---------|------|
| 1 | `subscriber.non_subscriptions` | `["com.gear.app.semiannually"]`（数组） | `[String: [NonSubscription]]`（dict of arrays） | `typeMismatch` → 整个 `CustomerInfoResponse` 解码失败 |
| 2 | 顶层 `verification` | `"verified"`（小写） | `VerificationResult` rawValue = `NOT_REQUESTED` / `VERIFIED` / `FAILED`（大写） | 枚举解码失败 → 同样整包失败 |
| 3 | `product_entitlement_mapping[pid]` | `["pro","premium",...]`（数组） | `{"entitlements":[...], "product_identifier":"pid"}`（对象） | `ProductEntitlementMapping` 解码失败 → offline entitlements 路径报错 |

附带污染（不致命但已清）：`active_subscriptions`、`subscriptions_by_product_identifier`、
`expiration_dates_by_product_id`、`purchase_dates_by_product_id` 是 `CustomerInfo`
内存对象的属性名，wire 里不存在；`entitlementVerification` 同。

## 证据（可复现）

```bash
cd F:\BUG\gear-ipa\crack

# 1) 真实服务器响应本身是合法的
node rc_schema_validator.js _real_response.json
# -> PASS: RC SDK 可解码

# 2) v2 脚本处理同一份响应后 → 7 处违规
node run_js.js _real_response.json "https://api.revenuecat.com/v1/subscribers/test-user" _patched_current.json
node rc_schema_validator.js _patched_current.json
# -> FAIL: verification 非法值 "verified" / non_subscriptions 是 array(解码必炸) / 4 处污染键

# 3) v3 脚本 → 10/10 夹具 PASS
node gear_rc_test.js
# -> 结果: 10/10 PASS
```

## v3 修法

1. `non_subscriptions` 不再写数组；要标记已购就写进 `subscriptions`（`activeSubscriptions`
   与 `allPurchasedProductIdentifiers` 的真正来源）。
2. `verification` 不主动引入；原响应带非法值时才纠正为 `NOT_REQUESTED`（大写）。
3. mapping 每个商品值写成 `{entitlements:[...], product_identifier: pid}` 对象。
4. `entitlements` / `subscriptions` 的值只保留 RC Codable 认识的字段，日期一律 ISO8601；
   subscription 对象不含 `product_identifier`（product id 由字典 key 提供）。
5. 清掉全部 wire 不存在的键。

## 注入覆盖面（Gear 侧无论读哪个都能命中）

| Gear 可能的判定 | v3 是否覆盖 |
|---|---|
| `customerInfo.entitlements["pro"]?.isActive` | ✅ 注入 pro（expires 2099）+ 动态收集响应里出现的其它名 |
| `customerInfo.activeSubscriptions.contains("com.gear.app.semiannually")` | ✅ subscriptions 写入 3 个商品 |
| `customerInfo.allPurchasedProductIdentifiers` | ✅ 数组写入 3 个商品 |
| `customerInfo.nonSubscriptions` | ⬜ 不写（写了就炸，见硬伤 1） |
| offline entitlements（product_entitlement_mapping） | ✅ mapping 端点按真实结构改写 |

## 真实接口实锤

```
GET https://api.revenuecat.com/v1/product_entitlement_mapping
Authorization: Bearer appl_jCxcdrbHiDqPbWGPbdDzqIMuNPc
->
{"product_entitlement_mapping":{
  "com.gear.app.monthly":      {"entitlements":["pro"],"product_identifier":"com.gear.app.monthly"},
  "com.gear.app.semiannually": {"entitlements":["pro"],"product_identifier":"com.gear.app.semiannually"},
  "com.gear.app.yearly":       {"entitlements":["pro"],"product_identifier":"com.gear.app.yearly"}}}
```

Gear 的真实 entitlement ID 是 **`pro`**，3 个商品全部映射到它。
GET subscriber 响应头只有 `x-revenuecat-etag`，无签名头；Gear 二进制内无
`verifySignature`/`SigningManager`/`x-signature` 引用 → verification 走 informational，
MITM 改体不会被签名校验拦。

## 部署状态（VERIFIED）

| 产物 | 地址 / 值 |
|---|---|
| 脚本 | `https://raw.githubusercontent.com/vip-svip/Ad/main/JS/GearCrack.js`（commit `9e2edba25a010959faea50bce9135f31c9a43db3`，9688 B） |
| 模块 | `https://raw.githubusercontent.com/vip-svip/Ad/main/JS/Gear-Pro.module`（commit `d9a8d63ebf9fb66fdbad012663d924adf1782fbb`） |
| 模块 script-path | `https://cdn.jsdelivr.net/gh/vip-svip/Ad@9e2edba25a010959faea50bce9135f31c9a43db3/JS/GearCrack.js`（commit 固定，无 CDN 缓存延迟） |
| 本地 | `F:\BUG\gear-ipa\crack\{GearCrack.js, Gear-Pro.module, rc_schema_validator.js, gear_rc_test.js}` |

本地与 jsDelivr 字节一致（9688 B，base64 比对 True）。

## 手机端操作（必须按顺序）

1. Shadowrocket → 配置 → 模块：**删除旧的 Gear 模块**（如有），也删掉/关闭
   `vsco.js`、`blocker.js` 相关脚本与模块——它们的 pattern 同样匹配
   `api.revenuecat.com/v1/subscribers`，抢占后本模块静默失效（11:49 日志实证：
   命中的是 vsco.js/blocker.js，0 条 GearCrack 痕迹）。
2. 重新添加模块：URL 填 `https://raw.githubusercontent.com/vip-svip/Ad/main/JS/Gear-Pro.module`
3. 确认 MITM 开启、hostname 列表含 `api.revenuecat.com`、CA 证书已信任。
4. **杀掉 Gear 进程重开**（RC 缓存 purchaserInfo，进程不重启不刷新）。
5. 进订阅页/触发一次刷新，然后在 Shadowrocket 脚本日志里应看到：
   `gear-crack: patched ok url=... entitlements=pro,... subs=com.gear.app.monthly,...`
   —— 看到这行才说明脚本真的跑了。

## 回滚

删除手机里的 Gear-Pro 模块 + 从 MITM hostname 移除 `api.revenuecat.com`。
服务器端零改动，无残留。

## 若仍不亮，下一步需要什么

1. Shadowrocket **脚本日志**（不是 PacketTunnel 日志）——看有没有 `gear-crack: patched ok`；
2. 或 **Gear-7.5.2.ipa** 样本——直接从二进制定位 7.5.2 的 Pro 判定调用链，
   确认它读的是 entitlements 还是别的字段。
