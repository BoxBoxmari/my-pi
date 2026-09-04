import { CoordinationClient } from "../packages/coordination-client/dist/index.js";
import { SqliteCoordinationStore } from "../packages/coordination-store/dist/index.js";

const [databasePath, projectId, workerId, countText] = process.argv.slice(2);
const count = Number(countText);
const store = new SqliteCoordinationStore(databasePath);
try {
  await store.init();
  for (let index = 0; index < count; index++) await store.appendEvent({ projectId, eventType: "AgentHeartbeat", actor: { kind: "system", name: `contention-${workerId}` }, payload: { workerId, index } });
} finally {
  await store.close();
}
