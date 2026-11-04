import { Prisma } from "@prisma/client";
import { prisma } from "./index";

const TENANTED_MODELS = new Set<string>([
  "Workspace",
  "WorkspaceMember",
  "Invitation",
  "Instance",
  "InstanceGroup",
  "AuditLog",
  "Conversation",
  "Message",
  "Assignment",
  "InternalNote",
  "QuickReply",
  "Caption",
  "Contact",
  "Label",
  "ContactList",
  "MessageTemplate",
  "Broadcast",
  "BroadcastTarget",
  "Chatbot",
  "BotPendingState",
  "DripCampaign",
  "DripEnrolment",
  "WarmerProfile",
  "WarmerTemplate",
  "WarmerRun",
  "WarmerEvent",
  "WorkspacePlan",
  "ApiKey",
  "WebhookSubscription",
  "WorkspaceAiKey",
  "WorkspaceIntegration",
  "Autoresponder",
  "MediaAsset",
  "MediaFolder",
  "ChatTopic",
  "AiActionConfig",
  "BotUserLog",
  "InboundIntegration",
  "InboundIntegrationLog",
  "InstanceHealthPolicy",
  "InstanceHealthSnapshot",
  "HealthAlert",
  "DeliverabilityProbe",
  "KnowledgeSnippet",
  "WebhookDeliveryLog",
]);

export function tenantClient(workspaceId: string) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANTED_MODELS.has(model)) return query(args);

          const tenantedWrite = ["create", "createMany", "upsert"];
          const tenantedRead = ["findFirst", "findMany", "findUnique", "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany"];

          if (tenantedWrite.includes(operation)) {
            if (model === "Workspace") return query(args);
            const a = args as any;
            if (operation === "createMany" && Array.isArray(a.data)) {
              a.data = a.data.map((row: any) => ({ ...row, workspaceId }));
            } else if (operation === "upsert") {
              if (a.create) a.create = { ...a.create, workspaceId };
              if (a.update) a.update = { ...a.update, workspaceId };
              if (a.where) a.where = { ...a.where, workspaceId };
            } else if (a.data) {
              a.data = { ...a.data, workspaceId };
            }
            return query(a);
          }

          if (tenantedRead.includes(operation)) {
            const a = args as any;
            if (model === "Workspace") {
              a.where = { ...(a.where ?? {}), id: workspaceId };
            } else {
              a.where = { ...(a.where ?? {}), workspaceId };
            }
            return query(a);
          }

          return query(args);
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof tenantClient>;
