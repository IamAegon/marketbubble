export interface ChatAccess {
  accessToken: string;
  endpoint: string;
  roomId: string;
  /** the chat channel to subscribe to — distinct from roomId. For guest/read-only
   * access to a video broadcast this comes back empty ("-"), meaning only occupancy
   * is delivered, not messages; an authenticated token returns a real channel. */
  channel: string;
  readOnly: boolean;
}

interface AccessResponse {
  access_token?: string;
  endpoint?: string;
  room_id?: string;
  channel?: string;
  read_only?: boolean;
}

function toAccess(j: AccessResponse, src: string): ChatAccess {
  if (!j.access_token || !j.endpoint) throw new Error(`${src}: missing endpoint/token`);
  return {
    accessToken: j.access_token,
    endpoint: j.endpoint,
    roomId: j.room_id ?? "",
    channel: j.channel && j.channel !== "-" ? j.channel : "",
    readOnly: Boolean(j.read_only),
  };
}

/** Anonymous: exchange a chatToken for the chat WebSocket endpoint + access token.
 * For video broadcasts this is read-only and delivers occupancy only (no messages). */
export async function accessChatPublic(chatToken: string, userAgent: string): Promise<ChatAccess> {
  const r = await fetch(
    `https://proxsee.pscp.tv/api/v2/accessChatPublic?chat_token=${encodeURIComponent(chatToken)}`,
    { headers: { "User-Agent": userAgent } },
  );
  if (!r.ok) throw new Error(`accessChatPublic ${r.status}`);
  return toAccess((await r.json()) as AccessResponse, "accessChatPublic");
}

/** Authenticated: exchange a chatToken using a logged-in X session (the `auth_token`
 * cookie from x.com) for a token that actually delivers chat messages — this is how
 * x.com itself reads live-broadcast chat. A burner account is recommended. */
export async function accessChat(chatToken: string, userAgent: string, authToken: string): Promise<ChatAccess> {
  const r = await fetch("https://proxsee.pscp.tv/api/v2/accessChat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent,
      Cookie: `auth_token=${authToken}`,
    },
    body: JSON.stringify({ chat_token: chatToken }),
  });
  if (!r.ok) throw new Error(`accessChat ${r.status}`);
  return toAccess((await r.json()) as AccessResponse, "accessChat");
}
