# Stockroom: multi-branch inventory

Zero-dependency Node.js app: web frontend, API backend and SQLite database in one folder. No `npm install` and no build step. Requires Node 22.13 or newer.

## Run it
    npm start          # http://localhost:3000
    npm test           # 14 automated end-to-end checks

The database file `data.db` is created on first start with 3 branches (Downtown, Riverside, Airport), 12 items and opening stock.
Demo logins: `admin / admin123`, `manager1 / manager123`, `staff1 / staff123` (also manager2, 3 and staff2, 3).
Change these passwords before using it for real.

## Deploy (Render)
1. Push this folder to GitHub.
2. On render.com create a **Web Service** from the repo. Runtime: Node 22. Build command: empty. Start command: `npm start`.
3. Add a **persistent disk** mounted at `/data` and set the environment variable `DB=/data/stockroom.db`. Without a disk, data resets on every deploy.
4. Open the Render URL on any phone, tablet or laptop.

## Database
Tables: `branches`, `users` (role: admin, manager, staff), `items`, `stock` (quantity per branch and item), `movements` (append-only ledger: who, what, when, why), `sessions`. Roles are enforced on the server, not just hidden in the screens.

## User guide
**Staff:** sign in, then open *Stock* to see what your branch has. *Record* is where you log a delivery, usage, waste or spoilage: pick the type, the item, the quantity, and a reason for waste or spoilage. If your connection drops, the entry is saved on the device and syncs when you are back online.
**Branch manager:** everything staff can do, plus *Dashboard* (stock value, low-stock items, recent activity for your branch) and *History* (every change with who recorded it, plus a CSV download).
**Owner/admin:** everything above for all branches. Use the branch picker at the top to switch. The dashboard compares branches. *Items* adds new items to the master list.

## Not built yet
Inter-branch transfers, stock counts, expiry dates, suppliers and purchase orders, POS, PDF/Excel export and user management screens. The ledger design means each of these is an addition, not a rewrite.
