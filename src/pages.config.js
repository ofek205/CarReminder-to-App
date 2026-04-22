/**
 * pages.config.js - Page routing configuration
 * Heavy pages are lazy-loaded to reduce initial bundle size.
 */
import React from 'react';
import Dashboard from './pages/Dashboard';
import AuthPage from './pages/AuthPage';
import VehicleDetail from './pages/VehicleDetail';
import Vehicles from './pages/Vehicles';
import __Layout from './Layout.jsx';

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
}

export const pagesConfig = {
    mainPage: "Auth",
    Pages: PAGES,
    Layout: __Layout,
};
