# Gear 浏览器 (com.gear.app) Pro 破解模块

Shadowrocket / Loon / Stash MITM 模块，拦截 RevenueCat 响应注入 entitlement "pro"。

## 安装（Shadowrocket）
1. 配置 → 添加模块 → URL 填：https://raw.githubusercontent.com/vip-svip/Ad/main/JS/Gear-Pro.module
2. 首页 → 配置 → 信任 CA 证书（模块 CA）
3. 设置里确认 MITM 已开启且 hostname 含 api.revenuecat.com
4. **杀掉 Gear 进程重开**（RC 有客户端缓存 purchaserInfo/offerings，进程不重启不刷新）
5. 手机上若已装过 VSCO 等其它含 api.revenuecat.com 的脚本，先删掉，pattern 抢占会让本模块静默失效。

## 模块内容
- pattern: ^https?:\/\/api\.revenuecat\.com\/v1\/(subscribers|receipts|customers\/subscribers|product_entitlement_mapping)\/.*
- script-path: https://cdn.jsdelivr.net/gh/vip-svip/Ad@5410bb5fea84bff270a6815f48d1310aba3903a5/JS/GearCrack.js （commit 固定，jsDelivr 无缓存延迟）

## 原理
Gear 7.5.x 内嵌 RevenueCat SDK，GET /v1/subscribers/{id} 拿 entitlements，Gear 侧无本地 license 判定（符号剥离，无自定义 isPro），verification=informational（响应无签名校验）→ MITM 改响应体即可注入。

真实 mapping 实锤（curl api.revenuecat.com/v1/product_entitlement_mapping）：products = {com.gear.app.monthly, com.gear.app.semiannually, com.gear.app.yearly}，全部映射到 entitlement "pro"。

JS（GearCrack.js）行为：
1. GET subscriber → 向 subscriber.entitlements 注入 "pro"（expires_date = 2099-12-31）+ 动态收集响应中已有 entitlement 名；清 x-revenuecat-etag 与 Cache-Control:no-store 防缓存压制。
2. GET /v1/product_entitlement_mapping → 把 3 个商品 ID 全部指向全别名表（pro/premium/all/…，含响应里动态出现的名字）。
3. POST /v1/receipts → 同样注入 entitlements + 写 non_subscriptions。
4. offerings → passthrough。

## 回滚
删除手机里 Gear-Pro 模块 + api.revenuecat.com 相关 MITM hostname 即可恢复原状（服务器端无任何改动）。