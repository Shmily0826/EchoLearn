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


def _trace_lines(output):
    return [json.loads(line) for line in output.getvalue().splitlines() if line.strip()]


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
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()) as output:
            audio_path = f"{directory}/audio.mp3"
            with open(audio_path, "wb") as audio:
                audio.write(b"tiny-audio")
            with patch.object(main.urllib.request, "urlopen", return_value=_response(payload)):
                result = main._groq_transcribe(audio_path)

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
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()) as output:
            audio_path = f"{directory}/audio.mp3"
            with open(audio_path, "wb") as audio:
                audio.write(b"tiny-audio")
            with patch.object(main.urllib.request, "urlopen", side_effect=[error, _response(payload)]) as call:
                result = main._groq_transcribe(audio_path)

        log = output.getvalue()
        self.assertEqual(call.call_count, 2)
        self.assertEqual(result["lines"][0]["text"], "retry")
        self.assertIn('"status": 403', log)
        self.assertIn('"attempt": 2', log)
        self.assertNotIn("private body", log)

    def test_timeout_is_classified_and_retries_without_exposing_details(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()) as output:
            audio_path = f"{directory}/audio.mp3"
            with open(audio_path, "wb") as audio:
                audio.write(b"tiny-audio")
            with patch.object(main.urllib.request, "urlopen", side_effect=TimeoutError("private network detail")):
                with patch.object(main.time, "sleep"):
                    with self.assertRaises(main.HTTPException) as raised:
                        main._groq_transcribe(audio_path)

        log = output.getvalue()
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(log.count('"event": "groq_network_error"'), 2)
        self.assertIn('"category": "TimeoutError"', log)
        self.assertNotIn("private network detail", log)

    def test_empty_response_fails_as_no_speech_without_success_event(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()) as output:
            audio_path = f"{directory}/audio.mp3"
            with open(audio_path, "wb") as audio:
                audio.write(b"tiny-audio")
            with patch.object(main.urllib.request, "urlopen", return_value=_response({})):
                with self.assertRaises(main.HTTPException) as raised:
                    main._groq_transcribe(audio_path)

        log = output.getvalue()
        self.assertEqual(raised.exception.status_code, 404)
        self.assertIn('"result": "response_received"', log)
        self.assertNotIn('"event": "groq_success"', log)


class AudioAcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.trace_token = main._TRACE_CONTEXT.set("audio-test-trace")
        self.proxy = main.YTDLP_PROXY
        self.retries = main.YTDLP_RETRIES
        with main._PROXY_CIRCUIT_LOCK:
            self.circuit_open_until = main._PROXY_CIRCUIT_OPEN_UNTIL
            self.circuit_proxy_key = main._PROXY_CIRCUIT_PROXY_KEY
            main._PROXY_CIRCUIT_OPEN_UNTIL = 0.0
            main._PROXY_CIRCUIT_PROXY_KEY = None
        main.YTDLP_PROXY = "configured-proxy"
        main.YTDLP_RETRIES = 3

    def tearDown(self):
        main.YTDLP_PROXY = self.proxy
        main.YTDLP_RETRIES = self.retries
        with main._PROXY_CIRCUIT_LOCK:
            main._PROXY_CIRCUIT_OPEN_UNTIL = self.circuit_open_until
            main._PROXY_CIRCUIT_PROXY_KEY = self.circuit_proxy_key
        main._TRACE_CONTEXT.reset(self.trace_token)

    def test_failure_classifier_uses_allowlisted_categories_and_signatures(self):
        cases = [
            (
                "ERROR: Sign in to confirm you're not a bot; token=UNSAFE_TOKEN",
                "youtube_bot_check",
                "signin_required",
                "direct",
            ),
            ("ERROR: HTTP Error 403: Forbidden", "http_403", "http_403", "proxy"),
            ("ERROR: HTTP Error 429: Too Many Requests", "http_429", "http_429", "proxy"),
            ("ERROR: Proxy authentication required", "proxy_auth", "proxy_auth", "proxy"),
            ("ERROR: HTTP 407", "proxy_auth", "proxy_auth", "proxy"),
            ("ERROR: proxy connection refused", "proxy_connect", "proxy_connect", "proxy"),
            ("ERROR: JavaScript challenge required", "player_challenge", "player_challenge", "direct"),
            ("ERROR: Requested format is not available", "format_unavailable", "format_unavailable", "direct"),
            ("ERROR: TLS handshake failed", "tls_network", "tls_network", "direct"),
            ("ERROR: decoder failed", "extraction_failure", "nonzero_exit", "direct"),
            ("", "unknown", "no_output", "direct"),
        ]
        for stderr, category, signature, mode in cases:
            with self.subTest(category=category):
                result = main._yt_dlp_failure_evidence(stderr, mode=mode)
                self.assertEqual(result, (category, signature))
                self.assertIn(category, main._YTDLP_FAILURE_CATEGORIES)
                self.assertIn(signature, main._YTDLP_FAILURE_SIGNATURES)

    def test_audio_attempt_trace_is_safe_and_final_category_uses_latest_proxy_failure(self):
        secret = "https://user:UNSAFE_PASSWORD@proxy.example:8080/path?token=UNSAFE_TOKEN"
        stderr_values = [
            f"ERROR: Sign in to confirm you're not a bot {secret}",
            f"ERROR: HTTP Error 429: Too Many Requests {secret}",
            f"ERROR: decoder failed raw-provider-stderr {secret}",
            f"ERROR: decoder failed raw-provider-stderr {secret}",
        ]
        _FakeYtdlpProcess.next_results = [(1, stderr, False) for stderr in stderr_values]
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main.subprocess, "Popen", side_effect=_FakeYtdlpProcess
        ), redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(main.YouTubeAcquisitionBlocked):
                main._download_audio("https://www.youtube.com/watch?v=test", directory)

        events = _trace_lines(output)
        attempts = [event for event in events if event.get("event") == "audio_extract_attempt"]
        self.assertEqual(len(attempts), 4)
        self.assertEqual(
            (attempts[0]["mode"], attempts[0]["attempt"], attempts[0]["category"], attempts[0]["signature"]),
            ("direct", 1, "youtube_bot_check", "signin_required"),
        )
        self.assertEqual([event["mode"] for event in attempts[1:]], ["proxy", "proxy", "proxy"])
        self.assertEqual([event["attempt"] for event in attempts[1:]], [1, 2, 3])
        self.assertEqual(
            [event["category"] for event in attempts[1:]],
            ["http_429", "extraction_failure", "extraction_failure"],
        )

        final = [
            event
            for event in events
            if event.get("event") == "audio_extract_finish" and "attempts" in event
        ][-1]
        self.assertEqual(final["outcome"], "blocked")
        self.assertEqual(final["category"], "extraction_failure")
        self.assertEqual(final["signature"], "nonzero_exit")
        self.assertEqual(final["mode"], "proxy")
        self.assertEqual(final["attempts"], 4)
        self.assertTrue(final["blockedEvidence"])
        log = output.getvalue()
        self.assertNotIn(secret, log)
        self.assertNotIn("UNSAFE_PASSWORD", log)
        self.assertNotIn("raw-provider-stderr", log)
        self.assertNotIn("UNSAFE_TOKEN", log)

    def test_proxy_connect_trips_breaker_and_second_acquisition_skips_proxy(self):
        secret = "https://user:UNSAFE_PASSWORD@proxy.example:8080/path?token=UNSAFE_TOKEN"
        _FakeYtdlpProcess.next_results = [
            (1, "ERROR: Sign in to confirm you're not a bot", False),
            (1, f"ERROR: connection refused {secret}", False),
            (1, "ERROR: Sign in to confirm you're not a bot", False),
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main.subprocess, "Popen", side_effect=_FakeYtdlpProcess
        ) as popen, redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(main.YouTubeAcquisitionBlocked):
                main._download_audio("https://www.youtube.com/watch?v=first", directory)
            with self.assertRaises(main.YouTubeAcquisitionBlocked):
                main._download_audio("https://www.youtube.com/watch?v=second", directory)

        self.assertEqual(popen.call_count, 3)
        self.assertTrue(main._PROXY_CIRCUIT_OPEN_UNTIL > main.time.monotonic())
        events = _trace_lines(output)
        self.assertTrue(any(event.get("event") == "audio_proxy_circuit_open" for event in events))
        self.assertTrue(any(event.get("event") == "audio_proxy_circuit_skip" for event in events))
        log = output.getvalue()
        self.assertNotIn(secret, log)
        self.assertNotIn("UNSAFE_PASSWORD", log)
        self.assertNotIn("UNSAFE_TOKEN", log)

    def test_expired_proxy_breaker_allows_a_fresh_proxy_attempt(self):
        main._proxy_circuit_trip("proxy_connect", "proxy_connect")
        with main._PROXY_CIRCUIT_LOCK:
            main._PROXY_CIRCUIT_OPEN_UNTIL = main.time.monotonic() - 1
        _FakeYtdlpProcess.next_results = [
            (1, "ERROR: Sign in to confirm you're not a bot", False),
            (1, "ERROR: HTTP Error 403: Forbidden", False),
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main.subprocess, "Popen", side_effect=_FakeYtdlpProcess
        ) as popen:
            with self.assertRaises(main.YouTubeAcquisitionBlocked):
                main._download_audio("https://www.youtube.com/watch?v=expired", directory)

        self.assertEqual(popen.call_count, 2)
        self.assertEqual(main._PROXY_CIRCUIT_OPEN_UNTIL, 0.0)

    def test_non_connect_proxy_failures_do_not_trip_breaker(self):
        cases = [
            ("http_403", "ERROR: HTTP Error 403: Forbidden", 2),
            ("player_challenge", "ERROR: JavaScript challenge required", 4),
            ("extraction_failure", "ERROR: decoder failed", 4),
        ]
        for category, stderr, expected_calls in cases:
            with self.subTest(category=category):
                with main._PROXY_CIRCUIT_LOCK:
                    main._PROXY_CIRCUIT_OPEN_UNTIL = 0.0
                    main._PROXY_CIRCUIT_PROXY_KEY = None
                _FakeYtdlpProcess.next_results = [
                    (1, "ERROR: Sign in to confirm you're not a bot", False),
                    *[(1, stderr, False) for _ in range(expected_calls - 1)],
                ]
                with tempfile.TemporaryDirectory() as directory, patch.object(
                    main.subprocess, "Popen", side_effect=_FakeYtdlpProcess
                ) as popen:
                    with self.assertRaises(main.YouTubeAcquisitionBlocked):
                        main._download_audio(
                            "https://www.youtube.com/watch?v=non-trip", directory
                        )
                self.assertEqual(popen.call_count, expected_calls)
                self.assertEqual(main._PROXY_CIRCUIT_OPEN_UNTIL, 0.0)

    def test_successful_proxy_attempt_keeps_breaker_closed(self):
        _FakeYtdlpProcess.next_results = [
            (1, "ERROR: Sign in to confirm you're not a bot", False),
            (0, "", False),
        ]
        with tempfile.TemporaryDirectory() as directory, patch.object(
            main.subprocess, "Popen", side_effect=_FakeYtdlpProcess
        ), patch.object(main, "_audio_duration", return_value=2.0):
            result = main._download_audio("https://www.youtube.com/watch?v=success", directory)

        self.assertTrue(result.endswith("audio.mp3"))
        self.assertEqual(main._PROXY_CIRCUIT_OPEN_UNTIL, 0.0)
        self.assertEqual(main._PROXY_CIRCUIT_PROXY_KEY, None)

    def test_open_proxy_breaker_does_not_touch_caption_direct_path(self):
        main._proxy_circuit_trip("proxy_connect", "proxy_connect")
        result = ([{"id": "yt_1", "start": 0.0, "end": 1.0, "text": "hello"}], "en", False, None)
        with patch.object(main, "_cache_get", return_value=None), patch.object(
            main, "_run_ytdlp", return_value=result
        ) as run:
            response = main.transcript(video_id="dQw4w9WgXcQ", lang="en")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body)["lines"][0]["text"], "hello")
        run.assert_called_once()

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

    def test_asr_continues_to_audio_when_youtube_metadata_is_blocked(self):
        old_groq = main.GROQ_API_KEY
        old_api_key = main.YTDLP_API_KEY
        main.GROQ_API_KEY = "unit-test-only"
        main.YTDLP_API_KEY = ""
        try:
            with patch.object(main, "_cache_get", return_value=None), patch.object(
                main, "_fetch_meta", side_effect=main.HTTPException(status_code=404, detail="blocked")
            ), patch.object(
                main, "_download_audio", side_effect=main.YouTubeAcquisitionBlocked
            ) as download:
                with self.assertRaises(main.HTTPException) as raised:
                    main.asr("https://www.youtube.com/watch?v=test")
        finally:
            main.GROQ_API_KEY = old_groq
            main.YTDLP_API_KEY = old_api_key

        self.assertEqual(raised.exception.status_code, 424)
        download.assert_called_once()

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
        if main.os.name == "nt":
            with patch.object(proc, "terminate") as terminate:
                main._terminate_process_group(proc)
            terminate.assert_called_once()
        else:
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


class TranscriptRouteTests(unittest.TestCase):
    def setUp(self):
        self.proxy = main.YTDLP_PROXY
        self.api_key = main.YTDLP_API_KEY
        main.YTDLP_PROXY = ""
        main.YTDLP_API_KEY = ""

    def tearDown(self):
        main.YTDLP_PROXY = self.proxy
        main.YTDLP_API_KEY = self.api_key

    def test_all_caption_attempts_timing_out_returns_structured_504(self):
        with patch.object(main, "_cache_get", return_value=None), patch.object(
            main, "_run_yt_dlp", return_value=(None, None, None, True)
        ) as run:
            response = main.transcript(video_id="dQw4w9WgXcQ", lang="en")

        self.assertEqual(response.status_code, 504)
        self.assertEqual(
            json.loads(response.body),
            {
                "error": "provider_timeout",
                "code": "provider_timeout",
                "message": "Transcript provider timed out.",
            },
        )
        run.assert_called_once()

    def test_clean_caption_absence_remains_structured_404(self):
        with patch.object(main, "_cache_get", return_value=None), patch.object(
            main, "_run_yt_dlp", return_value=(0, "", "", False)
        ):
            response = main.transcript(video_id="dQw4w9WgXcQ", lang="en")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            json.loads(response.body),
            {
                "error": "captions_not_found",
                "code": "captions_not_found",
                "message": "No transcript available for this video.",
            },
        )

    def test_nonzero_caption_provider_failure_is_not_relabelled_as_absence(self):
        with patch.object(main, "_cache_get", return_value=None), patch.object(
            main,
            "_run_yt_dlp",
            return_value=(1, "", "ERROR: provider failure", False),
        ):
            response = main.transcript(video_id="dQw4w9WgXcQ", lang="en")

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            json.loads(response.body),
            {
                "error": "provider_failure",
                "code": "provider_failure",
                "message": "Transcript provider failed.",
            },
        )


class CaptionExtractionTracingTests(unittest.TestCase):
    def setUp(self):
        self.trace_token = main._TRACE_CONTEXT.set("caption-test-trace")
        self.proxy = main.YTDLP_PROXY
        main.YTDLP_PROXY = ""

    def tearDown(self):
        main.YTDLP_PROXY = self.proxy
        main._TRACE_CONTEXT.reset(self.trace_token)

    def test_success_emits_safe_attempt_and_finish_events(self):
        result = ([{"id": "yt_1", "start": 0, "end": 1, "text": "hello"}], "en", False, None)
        with patch.object(main, "_run_yt_dlp", return_value=(0, "", "", False)), patch.object(
            main, "_read_subtitle_file", return_value=result
        ), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(main._run_ytdlp("dQw4w9WgXcQ", "en"), result)

        events = _trace_lines(output)
        self.assertEqual(events[0], {
            "service": "vps-transcript",
            "event": "caption_extract_start",
            "traceId": "caption-test-trace",
            "candidateCount": 1,
        })
        attempt = next(event for event in events if event["event"] == "caption_extract_attempt_finish")
        self.assertEqual(
            (attempt["attempt"], attempt["mode"], attempt["outcome"], attempt["result"]),
            (1, "direct", "success", "subtitle"),
        )
        self.assertIsInstance(attempt["elapsedMs"], int)
        final = events[-1]
        self.assertEqual(
            (final["event"], final["attempts"], final["outcome"], final["result"]),
            ("caption_extract_finish", 1, "success", "subtitle"),
        )

    def test_attempt_index_follows_existing_direct_then_proxy_candidates(self):
        main.YTDLP_PROXY = "configured-proxy"
        result = ([{"id": "yt_1", "start": 0, "end": 1, "text": "hello"}], "en", False, None)
        with patch.object(
            main,
            "_run_yt_dlp",
            side_effect=[(1, "", "ERROR: decoder failed", False), (0, "", "", False)],
        ), patch.object(main, "_read_subtitle_file", return_value=result), redirect_stdout(
            io.StringIO()
        ) as output:
            self.assertEqual(main._run_ytdlp("dQw4w9WgXcQ", "en"), result)

        attempts = [event for event in _trace_lines(output) if event["event"] == "caption_extract_attempt_finish"]
        self.assertEqual(
            [(event["attempt"], event["mode"], event["outcome"]) for event in attempts],
            [(1, "direct", "failure"), (2, "proxy", "success")],
        )

    def test_nonzero_failure_uses_bounded_category_without_stderr_or_url(self):
        secret = "https://user:UNSAFE_PASSWORD@proxy.example:8080/path?token=UNSAFE_TOKEN"
        stderr = f"ERROR: Sign in to confirm you're not a bot {secret} raw-provider-stderr"
        with patch.object(main, "_run_yt_dlp", return_value=(1, "", stderr, False)), redirect_stdout(
            io.StringIO()
        ) as output:
            with self.assertRaises(main.TranscriptProviderFailure):
                main._run_ytdlp("dQw4w9WgXcQ", "en")

        events = _trace_lines(output)
        attempt = next(event for event in events if event["event"] == "caption_extract_attempt_finish")
        self.assertEqual(
            (attempt["attempt"], attempt["mode"], attempt["outcome"], attempt["category"], attempt["signature"]),
            (1, "direct", "failure", "youtube_bot_check", "signin_required"),
        )
        final = events[-1]
        self.assertEqual(
            (final["event"], final["attempts"], final["outcome"], final["category"], final["signature"]),
            ("caption_extract_finish", 1, "failure", "youtube_bot_check", "signin_required"),
        )
        log = output.getvalue()
        self.assertNotIn(secret, log)
        self.assertNotIn("UNSAFE_PASSWORD", log)
        self.assertNotIn("UNSAFE_TOKEN", log)
        self.assertNotIn("raw-provider-stderr", log)
        self.assertNotIn("https://www.youtube.com/watch", log)

    def test_timeout_and_empty_result_keep_distinct_safe_outcomes(self):
        with patch.object(main, "_run_yt_dlp", return_value=(None, None, None, True)), redirect_stdout(
            io.StringIO()
        ) as timeout_output:
            with self.assertRaises(main.TranscriptProviderTimeout):
                main._run_ytdlp("dQw4w9WgXcQ", "en")

        timeout_events = _trace_lines(timeout_output)
        self.assertEqual(
            (timeout_events[-1]["outcome"], timeout_events[-1]["category"], timeout_events[-1]["signature"]),
            ("timeout", "timeout", "timeout"),
        )

        with patch.object(main, "_run_yt_dlp", return_value=(0, "", "", False)), patch.object(
            main, "_read_subtitle_file", return_value=None
        ), redirect_stdout(io.StringIO()) as empty_output:
            self.assertIsNone(main._run_ytdlp("dQw4w9WgXcQ", "en"))

        empty_events = _trace_lines(empty_output)
        self.assertEqual(
            (empty_events[-2]["outcome"], empty_events[-2]["result"]),
            ("no_caption", "empty"),
        )
        self.assertEqual(
            (empty_events[-1]["outcome"], empty_events[-1]["result"]),
            ("no_caption", "empty"),
        )


if __name__ == "__main__":
    unittest.main()
