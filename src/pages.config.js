/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Accidents from './pages/Accidents';
import AccountSettings from './pages/AccountSettings';
import AddAccident from './pages/AddAccident';
import AuthPage from './pages/AuthPage';
import AddVehicle from './pages/AddVehicle';
import AdminReviews from './pages/AdminReviews';
import AdminDashboard from './pages/AdminDashboard';
import Dashboard from './pages/Dashboard';
import DemoVehicleDetail from './pages/DemoVehicleDetail';
import Documents from './pages/Documents';
import EditVehicle from './pages/EditVehicle';
import FindGarage from './pages/FindGarage';
import JoinInvite from './pages/JoinInvite';
import MaintenanceTemplates from './pages/MaintenanceTemplates';
import Notifications from './pages/Notifications';
import ReminderSettingsPage from './pages/ReminderSettingsPage';
import RepairTypes from './pages/RepairTypes';
import UserProfile from './pages/UserProfile';
import VehicleDetail from './pages/VehicleDetail';
import Vehicles from './pages/Vehicles';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Accidents": Accidents,
    "AccountSettings": AccountSettings,
    "AddAccident": AddAccident,
    "Auth": AuthPage,
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
}

export const pagesConfig = {
    mainPage: "Auth",
    Pages: PAGES,
    Layout: __Layout,
};