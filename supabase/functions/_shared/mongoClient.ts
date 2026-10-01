// One MongoDB connection per worker, shared by the semantic search index
// (vectors.ts) and the MongoDB database backend (db/mongo.ts).
// Set MONGODB_URI / MONGODB_DB as function secrets or in analyze-lease/config.ts.

import { MongoClient, type Db } from 'npm:mongodb@6'
import { config } from '../analyze-lease/config.ts'

const settings = config as Record<string, string | undefined>
const MONGODB_URI = Deno.env.get('MONGODB_URI') || settings.mongodbUri || ''
const MONGODB_DB = Deno.env.get('MONGODB_DB') || settings.mongodbDb || 'leaseiq'

export const mongoConfigured = () => !!MONGODB_URI && MONGODB_URI !== 'mongodb+srv://...'

let client: MongoClient | null = null

export async function mongoDatabase(): Promise<Db> {
  if (!mongoConfigured()) throw new Error('MongoDB is not configured. Set MONGODB_URI for the Edge Functions and redeploy.')
  client ??= new MongoClient(MONGODB_URI, { appName: 'leaseiq-edge' })
  await client.connect()
  return client.db(MONGODB_DB)
}
