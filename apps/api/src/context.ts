import type { Sql } from "@erp/db";
import type { MessagesApi } from "./ai/agent.js";
import type { PacProvider } from "./services/pac.js";

export interface AppContext {
  sql: Sql;
  /** Connection as erp_ai_reader; undefined disables the AI endpoint. */
  readerSql?: Sql;
  /** Claude Messages API; undefined disables the AI endpoint. */
  messages?: MessagesApi;
  aiModel: string;
  pac: PacProvider;
  apiToken?: string;
}
