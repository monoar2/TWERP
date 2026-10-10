import postgres from "postgres";

export type Sql = postgres.Sql;
export type TxSql = postgres.TransactionSql;
/** Either the root client or a transaction; services accept both. */
export type Db = Sql | TxSql;

export function createDb(url = process.env.DATABASE_URL, options: postgres.Options<{}> = {}): Sql {
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    max: 10,
    onnotice: () => {},
    // numeric already comes back as a string (no float rounding). Keep date and
    // timestamp-without-time-zone as strings too: they are civil dates/times in
    // Mexico (CFDI Fecha, póliza dates) and must not shift through UTC.
    types: {
      civilDate: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      civilTimestamp: { to: 1114, from: [1114], serialize: (x: string) => x, parse: (x: string) => x },
    },
    ...options,
  });
}
