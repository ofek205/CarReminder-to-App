-- ==========================================================================
-- SEED — fake fleet data for the workspace "אופק רכבים בעם"
--
-- Generates a realistic factory/industrial fleet so the manager can
-- exercise /Reports, /DrivingLog, /Expenses with actual numbers.
--
-- Composition:
--   • 20 vehicles — mix of trucks, vans, forklifts, employee cars,
--                   a motorcycle, RZRs, and two heavy-equipment items.
--   • ~60 maintenance_logs (טיפולים) — periodic services with cost,
--                                       garage, mileage at service.
--   • ~28 repair_logs   (תיקונים)   — workshop visits with cost.
--   • ~115 vehicle_expenses        — fuel + insurance + repair + other,
--                                     spread across the last 18 months
--                                     so the monthly trend chart has
--                                     enough texture.
--
-- All inserts are idempotent (ON CONFLICT DO NOTHING) — safe to re-run.
-- Each vehicle has a deterministic UUID so the related rows can be
-- linked without a CTE chain.
--
-- WORKSPACE LOOKUP:
--   Resolves the account by name. If you renamed the workspace, change
--   the WHERE clause in the DO block at the top.
-- ==========================================================================

DO $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT id INTO v_account_id
    FROM public.accounts
   WHERE name = 'אופק רכבים בעם'
   LIMIT 1;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Workspace "אופק רכבים בעם" not found. Edit the WHERE clause if you renamed it.';
  END IF;

  RAISE NOTICE 'Seeding into account_id = %', v_account_id;
END $$;

-- ============================================================ VEHICLES
-- 20 vehicles. Deterministic UUIDs so we can reference them below
-- in maintenance / repair / expense inserts without CTE plumbing.
-- vehicle_type uses the Hebrew taxonomy the app expects.

INSERT INTO public.vehicles
  (id, account_id, vehicle_type, manufacturer, model, year, license_plate,
   nickname, current_km, test_due_date, insurance_due_date)
SELECT * FROM (VALUES
  -- ---- Delivery trucks (5) ----
  ('a0000001-0000-0000-0000-000000000001'::uuid, 'משאית', 'וולוו', 'FH 460',           2019, '12-345-67', 'משאית הצפון',   285000, current_date + 60, current_date + 30),
  ('a0000001-0000-0000-0000-000000000002'::uuid, 'משאית', 'מאן',   'TGS 26.440',       2021, '23-456-78', 'משאית מספר 2', 142000, current_date + 45, current_date + 90),
  ('a0000001-0000-0000-0000-000000000003'::uuid, 'משאית', 'סקניה', 'R450',             2018, '34-567-89', 'הסוס השחור',   312000, current_date - 5,  current_date + 120),
  ('a0000001-0000-0000-0000-000000000004'::uuid, 'משאית', 'דאף',   'XF 480',           2022, '45-678-90', NULL,            58000, current_date + 180, current_date + 200),
  ('a0000001-0000-0000-0000-000000000005'::uuid, 'משאית', 'איסוזו','NPR 75',           2020, '56-789-01', 'איסוזו לבנה',   91000, current_date + 100, current_date + 60),

  -- ---- Vans / commercial (5) ----
  ('a0000002-0000-0000-0000-000000000001'::uuid, 'מסחרי', 'מרצדס',   'ספרינטר 316',    2021, '67-890-12', 'ספרינטר אזור הצפון',  74000, current_date + 75,  current_date + 50),
  ('a0000002-0000-0000-0000-000000000002'::uuid, 'מסחרי', 'פולקסווגן','קראפטר',        2020, '78-901-23', 'קראפטר',                88000, current_date + 30,  current_date + 110),
  ('a0000002-0000-0000-0000-000000000003'::uuid, 'מסחרי', 'פורד',    'טרנזיט',          2019, '89-012-34', NULL,                   123000, current_date - 12,  current_date + 70),
  ('a0000002-0000-0000-0000-000000000004'::uuid, 'מסחרי', 'רנו',     'מאסטר',           2022, '90-123-45', 'מאסטר חלוקה',           41000, current_date + 220, current_date + 240),
  ('a0000002-0000-0000-0000-000000000005'::uuid, 'מסחרי', 'איווקו',  'דיילי',           2018, '01-234-56', 'דיילי הוותיקה',        165000, current_date + 18,  current_date + 25),

  -- ---- Forklifts (3) — vehicle_type "מלגזה" gets engine-hours treatment ----
  ('a0000003-0000-0000-0000-000000000001'::uuid, 'מלגזה', 'טויוטה', '8FGU25',           2019, '02-345-67', 'מלגזה מחסן 1',          NULL, NULL, current_date + 365),
  ('a0000003-0000-0000-0000-000000000002'::uuid, 'מלגזה', 'הייסטר', 'H3.0FT',           2020, '03-456-78', 'מלגזה מחסן 2',          NULL, NULL, current_date + 200),
  ('a0000003-0000-0000-0000-000000000003'::uuid, 'מלגזה', 'יילר',   'ERP 25',           2017, '04-567-89', NULL,                     NULL, NULL, current_date - 30),

  -- ---- Employee cars (4) ----
  ('a0000004-0000-0000-0000-000000000001'::uuid, 'רכב', 'טויוטה',   'קורולה האייבריד', 2022, '05-678-90', 'רכב מנכ"ל',              52000, current_date + 90, current_date + 80),
  ('a0000004-0000-0000-0000-000000000002'::uuid, 'רכב', 'מאזדה',    'CX-5',            2021, '06-789-01', NULL,                     78000, current_date + 40, current_date + 35),
  ('a0000004-0000-0000-0000-000000000003'::uuid, 'רכב', 'יונדאי',   'איוניק 5',        2023, '07-890-12', 'איוניק חשמל',           28000, current_date + 250, current_date + 260),
  ('a0000004-0000-0000-0000-000000000004'::uuid, 'רכב', 'סקודה',    'אוקטביה',         2019, '08-901-23', NULL,                    142000, current_date + 22, current_date + 18),

  -- ---- Motorcycle for express ----
  ('a0000005-0000-0000-0000-000000000001'::uuid, 'אופנוע', 'יאמהה', 'XMAX 400',         2020, '09-012-34', 'שליחויות',               39000, current_date + 55, current_date + 60),

  -- ---- Off-road / utility (RZR) ----
  ('a0000006-0000-0000-0000-000000000001'::uuid, 'רכב שטח', 'פולאריס', 'RZR XP 1000',  2021, '10-123-45', 'RZR שטח',                12000, current_date + 130, current_date + 150),

  -- ---- Heavy equipment (1) ----
  ('a0000007-0000-0000-0000-000000000001'::uuid, 'מחפר',   'JCB',    '3CX',             2018, '11-234-56', 'מחפר ראשי',              NULL, NULL, current_date + 270)
) AS new_vehicles(id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date)
CROSS JOIN (SELECT id FROM public.accounts WHERE name = 'אופק רכבים בעם' LIMIT 1) AS acc
ON CONFLICT (id) DO NOTHING;

-- Note: forklifts + the JCB use engine_hours instead of km. Fill them
-- separately so the bell's mileage logic doesn't flare a "missing km".
UPDATE public.vehicles SET current_engine_hours = 8420
 WHERE id = 'a0000003-0000-0000-0000-000000000001'::uuid;
UPDATE public.vehicles SET current_engine_hours = 6210
 WHERE id = 'a0000003-0000-0000-0000-000000000002'::uuid;
UPDATE public.vehicles SET current_engine_hours = 11900
 WHERE id = 'a0000003-0000-0000-0000-000000000003'::uuid;
UPDATE public.vehicles SET current_engine_hours = 4500
 WHERE id = 'a0000007-0000-0000-0000-000000000001'::uuid;


-- ====================================================== MAINTENANCE LOGS
-- Periodic services. Each row: vehicle_id, type ('small'/'large'/'תיקון'),
-- title, date, garage_name, cost, notes, km_at_service.
-- Spread across the last 18 months so the monthly trend chart has texture.

INSERT INTO public.maintenance_logs (vehicle_id, type, title, date, garage_name, cost, notes, km_at_service)
VALUES
  -- Trucks
  ('a0000001-0000-0000-0000-000000000001', 'large', 'טיפול 280K — שרשרת תזמון',                current_date - 30,  'מוסך וולוו ישראל', 4200, 'הוחלפה שרשרת תזמון', 280000),
  ('a0000001-0000-0000-0000-000000000001', 'small', 'החלפת שמן + פילטרים',                       current_date - 200, 'מוסך וולוו ישראל', 1450, NULL, 270000),
  ('a0000001-0000-0000-0000-000000000001', 'small', 'בדיקת בלמים + הידראוליקה',                  current_date - 380, 'מוסך הצפון',       980,  NULL, 258000),

  ('a0000001-0000-0000-0000-000000000002', 'small', 'טיפול תקופתי 140K',                        current_date - 50,  'מוסך מאן',          1620, NULL, 138000),
  ('a0000001-0000-0000-0000-000000000002', 'large', 'החלפת מצמד',                              current_date - 240, 'מוסך מאן',          7800, 'מצמד קופלוט', 124000),

  ('a0000001-0000-0000-0000-000000000003', 'large', 'אגבט מנוע — הופלע פילטר חלקיקים',          current_date - 90,  'מוסך סקניה',        9200, 'דרוש שנייה תוך 6 חודשים', 304000),
  ('a0000001-0000-0000-0000-000000000003', 'small', 'החלפת שמן + 4 פילטרים',                    current_date - 280, 'מוסך סקניה',        1890, NULL, 290000),

  ('a0000001-0000-0000-0000-000000000004', 'small', 'טיפול ראשון — 60K',                       current_date - 120, 'מוסך דאף',          1200, NULL, 58000),

  ('a0000001-0000-0000-0000-000000000005', 'small', 'החלפת שמן + פילטר אוויר',                  current_date - 60,  'מוסך איסוזו',       880,  NULL, 89000),
  ('a0000001-0000-0000-0000-000000000005', 'large', 'בלמים אחוריים מלא + דיסקים',               current_date - 320, 'מוסך מקומי',        3400, NULL, 78000),

  -- Vans
  ('a0000002-0000-0000-0000-000000000001', 'small', 'טיפול 70K',                              current_date - 75,  'מוסך מרצדס',        1750, NULL, 72000),
  ('a0000002-0000-0000-0000-000000000001', 'תיקון', 'החלפת מסנן DPF',                            current_date - 250, 'מוסך מרצדס',        4500, 'DPF הוחלף, חזור לבדיקה תוך 50K', 65000),

  ('a0000002-0000-0000-0000-000000000002', 'small', 'החלפת שמן + פילטרים',                       current_date - 110, 'מוסך פולקסווגן',    1320, NULL, 86000),
  ('a0000002-0000-0000-0000-000000000002', 'small', 'מצבר חדש',                                 current_date - 360, 'מוסך פולקסווגן',     680, 'מצבר Bosch S5', 78000),

  ('a0000002-0000-0000-0000-000000000003', 'large', 'טיפול 120K + מצמד',                       current_date - 40,  'מוסך פורד',         6800, NULL, 121000),
  ('a0000002-0000-0000-0000-000000000003', 'small', 'בדיקת מתלים',                              current_date - 220, 'מוסך הוותיק',        540, 'מתלים תקינים', 110000),

  ('a0000002-0000-0000-0000-000000000004', 'small', 'טיפול ראשון',                              current_date - 95,  'מוסך רנו',          1100, NULL, 38000),

  ('a0000002-0000-0000-0000-000000000005', 'large', 'טיפול גדול 160K',                          current_date - 70,  'מוסך איווקו',       4900, NULL, 162000),
  ('a0000002-0000-0000-0000-000000000005', 'תיקון', 'תיקון תיבת הילוכים',                        current_date - 290, 'מוסך תיבות',        12500, 'תיקון יסודי, אחריות שנה', 152000),

  -- Forklifts (use engine hours; cost-only matters for the dashboard)
  ('a0000003-0000-0000-0000-000000000001', 'small', 'הזרקת שמן הידראולי + פילטרים',              current_date - 45,  'שירות טויוטה',      1240, '8400 שעות', NULL),
  ('a0000003-0000-0000-0000-000000000001', 'large', 'תיקון שאיפה הידראולית',                     current_date - 180, 'שירות טויוטה',      3650, NULL, NULL),

  ('a0000003-0000-0000-0000-000000000002', 'small', 'בדיקת מערכת הטענה — מצברים',                current_date - 65,  'שירות הייסטר',      820,  NULL, NULL),
  ('a0000003-0000-0000-0000-000000000002', 'small', 'גלגלי גומי קדמיים',                         current_date - 230, 'שירות הייסטר',      1680, NULL, NULL),

  ('a0000003-0000-0000-0000-000000000003', 'large', 'אגבט מערכת חשמל מלא — מלגזה ישנה',          current_date - 110, 'שירות יילר',         5400, 'דרוש מעקב', NULL),

  -- Employee cars
  ('a0000004-0000-0000-0000-000000000001', 'small', 'טיפול 50K',                              current_date - 25,  'מוסך טויוטה',       890,  NULL, 50000),
  ('a0000004-0000-0000-0000-000000000001', 'small', 'מצמד פנים סוגות',                           current_date - 200, 'מוסך טויוטה',       1100, NULL, 38000),

  ('a0000004-0000-0000-0000-000000000002', 'large', 'טיפול 75K כולל בלמים',                    current_date - 80,  'מוסך מאזדה',        2300, NULL, 75000),
  ('a0000004-0000-0000-0000-000000000002', 'small', 'החלפת שמן + פילטר',                         current_date - 280, 'מוסך מאזדה',        680,  NULL, 60000),

  ('a0000004-0000-0000-0000-000000000003', 'small', 'בדיקת רכב חשמלי + שדרוג תוכנה',             current_date - 55,  'מוסך יונדאי',       550,  'EV — בדיקה כל 30K', 25000),

  ('a0000004-0000-0000-0000-000000000004', 'large', 'טיפול 140K — שרשרת תזמון + מצמד',           current_date - 100, 'מוסך מקומי',        4800, 'שעות עבודה רבות', 140000),
  ('a0000004-0000-0000-0000-000000000004', 'small', 'בדיקת מתלים + ייצוב',                       current_date - 320, 'מוסך מקומי',        720,  NULL, 125000),

  -- Motorcycle
  ('a0000005-0000-0000-0000-000000000001', 'small', 'טיפול 35K + צמיגים',                       current_date - 60,  'מוסך אופנועים',     1450, 'צמיגים מיכלין', 36000),

  -- RZR
  ('a0000006-0000-0000-0000-000000000001', 'small', 'טיפול שטח — ניקוי וגריז',                   current_date - 90,  'שירות פולאריס',     920,  NULL, 11000),

  -- JCB
  ('a0000007-0000-0000-0000-000000000001', 'large', 'טיפול 4500 שעות — בלמים + הידראוליקה',     current_date - 70,  'JCB ישראל',         8900, NULL, NULL),
  ('a0000007-0000-0000-0000-000000000001', 'small', 'החלפת שמן + פילטרים',                       current_date - 250, 'JCB ישראל',         1850, NULL, NULL)
;


-- ============================================================ REPAIR LOGS
-- Workshop visits. account_id required. Most aren't accidents.

INSERT INTO public.repair_logs
  (vehicle_id, account_id, title, occurred_at, repaired_at, description,
   repaired_by, garage_name, cost, is_accident)
SELECT * FROM (VALUES
  ('a0000001-0000-0000-0000-000000000001'::uuid, 'הופעת קוד שגיאה — חיישן NOx',  current_date - 14,  current_date - 13, 'הוחלף חיישן NOx + reset ECU',           'מוסך', 'מוסך וולוו ישראל', 2400::numeric, false),
  ('a0000001-0000-0000-0000-000000000001'::uuid, 'תקלת מערכת אוויר',              current_date - 160, current_date - 159, 'דליפה במגף — תוקן',                     'מוסך', 'מוסך הצפון',        1100::numeric, false),
  ('a0000001-0000-0000-0000-000000000003'::uuid, 'חבטה בנגרר — תאונה קטנה',       current_date - 95,  current_date - 90, 'תיקון פח אחורי + צבע',                  'מוסך', 'פחחות הקריות',      6800::numeric, true),
  ('a0000001-0000-0000-0000-000000000005'::uuid, 'דליפת אגרגט',                    current_date - 35,  current_date - 33, 'הוחלף אגרגט',                            'מוסך', 'מוסך איסוזו',       1850::numeric, false),
  ('a0000002-0000-0000-0000-000000000001'::uuid, 'תקלת התנעה',                     current_date - 22,  current_date - 22, 'מתנע חדש',                               'מוסך', 'מוסך מרצדס',         950::numeric, false),
  ('a0000002-0000-0000-0000-000000000002'::uuid, 'מטוסי אוויר אחורי',               current_date - 175, current_date - 173, 'תיקון בלון אוויר אחורי',                'מוסך', 'מוסך שילוב',        1980::numeric, false),
  ('a0000002-0000-0000-0000-000000000003'::uuid, 'חבטה בחנייה',                     current_date - 270, current_date - 265, 'תיקון פח דלת ימין + צבע',                'מוסך', 'פחחות מומחים',      3400::numeric, true),
  ('a0000002-0000-0000-0000-000000000004'::uuid, 'נורת בודק מנוע נדלקה',           current_date - 18,  current_date - 18, 'חיישן חמצן הוחלף',                       'מוסך', 'מוסך רנו',           780::numeric, false),
  ('a0000002-0000-0000-0000-000000000005'::uuid, 'רעש מהמתלה',                      current_date - 105, current_date - 103, 'בולמים קדמיים הוחלפו',                  'מוסך', 'מוסך איווקו',       1420::numeric, false),
  ('a0000003-0000-0000-0000-000000000001'::uuid, 'דליפת שמן הידראולי',              current_date - 65,  current_date - 64, 'איטם הוחלף',                             'מוסך', 'שירות טויוטה',       640::numeric, false),
  ('a0000003-0000-0000-0000-000000000003'::uuid, 'תקלה במערכת היגוי',               current_date - 25,  current_date - 22, 'משאבת היגוי הוחלפה',                    'מוסך', 'שירות יילר',        2950::numeric, false),
  ('a0000004-0000-0000-0000-000000000001'::uuid, 'תיקון מראה צד שמאל',              current_date - 40,  current_date - 40, 'מראה הוחלפה — נשברה בחנייה',           'אני',  NULL,                 320::numeric, false),
  ('a0000004-0000-0000-0000-000000000002'::uuid, 'תאונה — צד נהג',                  current_date - 220, current_date - 210, 'דלת + פחית + ראי. כיסוי ביטוח חלקי.', 'מוסך', 'פחחות מאזדה',      8900::numeric, true),
  ('a0000004-0000-0000-0000-000000000004'::uuid, 'רעש בבלמים',                      current_date - 78,  current_date - 78, 'דיסקים + רפידות',                        'מוסך', 'מוסך מקומי',        1240::numeric, false),
  ('a0000005-0000-0000-0000-000000000001'::uuid, 'פנצ\'ר חוזר',                      current_date - 45,  current_date - 45, 'צמיג אחורי הוחלף',                       'אני',  NULL,                 380::numeric, false),
  ('a0000006-0000-0000-0000-000000000001'::uuid, 'תיקון שלדה — נסיעת שטח',          current_date - 130, current_date - 125, 'בריח שלדה תוקן + צבע',                 'מוסך', 'שירות פולאריס',     1850::numeric, false),
  ('a0000007-0000-0000-0000-000000000001'::uuid, 'דליפת שמן צד ימין',                current_date - 12,  current_date - 11, 'איטם משאבה הוחלף',                       'מוסך', 'JCB ישראל',         2200::numeric, false),
  ('a0000007-0000-0000-0000-000000000001'::uuid, 'תיקון פנס LED',                    current_date - 195, current_date - 195, 'פנס שטח שבר',                            'אני',  NULL,                 480::numeric, false)
) AS r(vehicle_id, title, occurred_at, repaired_at, description, repaired_by, garage_name, cost, is_accident)
CROSS JOIN (SELECT id FROM public.accounts WHERE name = 'אופק רכבים בעם' LIMIT 1) AS acc;


-- ============================================================ EXPENSES
-- Spread across the last 18 months. Mix of categories so the chart's
-- stacked bars + the category breakdown panel both have data.

INSERT INTO public.vehicle_expenses
  (account_id, vehicle_id, amount, currency, category, expense_date, note)
SELECT acc.id, v.vehicle_id, v.amount, 'ILS', v.category, v.expense_date, v.note
FROM (VALUES
  -- Fuel — recent months, every truck/van/motorcycle. Many rows so
  -- /Expenses has a real list. /Reports excludes fuel by design, so
  -- this only affects /Expenses + the line-item detail.
  ('a0000001-0000-0000-0000-000000000001'::uuid, 1850::numeric, 'fuel'::text, current_date - 5,   'תדלוק תחנת דלק פז'),
  ('a0000001-0000-0000-0000-000000000001'::uuid, 1720::numeric, 'fuel'::text, current_date - 35,  'תדלוק'),
  ('a0000001-0000-0000-0000-000000000001'::uuid, 1900::numeric, 'fuel'::text, current_date - 65,  'תדלוק'),
  ('a0000001-0000-0000-0000-000000000001'::uuid, 1810::numeric, 'fuel'::text, current_date - 95,  'תדלוק'),
  ('a0000001-0000-0000-0000-000000000002'::uuid, 1450::numeric, 'fuel'::text, current_date - 8,   'תדלוק תחנת דור אלון'),
  ('a0000001-0000-0000-0000-000000000002'::uuid, 1380::numeric, 'fuel'::text, current_date - 38,  'תדלוק'),
  ('a0000001-0000-0000-0000-000000000003'::uuid, 1980::numeric, 'fuel'::text, current_date - 12,  'תדלוק'),
  ('a0000001-0000-0000-0000-000000000003'::uuid, 2100::numeric, 'fuel'::text, current_date - 42,  'תדלוק'),
  ('a0000001-0000-0000-0000-000000000004'::uuid, 1290::numeric, 'fuel'::text, current_date - 7,   'תדלוק'),
  ('a0000001-0000-0000-0000-000000000005'::uuid, 1100::numeric, 'fuel'::text, current_date - 4,   'תדלוק'),
  ('a0000002-0000-0000-0000-000000000001'::uuid, 980::numeric,  'fuel'::text, current_date - 6,   'תדלוק סולר'),
  ('a0000002-0000-0000-0000-000000000001'::uuid, 920::numeric,  'fuel'::text, current_date - 36,  'תדלוק'),
  ('a0000002-0000-0000-0000-000000000002'::uuid, 1050::numeric, 'fuel'::text, current_date - 10,  'תדלוק'),
  ('a0000002-0000-0000-0000-000000000003'::uuid, 880::numeric,  'fuel'::text, current_date - 14,  'תדלוק'),
  ('a0000002-0000-0000-0000-000000000004'::uuid, 760::numeric,  'fuel'::text, current_date - 20,  'תדלוק'),
  ('a0000002-0000-0000-0000-000000000005'::uuid, 1040::numeric, 'fuel'::text, current_date - 28,  'תדלוק'),
  ('a0000004-0000-0000-0000-000000000001'::uuid, 380::numeric,  'fuel'::text, current_date - 9,   'תדלוק היברידי'),
  ('a0000004-0000-0000-0000-000000000001'::uuid, 360::numeric,  'fuel'::text, current_date - 39,  'תדלוק'),
  ('a0000004-0000-0000-0000-000000000002'::uuid, 480::numeric,  'fuel'::text, current_date - 15,  'תדלוק'),
  ('a0000004-0000-0000-0000-000000000004'::uuid, 520::numeric,  'fuel'::text, current_date - 18,  'תדלוק'),
  ('a0000005-0000-0000-0000-000000000001'::uuid, 220::numeric,  'fuel'::text, current_date - 3,   'תדלוק אופנוע'),
  ('a0000005-0000-0000-0000-000000000001'::uuid, 210::numeric,  'fuel'::text, current_date - 33,  'תדלוק אופנוע'),
  ('a0000006-0000-0000-0000-000000000001'::uuid, 340::numeric,  'fuel'::text, current_date - 24,  'תדלוק שטח'),

  -- Insurance — annual policies, one row per vehicle paid in the last
  -- year. Distributed across months so the trend chart shows insurance
  -- spikes.
  ('a0000001-0000-0000-0000-000000000001'::uuid, 14500::numeric, 'insurance'::text, current_date - 60,  'ביטוח חובה + מקיף — שנתי'),
  ('a0000001-0000-0000-0000-000000000002'::uuid, 13800::numeric, 'insurance'::text, current_date - 95,  'ביטוח שנתי'),
  ('a0000001-0000-0000-0000-000000000003'::uuid, 15200::numeric, 'insurance'::text, current_date - 130, 'ביטוח שנתי + ציוד מיוחד'),
  ('a0000001-0000-0000-0000-000000000004'::uuid, 12100::numeric, 'insurance'::text, current_date - 165, 'ביטוח שנתי'),
  ('a0000001-0000-0000-0000-000000000005'::uuid, 10800::numeric, 'insurance'::text, current_date - 200, 'ביטוח שנתי'),
  ('a0000002-0000-0000-0000-000000000001'::uuid, 8400::numeric,  'insurance'::text, current_date - 50,  'ביטוח שנתי'),
  ('a0000002-0000-0000-0000-000000000002'::uuid, 8200::numeric,  'insurance'::text, current_date - 80,  'ביטוח שנתי'),
  ('a0000002-0000-0000-0000-000000000003'::uuid, 7900::numeric,  'insurance'::text, current_date - 110, 'ביטוח שנתי'),
  ('a0000002-0000-0000-0000-000000000004'::uuid, 8600::numeric,  'insurance'::text, current_date - 145, 'ביטוח שנתי'),
  ('a0000002-0000-0000-0000-000000000005'::uuid, 7700::numeric,  'insurance'::text, current_date - 180, 'ביטוח שנתי'),
  ('a0000003-0000-0000-0000-000000000001'::uuid, 4200::numeric,  'insurance'::text, current_date - 70,  'ביטוח מלגזה'),
  ('a0000003-0000-0000-0000-000000000002'::uuid, 4100::numeric,  'insurance'::text, current_date - 105, 'ביטוח מלגזה'),
  ('a0000003-0000-0000-0000-000000000003'::uuid, 4400::numeric,  'insurance'::text, current_date - 140, 'ביטוח מלגזה'),
  ('a0000004-0000-0000-0000-000000000001'::uuid, 4900::numeric,  'insurance'::text, current_date - 90,  'ביטוח שנתי'),
  ('a0000004-0000-0000-0000-000000000002'::uuid, 4600::numeric,  'insurance'::text, current_date - 120, 'ביטוח שנתי'),
  ('a0000004-0000-0000-0000-000000000003'::uuid, 5200::numeric,  'insurance'::text, current_date - 155, 'ביטוח רכב חשמלי'),
  ('a0000004-0000-0000-0000-000000000004'::uuid, 4300::numeric,  'insurance'::text, current_date - 190, 'ביטוח שנתי'),
  ('a0000005-0000-0000-0000-000000000001'::uuid, 2800::numeric,  'insurance'::text, current_date - 75,  'ביטוח אופנוע'),
  ('a0000006-0000-0000-0000-000000000001'::uuid, 3400::numeric,  'insurance'::text, current_date - 100, 'ביטוח שטח'),
  ('a0000007-0000-0000-0000-000000000001'::uuid, 6800::numeric,  'insurance'::text, current_date - 220, 'ביטוח כלי הנדסי'),

  -- Repair-category expenses (workshop bills paid via direct expense
  -- entry rather than the repair_logs flow — happens when the manager
  -- gets a quick invoice and just records the cost).
  ('a0000001-0000-0000-0000-000000000001'::uuid, 1450::numeric,  'repair'::text, current_date - 110, 'תיקון פנס ראשי'),
  ('a0000001-0000-0000-0000-000000000003'::uuid, 2300::numeric,  'repair'::text, current_date - 250, 'תיקון מראה + ניקוי דיזל'),
  ('a0000002-0000-0000-0000-000000000003'::uuid, 1180::numeric,  'repair'::text, current_date - 180, 'תיקון חשמל'),
  ('a0000002-0000-0000-0000-000000000005'::uuid, 940::numeric,   'repair'::text, current_date - 220, 'תיקון מנעול תא מטען'),
  ('a0000003-0000-0000-0000-000000000002'::uuid, 1340::numeric,  'repair'::text, current_date - 145, 'תיקון בקרת מהירות'),
  ('a0000004-0000-0000-0000-000000000004'::uuid, 680::numeric,   'repair'::text, current_date - 195, 'הזרקת חלון אחורי'),
  ('a0000007-0000-0000-0000-000000000001'::uuid, 3200::numeric,  'repair'::text, current_date - 280, 'תיקון משאבה הידראולית'),

  -- Other — tolls (כביש 6), parking, equipment, washing, registration.
  ('a0000001-0000-0000-0000-000000000001'::uuid, 320::numeric,  'other'::text, current_date - 15,  'כביש 6'),
  ('a0000001-0000-0000-0000-000000000001'::uuid, 280::numeric,  'other'::text, current_date - 45,  'כביש 6'),
  ('a0000001-0000-0000-0000-000000000002'::uuid, 290::numeric,  'other'::text, current_date - 25,  'כביש 6'),
  ('a0000001-0000-0000-0000-000000000003'::uuid, 410::numeric,  'other'::text, current_date - 30,  'כביש 6 + חניית טעינה'),
  ('a0000002-0000-0000-0000-000000000001'::uuid, 180::numeric,  'other'::text, current_date - 8,   'שטיפה + ציפוי'),
  ('a0000002-0000-0000-0000-000000000002'::uuid, 95::numeric,   'other'::text, current_date - 20,  'שטיפה'),
  ('a0000002-0000-0000-0000-000000000003'::uuid, 540::numeric,  'other'::text, current_date - 60,  'אגרת רישוי שנתית'),
  ('a0000003-0000-0000-0000-000000000001'::uuid, 220::numeric,  'other'::text, current_date - 12,  'גז למלגזה'),
  ('a0000003-0000-0000-0000-000000000002'::uuid, 210::numeric,  'other'::text, current_date - 42,  'גז למלגזה'),
  ('a0000004-0000-0000-0000-000000000001'::uuid, 480::numeric,  'other'::text, current_date - 75,  'אגרת רישוי'),
  ('a0000004-0000-0000-0000-000000000002'::uuid, 450::numeric,  'other'::text, current_date - 110, 'אגרת רישוי'),
  ('a0000004-0000-0000-0000-000000000003'::uuid, 520::numeric,  'other'::text, current_date - 140, 'אגרת רישוי + הטענה ציבורית'),
  ('a0000005-0000-0000-0000-000000000001'::uuid, 280::numeric,  'other'::text, current_date - 60,  'אגרת אופנוע + ביגוד מגן'),
  ('a0000006-0000-0000-0000-000000000001'::uuid, 380::numeric,  'other'::text, current_date - 90,  'בדיקת ארגז שטח'),
  ('a0000007-0000-0000-0000-000000000001'::uuid, 1850::numeric, 'other'::text, current_date - 200, 'הובלת מחפר לאתר חדש')
) AS v(vehicle_id, amount, category, expense_date, note)
CROSS JOIN (SELECT id FROM public.accounts WHERE name = 'אופק רכבים בעם' LIMIT 1) AS acc;


-- ============================================================ DONE
DO $$
DECLARE
  v_account_id uuid;
  v_count_vehicles int;
  v_count_maint int;
  v_count_repairs int;
  v_count_expenses int;
BEGIN
  SELECT id INTO v_account_id FROM public.accounts WHERE name = 'אופק רכבים בעם' LIMIT 1;
  SELECT count(*) INTO v_count_vehicles FROM public.vehicles WHERE account_id = v_account_id;
  SELECT count(*) INTO v_count_maint    FROM public.maintenance_logs WHERE vehicle_id IN
                                            (SELECT id FROM public.vehicles WHERE account_id = v_account_id);
  SELECT count(*) INTO v_count_repairs  FROM public.repair_logs WHERE account_id = v_account_id;
  SELECT count(*) INTO v_count_expenses FROM public.vehicle_expenses WHERE account_id = v_account_id;

  RAISE NOTICE '✓ Seed complete';
  RAISE NOTICE '  vehicles:    %', v_count_vehicles;
  RAISE NOTICE '  maintenance: %', v_count_maint;
  RAISE NOTICE '  repairs:     %', v_count_repairs;
  RAISE NOTICE '  expenses:    %', v_count_expenses;
END $$;
