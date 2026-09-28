// Copy to config.ts (gitignored) and fill in. `supabase functions deploy`
// bundles config.ts with the function, so no secrets need to be set.
// Function secrets with the same names (ANTHROPIC_API_KEY, ...) take precedence.
export const config = {
  anthropicApiKey: 'sk-ant-...',
  anthropicModel: 'claude-opus-5',
  // Without the /v1 suffix; the SDK adds it.
  anthropicBaseUrl: 'https://api.anthropic.com',
  // Optional semantic search for the Lease Assistant (index-lease and lease-chat).
  // Leave the placeholders to use keyword search only.
  voyageApiKey: 'pa-...',
  voyageModel: 'voyage-law-2',
  mongodbUri: 'mongodb+srv://...',
  mongodbDb: 'leaseiq',
}
