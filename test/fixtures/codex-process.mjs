import fs from "node:fs/promises";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const scenario = arg("--fixture-scenario");
const output = arg("--output-last-message");
const answer = "最终答复：中文🙂";
const event = (value) => process.stdout.write(JSON.stringify(value) + "\n");
event({ type: "thread.started", thread_id: "fixture-thread" });
if (scenario === "legacy") {
  await fs.writeFile(output, answer);
} else {
  event({ type: "turn.started" });
  event({ type: "item.completed", item: { type: "reasoning", text: "private reasoning" } });
  const message = { type: "item.completed", item: { type: "agent_message", text: answer } };
  if (scenario === "split-utf8") {
    const data = Buffer.from(JSON.stringify(message) + "\n");
    const split = data.indexOf(Buffer.from("中")) + 1;
    process.stdout.write(data.subarray(0, split));
    await new Promise((resolve) => setTimeout(resolve, 5));
    process.stdout.write(data.subarray(split));
  } else event(message);
  if (scenario === "complete-hang") await fs.writeFile(output, "partial file");
  if (scenario === "normal") await fs.writeFile(output, answer);
  if (scenario !== "no-terminal") event({ type: scenario === "failed" ? "turn.failed" : "turn.completed" });
  if (scenario !== "normal") setInterval(() => {}, 1000);
}
