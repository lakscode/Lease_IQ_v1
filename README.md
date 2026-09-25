# Supabase App

Vite + React + TypeScript app with Supabase email/password auth and a Lease Abstraction module.

- `/` — landing page
- `/login` — log in / sign up
- `/forgot-password` — request a password reset email
- `/reset-password` — set a new password (opened from the reset email link)
- `/dashboard` — active, renewed and expired leases, leases expiring in the next 12 months, and document counts
- `/leases` — Lease Abstraction: upload PDFs and browse the extracted documents
- `/leases/:id` — details of one document (opened with **Details**): property, rent, dates, options, related documents, alerts and clauses
- `/settings` — maintenance actions, such as recreating the `lease_clauses` table

## How Lease Abstraction works

1. **Text extraction (browser).** pdf.js reads each page's text layer. Pages without one
   (scanned images) are rendered and converted to text with tesseract.js OCR.
2. **Storage.** The original PDF goes to the private `lease-files` bucket and the page text
   to `lease_file_pages`.
3. **Analysis (Edge Function `analyze-lease`).** Claude reads the page-numbered text, splits the
   file into documents (main lease, amendment, addendum, extension, assignment, sublease,
   guaranty, other), links each child to its main lease — in the same file, or a main lease
   uploaded earlier — and abstracts key terms. Results are stored in `leases`, with
   `parent_id` pointing at the main lease.
4. **Splitting (browser).** pdf-lib writes one PDF per document into the bucket.

The browser drives steps 1, 2 and 4, so keep the tab open until a file shows **Completed**.
Unfinished or failed files can be resumed with **Retry**.

## Logs

Every step is logged in three places:

- **In the app:** the **Log** button on each uploaded file shows the browser and server steps
  in order (stored in `lease_file_logs`), with a **Copy** button.
- **Browser console:** lines prefixed `[lease <file id>]`.
- **Supabase dashboard:** Edge Functions → analyze-lease → Logs (JSON lines tagged with the
  function version `v` and a request id `req`).

## Setup

1. Create a project at https://supabase.com/dashboard.
2. Copy `.env.example` to `.env` and fill in the URL and anon key from **Project Settings → API**.
3. In **Authentication → URL Configuration**, set the Site URL to `http://localhost:5173`
   and add `http://localhost:5173/**` to **Redirect URLs** (needed for the password reset link).
4. Put the Claude API key in `supabase/functions/analyze-lease/config.ts` (copy
   `config.example.ts` next to it; `config.ts` is gitignored so the key is never pushed):

   ```ts
   export const config = {
     anthropicApiKey: 'sk-ant-...',
     anthropicModel: 'claude-opus-5',
     anthropicBaseUrl: 'https://api.anthropic.com',
   }
   ```

5. Apply the database migration, then deploy the Edge Function:

   ```bash
   npx supabase login
   npx supabase init            # only once; creates supabase/config.toml
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   npm run deploy               # deploys analyze-lease together with config.ts
   ```

   Redeploy after changing `config.ts`. Function secrets named `ANTHROPIC_API_KEY`,
   `ANTHROPIC_MODEL` or `ANTHROPIC_BASE_URL` override the file when set.

   Without the CLI: paste `supabase/migrations/*.sql` into the SQL Editor, create an Edge
   Function named `analyze-lease` from `supabase/functions/analyze-lease/index.ts`, and add
   `ANTHROPIC_API_KEY` under **Edge Functions → Secrets**.

   Never put the Anthropic key in the root `.env` — `VITE_` variables are shipped to the browser.

6. Run:

   ```bash
   npm install
   npm run dev
   ```

By default Supabase requires email confirmation on sign-up. Turn it off under
**Authentication → Providers → Email** if you want instant login during development.

## Limits

- PDFs up to 50 MB.
- Edge Functions have a wall-clock limit (150 s on the free plan, 400 s on paid plans).
  Very long bundles can hit it; split them into smaller PDFs if analysis times out.
- The model defaults to `claude-opus-5`; override with `anthropicModel` in `config.ts`.
