/**
 * pages.config.js - Page routing configuration
 * Heavy pages are lazy-loaded to reduce initial bundle size.
 */
import React from 'react';
// Dashboard and AuthPage stay eager.
//
// AuthPage is also eager because it's the actual landing route
// (`mainPage: "Auth"` below). On iOS Capacitor + WKWebView, dynamic
// `import()` for the very first lazy chunk after cold launch was
// observed to hang indefinitely on iPadOS/iOS 26 — the Suspense
// fallback (white screen with spinner) would never resolve. Making
// the landing page eager guarantees there is never a cold-start
// dynamic import; the user gets straight to the auth UI as soon as
// React mounts. The cost is ~24 KB added to the initial bundle,
// which is well worth eliminating a class of "app stuck loading"
// bugs that App Review repeatedly flagged as Guideline 2.1(a).
import Dashboard from './pages/Dashboard';
import AuthPage from './pages/AuthPage';
import __Layout from './Layout.jsx';

// Vehicles / VehicleDetail are still lazy: they're not the landing
// route, the user has to navigate to them, so a brief Suspense
// fallback during navigation is acceptable. The new
// SuspenseFallback in App.jsx auto-reloads after 8s if a chunk
// genuinely hangs, so even a worst-case dynamic-import bug here
// recovers automatically rather than trapping the user forever.
const Vehicles = React.lazy(() => import('./pages/Vehicles'));
const VehicleDetail = React.lazy(() => import('./pages/VehicleDetail'));

// Lazy-loaded pages. loaded on demand when navigated to
const Community = React.lazy(() => import('./pages/Community'));
const DeleteAccount = React.lazy(() => import('./pages/DeleteAccount'));
const PrivacyPolicy = React.lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = React.lazy(() => import('./pages/TermsOfService'));
const AddVehicle = React.lazy(() => import('./pages/AddVehicle'));
const EditVehicle = React.lazy(() => import('./pages/EditVehicle'));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const FindGarage = React.lazy(() => import('./pages/FindGarage'));
const Documents = React.lazy(() => import('./pages/Documents'));
const Accidents = React.lazy(() => import('./pages/Accidents'));
const AddAccident = React.lazy(() => import('./pages/AddAccident'));
const AccountSettings = React.lazy(() => import('./pages/AccountSettings'));
const AdminReviews = React.lazy(() => import('./pages/AdminReviews'));
const DemoVehicleDetail = React.lazy(() => import('./pages/DemoVehicleDetail'));
const JoinInvite = React.lazy(() => import('./pages/JoinInvite'));
const MaintenanceTemplates = React.lazy(() => import('./pages/MaintenanceTemplates'));
const Notifications = React.lazy(() => import('./pages/Notifications'));
const ReminderSettingsPage = React.lazy(() => import('./pages/ReminderSettingsPage'));
const RepairTypes = React.lazy(() => import('./pages/RepairTypes'));
const UserProfile = React.lazy(() => import('./pages/UserProfile'));
const AiAssistant = React.lazy(() => import('./pages/AiAssistant'));
const Contact = React.lazy(() => import('./pages/Contact'));
const Settings = React.lazy(() => import('./pages/Settings'));
const EmailCenter = React.lazy(() => import('./pages/EmailCenter'));
const NotificationPreferences = React.lazy(() => import('./pages/NotificationPreferences'));
const ChecklistHub = React.lazy(() => import('./pages/ChecklistHub'));
const Checklist = React.lazy(() => import('./pages/Checklist'));
const ChecklistEditor = React.lazy(() => import('./pages/ChecklistEditor'));
const ChecklistHistory = React.lazy(() => import('./pages/ChecklistHistory'));
const AdminAiSettings = React.lazy(() => import('./pages/AdminAiSettings'));
const CreateBusinessWorkspace = React.lazy(() => import('./pages/CreateBusinessWorkspace'));
const Routes_           = React.lazy(() => import('./pages/Routes'));
const CreateRoute       = React.lazy(() => import('./pages/CreateRoute'));
const RouteDetail       = React.lazy(() => import('./pages/RouteDetail'));
const ActivityLog       = React.lazy(() => import('./pages/ActivityLog'));
const Expenses          = React.lazy(() => import('./pages/Expenses'));
const MyExpenses        = React.lazy(() => import('./pages/MyExpenses'));
const Reports           = React.lazy(() => import('./pages/Reports'));
const Drivers           = React.lazy(() => import('./pages/Drivers'));
const AdminBusinessRequests = React.lazy(() => import('./pages/AdminBusinessRequests'));
const Fleet                 = React.lazy(() => import('./pages/Fleet'));
const BusinessDashboard     = React.lazy(() => import('./pages/BusinessDashboard'));
const BusinessSettings      = React.lazy(() => import('./pages/BusinessSettings'));
const MyVehicles            = React.lazy(() => import('./pages/MyVehicles'));
const BulkAddVehicles       = React.lazy(() => import('./pages/BulkAddVehicles'));
const Team                  = React.lazy(() => import('./pages/Team'));
const DrivingLog            = React.lazy(() => import('./pages/DrivingLog'));
const VehicleCheck          = React.lazy(() => import('./pages/VehicleCheck'));
// /dev/components — design system style guide. No auth, no chrome.
// Safe to ship; intentionally not surfaced in any nav (URL-only access).
const DevComponents         = React.lazy(() => import('./pages/DevComponents'));

export const PAGES = {
    "Accidents": Accidents,
    "AccountSettings": AccountSettings,
    "AiAssistant": AiAssistant,
    "AddAccident": AddAccident,
    "Auth": AuthPage,
    "Community": Community,
    "Contact": Contact,
    "DeleteAccount": DeleteAccount,
    "PrivacyPolicy": PrivacyPolicy,
    "TermsOfService": TermsOfService,
    "AddVehicle": AddVehicle,
    "AdminReviews": AdminReviews,
    "AdminDashboard": AdminDashboard,
    "Dashboard": Dashboard,
    "DemoVehicleDetail": DemoVehicleDetail,
    "Documents": Documents,
    "EditVehicle": EditVehicle,
    "FindGarage": FindGarage,
    "JoinInvite": JoinInvite,
    "MaintenanceTemplates": MaintenanceTemplates,
    "Notifications": Notifications,
    "ReminderSettingsPage": ReminderSettingsPage,
    "RepairTypes": RepairTypes,
    "UserProfile": UserProfile,
    "VehicleDetail": VehicleDetail,
    "Vehicles": Vehicles,
    "Settings": Settings,
    "EmailCenter": EmailCenter,
    "NotificationPreferences": NotificationPreferences,
    "ChecklistHub": ChecklistHub,
    "Checklist": Checklist,
    "ChecklistEditor": ChecklistEditor,
    "ChecklistHistory": ChecklistHistory,
    "AdminAiSettings": AdminAiSettings,
    "CreateBusinessWorkspace": CreateBusinessWorkspace,
    "Routes":       Routes_,
    "CreateRoute":  CreateRoute,
    "RouteDetail":  RouteDetail,
    "ActivityLog":  ActivityLog,
    "Expenses":     Expenses,
    "MyExpenses":   MyExpenses,
    "Reports":      Reports,
    "Drivers":      Drivers,
    "AdminBusinessRequests": AdminBusinessRequests,
    "Fleet":        Fleet,
    "BusinessDashboard": BusinessDashboard,
    "BusinessSettings": BusinessSettings,
    "MyVehicles":   MyVehicles,
    "BulkAddVehicles": BulkAddVehicles,
    "Team":         Team,
    "DrivingLog":   DrivingLog,
    "vehicle-check": VehicleCheck,
    // Design system style guide. URL is /dev/components.
    // The slash in the path is fine here because the route entry is
    // wrapped in `/${path}` by App.jsx, and react-router accepts /a/b
    // form natively. Kept lower-case-with-slash so it visually
    // distinguishes itself from the user-facing PascalCase pages.
    "dev/components": DevComponents,
}

export const pagesConfig = {
    mainPage: "Auth",
    Pages: PAGES,
    Layout: __Layout,
};
