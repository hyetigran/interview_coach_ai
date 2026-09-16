#!/usr/bin/env python3
"""Freeze and evaluate a private interview corpus. No network or model calls."""
import argparse
import hashlib
import json
import secrets
from pathlib import Path
import sys


def read(path):
    return json.loads(path.read_text())


def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def write(path, value):
    # Evaluation files may contain private source material. Refuse overwrite.
    with path.open('x', encoding='utf8') as handle:
        path.chmod(0o600)
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write('\n')


def snapshot(manifest_path):
    manifest = read(manifest_path)
    cases = manifest.get('cases', [])
    if not cases:
        raise ValueError('No evaluation cases: independent validation is unevaluated.')
    ids = set()
    artifacts = {}
    questions = []
    independent = True
    for case in cases:
        if not case.get('id') or case['id'] in ids:
            raise ValueError('Case IDs must be unique and nonempty.')
        ids.add(case['id'])
        if case.get('origin') not in ('hiring', 'mock', 'synthetic'):
            raise ValueError('Every case needs a hiring, mock, or synthetic origin.')
        if not case.get('permission_reference'):
            raise ValueError('Every case needs a permission reference; synthetic fixtures must say so.')
        if case.get('split') != 'held_out':
            raise ValueError('Freeze a held-out manifest separately from development material.')
        independent = independent and case['origin'] != 'synthetic'
        for field in ('recording_file', 'reference_file', 'context_file'):
            relative = case.get(field, '')
            path = (manifest_path.parent / relative).resolve()
            if not relative or not path.is_relative_to(manifest_path.parent.resolve()) or not path.is_file():
                raise ValueError(f'Missing or out-of-corpus {field} for {case["id"]}.')
            artifacts[relative] = digest(path)
        reference = read(manifest_path.parent / case['reference_file'])
        if not reference.get('labeler_id'):
            raise ValueError('Reference labels need a pseudonymous labeler ID.')
        independent = independent and reference.get('independent_labeler') is True
        seen = set()
        for question in reference.get('questions', []):
            qid = question.get('id')
            if not qid or qid in seen:
                raise ValueError('Question IDs must be unique within each case.')
            seen.add(qid)
            if not isinstance(question.get('substantive'), bool):
                raise ValueError('Every question needs a substantive flag before outputs are reviewed.')
            if not isinstance(question.get('answer_utterance_ids'), list):
                raise ValueError('Every reference question needs answer spans, including an empty list for unanswered questions.')
            if question['substantive']:
                if not question.get('thread_id'):
                    raise ValueError('Substantive questions need a thread ID to distinguish follow-ups from independent threads.')
                questions.append({'case_id': case['id'], 'question_id': qid, 'thread_id': question['thread_id']})
    if not questions:
        raise ValueError('No substantive questions: accuracy and coverage are unevaluated.')
    return {'schema_version': 1, 'manifest_sha256': digest(manifest_path), 'artifacts': artifacts,
            'cases': len(cases), 'questions': questions,
            'evidence_kind': 'independently_labeled' if independent else 'development_or_author_evaluated'}


def score(manifest_path, lock_path, ratings_path):
    locked = read(lock_path)
    if snapshot(manifest_path) != locked:
        raise ValueError('Corpus or reference labels changed since freezing; create a new evaluation instead.')
    ratings = read(ratings_path)
    reviewers = {r['id']: r for r in ratings.get('reviewers', [])}
    if not reviewers or len(reviewers) != len(ratings['reviewers']):
        raise ValueError('Provide unique pseudonymous reviewers and their independence declarations.')
    questions = {(q['case_id'], q['question_id']) for q in locked['questions']}
    threads = {(q['case_id'], q['thread_id']) for q in locked['questions']}
    def checked_rows(section, key_name, allowed, flags):
        rows = ratings.get(section, [])
        seen = set()
        for row in rows:
            key = (row['case_id'], row[key_name])
            if key not in allowed or row['reviewer_id'] not in reviewers:
                raise ValueError(f'Unknown frozen evidence or reviewer in {section}.')
            identity = (*key, row['reviewer_id'], row.get('system'))
            if identity in seen:
                raise ValueError(f'Duplicate judgment in {section}.')
            seen.add(identity)
            for flag in flags:
                if not isinstance(row.get(flag), bool):
                    raise ValueError(f'{section}.{flag} must be a boolean.')
        return rows
    grouping = checked_rows('grouping', 'question_id', questions,
                            ['correct_association', 'omitted', 'attribution_error', 'transcription_error'])
    coaching = checked_rows('coaching', 'thread_id', threads, ['supported_action', 'abstained'])
    for row in coaching:
        if row.get('system') not in ('app', 'baseline'):
            raise ValueError('Unblind ratings to app/baseline using the sealed assignment map before scoring.')
        for field in ('critical_defects', 'major_defects'):
            if not isinstance(row.get(field), list) or any(not isinstance(v, str) or not v for v in row[field]):
                raise ValueError('Defects must be lists of nonempty descriptions.')
    associated = omitted = disputed_groups = 0
    for case_id, question_id in questions:
        votes = [r for r in grouping if (r['case_id'], r['question_id']) == (case_id, question_id)]
        associated += bool(votes) and all(r['correct_association'] and not r['omitted'] for r in votes)
        omitted += not votes or any(r['omitted'] for r in votes)
        disputed_groups += len({(r['correct_association'], r['omitted']) for r in votes}) > 1
    spurious = ratings.get('spurious_groups', [])
    case_ids = {case for case, _ in questions}
    for row in spurious:
        if row.get('case_id') not in case_ids or row.get('reviewer_id') not in reviewers or not row.get('group_id'):
            raise ValueError('Spurious groups require a known case/reviewer and an output group ID.')
    result = {}
    for system in ('app', 'baseline'):
        supported = disputed = missing = critical = major = abstentions = 0
        for key in threads:
            votes = [r for r in coaching if (r['case_id'], r['thread_id']) == key and r['system'] == system]
            passes = [r['supported_action'] and not r['abstained'] and not r['critical_defects'] and not r['major_defects'] for r in votes]
            supported += bool(votes) and all(passes)
            disputed += len(set(passes)) > 1
            missing += not votes
            critical += any(r['critical_defects'] for r in votes)
            major += any(r['major_defects'] for r in votes)
            abstentions += any(r['abstained'] for r in votes)
        result[system] = {'supported_threads': supported, 'total_threads': len(threads),
                          'coverage': supported / len(threads), 'coverage_target_met': supported / len(threads) >= .7,
                          'disputed_threads': disputed, 'unreviewed_threads': missing, 'abstention_threads': abstentions,
                          'critical_defect_threads': critical, 'major_defect_threads': major, 'critical_defect_block': critical > 0}
    reviewed_questions = {(r['case_id'], r['question_id']) for r in grouping}
    independent = locked['evidence_kind'] == 'independently_labeled' and all(r.get('independent') is True for r in reviewers.values())
    complete = reviewed_questions == questions and all(r['unreviewed_threads'] == 0 for r in result.values())
    return {'schema_version': 1, 'lock_sha256': digest(lock_path), 'ratings_sha256': digest(ratings_path),
            'validation_status': 'independently_reviewed_sample' if independent and complete else 'not_independent_validation',
            'limitations': ['Independence and permission are declared by the evaluation organizer, not verified by this tool.',
                           'Sample results do not establish population reliability or hiring outcomes.',
                           'The 100-recommendation major-defect gate for broader release is not evaluated by this report.'],
            'case_count': locked['cases'], 'reviewer_count': len(reviewers),
            'grouping': {'correct_associations': associated, 'total_questions': len(questions), 'accuracy': associated / len(questions),
                         'target_met': associated / len(questions) >= .9, 'omitted_or_unreviewed_questions': omitted,
                         'unreviewed_questions': len(questions - reviewed_questions), 'disputed_questions': disputed_groups,
                         'spurious_groups': len({(r['case_id'], r['group_id']) for r in spurious}),
                         'attribution_error_questions': len({(r['case_id'], r['question_id']) for r in grouping if r['attribution_error']}),
                         'transcription_error_questions': len({(r['case_id'], r['question_id']) for r in grouping if r['transcription_error']})},
            'coaching': result}


def blind(manifest_path, lock_path, outputs_path, output_dir):
    locked = read(lock_path)
    if snapshot(manifest_path) != locked:
        raise ValueError('Corpus or reference labels changed since freezing.')
    cases = {case['id']: case for case in read(manifest_path)['cases']}
    expected = {(q['case_id'], q['thread_id']) for q in locked['questions']}
    items = read(outputs_path)['items']
    actual = [(item['case_id'], item['thread_id']) for item in items]
    if set(actual) != expected or len(actual) != len(expected):
        raise ValueError('Provide exactly one app/baseline pair for every frozen thread, including absent output as empty text.')
    packets, assignments = [], []
    for item in items:
        if not all(isinstance(item.get(system), str) for system in ('app', 'baseline')):
            raise ValueError('Each system output must be text.')
        systems = ['app', 'baseline']
        secrets.SystemRandom().shuffle(systems)
        packet_id = secrets.token_hex(12)
        source = read(manifest_path.parent / cases[item['case_id']]['context_file'])
        packets.append({'packet_id': packet_id, 'case_id': item['case_id'], 'thread_id': item['thread_id'], 'source': source,
                        'options': dict(zip(('A', 'B'), [item[system] for system in systems]))})
        assignments.append({'packet_id': packet_id, 'case_id': item['case_id'], 'thread_id': item['thread_id'],
                            'systems': dict(zip(('A', 'B'), systems))})
    secrets.SystemRandom().shuffle(packets)
    output_dir.mkdir(mode=0o700)
    write(output_dir/'reviewer-packets.json', {'items': packets})
    write(output_dir/'sealed-assignments.json', {'lock_sha256': digest(lock_path), 'outputs_sha256': digest(outputs_path), 'items': assignments})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    freeze = sub.add_parser('freeze')
    freeze.add_argument('manifest', type=Path)
    freeze.add_argument('output', type=Path)
    scoring = sub.add_parser('score')
    for name in ('manifest', 'lock', 'ratings', 'output'):
        scoring.add_argument(name, type=Path)
    blinding = sub.add_parser('blind')
    for name in ('manifest', 'lock', 'outputs', 'output_dir'):
        blinding.add_argument(name, type=Path)
    args = parser.parse_args()
    if args.command == 'freeze':
        write(args.output, snapshot(args.manifest))
        print('Corpus frozen. This is not a completed quality evaluation.')
    elif args.command == 'score':
        write(args.output, score(args.manifest, args.lock, args.ratings))
        print('Sample report written; read its validation status and limitations.')
    elif args.command == 'blind':
        blind(args.manifest, args.lock, args.outputs, args.output_dir)
        print('Reviewer packets written. Keep sealed assignments separate from reviewers.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(f'Evaluation stopped: {error}', file=sys.stderr)
        sys.exit(1)
