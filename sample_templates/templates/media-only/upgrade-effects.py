"""Upgrade recognized Media Only effects in place; read-only unless --apply.

Reuse the playback upgrader's pinned plan, transaction, owner scoping and
fingerprint of every non-HTML value. Never replace an installed database.
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('playback_upgrade', Path(__file__).with_name('upgrade-playback.py'))
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
SOURCE = Path(__file__).with_name('dashboard.html').read_text(encoding='utf-8')
CSS = '  <link rel="stylesheet" href="/sample_dashboards/media-only/effects.css?v=20261105">'
JS = '  <script src="/sample_dashboards/media-only/effects.js?v=20261105"></script>'
SECTIONS = [
    ('    .style-ani1 {', '    .style-tech .backdrop::before',
     '64c228887aeb603324f6d6fe86297e43564795716342e83c8f00e30d910737d1', None),
    ('      function createFxCanvas()', '      function normalizeYouTubeUrl',
     '0e370b4d6496ad3672622646f55a9f2c34640b058553c1bdadfb7a690516b111', '      function renderStyleEffects'),
    ('      function fitText()', '      function requestFitText()',
     '58dfbed58c095fc1df6d746cd5d0de96418c526f8b70a878d3b654156367db7a', '      function fitText()'),
    ('      var currentPlaybackSignal = null;', '      function setConnectionState',
     '44b140f748ed86b3cecfa1fe5df89ace532d11152eb0d69d877aca7debfb23c9', '      var currentPlaybackSignal = null;'),
]


def patch(html):
    if 'ai-bridge-media-only-config' not in html:
        return html
    if CSS in html and JS in html and 'function createFxCanvas()' not in html:
        return html
    result = html
    for start, end, expected, replacement_start in SECTIONS:
        if result.count(start) != 1 or result.count(end) != 1:
            raise ValueError('Unrecognized Media Only section; HTML was not changed')
        a, b = result.index(start), result.index(end)
        block = result[a:b]
        if engine.sha(block.replace('\r\n', '\n')) != expected:
            raise ValueError('Modified Media Only section; HTML was not changed')
        newline = '\r\n' if '\r\n' in block else '\n'
        replacement = SOURCE[SOURCE.index(replacement_start):SOURCE.index(end)] if replacement_start else ''
        result = result[:a] + replacement.replace('\n', newline) + result[b:]
    newline = '\r\n' if '\r\n' in html else '\n'
    for before, after in [
        ('  </style>', '  </style>' + newline + CSS),
        ('  <!-- AI-BRIDGE-LOCKED RUNTIME SCRIPT: START -->',
         '  <!-- AI-BRIDGE-LOCKED RUNTIME SCRIPT: START -->' + newline + JS),
        ('renderStyleEffects(parsed.style);', 'renderStyleEffects(parsed.style, parsed.type);'),
    ]:
        if result.count(before) != 1:
            raise ValueError('Unrecognized Media Only insertion point; HTML was not changed')
        result = result.replace(before, after, 1)
    return result


engine.patch = patch
if __name__ == '__main__':
    engine.main()
