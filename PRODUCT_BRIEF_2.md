# Asset source of truth: product brief
**In one line:** Keep the list of assets correct when things change, without anyone retyping it.

## Problem
This is for all system managers (the team and how many people are not named yet). It hurts whenever an asset changes, because someone has to add or remove it by hand, and the team is chased to update things every month. The cause is that the current way has been passed down from generation to generation, and nobody knows how to make it better. If nothing changes, the manual input and mistakes continue and things will likely be missed.

## Evidence
- You said the current process is very manual: someone adds or removes an asset by hand whenever there is a change.
- You said the team is asked to update every month, or as changes come in.
- Not checked yet: how many assets change each month, how often mistakes happen, and what the 30, 20 and 5 to 10 actually count.

## Success
- **Metric:** effort to keep the asset list right when an asset changes (you have not said what the number counts)
- **Today:** 30
- **Target:** 5 to 10 minutes (no date given)
- **Must not get worse:** not set

## Riskiest bet
That bringing the effort of an asset change from 30 down to 5 to 10 minutes is worth building, and that someone other than the one person who usually does it can keep the list right.
- **Test:** give one new asset and one removal to a team member who is not the usual person, with no new tool, and watch what they do.
- **Pass mark:** the new item and the removed item both end up right in the list, without the specific person being involved.
- **Result:** not run yet

## First version
1. As a team member who does not usually do this, I search for an asset and replace its details. Done when the entry shows the new details and the old ones are gone.
2. As a team member, I add an asset that has just arrived. Done when it appears in the list and I can find it by search.
3. As a team member, I remove an asset that has gone. Done when it no longer appears in the list.

## Walkthrough
1. They open the list and search for the asset by name.
2. They find the entry they want.
3. They replace the old details with the new ones.
4. They check the entry now shows what they entered.

If it goes wrong: they are unsure, so they assume, and end up with a wrong entry and a wrong count, with nothing on screen telling them it is wrong.

## Not building
- Any automation of the update itself, until search, find, replace is shown to work for someone who is not the usual person.
- A shared platform for every team, starting with one team's asset list.
- Reporting or dashboards on top of the list.

## Open questions
- Who exactly is "all system managers": which team, and how many people?
- What do 30 and 20 count, and is the target 5 to 10 minutes per change or per month? By when?
- You have not checked how many mistakes or missed items happen today.
