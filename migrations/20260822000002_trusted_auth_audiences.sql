INSERT INTO app_meta(key,value) VALUES('auth_trusted_audiences','["1ex.ntnl.io"]') ON CONFLICT(key) DO NOTHING;
