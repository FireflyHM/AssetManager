# Asset list upkeep: product brief
**In one line:** Keep the data centre asset list current without retyping vendor documents.

## Problem
People who maintain our asset lists update them by hand each time a project brings in new hardware, working through whatever the vendor sends: pdf, xls, or jpgs of scanned delivery orders. Projects go to different vendors, so formats vary and someone collates them all. If nothing changes, the list may be out of date, equipment gets missed at the maintenance agreement, and warranty expiry stays hard to track.

## Evidence
- Colleagues have complained about keeping track of assets and forgetting to add equipment to maintenance agreements.
- Each project may use a different vendor, so documents arrive in several formats.
- Your estimate of current effort is a few man-days a year.
- Not checked yet: how often this happens, how many assets are involved, and whether that saving justifies adopting a new tool.

## Success
- **Metric:** man-days a year spent maintaining asset lists and maintenance agreements
- **Today:** a few man-days a year
- **Target:** not set
- **Must not get worse:** not set

## Riskiest bet
Saving a few man-days a year is enough to justify adopting and maintaining this alongside the existing lists.
- **Test:** collect sample delivery orders, completion documents or purchase orders showing brand, model and serial number, and extract the fields by hand.
- **Pass mark:** brand, model and serial number extracted from every document.
- **Result:** not run yet

## First version
1. As someone who maintains an asset list, I upload a vendor document. Done when I can see it has been read.
2. As someone who maintains an asset list, I check the extracted brand, model and serial number. Done when each field sits beside the document and I can correct gaps.
3. As someone who maintains an asset list, I confirm the rows into one file. Done when the file holds them in one standard format.

## Walkthrough
1. The user uploads one or more documents.
2. The system reads them and pulls out the relevant information.
3. The user checks the fields against the document and corrects what is wrong.
4. The confirmed rows go into the standard list.
If it goes wrong: the user sees the uploaded document beside the blank field and fills it in by hand.

## Not building
- Comparing this year's list with last year's to spot decommissioned or new equipment.
- Outlook calendar reminders for maintenance agreement renewals.
- Automatic updates to the maintenance agreement itself.

## Open questions
- Target and must-not-get-worse are blank. What counts as a win?
- Your test checks extraction accuracy, not whether the saving justifies adopting the tool, which is the bet you named.
- How often does hardware arrive, and how many assets are involved?
