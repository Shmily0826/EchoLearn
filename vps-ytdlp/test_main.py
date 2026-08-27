"""Deterministic tests for the VPS ASR tracing boundary.

These tests mock Groq and never contact external services.
"""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from urllib.error import HTTPError

import main


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def _response(payload):
    return _Response(json.dumps(payload).encode("utf-8"))


class _FakeYtdlpProcess:
    next_results = []

    def __init__(self, *_args, cwd=None, **_kwargs):
        self.cwd = cwd
        self.pid = 12345
        self.returncode, self.stderr, self.timeout = self.next_results.pop(0)
        self.terminated = False
        self.waited = False

    def communicate(self, timeout=None):
        if self.timeout:
            raise main.subprocess.TimeoutExpired("yt-dlp", timeout)
        if self.returncode == 0:
            with open(f"{self.cwd}/audio.mp3", "wb") as audio:
                audio.write(b"audio")
        return "", self.stderr

    def poll(self):
        return None if not self.terminated else -15

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.terminated = True

    def wait(self, timeout=None):
        self.waited = True
        return self.returncode


class GroqTracingTests(unittest.TestCase):
    def setUp(self):
        self.trace_token = main._TRACE_CONTEXT.set("unit-test-trace")
        self.key = main.GROQ_API_KEY
        main.GROQ_API_KEY = "unit-test-only"

    def tearDown(self):
        main.GROQ_API_KEY = self.key
        main._TRACE_CONTEXT.reset(self.trace_token)

    def test_success_emits_safe_stage_and_segment_events(self):
        payload = {"language": "en", "segments": [{"start": 0, "end": 1, "text": "hello"}]}
        with tempfile.NamedTemporaryFile(suffix=".mp3") as audio, redirect_stdout(io.StringIO()) as output:
            audio.write(b"tiny-audio")
            audio.flush()
            with patch.object(main.urllib.request, "urlopen", return_value=_response(payload)):
                result = main._groq_transcribe(audio.name)

        log = output.getvalue()
        self.assertEqual(len(result["lines"]), 1)
        self.assertIn('"event": "audio_file_ready"', log)
        self.assertIn('"event": "groq_attempt_start"', log)
        self.assertIn('"event": "groq_success"', log)
        self.assertIn('"segmentCount": 1', log)
        self.assertNotIn("Authorization", log)
        self.assertNotIn(main.GROQ_API_KEY, log)

    def test_http_error_is_classified_and_transient_error_retries(self):
        error = HTTPError("https://api.groq.com", 403, "forbidden", {}, io.BytesIO(b"private body"))
        payload = {"language": "en", "segments": [{"start": 0, "end": 1, "text": "retry"}]}
        with tempfile.NamedTemporaryFile(suffix=".mp3") as audio, redirect_stdout(io.StringIO()) as output:
            audio.write(b"tiny-audio")
            audio.flush()
            with patch.object(main.urllib.request, "urlopen", side_effect=[error, _response(payload)]) as call:
                result = main._groq_transcribe(audio.name)

        log = output.getvalue()
        self.assertEqual(call.call_count, 2)
        self.assertEqual(result["lines"][0]["text"], "retry")
        self.assertIn('"status": 403', log)
        self.assertIn('"attempt": 2', log)
        self.assertNotIn("private body", log)

    def test_timeout_is_classified_and_retries_without_exposing_details(self):
        with tempfile.NamedTemporaryFile(suffix=".mp3") as audio, redirect_stdout(io.StringIO()) as output:
            audio.write(b"tiny-audio")
            audio.flush()
            with patch.object(main.urllib.request, "urlopen", side_effect=TimeoutError("private network detail")):
                with patch.object(main.time, "sleep"):
                    with self.assertRaises(main.HTTPException) as raised:
                        main._groq_transcribe(audio.name)

        log = output.getvalue()
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(log.count('"event": "groq_network_error"'), 2)
        self.assertIn('"category": "TimeoutError"', log)
        self.assertNotIn("private network detail", log)

    def test_empty_response_fails_as_no_speech_without_success_event(self):
        with tempfile.NamedTemporaryFile(suffix=".mp3") as audio, redirect_stdout(io.StringIO()) as output:
            audio.write(b"tiny-audio")
            audio.flush()
            with patch.object(main.urllib.request, "urlopen", return_value=_response({})):
                with self.assertRaises(main.HTTPException) as raised:
                    main._groq_transcribe(audio.name)

        log = output.getvalue()
        self.assertEqual(raised.exception.status_code, 404)
        self.assertIn('"result": "response_received"', log)
        self.assertNotIn('"event": "groq_success"', log)


class AudioAcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.trace_token = main._TRACE_CONTEXT.set("audio-test-trace")
        self.proxy = main.YTDLP_PROXY
        self.retries = main.YTDLP_RETRIES
        main.YTDLP_PROXY = "configured-proxy"
        main.YTDLP_RETRIES = 3

    def tearDown(self):
        main.YTDLP_PROXY = self.proxy
        main.YTDLP_RETRIES = self.retries
        main._TRACE_CONTEXT.reset(self.trace_token)

    def test_bot_check_switches_to_proxy_without_repeating_direct_attempts(self):
        _FakeYtdlpProcess.next_results = [
            (1, "ERROR: Sign in to confirm you're not a bot", False),
            (0, "", False),
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main.subprocess, "Popen", side_effect=_FakeYtdlpProcess
        ) as popen, patch.object(main, "_audio_duration", return_value=2.0), patch.object(
            main, "_groq_transcribe", return_value={"lines": [{"text": "hello"}]}
        ) as groq:
            result = main._download_audio("https://www.youtube.com/watch?v=test", directory)
            groq(result)

        self.assertTrue(result.endswith("audio.mp3"))
        self.assertEqual(popen.call_count, 2)
        self.assertIn("configured-proxy", str(popen.call_args_list[1]))
        groq.assert_called_once_with(result)

    def test_proxy_failure_is_bounded(self):
        _FakeYtdlpProcess.next_results = [
            (1, "ERROR: [youtube] Sign in to confirm you're not a bot", False),
            (1, "ERROR: [youtube] HTTP Error 403: Forbidden", False),
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main.subprocess, "Popen", side_effect=_FakeYtdlpProcess
        ) as popen:
            with self.assertRaises(main.YouTubeAcquisitionBlocked):
                main._download_audio("https://www.youtube.com/watch?v=test", directory)

        self.assertEqual(popen.call_count, 2)

    def test_non_blocked_extraction_failure_remains_generic(self):
        _FakeYtdlpProcess.next_results = [(1, "ERROR: decoder failed", False)]
        with tempfile.TemporaryDirectory() as directory:
            result = main._download_audio("https://www.youtube.com/watch?v=test", directory)
        self.assertIsNone(result)

    def test_asr_returns_machine_readable_blocked_error_without_cache_or_groq(self):
        old_groq = main.GROQ_API_KEY
        old_api_key = main.YTDLP_API_KEY
        main.GROQ_API_KEY = "unit-test-only"
        main.YTDLP_API_KEY = ""
        try:
            with patch.object(main, "_cache_get", return_value=None), patch.object(
                main, "_fetch_meta", return_value={"duration": 10}
            ), patch.object(
                main, "_download_audio", side_effect=main.YouTubeAcquisitionBlocked
            ) as download, patch.object(main, "_groq_transcribe") as groq:
                with self.assertRaises(main.HTTPException) as raised:
                    main.asr("https://www.youtube.com/watch?v=test")
        finally:
            main.GROQ_API_KEY = old_groq
            main.YTDLP_API_KEY = old_api_key

        self.assertEqual(raised.exception.status_code, 424)
        self.assertEqual(raised.exception.detail["code"], "youtube_acquisition_blocked")
        download.assert_called_once()
        groq.assert_not_called()

    def test_timeout_terminates_and_reaps_process_group(self):
        process = _FakeYtdlpProcess
        process.next_results = [(1, "", True)]
        with patch.object(main.subprocess, "Popen", side_effect=process) as popen, patch.object(
            main, "_terminate_process_group"
        ) as terminate, tempfile.TemporaryDirectory() as directory:
            result = main._download_audio("https://www.youtube.com/watch?v=test", directory)

        self.assertIsNone(result)
        self.assertEqual(popen.call_count, 1)
        terminate.assert_called_once()

    def test_timeout_after_blocked_attempt_preserves_bounded_category(self):
        _FakeYtdlpProcess.next_results = [
            (1, "ERROR: Sign in to confirm you're not a bot", False),
            (1, "", True),
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main.subprocess, "Popen", side_effect=_FakeYtdlpProcess
        ):
            with self.assertRaises(main.YouTubeAcquisitionBlocked):
                main._download_audio("https://www.youtube.com/watch?v=test", directory)

    def test_process_group_helper_reaps_after_termination(self):
        process = _FakeYtdlpProcess
        process.next_results = [(1, "", False)]
        proc = process(cwd=".")
        with patch.object(main.os, "getpgid", return_value=proc.pid), patch.object(
            main.os, "killpg"
        ) as killpg:
            main._terminate_process_group(proc)

        killpg.assert_called_once()
        self.assertTrue(proc.waited)

    def test_site_cookie_is_not_sent_to_youtube(self):
        old_cookie = main.YTDLP_COOKIES
        with tempfile.NamedTemporaryFile() as cookie:
            main.YTDLP_COOKIES = cookie.name
            self.assertEqual(main._site_args("https://www.youtube.com/watch?v=test"), [])
            self.assertEqual(
                main._site_args("https://www.bilibili.com/video/BVtest"),
                ["--cookies", cookie.name],
            )
        main.YTDLP_COOKIES = old_cookie

    def test_expired_overall_deadline_skips_new_subprocess(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main.subprocess, "Popen"
        ) as popen:
            result = main._download_audio(
                "https://www.youtube.com/watch?v=test",
                directory,
                deadline=main.time.monotonic() - 1,
            )

        self.assertIsNone(result)
        popen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
