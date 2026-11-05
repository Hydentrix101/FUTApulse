# SEO and event sharing

FUTApulse serves canonical homepage and informational-page metadata, plus
public event share pages with server-rendered Open Graph, Twitter card,
canonical URL, and Schema.org `Event` metadata. Event share links include a
title-derived URL slug and the event category. The event banner is used as the
preview image; if it is absent, the organizer's public profile image is used.
Event pages include the category, activity, schedule, venue, and organizer
name without exposing attendee lists.

Only currently public `Published` and `Live` events with a valid active event
window are eligible for event previews and the sitemap. Drafts and expired
events return a non-indexable 404 response and are excluded from the sitemap.
The sitemap and robots file are served by the API and proxied through Vercel;
the event preview route is also rewritten to the API so crawlers receive event
metadata in the initial HTML response, before JavaScript runs.

## After deployment

1. Confirm `https://www.futapulse.com.ng/robots.txt` and
   `https://www.futapulse.com.ng/sitemap.xml` return successfully.
2. Open a published event share link and inspect its initial page source (not
   only the post-JavaScript DOM). Confirm the title, category, event details,
   canonical URL, `og:image`, Twitter image, and Event JSON-LD are present.
3. Use Google Search Console to verify the `futapulse.com.ng` domain property,
   submit `https://www.futapulse.com.ng/sitemap.xml`, and request indexing for
   a few representative public pages.
4. Verify the domain in Bing Webmaster Tools and submit the same sitemap.
   Bing may also offer import from Search Console.
5. Test event previews with the relevant social platform's link-preview
   inspector after the deployed response is publicly reachable.

Search engines and social platforms control crawl timing, indexing, ranking,
and whether a rich preview is displayed. Correct metadata makes the site
discoverable to crawlers but cannot guarantee a result or position. Mozilla is
a web browser, not a search engine; Firefox users see the search provider they
have selected.
