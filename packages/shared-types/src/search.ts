import type { ChatMessage, Platform } from "./chat-message";

export interface SearchRequest {
  q: string;
  platforms?: Platform[];
  channels?: string[];
  before?: number;
  after?: number;
  limit?: number;
  cursor?: string;
}

export interface SearchResponse {
  results: ChatMessage[];
  nextCursor?: string;
  total?: number;
}
