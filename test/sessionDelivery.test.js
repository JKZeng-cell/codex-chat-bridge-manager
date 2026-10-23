import test from "node:test";
import assert from "node:assert/strict";
import { describeDelivery } from "../src/public/sessionDelivery.js";

test("delivery notices distinguish generated answers from successful platform delivery", () => {
  assert.match(describeDelivery({ status: "completed", deliveryStatus: "pending" }), /正在发送/);
  assert.match(describeDelivery({ status: "completed", deliveryStatus: "failed" }), /未送达/);
  assert.match(describeDelivery({ status: "completed", deliveryError: "private transport details" }), /未送达/);
  assert.equal(describeDelivery({ deliveryStatus: "sent", deliveryWarning: "receipt failed" }), "");
  assert.equal(describeDelivery({ status: "completed" }), "");
  assert.equal(describeDelivery({ deliveryWarning: "private details" }).includes("private"), false);
});
