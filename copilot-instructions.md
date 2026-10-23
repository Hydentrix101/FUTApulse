# GitHub Copilot System & Architecture Instructions — FUTApulse

## 1. Project Genesis & Product Mission
- **Platform Concept:** **Pulse FUTA** is a real-time, high-energy campus hub designed specifically for students at the Federal University of Technology, Akure (FUTA) to discover, track, and engage with live campus events, tech meetups, social gatherings, workshops, and departmental activities.
- **Primary Objective:** Deliver a central, hyper-engaging feed where students can view live countdowns, verify event turnout metrics, receive automated notifications, access venue directional insights, and view post-event recaps—eliminating missed campus happenings and fragmented information spread across multiple chat groups.
- **Target Audience:** FUTA undergraduates, department executives, campus creators, and organizers seeking instant, reliable visibility into social, academic, and technical campus life.





### 









## 2. Core Vision & Problem Statement
FUTApulse is the dedicated campus event discovery and social engagement platform built specifically for students at the Federal University of Technology, Akure (FUTA). Key Campus Challenges Solved:
1. **Information Fragmentation:** FUTA campus events (SUG, Departmental Associations, Faculty associations like SEET/SAAT/SET, religious fellowships, tech hubs) are currently scattered across random WhatsApp groups, broadcast messages, and temporary Instagram stories. FUTApulse centralizes all active campus events into a unified, high-density discovery feed.
2. **Urgency & Commencement Tracking:** Students frequently miss high-value academic tutorials, hackathons, and cultural nights because static posters lack real-time visibility. FUTApulse solves this using dynamic temporal countdown tickers (`STARTS IN HH:MM:SS` for events within 24 hours).
3. **Engagement & Turnout Verification:** Organizers lack accurate attendance metrics before booking venues (e.g., ETF Halls, LT1/LT2, SUB). FUTApulse provides single-tap `🔥 Coming!` hype counters and saved reminders to give organizers real-time turnout analytics.
4. **Targeted Student Onboarding:** Events and announcements need departmental and level relevance. FUTApulse captures student identity (Faculty, Department, Academic Level, Role) during onboarding to tailor recommendations.---

## 3. Updated Framework Architecture & Design System

### Framework & Directory Boundaries
- **Frontend Stack:** Vite + React (Modular component tree housed inside `client/src/`).
- **Styling Engine:** Tailwind CSS v4 paired with native custom keyframes and glassmorphic utilities inside `client/src/index.css`.
- **Visual Source of Truth:** `client/src/index.css` and the React components in `client/src/` define the active visual system, interactions, and responsive layouts. **Never substitute flat/generic unstyled UI elements.**
- **Backend Stack:** Express REST API running on `http://localhost:3001`, with local JSON fallback storage and optional MongoDB persistence.
- **Product Platform:** FUTApulse is a mobile-first campus app intended for phones. The current Vite + React client is the app's development UI; do not treat that as a decision to use website-only ads. Native SDK integrations must go through a mobile-platform adapter once the Android/iOS packaging target is selected.
- **Viewport Constraints:** Mobile-first responsive container is centered and constrained to a maximum width of `480px` (`.app-frame`).
- **Community Publishing:** Any signed-in student with a completed profile may publish an event; organizer verification is not a posting gate. Banners are optional. Exact duplicates compare title, category, venue, start and end times, and event activity; show the existing event and block an exact duplicate. Close matches remain inspectable before a distinct-event confirmation. Editing is restricted to the original authenticated creator. Drafts must never appear in public feeds.
- **Reports & Posting Review:** A signed-in account can report a published event once. Five unique reports create a pending review case and email the configured developer account; the threshold alone takes no action. Only the authenticated, verified developer account may choose `Ban` (pause posting for seven days) or `Ignore`. Keep the report queue and email links scoped to that account. The report penalty applies to publishing, not sign-in or event viewing.
- **First Sign-In Guidelines:** Present the community guidelines after the user's first completed sign-in/profile setup, store acceptance on the account, and keep the guidelines available from the three-dot Profile options menu. Add future legal/help documents to that same menu when their content is prepared.
- **Profile Identity & Badges:** Event ownership follows the immutable account ID, not the editable username. Event organizer name, username, faculty, and picture must reflect the owner's latest saved profile, including on older event cards. Show `Campus Explorer` until the account has a successfully published/live event; show `Organizer` after that; use `Trending Organizer` when any published event reaches the Hot score threshold. Drafts alone do not earn a badge.
- **Mobile Profile Events:** Keep Events and Drafts buttons accessible and support horizontal touch swipes across the organizer hub to switch between those lists.
- **Mobile Monetization Scaffolding:** See the Commercial Architecture & Revenue section. Keep the two-second launch-ad preview skippable and never block authentication/session recovery or shared-event links. Keep all ads in mock mode until a supported native mobile ads adapter is installed and configured.

### Layout & Component Mechanics
- **Sticky Shell:** The application header (`sticky top-0 z-50`) and bottom navigation bar (`sticky bottom-0 z-50`) MUST remain fixed with `backdrop-blur-md` glassmorphism while only the central feed container scrolls (`overflow-y-auto pb-28`).
- **Theming Engine:** Dynamic dual-theme support (`light` / `dark`) with smooth global transition curves (`0.35s ease`) and ambient floating background glows (`floatGlow`).
- **Component Contracts (`EventCard.jsx`):**
  - **Interactive Location Stack:** Maintain the `isLocationModalOpen` local state to display the white Venue Landmark popover modal when tapping the location pill.
  - **Interactive Faculty Turnout Grid:** Maintain the `isTurnoutOpen` local state to display circular faculty logos and attendance stats (`SEET`, `SEMS`, `SAAT`) when tapping the attendee metric.
  - **Asset Resolution:** Faculty badge logos MUST resolve against `/Faculty Logo/` asset paths (e.g., `/Faculty Logo/SEET.png`) with explicit `onError` fallback handlers.
  - **Single-Tap Guard:** Limit the 🔥 Hype button using a local `hasHyped` guard to prevent duplicate click increments per session.

---

## 4. Commercial Architecture & Revenue

### Product and rollout scope
- FUTApulse is a PWA-only product. The Vite + React application is mobile-first and runs in supported phone browsers; do not add Capacitor, Android/iOS native projects, native plugins, or native SDK integrations.
- **Current stage:** ad preparation only. Keep live ads disabled and render clearly labeled mock placements. Do not add browser-only Google AdSense tags or assume a website monetization flow.
- **Potential revenue channel:** web sponsorship or advertising only after provider setup, disclosures, consent, and web integration are reviewed. Keep current placements as house/mock content until then.
- **Deferred revenue channel:** ticket sales through Paystack or Flutterwave are out of scope until FUTApulse is established and adopted at FUTA. Do not add checkout flows, payment credentials, or ticket issuance in the current phase.

### Sponsored content contract
- Vite `VITE_*` values are included in client builds, so they must never contain private keys, payment secrets, SMTP credentials, or OAuth secrets.
- Keep sponsored placements clearly labeled and separate from event records, organizer data, and event actions. Mock destinations must never imply a real sponsor offer.
- Do not add mobile platform ad identifiers or native ad adapters. Any future live ads require a reviewed web integration, approved provider setup, disclosures, and consent behavior.
- Keep the launch-ad preview skippable, time-limited, and outside authentication/session recovery. Shared-event deep links must bypass it.
- Preserve clear `Sponsored` labeling and keep sponsored content separate from event records, organizer data, and event actions. Mock destinations must never imply a real sponsor offer.

### Privacy, support, and platform review
- Before enabling live ads, provide accessible in-app Privacy Policy, Terms of Service, and About/Contact links. The privacy disclosures must describe the actual mobile ad SDK, identifiers/data collected, third-party processing, consent choices where required, and any web-view cookie behavior if applicable.
- Ad setup and review are platform/account decisions; never promise approval or a fixed revenue outcome. Do not enable live ads until the app package, policy disclosures, provider account, and platform-specific configuration have been reviewed.

## 5. Modernized Development Roadmap

### [Phase 1: Core Modular Engine] — (COMPLETED)
- [x] Migrate monolithic vanilla JS layout to Vite + React + Tailwind CSS v4.
- [x] Establish modular component architecture in `client/src/components/`.
- [x] Connect `App.jsx` to Express REST backend (`http://localhost:3001/api/events`).

### [Phase 2: Engagement & Localized Network Resilience] — (COMPLETED)
- [x] **Hype & Anticipation Engine:** Live countdown timers via `<CountdownPill.jsx>`. Attendance/Coming and flame hype counts must be confirmed by the API; never make either count appear successful offline. Refresh shared event counts while online.
- [x] **Interactive Stacked Modules:** Venue Landmark popover modal and Faculty Turnout badge grid reveal inside `<EventCard.jsx>`.
- [x] **Spotify-Style Discovery:** Real-time search filtering, category pills (`Academic`, `Tech & Innovation`, `Social & Parties`, `Religious & Fellowship`, `Sports`), and venue quick-chips in the Explore view.
- [x] **Optimistic UI & Offline Cache:** Cache event reads and local drafts, and queue reminder preference updates for retry. Attendance and flame hype require an online API confirmation and must not be queued or optimistically counted offline.

### [Phase 3: Reminders, Broadcasts & Venue Insights] — (UPCOMING)
- [ ] Personalized scheduled notification engine (24h, 2h, 30m before kickoff) with device push notifications through a mobile-platform adapter.
- [ ] Priority organizer broadcast dashboard for instant schedule and venue shift alerts.

### [Phase 4: Social Proof & Media Recaps] — (PLANNED)
- [ ] Post-event recap card state transitions (24–48 hour highlight gallery window before archiving).
- [ ] Turnout avatar stacks and classmate attendance social proof indicators.

---

## 6. Backend Engineering Guidelines ("Nigerian Factor" Resilience)

When developing backend services, database queries, and client-side data fetching, **always engineer for local infrastructure realities**—specifically mobile network volatility, packet loss, high ping spikes, power disruptions, and bandwidth constraints typical of Nigerian mobile networks (MTN, Airtel, Glo, 9mobile).

### Architectural Rules for Localized Network Resilience:
1. **Server-Confirmed Attendance & Offline Caching:**
   - Attendance/Coming and flame hype counters are shared data. Require a live server response before showing success or changing the confirmed count; never queue these counter mutations while offline.
   - Cache event reads and drafts locally. Reminder preferences may queue for retry, with a clear pending state and no claim that a device notification was scheduled until confirmed.
   - Hide completed events from discovery exactly 30 minutes after their end time while retaining future event records for organizer history.
   - Show the Hot section only when at least one event meets the existing hot score threshold. Do not fill it with ordinary events.
2. **Aggressive Retry & Exponential Backoff:**
   - Configure all REST/HTTP calls with exponential backoff and randomized jitter to eliminate thundering herd problems during reconnection bursts.
3. **Realtime Transport (if introduced):**
   - The current backend uses REST; do not add a WebSocket dependency unless a feature requires realtime server push.
   - If WebSockets are introduced, provide polling fallback and resilient reconnection while keeping heartbeat payloads minimal.
4. **Graceful Timeouts & Non-Blocking Feedback:**
   - Enforce strict request timeouts (8–10 seconds max) to prevent endless loading spinners.
   - Display non-blocking toast notifications when connection drops occur, preserving application state without freezing the UI.
