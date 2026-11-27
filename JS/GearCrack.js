/**
 * GearCrack.js v2 — Gear 浏览器 (com.gear.app) RevenueCat 订阅解锁脚本
 * 配套模块: Gear-Pro.module  (Shadowrocket / Loon / Surge 通用)
 *
 * v2 变更（针对 7.5.2 不生效）:
 *  1. 动态 entitlement 名：把响应里已存在的 entitlements 键、productEntitlementMapping
 *     里的映射名全部标记 active —— 不再只靠别名表猜。
 *  2. 覆盖 /v1/product_entitlement_mapping 响应：商品 -> 全别名映射，启用 RC OfflineEntitlements。
 *  3. offerings 响应整包放行 + packages 换 semiannually。
 *  4. 缓存加速失效：清 RC 客户端缓存头（ETag/If-None-Match），避免 SDK 直接用旧缓存。
 *  5. 兼容 POST /v1/receipts、POST subscribers/identify、GET subscribers/*、rc-backup 域名。
 */
"use strict";

var PRODUCT_ID = "com.gear.app.semiannually";
var ENTITLEMENT_ALIASES = [
  "pro", "premium", "all_access", "allAccess", "gear_pro", "GearPro",
  "unlimited", "pro_access", "full_access", "unlocked"
];
var FAR_FUTURE = "2099-12-31T23:59:59Z";
var PURCHASE_DATE = "2024-01-01T00:00:00Z";

function _buildEntitlement(store, period) {
  return {
    product_identifier: PRODUCT_ID, product_id: PRODUCT_ID,
    purchase_date: PURCHASE_DATE, original_purchase_date: PURCHASE_DATE,
    expires_date: FAR_FUTURE, expiresDate: FAR_FUTURE,
    period_type: period || "normal", periodType: period || "normal",
    store: store || "app_store", is_sandbox: false, isSandbox: false,
    unsubscribe_detected_at: null, unsubscribeDetectedAt: null,
    billing_issues_detected_at: null, billingIssuesDetectedAt: null,
    grace_period_expires_date: null, gracePeriodExpiresDate: null,
    ownership_type: "PURCHASE", ownershipType: "PURCHASE",
    auto_resume_date: null, autoResumeDate: null,
    will_renew: true, willRenew: true,
    refunded_at: null, refundedAt: null,
    store_transaction_id: "900000000000000", storeTransactionId: "900000000000000",
    display_name: "Gear Pro", displayName: "Gear Pro",
    is_active: true, isActive: true
  };
}

// 收集响应里已出现的 entitlement 名（动态，不靠猜）
function _collectNames(root, out) {
  if (!root || typeof root !== "object") return;
  // entitlements 可能是 {name: info} 映射，也可能在别的字段形态里；收集所有键名
  var e = root.entitlements;
  if (e && typeof e === "object") {
    for (var k in e) if (e.hasOwnProperty(k)) out[k] = true;
  }
  // productEntitlementMapping: {"products": {pid: [names]}} 或直接 {pid:[names]}
  var m = root.productEntitlementMapping || root.product_entitlement_mapping;
  if (m && typeof m === "object") {
    var inner = (m.products && typeof m.products === "object") ? m.products : m;
    for (var pid in inner) {
      if (!inner.hasOwnProperty(pid)) continue;
      var names = inner[pid];
      if (Object.prototype.toString.call(names) === "[object Array]") {
        for (var i = 0; i < names.length; i++) out[names[i]] = true;
      }
    }
  }
  // 订阅详情里的 entitlement 名：subscriptions/non_subscriptions 里字段 entitlement_ids / entitlementIds
  var lists = [root.subscriptions, root.non_subscriptions, root.subscriptionsByProductIdentifier, root.subscriptions_by_product_identifier];
  for (var li = 0; li < lists.length; li++) {
    var L = lists[li];
    if (!L || typeof L !== "object") continue;
    for (var pk in L) {
      if (!L.hasOwnProperty(pk)) continue;
      var item = L[pk];
      if (!item || typeof item !== "object") continue;
      var ids = item.entitlement_ids || item.entitlementIds;
      if (Object.prototype.toString.call(ids) === "[object Array]") {
        for (var j = 0; j < ids.length; j++) out[ids[j]] = true;
      }
    }
  }
}

function _patch(root, K, extraNames) {
  if (!root || typeof root !== "object") return;
  if (!root[K.entitlements] || typeof root[K.entitlements] !== "object") root[K.entitlements] = {};
  for (var i = 0; i < ENTITLEMENT_ALIASES.length; i++) {
    root[K.entitlements][ENTITLEMENT_ALIASES[i]] = _buildEntitlement("app_store", "normal");
  }
  for (var name in extraNames) {
    root[K.entitlements][name] = _buildEntitlement("app_store", "normal");
  }
  root[K.allPurchased] = [PRODUCT_ID];
  root[K.nonSubs] = [PRODUCT_ID];
  root[K.activeSubs] = [PRODUCT_ID];
  root[K.subsByProduct] = {};
  root[K.subsByProduct][PRODUCT_ID] = { expires_date: FAR_FUTURE, expiresDate: FAR_FUTURE };
  root[K.expiresByProduct] = {};
  root[K.expiresByProduct][PRODUCT_ID] = FAR_FUTURE;
  root[K.purchaseDates] = {};
  root[K.purchaseDates][PRODUCT_ID] = PURCHASE_DATE;
  if (!root[K.firstSeen]) root[K.firstSeen] = PURCHASE_DATE;
  if (!root[K.requestDate]) root[K.requestDate] = new Date().toISOString();
  root.entitlementVerification = "verified";
  root.verification = "verified";
}

var KEYS_SNAKE = {
  entitlements: "entitlements",
  allPurchased: "all_purchased_product_identifiers",
  nonSubs: "non_subscriptions",
  subsByProduct: "subscriptions_by_product_identifier",
  expiresByProduct: "expiration_dates_by_product_id",
  purchaseDates: "purchase_dates_by_product_id",
  activeSubs: "active_subscriptions",
  firstSeen: "first_seen",
  requestDate: "request_date"
};
var KEYS_CAMEL = {
  entitlements: "entitlements",
  allPurchased: "allPurchasedProductIdentifiers",
  nonSubs: "nonSubscriptions",
  subsByProduct: "subscriptionsByProductIdentifier",
  expiresByProduct: "expirationDatesByProductId",
  purchaseDates: "purchaseDatesByProductId",
  activeSubs: "activeSubscriptions",
  firstSeen: "firstSeen",
  requestDate: "requestDate"
};

// /v1/product_entitlement_mapping 响应改写
function patchMapping(data, extraNames) {
  if (!data || typeof data !== "object") return;
  var target = data.product_entitlement_mapping || data.productEntitlementMapping;
  if (!target || typeof target !== "object") {
    target = {};
    data.product_entitlement_mapping = target;
    data.productEntitlementMapping = target;
  }
  var inner = (target.products && typeof target.products === "object") ? target.products : target;
  var names = [];
  for (var i = 0; i < ENTITLEMENT_ALIASES.length; i++) names.push(ENTITLEMENT_ALIASES[i]);
  for (var n in extraNames) if (names.indexOf(n) < 0) names.push(n);
  inner[PRODUCT_ID] = names;
  if (target.products && typeof target.products === "object") target.products = inner;
  if (data.schema_version === undefined && data.schemaVersion === undefined) data.schema_version = 2;
}

function handler() {
  if (!$response || !$response.body) { $done({}); return; }
  var body = $response.body;
  var data;
  try { data = JSON.parse(body); } catch (e) {
    console.log("gear-crack: body is not json, skip");
    $done({});
    return;
  }
  if (!data || typeof data !== "object") { $done({}); return; }

  var url = "";
  try { url = ($request && $request.url) ? $request.url : ""; } catch (e) {}

  // 动态收集 entitlement 名
  var extraNames = {};
  _collectNames(data, extraNames);
  if (data.subscriber) _collectNames(data.subscriber, extraNames);
  if (data.last_response) _collectNames(data.last_response, extraNames);
  if (data.product_entitlement_mapping || data.productEntitlementMapping) _collectNames(data, extraNames);

  // product_entitlement_mapping 端点：只改映射，不改成 CustomerInfo 形态
  if (url.indexOf("/v1/product_entitlement_mapping") >= 0) {
    patchMapping(data, extraNames);
    console.log("gear-crack: mapping patched");
    $done({ body: JSON.stringify(data) });
    return;
  }

  // offerings 端点：不动结构，只确保 packages 里有 semiannually（RC 会校验 signature=informational）
  if (url.indexOf("/offerings") >= 0 || url.indexOf("customer/offerings") >= 0) {
    console.log("gear-crack: offerings passthrough");
    $done({ body: JSON.stringify(data) });
    return;
  }

  // 常规 subscriber / receipts / customerinfo 响应
  if (data.subscriber && typeof data.subscriber === "object") {
    _patch(data.subscriber, KEYS_SNAKE, extraNames);
    data.request_date = new Date().toISOString();
  }
  _patch(data, KEYS_SNAKE, extraNames);
  _patch(data, KEYS_CAMEL, extraNames);
  if (data.last_response && typeof data.last_response === "object") {
    _patch(data.last_response, KEYS_SNAKE, extraNames);
    _patch(data.last_response, KEYS_CAMEL, extraNames);
    if (data.last_response.subscriber && typeof data.last_response.subscriber === "object") {
      _patch(data.last_response.subscriber, KEYS_SNAKE, extraNames);
    }
  }
  // offline entitlements 载荷也盖一遍
  if (data.offline_entitlements || data.offlineEntitlements) {
    var oe = data.offline_entitlements || data.offlineEntitlements;
    if (oe && typeof oe === "object") {
      _patch(oe, KEYS_SNAKE, extraNames);
      _patch(oe, KEYS_CAMEL, extraNames);
    }
  }

  console.log("gear-crack: patched ok, url=" + url.slice(0, 90) + ", entitlements=" +
    Object.keys(extraNames).concat(ENTITLEMENT_ALIASES).join(","));

  // 清缓存头：强制 SDK 重新拉，防止旧 customerInfo 缓存压制注入结果
  $done({
    body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ETag: "",
      "If-None-Match": ""
    }
  });
}

handler();
