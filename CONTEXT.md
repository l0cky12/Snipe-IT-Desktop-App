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
An Asset whose warranty ends within the next 90 days.

**Operator**:
The IT staff member running the app. Each Operator uses their own Snipe-IT API key, so History shows who did each Checkout/Checkin.
_Avoid_: admin, user (User is the Assignee kind)

**History**:
The Snipe-IT activity log for one Asset: every Checkout, Checkin, and edit, with who did it and when.

**Lookup**:
Finding an Asset by typing or scanning into the single search box. A barcode scan is just fast typing.

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
- Every **Checkout** and **Checkin** adds an entry to the Asset's **History**, credited to the **Operator**
- An Asset can only be **Overdue** if it was given an **Expected Checkin**
- Only Assets have a status; the other kinds are counted by quantity

## Flagged ambiguities

- "Overdue" was used for both late returns and late audits. Resolved: **Overdue** means late return only. Audits are out of scope.
- "People" on the dashboard means **Users**.
- "User" could mean the person running the app or the person holding the Asset. Resolved: **Operator** runs the app, **User** holds the Asset.
