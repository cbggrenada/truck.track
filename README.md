# CBG Truck Tracker

Counts truck trips from the main Carib Brewery Plant to the Warehouse in Frequente. Operators log trips on any phone, tablet or PC, and everyone's trips go into one shared dashboard.

- **Log a trip** (`#log`): date, time leaving plant, truck (SL107 or SL17), operator name, and an optional time back at plant. Anyone with the link can log a trip.
- **Trucks still out**: trips with no return time are listed on the form page. When the truck gets back, anyone can tap **Save return** to add the time. Once a return time is saved, only the admin code can change it.
- **Delays**: if a round trip is over 2 hours, the clerk must give a reason (Traffic delay, Waiting to offload, Breakdown, Refuelling, Clerk logged late, or their own words) before it saves. If a time looks odd (e.g. back 5 minutes after leaving), they're asked to check it and can still save it. Reasons show on All trips and in the Excel file. Change the 2-hour limit with `longTripMinutes` in `config.js`.
- **Time slots**: each trip goes into 8am to 9am, 9am to 5pm or 5pm to 11pm from its time leaving plant. Anything else shows as "Outside time slots".
- **Dashboard** (`#dashboard`): total trips, average per day, busiest time slot, average round trip (leaving plant to back at plant), trips per slot, trips per day by slot, trips by hour, and tables by operator and by truck with average round trip. Filter by period, time slot, truck and operator. Refreshes every minute.
- **All trips**, **Settings** and **Generate Excel**: locked behind the admin code. Only someone with the code can view the full trip list, edit or delete a trip, or download the Excel file.
- **Generate Excel**: downloads every trip as `CBG_Truck_Trips_<date>.xlsx`, with a daily summary by time slot.

The badge at the top right shows the connection: **Live** (all trips are shared), **waiting to send** (no signal; trips are kept on the device and sent when it's back), or **Can't reach the trip sheet** (showing the last copy).

## How it fits together

```
Any device → form on GitHub Pages → Google Sheet (shared store) → dashboard on GitHub Pages
```

GitHub Pages can only host pages; it can't store what people type. A free Google Sheet holds the trips so every device sees the same data.

## How the admin code protects the data

- The code is kept in the Google Sheet's script, **not** in the website files (those are public on GitHub, so anything in them can be read).
- The sheet itself refuses any edit or delete that doesn't come with the right code, so the lock can't be bypassed from the page.
- After 10 wrong codes, code checks pause for 10 minutes.
- Unlocking lasts until that browser tab is closed. Use the **Lock** button to lock it straight away on a shared device.
- Anyone with editor access to the Google Sheet itself can still change it. Keep the sheet shared only with the people who should manage it.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The page (form, dashboard, trip list) |
| `logo.webp` | The Carib Brewery logo (header and browser tab icon) |
| `config.js` | **The file you edit**: the Google Sheet link, trucks, time slots, operator names |
| `google-apps-script/Code.gs` | The script that goes in the Google Sheet (not used by GitHub) |

## Step 1. Make the shared Google Sheet (about 10 minutes)

1. Go to `https://sheets.google.com` with the Google account that should own the data, and create a blank sheet. Name it **CBG Truck Trips**.
2. Click **Extensions → Apps Script**. Delete what's in the editor, paste in everything from `google-apps-script/Code.gs`, and click the **Save** icon.
3. **Set the admin code.** In Apps Script, click the **gear icon (Project Settings)** on the left → scroll to **Script properties** → **Add script property**. Property: `ADMIN_CODE`. Value: your code, at least 6 characters (letters and numbers; it's case-sensitive). Click **Save script properties**.
4. Click **Deploy → New deployment**. Click the gear next to *Select type* and choose **Web app**.
   - Description: `Truck tracker`
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, then **Authorize access**, pick your account, and allow it. (If Google shows "Google hasn't verified this app", click **Advanced → Go to … (unsafe)**. It's your own script.)
6. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`.
7. Optional check: paste that URL into a browser. You should see `{"ok":true,"trips":[],...}`.

To change the admin code later, edit the `ADMIN_CODE` script property. It takes effect immediately; no redeploy needed. If you change the script code itself, use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy** so the URL stays the same.

## Step 2. Put the site on GitHub Pages

1. Open `config.js` and paste the Web app URL between the quotes on the `sheetUrl:` line. The trucks are already set to SL107 and SL17.
2. Sign in to GitHub as the account that owns `cbggrenada.github.io` (the same one as `opsdashboard`).
3. Click **New repository**, name it `trucktracker`, leave it Public, and click **Create repository**.
4. Click **uploading an existing file**, drag in `index.html`, `styles.css`, `app.js`, `config.js`, `logo.webp` and `README.md`, and click **Commit changes**. (`Code.gs` can go in too; it does nothing on GitHub and holds no code or password.)
5. Go to **Settings → Pages**. Set Source to **Deploy from a branch**, Branch **main**, folder **/ (root)**, and click **Save**.
6. After a minute or two the site is live:
   - Form for operators: `https://cbggrenada.github.io/trucktracker/#log`
   - Dashboard: `https://cbggrenada.github.io/trucktracker/#dashboard`
7. On the operators' phones, open the form link and choose **Add to Home Screen** so it opens like an app.

To change trucks, time slots or operator names later: open `config.js` in the repository, click the pencil icon, edit, and **Commit changes**.

## Testing before go-live

Log one or two test trips from a phone, check they appear on the dashboard on another device, then unlock **All trips** with the admin code and delete them. The Google Sheet starts empty and only ever holds trips people log.

## Good to know

- **The data lives in the Google Sheet.** You can open it any time, filter it, or connect Power BI to it. Don't rename the Trips tab or its headers.
- **Anyone with the page link can add a trip**, because that's what the form is for. They can't change or delete trips without the code.
- **The dashboard is open to anyone with the link**, so the trip counts it shows aren't secret. The Excel download and the full trip list are locked, but someone determined could still read the raw trip data the dashboard loads. If the data itself must be private, keep the page link within the team.
- If the Google account belongs to a company Google Workspace that blocks "Anyone" access on web apps, use a separate Gmail account for the sheet.
