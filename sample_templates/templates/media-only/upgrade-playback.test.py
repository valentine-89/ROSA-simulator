import gzip
import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location('upgrade', Path(__file__).with_name('upgrade-playback.py'))
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)
OLD_HTML = '<script id="ai-bridge-media-only-config">{"prefix":"frontdoor"}</script>\n' + '''      function applyMediaSignal(value) {
        renderMedia(parseMediaSignal(value));
      }'''


class UpgradeTest(unittest.TestCase):
    def test_exact_handler_and_line_endings(self):
        for newline in ['\n', '\r\n']:
            original = OLD_HTML.replace('\n', newline)
            changed = upgrade.patch(original)
            self.assertIn('currentPlaybackSignal', changed)
            self.assertTrue(changed.startswith(original.split('      function')[0]))
            self.assertEqual(upgrade.patch(changed), changed)
        self.assertEqual(upgrade.patch('<html>unrelated</html>'), '<html>unrelated</html>')
        with self.assertRaisesRegex(ValueError, 'Unrecognized'):
            upgrade.patch(OLD_HTML.replace('renderMedia(parseMediaSignal(value));', 'customPlayer(value);'))

    def test_preserve_screens_links_permissions_and_other_dashboards(self):
        db = sqlite3.connect(':memory:'); db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        db.executescript('''
          CREATE TABLE system_pages(page_id TEXT PRIMARY KEY,html TEXT,sync_id TEXT,require_email INTEGER);
          CREATE TABLE media_screen_templates(role TEXT PRIMARY KEY,html TEXT);
          CREATE TABLE media_screens(screen_id TEXT PRIMARY KEY,name TEXT,prefix TEXT);
          ATTACH DATABASE ':memory:' AS users;
          CREATE TABLE users.google_user_dashboard_versions(id INTEGER PRIMARY KEY,googleSub TEXT,htmlGzip BLOB,htmlSha256 TEXT,note TEXT);
        ''')
        for i in range(5):
            db.execute('INSERT INTO media_screens VALUES(?,?,?)', (str(i), 'Screen ' + str(i), 'room' + str(i)))
            db.execute('INSERT INTO system_pages VALUES(?,?,?,?)', ('display-' + str(i), OLD_HTML, 'keep-sync', i % 2))
        db.execute('INSERT INTO system_pages VALUES(?,?,?,?)', ('other', '<html>keep</html>', 'other-sync', 1))
        db.execute('INSERT INTO media_screen_templates VALUES(?,?)', ('display', OLD_HTML))
        for sub in ['owner', 'other-owner']:
            db.execute('INSERT INTO users.google_user_dashboard_versions(googleSub,htmlGzip,htmlSha256,note) VALUES(?,?,?,?)',
                       (sub, gzip.compress(OLD_HTML.encode()), upgrade.sha(OLD_HTML), 'keep-note'))
        db.commit()
        key = 'AC_' + upgrade.sha('owner')
        ops, expected, public = upgrade.plan(db, key)
        self.assertEqual(len(ops), 7)
        before = upgrade.protected(db, ops)
        with self.assertRaisesRegex(ValueError, 'Plan changed'):
            upgrade.apply(db, key, 'wrong')
        self.assertEqual(upgrade.plan(db, key)[1], expected)
        result = upgrade.apply(db, key, expected)
        self.assertEqual(result['changed'], 7)
        self.assertEqual(upgrade.protected(db, ops), before)
        self.assertEqual(len(db.execute('SELECT * FROM media_screens').fetchall()), 5)
        self.assertFalse(upgrade.plan(db, key)[0])


if __name__ == '__main__':
    unittest.main()
