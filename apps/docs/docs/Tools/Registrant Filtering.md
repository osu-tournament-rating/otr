The Registrant Filtering tool allows tournament hosts to filter registrants based on certain criteria which we maintain.

## Filter Criteria

Filters can be applied against:

- Ruleset
- Current rating, with a minimum, a maximum, or both

> [!note]
> Reports made before the tool offered only rating bounds may also list the peak rating, tournament count, and match count criteria they were run with. The tool no longer applies those criteria.

We do not support filtering against osu! statistics, such as global rank or badge count, for these reasons:

1. If we do not have a player's osu! data at the time of filtering, it would have to be fetched on-demand, introducing significant slowdowns.
2. As osu! data is only fetched periodically, the filter may check against outdated information.
3. Supporting [BWS](https://osu.ppy.sh/wiki/en/Tournaments/Badge-weighted_seeding) and other custom criteria significantly increases the complexity of the tool, going beyond our scope and introducing too many edge cases.

If you would like to filter using osu! statistics in addition to o!TR statistics, we recommend using one of the publicly-available spreadsheet templates. These spreadsheets typically allow you to enter your own osu! API key to do the data fetching yourself. You can then combine the two filtering methods for a final list of eligible players. See the [Community Resources](https://osu.ppy.sh/community/forums/topics/2012941?n=1) osu! forum post for more information.

## Using the Tool

To use the tool, simply select the ruleset of your tournament, input your filter criteria, and paste a list containing the osu! IDs of all tournament registrants.

A report is then generated for review. Reports can be downloaded as a `.csv` file for import into a spreadsheet. The ID linked to the report can be looked up by anyone using our Filter Report tool. A report stays available after its creator deletes their o!TR account.

## Limits

The tool limits how much each user can filter, because every player o!TR does not have yet is looked up on osu!:

- Each user can create 2 filter reports in any 24 hours.
- Each report can check up to 1,000 osu! player IDs.

o!TR admins have no daily limit or approval step, and can check up to 5,000 osu! player IDs a report.

### Player lookups

o!TR looks up each player it does not have yet on osu! on the user's behalf, with the osu! account they log in with, at up to 60 requests a minute. That speed belongs to the user alone, apart from o!TR's own osu! requests and from the user's o!TR API rate limit. A player takes up to 4 requests, one per ruleset, so about 15 players are looked up a minute. The report does not wait for the lookups, since a player new to o!TR has no rating yet.

If osu! stops accepting the user's account, for example after they revoke o!TR's access on osu!, the lookups wait and the filter page asks the user to log in with osu! again, which resumes them. Players still waiting after 7 days are looked up in o!TR's regular refresh of player data instead.

Players in an admin's own reports are looked up with o!TR's own osu! client.

### Admin approval

If more than 30% of the players in a request are not in o!TR yet, the tool asks the user for a justification and holds the request for an o!TR admin instead of running it. Nothing is looked up until an admin approves it. Approval runs the filter and creates the report, and its players are looked up with the user's osu! account as if they had run it; the user finds the report, and any denial, under Your filter requests on the filter page. A held request counts toward the daily limit when it is sent.

## Notice to Tournament Hosts

You **must**:

1. Obtain written approval from [osu! support](mailto:tournaments@ppy.sh) before using our tool in an [officially-supported](https://osu.ppy.sh/wiki/en/Tournaments/Official_support) tournament.
2. Post the timestamp and filter report ID on your forum post. The tool will display a one-line template message which you may copy into the post directly.
3. Use our filtering system as intended. It is **expressly prohibited** to alter our filtering result for any reason. We store a detailed record of all inputs and outputs for auditing and verification purposes.

You should **consider**:

1. Saving the most recent public archive from the [public replicas site](https://data.otr.stagec.net) at the time of making the filter request. In the event of a disaster on our end, hosts are expected to provide the dataset to the [Tournament Committee](https://osu.ppy.sh/wiki/en/People/Tournament_Committee) when it comes time to review for badge eligibility.
