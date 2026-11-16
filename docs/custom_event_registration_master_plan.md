# FUTApulse — Native Custom Event Registration Plan

## 1. Product Goal & Overview
Replace external Google Forms links with a seamless, native, custom attendee registration system directly inside **FUTApulse (`www.futapulse.com.ng`)**.
- **Organizer Flow:** When creating or editing an event, organizers can toggle **"Require Custom Registration"**. When enabled, they can dynamically build custom form fields (Text inputs, Dropdowns/Selects, Numbers) that attendees must complete before their attendance is confirmed.
- **Attendee Flow:** When a student clicks **"Coming! (🔥)"** on an event with custom registration enabled, the standard one-tap RSVP is intercepted by a sleek, centered modal displaying the organizer's custom fields. Submitting the form saves their responses, confirms their RSVP, and increments the turnout counter.
- **Organizer Management:** Organizers can view submitted attendee registrations and responses directly from their event management view/modal, with optional CSV export.

---

## 2. Architectural & UX Guardrails
- **Canonical Domain & API Alignment:** All API endpoints and client calls must strictly respect `https://www.futapulse.com.ng` and existing auth session tokens.
- **Modal UI Standard:** All modals (Field Builder, Attendee Registration Popup, Organizer Responses View) must be **centered on screen** (`align-items: center; justify-content: center;`), mobile-viewport safe (`max-height: 90dvh; overflow-y: auto;`), and dark/light theme compliant.
- **Network Resilience ("Nigerian Factor"):** Disable submit buttons with clear loading states during API calls to prevent duplicate submissions on flaky mobile connections, and display explicit user-friendly toast messages on success or network timeout.
- **Privacy & Security:** Only the event organizer (creator) can fetch the list of registration responses for their event (`GET /api/events/:id/registrations`).

---

## 3. Phased Execution Roadmap

### Phase 1: Database Schema & Backend API Contract (Foundation)
- **Event Schema Update (`Event` Model):**
  - `requiresCustomRegistration`: `Boolean` (default: `false`)
  - `registrationFields`: Array of objects:
    ```json
    {
      "id": "string (unique field key)",
      "label": "string (e.g., 'Department', 'WhatsApp Number')",
      "type": "enum ['text', 'select', 'number']",
      "options": ["string (for 'select' type only)"],
      "required": "boolean (default: true)"
    }
    ```
- **New Collection (`EventRegistration` Model):**
  - `eventId`: ObjectId (ref: `Event`, required)
  - `userId`: ObjectId (ref: `User`, required)
  - `answers`: Array of `{ fieldId: String, label: String, answer: Mixed }`
  - `createdAt`: Date (default: `Date.now`)
  - **Compound Unique Index:** `{ eventId: 1, userId: 1 }` to strictly prevent duplicate registrations at the database level.
- **Backend Endpoints (`server.js`):**
  - `POST /api/events` & `PUT /api/events/:id`: Accept and validate `requiresCustomRegistration` and `registrationFields` (ensure every field has a valid `label` and `select` fields have at least 2 options).
  - `POST /api/events/:id/register`: Authenticated route. Validates submitted `answers` against the event's `registrationFields`, creates the `EventRegistration` record, adds the user to the event's attendees/turnout list, and returns updated event engagement metrics.
  - `GET /api/events/:id/registrations`: Authenticated organizer-only route. Verifies `req.user.id === event.organizerId` and returns all attendee registrations populated with user profile details (name, username, faculty, level) and custom answers.

### Phase 2: Organizer Dynamic Field Builder UI (Frontend)
- **Event Creation / Editor Modal (`EventEditor.jsx`):**
  - Add a toggle switch: **"Require custom attendee registration form"**.
  - When toggled ON, reveal an interactive **Form Builder Section**:
    - **"Add Question / Field"** button.
    - Each field row allows configuring: Field Label, Field Type (`Short Text`, `Dropdown Select`, `Number`), Comma-separated Options (shown if `Dropdown Select` is chosen), Required toggle, and a Remove (`🗑️`) button.
  - Enforce client-side validation before event submission so empty labels or incomplete dropdowns cannot be submitted.

### Phase 3: Attendee RSVP Interceptor Modal & Edge-Case Guards (Frontend)
- **RSVP Click Interception (`EventCard.jsx` & Feed Handlers):**
  - When a user clicks **"Coming! (🔥)"**:
    - If `event.requiresCustomRegistration` is `false`: Execute standard instant one-tap RSVP.
    - If `event.requiresCustomRegistration` is `true` and user is not yet registered: Open centered **`CustomRegistrationModal`**.
    - If user is already registered: Show clear status (*"You are registered for this event"*) and prevent duplicate modal triggers.
- **`CustomRegistrationModal.jsx`:**
  - Dynamically renders the organizer's `registrationFields` with clean validation.
  - Shows a loading spinner on submit, handles 409 Conflict (already registered) or network timeouts gracefully via toasts, and upon `200/201` success, updates the card's "Coming!" state and turnout count optimistically.

### Phase 4: Organizer Responses Dashboard & CSV Export (Frontend)
- **Organizer View (`Profile` / `My Events` or Event Card Organizer Menu):**
  - Add a **"View Registrations (X)"** button visible only to the event's creator when `requiresCustomRegistration` is enabled.
  - Opens a centered modal listing registered attendees, their profile badges (Faculty/Level), and their answers to each custom field.
  - Include a **"Download CSV"** button so organizers can export attendee lists offline for check-in at the venue.