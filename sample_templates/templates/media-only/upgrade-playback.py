"""Patch only the known Media Only playback handler in installed HTML.

Read-only by default. Apply requires the hash returned by the inspection.
No database replacement: all non-HTML values are fingerprinted in a transaction.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3

OLD = re.compile(r"(?m)^([ \t]*)function applyMediaSignal\(value\) \{\r?\n\1  renderMedia\(parseMediaSignal\(value\)\);\r?\n\1\}")
NEW = re.compile(r"(?m)^([ \t]*)var currentPlaybackSignal = null;\r?\n\1function applyMediaSignal\(value\) \{[\s\S]*?^\1\}")
SOURCE = Path(__file__).with_name('dashboard.html').read_text(encoding='utf-8')
BLOCK = NEW.search(SOURCE)
if not BLOCK:
    raise RuntimeError('Updated playback handler is missing from the template')
LINES = [line[len(BLOCK[1]):] for line in BLOCK[0].splitlines()]


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def patch(html):
    if 'ai-bridge-media-only-config' not in html:
        return html
    matches = list(OLD.finditer(html))
    if not matches and NEW.search(html):
        return html
    if len(matches) != 1:
        raise ValueError('Unrecognized Media Only handler; HTML was not changed')
    match = matches[0]
    newline = '\r\n' if '\r\n' in match[0] else '\n'
    replacement = newline.join(match[1] + line for line in LINES)
    return html[:match.start()] + replacement + html[match.end():]


def plan(db, account_key):
    ops = []
    targets = [('main', 'system_pages', 'page_id'), ('main', 'media_screen_templates', 'role')]
    if any(row[1] == 'users' for row in db.execute('PRAGMA database_list')):
        targets.append(('users', 'google_user_dashboard_versions', 'id'))
    for schema, table, key in targets:
        if not db.execute(f"SELECT 1 FROM {schema}.sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
            continue
        for row in db.execute(f'SELECT * FROM {schema}.{table}'):
            if table == 'google_user_dashboard_versions':
                if 'AC_' + sha(row['googleSub']) != account_key:
                    continue
                html = gzip.decompress(row['htmlGzip']).decode('utf-8')
            else:
                html = row['html']
            next_html = patch(html)
            if next_html == html:
                continue
            ops.append({'schema': schema, 'table': table, 'key': key, 'value': row[key],
                        'before': sha(html), 'after': sha(next_html), 'html': html, 'next': next_html})
    public = [{k: v for k, v in op.items() if k not in ('html', 'next')} for op in ops]
    return ops, sha(json.dumps(public, sort_keys=True)), public


def protected(db, ops):
    digest = hashlib.sha256()
    for schema in [row[1] for row in db.execute('PRAGMA database_list') if row[1] in ('main', 'users')]:
        for (table,) in db.execute(f"SELECT name FROM {schema}.sqlite_master WHERE type='table' ORDER BY name"):
            targets = [op for op in ops if op['schema'] == schema and op['table'] == table]
            rows = []
            quoted = '"' + table.replace('"', '""') + '"'
            for row in db.execute(f'SELECT * FROM {schema}.{quoted}'):
                data = dict(row)
                if any(data[op['key']] == op['value'] for op in targets):
                    for column in (('htmlGzip', 'htmlSha256') if table == 'google_user_dashboard_versions' else ('html',)):
                        data.pop(column, None)
                rows.append(json.dumps(data, sort_keys=True, default=lambda value: {'blobSha256': sha(value)}))
            digest.update(json.dumps([schema, table, sorted(rows)]).encode())
    return digest.hexdigest()


def apply(db, account_key, expected):
    db.execute('BEGIN IMMEDIATE')
    try:
        ops, digest, public = plan(db, account_key)
        if digest != expected:
            raise ValueError('Plan changed since inspection; no changes applied')
        before = protected(db, ops)
        for op in ops:
            if op['table'] == 'google_user_dashboard_versions':
                result = db.execute('UPDATE users.google_user_dashboard_versions SET htmlGzip=?,htmlSha256=? WHERE id=?',
                                    (gzip.compress(op['next'].encode()), op['after'], op['value']))
            else:
                result = db.execute(f"UPDATE {op['schema']}.{op['table']} SET html=? WHERE {op['key']}=? AND html=?",
                                    (op['next'], op['value'], op['html']))
            if result.rowcount != 1:
                raise ValueError('Target changed')
        if before != protected(db, ops) or plan(db, account_key)[0]:
            raise ValueError('Preservation or readback failed')
        db.commit()
        return {'changed': len(ops), 'protectedHash': before, 'targets': public}
    except BaseException:
        db.rollback()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True)
    parser.add_argument('--dashboard-db')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected')
    args = parser.parse_args()
    if args.apply and not args.expected:
        parser.error('--apply requires --expected from a read-only inspection')
    file = Path(args.database).resolve()
    db = sqlite3.connect(file.as_uri() + ('?mode=rw' if args.apply else '?mode=ro'), uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        if args.dashboard_db:
            users = Path(args.dashboard_db).resolve().as_uri() + ('?mode=rw' if args.apply else '?mode=ro')
            db.execute('ATTACH DATABASE ? AS users', (users,))
        if args.apply:
            result = apply(db, file.stem, args.expected)
        else:
            ops, digest, public = plan(db, file.stem)
            result = {'pending': len(ops), 'expected': digest, 'targets': public}
        print(json.dumps(result))
    finally:
        db.close()


if __name__ == '__main__':
    main()
