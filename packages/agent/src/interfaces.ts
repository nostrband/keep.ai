import { ModelMessage } from "ai";

export interface Memory {
  getMessages({}): Promise<ModelMessage[]>;
}
