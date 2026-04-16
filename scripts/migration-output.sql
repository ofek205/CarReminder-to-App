-- ═══════════════════════════════════════════════════════════
-- Base44 → Supabase Migration
-- Generated: 2026-04-16T08:21:26.432Z
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

-- Allow authenticated users to read their own email mapping
ALTER TABLE migration_email_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS migration_email_read ON migration_email_map FOR SELECT TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));
CREATE POLICY IF NOT EXISTS migration_email_update ON migration_email_map FOR UPDATE TO authenticated USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- ── Step 2: Insert migrated data ──
BEGIN;

-- Account: החשבון של חיים הייבלום
INSERT INTO accounts (id, name, created_at) VALUES ('1fea0948-949b-433f-a7ef-0e9112bcfd06', 'החשבון של חיים הייבלום', '2026-04-12T04:20:50.186000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('chaimhaiblum@gmail.com', '1fea0948-949b-433f-a7ef-0e9112bcfd06', 'חיים הייבלום', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('a8ef592a-ce01-4dfc-b7f6-b959bac54301', '1fea0948-949b-433f-a7ef-0e9112bcfd06', 'רכב', 'טויוטה יפן', 'TOYOTA BZ4X', 2023, '559-44-903', NULL, 30500, '2026-08-20', '2026-08-22') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Eyal Artzy
INSERT INTO accounts (id, name, created_at) VALUES ('2bbeb73e-0fa2-4486-9736-685381c7dc0b', 'החשבון של Eyal Artzy', '2026-04-06T09:43:02.734000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('eyal1413@gmail.com', '2bbeb73e-0fa2-4486-9736-685381c7dc0b', 'Eyal Artzy', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של אליהו איסקוב
INSERT INTO accounts (id, name, created_at) VALUES ('4059d582-240e-4e87-8414-c078b1d5924b', 'החשבון של אליהו איסקוב', '2026-03-29T06:48:55.343000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('isakov2012@gmail.com', '4059d582-240e-4e87-8414-c078b1d5924b', 'אליהו איסקוב', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('6b3e0993-7a17-496b-bcac-d717ad67bf50', '4059d582-240e-4e87-8414-c078b1d5924b', 'רכב', 'פיג''ו צרפת', '3008', 2019, '648-00-201', NULL, 95000, '2026-09-04', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של mayavalik
INSERT INTO accounts (id, name, created_at) VALUES ('38bbf9ac-1e54-4474-95a8-ff301d5f2bff', 'החשבון של mayavalik', '2026-03-28T22:37:02.440000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('mayavalik@gmail.com', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', 'mayavalik', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('9510f82b-63dd-4a0b-8824-822c740d34df', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', 'רכב', 'טויוטה טורקיה', 'COROLLA', 2016, '23-138-37', 'טויוטה הורים', NULL, '2026-06-05', '2027-04-01') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('65890ab0-5d6f-4e62-bc4d-7c2779dafa45', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', 'רכב', 'סיאט ספרד', 'IBIZA', 2016, '19-781-38', 'איביזה', 136000, '2027-01-12', '2027-03-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('8aa1814b-47c5-4e1a-9240-20896e144a03', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', 'רכב', 'סקודה צ''כיה', 'OCTAVIA', 2022, '234-16-703', NULL, NULL, '2026-10-29', '2026-06-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('7acf244a-a0be-4d2a-a5a1-c58972db5b75', '8aa1814b-47c5-4e1a-9240-20896e144a03', 'large', 'טיפול גדול', '2025-06-25', 'מוסך', NULL, 'שלמה סיקסט לםני מכירה', 41000) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('3ab3b573-c214-448f-a211-3e2dc7cdb247', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', '65890ab0-5d6f-4e62-bc4d-7c2779dafa45', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('c04c95d0-4215-4463-b095-fbef30a4757e', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', '65890ab0-5d6f-4e62-bc4d-7c2779dafa45', 'ביטוח מקיף', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('14b7d789-6cc0-49ac-b448-13fd3622ec7e', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', '65890ab0-5d6f-4e62-bc4d-7c2779dafa45', 'מסמך אחר', 'עבר ביטוחי סקודה', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('57284f8a-a210-4d2a-978d-e3a808a5ca75', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', '65890ab0-5d6f-4e62-bc4d-7c2779dafa45', 'מסמך אחר', 'עבר ביטוחי aig טויוטה', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('ab542485-4929-4645-a768-4c4b0ea2c38e', '38bbf9ac-1e54-4474-95a8-ff301d5f2bff', '65890ab0-5d6f-4e62-bc4d-7c2779dafa45', 'ביטוח חובה', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של ברוך אדלשטיין
INSERT INTO accounts (id, name, created_at) VALUES ('1fdaa1a6-a656-46b8-af5d-91f03854e086', 'החשבון של ברוך אדלשטיין', '2026-03-24T22:01:30.423000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('baruched1962.24@gmail.com', '1fdaa1a6-a656-46b8-af5d-91f03854e086', 'ברוך אדלשטיין', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של inbar miller
INSERT INTO accounts (id, name, created_at) VALUES ('95f0ace0-f872-497b-baa0-7937bed441b2', 'החשבון של inbar miller', '2026-03-24T20:40:14.259000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('inbar1101miller@gmail.com', '95f0ace0-f872-497b-baa0-7937bed441b2', 'inbar miller', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('58adee68-972e-414d-87e2-1a6fe40e53ec', '95f0ace0-f872-497b-baa0-7937bed441b2', 'רכב', 'יונדאי קוריאה', 'KONA', 2022, '159-79-503', 'קונה', 102000, '2026-08-01', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של סאני דוידפור
INSERT INTO accounts (id, name, created_at) VALUES ('557ffa72-0573-44d3-97ea-d77a55abfc47', 'החשבון של סאני דוידפור', '2026-03-23T19:45:11.627000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('davidpursunny23@gmail.com', '557ffa72-0573-44d3-97ea-d77a55abfc47', 'סאני דוידפור', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של natanzone2024
INSERT INTO accounts (id, name, created_at) VALUES ('7f01f2d3-2dfb-4a1c-9e9c-2862285d108a', 'החשבון של natanzone2024', '2026-03-23T14:06:10.906000') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('fa4fd25e-1d10-4444-8bb3-5a2d481d345c', '7f01f2d3-2dfb-4a1c-9e9c-2862285d108a', 'רכב', 'פולקסווגן גרמנ', 'GOLF', 2017, '259-08-901', NULL, NULL, '2025-09-11', NULL) ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 259-08-901 (פולקסווגן גרמנ GOLF)
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('f6d9c965-d5a6-4950-8de5-a140b57a66b0', 'fa4fd25e-1d10-4444-8bb3-5a2d481d345c', 'small', 'טיפול קטן', '2026-03-24', 'אני', 200, 'חםדמקם', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('f469c7fc-5ad6-4bd0-a2f0-f5e33f8dacaf', 'fa4fd25e-1d10-4444-8bb3-5a2d481d345c', 'תיקון', 'תיקון', '2026-03-24', 'אני', 250, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Tomer Telem
INSERT INTO accounts (id, name, created_at) VALUES ('8b8726c8-a036-4db5-8363-b73ee4e6b17e', 'החשבון של Tomer Telem', '2026-03-22T16:34:48.402000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ttelem@gmail.com', '8b8726c8-a036-4db5-8363-b73ee4e6b17e', 'Tomer Telem', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('47ae160a-481d-4728-9c0a-9cfc732e764e', '8b8726c8-a036-4db5-8363-b73ee4e6b17e', 'רכב', 'מאזדה', '6', 2010, '3292371', 'מאזדה 6', 290000, '2026-10-02', '2026-12-31') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של natanzone2024
INSERT INTO accounts (id, name, created_at) VALUES ('a7ec1d01-7366-410a-8822-985e9170a331', 'החשבון של natanzone2024', '2026-03-22T09:41:18.372000') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של עמית חרותי
INSERT INTO accounts (id, name, created_at) VALUES ('a8bf27ae-fb71-44df-9820-98514b0d32f9', 'החשבון של עמית חרותי', '2026-03-19T13:27:11.257000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('amitheruti2@gmail.com', 'a8bf27ae-fb71-44df-9820-98514b0d32f9', 'עמית חרותי', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Dan hamn
INSERT INTO accounts (id, name, created_at) VALUES ('9c1c484e-976b-41e7-8a9a-9ab4d696fc74', 'החשבון של Dan hamn', '2026-03-18T18:54:32.777000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('test4all2@gmail.com', '9c1c484e-976b-41e7-8a9a-9ab4d696fc74', 'Dan hamn', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Soki Koki
INSERT INTO accounts (id, name, created_at) VALUES ('c9a22aed-e3e3-4cf6-aeeb-601c046d9962', 'החשבון של Soki Koki', '2026-03-18T07:05:54.191000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sporebit@gmail.com', 'c9a22aed-e3e3-4cf6-aeeb-601c046d9962', 'Soki Koki', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Dor Itzhaki
INSERT INTO accounts (id, name, created_at) VALUES ('0ec0e0fe-a25c-438c-b0d2-c5ad826e9ec9', 'החשבון של Dor Itzhaki', '2026-03-16T11:37:18.271000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('doritzhaki6@gmail.com', '0ec0e0fe-a25c-438c-b0d2-c5ad826e9ec9', 'Dor Itzhaki', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Omer Tzroya
INSERT INTO accounts (id, name, created_at) VALUES ('c16959bb-de55-45e1-99ad-3c925cc32c9f', 'החשבון של Omer Tzroya', '2026-03-16T07:38:52.808000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('omersr9@gmail.com', 'c16959bb-de55-45e1-99ad-3c925cc32c9f', 'Omer Tzroya', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של נתנאל סבג
INSERT INTO accounts (id, name, created_at) VALUES ('f0195e46-865a-4a85-975d-4a7e32e4c8bf', 'החשבון של נתנאל סבג', '2026-03-16T07:01:29.798000') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Yonatan Azrad
INSERT INTO accounts (id, name, created_at) VALUES ('ecc6ae4d-6fa6-46ce-9331-a59becd114c6', 'החשבון של Yonatan Azrad', '2026-03-15T11:35:28.088000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yonatanazrad@gmail.com', 'ecc6ae4d-6fa6-46ce-9331-a59becd114c6', 'Yonatan Azrad', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של עמית נאמני
INSERT INTO accounts (id, name, created_at) VALUES ('4f96ab71-28a5-4144-8315-fb9d1b26ce60', 'החשבון של עמית נאמני', '2026-03-15T11:03:51.734000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('amit.neemani123@gmail.com', '4f96ab71-28a5-4144-8315-fb9d1b26ce60', 'עמית נאמני', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של מאור אוחנה
INSERT INTO accounts (id, name, created_at) VALUES ('cab51335-71cb-4b8e-8ccf-551e922fce32', 'החשבון של מאור אוחנה', '2026-03-15T09:28:16.668000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('maori30@gmail.com', 'cab51335-71cb-4b8e-8ccf-551e922fce32', 'מאור אוחנה', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של יוחאי סיטבון
INSERT INTO accounts (id, name, created_at) VALUES ('d411e898-49ed-4bf7-9762-a95edfa55b03', 'החשבון של יוחאי סיטבון', '2026-03-15T08:39:42.051000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sitbonyohai@gmail.com', 'd411e898-49ed-4bf7-9762-a95edfa55b03', 'יוחאי סיטבון', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Shlomo A
INSERT INTO accounts (id, name, created_at) VALUES ('44cb7d6e-eec2-4918-84a7-d82134ded698', 'החשבון של Shlomo A', '2026-03-15T04:43:29.894000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shlomo.azizi@gmail.com', '44cb7d6e-eec2-4918-84a7-d82134ded698', 'Shlomo A', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ליאל כהן
INSERT INTO accounts (id, name, created_at) VALUES ('6f4c155d-b53b-49df-a206-f41d32e0d927', 'החשבון של ליאל כהן', '2026-03-15T00:24:51.930000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('lielcpc@gmail.com', '6f4c155d-b53b-49df-a206-f41d32e0d927', 'ליאל כהן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של projectsbrain90
INSERT INTO accounts (id, name, created_at) VALUES ('63a80c8b-e956-406c-b0b4-5c22312d3833', 'החשבון של projectsbrain90', '2026-03-14T23:11:22.311000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('projectsbrain90@gmail.com', '63a80c8b-e956-406c-b0b4-5c22312d3833', 'projectsbrain90', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ראובן נאמני
INSERT INTO accounts (id, name, created_at) VALUES ('75b4bf38-a4f0-45b0-adc9-255f0ba6597d', 'החשבון של ראובן נאמני', '2026-03-14T21:08:23.944000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('rnkogol@gmail.com', '75b4bf38-a4f0-45b0-adc9-255f0ba6597d', 'ראובן נאמני', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של יהודה צולשן
INSERT INTO accounts (id, name, created_at) VALUES ('d363cf65-7023-4040-be37-aa71b52e1b86', 'החשבון של יהודה צולשן', '2026-03-14T21:05:02.031000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yeudazol23@gmail.com', 'd363cf65-7023-4040-be37-aa71b52e1b86', 'יהודה צולשן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של יערי כהן
INSERT INTO accounts (id, name, created_at) VALUES ('a6d40ba5-a863-4478-aa7c-0c3454b63e5a', 'החשבון של יערי כהן', '2026-03-14T08:45:39.710000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yearic@gmail.com', 'a6d40ba5-a863-4478-aa7c-0c3454b63e5a', 'יערי כהן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ron Batat
INSERT INTO accounts (id, name, created_at) VALUES ('7b8a996a-0c33-4600-81b9-43d45c698048', 'החשבון של Ron Batat', '2026-03-13T20:54:00.300000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ronbatatson@gmail.com', '7b8a996a-0c33-4600-81b9-43d45c698048', 'Ron Batat', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Eden
INSERT INTO accounts (id, name, created_at) VALUES ('405dbca2-44cf-463b-ad5c-0c7a1dac084f', 'החשבון של Eden', '2026-03-13T19:44:48.482000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('walla90@gmail.com', '405dbca2-44cf-463b-ad5c-0c7a1dac084f', 'Eden', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('d6c3b63f-7b58-4869-b538-51864fa8474b', '405dbca2-44cf-463b-ad5c-0c7a1dac084f', 'רכב', 'סובארו', 'IMPREZA', 2005, '6980758', NULL, 10000, '2014-02-15', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('cece6a7f-58e8-4d17-9ec7-0eccf5c694bf', '405dbca2-44cf-463b-ad5c-0c7a1dac084f', 'd6c3b63f-7b58-4869-b538-51864fa8474b', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של אלעד סיני
INSERT INTO accounts (id, name, created_at) VALUES ('8fcd8c75-4cff-43e6-b922-09bab7bf9f1d', 'החשבון של אלעד סיני', '2026-03-13T12:41:51.485000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('eladsinai1@gmail.com', '8fcd8c75-4cff-43e6-b922-09bab7bf9f1d', 'אלעד סיני', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של lol lol
INSERT INTO accounts (id, name, created_at) VALUES ('64ae309c-ea9d-49ff-af0b-f2f1cbd65052', 'החשבון של lol lol', '2026-03-13T11:49:05.881000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sonipes146@gmail.com', '64ae309c-ea9d-49ff-af0b-f2f1cbd65052', 'lol lol', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של eliran aricha (‫אלירן‬‎)
INSERT INTO accounts (id, name, created_at) VALUES ('4ecfb933-3f1f-463e-b2e9-7769e36dd54b', 'החשבון של eliran aricha (‫אלירן‬‎)', '2026-03-13T10:27:55.707000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('eliranaricha@gmail.com', '4ecfb933-3f1f-463e-b2e9-7769e36dd54b', 'eliran aricha (‫אלירן‬‎)', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Yotam Saacks
INSERT INTO accounts (id, name, created_at) VALUES ('fe1552cf-33e0-44d4-b975-610d2f003672', 'החשבון של Yotam Saacks', '2026-03-13T09:24:17.875000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yotsaacks@gmail.com', 'fe1552cf-33e0-44d4-b975-610d2f003672', 'Yotam Saacks', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של roi rubin
INSERT INTO accounts (id, name, created_at) VALUES ('aeb32ff5-d790-4f7e-9bc6-5e4fcf81e049', 'החשבון של roi rubin', '2026-03-12T21:32:23.619000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('roirubin100@gmail.com', 'aeb32ff5-d790-4f7e-9bc6-5e4fcf81e049', 'roi rubin', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('55c43cb1-4e42-4932-abfb-d866e7c630c7', 'aeb32ff5-d790-4f7e-9bc6-5e4fcf81e049', 'רכב', 'סיאט', NULL, 2016, '4222038', NULL, 160000, '2026-07-08', '2026-08-18') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של איתי אביצור
INSERT INTO accounts (id, name, created_at) VALUES ('895525bd-636c-4621-bb61-691ccdd57bf1', 'החשבון של איתי אביצור', '2026-03-12T13:53:21.944000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('tchmur1@gmail.com', '895525bd-636c-4621-bb61-691ccdd57bf1', 'איתי אביצור', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Sam Brook
INSERT INTO accounts (id, name, created_at) VALUES ('f8301c1c-ef3b-466d-9788-388071034b7d', 'החשבון של Sam Brook', '2026-03-12T07:29:48.804000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sambrook2006@yahoo.com', 'f8301c1c-ef3b-466d-9788-388071034b7d', 'Sam Brook', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ofir Arie
INSERT INTO accounts (id, name, created_at) VALUES ('1e3d5639-ece1-430d-94bc-811d92475b4d', 'החשבון של Ofir Arie', '2026-03-12T07:04:05.919000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ofirarie1980@gmail.com', '1e3d5639-ece1-430d-94bc-811d92475b4d', 'Ofir Arie', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('055acbe7-a19c-427a-aff8-25ebd4c6f72a', '1e3d5639-ece1-430d-94bc-811d92475b4d', 'קטנוע', 'ניסאן', NULL, NULL, '27737484', NULL, NULL, '2025-12-17', '2026-10-22') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('2d6ea0f9-ee41-4181-9a67-8688b8e5172f', '1e3d5639-ece1-430d-94bc-811d92475b4d', 'רכב', 'יונדאי', NULL, NULL, '37378399', NULL, NULL, '2026-06-16', '2026-03-12') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Yaniv Shmidt
INSERT INTO accounts (id, name, created_at) VALUES ('a6ed5fe2-de6a-4494-9fa4-d0f56f16dded', 'החשבון של Yaniv Shmidt', '2026-03-12T06:15:45.723000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shmidtyaniv@gmail.com', 'a6ed5fe2-de6a-4494-9fa4-d0f56f16dded', 'Yaniv Shmidt', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('b1061540-93ef-46ed-8e61-46705b21ee35', 'a6ed5fe2-de6a-4494-9fa4-d0f56f16dded', 'רכב', 'יונדאי', 'TUCSON', 2022, '76328602', NULL, NULL, '2027-02-01', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('6e15e867-a807-423f-a2a8-aba999c8b301', 'a6ed5fe2-de6a-4494-9fa4-d0f56f16dded', 'b1061540-93ef-46ed-8e61-46705b21ee35', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של baruchitv
INSERT INTO accounts (id, name, created_at) VALUES ('7dc4635f-87ee-44e6-87ae-14c40c4f4484', 'החשבון של baruchitv', '2026-03-12T05:52:03.908000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('baruchitv2025@gmail.com', '7dc4635f-87ee-44e6-87ae-14c40c4f4484', 'baruchitv', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Denis Lezgin
INSERT INTO accounts (id, name, created_at) VALUES ('b695bd90-6d7c-45d1-ad3e-b6b635890cf7', 'החשבון של Denis Lezgin', '2026-03-12T04:58:46.339000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('denis.lezgin@gmail.com', 'b695bd90-6d7c-45d1-ad3e-b6b635890cf7', 'Denis Lezgin', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של roee1454
INSERT INTO accounts (id, name, created_at) VALUES ('21a40f21-74cc-403c-96f7-3ae4c7166e79', 'החשבון של roee1454', '2026-03-11T17:20:13.765000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('roee1454@gmail.com', '21a40f21-74cc-403c-96f7-3ae4c7166e79', 'roee1454', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Avraham Rost
INSERT INTO accounts (id, name, created_at) VALUES ('665a7918-13e3-4d31-ad04-d495c7a719d1', 'החשבון של Avraham Rost', '2026-03-11T16:19:10.718000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avraham.rost@gmail.com', '665a7918-13e3-4d31-ad04-d495c7a719d1', 'Avraham Rost', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של שלמה פופוביץ
INSERT INTO accounts (id, name, created_at) VALUES ('885cc99c-28b6-4414-b61a-f31cbd95bd70', 'החשבון של שלמה פופוביץ', '2026-03-11T14:20:18.375000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('aknvpupuch@gmail.com', '885cc99c-28b6-4414-b61a-f31cbd95bd70', 'שלמה פופוביץ', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של haim shamah
INSERT INTO accounts (id, name, created_at) VALUES ('c454ec4f-3c45-4b91-9e7f-a7b9bdc6fdba', 'החשבון של haim shamah', '2026-03-11T12:08:17.395000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('h0525950666@gmail.com', 'c454ec4f-3c45-4b91-9e7f-a7b9bdc6fdba', 'haim shamah', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של רון אביטן
INSERT INTO accounts (id, name, created_at) VALUES ('74bad04f-b410-46b9-bfd6-2a85817ed7e3', 'החשבון של רון אביטן', '2026-03-11T10:13:44.951000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ronavitan2810@gmail.com', '74bad04f-b410-46b9-bfd6-2a85817ed7e3', 'רון אביטן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Eden sitkovetsky
INSERT INTO accounts (id, name, created_at) VALUES ('32eea011-cc74-48aa-83e8-7359296f5d25', 'החשבון של Eden sitkovetsky', '2026-03-11T08:45:06.804000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('edensit139@gmail.com', '32eea011-cc74-48aa-83e8-7359296f5d25', 'Eden sitkovetsky', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של שי ימין
INSERT INTO accounts (id, name, created_at) VALUES ('53567cd6-ef55-4c68-8ba8-341213c3252c', 'החשבון של שי ימין', '2026-03-11T08:07:49.285000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shayyamin56@gmail.com', '53567cd6-ef55-4c68-8ba8-341213c3252c', 'שי ימין', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('c674e21e-7fa2-4ec0-84a6-700168eb5851', '53567cd6-ef55-4c68-8ba8-341213c3252c', 'רכב', 'אופל', NULL, NULL, '1212121', NULL, NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של גידי סמך
INSERT INTO accounts (id, name, created_at) VALUES ('80bd7220-049c-4e1b-b25d-216c7acd715d', 'החשבון של גידי סמך', '2026-03-11T07:01:49.031000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('gidi890@gmail.com', '80bd7220-049c-4e1b-b25d-216c7acd715d', 'גידי סמך', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Aviv Driham
INSERT INTO accounts (id, name, created_at) VALUES ('d70c83fe-4f7b-4f8b-b375-e588c7d866be', 'החשבון של Aviv Driham', '2026-03-11T06:15:51.419000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avivdr1995@gmail.com', 'd70c83fe-4f7b-4f8b-b375-e588c7d866be', 'Aviv Driham', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('32e23a0d-1e5d-40a4-ae8d-30cdca0ef501', 'd70c83fe-4f7b-4f8b-b375-e588c7d866be', 'רכב', 'סוזוקי', 'ויטרה', 2016, '9994537', 'הויטרה של הבית', 118381, '2027-04-10', '2026-07-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('96657291-ae5b-414f-8111-5a091dc2e4de', 'd70c83fe-4f7b-4f8b-b375-e588c7d866be', 'רכב', 'טויוטה', 'יאריס', 2016, '8519181', 'היאריס של אביב', NULL, '2026-10-30', '2026-08-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('c5c99521-119e-4e41-b1a1-ff2902597c83', '32e23a0d-1e5d-40a4-ae8d-30cdca0ef501', 'small', 'טיפול קטן', '2025-04-06', 'מוסך', NULL, NULL, 104956) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('0a855e26-3023-4b87-bf7c-79a85ed762a9', '96657291-ae5b-414f-8111-5a091dc2e4de', 'small', 'טיפול קטן', '2026-09-09', 'מוסך', NULL, 'טיפול עתידי נדרש', 145000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('b953621c-b6fa-4a31-9a85-0707ffe6210d', '96657291-ae5b-414f-8111-5a091dc2e4de', 'small', 'טיפול קטן', '2025-07-29', 'מוסך', 535, 'טיפול 130 אלף ', 131200) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של רון מור יוסף
INSERT INTO accounts (id, name, created_at) VALUES ('e386bdd3-10ee-40fa-b8f8-05dfc3bb44ae', 'החשבון של רון מור יוסף', '2026-03-11T05:36:20.304000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ronmor1412@gmail.com', 'e386bdd3-10ee-40fa-b8f8-05dfc3bb44ae', 'רון מור יוסף', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ronna Spiegel
INSERT INTO accounts (id, name, created_at) VALUES ('fba0fd9f-337e-4220-a442-91db84a9be5f', 'החשבון של Ronna Spiegel', '2026-03-10T23:55:08.405000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ronnaspiegel@gmail.com', 'fba0fd9f-337e-4220-a442-91db84a9be5f', 'Ronna Spiegel', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של guycoful
INSERT INTO accounts (id, name, created_at) VALUES ('a4ffbc06-66e3-4379-a21c-3ec18bc30485', 'החשבון של guycoful', '2026-03-10T23:47:05.977000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('guycoful@gmail.com', 'a4ffbc06-66e3-4379-a21c-3ec18bc30485', 'guycoful', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('63ccaa6a-ad92-447a-80b0-d2c6923ef528', 'a4ffbc06-66e3-4379-a21c-3ec18bc30485', 'רכב', 'סוזוקי', 'SWIFT', 2007, '9391863', NULL, 116000, '2026-08-06', '2026-07-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('f93af189-c804-49cd-9771-9738976adc44', 'a4ffbc06-66e3-4379-a21c-3ec18bc30485', '63ccaa6a-ad92-447a-80b0-d2c6923ef528', 'רישיון נהיגה', 'רישיון נהיגה', '2024-10-22', '2029-10-22') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('48014a71-8492-477e-a1ee-10ce25154c20', 'a4ffbc06-66e3-4379-a21c-3ec18bc30485', '63ccaa6a-ad92-447a-80b0-d2c6923ef528', 'צד ג', 'חובה וצד ג', '2025-08-01', '2026-07-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('405f06a0-5bae-47f7-9fcb-688b86fc33a4', 'a4ffbc06-66e3-4379-a21c-3ec18bc30485', '63ccaa6a-ad92-447a-80b0-d2c6923ef528', 'ביטוח חובה', 'חובה וצד ג', '2025-08-01', '2026-07-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('3694160d-7573-431c-b956-b6c6f61209ab', 'a4ffbc06-66e3-4379-a21c-3ec18bc30485', '63ccaa6a-ad92-447a-80b0-d2c6923ef528', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של סאלי חליף
INSERT INTO accounts (id, name, created_at) VALUES ('fe304560-85d4-437d-9d68-93c784861e39', 'החשבון של סאלי חליף', '2026-03-10T23:03:16.111000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('sali2610@gmail.com', 'fe304560-85d4-437d-9d68-93c784861e39', 'סאלי חליף', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('ee45cb71-20c9-4edb-bdc2-147ec896b41b', 'fe304560-85d4-437d-9d68-93c784861e39', 'רכב', 'קיה', NULL, 2021, '64937402', 'נירו', 68500, '2026-07-14', '2027-03-11') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של קובי אליאסי
INSERT INTO accounts (id, name, created_at) VALUES ('3e9d1947-d181-4100-99c0-1123911c518e', 'החשבון של קובי אליאסי', '2026-03-10T22:32:17.243000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yakov3036@gmail.com', '3e9d1947-d181-4100-99c0-1123911c518e', 'קובי אליאסי', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Yossi Jacobi
INSERT INTO accounts (id, name, created_at) VALUES ('e931d128-439a-4099-89a9-26c05cffb807', 'החשבון של Yossi Jacobi', '2026-03-10T22:29:46.642000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('0527175389v@gmail.com', 'e931d128-439a-4099-89a9-26c05cffb807', 'Yossi Jacobi', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של noamjusto12
INSERT INTO accounts (id, name, created_at) VALUES ('8c2c7047-a657-4a8d-a4ff-ee2229eb22e6', 'החשבון של noamjusto12', '2026-03-10T22:08:38.023000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('noamjusto12@gmail.com', '8c2c7047-a657-4a8d-a4ff-ee2229eb22e6', 'noamjusto12', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Shon Lev
INSERT INTO accounts (id, name, created_at) VALUES ('5afec350-56d4-46dd-a46e-5d47e257086e', 'החשבון של Shon Lev', '2026-03-10T22:07:38.124000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shonlev978@gmail.com', '5afec350-56d4-46dd-a46e-5d47e257086e', 'Shon Lev', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של אלחנן חזן
INSERT INTO accounts (id, name, created_at) VALUES ('1761ef10-a028-449b-9729-080885533ef1', 'החשבון של אלחנן חזן', '2026-03-10T21:45:48.645000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('elhanan138@gmail.com', '1761ef10-a028-449b-9729-080885533ef1', 'אלחנן חזן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של samuelninja100755
INSERT INTO accounts (id, name, created_at) VALUES ('773117e5-d62a-435a-8b4d-430b39096b20', 'החשבון של samuelninja100755', '2026-03-10T21:41:47.975000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('samuelninja100755@gmail.com', '773117e5-d62a-435a-8b4d-430b39096b20', 'samuelninja100755', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ariallk19998
INSERT INTO accounts (id, name, created_at) VALUES ('9a28ff83-a1d7-4ce5-b6ec-4b11ae392dac', 'החשבון של ariallk19998', '2026-03-10T21:32:07.708000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ariallk19998@gmail.com', '9a28ff83-a1d7-4ce5-b6ec-4b11ae392dac', 'ariallk19998', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של אביעד לוי
INSERT INTO accounts (id, name, created_at) VALUES ('422f65a6-874c-4a2f-90e4-d52009310aee', 'החשבון של אביעד לוי', '2026-03-10T20:43:25.550000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('aviadlevy@gmail.com', '422f65a6-874c-4a2f-90e4-d52009310aee', 'אביעד לוי', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של עוז גואטע
INSERT INTO accounts (id, name, created_at) VALUES ('3ca1dc1a-923d-44b9-a8c9-7f35ba47f09c', 'החשבון של עוז גואטע', '2026-03-10T20:42:51.879000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ozguetta777@gmail.com', '3ca1dc1a-923d-44b9-a8c9-7f35ba47f09c', 'עוז גואטע', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Amitai cohen
INSERT INTO accounts (id, name, created_at) VALUES ('375dfb44-70a3-46b5-a317-915ed8315379', 'החשבון של Amitai cohen', '2026-03-10T18:01:58.494000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('amitai.co@gmail.com', '375dfb44-70a3-46b5-a317-915ed8315379', 'Amitai cohen', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Amit Cohen
INSERT INTO accounts (id, name, created_at) VALUES ('fd4d0802-e9ea-45f6-871b-22bbfc4f141f', 'החשבון של Amit Cohen', '2026-03-10T16:42:58.987000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('amitnaserv@gmail.com', 'fd4d0802-e9ea-45f6-871b-22bbfc4f141f', 'Amit Cohen', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Gil Fitussi
INSERT INTO accounts (id, name, created_at) VALUES ('686bc9bb-85e9-4132-82ff-43b23d169a13', 'החשבון של Gil Fitussi', '2026-03-10T16:22:12.698000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('gigo1985@gmail.com', '686bc9bb-85e9-4132-82ff-43b23d169a13', 'Gil Fitussi', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של autofix
INSERT INTO accounts (id, name, created_at) VALUES ('822e790d-471e-4a3e-ab38-97a0f38f358d', 'החשבון של autofix', '2026-03-10T15:50:57.778000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('contact.autofix.app@gmail.com', '822e790d-471e-4a3e-ab38-97a0f38f358d', 'autofix', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של liam sharf
INSERT INTO accounts (id, name, created_at) VALUES ('1e2ca665-80f2-4444-8c2e-f01f2eb66e44', 'החשבון של liam sharf', '2026-03-10T15:32:10.064000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('liamsh1979@gmail.com', '1e2ca665-80f2-4444-8c2e-f01f2eb66e44', 'liam sharf', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של עידן טייאר
INSERT INTO accounts (id, name, created_at) VALUES ('9f6d6457-89ce-42ed-b41c-a5845aea4a4c', 'החשבון של עידן טייאר', '2026-03-09T08:49:10.554000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('idantayar@gmail.com', '9f6d6457-89ce-42ed-b41c-a5845aea4a4c', 'עידן טייאר', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('1711ec24-2ceb-479e-b2a8-0e32d9d9dc0b', '9f6d6457-89ce-42ed-b41c-a5845aea4a4c', 'רכב', 'ניסאן', 'אקס טרייל', 2018, '19708501', 'ניסאן', 106000, '2027-01-09', '2026-04-01') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של eliran k
INSERT INTO accounts (id, name, created_at) VALUES ('f1e2ead5-8d5a-45d2-99a4-d05cc08289e3', 'החשבון של eliran k', '2026-03-08T15:47:28.686000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('k.elirans@gmail.com', 'f1e2ead5-8d5a-45d2-99a4-d05cc08289e3', 'eliran k', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של מוטי יוסף
INSERT INTO accounts (id, name, created_at) VALUES ('89c5e212-302f-4b87-b14d-000020c687a3', 'החשבון של מוטי יוסף', '2026-03-08T13:33:07.847000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('motiyosef2020@gmail.com', '89c5e212-302f-4b87-b14d-000020c687a3', 'מוטי יוסף', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('4bdb45b8-dfa3-44d6-8eb2-cd3409f76418', '89c5e212-302f-4b87-b14d-000020c687a3', 'רכב', 'יונדאי', 'טוסון', 2007, '7374261', 'האוטו שלי', 230000, NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Matan Etiel
INSERT INTO accounts (id, name, created_at) VALUES ('645ee4be-a808-446e-986a-93c5d147c9a2', 'החשבון של Matan Etiel', '2026-03-08T12:53:52.378000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('matan.etiel@gmail.com', '645ee4be-a808-446e-986a-93c5d147c9a2', 'Matan Etiel', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של נתנאל שמש
INSERT INTO accounts (id, name, created_at) VALUES ('845f01d3-ce6c-44de-90a9-a4287fc47d99', 'החשבון של נתנאל שמש', '2026-03-07T19:25:34.398000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ntnlshmsh@gmail.com', '845f01d3-ce6c-44de-90a9-a4287fc47d99', 'נתנאל שמש', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('bc7a1481-bb0e-4805-af76-cac38a67e6b6', '845f01d3-ce6c-44de-90a9-a4287fc47d99', 'רכב', 'יונדאי', 'I25', 2015, '3885134', NULL, 150000, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('694b0d3c-75af-4ddd-bd5a-992932091152', 'bc7a1481-bb0e-4805-af76-cac38a67e6b6', 'small', 'טיפול קטן', '2025-09-07', 'מוסך', 500, NULL, 150000) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Robi marvad
INSERT INTO accounts (id, name, created_at) VALUES ('06ea630f-81bd-46ae-933f-ca5d3731c29a', 'החשבון של Robi marvad', '2026-03-07T19:14:04.799000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('robmarv100@gmail.com', '06ea630f-81bd-46ae-933f-ca5d3731c29a', 'Robi marvad', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ידידיה המבורגר
INSERT INTO accounts (id, name, created_at) VALUES ('f436a4c6-f2c9-44a0-bcc7-5816c97b397a', 'החשבון של ידידיה המבורגר', '2026-03-07T19:10:12.530000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yedidya2012@gmail.com', 'f436a4c6-f2c9-44a0-bcc7-5816c97b397a', 'ידידיה המבורגר', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ohad Halabi
INSERT INTO accounts (id, name, created_at) VALUES ('143f13fa-4f3e-4464-9aca-0adfca8c57fc', 'החשבון של Ohad Halabi', '2026-03-07T18:44:03.862000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ohadhalabi@gmail.com', '143f13fa-4f3e-4464-9aca-0adfca8c57fc', 'Ohad Halabi', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Itai Aminia
INSERT INTO accounts (id, name, created_at) VALUES ('5c2c9d2c-2279-4a76-a19d-865c06d1d8d6', 'החשבון של Itai Aminia', '2026-03-07T18:32:48.261000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('aminia4@gmail.com', '5c2c9d2c-2279-4a76-a19d-865c06d1d8d6', 'Itai Aminia', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של yossipoli
INSERT INTO accounts (id, name, created_at) VALUES ('d3e0d515-e17b-4c40-8c48-dabd893beafd', 'החשבון של yossipoli', '2026-03-07T07:37:21.418000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('yossipoli@gmail.com', 'd3e0d515-e17b-4c40-8c48-dabd893beafd', 'yossipoli', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של גל אסף
INSERT INTO accounts (id, name, created_at) VALUES ('9fcfbd77-1e51-4564-a712-eff31501b820', 'החשבון של גל אסף', '2026-03-06T19:26:11.612000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('gal2asaf@gmail.com', '9fcfbd77-1e51-4564-a712-eff31501b820', 'גל אסף', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ofek peer
INSERT INTO accounts (id, name, created_at) VALUES ('393cd1d7-b26d-4a36-a91c-2398ad162ee2', 'החשבון של ofek peer', '2026-03-06T11:02:50.843000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ofekpeer1@gmail.com', '393cd1d7-b26d-4a36-a91c-2398ad162ee2', 'ofek peer', NULL, '1994-07-22', '9466832', '2028-07-22') ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('e954a773-ab5c-4364-91db-e78513788772', '393cd1d7-b26d-4a36-a91c-2398ad162ee2', 'רכב', 'קיה', 'SELTOS', 2025, '29323204', 'רגב חברה', 9500, '2026-05-20', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('47627582-a23a-4412-bf54-bca1ae3c3cbb', '393cd1d7-b26d-4a36-a91c-2398ad162ee2', 'e954a773-ab5c-4364-91db-e78513788772', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Liron Bekman
INSERT INTO accounts (id, name, created_at) VALUES ('dc1c1b50-3a9d-4656-9676-7acbfe89fcca', 'החשבון של Liron Bekman', '2026-03-06T08:41:22.261000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('lironbek88@gmail.com', 'dc1c1b50-3a9d-4656-9676-7acbfe89fcca', 'Liron Bekman', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של idan sarig
INSERT INTO accounts (id, name, created_at) VALUES ('93006c84-ccde-42bd-947d-a514c213e933', 'החשבון של idan sarig', '2026-03-06T08:33:06.554000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('idans1988@gmail.com', '93006c84-ccde-42bd-947d-a514c213e933', 'idan sarig', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Roi Peretz
INSERT INTO accounts (id, name, created_at) VALUES ('9a89e341-0626-46b6-b0e0-5b126cad4d4b', 'החשבון של Roi Peretz', '2026-03-06T08:22:35.611000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('roi333@gmail.com', '9a89e341-0626-46b6-b0e0-5b126cad4d4b', 'Roi Peretz', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Gadi Israeli
INSERT INTO accounts (id, name, created_at) VALUES ('47e21cf7-77d7-4a2c-b52e-c4152bc53eea', 'החשבון של Gadi Israeli', '2026-03-06T08:20:37.564000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('gadi.israeli@gmail.com', '47e21cf7-77d7-4a2c-b52e-c4152bc53eea', 'Gadi Israeli', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('1898343f-6014-4888-96ae-23a02c2b8c84', '47e21cf7-77d7-4a2c-b52e-c4152bc53eea', 'רכב', 'מאזדה', '3', 2011, '6965271', 'המאזדה של גדי ', 162000, '2026-08-29', '2027-01-31') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של ארז גביר
INSERT INTO accounts (id, name, created_at) VALUES ('64344857-689c-4950-ab37-56b9d721285d', 'החשבון של ארז גביר', '2026-03-05T18:38:25.241000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('erezgv@gmail.com', '64344857-689c-4950-ab37-56b9d721285d', 'ארז גביר', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של regev0987
INSERT INTO accounts (id, name, created_at) VALUES ('844eba45-c9e6-4d31-89d0-8659e792c8c6', 'החשבון של regev0987', '2026-03-05T17:52:56.065000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('arad997@gmail.com', '844eba45-c9e6-4d31-89d0-8659e792c8c6', 'regev0987', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של משה טיירי אלוש
INSERT INTO accounts (id, name, created_at) VALUES ('f5994f36-fe5b-4938-8261-17d1e4ef8961', 'החשבון של משה טיירי אלוש', '2026-03-05T17:39:49.126000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('allushe.m@gmail.com', 'f5994f36-fe5b-4938-8261-17d1e4ef8961', 'משה טיירי אלוש', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ran buganim
INSERT INTO accounts (id, name, created_at) VALUES ('d508d13f-c103-4c17-a33e-4d73e68424e5', 'החשבון של ran buganim', '2026-03-05T17:34:00.916000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ranbuganim@gmail.com', 'd508d13f-c103-4c17-a33e-4d73e68424e5', 'ran buganim', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('29acc4f9-3c07-4002-9d6c-678e19c01130', 'd508d13f-c103-4c17-a33e-4d73e68424e5', 'רכב', 'רנו', 'Capture', 2015, '9728031', 'של נופר', 156000, NULL, '2026-05-01') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של dorverchik
INSERT INTO accounts (id, name, created_at) VALUES ('6eaff655-564d-466a-9fcb-2e46842d6751', 'החשבון של dorverchik', '2026-03-05T10:10:06.461000') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('1c746982-33fa-4a64-aad2-888c942ff104', '6eaff655-564d-466a-9fcb-2e46842d6751', 'רכב', 'לקסוס', 'Ct200h', 2015, '123456', NULL, 170000, '2026-07-01', '2027-01-01') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('f5cf5699-aa2b-4ca9-a8a8-a2f4351034eb', '6eaff655-564d-466a-9fcb-2e46842d6751', '1c746982-33fa-4a64-aad2-888c942ff104', 'רישיון רכב', 'רשיון', '2026-03-05', '2026-10-22') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של איתן דן
INSERT INTO accounts (id, name, created_at) VALUES ('6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'החשבון של איתן דן', '2026-03-03T17:06:31.638000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('eitandan7530@gmail.com', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'איתן דן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('dbecfb30-7d8e-4b3f-9a1a-73c643ab7509', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'רכב', 'וולוו', 'S60', 2009, '5761370', NULL, 270000, '2026-10-29', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('793894f3-4c4f-40fb-9759-40de94ef2344', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'רכב', 'סוזוקי', 'ויטרה', 1993, '8707205', 'אספנות', 14000, '2024-04-03', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('a4685bbb-0169-4adc-86b5-790204fd7e53', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'רכב', 'וולוו', 'v40', 2016, '4182208', 'רכב של שרית', 135000, '2026-06-29', '2027-02-28') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('00186a2d-a0e2-4df6-99c5-4a34a7933d3f', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'אופנוע', 'ב.מ.וו', NULL, 2013, '8294075', 'f800gs', 141000, '2026-01-08', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('8d7d88a2-7286-4542-b7d6-35b2fcbdca71', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'אופנוע', 'Kawasaki', 'sx1000z', 2016, '7967834', 'קווסאקי', 85000, '2026-03-12', '2026-03-17') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('9be8f67a-90f7-48ab-8503-39bdfe08bcfc', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'אופנוע', 'הונדה', 'ורדארו', 2007, '6537464', 'אופנוע תיור ', 175000, '2026-11-05', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('7855d5c8-26d7-49fa-94ac-377340c0f96a', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'עגלה נגררת', 'פז נגררים', 'עגלה פתוחה ', 2013, '9809574', 'נגרר', NULL, '2026-10-16', '2026-10-31') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('99d70eb9-7953-45a3-93ef-e884e8207b9e', '8d7d88a2-7286-4542-b7d6-35b2fcbdca71', NULL, 'טיפול', '2025-12-17', 'אני', 700, 'טיפול גדול
שמן ,פילטרים,מצתים', 85000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('0b355f86-93dc-4971-a128-ac35cf31343c', '00186a2d-a0e2-4df6-99c5-4a34a7933d3f', 'תיקון', 'מערכת חשמל', '2026-02-11', 'אני', 600, 'החלפת יח מתג הנעה ') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('3f8b1184-00b9-474c-bf53-ac74e424a5ec', '00186a2d-a0e2-4df6-99c5-4a34a7933d3f', 'תיקון', 'תיקון מערכת קירור', '2025-10-23', 'אני', 500, 'החלפת אטם מכני במשאבת מים
תיקון קולר שמן') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('8f817aba-6390-47b5-a134-4267798a2e6a', '8d7d88a2-7286-4542-b7d6-35b2fcbdca71', 'תיקון', 'כיוון שסתומים והחלפת שרשרת טיימינג', '2026-02-26', 'אני', 750, 'כיוון שסתומים החלפת שרשרת טיימינג 
החלפת כויילים
') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('23e86f4b-c017-4d46-a273-1f9895e56422', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'a4685bbb-0169-4adc-86b5-790204fd7e53', 'ביטוח מקיף', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('005d9ad6-9a31-4ac0-a898-feee0f80d414', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'a4685bbb-0169-4adc-86b5-790204fd7e53', 'ביטוח חובה', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('274a8721-a9d7-4999-8be7-bd23d0e83795', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', '7855d5c8-26d7-49fa-94ac-377340c0f96a', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('e6eb5874-4432-46a9-b98d-1ab571f10fa4', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'dbecfb30-7d8e-4b3f-9a1a-73c643ab7509', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('42912825-9f07-4947-b49e-efa005a01ad7', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', '793894f3-4c4f-40fb-9759-40de94ef2344', 'מסמך אחר', 'מידע אודות רכב', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('07a7e466-11f7-47e0-bbe8-83b62c0f0d08', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', '9be8f67a-90f7-48ab-8503-39bdfe08bcfc', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('8f3eef0f-6247-427d-94be-50734ab81a06', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', 'a4685bbb-0169-4adc-86b5-790204fd7e53', 'רישיון רכב', NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('4d059823-37dd-428f-8c3d-8790a749486a', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', '00186a2d-a0e2-4df6-99c5-4a34a7933d3f', 'מסמך אחר', 'מידע אודות הרכב', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('6b1d2042-1e2e-4b4b-bcbb-b61d67094d01', '6f1270fa-a7ff-44e1-821f-dfc6278bd165', '8d7d88a2-7286-4542-b7d6-35b2fcbdca71', 'רישיון רכב', 'קניון ', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Or Moshe
INSERT INTO accounts (id, name, created_at) VALUES ('14cb82ca-4457-4baf-a789-52e72ec02b2e', 'החשבון של Or Moshe', '2026-02-27T07:59:46.002000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('orrmoshe543@gmail.com', '14cb82ca-4457-4baf-a789-52e72ec02b2e', 'Or Moshe', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של shafir shnarch
INSERT INTO accounts (id, name, created_at) VALUES ('8633cd58-38e2-4b55-ab81-982d798c6d92', 'החשבון של shafir shnarch', '2026-02-27T07:48:07.205000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shafirs@gmail.com', '8633cd58-38e2-4b55-ab81-982d798c6d92', 'shafir shnarch', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('de04a3f9-5dca-477b-9da7-4d817ae65897', '8633cd58-38e2-4b55-ab81-982d798c6d92', 'רכב', 'יונדאי', 'טראקאן', 2003, '9292251', 'טראקאן', NULL, '2026-04-07', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('b26f8914-badb-4732-8e68-0d831462eb99', '8633cd58-38e2-4b55-ab81-982d798c6d92', 'רכב', 'ניסאן', 'סנטרה', 2020, '86170101', 'של איילה', NULL, '2027-01-06', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('3948cf54-b1af-4654-a187-13a618537d3f', '8633cd58-38e2-4b55-ab81-982d798c6d92', 'אופנוע שטח', 'KTM', 'גאס גאס 250', 2022, '47980202', 'גאס גאס', NULL, '2026-06-27', '2026-06-27') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('533ecbf5-ee92-4cfb-b3ea-d9834bff32d0', '8633cd58-38e2-4b55-ab81-982d798c6d92', 'אופנוע כביש', 'סוזוקי', 'DR800 BIG', 1997, '3246201', 'ביג', NULL, '2026-05-04', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('17ce0165-d276-425d-a2b6-91d62e25b9f4', '8633cd58-38e2-4b55-ab81-982d798c6d92', 'אופנוע שטח', 'KTM', '250', 2019, '32598701', 'האסקי של עידו', NULL, '2024-10-29', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Dor Edelshtein
INSERT INTO accounts (id, name, created_at) VALUES ('662b7021-631b-4ffc-aa79-d1c7fe4b4055', 'החשבון של Dor Edelshtein', '2026-02-27T07:29:47.606000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('dor6975577@gmail.com', '662b7021-631b-4ffc-aa79-d1c7fe4b4055', 'Dor Edelshtein', '0526975577', '1998-03-15', NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('5ef2e63e-a609-4cf5-bbed-28959bc94865', '662b7021-631b-4ffc-aa79-d1c7fe4b4055', 'רכב', 'סיאט', 'IBIZA', 2018, '57816501', NULL, 73700, '2026-10-18', '2026-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('fbd8d56c-3fd0-4e69-bb36-eb5c1ce63060', '662b7021-631b-4ffc-aa79-d1c7fe4b4055', '5ef2e63e-a609-4cf5-bbed-28959bc94865', 'ביטוח מקיף', 'פוליסה איילון 2026', '2026-05-01', '2026-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('3461ea5b-7005-4c4e-82ed-bafb5d348e67', '662b7021-631b-4ffc-aa79-d1c7fe4b4055', '5ef2e63e-a609-4cf5-bbed-28959bc94865', 'ביטוח חובה', 'חובה איילון 2026', '2026-05-01', '2027-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('b738b77f-7478-4d5e-8ed1-91f40d680a05', '662b7021-631b-4ffc-aa79-d1c7fe4b4055', '5ef2e63e-a609-4cf5-bbed-28959bc94865', 'ביטוח מקיף', 'פוליסת ביטוח', '2025-05-01', '2026-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('26a35d57-4dc3-47eb-a468-3b4ca0fb9b6a', '662b7021-631b-4ffc-aa79-d1c7fe4b4055', '5ef2e63e-a609-4cf5-bbed-28959bc94865', 'ביטוח חובה', 'ביטוח חובה', '2025-05-01', '2026-04-30') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('46944f40-4a63-4e84-bb6b-2f07ea9b819b', '662b7021-631b-4ffc-aa79-d1c7fe4b4055', '5ef2e63e-a609-4cf5-bbed-28959bc94865', 'רישיון רכב', 'רישיון רכב', '2025-09-30', '2026-10-18') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של avivsulimani0
INSERT INTO accounts (id, name, created_at) VALUES ('f5f3cb44-b77e-43f5-ab1a-9623e4a57ff7', 'החשבון של avivsulimani0', '2026-02-26T19:42:15.708000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avivsulimani0@gmail.com', 'f5f3cb44-b77e-43f5-ab1a-9623e4a57ff7', 'avivsulimani0', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Meni Israel
INSERT INTO accounts (id, name, created_at) VALUES ('919fd1e0-c478-47ba-9350-7dd109dd56fc', 'החשבון של Meni Israel', '2026-02-26T10:27:23.961000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('meni@wittix.com', '919fd1e0-c478-47ba-9350-7dd109dd56fc', 'Meni Israel', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('2fea7600-77bd-4bf2-a044-f110e4ec74f3', '919fd1e0-c478-47ba-9350-7dd109dd56fc', 'עגלה נגררת', 'גרורי אמון', NULL, 2025, '49061004', NULL, NULL, '2027-12-03', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של אבי אדלשטיין
INSERT INTO accounts (id, name, created_at) VALUES ('2c2ba187-ebd4-4b34-9af6-4c82b6afd5a8', 'החשבון של אבי אדלשטיין', '2026-02-25T12:30:44.058000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avimaar@gmail.com', '2c2ba187-ebd4-4b34-9af6-4c82b6afd5a8', 'אבי אדלשטיין', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Josh Saffar
INSERT INTO accounts (id, name, created_at) VALUES ('8bbfd084-6a08-4762-8d7f-91214a55e4a7', 'החשבון של Josh Saffar', '2026-02-25T11:56:01.639000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('joshua.sefer@gmail.com', '8bbfd084-6a08-4762-8d7f-91214a55e4a7', 'Josh Saffar', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Liron Makdasi
INSERT INTO accounts (id, name, created_at) VALUES ('cde6f1cf-7120-4528-a776-e57dca0af7c6', 'החשבון של Liron Makdasi', '2026-02-25T08:47:32.155000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('liron@payplus.co.il', 'cde6f1cf-7120-4528-a776-e57dca0af7c6', 'Liron Makdasi', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Einav Ahvan
INSERT INTO accounts (id, name, created_at) VALUES ('fc440fd5-a78a-4ea2-b196-b6d1b40c4996', 'החשבון של Einav Ahvan', '2026-02-25T08:20:02.984000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('einav.ahvan@gmail.com', 'fc440fd5-a78a-4ea2-b196-b6d1b40c4996', 'Einav Ahvan', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('11c792e2-44a2-4596-a9b0-d58723930049', 'fc440fd5-a78a-4ea2-b196-b6d1b40c4996', 'רכב', 'סיאט', 'איביזה', 2017, '37201701', 'סיאט איביזה', 117000, '2027-01-25', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Niv Ben Oz
INSERT INTO accounts (id, name, created_at) VALUES ('645817ad-7bc0-4076-8dab-ffd1d45487ed', 'החשבון של Niv Ben Oz', '2026-02-25T05:41:08.194000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('nivblind@gmail.com', '645817ad-7bc0-4076-8dab-ffd1d45487ed', 'Niv Ben Oz', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('44ca8fe8-43cf-4b68-8ab5-72219c9d5fca', '645817ad-7bc0-4076-8dab-ffd1d45487ed', 'רכב', 'פולקסווגן', NULL, 2016, '2482938', NULL, NULL, '2026-02-25', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('b3fa16f1-826d-4ac3-9b3f-0bb066320676', '645817ad-7bc0-4076-8dab-ffd1d45487ed', 'אופנוע', 'הונדה', NULL, 2023, '31503603', NULL, 47000, '2026-02-25', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('2dcced8d-ea1c-41ff-9994-e2cda1422f75', '645817ad-7bc0-4076-8dab-ffd1d45487ed', 'רכב', 'לנד רובר', NULL, 2020, '71448001', NULL, 115000, '2026-02-25', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של גיא רויזמן
INSERT INTO accounts (id, name, created_at) VALUES ('fa08cf5d-6c45-4d69-9732-547223425f7f', 'החשבון של גיא רויזמן', '2026-02-24T19:30:48.657000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('guyguy16794@gmail.com', 'fa08cf5d-6c45-4d69-9732-547223425f7f', 'גיא רויזמן', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של YOAV JAUI
INSERT INTO accounts (id, name, created_at) VALUES ('6dbbd77b-d5a4-4f2e-a1ae-4cbe8088df22', 'החשבון של YOAV JAUI', '2026-02-24T19:08:40.808000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('jaui.yoav@gmail.com', '6dbbd77b-d5a4-4f2e-a1ae-4cbe8088df22', 'YOAV JAUI', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('aa860e7a-0802-403d-a4e8-4f30df95a857', '6dbbd77b-d5a4-4f2e-a1ae-4cbe8088df22', 'רכב', 'אאודי', 'Q2', 2019, '83934101', 'של רויאל', 140000, '2027-12-24', '2027-01-24') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של אביב קריסטל
INSERT INTO accounts (id, name, created_at) VALUES ('94862633-9583-4bba-a7f7-7addb2b6337e', 'החשבון של אביב קריסטל', '2026-02-24T18:21:54.931000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('avivkristal134@gmail.com', '94862633-9583-4bba-a7f7-7addb2b6337e', 'אביב קריסטל', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ‫שוהם אדלשטיין (‪shoam edelshtain‬‏)‬‎
INSERT INTO accounts (id, name, created_at) VALUES ('c1ca00b5-90b5-499d-8915-6f3562cfa63a', 'החשבון של ‫שוהם אדלשטיין (‪shoam edelshtain‬‏)‬‎', '2026-02-24T17:57:01.667000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('shoam2852004@gmail.com', 'c1ca00b5-90b5-499d-8915-6f3562cfa63a', '‫שוהם אדלשטיין (‪shoam edelshtain‬‏)‬‎', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('4627fd3f-ec1f-4b6e-acdd-e2ce4a70264d', 'c1ca00b5-90b5-499d-8915-6f3562cfa63a', 'רכב', 'פולקסווגן', 'גולף', 2019, '83827801', 'הגולף של שוהם', 70000, '2026-10-09', '2026-09-14') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('b140aef4-2dbc-4e1f-b316-e99949fcb60a', '4627fd3f-ec1f-4b6e-acdd-e2ce4a70264d', NULL, 'טיפול', '2026-02-24', 'מוסך', 1750, 'החלפת רפידות ובלמים', 70000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('54d4ec8b-83d1-47fe-bacd-00a85474c264', '4627fd3f-ec1f-4b6e-acdd-e2ce4a70264d', 'תיקון', 'תיקון פנצר בגלגל  ', '2026-02-24', 'מוסך', 60, 'תיקון פנצר בגלגל ימין אחורי') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Sahar Binyamin
INSERT INTO accounts (id, name, created_at) VALUES ('9f087093-0d0f-4a4f-bcbb-7ff91daea997', 'החשבון של Sahar Binyamin', '2026-02-24T14:05:18.854000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('saharbin90@gmail.com', '9f087093-0d0f-4a4f-bcbb-7ff91daea997', 'Sahar Binyamin', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('4bf6ab7a-3177-459f-a7c1-b61bdd1e228b', '9f087093-0d0f-4a4f-bcbb-7ff91daea997', 'רכב', 'מאזדה', 'CX5', 2022, '89936702', 'האוטו של אבאלה', 55000, '2026-05-01', '2026-12-01') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('e7a0814c-ae28-4768-924d-b2a6bff590e4', '4bf6ab7a-3177-459f-a7c1-b61bdd1e228b', NULL, 'טיפול', '2026-02-10', 'אני', 500, 'אבא שלי היקר מכל - לקח את הרכב ליום טיפול.
', 55000) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של idosn121
INSERT INTO accounts (id, name, created_at) VALUES ('774971ca-b1ff-4e20-9f0f-ad8e6b799708', 'החשבון של idosn121', '2026-02-24T11:28:32.855000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('idosn121@gmail.com', '774971ca-b1ff-4e20-9f0f-ad8e6b799708', 'idosn121', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
-- SKIPPED duplicate plate: 3246201 (סוזוקי Dr big 800s)

-- Account: החשבון של עומרי רפאלי
INSERT INTO accounts (id, name, created_at) VALUES ('b5365fa2-8097-4fd0-9763-64ac49b37bca', 'החשבון של עומרי רפאלי', '2026-02-24T10:41:39') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('omrir7@gmail.com', 'b5365fa2-8097-4fd0-9763-64ac49b37bca', 'עומרי רפאלי', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של Ilan Miller
INSERT INTO accounts (id, name, created_at) VALUES ('2b7780e4-0868-420e-b931-a7eca7f54d11', 'החשבון של Ilan Miller', '2026-02-24T09:52:53.966000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ilanmi.technion@gmail.com', '2b7780e4-0868-420e-b931-a7eca7f54d11', 'Ilan Miller', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('0f26dbde-d4ed-4b45-a429-c057abf1a819', '2b7780e4-0868-420e-b931-a7eca7f54d11', 'רכב', 'סוזוקי', 'גימיני', 2022, '10853703', 'הגיפ', NULL, '2026-07-26', NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של ברוך אדלשטיין
INSERT INTO accounts (id, name, created_at) VALUES ('866a1ec0-742e-4ae9-b180-5cf565d3f45f', 'החשבון של ברוך אדלשטיין', '2026-02-24T09:19:53.585000') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('5aa251a5-c87c-41a9-8ca6-33f64f8499d9', '866a1ec0-742e-4ae9-b180-5cf565d3f45f', 'רכב', 'סיטרואן צרפת', 'C3', 2010, '1728474', NULL, NULL, '2026-12-07', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('46636686-8567-466a-a571-d008f316ad58', '866a1ec0-742e-4ae9-b180-5cf565d3f45f', 'אופנוע', 'ימהה יפן', 'VP26 XVS1300', 2011, '2459874', 'אופנוע ימאהה', NULL, '2026-04-27', NULL) ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 1728474 (סיטרואן צרפת C3)
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('37889b99-720f-436f-9562-5f8ee96c63f8', '866a1ec0-742e-4ae9-b180-5cf565d3f45f', 'אופנוע', NULL, NULL, NULL, '9933389', NULL, NULL, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('53844e48-99d4-4e94-855c-c393bcce946b', '866a1ec0-742e-4ae9-b180-5cf565d3f45f', 'רכב', 'ניסאן', 'אקסטריל', 2016, '82-870-37', 'משפחתי ניסן', 177000, '2026-07-27', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('0228a778-70c5-4314-9214-27c1b4768b45', '866a1ec0-742e-4ae9-b180-5cf565d3f45f', '5aa251a5-c87c-41a9-8ca6-33f64f8499d9', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('8fc49f26-3526-4d69-b1dd-1ef1ef725a74', '866a1ec0-742e-4ae9-b180-5cf565d3f45f', '46636686-8567-466a-a571-d008f316ad58', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('8860922d-54df-436b-8d94-0176b8862163', '866a1ec0-742e-4ae9-b180-5cf565d3f45f', '264cb2f5-2a3b-460f-b8f2-e4c08c82084c', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של barak643
INSERT INTO accounts (id, name, created_at) VALUES ('97a8d970-b971-4726-a15e-d0f1f378bb7b', 'החשבון של barak643', '2026-02-24T09:16:40.872000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('barak643@gmail.com', '97a8d970-b971-4726-a15e-d0f1f378bb7b', 'barak643', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של natanzone2024
INSERT INTO accounts (id, name, created_at) VALUES ('7ad84594-31f0-4dad-86ef-258465d8d5b2', 'החשבון של natanzone2024', '2026-02-24T09:15:43.118000') ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 8287037 (ניסאן יפן X-TRAIL)
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('601dc823-c39f-4c04-9ad1-b516f22dc381', '7ad84594-31f0-4dad-86ef-258465d8d5b2', 'אופנוע כביש', 'גס גס', NULL, NULL, '664787', 'סוסיתא', 635966, '2026-03-20', '2026-03-13') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('728dc8b2-c205-4195-adfc-6f7ec0938cc7', '7ad84594-31f0-4dad-86ef-258465d8d5b2', '62fd2b9d-41e9-40bc-978f-e6abfaa5685f', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של Roy simplex
INSERT INTO accounts (id, name, created_at) VALUES ('5bf29567-1481-4bde-a135-73acf6be735e', 'החשבון של Roy simplex', '2026-02-24T08:57:04.806000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('roy@simplex3d.com', '5bf29567-1481-4bde-a135-73acf6be735e', 'Roy simplex', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('d5cb8148-09f1-4323-96eb-f21172f6156b', '5bf29567-1481-4bde-a135-73acf6be735e', 'רכב', 'יונדאי', 'טוסון', 2022, '11868803', 'טוסון', 68000, '2026-08-01', '2026-09-10') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('a492f00e-bd6f-44f6-aaea-cd7bab84549f', '5bf29567-1481-4bde-a135-73acf6be735e', 'רכב', 'יונדאי', 'kona', 2019, '77839301', 'קונה', 84000, '2026-06-14', '2026-12-31') ON CONFLICT (id) DO NOTHING;

-- Account: החשבון של inbar miller
INSERT INTO accounts (id, name, created_at) VALUES ('089bb3b2-ade4-40e7-85ec-5ffb939717a9', 'החשבון של inbar miller', '2026-02-24T08:53:08.344000') ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 15979503 (יונדאי קונה)

-- Account: החשבון של ofek.ede1994
INSERT INTO accounts (id, name, created_at) VALUES ('32d5cc66-a099-41e6-99dd-88ed77f5c69b', 'החשבון של ofek.ede1994', '2026-02-24T08:26:43.807000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ofek.ede1994@gmail.com', '32d5cc66-a099-41e6-99dd-88ed77f5c69b', 'ofek.ede1994', NULL, NULL, NULL, NULL) ON CONFLICT (email) DO NOTHING;

-- Account: החשבון של ofek205
INSERT INTO accounts (id, name, created_at) VALUES ('400ec135-a4ab-498b-bef1-b7fecc46ff89', 'החשבון של ofek205', '2026-02-23T12:16:38.534000') ON CONFLICT (id) DO NOTHING;
INSERT INTO migration_email_map (email, account_id, full_name, phone, birth_date, driver_license_number, license_expiration_date) VALUES ('ofek205@gmail.com', '400ec135-a4ab-498b-bef1-b7fecc46ff89', 'ofek205', '0523043322', '1994-04-17', '9426286', '2028-04-17') ON CONFLICT (email) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('0b2e9f4f-6744-485a-a5e4-10a56382b448', '400ec135-a4ab-498b-bef1-b7fecc46ff89', 'רכב', NULL, 'דגגדג', 2025, '55555544', 'יוסי יוסי ', 110000, NULL, NULL) ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 15979503 (יונדאי קונה חשמלית )
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('c5400119-1375-49d8-89b8-0dd35d3a21de', '400ec135-a4ab-498b-bef1-b7fecc46ff89', 'אופנוע כביש', 'Piago', 'Mp3 300', 2015, '9397830', 'קטנוע 3 גלגלים ', 120000, '2027-02-01', '2027-02-01') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicles (id, account_id, vehicle_type, manufacturer, model, year, license_plate, nickname, current_km, test_due_date, insurance_due_date) VALUES ('68666018-6ab2-4c48-aa90-1ee003ab4286', '400ec135-a4ab-498b-bef1-b7fecc46ff89', 'אופנוע', 'Ktm ', 'Exc - f sixdays', 2017, '5183939', 'האופנוע שטח של אופק', NULL, '2025-10-09', '2026-10-09') ON CONFLICT (id) DO NOTHING;
-- SKIPPED duplicate plate: 25908901 (פולסווגן גולף)
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('901a917f-21fa-4425-8c6a-701bb1647df5', 'e7c26485-1f4a-45cf-819a-5ec6678913b1', 'small', 'טיפול קטן', '2026-03-23', 'אני', 250, 'גכרעגעעעכג', 102000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('f1d16993-e84f-4872-828a-46a755c9b423', '68666018-6ab2-4c48-aa90-1ee003ab4286', 'small', 'טיפול קטן', '2026-03-06', 'אני', 225, 'שפיר קנה שמן ופילטר ועידו עשה את הטיפול', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('5dddc631-d847-4aa1-a2e3-6a53aba0fc13', 'ba0dc111-0f45-4e97-b067-a5eb9b5d01f9', NULL, 'טיפול', '2025-08-01', 'אני', 300, NULL, 127000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('428e8461-2e90-4b3d-b408-25e40d359db3', 'c5400119-1375-49d8-89b8-0dd35d3a21de', NULL, 'טיפול', '2026-02-01', 'מוסך', 100, 'איתן עשה ', 44000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('0d5ae00e-66c6-415e-a75a-f6f033e6ffb8', '68666018-6ab2-4c48-aa90-1ee003ab4286', NULL, 'טיפול', '2026-02-27', 'אני', 100, 'עידו עושה טיפול שמן ופילטר ', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('5b878690-fd71-4cc0-9bfc-1d93fa34336a', 'c5400119-1375-49d8-89b8-0dd35d3a21de', NULL, 'טיפול', '2026-02-01', 'אני', 450, 'הוחלף מצבר', 45000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('42c60297-b5f7-45a1-a9ed-d902aebc7cfe', 'c5400119-1375-49d8-89b8-0dd35d3a21de', NULL, 'טיפול', '2026-02-01', 'מוסך', NULL, 'איתן החליף אימפלור משאבת מים  ', 45000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('f9757487-2aa6-4756-9ee7-adeb56c5518e', 'ba0dc111-0f45-4e97-b067-a5eb9b5d01f9', NULL, 'טיפול', '2026-02-24', 'מוסך', NULL, NULL, 127000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('eeccccd7-aec7-4230-8f26-f5a61e8ef88c', 'ba0dc111-0f45-4e97-b067-a5eb9b5d01f9', NULL, 'טיפול', '2025-03-01', 'אני', NULL, NULL, 98000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('e4f31ff3-54cf-4a6d-a9c4-b56561b74c69', 'ba0dc111-0f45-4e97-b067-a5eb9b5d01f9', NULL, 'טיפול', '2025-01-01', 'אני', NULL, 'החלפנו פלאים למקוריים', 96000) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('6558d5bb-fa4e-4f22-b081-f64ff4cdf771', '68666018-6ab2-4c48-aa90-1ee003ab4286', NULL, 'טיפול', '2025-04-01', 'מוסך', NULL, 'יניב עשה מנוע עליון ותחתון וגם החליף את הסלילים של האלטרנטור ', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes, km_at_service) VALUES ('a81938e3-22bc-4e01-8814-6bcb2b31d7fa', '68666018-6ab2-4c48-aa90-1ee003ab4286', NULL, 'טיפול', '2025-10-10', 'אני', NULL, 'לאחר הצהריים בוצע טיפול שמן מנוע ופילטר שמן אצל עידו ', NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('6117ade5-b961-4223-9022-02e0cea19901', 'e7c26485-1f4a-45cf-819a-5ec6678913b1', 'תיקון', 'מכה בדלת ', '2026-03-23', 'אני', 250, 'הנהנמבהב') ON CONFLICT (id) DO NOTHING;
INSERT INTO maintenance_logs (id, vehicle_id, type, title, date, garage_name, cost, notes) VALUES ('d6175fad-fabc-45a8-a5fc-bc9034215e87', '68666018-6ab2-4c48-aa90-1ee003ab4286', 'תיקון', 'החלפת מצבר', '2025-01-24', 'אני', 500, 'הוחלף מצבר') ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('3322528b-0014-4001-999f-60c56e2eee2e', '400ec135-a4ab-498b-bef1-b7fecc46ff89', '68666018-6ab2-4c48-aa90-1ee003ab4286', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('de47c31e-861b-4bee-a44e-913201814a8f', '400ec135-a4ab-498b-bef1-b7fecc46ff89', '68666018-6ab2-4c48-aa90-1ee003ab4286', 'רישיון רכב', 'רישיון רכב (סרוק)', NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO documents (id, account_id, vehicle_id, document_type, title, issue_date, expiry_date) VALUES ('32693cd6-01a6-4cc7-84f6-582310d25261', '400ec135-a4ab-498b-bef1-b7fecc46ff89', '68666018-6ab2-4c48-aa90-1ee003ab4286', 'רישיון רכב', 'רישיון רכב ', '2026-02-24', '2026-10-09') ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ── Step 3: Validation queries (run after migration) ──
SELECT 'accounts' AS entity, COUNT(*) FROM accounts WHERE id IN (SELECT account_id FROM migration_email_map);
SELECT 'vehicles' AS entity, COUNT(*) FROM vehicles WHERE account_id IN (SELECT account_id FROM migration_email_map);
SELECT 'maintenance_logs' AS entity, COUNT(*) FROM maintenance_logs WHERE vehicle_id IN (SELECT id FROM vehicles WHERE account_id IN (SELECT account_id FROM migration_email_map));
SELECT 'documents' AS entity, COUNT(*) FROM documents WHERE account_id IN (SELECT account_id FROM migration_email_map);
SELECT 'email_mappings' AS entity, COUNT(*) FROM migration_email_map;