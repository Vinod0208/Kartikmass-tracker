# ISKCON Dehradun — Kartik Maas Sankalp Tracker

Fresh-start React + TypeScript + Vite + Supabase app for Kartik Maas vow selection and daily progress tracking.

## Features

- Email/password signup and login using Supabase Auth.
- Profile created automatically on signup; public signup always creates the `user` role.
- Shared Kartik vow library: any signed-in user can add a vow; it becomes immediately available to other signed-in users.
- Users select multiple vows. On later visits, the dashboard shows only their selected vows.
- Daily log per selected vow: quantity, optional unit, progress percentage, done checkbox, reason if not completed, and notes.
- Personal daily history and dashboard metrics.
- Admin dashboard for registered profiles, selections, daily logs and CSV export.
- Supabase Row Level Security separates private selections and logs from ordinary users.
- Responsive desktop/mobile layout.

## 1. Create a new Supabase project

Use a new/empty Supabase project (or confirm the current project's public schema has no tables/data you need). This is a **fresh schema**, not a migration.

1. Open the Supabase Dashboard and select the intended project.
2. Open **SQL Editor → New query**.
3. Paste and run the complete `supabase/schema.sql` file.
4. Go to **Project Settings → API** (or API Keys / Data API depending on dashboard version).
5. Copy the Project URL and the publishable key (`sb_publishable_...`) or legacy `anon` key.

Do not use the `service_role` or secret key in the frontend.

## 2. Configure locally

1. Install Node.js 20 LTS or newer.
2. Copy `.env.example` to `.env.local`.
3. Set:
   - `VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY`
4. In a terminal inside this project folder:
   ```bash
   npm install
   npm run dev
   ```
5. Open the local URL Vite prints.

## 3. Create the admin

1. Open Supabase → Authentication → Users → Add user / Create new user.
2. Create the temple admin account and confirm it if your project requires confirmation.
3. Copy the Auth user's UUID.
4. In SQL Editor run (replace the UUID):
   ```sql
   update public.profiles
   set role = 'admin'
   where id = 'PASTE-AUTH-USER-UUID';
   ```
5. Sign in through the app with that admin email/password.

Do not set the role from a public signup form. The trigger assigns `user` to all self-signups.

## 4. Deploy to Vercel

1. Create a private GitHub repository.
2. Upload the extracted project files. Do **not** upload `.env.local`.
3. In Vercel, import the repository.
4. Framework preset: Vite; build command `npm run build`; output directory `dist`.
5. Add environment variables for Production (and Preview if desired):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Deploy. Each push to the connected branch triggers a redeployment.

## 5. Supabase Auth URL configuration

After deployment, go to Authentication → URL Configuration:
- Site URL: your deployed Vercel URL.
- Redirect URLs: include the Vercel URL and `http://localhost:5173` for local development if needed.

## Security notes

- Public users can read and add to the shared vow library, but cannot read another user's selected vows or daily logs.
- Admin role is granted only by a project owner via Supabase dashboard/SQL Editor.
- Admin reporting relies on `profiles.role = 'admin'` and RLS policies.
- The client uses only the publishable/anon key. Never expose a service-role/secret key.
- Use temple-approved guidance for religious practice; starter vow options are examples and can be edited by the temple.

## Known limitations to review before launch

- This starter is for one Kartik program (`program_key = 'kartik'`); it does not manage multiple program date ranges.
- Daily percentage is manually entered by the devotee; completed checkbox forces 100%.
- No password reset UI, account deletion UI, email/WhatsApp notifications, or audit log yet.
- Admin CSV currently exports the recent daily logs loaded by the app (up to 1,500).
- Admin's latest-entry date is based on loaded logs; it is a simple first version.
- The source is supplied for deployment and should be tested with a real Supabase project before inviting devotees.


## Admin: deleting a devotee account

The admin dashboard includes a **Delete user** action for ordinary devotee accounts. It requires the `admin-delete-user` Supabase Edge Function; the browser never receives the service-role key.

### Deploy the Edge Function from the Supabase browser dashboard

1. Open your Supabase project and go to **Edge Functions**.
2. Create a function named exactly `admin-delete-user`.
3. Replace the function editor contents with `supabase/functions/admin-delete-user/index.ts` from this project and deploy it.
4. In the function's settings/secrets, verify these environment variables are available:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   Supabase commonly provides these project variables to Edge Functions automatically. If the dashboard asks you to configure them, use the values from **Project Settings → API**. Keep the service-role key only in server-side function secrets; never put it in `.env.local`, Vercel frontend variables, or source code.
5. Redeploy the Vercel frontend after uploading the updated source.

### Behavior and safeguards

- Only a caller whose database profile has `role = 'admin'` can delete a user.
- The function rejects self-deletion and refuses to delete another admin account.
- The UI asks for confirmation before sending the request.
- The schema's foreign keys cascade Auth-user deletion to `profiles`, `user_vows`, and `daily_logs`. Shared vows created by the user are retained; their `created_by` value becomes null.
- Account deletion and progress-history deletion are permanent. Test with a disposable user account first.

If the Edge Function is not deployed, the Delete user button will report a deployment/configuration error and no account will be deleted.

## Password recovery setup

The login screen includes **Forgot password?**. In Supabase, open **Authentication → URL Configuration** and set the Site URL to your deployed Vercel URL. Add that URL (and the exact reset redirect URL if different) to the Redirect URLs allowlist. Configure SMTP/email delivery if you want reliable production password-reset emails. The reset email redirects to the app root; the app handles the Supabase `PASSWORD_RECOVERY` event and displays the new-password form.

## Sankalp and daily-date behavior

After a devotee saves their initial sankalp selection, the selection screen is no longer available to that account, and only their saved vows appear on the dashboard. Daily progress is restricted to the current local day: the date picker is removed and the save flow writes today's date only. Previous daily entries remain available as read-only history. Save/submit actions show a spinner while requests are in progress.

These changes are frontend behavior; keep the existing Supabase tables and data. Do not rerun the fresh-install schema on an existing database.

## Existing database hardening (important)

For an already deployed app/database, run `supabase/hardening-migration.sql` in the Supabase SQL Editor as the project owner. This is an additive migration: it preserves existing rows and does not drop tables. **Do not rerun `supabase/schema.sql`** on your existing database; that file is for a fresh install only.

The hardening migration:
- makes the first Kartik sankalp save atomic and permanently blocks subsequent client-side selection changes;
- removes direct client insert/delete policies on `user_vows` so selection changes must go through the guarded RPC;
- enforces that daily-log inserts/updates use today's date in `Asia/Kolkata`, including at the database policy/trigger layer;
- leaves historical logs readable and unchanged.

Deploy the updated frontend after running the migration. Existing selections are treated as already locked. Test on a non-admin test account before broad release. Password recovery also requires the deployed URL to be allowlisted under Supabase Authentication → URL Configuration and email delivery to be configured.
