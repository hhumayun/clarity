import { Kysely, CamelCasePlugin } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import { DB, kyselyIdentifierOverrides } from './schema'
import postgres from 'postgres'

// kysely's CamelCasePlugin can't recover a snake_case name that has an
// underscore directly before a digit (reminder_48h_sent -> reminder48hSent ->
// reminder48h_sent). The generated schema exports the exact spelling for such
// identifiers; everything else falls through to the default mapping.
class FlootCamelCasePlugin extends CamelCasePlugin {
  protected override snakeCase(str: string): string {
    return kyselyIdentifierOverrides[str] ?? super.snakeCase(str)
  }
}

const connectionString =
  process.env.DATABASE_URL ?? process.env.FLOOT_DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and add your Neon connection string.',
  )
}

export const db = new Kysely<DB>({
  plugins: [new FlootCamelCasePlugin()],
  dialect: new PostgresJSDialect({
    postgres: postgres(connectionString, {
      // Neon works best without prepared statements when using the pooled
      // (pgbouncer) connection string.
      prepare: false,
      idle_timeout: 10,
      max: 3,
      ssl: connectionString.includes('localhost') ? false : 'require',
    }),
  }),
})
