import { Service } from "../src/main/service";
import { Storage } from "../src/main/storage";
import { startServer } from "../src/main/server";
const service = new Service(new Storage(process.env.CHARME_PREVIEW_DATA ?? "/private/tmp/charme-preview-data"));
await service.initialize();
const dashboard = await startServer(
  service,
  new URL("../dist", import.meta.url).pathname,
);
console.log(dashboard.launchUrl());
setInterval(() => void service.tick(), 250);
process.on("SIGINT", () => void service.close().then(() => process.exit()));

process.stdin.on("data", () => console.log(dashboard.launchUrl()));
