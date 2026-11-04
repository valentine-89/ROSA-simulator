"""Run with the previous dashboard.html as argv[1], before deploying."""
import importlib.util
from pathlib import Path
import sys
import unittest

BASELINE = Path(sys.argv.pop(1)).read_text(encoding='utf-8')
folder = Path(__file__).parent
spec = importlib.util.spec_from_file_location('effects', folder / 'upgrade-effects.py')
effects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(effects)

# Exercise the same transaction, ownership and data-preservation assertions
# against real old/new effect runtimes, including five installed screens.
test_spec = importlib.util.spec_from_file_location('preservation', folder / 'upgrade-playback.test.py')
preservation = importlib.util.module_from_spec(test_spec)
test_spec.loader.exec_module(preservation)
preservation.upgrade = effects.engine
preservation.OLD_HTML = BASELINE


class EffectsUpgradeTest(unittest.TestCase):
    def test_full_upgrade_and_line_endings(self):
        for newline in ['\n', '\r\n']:
            original = BASELINE.replace('\n', newline)
            updated = effects.patch(original)
            self.assertEqual(updated.replace('\r\n', '\n'), effects.SOURCE)
            self.assertEqual(effects.patch(updated), updated)
        self.assertEqual(effects.patch('<html>other</html>'), '<html>other</html>')

    def test_preserve_custom_config(self):
        original = BASELINE.replace('<<sessionid>>', 'owner@example.com@key').replace('<<syncid>>', 'keep-sync')
        updated = effects.patch(original)
        self.assertIn('owner@example.com@key', updated)
        self.assertIn('keep-sync', updated)
        with self.assertRaisesRegex(ValueError, 'Modified'):
            effects.patch(original.replace('function createFxCanvas()', 'function createFxCanvas() /* custom */'))

    def test_five_screens_and_other_owner_preserved(self):
        test = preservation.UpgradeTest('test_preserve_screens_links_permissions_and_other_dashboards')
        result = unittest.TestResult()
        test.run(result)
        self.assertTrue(result.wasSuccessful(), result.errors or result.failures)


if __name__ == '__main__':
    unittest.main()
