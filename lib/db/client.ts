import postgres from "postgres";

let client: postgres.Sql | null = null;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set.");
  }

  if (!client) {
    client = postgres(process.env.DATABASE_URL, {
      max: 5,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 15,
      onnotice: () => {},
    });
  }

  return client;
}
