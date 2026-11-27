/**
 * GearCrack.js v3 — Gear 浏览器 (com.gear.app) RevenueCat 订阅解锁脚本
 * 配套模块: Gear-Pro.module (Shadowrocket / Loon / Surge / Stash)
 *
 * v3 修复（v2 输出会被 RC SDK 解码失败 → 注入完全不生效）:
 *  1. non_subscriptions 写成了数组 —— RC 的 Subscriber.nonSubscriptions 是
 *     [String: [NonSubscription]]（dict of arrays），类型不符会让整个
 *     CustomerInfoResponse 解码抛 typeMismatch，SDK 走错误分支、回退旧缓存，
 *     表现就是"脚本跑了但 Pro 不亮"。现在不再写这个键，改注入 subscriptions。
 *  2. verification 写成了小写 "verified" —— RC 的 VerificationResult rawValue 是
 *     大写 NOT_REQUESTED / VERIFIED / FAILED，非法值同样会让解码抛错。
 *     现在不主动引入该键，只在原响应带非法值时纠正为 NOT_REQUESTED。
 *  3. product_entitlement_mapping 的每个商品值被写成了数组 —— 真实结构是
 *     {"entitlements":[...],"product_identifier":"..."} 对象，数组会让
 *     ProductEntitlementMapping 解码失败。已按真实结构改写。
 *  4. 清掉 wire 里不存在的键（active_subscriptions / subscriptions_by_product_identifier /
 *     expiration_dates_by_product_id / purchase_dates_by_product_id / camelCase 变体），
 *     这些是 CustomerInfo 内存对象的属性名，塞进 wire 只是污染。
 *  5. entitlement 对象只保留 RC Codable 认识的字段，日期一律 ISO8601。
 *
 * 注入目标（真实接口实测）:
 *   GET  https://api.revenuecat.com/v1/product_entitlement_mapping
 *        → 3 个商品 com.gear.app.{monthly,semiannually,yearly} 全部映射 entitlement "pro"
 *   GET  https://api.revenuecat.com/v1/subscribers/{app_user_id}
 *   POST https://api.revenuecat.com/v1/receipts
 *   POST https://api.revenuecat.com/v1/subscribers/{id}/identify
 */
"use strict";

var PRODUCT_ID = "com.gear.app.semiannually";
var PRODUCT_IDS = ["com.gear.app.monthly", "com.gear.app.semiannually", "com.gear.app.yearly"];
var ENTITLEMENT_ALIASES = [
  "pro", "premium", "all_access", "gear_pro", "unlimited",
  "full_access", "pro_features", "plus", "vip", "unlocked"
];
var FAR_FUTURE = "2099-12-31T23:59:59Z";
var PURCHASE_DATE = "2024-01-01T00:00:00Z";
var TXN_ID = "2000000000000001";
var VERIFICATION_VALUES = ["NOT_REQUESTED", "VERIFIED", "FAILED"];
var WIRE_NOISE = [
  "active_subscriptions", "subscriptions_by_product_identifier",
  "expiration_dates_by_product_id", "purchase_dates_by_product_id",
  "activeSubscriptions", "subscriptionsByProductIdentifier",
  "expirationDatesByProductId", "purchaseDatesByProductId",
  "allPurchasedProductIdentifiers", "nonSubscriptions", "entitlementVerification"
];

function _isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }

// RC Codable: Entitlement 对象（entitlements 字典的值，需要 product_identifier）
function _purchaseObj() {
  return {
    product_identifier: PRODUCT_ID,
    purchase_date: PURCHASE_DATE,
    original_purchase_date: PURCHASE_DATE,
    expires_date: FAR_FUTURE,
    period_type: "normal",
    store: "app_store",
    is_sandbox: false,
    unsubscribe_detected_at: null,
    billing_issues_detected_at: null,
    grace_period_expires_date: null,
    ownership_type: "PURCHASE",
    store_transaction_id: TXN_ID
  };
}

// RC Codable: Subscription 对象（subscriptions 字典的值，product id 由字典 key 提供，无 product_identifier 字段）
function _subscriptionObj() {
  var o = _purchaseObj();
  delete o.product_identifier;
  return o;
}

// 收集响应里已出现的 entitlement 名（动态，不靠猜）
function _collectNames(root, out) {
  if (!_isObj(root)) return;
  var e = root.entitlements;
  if (_isObj(e)) for (var k in e) if (e.hasOwnProperty(k)) out[k] = true;

  var m = root.product_entitlement_mapping || root.productEntitlementMapping;
  if (_isObj(m)) {
    var inner = _isObj(m.products) ? m.products : m;
    for (var pid in inner) {
      if (!inner.hasOwnProperty(pid)) continue;
      var node = inner[pid];
      var names = _isObj(node) ? node.entitlements : node;
      if (Array.isArray(names)) for (var i = 0; i < names.length; i++) out[names[i]] = true;
    }
  }

  var lists = [root.subscriptions, root.non_subscriptions];
  for (var li = 0; li < lists.length; li++) {
    var L = lists[li];
    if (!_isObj(L)) continue;
    for (var pk in L) {
      if (!L.hasOwnProperty(pk)) continue;
      var item = L[pk];
      var arr = Array.isArray(item) ? item : [item];
      for (var ai = 0; ai < arr.length; ai++) {
        var it = arr[ai];
        if (!_isObj(it)) continue;
        var ids = it.entitlement_ids || it.entitlementIds;
        if (Array.isArray(ids)) for (var j = 0; j < ids.length; j++) out[ids[j]] = true;
      }
    }
  }
}

// 按 RC Codable schema 注入 subscriber 对象
function _patchSubscriber(sub, extraNames) {
  if (!_isObj(sub)) return;

  var names = {};
  var i;
  for (i = 0; i < ENTITLEMENT_ALIASES.length; i++) names[ENTITLEMENT_ALIASES[i]] = true;
  for (var n in extraNames) if (extraNames.hasOwnProperty(n)) names[n] = true;

  if (!_isObj(sub.entitlements)) sub.entitlements = {};
  for (var name in names) if (names.hasOwnProperty(name)) sub.entitlements[name] = _purchaseObj();

  // activeSubscriptions / allPurchasedProductIdentifiers 的真正来源
  if (!_isObj(sub.subscriptions)) sub.subscriptions = {};
  for (i = 0; i < PRODUCT_IDS.length; i++) sub.subscriptions[PRODUCT_IDS[i]] = _subscriptionObj();

  // non_subscriptions 必须是 dict（是数组就重置，绝不再写数组）
  if (sub.non_subscriptions !== undefined && !_isObj(sub.non_subscriptions)) sub.non_subscriptions = {};
  if (sub.other_purchases !== undefined && !_isObj(sub.other_purchases)) sub.other_purchases = {};

  var all = Array.isArray(sub.all_purchased_product_identifiers)
    ? sub.all_purchased_product_identifiers.slice() : [];
  for (i = 0; i < PRODUCT_IDS.length; i++) if (all.indexOf(PRODUCT_IDS[i]) < 0) all.push(PRODUCT_IDS[i]);
  sub.all_purchased_product_identifiers = all;

  for (i = 0; i < WIRE_NOISE.length; i++) delete sub[WIRE_NOISE[i]];

  if (!sub.first_seen) sub.first_seen = PURCHASE_DATE;
  if (!sub.original_app_user_id) sub.original_app_user_id = "gear-pro";
  if (sub.original_application_version === undefined) sub.original_application_version = "7.5.2";
}

// /v1/product_entitlement_mapping：真实结构 {"product_entitlement_mapping":{pid:{entitlements:[...],product_identifier:pid}}}
function _patchMapping(data, extraNames) {
  var target = _isObj(data.product_entitlement_mapping) ? data.product_entitlement_mapping
    : (_isObj(data.productEntitlementMapping) ? data.productEntitlementMapping : null);
  if (!target) { target = {}; data.product_entitlement_mapping = target; }

  var names = [];
  var i;
  for (i = 0; i < ENTITLEMENT_ALIASES.length; i++) names.push(ENTITLEMENT_ALIASES[i]);
  for (var n in extraNames) if (extraNames.hasOwnProperty(n) && names.indexOf(n) < 0) names.push(n);

  for (i = 0; i < PRODUCT_IDS.length; i++) {
    target[PRODUCT_IDS[i]] = { entitlements: names.slice(), product_identifier: PRODUCT_IDS[i] };
  }
  if (data.productEntitlementMapping) delete data.productEntitlementMapping;
}

function handler() {
  if (typeof $response === "undefined" || !$response || !$response.body) { $done({}); return; }

  var data;
  try { data = JSON.parse($response.body); } catch (e) {
    console.log("gear-crack: body not json, passthrough");
    $done({});
    return;
  }
  if (!_isObj(data)) { $done({}); return; }

  var url = "";
  try { url = ($request && $request.url) ? $request.url : ""; } catch (e) {}

  var extraNames = {};
  _collectNames(data, extraNames);
  if (_isObj(data.subscriber)) _collectNames(data.subscriber, extraNames);

  // 1) product_entitlement_mapping 端点
  if (url.indexOf("product_entitlement_mapping") >= 0) {
    _patchMapping(data, extraNames);
    console.log("gear-crack: mapping patched, names=" + Object.keys(extraNames).join(","));
    $done({ body: JSON.stringify(data), headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    return;
  }

  // 2) offerings / paywall 配置：结构不动（改错会让 RC 解码失败）
  if (url.indexOf("/offerings") >= 0 || url.indexOf("customer/offerings") >= 0) {
    console.log("gear-crack: offerings passthrough");
    $done({ body: JSON.stringify(data) });
    return;
  }

  // 3) subscriber / receipts / identify / customerinfo
  if (_isObj(data.subscriber)) _patchSubscriber(data.subscriber, extraNames);
  if (_isObj(data.last_response) && _isObj(data.last_response.subscriber)) {
    _patchSubscriber(data.last_response.subscriber, extraNames);
  }
  if (_isObj(data.offline_entitlements)) _patchSubscriber(data.offline_entitlements, extraNames);

  // 顶层 verification：只在原值非法时纠正，绝不写小写
  if (data.verification !== undefined && data.verification !== null
      && VERIFICATION_VALUES.indexOf(data.verification) < 0) {
    data.verification = "NOT_REQUESTED";
  }
  delete data.entitlementVerification;

  var entKeys = _isObj(data.subscriber) && _isObj(data.subscriber.entitlements)
    ? Object.keys(data.subscriber.entitlements) : [];

  console.log("gear-crack: patched ok url=" + url.slice(0, 80) +
    " entitlements=" + entKeys.join(",") +
    " subs=" + (_isObj(data.subscriber) && _isObj(data.subscriber.subscriptions)
      ? Object.keys(data.subscriber.subscriptions).join(",") : ""));

  $done({
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

handler();
