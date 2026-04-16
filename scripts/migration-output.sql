-- ═══════════════════════════════════════════════════════════
-- Base44 → Supabase Migration
-- Generated: 2026-04-16T08:25:10.696Z
-- Source: 113 accounts, from vehicle-app-export-2026-04-16.json
-- ═══════════════════════════════════════════════════════════

-- ── Step 1: Migration email map table ──
CREATE TABLE IF NOT EXISTS migration_email_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  account_id UUID NOT NULL,
  full_name TEXT,
  phone TEXT,
  birth_date DATE,
  driver_license_number TEXT,
  license_expiration_date DATE,
  migrated_at TIMESTAMPTZ DEFAULT now(),
  claimed_by_user_id UUID DEFAULT NULL,
  claimed_at TIMESTAMPTZ DEFAULT NULL
);

-- Allow authenticated users to read/update their own email mapping
ALTER TABLE migration_email_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS migration_email_read ON migration_email_map;
CREATE POLICY migration_email_read ON migration_email_map FOR SELECT TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
DROP POLICY IF EXISTS migration_email_update ON migration_email_map;
CREATE POLICY migration_email_update ON migration_email_map FOR UPDATE TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- ── Step 2: Insert migrated data ──
BEGIN;

-- Account: החשבון של חיים הייבלום
INSERT INTO accounts (id, name, created_at) VALUES ('ac8e348c-f580-447d-a35a-2b2f125e542c', 'החשבון של חיים הייבלום', '2026-04-12T04:20:50.186000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('chaimhaiblum@gmail.com', 'ac8e348c-f580-447d-a35a-2b2f125e542c', 'חיים הייבלום', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('4a3b0d45-ac6d-43f1-bc44-6b8286bd81f6', 'ac8e348c-f580-447d-a35a-2b2f125e542c', 'רכב', 'טויוטה יפן', 'TOYOTA BZ4X', 2023, '559-44-903', NULL, 30500, '2026-08-20', '2026-08-22') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Eyal Artzy
INSERT INTO accounts (id, name, created_at) VALUES ('5ed15408-11f9-4d32-80e9-c48f0f55a01f', 'החשבון של Eyal Artzy', '2026-04-06T09:43:02.734000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('eyal1413@gmail.com', '5ed15408-11f9-4d32-80e9-c48f0f55a01f', 'Eyal Artzy', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של אליהו איסקוב
INSERT INTO accounts (id, name, created_at) VALUES ('3dfb9021-d7f6-4d31-9248-8f2cda41428e', 'החשבון של אליהו איסקוב', '2026-03-29T06:48:55.343000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('isakov2012@gmail.com', '3dfb9021-d7f6-4d31-9248-8f2cda41428e', 'אליהו איסקוב', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('b8931f23-a4e0-42fd-a0a5-2464e40c7866', '3dfb9021-d7f6-4d31-9248-8f2cda41428e', 'רכב', 'פיג''ו צרפת', '3008', 2019, '648-00-201', NULL, 95000, '2026-09-04', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של mayavalik
INSERT INTO accounts (id, name, created_at) VALUES ('ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', 'החשבון של mayavalik', '2026-03-28T22:37:02.440000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('mayavalik@gmail.com', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', 'mayavalik', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('457305b3-2190-4148-be43-3e1b1e25c6e4', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', 'רכב', 'טויוטה טורקיה', 'COROLLA', 2016, '23-138-37', 'טויוטה הורים', NULL, '2026-06-05', '2027-04-01') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('7ef75cde-17c8-4569-ac83-af0909f358ce', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', 'רכב', 'סיאט ספרד', 'IBIZA', 2016, '19-781-38', 'איביזה', 136000, '2027-01-12', '2027-03-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('29fb3252-65f1-4d99-b5bb-0dc9f0eac6f2', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', 'רכב', 'סקודה צ''כיה', 'OCTAVIA', 2022, '234-16-703', NULL, NULL, '2026-10-29', '2026-06-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('3682b1a0-3777-4ecc-9d57-ca2111436aed', '29fb3252-65f1-4d99-b5bb-0dc9f0eac6f2', 'large', 'טיפול גדול', '2025-06-25', 'מוסך', NULL, 'שלמה סיקסט לםני מכירה', 41000) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('a9842cbb-ba30-43c6-9ee6-af5c90be9648', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', '7ef75cde-17c8-4569-ac83-af0909f358ce', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('3c327149-eb5d-46f3-81a6-4489de097c37', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', '7ef75cde-17c8-4569-ac83-af0909f358ce', 'ביטוח מקיף', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('d28170bd-0303-4e7a-9e20-071b55bbb6de', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', '7ef75cde-17c8-4569-ac83-af0909f358ce', 'מסמך אחר', 'עבר ביטוחי סקודה', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('27265c73-afbd-4689-bdcf-6afb21a0353e', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', '7ef75cde-17c8-4569-ac83-af0909f358ce', 'מסמך אחר', 'עבר ביטוחי aig טויוטה', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('869e4781-d5fd-4267-852e-788cb521ba16', 'ce5532a5-d65e-4bac-a53c-e603a3f2b8a8', '7ef75cde-17c8-4569-ac83-af0909f358ce', 'ביטוח חובה', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של ברוך אדלשטיין
INSERT INTO accounts (id, name, created_at) VALUES ('01ad87fd-8496-48e1-9f77-5cd9f22697c7', 'החשבון של ברוך אדלשטיין', '2026-03-24T22:01:30.423000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('baruched1962.24@gmail.com', '01ad87fd-8496-48e1-9f77-5cd9f22697c7', 'ברוך אדלשטיין', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של inbar miller
INSERT INTO accounts (id, name, created_at) VALUES ('c203628b-fe10-4f1b-a9af-6cd9804cc6d2', 'החשבון של inbar miller', '2026-03-24T20:40:14.259000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('inbar1101miller@gmail.com', 'c203628b-fe10-4f1b-a9af-6cd9804cc6d2', 'inbar miller', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('dd3db6eb-b875-4b5b-bffd-2e295fd62b43', 'c203628b-fe10-4f1b-a9af-6cd9804cc6d2', 'רכב', 'יונדאי קוריאה', 'KONA', 2022, '159-79-503', 'קונה', 102000, '2026-08-01', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של סאני דוידפור
INSERT INTO accounts (id, name, created_at) VALUES ('a8aeac66-6e15-43bf-a447-85d2f57f4670', 'החשבון של סאני דוידפור', '2026-03-23T19:45:11.627000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('davidpursunny23@gmail.com', 'a8aeac66-6e15-43bf-a447-85d2f57f4670', 'סאני דוידפור', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של natanzone2024
INSERT INTO accounts (id, name, created_at) VALUES ('2a984c75-c23d-4faa-8bb9-6a4ca53eecf1', 'החשבון של natanzone2024', '2026-03-23T14:06:10.906000') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('0804e8e5-75a4-4634-9053-fb74c5747500', '2a984c75-c23d-4faa-8bb9-6a4ca53eecf1', 'רכב', 'פולקסווגן גרמנ', 'GOLF', 2017, '259-08-901', NULL, NULL, '2025-09-11', NULL) ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 259-08-901 (פולקסווגן גרמנ GOLF)
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('93bd56c4-350c-4fe4-9e00-0d4ca7690ef0', '0804e8e5-75a4-4634-9053-fb74c5747500', 'small', 'טיפול קטן', '2026-03-24', 'אני', 200, 'חםדמקם', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('77faeaf6-2cf4-42f2-9f8a-8b17675ac49d', '0804e8e5-75a4-4634-9053-fb74c5747500', 'תיקון', 'תיקון', '2026-03-24', 'אני', 250, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Tomer Telem
INSERT INTO accounts (id, name, created_at) VALUES ('bad78d4f-ad2d-4391-9d73-4622c5127dcc', 'החשבון של Tomer Telem', '2026-03-22T16:34:48.402000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ttelem@gmail.com', 'bad78d4f-ad2d-4391-9d73-4622c5127dcc', 'Tomer Telem', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('eb88549e-e361-42f5-bc7f-579302dbaab7', 'bad78d4f-ad2d-4391-9d73-4622c5127dcc', 'רכב', 'מאזדה', '6', 2010, '3292371', 'מאזדה 6', 290000, '2026-10-02', '2026-12-31') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של natanzone2024
INSERT INTO accounts (id, name, created_at) VALUES ('db38ce39-ce0a-4238-b02d-2828a01e1799', 'החשבון של natanzone2024', '2026-03-22T09:41:18.372000') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של עמית חרותי
INSERT INTO accounts (id, name, created_at) VALUES ('58f35ab0-20f1-45cd-a681-02fa75418ccd', 'החשבון של עמית חרותי', '2026-03-19T13:27:11.257000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('amitheruti2@gmail.com', '58f35ab0-20f1-45cd-a681-02fa75418ccd', 'עמית חרותי', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Dan hamn
INSERT INTO accounts (id, name, created_at) VALUES ('6568ea8b-dc30-43f3-8c5a-3e05b0cff2c2', 'החשבון של Dan hamn', '2026-03-18T18:54:32.777000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('test4all2@gmail.com', '6568ea8b-dc30-43f3-8c5a-3e05b0cff2c2', 'Dan hamn', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Soki Koki
INSERT INTO accounts (id, name, created_at) VALUES ('37899b6b-d0fe-4190-a622-5d1157fff0f5', 'החשבון של Soki Koki', '2026-03-18T07:05:54.191000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sporebit@gmail.com', '37899b6b-d0fe-4190-a622-5d1157fff0f5', 'Soki Koki', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Dor Itzhaki
INSERT INTO accounts (id, name, created_at) VALUES ('d0ea07d2-9d26-49ca-9fcf-1f4885c5dfbd', 'החשבון של Dor Itzhaki', '2026-03-16T11:37:18.271000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('doritzhaki6@gmail.com', 'd0ea07d2-9d26-49ca-9fcf-1f4885c5dfbd', 'Dor Itzhaki', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Omer Tzroya
INSERT INTO accounts (id, name, created_at) VALUES ('a68d0e1f-0728-45cd-a75b-03e472b738bd', 'החשבון של Omer Tzroya', '2026-03-16T07:38:52.808000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('omersr9@gmail.com', 'a68d0e1f-0728-45cd-a75b-03e472b738bd', 'Omer Tzroya', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של נתנאל סבג
INSERT INTO accounts (id, name, created_at) VALUES ('a8063732-16f6-4d5d-9c9a-a1598ca781c1', 'החשבון של נתנאל סבג', '2026-03-16T07:01:29.798000') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Yonatan Azrad
INSERT INTO accounts (id, name, created_at) VALUES ('e45e5931-66f5-4a89-9ffc-a0060a6969b0', 'החשבון של Yonatan Azrad', '2026-03-15T11:35:28.088000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yonatanazrad@gmail.com', 'e45e5931-66f5-4a89-9ffc-a0060a6969b0', 'Yonatan Azrad', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של עמית נאמני
INSERT INTO accounts (id, name, created_at) VALUES ('366b5cb0-f812-45d0-bb76-6c0199594837', 'החשבון של עמית נאמני', '2026-03-15T11:03:51.734000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('amit.neemani123@gmail.com', '366b5cb0-f812-45d0-bb76-6c0199594837', 'עמית נאמני', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של מאור אוחנה
INSERT INTO accounts (id, name, created_at) VALUES ('3e224d26-63d9-4577-be83-ea2101a56dee', 'החשבון של מאור אוחנה', '2026-03-15T09:28:16.668000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('maori30@gmail.com', '3e224d26-63d9-4577-be83-ea2101a56dee', 'מאור אוחנה', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של יוחאי סיטבון
INSERT INTO accounts (id, name, created_at) VALUES ('e070727b-9035-4441-aeb6-d0f030bd1ade', 'החשבון של יוחאי סיטבון', '2026-03-15T08:39:42.051000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sitbonyohai@gmail.com', 'e070727b-9035-4441-aeb6-d0f030bd1ade', 'יוחאי סיטבון', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Shlomo A
INSERT INTO accounts (id, name, created_at) VALUES ('41ef25ad-3191-4930-873d-94755196fa06', 'החשבון של Shlomo A', '2026-03-15T04:43:29.894000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shlomo.azizi@gmail.com', '41ef25ad-3191-4930-873d-94755196fa06', 'Shlomo A', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ליאל כהן
INSERT INTO accounts (id, name, created_at) VALUES ('573f75d9-d9ff-4827-be0a-795fc70d9f0a', 'החשבון של ליאל כהן', '2026-03-15T00:24:51.930000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('lielcpc@gmail.com', '573f75d9-d9ff-4827-be0a-795fc70d9f0a', 'ליאל כהן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של projectsbrain90
INSERT INTO accounts (id, name, created_at) VALUES ('1046b63d-d3c9-43b0-acb1-fd67a8051bd3', 'החשבון של projectsbrain90', '2026-03-14T23:11:22.311000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('projectsbrain90@gmail.com', '1046b63d-d3c9-43b0-acb1-fd67a8051bd3', 'projectsbrain90', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ראובן נאמני
INSERT INTO accounts (id, name, created_at) VALUES ('3a0287e4-1e32-4aab-86fe-83b767cc8f1f', 'החשבון של ראובן נאמני', '2026-03-14T21:08:23.944000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('rnkogol@gmail.com', '3a0287e4-1e32-4aab-86fe-83b767cc8f1f', 'ראובן נאמני', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של יהודה צולשן
INSERT INTO accounts (id, name, created_at) VALUES ('efc598e7-6425-40a6-a925-650512529475', 'החשבון של יהודה צולשן', '2026-03-14T21:05:02.031000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yeudazol23@gmail.com', 'efc598e7-6425-40a6-a925-650512529475', 'יהודה צולשן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של יערי כהן
INSERT INTO accounts (id, name, created_at) VALUES ('0548c8e3-5edd-42a0-a0a7-1f29cc9cc4ff', 'החשבון של יערי כהן', '2026-03-14T08:45:39.710000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yearic@gmail.com', '0548c8e3-5edd-42a0-a0a7-1f29cc9cc4ff', 'יערי כהן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ron Batat
INSERT INTO accounts (id, name, created_at) VALUES ('42d97c21-9003-4882-aad1-45144d3568c2', 'החשבון של Ron Batat', '2026-03-13T20:54:00.300000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ronbatatson@gmail.com', '42d97c21-9003-4882-aad1-45144d3568c2', 'Ron Batat', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Eden
INSERT INTO accounts (id, name, created_at) VALUES ('7bd7fa83-530e-4493-bcbc-740526526325', 'החשבון של Eden', '2026-03-13T19:44:48.482000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('walla90@gmail.com', '7bd7fa83-530e-4493-bcbc-740526526325', 'Eden', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('b7d3ccce-7158-4c97-8006-05c65025d9bf', '7bd7fa83-530e-4493-bcbc-740526526325', 'רכב', 'סובארו', 'IMPREZA', 2005, '6980758', NULL, 10000, '2014-02-15', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('e0cabaf5-02c2-48db-bee8-6d9a116d3420', '7bd7fa83-530e-4493-bcbc-740526526325', 'b7d3ccce-7158-4c97-8006-05c65025d9bf', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של אלעד סיני
INSERT INTO accounts (id, name, created_at) VALUES ('9d5059e2-9eca-4d16-8e35-7d37ff4ccf44', 'החשבון של אלעד סיני', '2026-03-13T12:41:51.485000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('eladsinai1@gmail.com', '9d5059e2-9eca-4d16-8e35-7d37ff4ccf44', 'אלעד סיני', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של lol lol
INSERT INTO accounts (id, name, created_at) VALUES ('66a38e3a-8d2f-4bf8-a8ba-311f3e9d0937', 'החשבון של lol lol', '2026-03-13T11:49:05.881000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sonipes146@gmail.com', '66a38e3a-8d2f-4bf8-a8ba-311f3e9d0937', 'lol lol', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של eliran aricha (‫אלירן‬‎)
INSERT INTO accounts (id, name, created_at) VALUES ('c15f9bb6-fc63-4908-89ee-3b93717f5837', 'החשבון של eliran aricha (‫אלירן‬‎)', '2026-03-13T10:27:55.707000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('eliranaricha@gmail.com', 'c15f9bb6-fc63-4908-89ee-3b93717f5837', 'eliran aricha (‫אלירן‬‎)', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Yotam Saacks
INSERT INTO accounts (id, name, created_at) VALUES ('a3b3b600-d1d7-41b8-bc7a-d1eaf4ca9162', 'החשבון של Yotam Saacks', '2026-03-13T09:24:17.875000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yotsaacks@gmail.com', 'a3b3b600-d1d7-41b8-bc7a-d1eaf4ca9162', 'Yotam Saacks', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של roi rubin
INSERT INTO accounts (id, name, created_at) VALUES ('463ec550-fa49-4659-87a3-6fada5c9886d', 'החשבון של roi rubin', '2026-03-12T21:32:23.619000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('roirubin100@gmail.com', '463ec550-fa49-4659-87a3-6fada5c9886d', 'roi rubin', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('a45a874c-512b-4958-900a-a57a5e17fb0c', '463ec550-fa49-4659-87a3-6fada5c9886d', 'רכב', 'סיאט', NULL, 2016, '4222038', NULL, 160000, '2026-07-08', '2026-08-18') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של איתי אביצור
INSERT INTO accounts (id, name, created_at) VALUES ('5742eea7-af8a-427e-9629-dfaf199ad7a2', 'החשבון של איתי אביצור', '2026-03-12T13:53:21.944000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('tchmur1@gmail.com', '5742eea7-af8a-427e-9629-dfaf199ad7a2', 'איתי אביצור', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Sam Brook
INSERT INTO accounts (id, name, created_at) VALUES ('b0279f14-1165-4d28-8a7a-b0dd7990fbe0', 'החשבון של Sam Brook', '2026-03-12T07:29:48.804000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sambrook2006@yahoo.com', 'b0279f14-1165-4d28-8a7a-b0dd7990fbe0', 'Sam Brook', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ofir Arie
INSERT INTO accounts (id, name, created_at) VALUES ('d4e43a7e-5c66-4062-adba-0be6af5daea2', 'החשבון של Ofir Arie', '2026-03-12T07:04:05.919000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ofirarie1980@gmail.com', 'd4e43a7e-5c66-4062-adba-0be6af5daea2', 'Ofir Arie', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('aa4f5adf-76e4-4153-9b44-e8b973233d35', 'd4e43a7e-5c66-4062-adba-0be6af5daea2', 'קטנוע', 'ניסאן', NULL, NULL, '27737484', NULL, NULL, '2025-12-17', '2026-10-22') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('4a6c1aae-799a-404b-b539-1c16fb0fd7d3', 'd4e43a7e-5c66-4062-adba-0be6af5daea2', 'רכב', 'יונדאי', NULL, NULL, '37378399', NULL, NULL, '2026-06-16', '2026-03-12') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Yaniv Shmidt
INSERT INTO accounts (id, name, created_at) VALUES ('a0266824-a48a-4a6c-b1ed-b33c5c6688d5', 'החשבון של Yaniv Shmidt', '2026-03-12T06:15:45.723000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shmidtyaniv@gmail.com', 'a0266824-a48a-4a6c-b1ed-b33c5c6688d5', 'Yaniv Shmidt', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('6cfda9f3-dbce-405b-a3bd-be92edabd9ed', 'a0266824-a48a-4a6c-b1ed-b33c5c6688d5', 'רכב', 'יונדאי', 'TUCSON', 2022, '76328602', NULL, NULL, '2027-02-01', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('0dcebbf8-9a0d-4713-a23a-0174d4f21bba', 'a0266824-a48a-4a6c-b1ed-b33c5c6688d5', '6cfda9f3-dbce-405b-a3bd-be92edabd9ed', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של baruchitv
INSERT INTO accounts (id, name, created_at) VALUES ('ac236626-5040-4d75-951b-d625858dcb23', 'החשבון של baruchitv', '2026-03-12T05:52:03.908000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('baruchitv2025@gmail.com', 'ac236626-5040-4d75-951b-d625858dcb23', 'baruchitv', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Denis Lezgin
INSERT INTO accounts (id, name, created_at) VALUES ('3ee0a9f7-f084-4c17-9f64-c6a2d6fe9cee', 'החשבון של Denis Lezgin', '2026-03-12T04:58:46.339000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('denis.lezgin@gmail.com', '3ee0a9f7-f084-4c17-9f64-c6a2d6fe9cee', 'Denis Lezgin', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של roee1454
INSERT INTO accounts (id, name, created_at) VALUES ('bd56a09a-c77b-4b8f-8c84-a1f1be948dd6', 'החשבון של roee1454', '2026-03-11T17:20:13.765000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('roee1454@gmail.com', 'bd56a09a-c77b-4b8f-8c84-a1f1be948dd6', 'roee1454', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Avraham Rost
INSERT INTO accounts (id, name, created_at) VALUES ('61d30e3e-89cb-4811-a77a-da941bb11850', 'החשבון של Avraham Rost', '2026-03-11T16:19:10.718000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avraham.rost@gmail.com', '61d30e3e-89cb-4811-a77a-da941bb11850', 'Avraham Rost', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של שלמה פופוביץ
INSERT INTO accounts (id, name, created_at) VALUES ('77440c55-f276-4c1b-8f26-42495e5a0e1e', 'החשבון של שלמה פופוביץ', '2026-03-11T14:20:18.375000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('aknvpupuch@gmail.com', '77440c55-f276-4c1b-8f26-42495e5a0e1e', 'שלמה פופוביץ', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של haim shamah
INSERT INTO accounts (id, name, created_at) VALUES ('f660c610-0ed4-4d20-8516-a38ceb698d85', 'החשבון של haim shamah', '2026-03-11T12:08:17.395000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('h0525950666@gmail.com', 'f660c610-0ed4-4d20-8516-a38ceb698d85', 'haim shamah', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של רון אביטן
INSERT INTO accounts (id, name, created_at) VALUES ('f9140cfc-71d9-4e7d-abaf-eec71f2211a6', 'החשבון של רון אביטן', '2026-03-11T10:13:44.951000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ronavitan2810@gmail.com', 'f9140cfc-71d9-4e7d-abaf-eec71f2211a6', 'רון אביטן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Eden sitkovetsky
INSERT INTO accounts (id, name, created_at) VALUES ('b9ce99d7-6669-45ea-9088-b3c29569daa4', 'החשבון של Eden sitkovetsky', '2026-03-11T08:45:06.804000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('edensit139@gmail.com', 'b9ce99d7-6669-45ea-9088-b3c29569daa4', 'Eden sitkovetsky', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של שי ימין
INSERT INTO accounts (id, name, created_at) VALUES ('848cf01f-e067-491c-97bf-9cc8b0b1a841', 'החשבון של שי ימין', '2026-03-11T08:07:49.285000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shayyamin56@gmail.com', '848cf01f-e067-491c-97bf-9cc8b0b1a841', 'שי ימין', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('fa029c5f-2b1e-4312-9b77-9787f68262d3', '848cf01f-e067-491c-97bf-9cc8b0b1a841', 'רכב', 'אופל', NULL, NULL, '1212121', NULL, NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של גידי סמך
INSERT INTO accounts (id, name, created_at) VALUES ('e90ae797-2beb-4e9e-b6d3-1c0d271939e5', 'החשבון של גידי סמך', '2026-03-11T07:01:49.031000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('gidi890@gmail.com', 'e90ae797-2beb-4e9e-b6d3-1c0d271939e5', 'גידי סמך', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Aviv Driham
INSERT INTO accounts (id, name, created_at) VALUES ('ec2381d1-b8a7-4a77-8d6f-396cf38623d7', 'החשבון של Aviv Driham', '2026-03-11T06:15:51.419000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avivdr1995@gmail.com', 'ec2381d1-b8a7-4a77-8d6f-396cf38623d7', 'Aviv Driham', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('2af992ea-2695-4ec6-8f86-a7a42a44b16f', 'ec2381d1-b8a7-4a77-8d6f-396cf38623d7', 'רכב', 'סוזוקי', 'ויטרה', 2016, '9994537', 'הויטרה של הבית', 118381, '2027-04-10', '2026-07-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('6ead2670-1465-4544-bcd2-7ad6cca08488', 'ec2381d1-b8a7-4a77-8d6f-396cf38623d7', 'רכב', 'טויוטה', 'יאריס', 2016, '8519181', 'היאריס של אביב', NULL, '2026-10-30', '2026-08-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('5218d861-5663-49dd-ac00-50c97a092765', '2af992ea-2695-4ec6-8f86-a7a42a44b16f', 'small', 'טיפול קטן', '2025-04-06', 'מוסך', NULL, NULL, 104956) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('b69ec368-dc75-490e-9b3f-6afab034ca1f', '6ead2670-1465-4544-bcd2-7ad6cca08488', 'small', 'טיפול קטן', '2026-09-09', 'מוסך', NULL, 'טיפול עתידי נדרש', 145000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('2c177b4a-7a8a-4945-b7c3-621ca0fbdd9f', '6ead2670-1465-4544-bcd2-7ad6cca08488', 'small', 'טיפול קטן', '2025-07-29', 'מוסך', 535, 'טיפול 130 אלף ', 131200) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של רון מור יוסף
INSERT INTO accounts (id, name, created_at) VALUES ('9af85b66-3136-4992-a872-8741ab5e73eb', 'החשבון של רון מור יוסף', '2026-03-11T05:36:20.304000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ronmor1412@gmail.com', '9af85b66-3136-4992-a872-8741ab5e73eb', 'רון מור יוסף', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ronna Spiegel
INSERT INTO accounts (id, name, created_at) VALUES ('d9a10f20-2fc7-47ba-8a72-1989d08051fd', 'החשבון של Ronna Spiegel', '2026-03-10T23:55:08.405000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ronnaspiegel@gmail.com', 'd9a10f20-2fc7-47ba-8a72-1989d08051fd', 'Ronna Spiegel', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של guycoful
INSERT INTO accounts (id, name, created_at) VALUES ('1a14fe56-793a-4d46-a3c3-9cf19f01f585', 'החשבון של guycoful', '2026-03-10T23:47:05.977000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('guycoful@gmail.com', '1a14fe56-793a-4d46-a3c3-9cf19f01f585', 'guycoful', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('b4aa617e-a6ba-49cb-b2b3-dbfd7f440040', '1a14fe56-793a-4d46-a3c3-9cf19f01f585', 'רכב', 'סוזוקי', 'SWIFT', 2007, '9391863', NULL, 116000, '2026-08-06', '2026-07-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('f9eb3c25-216b-4a26-8430-035b2c29ad43', '1a14fe56-793a-4d46-a3c3-9cf19f01f585', 'b4aa617e-a6ba-49cb-b2b3-dbfd7f440040', 'רישיון נהיגה', 'רישיון נהיגה', '2024-10-22', '2029-10-22') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('a85d7398-ebf4-42ad-8f0b-1aadf563a212', '1a14fe56-793a-4d46-a3c3-9cf19f01f585', 'b4aa617e-a6ba-49cb-b2b3-dbfd7f440040', 'צד ג', 'חובה וצד ג', '2025-08-01', '2026-07-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('7c428c7d-fa1d-4462-ac46-85a7642f25fa', '1a14fe56-793a-4d46-a3c3-9cf19f01f585', 'b4aa617e-a6ba-49cb-b2b3-dbfd7f440040', 'ביטוח חובה', 'חובה וצד ג', '2025-08-01', '2026-07-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('11026097-c3eb-4781-9797-6fd16acf06d6', '1a14fe56-793a-4d46-a3c3-9cf19f01f585', 'b4aa617e-a6ba-49cb-b2b3-dbfd7f440040', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של סאלי חליף
INSERT INTO accounts (id, name, created_at) VALUES ('417fcc96-cbb0-4518-b9d4-11c10bfeae0c', 'החשבון של סאלי חליף', '2026-03-10T23:03:16.111000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sali2610@gmail.com', '417fcc96-cbb0-4518-b9d4-11c10bfeae0c', 'סאלי חליף', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('c4cb0dd0-862b-430f-b66d-b1c8354ed426', '417fcc96-cbb0-4518-b9d4-11c10bfeae0c', 'רכב', 'קיה', NULL, 2021, '64937402', 'נירו', 68500, '2026-07-14', '2027-03-11') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של קובי אליאסי
INSERT INTO accounts (id, name, created_at) VALUES ('4f457626-4c31-415b-a4b7-5eeec5743648', 'החשבון של קובי אליאסי', '2026-03-10T22:32:17.243000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yakov3036@gmail.com', '4f457626-4c31-415b-a4b7-5eeec5743648', 'קובי אליאסי', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Yossi Jacobi
INSERT INTO accounts (id, name, created_at) VALUES ('c6353081-f4f4-4201-bedb-76a823344735', 'החשבון של Yossi Jacobi', '2026-03-10T22:29:46.642000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('0527175389v@gmail.com', 'c6353081-f4f4-4201-bedb-76a823344735', 'Yossi Jacobi', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של noamjusto12
INSERT INTO accounts (id, name, created_at) VALUES ('b3247250-4927-4296-9585-27bbeda55952', 'החשבון של noamjusto12', '2026-03-10T22:08:38.023000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('noamjusto12@gmail.com', 'b3247250-4927-4296-9585-27bbeda55952', 'noamjusto12', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Shon Lev
INSERT INTO accounts (id, name, created_at) VALUES ('68bcd99e-23cb-4038-ba5a-9e5ed4d5f772', 'החשבון של Shon Lev', '2026-03-10T22:07:38.124000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shonlev978@gmail.com', '68bcd99e-23cb-4038-ba5a-9e5ed4d5f772', 'Shon Lev', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של אלחנן חזן
INSERT INTO accounts (id, name, created_at) VALUES ('45b3ad6d-fc75-46ba-9cc8-cd463e51afd2', 'החשבון של אלחנן חזן', '2026-03-10T21:45:48.645000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('elhanan138@gmail.com', '45b3ad6d-fc75-46ba-9cc8-cd463e51afd2', 'אלחנן חזן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של samuelninja100755
INSERT INTO accounts (id, name, created_at) VALUES ('e5296dce-2746-49dd-a2d0-aa0f672909bf', 'החשבון של samuelninja100755', '2026-03-10T21:41:47.975000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('samuelninja100755@gmail.com', 'e5296dce-2746-49dd-a2d0-aa0f672909bf', 'samuelninja100755', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ariallk19998
INSERT INTO accounts (id, name, created_at) VALUES ('6e0b6f20-e1de-483a-b120-02c5b3c50d06', 'החשבון של ariallk19998', '2026-03-10T21:32:07.708000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ariallk19998@gmail.com', '6e0b6f20-e1de-483a-b120-02c5b3c50d06', 'ariallk19998', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של אביעד לוי
INSERT INTO accounts (id, name, created_at) VALUES ('a86e7ccb-a9d9-471b-82cf-636a937c32ad', 'החשבון של אביעד לוי', '2026-03-10T20:43:25.550000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('aviadlevy@gmail.com', 'a86e7ccb-a9d9-471b-82cf-636a937c32ad', 'אביעד לוי', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של עוז גואטע
INSERT INTO accounts (id, name, created_at) VALUES ('6a9c9305-e4f7-441d-a422-b29e5cab7188', 'החשבון של עוז גואטע', '2026-03-10T20:42:51.879000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ozguetta777@gmail.com', '6a9c9305-e4f7-441d-a422-b29e5cab7188', 'עוז גואטע', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Amitai cohen
INSERT INTO accounts (id, name, created_at) VALUES ('6d6081f8-4627-4bbd-87be-bb281b013465', 'החשבון של Amitai cohen', '2026-03-10T18:01:58.494000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('amitai.co@gmail.com', '6d6081f8-4627-4bbd-87be-bb281b013465', 'Amitai cohen', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Amit Cohen
INSERT INTO accounts (id, name, created_at) VALUES ('5b7ceb9b-0479-4636-b1b1-21a1a0a4b8fd', 'החשבון של Amit Cohen', '2026-03-10T16:42:58.987000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('amitnaserv@gmail.com', '5b7ceb9b-0479-4636-b1b1-21a1a0a4b8fd', 'Amit Cohen', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Gil Fitussi
INSERT INTO accounts (id, name, created_at) VALUES ('22cfcd2e-8375-4a31-828a-cb0ffb41aa63', 'החשבון של Gil Fitussi', '2026-03-10T16:22:12.698000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('gigo1985@gmail.com', '22cfcd2e-8375-4a31-828a-cb0ffb41aa63', 'Gil Fitussi', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של autofix
INSERT INTO accounts (id, name, created_at) VALUES ('97c5dd41-8308-4d25-b8e9-b4a99ef88e1c', 'החשבון של autofix', '2026-03-10T15:50:57.778000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('contact.autofix.app@gmail.com', '97c5dd41-8308-4d25-b8e9-b4a99ef88e1c', 'autofix', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של liam sharf
INSERT INTO accounts (id, name, created_at) VALUES ('8e64a176-c449-4b59-a89c-cd6a66006142', 'החשבון של liam sharf', '2026-03-10T15:32:10.064000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('liamsh1979@gmail.com', '8e64a176-c449-4b59-a89c-cd6a66006142', 'liam sharf', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של עידן טייאר
INSERT INTO accounts (id, name, created_at) VALUES ('556c9bab-06d9-409f-9487-300275a59e7c', 'החשבון של עידן טייאר', '2026-03-09T08:49:10.554000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('idantayar@gmail.com', '556c9bab-06d9-409f-9487-300275a59e7c', 'עידן טייאר', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('d6c96662-1d4e-4345-99b9-f178aaa4a03d', '556c9bab-06d9-409f-9487-300275a59e7c', 'רכב', 'ניסאן', 'אקס טרייל', 2018, '19708501', 'ניסאן', 106000, '2027-01-09', '2026-04-01') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של eliran k
INSERT INTO accounts (id, name, created_at) VALUES ('e5e75c9a-c1bf-4858-9adf-de76c052ad20', 'החשבון של eliran k', '2026-03-08T15:47:28.686000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('k.elirans@gmail.com', 'e5e75c9a-c1bf-4858-9adf-de76c052ad20', 'eliran k', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של מוטי יוסף
INSERT INTO accounts (id, name, created_at) VALUES ('24a55c6f-6908-4551-bf57-fc60e9d22406', 'החשבון של מוטי יוסף', '2026-03-08T13:33:07.847000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('motiyosef2020@gmail.com', '24a55c6f-6908-4551-bf57-fc60e9d22406', 'מוטי יוסף', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('97a5e815-4ddd-47ee-94be-40b6aff5da99', '24a55c6f-6908-4551-bf57-fc60e9d22406', 'רכב', 'יונדאי', 'טוסון', 2007, '7374261', 'האוטו שלי', 230000, NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Matan Etiel
INSERT INTO accounts (id, name, created_at) VALUES ('a3f86ae3-a701-49f9-959e-99d366b5451f', 'החשבון של Matan Etiel', '2026-03-08T12:53:52.378000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('matan.etiel@gmail.com', 'a3f86ae3-a701-49f9-959e-99d366b5451f', 'Matan Etiel', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של נתנאל שמש
INSERT INTO accounts (id, name, created_at) VALUES ('9098dbed-8956-4b80-8789-4c3d38154f2f', 'החשבון של נתנאל שמש', '2026-03-07T19:25:34.398000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ntnlshmsh@gmail.com', '9098dbed-8956-4b80-8789-4c3d38154f2f', 'נתנאל שמש', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('0b86fa85-4fb6-48c3-83f7-89b2af6127fe', '9098dbed-8956-4b80-8789-4c3d38154f2f', 'רכב', 'יונדאי', 'I25', 2015, '3885134', NULL, 150000, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('6f31e45c-28bf-4c61-8579-c17987e1b67f', '0b86fa85-4fb6-48c3-83f7-89b2af6127fe', 'small', 'טיפול קטן', '2025-09-07', 'מוסך', 500, NULL, 150000) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Robi marvad
INSERT INTO accounts (id, name, created_at) VALUES ('cd49ad8e-cb93-4327-9684-2f981e9710c5', 'החשבון של Robi marvad', '2026-03-07T19:14:04.799000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('robmarv100@gmail.com', 'cd49ad8e-cb93-4327-9684-2f981e9710c5', 'Robi marvad', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ידידיה המבורגר
INSERT INTO accounts (id, name, created_at) VALUES ('8256b0b6-8be9-4b51-ae20-c98f68fa9e8c', 'החשבון של ידידיה המבורגר', '2026-03-07T19:10:12.530000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yedidya2012@gmail.com', '8256b0b6-8be9-4b51-ae20-c98f68fa9e8c', 'ידידיה המבורגר', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ohad Halabi
INSERT INTO accounts (id, name, created_at) VALUES ('697c5eb5-f38e-4a49-b9cb-da1471cf7f6b', 'החשבון של Ohad Halabi', '2026-03-07T18:44:03.862000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ohadhalabi@gmail.com', '697c5eb5-f38e-4a49-b9cb-da1471cf7f6b', 'Ohad Halabi', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Itai Aminia
INSERT INTO accounts (id, name, created_at) VALUES ('c24fc34f-00f2-4dc2-a05f-1cc0caee7be7', 'החשבון של Itai Aminia', '2026-03-07T18:32:48.261000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('aminia4@gmail.com', 'c24fc34f-00f2-4dc2-a05f-1cc0caee7be7', 'Itai Aminia', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של yossipoli
INSERT INTO accounts (id, name, created_at) VALUES ('56d088f6-4e56-4367-a21b-31f4eef9f26a', 'החשבון של yossipoli', '2026-03-07T07:37:21.418000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yossipoli@gmail.com', '56d088f6-4e56-4367-a21b-31f4eef9f26a', 'yossipoli', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של גל אסף
INSERT INTO accounts (id, name, created_at) VALUES ('f4f41080-d4af-4fcd-b7ba-885e2080ee47', 'החשבון של גל אסף', '2026-03-06T19:26:11.612000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('gal2asaf@gmail.com', 'f4f41080-d4af-4fcd-b7ba-885e2080ee47', 'גל אסף', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ofek peer
INSERT INTO accounts (id, name, created_at) VALUES ('3e36a2d6-f922-44fa-b6e3-61489b51e9be', 'החשבון של ofek peer', '2026-03-06T11:02:50.843000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ofekpeer1@gmail.com', '3e36a2d6-f922-44fa-b6e3-61489b51e9be', 'ofek peer', NULL, '1994-07-22', '9466832', '2028-07-22') ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('11870435-fd26-487f-a790-4ca0292ce9e2', '3e36a2d6-f922-44fa-b6e3-61489b51e9be', 'רכב', 'קיה', 'SELTOS', 2025, '29323204', 'רגב חברה', 9500, '2026-05-20', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('7a2de052-e0c1-4f98-b55f-3089d9b0547a', '3e36a2d6-f922-44fa-b6e3-61489b51e9be', '11870435-fd26-487f-a790-4ca0292ce9e2', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Liron Bekman
INSERT INTO accounts (id, name, created_at) VALUES ('88e44ab4-3bf7-44b2-b80e-dc3accf40dae', 'החשבון של Liron Bekman', '2026-03-06T08:41:22.261000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('lironbek88@gmail.com', '88e44ab4-3bf7-44b2-b80e-dc3accf40dae', 'Liron Bekman', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של idan sarig
INSERT INTO accounts (id, name, created_at) VALUES ('17907f16-0849-44fc-a7c0-6ad1e5a73090', 'החשבון של idan sarig', '2026-03-06T08:33:06.554000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('idans1988@gmail.com', '17907f16-0849-44fc-a7c0-6ad1e5a73090', 'idan sarig', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Roi Peretz
INSERT INTO accounts (id, name, created_at) VALUES ('e271b320-ef8d-4952-ba87-8e7a1eecc7d5', 'החשבון של Roi Peretz', '2026-03-06T08:22:35.611000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('roi333@gmail.com', 'e271b320-ef8d-4952-ba87-8e7a1eecc7d5', 'Roi Peretz', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Gadi Israeli
INSERT INTO accounts (id, name, created_at) VALUES ('75240b51-6969-4786-a3a4-1e146d53a5e8', 'החשבון של Gadi Israeli', '2026-03-06T08:20:37.564000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('gadi.israeli@gmail.com', '75240b51-6969-4786-a3a4-1e146d53a5e8', 'Gadi Israeli', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('a54d31d4-f5a4-48db-87f5-264b3df0a022', '75240b51-6969-4786-a3a4-1e146d53a5e8', 'רכב', 'מאזדה', '3', 2011, '6965271', 'המאזדה של גדי ', 162000, '2026-08-29', '2027-01-31') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של ארז גביר
INSERT INTO accounts (id, name, created_at) VALUES ('05cfa472-0c01-47eb-bf1e-37e20474f103', 'החשבון של ארז גביר', '2026-03-05T18:38:25.241000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('erezgv@gmail.com', '05cfa472-0c01-47eb-bf1e-37e20474f103', 'ארז גביר', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של regev0987
INSERT INTO accounts (id, name, created_at) VALUES ('bed7011f-ff68-439f-8afa-9dc560a32ed4', 'החשבון של regev0987', '2026-03-05T17:52:56.065000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('arad997@gmail.com', 'bed7011f-ff68-439f-8afa-9dc560a32ed4', 'regev0987', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של משה טיירי אלוש
INSERT INTO accounts (id, name, created_at) VALUES ('73698b3e-5cc1-40c5-ad64-801df3dfabb6', 'החשבון של משה טיירי אלוש', '2026-03-05T17:39:49.126000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('allushe.m@gmail.com', '73698b3e-5cc1-40c5-ad64-801df3dfabb6', 'משה טיירי אלוש', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ran buganim
INSERT INTO accounts (id, name, created_at) VALUES ('62f24c16-808f-44ba-be62-cd90e8194b7e', 'החשבון של ran buganim', '2026-03-05T17:34:00.916000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ranbuganim@gmail.com', '62f24c16-808f-44ba-be62-cd90e8194b7e', 'ran buganim', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('5f82a5a1-79c7-46bb-999f-2361ae56fd0f', '62f24c16-808f-44ba-be62-cd90e8194b7e', 'רכב', 'רנו', 'Capture', 2015, '9728031', 'של נופר', 156000, NULL, '2026-05-01') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של dorverchik
INSERT INTO accounts (id, name, created_at) VALUES ('5699cc04-d208-4a12-beb9-1b035b183de3', 'החשבון של dorverchik', '2026-03-05T10:10:06.461000') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('d42d0bca-ced9-43ee-843b-a0acf5b6bfe6', '5699cc04-d208-4a12-beb9-1b035b183de3', 'רכב', 'לקסוס', 'Ct200h', 2015, '123456', NULL, 170000, '2026-07-01', '2027-01-01') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('0a4fe0fd-c23b-4ab6-ad24-9020858bdc1b', '5699cc04-d208-4a12-beb9-1b035b183de3', 'd42d0bca-ced9-43ee-843b-a0acf5b6bfe6', 'רישיון רכב', 'רשיון', '2026-03-05', '2026-10-22') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של איתן דן
INSERT INTO accounts (id, name, created_at) VALUES ('f1af02ca-a770-4a7a-a446-4c1577a71370', 'החשבון של איתן דן', '2026-03-03T17:06:31.638000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('eitandan7530@gmail.com', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'איתן דן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('17ad332a-95c5-4f7f-94a8-0b51657019ab', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'רכב', 'וולוו', 'S60', 2009, '5761370', NULL, 270000, '2026-10-29', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('ac4e6c46-8701-435f-9f00-b3e6dc1c99cc', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'רכב', 'סוזוקי', 'ויטרה', 1993, '8707205', 'אספנות', 14000, '2024-04-03', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('ec7d0608-d845-44a6-86b7-67fb5024bfc2', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'רכב', 'וולוו', 'v40', 2016, '4182208', 'רכב של שרית', 135000, '2026-06-29', '2027-02-28') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('8f51be6e-757f-4a03-89a8-ffb1cb1a83ef', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'אופנוע', 'ב.מ.וו', NULL, 2013, '8294075', 'f800gs', 141000, '2026-01-08', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('f3b850b9-95c4-4f6b-a757-3f4c2a58dc98', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'אופנוע', 'Kawasaki', 'sx1000z', 2016, '7967834', 'קווסאקי', 85000, '2026-03-12', '2026-03-17') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('7c4cc449-57fc-43dd-aa24-7a3148000ba1', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'אופנוע', 'הונדה', 'ורדארו', 2007, '6537464', 'אופנוע תיור ', 175000, '2026-11-05', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('0a8c27ab-d2e2-4302-853e-94d9f66d76b5', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'עגלה נגררת', 'פז נגררים', 'עגלה פתוחה ', 2013, '9809574', 'נגרר', NULL, '2026-10-16', '2026-10-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('1332ef3c-7744-4161-bcd8-e6e6d27faa6e', 'f3b850b9-95c4-4f6b-a757-3f4c2a58dc98', NULL, 'טיפול', '2025-12-17', 'אני', 700, 'טיפול גדול
שמן ,פילטרים,מצתים', 85000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('59679cb5-3c9f-4049-a108-f099f38c9bca', '8f51be6e-757f-4a03-89a8-ffb1cb1a83ef', 'תיקון', 'מערכת חשמל', '2026-02-11', 'אני', 600, 'החלפת יח מתג הנעה ') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('378e7427-83da-421d-9c11-e990702422ad', '8f51be6e-757f-4a03-89a8-ffb1cb1a83ef', 'תיקון', 'תיקון מערכת קירור', '2025-10-23', 'אני', 500, 'החלפת אטם מכני במשאבת מים
תיקון קולר שמן') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('46f4b523-7ad8-47bf-9a52-b51d0a3a5f37', 'f3b850b9-95c4-4f6b-a757-3f4c2a58dc98', 'תיקון', 'כיוון שסתומים והחלפת שרשרת טיימינג', '2026-02-26', 'אני', 750, 'כיוון שסתומים החלפת שרשרת טיימינג 
החלפת כויילים
') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('dd5e2e83-1c3b-43b1-9f96-20c28781ceb3', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'ec7d0608-d845-44a6-86b7-67fb5024bfc2', 'ביטוח מקיף', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('5764738a-e31d-41b4-9c73-baa4a5490ef2', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'ec7d0608-d845-44a6-86b7-67fb5024bfc2', 'ביטוח חובה', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('dcb04344-29c2-406a-a4ab-fda52d1896c4', 'f1af02ca-a770-4a7a-a446-4c1577a71370', '0a8c27ab-d2e2-4302-853e-94d9f66d76b5', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('5de7a6d2-18ba-48dd-8e47-d127c6816bcc', 'f1af02ca-a770-4a7a-a446-4c1577a71370', '17ad332a-95c5-4f7f-94a8-0b51657019ab', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('50d91aa9-e3fe-4376-a8a1-d860afc2b156', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'ac4e6c46-8701-435f-9f00-b3e6dc1c99cc', 'מסמך אחר', 'מידע אודות רכב', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('1e14ab20-0d18-402c-a9f5-c0a86bb36792', 'f1af02ca-a770-4a7a-a446-4c1577a71370', '7c4cc449-57fc-43dd-aa24-7a3148000ba1', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('0d84f57e-42b7-421c-8440-71165ac8a299', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'ec7d0608-d845-44a6-86b7-67fb5024bfc2', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('7a769703-ea63-4f24-b48b-232b2acebf9f', 'f1af02ca-a770-4a7a-a446-4c1577a71370', '8f51be6e-757f-4a03-89a8-ffb1cb1a83ef', 'מסמך אחר', 'מידע אודות הרכב', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('e3b315c3-b99e-4378-a199-0cd5324783e3', 'f1af02ca-a770-4a7a-a446-4c1577a71370', 'f3b850b9-95c4-4f6b-a757-3f4c2a58dc98', 'רישיון רכב', 'קניון ', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Or Moshe
INSERT INTO accounts (id, name, created_at) VALUES ('e049d37c-a806-41f4-b33e-fe91128fb2e5', 'החשבון של Or Moshe', '2026-02-27T07:59:46.002000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('orrmoshe543@gmail.com', 'e049d37c-a806-41f4-b33e-fe91128fb2e5', 'Or Moshe', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של shafir shnarch
INSERT INTO accounts (id, name, created_at) VALUES ('41c2b8cf-7221-440d-b745-93b5b8892496', 'החשבון של shafir shnarch', '2026-02-27T07:48:07.205000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shafirs@gmail.com', '41c2b8cf-7221-440d-b745-93b5b8892496', 'shafir shnarch', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('bc96a6c7-daf0-4f7f-bf43-fe22afaa848d', '41c2b8cf-7221-440d-b745-93b5b8892496', 'רכב', 'יונדאי', 'טראקאן', 2003, '9292251', 'טראקאן', NULL, '2026-04-07', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('4b135ca3-d602-4374-9824-1eac92c6374c', '41c2b8cf-7221-440d-b745-93b5b8892496', 'רכב', 'ניסאן', 'סנטרה', 2020, '86170101', 'של איילה', NULL, '2027-01-06', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('29ac00eb-76fd-4dd0-a5be-78399284ff18', '41c2b8cf-7221-440d-b745-93b5b8892496', 'אופנוע שטח', 'KTM', 'גאס גאס 250', 2022, '47980202', 'גאס גאס', NULL, '2026-06-27', '2026-06-27') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('9f2ac937-1905-413b-b946-ec808cb85535', '41c2b8cf-7221-440d-b745-93b5b8892496', 'אופנוע כביש', 'סוזוקי', 'DR800 BIG', 1997, '3246201', 'ביג', NULL, '2026-05-04', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('35694d1c-801b-46b0-a024-a78edb46b66b', '41c2b8cf-7221-440d-b745-93b5b8892496', 'אופנוע שטח', 'KTM', '250', 2019, '32598701', 'האסקי של עידו', NULL, '2024-10-29', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Dor Edelshtein
INSERT INTO accounts (id, name, created_at) VALUES ('610b6272-5aad-4533-946e-9868deb61b62', 'החשבון של Dor Edelshtein', '2026-02-27T07:29:47.606000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('dor6975577@gmail.com', '610b6272-5aad-4533-946e-9868deb61b62', 'Dor Edelshtein', '0526975577', '1998-03-15', NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('49fbc526-69a4-49a3-8a8b-28301858f79f', '610b6272-5aad-4533-946e-9868deb61b62', 'רכב', 'סיאט', 'IBIZA', 2018, '57816501', NULL, 73700, '2026-10-18', '2026-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('9739d965-d5d8-46d2-b8f2-3b51f93344bc', '610b6272-5aad-4533-946e-9868deb61b62', '49fbc526-69a4-49a3-8a8b-28301858f79f', 'ביטוח מקיף', 'פוליסה איילון 2026', '2026-05-01', '2026-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('60072196-bf30-4b0f-8950-792b2071200e', '610b6272-5aad-4533-946e-9868deb61b62', '49fbc526-69a4-49a3-8a8b-28301858f79f', 'ביטוח חובה', 'חובה איילון 2026', '2026-05-01', '2027-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('a7aca368-1a87-45e6-8bcf-c3296a449101', '610b6272-5aad-4533-946e-9868deb61b62', '49fbc526-69a4-49a3-8a8b-28301858f79f', 'ביטוח מקיף', 'פוליסת ביטוח', '2025-05-01', '2026-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('be8a4785-c928-449e-8fab-b63c16759029', '610b6272-5aad-4533-946e-9868deb61b62', '49fbc526-69a4-49a3-8a8b-28301858f79f', 'ביטוח חובה', 'ביטוח חובה', '2025-05-01', '2026-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('a53da8ca-9ce2-46b4-ad6c-6b34ba21a90e', '610b6272-5aad-4533-946e-9868deb61b62', '49fbc526-69a4-49a3-8a8b-28301858f79f', 'רישיון רכב', 'רישיון רכב', '2025-09-30', '2026-10-18') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של avivsulimani0
INSERT INTO accounts (id, name, created_at) VALUES ('594ad973-ccba-4eb7-ad20-d14b81273e04', 'החשבון של avivsulimani0', '2026-02-26T19:42:15.708000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avivsulimani0@gmail.com', '594ad973-ccba-4eb7-ad20-d14b81273e04', 'avivsulimani0', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Meni Israel
INSERT INTO accounts (id, name, created_at) VALUES ('9534313c-d2fa-4a4a-8008-b42f408615b0', 'החשבון של Meni Israel', '2026-02-26T10:27:23.961000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('meni@wittix.com', '9534313c-d2fa-4a4a-8008-b42f408615b0', 'Meni Israel', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('22fdedac-8f19-42cd-a6d1-83459a467484', '9534313c-d2fa-4a4a-8008-b42f408615b0', 'עגלה נגררת', 'גרורי אמון', NULL, 2025, '49061004', NULL, NULL, '2027-12-03', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של אבי אדלשטיין
INSERT INTO accounts (id, name, created_at) VALUES ('b7ebfad0-1171-47c9-ac65-dcefa34b5568', 'החשבון של אבי אדלשטיין', '2026-02-25T12:30:44.058000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avimaar@gmail.com', 'b7ebfad0-1171-47c9-ac65-dcefa34b5568', 'אבי אדלשטיין', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Josh Saffar
INSERT INTO accounts (id, name, created_at) VALUES ('75964ebf-2d66-4330-921f-7b57d730a1ed', 'החשבון של Josh Saffar', '2026-02-25T11:56:01.639000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('joshua.sefer@gmail.com', '75964ebf-2d66-4330-921f-7b57d730a1ed', 'Josh Saffar', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Liron Makdasi
INSERT INTO accounts (id, name, created_at) VALUES ('68281e82-703b-417f-96fb-b9f506577d31', 'החשבון של Liron Makdasi', '2026-02-25T08:47:32.155000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('liron@payplus.co.il', '68281e82-703b-417f-96fb-b9f506577d31', 'Liron Makdasi', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Einav Ahvan
INSERT INTO accounts (id, name, created_at) VALUES ('7da36ab9-b866-4e4a-8eaa-524a1521a413', 'החשבון של Einav Ahvan', '2026-02-25T08:20:02.984000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('einav.ahvan@gmail.com', '7da36ab9-b866-4e4a-8eaa-524a1521a413', 'Einav Ahvan', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('1e8155db-2592-4a9b-aa76-d7708e3c86d4', '7da36ab9-b866-4e4a-8eaa-524a1521a413', 'רכב', 'סיאט', 'איביזה', 2017, '37201701', 'סיאט איביזה', 117000, '2027-01-25', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Niv Ben Oz
INSERT INTO accounts (id, name, created_at) VALUES ('ada93e25-8ce0-4ccb-9aa5-63074a0fcbf8', 'החשבון של Niv Ben Oz', '2026-02-25T05:41:08.194000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('nivblind@gmail.com', 'ada93e25-8ce0-4ccb-9aa5-63074a0fcbf8', 'Niv Ben Oz', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('99a4a8f6-36ef-45b1-a128-87c06add09f3', 'ada93e25-8ce0-4ccb-9aa5-63074a0fcbf8', 'רכב', 'פולקסווגן', NULL, 2016, '2482938', NULL, NULL, '2026-02-25', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('88b556e1-5967-4419-9770-5dd58405490c', 'ada93e25-8ce0-4ccb-9aa5-63074a0fcbf8', 'אופנוע', 'הונדה', NULL, 2023, '31503603', NULL, 47000, '2026-02-25', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('1b0b1452-7396-47ba-87bb-269940d24ef2', 'ada93e25-8ce0-4ccb-9aa5-63074a0fcbf8', 'רכב', 'לנד רובר', NULL, 2020, '71448001', NULL, 115000, '2026-02-25', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של גיא רויזמן
INSERT INTO accounts (id, name, created_at) VALUES ('48e04274-0b9b-4a97-96cf-007df338d470', 'החשבון של גיא רויזמן', '2026-02-24T19:30:48.657000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('guyguy16794@gmail.com', '48e04274-0b9b-4a97-96cf-007df338d470', 'גיא רויזמן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של YOAV JAUI
INSERT INTO accounts (id, name, created_at) VALUES ('178e6b32-6ef5-4af5-b9e5-f8d0d7256291', 'החשבון של YOAV JAUI', '2026-02-24T19:08:40.808000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('jaui.yoav@gmail.com', '178e6b32-6ef5-4af5-b9e5-f8d0d7256291', 'YOAV JAUI', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('f3569b7f-3f2e-4b06-b9ef-d8940f184a99', '178e6b32-6ef5-4af5-b9e5-f8d0d7256291', 'רכב', 'אאודי', 'Q2', 2019, '83934101', 'של רויאל', 140000, '2027-12-24', '2027-01-24') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של אביב קריסטל
INSERT INTO accounts (id, name, created_at) VALUES ('553ebc8e-4a86-4fa4-8649-b238f473654c', 'החשבון של אביב קריסטל', '2026-02-24T18:21:54.931000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avivkristal134@gmail.com', '553ebc8e-4a86-4fa4-8649-b238f473654c', 'אביב קריסטל', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ‫שוהם אדלשטיין (‪shoam edelshtain‬‏)‬‎
INSERT INTO accounts (id, name, created_at) VALUES ('be1afe7f-a0ca-47ce-a2aa-98f0cdc415d0', 'החשבון של ‫שוהם אדלשטיין (‪shoam edelshtain‬‏)‬‎', '2026-02-24T17:57:01.667000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shoam2852004@gmail.com', 'be1afe7f-a0ca-47ce-a2aa-98f0cdc415d0', '‫שוהם אדלשטיין (‪shoam edelshtain‬‏)‬‎', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('a93f1cda-4b6f-4c4d-bb3c-1ea8f9408bdf', 'be1afe7f-a0ca-47ce-a2aa-98f0cdc415d0', 'רכב', 'פולקסווגן', 'גולף', 2019, '83827801', 'הגולף של שוהם', 70000, '2026-10-09', '2026-09-14') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('8242a589-ab8d-463c-860d-f1fe892b41fa', 'a93f1cda-4b6f-4c4d-bb3c-1ea8f9408bdf', NULL, 'טיפול', '2026-02-24', 'מוסך', 1750, 'החלפת רפידות ובלמים', 70000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('244e649d-7bc4-415f-b8c4-d38f3e3b71e4', 'a93f1cda-4b6f-4c4d-bb3c-1ea8f9408bdf', 'תיקון', 'תיקון פנצר בגלגל  ', '2026-02-24', 'מוסך', 60, 'תיקון פנצר בגלגל ימין אחורי') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Sahar Binyamin
INSERT INTO accounts (id, name, created_at) VALUES ('9028c28b-dbfa-4981-8246-33c599ae93fa', 'החשבון של Sahar Binyamin', '2026-02-24T14:05:18.854000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('saharbin90@gmail.com', '9028c28b-dbfa-4981-8246-33c599ae93fa', 'Sahar Binyamin', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('2fdff9c1-c51c-4d3b-8b98-47337a74e2e2', '9028c28b-dbfa-4981-8246-33c599ae93fa', 'רכב', 'מאזדה', 'CX5', 2022, '89936702', 'האוטו של אבאלה', 55000, '2026-05-01', '2026-12-01') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('492d01b7-f507-474e-876a-587e0aab5949', '2fdff9c1-c51c-4d3b-8b98-47337a74e2e2', NULL, 'טיפול', '2026-02-10', 'אני', 500, 'אבא שלי היקר מכל - לקח את הרכב ליום טיפול.
', 55000) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של idosn121
INSERT INTO accounts (id, name, created_at) VALUES ('9adb806d-99c1-44b2-88f1-400b0f8d73b9', 'החשבון של idosn121', '2026-02-24T11:28:32.855000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('idosn121@gmail.com', '9adb806d-99c1-44b2-88f1-400b0f8d73b9', 'idosn121', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
-- SKIPPED duplicate plate: 3246201 (סוזוקי Dr big 800s)

-- Account: החשבון של עומרי רפאלי
INSERT INTO accounts (id, name, created_at) VALUES ('586628cb-5e91-4cdc-9831-871f56972ed1', 'החשבון של עומרי רפאלי', '2026-02-24T10:41:39') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('omrir7@gmail.com', '586628cb-5e91-4cdc-9831-871f56972ed1', 'עומרי רפאלי', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ilan Miller
INSERT INTO accounts (id, name, created_at) VALUES ('9efce20f-118c-4cc8-8b8c-b900e3358b20', 'החשבון של Ilan Miller', '2026-02-24T09:52:53.966000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ilanmi.technion@gmail.com', '9efce20f-118c-4cc8-8b8c-b900e3358b20', 'Ilan Miller', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('a0f8d674-d0ee-42f0-8e78-d2cf2c19d3eb', '9efce20f-118c-4cc8-8b8c-b900e3358b20', 'רכב', 'סוזוקי', 'גימיני', 2022, '10853703', 'הגיפ', NULL, '2026-07-26', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של ברוך אדלשטיין
INSERT INTO accounts (id, name, created_at) VALUES ('51f2bd86-0812-45cc-a9f1-ad0b349033c0', 'החשבון של ברוך אדלשטיין', '2026-02-24T09:19:53.585000') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('c4ef8778-5718-4471-b741-2c6e4f9d6bbf', '51f2bd86-0812-45cc-a9f1-ad0b349033c0', 'רכב', 'סיטרואן צרפת', 'C3', 2010, '1728474', NULL, NULL, '2026-12-07', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('f6b0c68e-f680-411c-9f18-fb3c415a5bab', '51f2bd86-0812-45cc-a9f1-ad0b349033c0', 'אופנוע', 'ימהה יפן', 'VP26 XVS1300', 2011, '2459874', 'אופנוע ימאהה', NULL, '2026-04-27', NULL) ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 1728474 (סיטרואן צרפת C3)
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('1e7f7b46-3a43-4f92-8fbc-ea08f28d89c6', '51f2bd86-0812-45cc-a9f1-ad0b349033c0', 'אופנוע', NULL, NULL, NULL, '9933389', NULL, NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('27ec0d4b-7f30-4b06-a374-ef822850a18e', '51f2bd86-0812-45cc-a9f1-ad0b349033c0', 'רכב', 'ניסאן', 'אקסטריל', 2016, '82-870-37', 'משפחתי ניסן', 177000, '2026-07-27', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('ea56cab7-ff79-42e2-9b13-3af1beb2b87a', '51f2bd86-0812-45cc-a9f1-ad0b349033c0', 'c4ef8778-5718-4471-b741-2c6e4f9d6bbf', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('53e1d566-fb66-4f3a-81c7-7549454e2f07', '51f2bd86-0812-45cc-a9f1-ad0b349033c0', 'f6b0c68e-f680-411c-9f18-fb3c415a5bab', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('d17c36ab-4ac4-48c2-9db8-eb245529f054', '51f2bd86-0812-45cc-a9f1-ad0b349033c0', '4909d84d-5cfd-48a8-a1e1-2306ffd8212f', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של barak643
INSERT INTO accounts (id, name, created_at) VALUES ('b548c7fb-960f-47d9-bd76-7450f5514973', 'החשבון של barak643', '2026-02-24T09:16:40.872000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('barak643@gmail.com', 'b548c7fb-960f-47d9-bd76-7450f5514973', 'barak643', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של natanzone2024
INSERT INTO accounts (id, name, created_at) VALUES ('57d59503-8423-4a3e-8f4d-c48803bc60c6', 'החשבון של natanzone2024', '2026-02-24T09:15:43.118000') ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 8287037 (ניסאן יפן X-TRAIL)
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('404b0e5f-7691-40ab-a34f-e60c6b8c9aee', '57d59503-8423-4a3e-8f4d-c48803bc60c6', 'אופנוע כביש', 'גס גס', NULL, NULL, '664787', 'סוסיתא', 635966, '2026-03-20', '2026-03-13') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('50c7ad36-4a67-4d0f-a7de-34b38aeb3ef3', '57d59503-8423-4a3e-8f4d-c48803bc60c6', '67faf1aa-3538-44a2-8da6-7f5d994d332f', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Roy simplex
INSERT INTO accounts (id, name, created_at) VALUES ('d5830c85-74bc-4b6a-a3c6-2f8afea6f667', 'החשבון של Roy simplex', '2026-02-24T08:57:04.806000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('roy@simplex3d.com', 'd5830c85-74bc-4b6a-a3c6-2f8afea6f667', 'Roy simplex', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('5bd3cab6-ac3e-4321-b979-d504a9925e9b', 'd5830c85-74bc-4b6a-a3c6-2f8afea6f667', 'רכב', 'יונדאי', 'טוסון', 2022, '11868803', 'טוסון', 68000, '2026-08-01', '2026-09-10') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('3f65707d-d8e5-4d6a-8253-07611761fdb7', 'd5830c85-74bc-4b6a-a3c6-2f8afea6f667', 'רכב', 'יונדאי', 'kona', 2019, '77839301', 'קונה', 84000, '2026-06-14', '2026-12-31') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של inbar miller
INSERT INTO accounts (id, name, created_at) VALUES ('e73dfa04-910f-45bd-8524-6200ea1e8a7b', 'החשבון של inbar miller', '2026-02-24T08:53:08.344000') ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 15979503 (יונדאי קונה)

-- Account: החשבון של ofek.ede1994
INSERT INTO accounts (id, name, created_at) VALUES ('3b0963b1-edc9-44f4-8853-12c3cbadeb44', 'החשבון של ofek.ede1994', '2026-02-24T08:26:43.807000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ofek.ede1994@gmail.com', '3b0963b1-edc9-44f4-8853-12c3cbadeb44', 'ofek.ede1994', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ofek205
INSERT INTO accounts (id, name, created_at) VALUES ('c5ef55f8-8219-40ed-acf7-568eee81f7d6', 'החשבון של ofek205', '2026-02-23T12:16:38.534000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ofek205@gmail.com', 'c5ef55f8-8219-40ed-acf7-568eee81f7d6', 'ofek205', '0523043322', '1994-04-17', '9426286', '2028-04-17') ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('a17ed2ac-c03c-4c8a-a25a-d24681fb9fc7', 'c5ef55f8-8219-40ed-acf7-568eee81f7d6', 'רכב', NULL, 'דגגדג', 2025, '55555544', 'יוסי יוסי ', 110000, NULL, NULL) ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 15979503 (יונדאי קונה חשמלית )
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('3fa74d5d-2b0d-48b8-9a15-2678bd0a6ac7', 'c5ef55f8-8219-40ed-acf7-568eee81f7d6', 'אופנוע כביש', 'Piago', 'Mp3 300', 2015, '9397830', 'קטנוע 3 גלגלים ', 120000, '2027-02-01', '2027-02-01') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('d6560b96-45b9-4b63-938a-ea8d6609c643', 'c5ef55f8-8219-40ed-acf7-568eee81f7d6', 'אופנוע', 'Ktm ', 'Exc - f sixdays', 2017, '5183939', 'האופנוע שטח של אופק', NULL, '2025-10-09', '2026-10-09') ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 25908901 (פולסווגן גולף)
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('7c49a35f-b908-4706-ac5e-95f6cfb3c88b', '2af371b0-48bf-4e53-b616-f0deeb526ccc', 'small', 'טיפול קטן', '2026-03-23', 'אני', 250, 'גכרעגעעעכג', 102000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('a93a07e6-9015-4a75-a936-8eab5a0f0552', 'd6560b96-45b9-4b63-938a-ea8d6609c643', 'small', 'טיפול קטן', '2026-03-06', 'אני', 225, 'שפיר קנה שמן ופילטר ועידו עשה את הטיפול', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('2485c028-1981-4b56-ad57-feb15832c614', 'b26ff1ad-cde7-4f16-bae3-b1248c500ce7', NULL, 'טיפול', '2025-08-01', 'אני', 300, NULL, 127000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('dd83579b-b39b-488d-9ef5-5e682274130e', '3fa74d5d-2b0d-48b8-9a15-2678bd0a6ac7', NULL, 'טיפול', '2026-02-01', 'מוסך', 100, 'איתן עשה ', 44000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('6cfbd3f0-0ae6-4424-a60f-b688d9b5e3fb', 'd6560b96-45b9-4b63-938a-ea8d6609c643', NULL, 'טיפול', '2026-02-27', 'אני', 100, 'עידו עושה טיפול שמן ופילטר ', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('5aa70408-682c-41fb-baff-00ad11aa172a', '3fa74d5d-2b0d-48b8-9a15-2678bd0a6ac7', NULL, 'טיפול', '2026-02-01', 'אני', 450, 'הוחלף מצבר', 45000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('0ecde2e6-5475-4465-b3da-b30d97f95f1c', '3fa74d5d-2b0d-48b8-9a15-2678bd0a6ac7', NULL, 'טיפול', '2026-02-01', 'מוסך', NULL, 'איתן החליף אימפלור משאבת מים  ', 45000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('31b6f7da-657f-40e9-ba6e-1b9120771cb3', 'b26ff1ad-cde7-4f16-bae3-b1248c500ce7', NULL, 'טיפול', '2026-02-24', 'מוסך', NULL, NULL, 127000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('6ca3f2fa-6e1b-4f11-b482-3a1bcede7499', 'b26ff1ad-cde7-4f16-bae3-b1248c500ce7', NULL, 'טיפול', '2025-03-01', 'אני', NULL, NULL, 98000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('5d5dd2b1-8aa5-4444-9030-259841a618d9', 'b26ff1ad-cde7-4f16-bae3-b1248c500ce7', NULL, 'טיפול', '2025-01-01', 'אני', NULL, 'החלפנו פלאים למקוריים', 96000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('3181da3f-f3d7-4701-ac6d-ded473e9397a', 'd6560b96-45b9-4b63-938a-ea8d6609c643', NULL, 'טיפול', '2025-04-01', 'מוסך', NULL, 'יניב עשה מנוע עליון ותחתון וגם החליף את הסלילים של האלטרנטור ', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('0cddcc07-d41d-46a9-b288-1107b556f6d7', 'd6560b96-45b9-4b63-938a-ea8d6609c643', NULL, 'טיפול', '2025-10-10', 'אני', NULL, 'לאחר הצהריים בוצע טיפול שמן מנוע ופילטר שמן אצל עידו ', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('fe5361db-b09e-4c19-89e0-8043bec93120', '2af371b0-48bf-4e53-b616-f0deeb526ccc', 'תיקון', 'מכה בדלת ', '2026-03-23', 'אני', 250, 'הנהנמבהב') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('75e4f1a7-5c96-4a34-a7dc-fdc3c0df86a0', 'd6560b96-45b9-4b63-938a-ea8d6609c643', 'תיקון', 'החלפת מצבר', '2025-01-24', 'אני', 500, 'הוחלף מצבר') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('bc833381-6de7-417d-8fcc-9bacbce4cbe8', 'c5ef55f8-8219-40ed-acf7-568eee81f7d6', 'd6560b96-45b9-4b63-938a-ea8d6609c643', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('8314a6d7-cccd-438a-8894-0ff6b8d6321f', 'c5ef55f8-8219-40ed-acf7-568eee81f7d6', 'd6560b96-45b9-4b63-938a-ea8d6609c643', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('9360eff1-9729-4331-89f4-eca4359c8dfb', 'c5ef55f8-8219-40ed-acf7-568eee81f7d6', 'd6560b96-45b9-4b63-938a-ea8d6609c643', 'רישיון רכב', 'רישיון רכב ', '2026-02-24', '2026-10-09') ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ── Step 3: Validation queries (run after migration) ──
SELECT 'accounts' AS entity, COUNT(*) FROM accounts WHERE id IN (SELECT account_id FROM migration_email_map);
SELECT 'vehicles' AS entity, COUNT(*) FROM vehicles WHERE account_id IN (SELECT account_id FROM migration_email_map);
SELECT 'maintenance_logs' AS entity, COUNT(*) FROM maintenance_logs WHERE vehicle_id IN (SELECT id FROM vehicles WHERE account_id IN (SELECT account_id FROM migration_email_map));
SELECT 'documents' AS entity, COUNT(*) FROM documents WHERE account_id IN (SELECT account_id FROM migration_email_map);
SELECT 'email_mappings' AS entity, COUNT(*) FROM migration_email_map;