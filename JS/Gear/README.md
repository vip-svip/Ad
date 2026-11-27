# Gear 浏览器 7.5.1 破解模块 — 交付说明

目标样本：`C:\Users\admin\Downloads\Gear-7.5.1.ipa`（24,119,833 B，SHA256 B96C29F2…EFEF，砸壳 dump）
交付目录：`F:\BUG\gear-ipa\crack\`

## 产物

| 文件 | 说明 |
|---|---|
| Gear-Pro.module | Shadowrocket / Loon / Surge 通用模块头（参考 adguard.module / aloha.module 格式） |
| GearCrack.js | MITM http-response 改写脚本（订阅解锁核心） |
| gear_rc_test.js | Node 离线验证夹具：三种响应形态 × 注入逻辑，3/3 PASS |
| gear_rc_sample_server.py | 本地 RC 响应样本服务器（127.0.0.1:18777），动态抓包对照用 |
| 验证记录.md | 本文件（定位流程 + 证据 + 验证 + 回滚） |

## 侦察定位流程（复现路径）

1. 解包：Python `zipfile.extractall` 解 `Gear-7.5.1.ipa` → `F:\BUG\gear-ipa\Payload\Gear.app\`
   （Expand-Archive 对 lproj 条目会炸 PathNotFound，别用）
2. Info.plist：`CFBundleIdentifier=com.gear.app`，版本 7.5.1 / 7501。
3. 主二进制 `Gear`（16,065,552 B，arm64 Mach-O，已解密）。strings 区扫描命中：
   - RevenueCat API key：`appl_jCxcdrbHiDqPbWGPbdDzqIMuNPc` @0xbb6580
   - 唯一商品 ID：`com.gear.app.semiannually` @0xbb5920
   - RC host：`api.revenuecat.com` @0xbccb78/0xbcf3b8
   - RC GET 端点：`/v1/subscribers/{app_user_id}`（POST：receipts / identify / redeem_purchase）
4. RC 响应解析键集（Swift Codable，__cstring @0xb95f2b 区）：
   `entitlements / allPurchasedProductIdentifiers / nonSubscriptions / requestDate / firstSeen /
   subscriptionsByProductIdentifier / expirationDatesByProductId / purchaseDatesByProductId /
   entitlementVerification`（EntitlementInfo 键：`expiresDate / isActive / willRenew / periodType /
   productIdentifier / ownershipType / store / isSandbox` @0xb96354-0xb96492）。
   wire 层 snake_case（`request_date` 等）与 camelCase 双写兼容。
5. 签名校验：RC `VerificationResult` 值 VERIFIED/UNVERIFIED @0xbbd217 区；Gear 未设
   `EntitlementVerificationMode.enforced`（`informational` @0xba66a1）→ 响应体篡改不被拦截。
6. Gear 模块符号已剥离（LC_SYMTAB 3404 条全是系统框架符号；chained-fixup 头损坏无法解 imports），
   静态找 Pro 判定分支不可行 → MITM 改 RC 响应是唯一无偏移路线。
7. 排除项：附带 dylib 不是破解本体 —— `Gear 浏览器.dylib` = GearLLQCrack.dylib（只是 MBProgressHUD
   下载助手 UI）；`libJailedShim.dylib` = 越狱 shim；`libusbiertate.dylib` = Template.dylib tweak 模板。

## 模块格式（与 adguard.module / aloha.module 对齐）

```
#!name / #!desc / #!homepage / #!author / #!icon
[Script]
GearPro=type=http-response,pattern=^https?:\/\/api\.revenuecat\.com\/v1\/(subscribers|receipts|customers\/subscribers)\/.*,requires-body=1,script-path=<部署后改成本地/GitHub URL>
[MITM]
hostname = %APPEND% api.revenuecat.com
```

## 安装（Shadowrocket）

1. `Gear-Pro.module` 传到手机（AirDrop/文件），Shadowrocket → 配置 → 添加模块。
2. 把 `script-path` 改成可达地址（GitHub raw / 本地 http）。
3. 首页开启 MITM：安装并信任 Shadowrocket CA（设置 → 证书 → 安装 → 通用 → 关于本机 → 证书信任）。
4. 开启连接，重启 Gear → 订阅页/设置里 Pro 功能直接解锁。

## 验证（已跑）

- `node gear_rc_test.js` →
  - wire-snake-case / camel-customerinfo / nested-last_response 三夹具全 PASS：
    `pro.is_active=true, expires_date=2099-12-31T23:59:59Z, entitlementVerification=verified,`
    `all_purchased=["com.gear.app.semiannually"], expiration_dates_by_product_id={com.gear.app.semiannually:2099-…}`（exit 0）
- 真机验证步骤：装模块后开 Gear → 设置 → Pro 功能（Extension/Intelligence/DarkMode/Gaming/DeveloperTools）
  不再弹订阅页；RC 日志 `gear-crack: patched ok` 出现在 Shadowrocket 日志页。

## 回滚

- Shadowrocket 配置里移除 Gear-Pro 模块 / 关闭对应脚本开关即可，全部改动只存在于代理层，
  App 数据不动。MITM hostname 行删掉 `api.revenuecat.com` 即还原。

## 已知边界

- entitlement 别名表注入了 10 个常见名（pro/premium/all_access/...）；若 Gear 用的是后台自定义
  entitlement 名，用 Shadowrocket 日志抓一次真实响应，把名字加进 `ENTITLEMENT_ALIASES` 即可。
- 若未来 RC 打开 enforced 签名校验，需换离线票方案（offlineEntitlements / 客户端内存补丁）。
