While the osu! Tournament Rating (o!TR) platform does not directly solicit personal information from individuals, we do use and collect some data in order to provide our services. Users[^1] who log into our website using the [osu!](https://osu.ppy.sh/) OAuth platform have a different amount of data collected than players[^2].

## Overview

When osu! match data is processed, a player entity is automatically created which is then tied to a specific osu! user identifier. If a player exists in our database without having first logged into our platform, they will never become a user. A player becomes a user when they log in to our platform for the first time. Similarly, if a first-time user does not have any data in our database already, a player and user object is created for them simultaneously. This allows us to then link osu! match data to them should they participate in matches relevant to us in the future.

By logging in to our platform, you are consenting to the data which is collected below in the [[#Users]] section.

> [!important]
> All data is associated with your osu! profile. Player data cannot exist in our system without an osu! profile to attach it to.

### Players

Players are defined as osu! users whose data is stored by us, regardless of whether they have logged into our platform. Player profiles are accessible to the public and are searchable.

The following information is stored for all player profiles, provided we are able to fetch it via osu! and/or osu!track.

- Publicly-available osu! profile information, such as:
    - ID
    - Username
    - Country code
    - Performance points
    - Global and country ranks
- Publicly-available information provided by [osu!track](https://ameobea.me/osutrack/), such as historical global rank
- Publicly-available osu! match data, such as scores set in matches submitted to us.

By processing this data, we are able to build relationships between you, other users, tournaments, matches, and so on. As an example, we are able to identify:

- Which osu! tournaments, matches, and games you have participated in
- Which scores you have set in these games
- Various metrics regarding the above, including:
    - Your performance in tournaments
    - Who you play tournaments with most frequently

### Users

Upon logging into the platform using osu! OAuth, we create a user profile for you if it doesn't exist. If you do not have any data in our system at the time of logging in, a [[#Players|player]] profile is created for you simultaneously. We associate the following information with your user profile:

- IP address (session management / rate limiting, handled by [BetterAuth](https://www.better-auth.com/docs/reference/security#ip-address-headers))
- osu! API access and refresh tokens (so that we can fetch data on your behalf)
- Last login date
- Your osu! friends / mutuals
- Data you submit to us voluntarily, including:
    - [[Registrant Filtering]] submissions, tournament submissions, and other similar submissions
    - (Admins only) Logs of edited and deleted tournaments, matches, games, scores, beatmaps, and any other data type we choose to manage on our platform are stored.

## Cookies

We use basic, mandatory cookies to provide users basic services, such as to store user sessions. If we didn't, users would be forced to log in each time they visit the site which doesn't align with the experience we wish to provide.

## Data Storage

All data is stored within the United States of America.

## Logging

The following information is logged in order to provide our services:

- Web and API client requests you make. Normal web browsing activity does trigger these logs. These logs are stored even when users are signed out. Signing out fully anonymizes these logs. This information is not saved in our database. The following information is stored within such logs:
    - A "Trace ID" and "Span ID" which allows us to map your request to database queries (used to diagnose performance issues across different parts of our system)
    - Your User ID, if signed in
    - Request metadata, such as endpoint, response code, response time, and other relevant, non-identifying information
    - Timestamp
- Error and warning logs of various nature, including API requests. Like request logs, these are not saved in our database.

## Data Access

These users have elevated access to system data[^3]:

- [Stage](https://osu.ppy.sh/users/8191845) (Superadmin, full access to all systems)
- [Convex](https://osu.ppy.sh/users/11292327) (Read-only access to production database & logs)

## Data Deletion

At this time, data deletion requests from our platform are not supported.

Data is re-fetched from relevant services periodically in order to update your username and other basic profile information. If your osu! account is deleted or otherwise inaccessible via the [osu! API](https://osu.ppy.sh/docs/index.html), we will no longer update your information on our end.

## Data Distribution

Outside of what is defined in the below sections, we do not engage with, sell, share, or distribute your information to any third parties.

### Compliance

We periodically archive and share a subset of our data publicly, specifically for the purpose of complying with [rules](https://osu.ppy.sh/wiki/en/Tournaments/Official_support#programs) outlined by the [osu! Tournament Committee](https://osu.ppy.sh/wiki/en/People/Tournament_Committee). This includes, but is not limited to:

- Match and player data fetched from the [osu!](https://osu.ppy.sh/docs/index.html) and [osu!track](https://github.com/Ameobea/osutrack-api) APIs.

### Donations

Users who choose to donate via [Buy Me a Coffee](https://buymeacoffee.com/stagecodes) will have their personal information processed by Buy Me a Coffee and Stripe. That personal information will be stored in accordance with their policies and is not stored by us.

[^1]: A user is an osu! user who has logged into our platform via osu! OAuth.
[^2]: A player is an osu! user whose data is automatically stored as part of our tournament submission process.

[^3]: See [[Team]] for more information on member roles.
