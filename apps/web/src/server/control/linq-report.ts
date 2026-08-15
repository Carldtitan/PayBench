import "../integrations/server-only";

import Linq from "@linqapp/sdk";

export type LinqReportDeliveryResult =
  | { status: "sent"; provider_message_id: string }
  | { status: "blocked"; reason: string };

interface LinqReportClient {
  chats: {
    retrieve(chatId: string): Promise<{
      health_status: { status: "HEALTHY" | "AT_RISK" | "CRITICAL" | "OPTED_OUT" };
      handles: Array<{ handle: string; is_me?: boolean | null }>;
    }>;
    messages: {
      send(chatId: string, body: { message: { parts: Array<{ type: "text"; value: string }> } }): Promise<{
        message: { id: string };
      }>;
    };
  };
  phoneNumbers: {
    list(): Promise<{
      phone_numbers: Array<{ phone_number: string; reputation: { status: "HEALTHY" | "AT_RISK" | "CRITICAL" } }>;
    }>;
  };
}

export async function deliverReportToHealthyLinqChat(
  chatId: string,
  reportUrl: string,
  client?: LinqReportClient,
): Promise<LinqReportDeliveryResult> {
  const apiKey = process.env.LINQ_API_V3_API_KEY ?? process.env.LINQ_API_KEY;
  if (!client && !apiKey) return { status: "blocked", reason: "LINQ_API_KEY_NOT_CONFIGURED" };
  const runtimeClient = client ?? (new Linq({ apiKey }) as unknown as LinqReportClient);
  const chat = await runtimeClient.chats.retrieve(chatId);
  if (chat.health_status.status !== "HEALTHY") {
    return { status: "blocked", reason: `CHAT_${chat.health_status.status}` };
  }
  const sendingHandle = chat.handles.find((handle) => handle.is_me)?.handle;
  if (!sendingHandle) return { status: "blocked", reason: "LINQ_SENDING_LINE_UNKNOWN" };
  const lines = await runtimeClient.phoneNumbers.list();
  const line = lines.phone_numbers.find((candidate) => candidate.phone_number === sendingHandle);
  if (!line || line.reputation.status !== "HEALTHY") {
    return { status: "blocked", reason: `LINE_${line?.reputation.status ?? "UNKNOWN"}` };
  }
  const response = await runtimeClient.chats.messages.send(chatId, {
    message: {
      parts: [{ type: "text", value: `Your PayBench report is ready: ${reportUrl}` }],
    },
  });
  return { status: "sent", provider_message_id: response.message.id };
}
