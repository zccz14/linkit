-- `username` is already UNIQUE COLLATE NOCASE. The picker also prefixes
-- display names, so this companion index keeps that half of the bounded typeahead indexed.
CREATE INDEX profiles_display_name_nocase ON profiles(display_name COLLATE NOCASE);
