CREATE TABLE download_clicks (
  day TEXT NOT NULL,
  button TEXT NOT NULL CHECK (button IN (
    'macos-dmg', 'windows-store', 'linux-appimage', 'linux-deb', 'linux-rpm'
  )),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (day, button)
);
