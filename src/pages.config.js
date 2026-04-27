/**
 * pages.config.js - Page routing configuration
 * Heavy pages are lazy-loaded to reduce initial bundle size.
 */
import React from 'react';
// Dashboard stays eager: it's the landing route. Lazy-loading it would
// flash the suspense spinner on every fresh tab/PWA launch.
import Dashboard from './pages/Dashboard';
import __Layout from './Layout.jsx';

// AuthPage / Vehicles / VehicleDetail used to be eager too, which dragged
// ~2300 lines of page code (and their lucide-react / form / supabase
// imports) into the entry chunk before the user saw anything. Authed
// users on Dashboard have to download 870 lines of AuthPage they will
// never see; logged-out users have to download Vehicles + VehicleDetail.
// Splitting these into lazy chunks shrinks the initial bundle so the
// landing render (Dashboard) starts paint earlier.
const AuthPage = React.lazy(() => import('./pages/AuthPage'));
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
}

export const pagesConfig = {
    mainPage: "Auth",
    Pages: PAGES,
    Layout: __Layout,
};
