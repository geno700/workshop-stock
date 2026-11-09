# Workshop Stock

A web app to stock and track workshop material (raw stock, components, consumables, tools) and share it with a team.

- Plain HTML and JavaScript. No build step and nothing to install.
- Hosted free on GitHub Pages. Data and logins live in Supabase (free tier).
- Until Supabase is connected the app runs in **demo mode**: sample data, saved only in your browser.

## What works now (phase 1)

- Items with type, category, unit, location, minimum level, cost and type-specific fields
- Search and filters, including "low stock only"
- Take stock, add stock and recount, each recorded with who, when and why
- Dashboard: low-stock list, stock value, recent activity
- Full movement history
- Logins with roles: admin, member, viewer. New sign-ups wait for an admin to approve them.
- Tools: borrow and return, with a list of who has what
- Locations page: see what is stored where, rename or delete locations
- QR labels for items and locations. Print them, stick them on, and scan with a phone camera to open that item.

- Projects: pick a project when taking stock, then see the material and cost per project
- Suppliers: contact details, linked to items
- CSV: export items and history, import items from a spreadsheet (a template is on the Import page)

Add `?demo` to the app's address to try it with sample data without touching the real stock.

## Try it on this PC

Double-clicking `index.html` will not work (browsers block it). Start a small local server instead:

```bash
python -m http.server 5173
```

Then open http://localhost:5173

## Go live

### 1. Create the database (Supabase)

1. Create a free account and a new project at https://supabase.com
2. Open **SQL Editor > New query**, paste the whole of `supabase/schema.sql`, and press **Run**.
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.
4. Paste both into `config.js`:

   ```js
   supabaseUrl: 'https://xxxxxxxx.supabase.co',
   supabaseAnonKey: 'eyJ...',
   ```

   The anon key is designed to be public. The access rules in `schema.sql` are what protect your data.
   Never put the **service_role** key in this project.

### 2. Publish the app (GitHub Pages)

1. Create a free account at https://github.com and a new **public** repository.
2. On the repository page choose **Add file > Upload files**, drag in everything from this folder
   (`index.html`, `config.js`, `.nojekyll`, and the `css`, `js` and `supabase` folders), and commit.
3. Open **Settings > Pages**, set **Source** to "Deploy from a branch", choose branch `main` and folder `/ (root)`, and save.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

### 3. Connect the two

In Supabase open **Authentication > URL Configuration** and set **Site URL** to your GitHub Pages address.
This makes the email confirmation link bring people back to the app.

### 4. Create your account

Open the app and create an account. **The first account becomes the admin.**
Everyone who signs up after that appears on the **Team** page as waiting, and you choose their role:

| Role | Can do |
|---|---|
| Viewer | See stock and history |
| Member | Also add and edit items, take and add stock |
| Admin | Also remove items and manage the team |

## Notes

- Supabase's free tier pauses a project after about a week with no activity. Resume it from the Supabase dashboard.
- Set `workshopName` and `currency` in `config.js` to change the title and how money is shown.
- To update the live app, upload the changed files to the GitHub repository again.
