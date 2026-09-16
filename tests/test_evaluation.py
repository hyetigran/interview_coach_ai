import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CLI = Path(__file__).resolve().parents[1] / 'tools' / 'evaluate.py'

class EvaluationTests(unittest.TestCase):
    def test_no_corpus_is_not_independent_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'manifest.json').write_text(json.dumps({'cases': []}))
            result = subprocess.run([sys.executable, str(CLI), 'freeze', str(root / 'manifest.json'), str(root / 'lock.json')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('No evaluation cases', result.stderr)
            self.assertFalse((root / 'lock.json').exists())

    def test_missing_and_disputed_actions_stay_in_the_denominator(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'recording.txt').write_text('Synthetic fixture, not an actual interview.')
            (root / 'context.json').write_text('{}')
            (root / 'reference.json').write_text(json.dumps({'labeler_id': 'author', 'independent_labeler': False, 'questions': [
                {'id': f'q{i}', 'thread_id': f't{i}', 'substantive': True, 'answer_utterance_ids': []} for i in range(3)
            ]}))
            (root / 'manifest.json').write_text(json.dumps({'cases': [{'id': 'fixture', 'origin': 'synthetic', 'permission_reference': 'author-created fixture', 'split': 'held_out', 'recording_file': 'recording.txt', 'reference_file': 'reference.json', 'context_file': 'context.json'}]}))
            def run(*args):
                return subprocess.run([sys.executable, str(CLI), *map(str, args)], capture_output=True, text=True)
            frozen = run('freeze', root/'manifest.json', root/'lock.json')
            self.assertEqual(frozen.returncode, 0, frozen.stderr)
            (root/'ratings.json').write_text(json.dumps({'reviewers': [{'id': 'r1', 'independent': True}, {'id': 'r2', 'independent': True}], 'grouping': [], 'spurious_groups': [], 'coaching': [
                {'case_id': 'fixture', 'thread_id': 't0', 'reviewer_id': 'r1', 'system': 'app', 'supported_action': True, 'abstained': False, 'critical_defects': [], 'major_defects': []},
                {'case_id': 'fixture', 'thread_id': 't1', 'reviewer_id': 'r1', 'system': 'app', 'supported_action': True, 'abstained': False, 'critical_defects': [], 'major_defects': []},
                {'case_id': 'fixture', 'thread_id': 't1', 'reviewer_id': 'r2', 'system': 'app', 'supported_action': False, 'abstained': False, 'critical_defects': ['invented metric'], 'major_defects': []},
            ]}))
            scored = run('score', root/'manifest.json', root/'lock.json', root/'ratings.json', root/'report.json')
            self.assertEqual(scored.returncode, 0, scored.stderr)
            report = json.loads((root/'report.json').read_text())
            self.assertEqual(report['coaching']['app']['supported_threads'], 1)
            self.assertEqual(report['coaching']['app']['total_threads'], 3)
            self.assertEqual(report['coaching']['app']['disputed_threads'], 1)
            self.assertEqual(report['coaching']['app']['unreviewed_threads'], 1)
            self.assertTrue(report['coaching']['app']['critical_defect_block'])
            self.assertEqual(report['validation_status'], 'not_independent_validation')
            (root/'context.json').write_text('{"changed": true}')
            tampered = run('score', root/'manifest.json', root/'lock.json', root/'ratings.json', root/'changed.json')
            self.assertNotEqual(tampered.returncode, 0)
            self.assertIn('changed since freezing', tampered.stderr)

    def test_blinded_packets_keep_system_identity_out_of_reviewer_material(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'recording.txt').write_text('Synthetic fixture')
            (root/'context.json').write_text(json.dumps({'question': 'What was your contribution?'}))
            (root/'reference.json').write_text(json.dumps({'labeler_id': 'author', 'independent_labeler': False, 'questions': [{'id': 'q1', 'thread_id': 't1', 'substantive': True, 'answer_utterance_ids': ['u1']}]}))
            (root/'manifest.json').write_text(json.dumps({'cases': [{'id': 'case1', 'origin': 'synthetic', 'permission_reference': 'synthetic fixture', 'split': 'held_out', 'recording_file': 'recording.txt', 'context_file': 'context.json', 'reference_file': 'reference.json'}]}))
            def run(*args):
                return subprocess.run([sys.executable, str(CLI), *map(str, args)], capture_output=True, text=True)
            self.assertEqual(run('freeze',root/'manifest.json',root/'lock.json').returncode, 0)
            (root/'outputs.json').write_text(json.dumps({'items': [{'case_id': 'case1', 'thread_id': 't1', 'app': 'First advice', 'baseline': 'Second advice'}]}))
            result = run('blind',root/'manifest.json',root/'lock.json',root/'outputs.json',root/'packets')
            self.assertEqual(result.returncode, 0, result.stderr)
            packets = json.loads((root/'packets'/'reviewer-packets.json').read_text())
            assignment = json.loads((root/'packets'/'sealed-assignments.json').read_text())
            self.assertEqual(set(packets['items'][0]['options']), {'A','B'})
            self.assertEqual(set(packets['items'][0]['options'].values()), {'First advice','Second advice'})
            self.assertNotIn('app', packets['items'][0]['options'])
            self.assertEqual(set(assignment['items'][0]['systems'].values()), {'app','baseline'})
            self.assertEqual(packets['items'][0]['source']['question'], 'What was your contribution?')

if __name__ == '__main__':
    unittest.main()
