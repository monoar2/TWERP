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
  /** ERP_SECRET_KEY: encrypts the stored CSD private key and password. */
  secretKey?: Buffer;
  /** IANA time zone of the issuing location, used for the CFDI Fecha. */
  timezone: string;
}
