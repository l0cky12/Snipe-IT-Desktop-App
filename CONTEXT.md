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
Assigning an Asset to an Assignee, recorded in Snipe-IT.

**Checkin**:
Returning a checked-out Asset to inventory, clearing its Assignee.

**Assignee**:
Whoever an Asset is currently checked out to: a **User** or a **Location**.

**User**:
A person in Snipe-IT (staff or student) who can be an Assignee.

**Location**:
A physical place in Snipe-IT (e.g. "Room 204") that can be an Assignee.

**Expected Checkin**:
The optional date, set at Checkout, by which the Asset should come back.

**Overdue**:
A checked-out Asset whose Expected Checkin date has passed. Means late *return* only.
_Avoid_: using "overdue" for audits

**Expiring Warranty**:
An Asset whose warranty ends within the next 90 days. "Warranty expiring" is the same thing as a heading (dashboard list, Report name).

**Operator**:
The IT staff member running the app. Each Operator uses their own Snipe-IT API key, so History shows who did each Checkout/Checkin.
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
A table over the whole inventory the Operator runs on request and can export as CSV: the Activity Report, Overdue, or Expiring Warranty, each optionally narrowed to a date range.
_Avoid_: export (the export is the file a Report is saved to)

**Record type**:
The kind of thing an Activity Report entry is about: an Asset, License, Accessory, Consumable, Component, or User.
_Avoid_: item type (Snipe-IT's field name)

**List**:
A page listing one kind of record (or the Activity Report) that can be filtered, sorted, and paged, with Columns the Operator can show or hide. "All records" is the page that names every List.
_Avoid_: tab, grid, table

**Record**:
One Snipe-IT thing of any kind but the Activity Report (an Asset, a User, a Category…). Opening a Record shows every field Snipe-IT sent, with related Records linked and what belongs to it (a Location's Assets, a Category's Models) one click away as a filtered List.
_Avoid_: item, entry, row (a row is a Record's line in a List)

**Category**:
Snipe-IT's grouping of one kind of thing: a Category holds Assets (via their Asset Models), Licenses, Accessories, Consumables, or Components, never a mix.

**Manufacturer**:
Who made an Asset Model, Accessory, Consumable, Component, or License (e.g. "HP").

**Supplier**:
Who an Asset was bought from.

**Department**:
A group of Users within a Company, with an optional manager (a User) and Location.

**Company**:
The top-level owner Snipe-IT can split Assets and Users by. NOMMA has one unless multi-company is turned on.

**Status Label**:
An Asset's status in Snipe-IT (e.g. "Ready to Deploy", "Broken"), each of a type: deployable, pending, undeployable, or archived.
_Avoid_: state, status (alone, when the label is meant)

**Quick Action**:
A Checkout, Checkin, status change, or add-to-Batch done from an Asset's row in a List, without opening the Asset.

**Batch**:
Assets gathered on the Batch page for one Checkout or Checkin of all of them. It lives only for the session; each Asset still goes through the single Checkout or Checkin, so History credits the Operator as usual.
_Avoid_: bulk, selection, cart

**License**:
A software license in Snipe-IT with a fixed number of seats. A seat is **In use** when assigned, **Free** otherwise.

**Accessory**:
A stocked item tracked by quantity, not individually (a charger, a keyboard). Each unit is **Checked out** or **Available**.

**Consumable**:
A stocked item that is handed out and never returns (toner, paper). Each unit is **Used** or **Remaining**.

**Component**:
A stocked part installed into Assets (RAM, a drive). Each unit is **In use** or **Available**.

**Holding**:
A User who currently has at least one Asset, License seat, or Accessory checked out. Consumables don't count; they never come back.

**Inventory Chart**:
The dashboard's one-bar-per-kind summary: Assets split by status, Licenses, Accessories, Consumables, and Components split by use, Users split by Holding.
_Avoid_: stats, widgets

## Relationships

- An **Asset** has at most one **Assignee** at a time
- An **Asset** has exactly one **Asset Tag** and zero or one **Serial**
- An **Asset** belongs to exactly one **Asset Model**
- Every **Checkout** and **Checkin** adds an entry to the Asset's **History**, credited to the **Operator**
- An Asset can only be **Overdue** if it was given an **Expected Checkin**
- Only Assets have a status; the other kinds are counted by quantity

## Flagged ambiguities

- "Overdue" was used for both late returns and late audits. Resolved: **Overdue** means late return only. Audits are out of scope.
- "People" on the dashboard means **Users**.
- "User" could mean the person running the app or the person holding the Asset. Resolved: **Operator** runs the app, **User** holds the Asset.
