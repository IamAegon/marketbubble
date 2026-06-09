import { z } from "zod";

/**
 * Watchlist config (channels.yaml). Validated at startup.
 */
export const XSourceSchema = z.union([
  z.string().describe("a broadcast URL or id, e.g. https://x.com/i/broadcasts/<id> or <id>"),
  z.object({
    broadcast: z.string().optional().describe("broadcast URL or id (direct mode)"),
    handle: z.string().optional().describe("@handle to auto-discover the active broadcast"),
    label: z.string().optional(),
  }),
]);

export const ChannelsConfigSchema = z.object({
  twitch: z.array(z.string()).default([]),
  kick: z
    .array(
      z.union([
        z.string(),
        z.object({ slug: z.string(), chatroomId: z.number().optional() }),
      ]),
    )
    .default([]),
  x: z
    .object({
      broadcasts: z
        .array(
          z.union([
            z.string(),
            z.object({ broadcast: z.string(), label: z.string().optional() }),
          ]),
        )
        .default([]),
      handles: z.array(z.string()).default([]),
    })
    .default({ broadcasts: [], handles: [] }),
});

export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;
