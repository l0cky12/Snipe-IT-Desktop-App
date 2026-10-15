# Snipe-IT Desktop

A desktop console for IT staff to look up and hand out/take back physical hardware tracked in the school's Snipe-IT instance.

## Language

**Asset**:
A single physical piece of hardware tracked in Snipe-IT (a Chromebook, a projector).
_Avoid_: device, item, hardware (as a noun for one thing)

**Asset Tag**:
The unique, human-facing identifier printed on an Asset's barcode label.
_Avoid_: ID, barcode (the barcode *encodes* the Asset Tag)

**Serial**:
The manufacturer's serial number of an Asset. Not guaranteed unique across manufacturers.

**Checkout**:
Assigning an Asset to an Assignee, or handing a quantity of an Accessory or Consumable, or seats of a License, to a User, recorded in Snipe-IT.

**Checkin**:
Returning a checked-out Asset to inventory, clearing its Assignee; or taking back units of an Accessory, or seats of a License, from the User who has them. A Consumable is never checked in.

**Assignee**:
Whoever an Asset is currently checked out to: a **User** or a **Location**.

**User**:
A person in Snipe-IT (staff or student) who can be an Assignee.

**Location**:
A physical place in Snipe-IT (e.g. "Room 204") that can be an Assignee.

**Expected Checkin**:
The optional date, set at Checkout (or changed later by editing the Asset), by which the Asset should come back. On Snipe-IT v8.7+ it can also hold a time of day; a Temp checkout always sets one.

**Overdue**:
A checked-out Asset whose Expected Checkin has passed: at its time of day if it has one (as a Temp checkout does), otherwise at the end of its date. Means late *return* only.
_Avoid_: using "overdue" for audits

**Audit**:
Confirming in person that an Asset is where Snipe-IT says it is. Each Asset has a last audited date and a next audit date. The app records one with Audit… in the Asset panel or as a Bulk Action. It sets the last audited date to now and the next audit date to the date given, or Snipe-IT's audit interval, with an `[Audit]` note. It can't be undone; History keeps it.
_Avoid_: inventory check, stocktake

**Audit due**:
An Asset whose next audit date falls between today and the end of Snipe-IT's Audit warning setting (set to 30 days in Snipe-IT). Snipe-IT decides which Assets are Audit due. The app keeps no window of its own and can't read the setting, so it never states the number of days. Archived Assets are never Audit due.
_Avoid_: upcoming audit

**Audit late**:
An Asset whose next audit date has passed without an Audit, as Snipe-IT counts it. Archived Assets are never Audit late.
_Avoid_: overdue (late return only)

**Last audited**:
The date an Asset was last Audited. Also the Report of Assets whose last Audit falls in a date range, or that have never been Audited.

**Expiring Warranty**:
An Asset whose warranty ends within the next 90 days. "Warranty expiring" is the same thing as a heading (dashboard list, Report name).

**End of life**:
The date after which an Asset should be replaced (Snipe-IT's EOL date). Also the Report of Assets reaching it in the next year or already past it.
_Avoid_: EOL (alone), retirement

**Operator**:
The IT staff member running the app. Each Operator uses their own Snipe-IT API key, so History shows who did each Checkout/Checkin.

**Permission Group**:
A named set of Snipe-IT permissions a User inherits by belonging to it. Only a Superuser may change a group or a User's groups.

**Superuser**:
A Snipe-IT account that may manage Permission Groups and permissions. Distinct from Operator: an Operator may or may not be one.
_Avoid_: admin, user (User is the Assignee kind)

**History**:
The Snipe-IT activity log for one Asset: every Checkout, Checkin, and edit, with who did it and when.

**Lookup**:
Finding things by typing or scanning into the single search box. An exact Asset Tag opens that Asset; anything else finds matching Assets, Users, Locations, Asset Models, Licenses, Accessories, Consumables, and Components, grouped by kind, each saying which field held the text (a custom field, the notes, the Serial…). A barcode scan is just fast typing.
_Avoid_: full-text search (Snipe-IT matches fields, it doesn't index text)

**Asset Model**:
The make and model an Asset is an instance of (e.g. "HP Chromebook 14 G7"). Many Assets share one Asset Model.
_Avoid_: model (alone), product, type

**Activity Report**:
The Snipe-IT activity log across the whole inventory: every Checkout, Checkin, and edit of anything, with who did it and when. History is the same log for one Asset.
_Avoid_: audit log

**Report**:
A table over the whole inventory the Operator runs on request, or has emailed on a Schedule, and can export as CSV: one of the built-in Reports (the Activity Report, Overdue, Expiring Warranty, Audit due, Audit late, Last audited, Assets by Status Label and Location, Checked out per User, Damaged, Temp checkout history, End of life, Maintenances, Duplicates) or a Saved Report. Most can be narrowed to a date range; the audit Reports, Assets by Status Label and Location, Checked out per User and End of life also to a Location and a Category.
_Avoid_: export (the export is the file a Report is saved to)

**Duplicates**:
The Report of every Asset whose Serial or Asset Tag another Asset shares, ignoring case and outer spaces. A blank Serial is never a duplicate.

**Record type**:
The kind of thing an Activity Report entry is about: an Asset, License, Accessory, Consumable, Component, or User.
_Avoid_: item type (Snipe-IT's field name)

**List**:
A page listing one kind of record (or the Activity Report) that can be filtered, sorted, and paged, with Columns the Operator can show or hide, and saved as a CSV as shown. "All records" is the page that names every List.
_Avoid_: tab, grid, table

**Record**:
One Snipe-IT thing of any kind but the Activity Report (an Asset, a User, a Category…). Opening a Record shows every field Snipe-IT sent, with related Records linked and what belongs to it (a Location's Assets, a Category's Models) one click away as a filtered List.
_Avoid_: item, entry, row (a row is a Record's line in a List)

**Category**:
Snipe-IT's grouping of one kind of thing: a Category holds Assets (via their Asset Models), Licenses, Accessories, Consumables, or Components, never a mix.

**Manufacturer**:
Who made an Asset Model, Accessory, Consumable, Component, or License (e.g. "HP").

**Supplier**:
Who an Asset was bought from, or who repaired it (on a Maintenance).
_Avoid_: vendor

**Department**:
A group of Users within a Company, with an optional manager (a User) and Location.

**Company**:
The top-level owner Snipe-IT can split Assets and Users by. NOMMA has one unless multi-company is turned on.

**Status Label**:
An Asset's status in Snipe-IT (e.g. "Ready to Deploy", "Broken"), each of a type: deployable, pending, undeployable, or archived.
_Avoid_: state, status (alone, when the label is meant)

**Quick Action**:
A Checkout, Checkin or status change started from an Asset's row in the Assets List. Its form opens in the Asset panel, without leaving the List.

**View**:
One of the Assets List's built-in starting points: All, Checked out, Available, Damaged, Out on temp, Overdue, Audit due and Audit late. Each is a fixed condition that the search and filter boxes narrow. Audit due and Audit late are exactly what Snipe-IT counts.
_Avoid_: saved view, tab, smart filter (an Operator's saved one is a Saved Report)

**Asset panel**:
One Asset's sheet shown beside the Assets List, opened by a scan, a row or a Quick Action, so the List and its Selection stay put.
_Avoid_: drawer, slide-out, sheet (the sheet is the full-page Asset)

**Workflow**:
A guided screen for one job the Operator repeats at the counter, driven by scanning or typing: the field waits for input, Enter submits, and it loops until the Operator says Done. The Workflows are Bulk checkout, Bulk return, Repair intake, Incoming repair and Temp checkout. The Workflows page and the sidebar list them; Ctrl+1–5 open them directly. Each has a Running list and Undo last. An Asset that can't go through as scanned is never changed without the Operator choosing to.
_Avoid_: wizard, tool, flow

**Running list**:
A Workflow's list of what it did this session, newest first: each scanned Asset with what was done and its result (waiting, paused, done, refused, failed, not sure it went through, skipped, not sent, stopped or undone). It's kept in memory only, until the app quits or it's cleared, and survives leaving the Workflow. Its newest done row can be undone once.
_Avoid_: log, history (History is Snipe-IT's per-Asset log), cart, batch

**Undo last**:
Reversing a Workflow's newest done row with the opposite Snipe-IT action (a Checkin for a Checkout, a Checkout for a Checkin, Damaged again for a repair return). History keeps both entries, and any email already sent stays sent.
_Avoid_: rollback, revert

**Paused**:
A Workflow whose queue has stopped because Snipe-IT can't be reached, rejected the API key, or asked the app to slow down. Scans keep joining the queue, and nothing more is sent until the Operator presses Resume, or after a slow-down, until the wait ends.
_Avoid_: offline mode, retry queue

**Workflow note**:
The note a Workflow writes in Snipe-IT, starting with the Workflow's name in square brackets (`[Repair intake] cracked screen`, `[Temp checkout | due: 2026-10-13 14:50]`), or `[Undo]` and the Workflow's name when Undo last reverses a step. Reports find Workflow steps in the Activity Report by it, and a hand-typed note in the same form counts the same.
_Avoid_: tag (alone; an Asset Tag is the identifier), marker

**Bulk checkout**:
The Workflow for handing Assets to one User, never a Location: find the User by name, email or employee number, then scan Assets one at a time, confirming each, and Check each out to that User until Done, then find the next User. An Asset already checked out to someone else is moved to this User only if the Operator chooses Move to this User; otherwise it's stopped. Its Running list shows what was checked out this session.
_Avoid_: bulk issue, issue (say Checkout)

**Bulk return**:
The Workflow for taking many Assets back: pick the one Location returns go to, then scan Assets one at a time. Each checked-out one is checked in at once, with no confirm, set to Ready to Deploy and sent to that Location. Assets that aren't checked out are reported and left alone. Its Running list shows what came back this session and from whom.
_Avoid_: collection, bulk checkin

**Repair intake**:
The Workflow for a broken Asset coming to the counter: scan it, write what happened to the Asset (required), then Check it in as Damaged (or just mark it Damaged if it isn't checked out) and open a Maintenance for the repair. When a User held it, a User notes line is added to that User's notes. It can undo the last one.
_Avoid_: drop-off, break/fix

**User notes line**:
The one dated line Repair intake adds to a User's notes about an Asset they returned damaged, naming the Asset Tag and the Operator. It says what happened to the Asset, never anything about the User. If Snipe-IT refuses the write, the Operator can copy the line and add it by hand.
_Avoid_: incident note, damage report

**Damaged**:
An Asset between Repair intake and Incoming repair: broken, waiting for or away at repair. It's the Status Label named 'Damaged' in Snipe-IT, which the app finds by name. A Damaged Asset normally has an open Maintenance.
_Avoid_: broken, in repair (one state covers both)

**Damaged since**:
When an Asset became Damaged: the start date of its open Maintenance, or of its Repair intake. "Not recorded" when it was set Damaged outside the app.

**Incoming repair**:
The Workflow for Assets coming back from repair: scan each, confirm it, make it Ready to Deploy, note the return in its History, and close its Maintenance with the Supplier and Repair cost if given. An Asset that isn't Damaged is refused or needs the Operator to choose Make ready anyway.
_Avoid_: repair return, RMA

**Maintenance**:
Snipe-IT's record of a repair on one Asset. Repair intake opens it; Incoming repair closes it, adding the Supplier who did the work and the Repair cost if given. Snipe-IT counts the days it took.
_Avoid_: ticket, work order, RMA

**Repair cost**:
What a repair cost, kept on its Maintenance. It isn't the Asset's purchase cost.
_Avoid_: cost (alone, when the purchase cost could be meant)

**Temp checkout**:
A Checkout for the rest of the school day: due back at the end-of-day time (2:50 pm unless changed, e.g. for a half day) the same school day, or the next school day if made after that time. Every Operator sees every Temp checkout, whoever made it. Its Checkout note starts with `[Temp checkout | due: <date> <time>]`, so it stays in History. It's outstanding while its Asset is still on that Checkout.
_Avoid_: loaner, day loan, short-term checkout

**School day**:
A weekday that isn't a holiday or break in the School calendar.

**School calendar**:
The holidays, breaks and half days typed into Settings that decide School days and each date's end-of-day time. Each Operator's PC keeps its own copy.
_Avoid_: term calendar, schedule (a Schedule is a Report's send times)

**End-of-day time**:
When the school day ends and Temp checkouts are due: 2:50 pm unless the School calendar gives that date a half day time.
_Avoid_: dismissal, cutoff

**End-of-day reminder**:
The desktop notification each School day at the end-of-day time, on every Operator's app that has it turned on. It gives the count and Asset Tags of Temp checkouts still out, never names, because notifications show on lock screens. Clicking it opens them in the Overdue list.
_Avoid_: alert, nag, overdue notice

**Automatic check-in**:
An opt-in Checkin the app makes by itself, once each School day at a set time, of each Temp checkout still out. It's credited to the Operator whose app made it. Its note starts with `[Automatic check-in]` and it leaves the Status Label unchanged. Off unless turned on in Settings.
_Avoid_: auto-return

**Selection**:
The Records ticked in one List, across its pages, that a Bulk Action applies to. It clears when the Operator leaves the List. On the Assets List it survives switching Views, the Asset panel and scans.
_Avoid_: batch, cart

**Bulk Action**:
One action (edit shared fields, delete, Checkout, Checkin, Audit, print Labels) applied to every Record in a Selection, one Record at a time, with a result for each. Nothing is rolled back. Printing Labels is the exception: one Label PDF for the whole Selection.
_Avoid_: mass edit

**Label**:
The printed sticker for an Asset: a QR code linking to the Asset in Snipe-IT and a barcode encoding its Asset Tag.
_Avoid_: tag (the Asset Tag is the identifier, not the sticker)

**Import**:
Creating or updating Records from a CSV through Snipe-IT's own importer, with each CSV column matched to a field.
_Avoid_: upload, sync

**Saved Report**:
A List with its filters, Columns and, for Assets, its View, saved under a name by the Operator, which can be emailed to the Operator.
_Avoid_: custom report, saved search

**Schedule**:
When a Saved Report or built-in Report emails itself to the Operator: daily, weekly or monthly at a set time. An Activity Report, Overdue, Last audited, Temp checkout history or Maintenances Schedule also sets its dates relative to each send (the previous 1, 7 or 30 days, or since the last send). A built-in Report's Schedule sends every Location and Category. A send missed while the app was closed goes out once at the next launch; a failed send tries again each hour.

**License**:
A software license in Snipe-IT with a fixed number of seats. A seat is **In use** when assigned, **Free** otherwise. Seats are checked out to a User one at a time (Snipe-IT picks the next Free one), and each comes back on its own Checkin. Its **Minimum quantity** is the fewest Free seats it should have. A License is **Running out** when its Free seats drop below its Minimum quantity, or reach 0 when none is set; a Minimum quantity of 0 silences it.

**Accessory**:
A stocked item tracked by quantity, not individually (a charger, a keyboard). Each unit is **Checked out** or **Available**. Checked out to a User a quantity at a time; each unit comes back on its own Checkin.

**Consumable**:
A stocked item that is handed out and never returns (toner, paper). Each unit is **Used** or **Remaining**. Checked out to a User a quantity at a time, and never checked in.

**Component**:
A stocked part installed into Assets (RAM, a drive). Each unit is **In use** or **Available**.

**Holding**:
A User who currently has at least one Asset, License seat, or Accessory checked out. Consumables don't count; they never come back.

**Check in everything**:
The User page's Bulk Action: every Accessory unit and License seat the User holds comes back, one Checkin at a time with one note, with a result per Accessory or License and nothing rolled back. Their Assets are left to Bulk return, which gives each a Location and Status Label.

**Custom Field**:
An extra field an Asset carries because its Asset Model asks for it (a MAC Address, a Cart). An Asset Model's set of them is its **Fieldset**; choosing another Asset Model swaps them.
_Avoid_: attribute, property, extra

**Inventory Chart**:
The dashboard's one-bar-per-kind summary of the kinds counted by quantity: Licenses, Accessories, Consumables and Components split by use, and Users split by Holding.
_Avoid_: stats, widgets

**Next major audit**:
The day in the next 12 months on which the most Assets have their next audit date (the earlier day on a tie). The app works it out; Snipe-IT has no such idea.
_Avoid_: audit day, inventory day

**Health warning**:
One line at the top of the dashboard naming something the Operator should fix: Snipe-IT unreachable, API key rejected, Snipe-IT out of date, Audit late or Audit due, Temp checkouts Overdue, Assets missing a Serial, Asset Model or Location, Assets checked out to deactivated Users, or a License Running out. Each shows a count and opens where to fix it. It never sends a desktop notification.
_Avoid_: alert, notification (a desktop notification is a separate thing)

## Relationships

- An **Asset** has at most one **Assignee** at a time
- An **Asset** has exactly one **Asset Tag** and zero or one **Serial**
- An **Asset** belongs to exactly one **Asset Model**
- Every **Checkout** and **Checkin** adds an entry to the Asset's **History**, credited to the **Operator**
- An Asset can only be **Overdue** if it was given an **Expected Checkin**
- Only Assets have a status; the other kinds are counted by quantity
- A **Selection** belongs to one **List**; a **Bulk Action** acts on one **Selection**
- A **Report** is emailed only to the **Operator's** own address
- A **Temp checkout** is due at the **End-of-day time** of a **School day**
- A **Temp checkout** still out at its **End-of-day time** is **Overdue**, and appears in the **End-of-day reminder**
- Workflow **Reports** read events from the **Activity Report**, current state from the Asset, and repairs from **Maintenances**. They never read a **User's** notes.

## Flagged ambiguities

- "Overdue" was used for both late returns and late audits. Resolved: **Overdue** means late return only; a late audit is **Audit late**.
- "People" on the dashboard means **Users**.
- "User" could mean the person running the app or the person holding the Asset. Resolved: **Operator** runs the app, **User** holds the Asset.
- "Issue" (as in "bulk issue") was a second word for Checkout. Resolved: the Workflow is **Bulk checkout**; say Checkout.
- "Batch" was the old page for checking many Assets out or in. Resolved: scanning goes through a Workflow; a **Selection** uses the Checkout and Checkin **Bulk Actions**.
- "Saved views" in the brief meant the built-in **Views**. What the Operator saves is a **Saved Report**.
