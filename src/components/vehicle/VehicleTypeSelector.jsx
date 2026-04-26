import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Check, Car, Truck, Ship, Star, Bike, Mountain, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTheme } from '@/lib/designTokens';

//  Sub-categories for "כלי שייט" 
export const BOAT_SUBCATEGORIES = [
  { label: 'מפרשית',       dbName: 'מפרשית',       usageMetric: 'שעות מנוע' },
  { label: 'מנועית',       dbName: 'סירה מנועית',  usageMetric: 'שעות מנוע' },
  { label: 'אופנוע ים',   dbName: 'אופנוע ים',    usageMetric: 'שעות מנוע' },
  { label: 'סירת גומי',   dbName: 'סירת גומי',    usageMetric: 'שעות מנוע' },
];

//  Sub-categories for "אופנועים" (כולל אופנוע שטח) 
export const MOTO_SUBCATEGORIES = [
  { label: 'אופנוע כביש',  dbName: 'אופנוע כביש',  usageMetric: 'קילומטרים' },
  { label: 'קטנוע',        dbName: 'קטנוע',         usageMetric: 'קילומטרים' },
  { label: 'אופנוע שטח',  dbName: 'אופנוע שטח',   usageMetric: 'קילומטרים' },
];

//  Sub-categories for "מיוחדים"
//  מלגזה ורכב צמ"ה הועברו לקטגוריה החדשה "כלי צמ"ה". טרקטור ומחרשה
//  נשארים כאן כי הם בעיקר חקלאות (לא ציוד מכני הנדסי).
export const SPECIAL_SUBCATEGORIES = [
  { label: 'רכב אספנות',                   dbName: 'רכב אספנות',                    usageMetric: 'קילומטרים' },
  { label: 'טרקטור',                        dbName: 'טרקטור',                         usageMetric: 'שעות מנוע'  },
  { label: 'רכבים תפעוליים',               dbName: 'רכב תפעולי',                    usageMetric: 'קילומטרים' },
  { label: 'נגררים, גרורים ונתמכים',       dbName: 'נגרר',                           usageMetric: 'ללא'        },
  { label: 'קראוונים ממונעים ונגררים',     dbName: 'קרוואן',                         usageMetric: 'קילומטרים' },
  { label: 'מחרשה',                         dbName: 'מחרשה',                          usageMetric: 'שעות מנוע'  },
  { label: 'אוטובוס ומיניבוס',             dbName: 'אוטובוס',                        usageMetric: 'קילומטרים' },
];

//  Sub-categories for "כלי צמ"ה" (Construction Machinery)
//  26 subtypes grouped by family (excavators / bulldozers / loaders /
//  forklifts / rollers / concrete / cranes / drilling). Labels are
//  pure types — the parent category name "כלי צמ"ה" is already shown
//  in the breadcrumb above the chips, so prefixing every chip with
//  "צמ"ה - " was redundant. label === dbName here keeps the chips
//  scannable and matches what the user sees later on the vehicle
//  detail card.
//  All items meter by 'שעות מנוע' — heavy equipment is hour-based
//  even on wheeled chassis (loaders, telehandlers, mobile cranes).
export const CME_SUBCATEGORIES = [
  // Excavators
  { label: 'מחפר',          dbName: 'מחפר',          usageMetric: 'שעות מנוע' },
  { label: 'מחפר זחלי',     dbName: 'מחפר זחלי',     usageMetric: 'שעות מנוע' },
  { label: 'מחפר אופני',    dbName: 'מחפר אופני',    usageMetric: 'שעות מנוע' },
  { label: 'מיני מחפר',     dbName: 'מיני מחפר',     usageMetric: 'שעות מנוע' },
  { label: 'מחפרון',         dbName: 'מחפרון',         usageMetric: 'שעות מנוע' },
  // Bulldozers
  { label: 'דחפור',         dbName: 'דחפור',         usageMetric: 'שעות מנוע' },
  { label: 'דחפור זחלי',    dbName: 'דחפור זחלי',    usageMetric: 'שעות מנוע' },
  // Loaders
  { label: 'שופל',          dbName: 'שופל',          usageMetric: 'שעות מנוע' },
  { label: 'מעמיס אופני',   dbName: 'מעמיס אופני',   usageMetric: 'שעות מנוע' },
  { label: 'מעמיס זחלי',    dbName: 'מעמיס זחלי',    usageMetric: 'שעות מנוע' },
  { label: 'מיני מעמיס',    dbName: 'מיני מעמיס',    usageMetric: 'שעות מנוע' },
  // Skid steer
  { label: 'בובקט',         dbName: 'בובקט',         usageMetric: 'שעות מנוע' },
  // Telehandlers / forklifts
  { label: 'טליהנדלר',      dbName: 'טליהנדלר',      usageMetric: 'שעות מנוע' },
  { label: 'מלגזה',         dbName: 'מלגזה',         usageMetric: 'שעות מנוע' },
  { label: 'מלגזת שטח',     dbName: 'מלגזת שטח',     usageMetric: 'שעות מנוע' },
  // Graders
  { label: 'מפלסת',         dbName: 'מפלסת',         usageMetric: 'שעות מנוע' },
  // Compactors / rollers
  { label: 'מכבש',          dbName: 'מכבש',          usageMetric: 'שעות מנוע' },
  { label: 'מכבש אספלט',    dbName: 'מכבש אספלט',    usageMetric: 'שעות מנוע' },
  { label: 'מכבש קרקע',     dbName: 'מכבש קרקע',     usageMetric: 'שעות מנוע' },
  // Concrete
  { label: 'מערבל בטון',    dbName: 'מערבל בטון',    usageMetric: 'שעות מנוע' },
  { label: 'משאבת בטון',    dbName: 'משאבת בטון',    usageMetric: 'שעות מנוע' },
  // Cranes
  { label: 'מנוף',          dbName: 'מנוף',          usageMetric: 'שעות מנוע' },
  { label: 'מנוף נייד',     dbName: 'מנוף נייד',     usageMetric: 'שעות מנוע' },
  { label: 'מנוף זחלי',     dbName: 'מנוף זחלי',     usageMetric: 'שעות מנוע' },
  // Drilling
  { label: 'מקדח קרקע',     dbName: 'מקדח קרקע',     usageMetric: 'שעות מנוע' },
  { label: 'ציוד קידוח',    dbName: 'ציוד קידוח',    usageMetric: 'שעות מנוע' },
];

//  Sub-categories for "כלי שטח" (כולל אופנוע שטח וטרקטורון) 
export const OFFROAD_SUBCATEGORIES = [
  { label: "ג'יפ שטח",       dbName: "ג'יפ שטח",       usageMetric: 'קילומטרים' },
  { label: 'טרקטורון',       dbName: 'טרקטורון',        usageMetric: 'קילומטרים' },
  { label: 'אופנוע שטח',    dbName: 'אופנוע שטח',     usageMetric: 'קילומטרים' },
  { label: 'RZR / באגי',     dbName: 'RZR',             usageMetric: 'שעות מנוע' },
  { label: "ריינג'ר / מיול", dbName: 'מיול',            usageMetric: 'שעות מנוע' },
  { label: 'באגי חולות',     dbName: 'באגי חולות',      usageMetric: 'קילומטרים' },
];

//  Off-road equipment & usage type options 
export const OFFROAD_EQUIPMENT = [
  { key: 'winch',               label: 'כננת' },
  { key: 'snorkel',             label: 'שנורקל' },
  { key: 'offroad_tires',       label: 'גלגלי שטח' },
  { key: 'underbody_armor',     label: 'מיגון תחתון' },
  { key: 'upgraded_suspension', label: 'מתלים מוגברים' },
  { key: 'roof_rack',           label: 'גגון' },
  { key: 'offroad_lights',      label: 'תאורת שטח' },
  { key: 'offroad_spare',       label: 'גלגל רזרבי שטח' },
];

export const OFFROAD_USAGE_TYPES = [
  { value: 'sand',        label: 'שטח חולות' },
  { value: 'rocky',       label: 'שטח סלעי' },
  { value: 'trails',      label: 'טיולים' },
  { value: 'agriculture', label: 'חקלאות' },
  { value: 'sport',       label: 'ספורט' },
  { value: 'general',     label: 'שימוש כללי' },
];

//  Manufacturers per sub-category (for non-car categories) 
export const MANUFACTURERS_BY_SUBCATEGORY = {
  'אופנוע כביש':  ['Honda', 'Yamaha', 'SYM', 'Kawasaki', 'Suzuki', 'KTM', 'BMW Motorrad', 'Ducati', 'Harley-Davidson', 'Triumph', 'Royal Enfield', 'Aprilia'],
  'אופנוע שטח':   ['KTM', 'Husqvarna', 'Honda', 'Yamaha', 'Kawasaki', 'Suzuki', 'GasGas', 'Beta', 'Sherco', 'TM Racing', 'Fantic'],
  'קטנוע':        ['Honda', 'Yamaha', 'SYM', 'Kymco', 'Vespa', 'Aprilia', 'Suzuki', 'Kawasaki', 'Peugeot'],
  'מפרשית':       ['Beneteau', 'Jeanneau', 'Bavaria', 'Dufour', 'Hanse', 'Catalina', 'Hunter', 'Hallberg-Rassy', 'Oyster', 'Swan', 'Dehler', 'J/Boats'],
  'סירה מנועית':  ['Beneteau', 'Sea Ray', 'Boston Whaler', 'Bayliner', 'Chaparral', 'Jeanneau', 'Yamaha', 'Grady-White', 'Sunseeker', 'Riva', 'MasterCraft', 'Cobalt'],
  'אופנוע ים':    ['Sea-Doo', 'Yamaha', 'Kawasaki'],
  'סירת גומי':    ['Zodiac', 'Highfield', 'BRIG', 'AB Inflatables', 'Avon', 'Pirelli', 'Zar Formenti', 'Capelli', 'Walker Bay'],
  'טרקטורון':     ['Can-Am', 'Yamaha', 'Honda', 'Polaris', 'Kawasaki', 'Suzuki', 'CFMOTO', 'Arctic Cat', 'Linhai'],
  'טרקטור':       ['John Deere', 'New Holland', 'Case IH', 'Massey Ferguson', 'Kubota', 'Fendt', 'Deutz-Fahr', 'Claas', 'Valtra', 'Mahindra', 'Landini'],
  'מלגזה':        ['Toyota', 'Linde', 'Jungheinrich', 'Crown', 'Hyster', 'Yale', 'Komatsu', 'Mitsubishi', 'Nissan', 'Clark'],
  // ── כלי צמ"ה manufacturers (per subtype) ────────────────────────
  // Sourced from Israeli rental-fleet roster + global market leaders
  // for each segment. Lists are intentionally short (8-12) so the
  // dropdown stays scannable; there's always a free-text fallback.
  // Excavators
  'מחפר':         ['Caterpillar', 'Komatsu', 'Hitachi', 'Volvo', 'Hyundai', 'Doosan', 'JCB', 'Liebherr', 'Case', 'Kobelco'],
  'מחפר זחלי':    ['Caterpillar', 'Komatsu', 'Hitachi', 'Volvo', 'Hyundai', 'Doosan', 'Liebherr', 'Kobelco', 'Sany', 'XCMG'],
  'מחפר אופני':   ['Caterpillar', 'Volvo', 'Hitachi', 'Hyundai', 'Atlas', 'Liebherr', 'JCB', 'Case', 'Doosan', 'Mecalac'],
  'מיני מחפר':    ['Yanmar', 'Bobcat', 'Caterpillar', 'Komatsu', 'Kubota', 'Takeuchi', 'JCB', 'Volvo', 'Hitachi', 'Wacker Neuson'],
  'מחפרון':        ['JCB', 'Caterpillar', 'Case', 'New Holland', 'Komatsu', 'Volvo', 'Mecalac', 'Hidromek'],
  // Bulldozers
  'דחפור':         ['Caterpillar', 'Komatsu', 'John Deere', 'Case', 'Liebherr', 'Dressta', 'Shantui', 'XCMG'],
  'דחפור זחלי':    ['Caterpillar', 'Komatsu', 'John Deere', 'Case', 'Liebherr', 'Dressta', 'Shantui'],
  // Loaders
  'שופל':          ['Caterpillar', 'Volvo', 'Komatsu', 'Case', 'JCB', 'Hyundai', 'Doosan', 'Liebherr', 'New Holland', 'XCMG'],
  'מעמיס אופני':   ['Caterpillar', 'Volvo', 'Komatsu', 'Case', 'JCB', 'Hyundai', 'Doosan', 'Liebherr', 'New Holland'],
  'מעמיס זחלי':    ['Caterpillar', 'Komatsu', 'Liebherr', 'John Deere', 'Case'],
  'מיני מעמיס':    ['Bobcat', 'Caterpillar', 'Case', 'Kubota', 'JCB', 'Volvo', 'Wacker Neuson', 'Takeuchi', 'New Holland'],
  // Skid steer
  'בובקט':         ['Bobcat', 'Caterpillar', 'Case', 'Kubota', 'JCB', 'Volvo', 'Wacker Neuson', 'New Holland'],
  // Telehandlers / forklifts
  'טליהנדלר':      ['JCB', 'Manitou', 'Bobcat', 'Genie', 'Caterpillar', 'Merlo', 'Magni', 'Haulotte', 'Dieci'],
  'מלגזת שטח':     ['JCB', 'Manitou', 'Caterpillar', 'Bobcat', 'Toyota', 'Hyster'],
  // Graders
  'מפלסת':         ['Caterpillar', 'Komatsu', 'John Deere', 'Volvo', 'XCMG', 'Sany', 'New Holland', 'Case'],
  // Compactors / rollers
  'מכבש':          ['Bomag', 'Hamm', 'Dynapac', 'Caterpillar', 'Volvo', 'Wirtgen', 'JCB', 'Ammann', 'Wacker Neuson'],
  'מכבש אספלט':    ['Bomag', 'Hamm', 'Dynapac', 'Caterpillar', 'Volvo', 'Wirtgen', 'Ammann'],
  'מכבש קרקע':     ['Bomag', 'Hamm', 'Dynapac', 'Caterpillar', 'Volvo', 'Ammann', 'Wacker Neuson', 'Sakai'],
  // Concrete
  'מערבל בטון':    ['Mercedes-Benz', 'Volvo', 'Iveco', 'MAN', 'Scania', 'Renault', 'DAF', 'Putzmeister', 'Liebherr'],
  'משאבת בטון':    ['Putzmeister', 'Schwing', 'Sany', 'Zoomlion', 'CIFA', 'Liebherr', 'KCP'],
  // Cranes
  'מנוף':          ['Liebherr', 'Tadano', 'Grove', 'Manitowoc', 'Terex', 'Demag', 'Sany', 'XCMG', 'Kobelco', 'Link-Belt'],
  'מנוף נייד':     ['Liebherr', 'Tadano', 'Grove', 'Demag', 'Terex', 'Sany', 'XCMG', 'Kato'],
  'מנוף זחלי':     ['Liebherr', 'Manitowoc', 'Kobelco', 'Sany', 'XCMG', 'Hitachi', 'Terex', 'Link-Belt'],
  // Drilling
  'מקדח קרקע':     ['Soilmec', 'Bauer', 'Casagrande', 'Liebherr', 'IMT', 'Atlas Copco', 'Sandvik'],
  'ציוד קידוח':    ['Soilmec', 'Bauer', 'Casagrande', 'Liebherr', 'IMT', 'Atlas Copco', 'Sandvik', 'Epiroc'],
  'אוטובוס':      ['Volvo', 'Mercedes-Benz', 'MAN', 'Scania', 'Iveco', 'Isuzu', 'Temsa', 'Otokar', 'Yutong', 'King Long'],
  'קרוואן':       ['Knaus', 'Hobby', 'Adria', 'Airstream', 'Bürstner', 'Weinsberg', 'Bailey', 'Trigano', 'Caravelair'],
  'רכב אספנות':   ['Ferrari', 'Porsche', 'Jaguar', 'Ford', 'Chevrolet', 'Mercedes-Benz', 'Aston Martin', 'Lamborghini', 'Alfa Romeo', 'BMW', 'Triumph', 'MG'],
  'משאית':        ['Mercedes-Benz', 'Volvo', 'Scania', 'MAN', 'DAF', 'Iveco', 'Renault', 'Ford', 'Isuzu', 'Mitsubishi Fuso'],
  "ג'יפ שטח":     ['Jeep', 'Toyota', 'Land Rover', 'Suzuki', 'Mitsubishi', 'Nissan', 'Ford', 'Mercedes-Benz', 'Isuzu'],
  'טרקטורון שטח': ['Can-Am', 'Yamaha', 'Honda', 'Polaris', 'Kawasaki', 'Suzuki', 'CFMOTO', 'Arctic Cat', 'Linhai'],
  'RZR':           ['Polaris', 'Can-Am', 'Yamaha', 'Honda', 'Kawasaki', 'CFMOTO', 'Arctic Cat', 'Segway'],
  'מיול':          ['Polaris', 'Kawasaki', 'Can-Am', 'John Deere', 'Kubota', 'Honda', 'Yamaha', 'CFMOTO'],
  'באגי חולות':    ['Polaris', 'Can-Am', 'Yamaha', 'Arctic Cat', 'Kawasaki', 'CFMOTO'],
};

//  The 6 main categories (fixed, maps to DB by keyword) 
export const VEHICLE_CATEGORIES = [
  {
    label: 'פרטיים ומסחריים',
    icon: Car,
    keywords: ['רכב', 'פרטי', 'מסחרי', 'ג\'יפ', 'SUV'],
    dbName: 'רכב',
    usageMetric: 'קילומטרים',
    methods: ['plate', 'scan', 'manual'],
  },
  {
    label: 'אופנועים',
    icon: Bike,
    keywords: ['אופנוע', 'קטנוע'],
    dbName: 'אופנוע',
    usageMetric: 'קילומטרים',
    methods: ['plate', 'scan', 'manual'],
    hasSubcategories: true,
  },
  {
    label: 'משאיות',
    icon: Truck,
    keywords: ['משאית', 'טנדר', 'רכב מסחרי'],
    dbName: 'משאית',
    usageMetric: 'קילומטרים',
    methods: ['plate', 'scan', 'manual'],
  },
  {
    label: 'כלי שייט',
    icon: Ship,
    keywords: ['שייט', 'ספינה', 'סירה', 'יאכטה'],
    dbName: 'כלי שייט',
    usageMetric: 'שעות מנוע',
    methods: ['scan', 'manual'],
    hasSubcategories: true,
  },
  {
    label: 'כלי שטח',
    icon: Mountain,
    keywords: ['שטח', "ג'יפ", 'טרקטורון', 'באגי', 'RZR'],
    dbName: 'כלי שטח',
    usageMetric: 'קילומטרים',
    // 'plate' added so jeeps (which carry standard IL license plates and
    // are queryable via gov.il) can use the auto-fill flow. ATVs / buggies
    // typically aren't on the registry, so the lookup may return empty —
    // the user can still type a plate manually and proceed; the
    // type-mismatch check is already disabled for this category in
    // AddVehicle.expectedTypesForCategory().
    methods: ['plate', 'scan', 'manual'],
    hasSubcategories: true,
  },
  {
    label: 'כלי צמ"ה',
    icon: Wrench,
    keywords: ['צמ"ה', 'מלגזה', 'מחפר', 'מכבש', 'יעה', 'טלסקופי', 'הייסטר', 'בולדוזר', 'ציוד מכני הנדסי'],
    dbName: 'רכב צמ"ה',
    usageMetric: 'שעות מנוע',
    // Plate lookup tries the heavy gov.il dataset first; some
    // forklifts/loaders carry standard IL plates. Off-registry
    // machines (yard-only equipment) fall through to manual entry
    // — same pattern as the מיוחדים tier.
    methods: ['plate', 'scan', 'manual'],
    hasSubcategories: true,
  },
  {
    // "מיוחדים" lives last on purpose — it's the catch-all bucket
    // for everything that didn't fit a primary category (collectors,
    // tractors, trailers, buses, plows, motor caravans). Keeping it
    // last in the chip grid makes it read as "didn't find what you
    // need above? try here", rather than competing with the precise
    // categories for a tap.
    label: 'מיוחדים',
    icon: Star,
    keywords: ['מיוחד', 'טרקטור', 'קלנוע', 'אחר'],
    dbName: 'רכב מיוחד',
    usageMetric: 'קילומטרים',
    // 'plate' added once the heavy-vehicle gov.il API was wired in
    // (resource cd3acc5c-…). Trailers (גרור), buses (אוטובוס), tractors
    // (טרקטור), forklifts (מלגזה) and motor caravans all carry standard
    // IL plates and are now queryable via lookupVehicleByPlate's heavy
    // tier. If a particular subtype isn't in the registry the lookup
    // simply returns null and the user falls through to manual entry —
    // identical to the כלי שטח flow.
    methods: ['plate', 'scan', 'manual'],
    hasSubcategories: true,
  },
];

//  Local vehicle types (no DB dependency) 
const LOCAL_VEHICLE_TYPES = [
  //  רכב 
  { id: 'vt-car',       name: 'רכב',             usage_metric: 'קילומטרים',  scope: 'global' },
  //  אופנועים (כביש בלבד) 
  { id: 'vt-moto-road', name: 'אופנוע כביש',    usage_metric: 'קילומטרים',  scope: 'global' },
  { id: 'vt-scooter',   name: 'קטנוע',           usage_metric: 'קילומטרים',  scope: 'global' },
  //  משאיות 
  { id: 'vt-truck',     name: 'משאית',           usage_metric: 'קילומטרים',  scope: 'global' },
  //  כלי שייט 
  { id: 'vt-sail',      name: 'מפרשית',          usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-motor',     name: 'סירה מנועית',     usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-jetski',    name: 'אופנוע ים',       usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-dinghy',    name: 'סירת גומי',       usage_metric: 'שעות מנוע',  scope: 'global' },
  //  כלי שטח (אופנוע שטח + טרקטורון כאן בלבד) 
  { id: 'vt-jeep-off',  name: "ג'יפ שטח",       usage_metric: 'קילומטרים',  scope: 'global' },
  { id: 'vt-atv',       name: 'טרקטורון',        usage_metric: 'קילומטרים',  scope: 'global' },
  { id: 'vt-moto-off',  name: 'אופנוע שטח',     usage_metric: 'קילומטרים',  scope: 'global' },
  { id: 'vt-rzr',       name: 'RZR',             usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-mule',      name: 'מיול',            usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-dunebuggy', name: 'באגי חולות',      usage_metric: 'קילומטרים',  scope: 'global' },
  //  מיוחדים 
  { id: 'vt-vintage',   name: 'רכב אספנות',      usage_metric: 'קילומטרים',  scope: 'global' },
  { id: 'vt-tractor',   name: 'טרקטור',          usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-utility',   name: 'רכב תפעולי',      usage_metric: 'קילומטרים',  scope: 'global' },
  { id: 'vt-trailer',   name: 'נגרר',            usage_metric: 'ללא',        scope: 'global' },
  { id: 'vt-forklift',  name: 'מלגזה',           usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-heavy',     name: 'רכב צמ"ה',        usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-caravan',   name: 'קרוואן',          usage_metric: 'קילומטרים',  scope: 'global' },
  { id: 'vt-plow',      name: 'מחרשה',           usage_metric: 'שעות מנוע',  scope: 'global' },
  { id: 'vt-bus',       name: 'אוטובוס',         usage_metric: 'קילומטרים',  scope: 'global' },
];

// Find the best matching type for a category
function findLocalType(category) {
  return LOCAL_VEHICLE_TYPES.find(t =>
    category.keywords.some(kw => t.name.toLowerCase().includes(kw.toLowerCase()))
  ) || LOCAL_VEHICLE_TYPES.find(t => t.name === category.dbName);
}

//  Tab-strip variant (used in AddVehicle) 
function TabVariant({ selectedCategory, onSelectCategory }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {VEHICLE_CATEGORIES.map(cat => {
        const Icon = cat.icon;
        const active = selectedCategory?.label === cat.label;
        const T = getTheme(cat.dbName);
        return (
          <button
            key={cat.label}
            type="button"
            onClick={() => onSelectCategory(cat)}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl border-2 transition-all duration-200 focus:outline-none select-none',
              !active && 'border-gray-200 bg-white hover:border-[#8B5E3C] hover:bg-[#FBF5EF] active:scale-95'
            )}
            style={active ? { borderColor: T.primary, background: T.light, boxShadow: `0 4px 12px ${T.primary}20` } : undefined}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: active ? T.primary : '#F3F4F6' }}>
              <Icon className={cn('h-4 w-4', active ? 'text-white' : 'text-gray-500')} />
            </div>
            <span className="text-[10px] sm:text-xs font-semibold text-center leading-tight"
              style={{ color: active ? T.primary : '#4B5563' }}>
              {cat.label}
            </span>
            {active && (
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: T.primary }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

//  Cards variant (horizontal scroll) 
function CardVariant({ value, onChange }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
      {LOCAL_VEHICLE_TYPES.map(type => {
        const selected = value === type.id;
        return (
          <button
            key={type.id}
            type="button"
            onClick={() => onChange(type.id, type.name, type.usage_metric)}
            className={cn(
              'flex flex-col items-center gap-1.5 min-w-[72px] max-w-[80px] px-2 py-3 rounded-2xl border-2 transition-all duration-200 shrink-0',
              selected ? 'border-[#2D5233] bg-[#E8F2EA] shadow-md' : 'border-gray-200 bg-white hover:border-gray-300'
            )}
          >
            <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', selected ? 'bg-[#2D5233]' : 'bg-gray-100')}>
              <Car className={cn('h-5 w-5', selected ? 'text-white' : 'text-gray-500')} />
            </div>
            <span className={cn('text-[11px] font-semibold text-center leading-tight', selected ? 'text-[#2D5233]' : 'text-gray-600')}>
              {type.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

//  Main component 
export default function VehicleTypeSelector({
  value,
  onChange,
  accountId,
  variant = 'popover',
  selectedCategory,
  onSelectCategory,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const allTypes = LOCAL_VEHICLE_TYPES;
  const filteredTypes = allTypes.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  const selectedType = allTypes.find(t => t.id === value);

  //  Tab variant: resolve type on category select 
  const handleCategorySelect = (cat) => {
    if (onSelectCategory) onSelectCategory(cat);
    if (cat.hasSubcategories) {
      // Don't set vehicle_type yet - wait for subcategory selection
      onChange('', cat.dbName, cat.usageMetric);
    } else {
      const localType = findLocalType(cat);
      if (localType) {
        onChange(localType.id, localType.name, localType.usage_metric);
      } else {
        onChange('', cat.dbName, cat.usageMetric);
      }
    }
  };

  //  Render 
  if (variant === 'tabs') {
    return (
      <TabVariant
        selectedCategory={selectedCategory}
        onSelectCategory={handleCategorySelect}
      />
    );
  }

  if (variant === 'cards') {
    return (
      <CardVariant
        value={value}
        onChange={onChange}
      />
    );
  }

  //  Default: popover 
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
          {selectedType ? selectedType.name : "בחר סוג כלי רכב..."}
          <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" dir="rtl">
        <Command shouldFilter={false}>
          <CommandInput placeholder="חפש סוג כלי..." value={search} onValueChange={setSearch} />
          <CommandList>
            {filteredTypes.length === 0 ? (
              <CommandEmpty>
                <div className="py-6 text-center">
                  <p className="text-sm text-gray-500">לא נמצא סוג מתאים</p>
                </div>
              </CommandEmpty>
            ) : (
              <CommandGroup className="max-h-64 overflow-auto">
                {filteredTypes.map(type => (
                  <CommandItem key={type.id} value={type.name} onSelect={() => { onChange(type.id, type.name, type.usage_metric); setOpen(false); }}>
                    <Check className={cn("ml-2 h-4 w-4", value === type.id ? "opacity-100" : "opacity-0")} />
                    {type.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
