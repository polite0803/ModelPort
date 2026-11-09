import { c as createLucideIcon } from "./index-Dmiad-IP.js";
/**
 * @license lucide-react v0.454.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */
const ListChecks = createLucideIcon("ListChecks", [
  ["path", { d: "m3 17 2 2 4-4", key: "1jhpwq" }],
  ["path", { d: "m3 7 2 2 4-4", key: "1obspn" }],
  ["path", { d: "M13 6h8", key: "15sg57" }],
  ["path", { d: "M13 12h8", key: "h98zly" }],
  ["path", { d: "M13 18h8", key: "oe0vm4" }]
]);
function channelAddFlowOf(kind) {
  return kind === "api-key" ? "credential" : "redirect";
}
function channelModelDisplayName(channelName, channelId, model) {
  const baseName = model.name.trim().length > 0 ? model.name : `${channelId}/${model.id}`;
  return `${channelName} / ${baseName}`;
}
function costBucketOf(weight, free) {
  if (weight === void 0) return free ? "free" : "unknown";
  if (weight <= 0) return "free";
  if (weight < 1) return "below-base";
  if (weight === 1) return "base";
  return "above-base";
}
export {
  ListChecks as L,
  channelModelDisplayName as a,
  costBucketOf as b,
  channelAddFlowOf as c
};
