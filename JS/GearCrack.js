/**
 * GearCrack.js — Gear 浏览器 7.5.1 (com.gear.app) RevenueCat 订阅解锁脚本
 * 配套模块: Gear-Pro.module  (Shadowrocket / Loon / Surge 通用)
 * 原理: MITM 拦截 https://api.revenuecat.com/v1/subscribers/* 与 /v1/receipts* 响应，
 *       注入 entitlements(com.gear.app.semiannually) + 远期 expires_date，
 *       并双写 snake_case / camelCase 字段兼容 RC 4.x Swift Codable 与 ObjC RC* 桥接两套解析。
 *       Gear 未启用 enforced 签名校验(verification=informational)，改体直接生效。
 */
"use strict";

var PRODUCT_ID = "com.gear.app.semiannually";
var ENTITLEMENT_ALIASES = [
  "pro", "premium", "all_access", "allAccess", "gear_pro", "GearPro",
  "unlimited", "pro_access", "full_access", "unlocked"
];
var FAR_FUTURE = "2099-12-31T23:59:59Z";

function _buildEntitlement(store, period) {
  return {
    product_identifier: PRODUCT_ID, product_id: PRODUCT_ID,
    purchase_date: "2024-01-01T00:00:00Z", original_purchase_date: "2024-01-01T00:00:00Z",
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

function _patch(root, K) {
  if (!root || typeof root !== "object") return;
  if (!root[K.entitlements] || typeof root[K.entitlements] !== "object") root[K.entitlements] = {};
  for (var i = 0; i < ENTITLEMENT_ALIASES.length; i++) {
    root[K.entitlements][ENTITLEMENT_ALIASES[i]] = _buildEntitlement("app_store", "normal");
  }
  root[K.allPurchased] = [PRODUCT_ID];
  root[K.nonSubs] = [PRODUCT_ID];
  root[K.activeSubs] = [PRODUCT_ID];
  root[K.subsByProduct] = { };
  root[K.subsByProduct][PRODUCT_ID] = { expires_date: FAR_FUTURE, expiresDate: FAR_FUTURE };
  root[K.expiresByProduct] = { };
  root[K.expiresByProduct][PRODUCT_ID] = FAR_FUTURE;
  root[K.purchaseDates] = { };
  root[K.purchaseDates][PRODUCT_ID] = "2024-01-01T00:00:00Z";
  if (!root[K.firstSeen]) root[K.firstSeen] = "2024-01-01T00:00:00Z";
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

  // 1) wire 格式: {"request_date":..., "subscriber":{...}} — GET /v1/subscribers/*、POST /v1/receipts、POST identify
  if (data.subscriber && typeof data.subscriber === "object") {
    _patch(data.subscriber, KEYS_SNAKE);
    data.request_date = new Date().toISOString();
  }
  // 2) 顶层 CustomerInfo 形态（缓存/桥接层可能直接给对象）
  _patch(data, KEYS_SNAKE);
  _patch(data, KEYS_CAMEL);
  // 3) {"last_response":{"subscriber"...}} / {"last_response":{CustomerInfo}}
  if (data.last_response && typeof data.last_response === "object") {
    _patch(data.last_response, KEYS_SNAKE);
    _patch(data.last_response, KEYS_CAMEL);
    if (data.last_response.subscriber && typeof data.last_response.subscriber === "object") {
      _patch(data.last_response.subscriber, KEYS_SNAKE);
    }
  }

  var out = JSON.stringify(data);
  console.log("gear-crack: patched ok, out=" + out.length + " bytes, entitlements=" + ENTITLEMENT_ALIASES.join(","));
  $done({ body: out });
}

handler();
