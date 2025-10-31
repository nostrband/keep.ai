import { z } from 'zod';
import { UIMessage } from "ai";

const metadataSchema = z.object({
  createdAt: z.string().datetime(),
  threadId: z.string().optional(),
});
export type MessageMetadata = z.infer<typeof metadataSchema>;

export type AssistantUIMessage = UIMessage<MessageMetadata>;
