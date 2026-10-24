import { api } from "@/lib/api";
import { listEligibleTasks } from "@/lib/workflow";

export const GET = api(async (_req, actor) =>
  (await listEligibleTasks(actor)).map(({ task, contract, request, onBehalfOfUserId }) => ({
    id: task.id, name: task.name, kind: task.kind, stage: task.stage, dueAt: task.dueAt, onBehalfOfUserId,
    contract: { id: contract.id, number: contract.number, title: contract.title, totalValue: contract.totalValue },
    request: { id: request.id, number: request.number },
  })),
);
