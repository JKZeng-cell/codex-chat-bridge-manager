export function describeDelivery(entry) {
  if (entry.deliveryStatus === "failed" || entry.deliveryError) return "回复未送达，可在此查看结果。";
  if (entry.deliveryStatus === "pending") return "正在发送到聊天平台…";
  if (entry.deliveryStatus !== "sent" && entry.deliveryWarning) return "部分回复未送达，请以此处结果为准。";
  return "";
}
