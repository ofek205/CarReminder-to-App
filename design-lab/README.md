# Car Reminder home design experiment

Open the existing Vite development server at http://127.0.0.1:5173/design-lab/.

This is an independent HTML entry with a React presentation component in `src/design-lab/HomeMockup.jsx` and scoped design styles in `src/design-lab/home-mockup.css`. It does not import application providers, access backend services, write browser storage, or modify the existing Dashboard. Vite's current production build has only the main application entry, so this separate entry is for local design review.

The prototype uses fixed sample data dated September 10, 2026, with existing public project images. Plate results and navigation sheets are illustrative. Updating a meter or adding a sample vehicle changes memory only and resets on reload.

Preview controls switch between the new design and `before-polish.png`, a mobile screenshot of this prototype before the final polish with the same initial three-vehicle sample data. This compares two prototype revisions, not the production Dashboard. Controls also switch between mobile and wide layouts. Check `node design-lab/check.mjs` against the running server for viewport, image, interaction, and external-request verification.

The scenario selector in the preview toolbar supports populated, single vehicle, empty account, missing dates, expired inspection, loading, offline, loading error and long-name examples. It is a design-review control outside the app UI. Error recovery resets to sample data. Offline and loading are deliberately simulated presentations, not backend or persistence behavior.

The review pass preserves the original personal navigation, including direct tab access while the side drawer is open. Task dialogs become bottom sheets at mobile widths. Registration/inspection and insurance dates are both visible. See `docs/home-mockup-design-review.md` for before/after measurements and remaining device validation.

The final polish aligns inspection and insurance into labeled columns alongside the editable meter, uses consistent image crops and text sizes, and refines empty states and task sheets. Input values use 16px text to avoid focus zoom on iOS; this still needs verification on a physical device.

The compact lookup places submission beside the plate and scanning beside the section title. At 390×844 the first vehicle starts at 447px, and the second vehicle's photo, name and plate are visible without scrolling. Run `node design-lab/check-compact.mjs` for eight-digit plate fit at 320/390, scan-to-lookup interaction, and second-vehicle visibility checks.
