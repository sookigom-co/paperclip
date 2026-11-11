import type { Db } from "@paperclipai/db";

import { conflict, notFound } from "../../../errors.js";
import { logActivity } from "../../activity-log.js";
import type { chatCredentialMutationLease } from "../../chat-credential-mutation-lease.js";
import type { ConnectionManagementContext } from "../../connection-management.js";
import type { createChatResourceReconciliation } from "../resource-reconciliation.js";
import type { EndpointRecord, EndpointRow, PreparedProviderInventory } from "../runtime-types.js";

type DiscordChannelRefreshOptions = {
  endpointRecord: (endpointId: string) => Promise<EndpointRecord | null>;
  withCredentialMutationLease: ReturnType<typeof chatCredentialMutationLease>;
  resolveCredentials: (endpoint: EndpointRow) => Promise<Record<string, string>>;
  prepareProviderInventory: (endpoint: EndpointRow, credentials: Record<string, string>) => Promise<PreparedProviderInventory>;
  reconcileProviderResourceRows: ReturnType<typeof createChatResourceReconciliation>["reconcileProviderResourceRows"];
  listResources: ReturnType<typeof createChatResourceReconciliation>["listResources"];
};

export function createDiscordChannelRefresh(db: Db, options: DiscordChannelRefreshOptions) {
  const { endpointRecord, withCredentialMutationLease, resolveCredentials, prepareProviderInventory, reconcileProviderResourceRows, listResources } = options;

  // Re-reads the Bot REST channel inventory that connect, resume and reconnect use.
  async function refreshDiscordChannels(endpointId: string, actorUserId?: string | null, managementContext?: ConnectionManagementContext) {
    await managementContext?.reauthorize();
    const initial = await endpointRecord(endpointId);
    if (!initial || initial.endpoint.provider !== "discord") throw notFound("Discord bot not found");
    let discovered = 0;
    await withCredentialMutationLease(initial.endpoint, async lease => {
      const record = await endpointRecord(endpointId);
      if (!record) throw notFound("Discord bot not found");
      if (!["active", "verifying"].includes(record.endpoint.status)) throw conflict("Resume or reconnect this Discord bot before refreshing its channels");
      const credentials = await resolveCredentials(record.endpoint);
      const prepared = await prepareProviderInventory(record.endpoint, credentials);
      await managementContext?.reauthorize();
      if (prepared.inventory) {
        await reconcileProviderResourceRows(record.endpoint, prepared.inventory, lease);
        discovered = prepared.inventory.resources.length;
      }
      await lease.assertOwned();
    });
    await logActivity(db, {
      companyId: initial.endpoint.companyId,
      ...(managementContext?.audit ?? { actorType: "user" as const, actorId: actorUserId ?? "board" }),
      action: "chat_endpoint.discord_channels_refreshed",
      entityType: "tool_connection",
      entityId: initial.endpoint.connectionId,
      details: { endpointId, discovered },
    });
    return listResources(endpointId);
  }

  return { refreshDiscordChannels };
}
